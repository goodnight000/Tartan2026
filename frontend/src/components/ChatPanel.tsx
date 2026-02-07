"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Mic, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActionConfirmModal } from "@/components/ActionConfirmModal";
import { Markdown } from "@/components/Markdown";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { TriageBadge } from "@/components/TriageBadge";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { DocumentUploadFlow } from "@/components/DocumentUploadFlow";
import type { DocumentUploadResult } from "@/components/DocumentUploadFlow";
import { consumeSSE } from "@/lib/sse";
import { useChatStore } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { ActionPlan, ActionResult, TriageLevel } from "@/lib/types";
import { auth } from "@/lib/firebase";
import { addActionLog } from "@/lib/firestore";

const LOCATION_STORAGE_KEY = "carepilot.location_text";

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

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [mode, setMode] = useState<"type" | "voice" | "document">("type");
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

  const modeHint = useMemo(() => {
    if (mode === "voice") return "Voice capture will transcribe to editable text before send.";
    if (mode === "document") return "Upload lab or imaging reports for extraction and plain-language interpretation.";
    return "Ask a question, report symptoms, or request a care coordination action.";
  }, [mode]);

  const handleSend = async () => {
    if (!input.trim() || pending) return;
    const content = input.trim();
    const priorMessages = useChatStore.getState().messages;
    const historyForRequest = [...priorMessages, { role: "user" as const, content }];
    setInput("");
    appendMessage({ role: "user", content });
    setPending(true);
    setThinking(true);
    try {
      let idToken: string | undefined;
      const user = auth.currentUser;
      if (user) {
        try { idToken = await user.getIdToken(); } catch { /* noop */ }
      }

      const requestBody = JSON.stringify({
        message: content,
        session_key: sessionKey,
        history: historyForRequest.map((msg) => ({ role: msg.role, content: msg.content })),
        idToken,
      });
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const locationFromMessage = inferLocationHint(content);
      if (locationFromMessage && typeof window !== "undefined") {
        window.localStorage.setItem(LOCATION_STORAGE_KEY, locationFromMessage);
      }
      const persistedLocation =
        typeof window !== "undefined" ? window.localStorage.getItem(LOCATION_STORAGE_KEY) : null;
      const openStream = async () =>
        fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-timezone": timezone,
            ...(persistedLocation ? { "x-location-text": persistedLocation } : {}),
          },
          body: requestBody,
        });

      let response = await openStream();
      if (!response.ok && (response.status === 404 || response.status === 503)) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        response = await openStream();
      }

      let sawToken = false;
      let fullContent = "";
      await consumeSSE(response, (event) => {
        if (event.event === "token") {
          const delta =
            typeof event.data === "string"
              ? event.data
              : (event.data as { delta?: string }).delta ?? "";
          sawToken = true;
          fullContent += delta;
          appendAssistantDelta(delta);
        }
        if (event.event === "message") {
          if (sawToken) return;
          const text =
            typeof event.data === "string"
              ? event.data
              : (event.data as { text?: string }).text;
          if (text) {
            fullContent = text;
            appendMessage({ role: "assistant", content: text });
          }
          setThinking(false);
        }
        if (event.event === "action_plan") {
          setActionPlan(event.data as ActionPlan);
        }
        if (event.event === "error") {
          const message = (event.data as { message?: string }).message ?? "Unexpected error.";
          appendMessage({ role: "system", content: message });
          setThinking(false);
        }
      });

      if (fullContent) {
        const inferred = inferTriageFromContent(fullContent);
        if (inferred) setTriageLevel(inferred);
      }
    } catch (error) {
      appendMessage({ role: "system", content: `Connection error: ${(error as Error).message}` });
      push({ title: "Chat Error", description: (error as Error).message, variant: "error" });
    } finally {
      finalizeStreaming();
      setThinking(false);
      setPending(false);
    }
  };

  const handleExecute = async () => {
    if (!actionPlan || actionPending) return;
    setActionPending(true);
    try {
      let idToken: string | undefined;
      const user = auth.currentUser;
      if (user) {
        try { idToken = await user.getIdToken(); } catch { /* noop */ }
      }
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
      if (auth.currentUser) {
        await addActionLog(auth.currentUser.uid, {
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
            {triageLevel && <TriageBadge level={triageLevel} />}
            {!triageLevel && <span className="status-chip status-chip--info">Triage Active</span>}
          </div>
        </div>

        {/* Mode selector */}
        <div className="rounded-2xl border border-[color:var(--cp-line)] bg-white/70 p-2">
          <div className="grid grid-cols-3 gap-2">
            {([
              ["type", "Type", null],
              ["voice", "Voice", <Mic key="mic" className="h-3.5 w-3.5" />],
              ["document", "Document", <FileUp key="doc" className="h-3.5 w-3.5" />],
            ] as const).map(([value, label, icon]) => (
              <Button
                key={value}
                type="button"
                variant={mode === value ? "default" : "ghost"}
                size="sm"
                icon={icon}
                onClick={() => setMode(value)}
                aria-label={`${label} input mode`}
              >
                {label}
              </Button>
            ))}
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
          className="max-h-[56vh] space-y-3 overflow-y-auto rounded-2xl border border-[color:var(--cp-line)] bg-[color:var(--cp-surface)]/70 p-3"
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
              {messages.map((msg) => (
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
                  {msg.role === "assistant" ? <Markdown content={msg.content} /> : msg.content}
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

        {/* Input area */}
        {mode === "voice" && (
          <div className="flex items-center gap-3">
            <VoiceInputButton
              sessionKey={sessionKey}
              onTranscript={(text) => {
                setInput(text);
                setMode("type");
              }}
            />
            <span className="text-xs text-[color:var(--cp-muted)]">Tap mic, speak, then edit before sending</span>
          </div>
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

        <div className="flex gap-2">
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
            className="flex-1 resize-none rounded-2xl border border-[color:var(--cp-line)] bg-white/75 px-4 py-2.5 text-sm text-[color:var(--cp-text)] placeholder:text-[color:var(--cp-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cp-primary)] focus-visible:ring-offset-2"
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
