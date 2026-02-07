"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Plus, Upload, X, Paperclip } from "lucide-react";
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
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<{ message: string; isError: boolean }>({
    message: "",
    isError: false,
  });
  const { push } = useToast();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentAreaRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!attachmentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (attachmentAreaRef.current?.contains(event.target as Node)) return;
      setAttachmentMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAttachmentMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [attachmentMenuOpen]);

  const handleSend = async () => {
    if (!input.trim() || pending) return;
    setAttachmentMenuOpen(false);
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
        <p className="text-sm text-[color:var(--cp-muted)]">
          Keep typing in one thread. Use <span className="font-semibold">+</span> to upload files and
          the microphone for voice-to-text.
        </p>

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

        {uploadPanelOpen && (
          <div className="space-y-3 rounded-2xl border border-[color:var(--cp-line)] bg-white/72 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-[color:var(--cp-text)]">
                <Paperclip className="h-4 w-4 text-[color:var(--cp-muted)]" aria-hidden="true" />
                <span className="font-semibold">Attach and Analyze File</span>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setUploadPanelOpen(false)}
                aria-label="Close upload panel"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-[color:var(--cp-muted)]">
              Upload first, then continue the same conversation with follow-up questions.
            </p>
            <DocumentUploadFlow
              sessionKey={sessionKey}
              onComplete={(result: DocumentUploadResult) => {
                appendMessage({
                  role: "user",
                  content: `Uploaded ${result.docType}: ${result.fileName}`,
                });
                appendMessage({ role: "assistant", content: result.messageForChat });
                setUploadPanelOpen(false);
                setInput((current) =>
                  current.trim()
                    ? current
                    : "Can you help me understand the most important findings from this file?"
                );
                push({
                  title: "File analyzed",
                  description: `${result.fileName} was added to this conversation.`,
                  variant: "success",
                });
              }}
            />
          </div>
        )}

        {/* Unified composer */}
        <div className="space-y-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/78 p-2">
          <div className="flex items-end gap-2">
            <div ref={attachmentAreaRef} className="relative shrink-0">
              <Button
                type="button"
                size="icon"
                variant={attachmentMenuOpen ? "outline" : "ghost"}
                onClick={() => setAttachmentMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={attachmentMenuOpen}
                aria-label="Add attachment"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
              {attachmentMenuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-12 left-0 z-20 w-56 rounded-xl border border-[color:var(--cp-line)] bg-white p-1 shadow-xl"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--cp-text)] hover:bg-[color:var(--cp-surface)]"
                    onClick={() => {
                      setUploadPanelOpen(true);
                      setAttachmentMenuOpen(false);
                    }}
                  >
                    <Upload className="h-4 w-4 text-[color:var(--cp-muted)]" aria-hidden="true" />
                    Upload medical file
                  </button>
                </div>
              )}
            </div>
            <textarea
              ref={textareaRef}
              placeholder="Ask CarePilot..."
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
            <VoiceInputButton
              className="shrink-0"
              sessionKey={sessionKey}
              showStatusText={false}
              onStatusChange={setVoiceStatus}
              onTranscript={(text) => {
                setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
                textareaRef.current?.focus();
              }}
            />
            <Button
              onClick={handleSend}
              disabled={pending || !input.trim()}
              loading={pending}
              size="icon"
              aria-label="Send message"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[color:var(--cp-muted)]">
            <span>Press Enter to send. Shift+Enter for a new line.</span>
            <span>Voice inserts editable text before send.</span>
          </div>
          {voiceStatus.message && (
            <p
              className={`px-1 text-xs ${
                voiceStatus.isError
                  ? "text-[color:var(--cp-danger)]"
                  : "text-[color:var(--cp-muted)]"
              }`}
              role={voiceStatus.isError ? "alert" : "status"}
            >
              {voiceStatus.message}
            </p>
          )}
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
