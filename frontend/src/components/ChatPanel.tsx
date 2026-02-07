"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Send, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActionConfirmModal } from "@/components/ActionConfirmModal";
import { Markdown } from "@/components/Markdown";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { TriageBadge } from "@/components/TriageBadge";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { DocumentUploadFlow } from "@/components/DocumentUploadFlow";
import type { DocumentUploadResult } from "@/components/DocumentUploadFlow";
import { useChatStore } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { ActionPlan, ActionResult, TriageLevel } from "@/lib/types";
import { addActionLog } from "@/lib/firestore";
import { useAuthUser } from "@/lib/useAuth";
import { processCareBaseText, type AccessDecision } from "@/lib/carebase/engine";
import { CareBaseGuard, type CareBaseRequest } from "@/components/CareBaseGuard";
import { consumeSSE } from "@/lib/sse";
import { pullCloudToLocal } from "@/lib/carebase/cloud";

const LOCATION_STORAGE_KEY = "carepilot.location_text";
const DEBUG_SHOW_RAW_KEY = "carepilot.debug_show_raw";

const EMERGENCY_KEYWORDS = [
  "call 911", "emergency room", "go to the er", "chest pain",
  "difficulty breathing", "severe bleeding", "stroke", "unconscious",
  "anaphylaxis", "overdose", "suicidal",
];

function inferTriageFromContent(text: string): TriageLevel | null {
  const lower = text.toLowerCase();
  if (EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw))) return "EMERGENT";
  if (lower.includes("within 24 hours") || lower.includes("urgent") || lower.includes("see a doctor soon")) return "URGENT_24H";
  if (lower.includes("routine") || lower.includes("follow up") || lower.includes("at your next visit")) return "ROUTINE";
  return null;
}

function inferLocationHint(text: string): string | null {
  const match = text.match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z .'-]{1,80})(?=$|[?.!,])/i);
  if (!match) return null;
  const candidate = match[1].replace(/\s+/g, " ").trim();
  if (!candidate) return null;
  const lowered = candidate.toLowerCase();
  if (["next week", "the morning", "the afternoon", "the evening"].includes(lowered)) return null;
  return candidate;
}

function formatActionResult(tool: string, data: ActionResult): string {
  if (data.status === "failure") {
    return `The action failed: ${data.result?.message ?? "Unknown error"}`;
  }
  const r = data.result;
  if (r?.confirmation_id) {
    return `Booking confirmed. Confirmation ID: **${r.confirmation_id}**. ${r.summary ?? ""}`;
  }
  if (Array.isArray(r?.items)) {
    const items = r.items as Array<Record<string, unknown>>;
    if (items.length === 0) return `No results found for ${tool}.`;
    const lines = items.map(
      (it, i) => `${i + 1}. **${it.name ?? "Unknown"}** — ${it.address ?? "No address"}`
    );
    return `Found ${items.length} result(s):\n\n${lines.join("\n")}`;
  }
  const summary = typeof r?.summary === "string" ? r.summary : undefined;
  const message = typeof r?.message === "string" ? r.message : undefined;
  return summary || message || "Action completed.";
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function stripCareBaseTags(text: string): string {
  return text
    .replace(/<carebase-[^>]+>[\s\S]*?<\/carebase-[^>]+>/gi, " ")
    .replace(/<carebase-list>\s*<\/carebase-list>/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function displayTextForMessage(content: string, isStreaming: boolean): string {
  if (!isStreaming) return stripCareBaseTags(content);
  const lower = content.toLowerCase();
  const startIndex = lower.indexOf("<carebase-");
  const visible = startIndex === -1 ? content : content.slice(0, startIndex);
  return stripCareBaseTags(visible);
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [mode, setMode] = useState<"type" | "document">("type");
  const [voiceStatus, setVoiceStatus] = useState<{ message: string; isError: boolean } | null>(
    null
  );
  const [showRawOutput, setShowRawOutput] = useState(false);
  const searchParams = useSearchParams();
  const [guardRequest, setGuardRequest] = useState<CareBaseRequest | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const decisionRef = useRef<((decision: AccessDecision) => void) | null>(null);
  const { push } = useToast();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    messages,
    sessionKey,
    appendMessage,
    appendAssistantDelta,
    actionPlan,
    setActionPlan,
    setActionResult,
    finalizeStreaming,
    isThinking,
    setThinking,
    triageLevel,
    setTriageLevel,
  } = useChatStore();
  const { user } = useAuthUser();

  const requestDecision = useCallback((request: CareBaseRequest) => {
    return new Promise<AccessDecision>((resolve) => {
      decisionRef.current = resolve;
      setGuardRequest(request);
      setGuardOpen(true);
    });
  }, []);

  const resolveGuard = useCallback((decision: AccessDecision) => {
    decisionRef.current?.(decision);
    decisionRef.current = null;
    setGuardOpen(false);
    setGuardRequest(null);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    const el = chatContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isThinking]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [input]);

  useEffect(() => {
    void pullCloudToLocal();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const queryValue = searchParams?.get("debug_raw");
    if (queryValue) {
      const normalized = queryValue.toLowerCase();
      const enabled = normalized === "1" || normalized === "true" || normalized === "yes";
      setShowRawOutput(enabled);
      return;
    }
    const stored = window.localStorage.getItem(DEBUG_SHOW_RAW_KEY);
    setShowRawOutput(stored === "1");
  }, [searchParams]);

  const modeHint = useMemo(() => {
    if (mode === "document") {
      return "Upload lab or imaging reports for extraction and plain-language interpretation.";
    }
    return "Ask a question, report symptoms, or request a care coordination action.";
  }, [mode]);

  const buildSystemPrompt = async () => {
    const now = new Date().toISOString();
    return [
      "CareBase Context:",
      `Current datetime: ${now}.`,
      `Current user id: ${user?.uid ?? "unknown"}.`,
      "Log any patient detail that could help future diagnosis using CareBase tags.",
      "Use absolute timestamps only when storing time.",
      "Store structured app memory in CareBase too.",
      "Profiles: use <carebase-store: profile:{user_id}> with JSON.",
      "When storing JSON, output ONLY valid JSON (no prose, no code fences).",
      "Read via <carebase-fetch>profile:{user_id}</carebase-fetch> and similar keys.",
      "Check-ins: append to <carebase-store: symptom_logs:{user_id}> as JSON array; never overwrite existing logs.",
      "Actions/refills: append to <carebase-store: action_logs:{user_id}> as JSON array with action_type; never overwrite existing logs.",
      "Replace {user_id} with the current user id above when forming keys.",
      "If you request CareBase data, STOP your response and wait for the CareBase result before answering.",
      "When you need data, output ONLY the CareBase fetch tag and no other text.",
      "Always store any clinically relevant user facts using <carebase-store: ...> tags; do not claim you stored data unless the tag is present.",
      "Entry guide: profile:{user_id} = demographics, conditions, allergies, meds, procedures, family_history, preferences, reminders.",
      "Entry guide: symptom_logs:{user_id} = array of symptom entries; action_logs:{user_id} = array of action/refill entries.",
      "Maintain an index of custom keys you create in <carebase-store: entry_index:{user_id}> as JSON mapping of key -> description.",
      "Profile format (JSON, arrays of objects): {consent:{health_data_use,accepted_at,privacy_version},profile_mode:{managing_for,dependent_label,relationship},demographics:{first_name,year_of_birth,sex_assigned_at_birth,height_cm,weight_kg},lifestyle:{smoking_status,alcohol_use,activity_level},conditions:[{name,diagnosed_year,under_treatment}],procedures:[{name,approximate_year}],meds:[{name,dose,frequency_per_day,cadence,start_date,last_fill_date,refill_days}],allergies:[{allergen,reaction,category}],family_history:{heart_disease,stroke,diabetes,cancer,hypertension,none_or_unsure},preferences:{radius_miles,preferred_pharmacy,preferred_days,appointment_windows,provider_gender_preference,care_priority},reminders:{med_runout,checkup_due,followup_nudges,reminder_mode,proactive_state,quiet_hours:{start,end}},onboarding:{completed,completed_at,step_last_seen,version},updated_at}.",
      "Symptom log format (array items): {created_at, symptom_text, severity, onset_time, notes}. Severity must be an integer (0-10). Use ISO timestamps.",
      "Action log format (array items): {created_at, action_type, status}. Use ISO timestamps.",
    ].join("\n");
  };

  const requestAgentReply = async (
    history: { role: string; content: string }[],
    message: string
  ) => {
    const system = await buildSystemPrompt();
    const requestBody = JSON.stringify({ message, history, system });
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    if (!response.ok) {
      const fallback = await fetch("/api/chat/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      if (!fallback.ok) {
        const payload = await fallback.json().catch(() => ({}));
        throw new Error(payload.error ?? "Chat request failed.");
      }
      const payload = (await fallback.json()) as { reply: string };
      return { reply: payload.reply ?? "", streamed: false };
    }

    let fullContent = "";
    let streamed = false;
    await consumeSSE(response, (event) => {
      if (event.event === "token") {
        const delta =
          typeof event.data === "string"
            ? event.data
            : (event.data as { delta?: string }).delta ?? "";
        if (delta) {
          streamed = true;
          fullContent += delta;
          appendAssistantDelta(delta);
        }
      }
      if (event.event === "message") {
        const text =
          typeof event.data === "string"
            ? event.data
            : (event.data as { text?: string }).text;
        if (text) {
          fullContent = text;
        }
      }
      if (event.event === "error") {
        const messageText =
          typeof event.data === "string"
            ? event.data
            : (event.data as { message?: string }).message ?? "Chat error.";
        throw new Error(messageText);
      }
    });

    return { reply: fullContent, streamed };
  };

  const handleSend = async () => {
    if (!input.trim() || pending) return;
    const content = input.trim();
    const priorMessages = useChatStore.getState().messages;
    setInput("");
    appendMessage({ role: "user", content });
    setPending(true);
    setThinking(true);
    try {
      let workingHistory = priorMessages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));
      let currentMessage = content;

      for (let step = 0; step < 5; step += 1) {
        const { reply, streamed } = await requestAgentReply(workingHistory, currentMessage);
        if (!reply.trim()) break;

        if (!streamed) {
          if (showRawOutput) {
            appendMessage({ role: "assistant", content: reply });
          } else {
            appendMessage({ role: "assistant", content: reply });
          }
        } else {
          finalizeStreaming();
        }
        const inferred = inferTriageFromContent(reply);
        if (inferred) setTriageLevel(inferred);

        const contextText = [
          ...workingHistory,
          { role: "user", content: currentMessage },
          { role: "assistant", content: reply },
        ]
          .map((msg) => `${msg.role}: ${stripCareBaseTags(msg.content)}`)
          .join("\n\n");
        let carebaseResult = null;
        try {
          carebaseResult = await processCareBaseText(reply, contextText, requestDecision);
        } catch (err) {
          appendMessage({
            role: "system",
            content: "CareBase pipeline error. Check master key or encryption settings.",
          });
          break;
        }

        workingHistory = [
          ...workingHistory,
          { role: "user", content: currentMessage },
          { role: "assistant", content: reply },
        ];

        if (!carebaseResult || carebaseResult.responses.length === 0) {
          break;
        }

        const carebaseText = carebaseResult.responses.join("\n");
        currentMessage = `CareBase Result:\n${carebaseText}`;
      }
    } catch (error) {
      appendMessage({ role: "system", content: `Connection error: ${(error as Error).message}` });
      push({ title: "Chat Error", description: (error as Error).message, variant: "error" });
    } finally {
      setThinking(false);
      setPending(false);
    }
  };

  const handleExecute = async () => {
    if (!actionPlan || actionPending) return;
    setActionPending(true);
    try {
      let idToken: string | undefined;
      idToken = await getIdTokenMaybe(user);
      const latestUserMessage = [...useChatStore.getState().messages]
        .reverse()
        .find((msg) => msg.role === "user")?.content;

      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: actionPlan,
          user_confirmed: true,
          session_key: sessionKey,
          message_text: latestUserMessage,
          idToken,
        }),
      });
      if (!res.ok) {
        throw new Error(`Action execution failed (${res.status})`);
      }
      const data: ActionResult = await res.json();
      setActionResult(data);
      const resultText = formatActionResult(actionPlan.tool, data);
      appendMessage({ role: "assistant", content: resultText });
      if (user?.uid) {
        await addActionLog(user.uid, {
          action_type: actionPlan.tool,
          status: data.status,
        });
      }
    } catch (error) {
      push({ title: "Action Failed", description: (error as Error).message, variant: "error" });
    } finally {
      setActionPending(false);
      setActionPlan(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="editorial-eyebrow">Conversation Studio</p>
            <h2 className="text-3xl leading-none">Clinical Dialogue</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={showRawOutput ? "default" : "ghost"}
              onClick={() => {
                const next = !showRawOutput;
                setShowRawOutput(next);
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(DEBUG_SHOW_RAW_KEY, next ? "1" : "0");
                }
              }}
            >
              {showRawOutput ? "Hide Raw" : "Show Raw"}
            </Button>
            {triageLevel && <TriageBadge level={triageLevel} />}
            {!triageLevel && <span className="status-chip status-chip--info">Triage Active</span>}
          </div>
        </div>

        <p className="text-sm text-[color:var(--cp-muted)]">{modeHint}</p>

        {/* Action staged banner */}
        {actionPlan && (
          <div className="rounded-2xl border border-[color:var(--cp-accent)]/35 bg-[color:color-mix(in_srgb,var(--cp-accent)_9%,white_91%)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-muted)]">
                  Action Staged
                </div>
                <div className="font-mono text-sm text-[color:var(--cp-text)]">{actionPlan.tool}</div>
              </div>
              <span className="status-chip status-chip--warn">Awaiting Consent</span>
            </div>
          </div>
        )}

        {/* Messages */}
        <div
          ref={chatContainerRef}
          className="min-h-[46vh] max-h-[68vh] space-y-3 overflow-y-auto rounded-2xl border border-[color:var(--cp-line)] bg-[color:var(--cp-surface)]/70 p-3"
          aria-live="polite"
          role="log"
          aria-label="Chat messages"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-[color:var(--cp-muted)]">
              Start with symptoms, upload context, or ask for a booking/refill workflow.
            </p>
          ) : (
            <AnimatePresence>
              {messages
                .filter((msg) => msg.role !== "carebase")
                .map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`max-w-[95%] rounded-2xl border px-4 py-3 text-sm ${
                    msg.role === "user"
                      ? "ml-auto border-[color:var(--cp-primary)]/55 bg-[color:var(--cp-primary)] text-white"
                      : msg.role === "system"
                        ? "border-[color:var(--cp-danger)]/45 bg-[color:color-mix(in_srgb,var(--cp-danger)_10%,white_90%)]"
                        : "border-[color:var(--cp-line)] bg-white"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <Markdown
                      content={
                        showRawOutput
                          ? msg.content
                          : displayTextForMessage(msg.content, Boolean(msg.isStreaming))
                      }
                    />
                  ) : (
                    msg.content
                  )}
                  <div
                    className={`mt-1 text-[10px] ${
                      msg.role === "user" ? "text-white/60" : "text-[color:var(--cp-muted)]"
                    }`}
                  >
                    {formatTimestamp(msg.timestamp)}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
          {isThinking && <ThinkingIndicator />}
        </div>

        <CareBaseGuard
          open={guardOpen}
          request={guardRequest}
          onAllow={() => resolveGuard("allow")}
          onDeny={() => resolveGuard("deny")}
          onAlwaysAllow={() => resolveGuard("always")}
        />

        {/* Input area */}
        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant={mode === "document" ? "default" : "outline"}
            size="sm"
            icon={<FileUp className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setMode(mode === "document" ? "type" : "document")}
            aria-label={mode === "document" ? "Close document upload" : "Upload a document"}
            className="shrink-0"
          >
            Document
          </Button>
          <VoiceInputButton
            sessionKey={sessionKey}
            onTranscript={(text) => {
              setInput(text);
              setMode("type");
            }}
            showStatusText={false}
            onStatusChange={(payload) => setVoiceStatus(payload)}
          />
          <textarea
            ref={textareaRef}
            placeholder={mode === "type" ? "Ask CarePilot..." : "Compose from transcript or extracted report..."}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            className="chat-input flex-1 resize-none rounded-2xl border border-[color:var(--cp-line)] bg-white/75 px-4 py-2.5 text-sm text-[color:var(--cp-text)] placeholder:text-[color:var(--cp-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cp-primary)] focus-visible:ring-offset-2"
            aria-label="Chat message input"
          />
          <Button
            onClick={handleSend}
            disabled={pending}
            loading={pending}
            size="icon"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        {voiceStatus?.message && (
          <p
            className={`text-xs ${
              voiceStatus.isError
                ? "text-[color:var(--cp-danger)]"
                : "text-[color:var(--cp-muted)]"
            }`}
          >
            {voiceStatus.message}
          </p>
        )}

        {mode === "document" && (
          <DocumentUploadFlow
            sessionKey={sessionKey}
            onComplete={(result: DocumentUploadResult) => {
              appendMessage({
                role: "user",
                content: `Uploaded ${result.docType}: ${result.fileName}`,
              });
              appendMessage({ role: "assistant", content: result.messageForChat });
              setMode("type");
            }}
          />
        )}
      </Card>

      <ActionConfirmModal
        plan={actionPlan}
        open={Boolean(actionPlan)}
        onClose={() => setActionPlan(null)}
        onConfirm={handleExecute}
        pending={actionPending}
      />
    </div>
  );
}
