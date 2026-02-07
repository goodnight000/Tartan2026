"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Plus, Upload, X, Paperclip, ArrowDown, RotateCcw } from "lucide-react";
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
import { useChatStore, type ChatMessage } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { ActionPlan, ActionResult, TriageLevel } from "@/lib/types";
import { auth } from "@/lib/firebase";
import { addActionLog } from "@/lib/firestore";

const LOCATION_STORAGE_KEY = "carepilot.location_text";
const ATTACHMENT_POPOVER_ID = "chat-attachment-options";
const STREAM_RETRY_DELAYS_MS = [300, 1200];
const LONG_WAIT_MS = 12000;
const HARD_PENDING_TIMEOUT_MS = 45000;
const SCROLL_NEAR_BOTTOM_THRESHOLD_PX = 120;

type RunState =
  | "idle"
  | "connecting"
  | "streaming"
  | "reconnecting"
  | "delayed"
  | "error"
  | "canceled";

type RequestPayload = {
  content: string;
  historyForRequest: Array<Pick<ChatMessage, "role" | "content">>;
};

const EMERGENCY_KEYWORDS = [
  "call 911", "emergency room", "go to the er", "chest pain",
  "difficulty breathing", "severe bleeding", "stroke", "unconscious",
  "anaphylaxis", "overdose", "suicidal",
];

function inferTriageFromContent(text: string): TriageLevel | null {
  const lower = text.toLowerCase();
  if (EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw))) return "EMERGENT";
  const explicitlyNotUrgent = /\b(?:not|non)[ -]?urgent\b/.test(lower);
  if (!explicitlyNotUrgent && (lower.includes("within 24 hours") || /\burgent\b/.test(lower) || lower.includes("see a doctor soon"))) {
    return "URGENT_24H";
  }
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
  const [runState, setRunState] = useState<RunState>("idle");
  const [runStatusText, setRunStatusText] = useState("");
  const [streamErrorText, setStreamErrorText] = useState("");
  const [assistiveStatusText, setAssistiveStatusText] = useState("");
  const [retryPayload, setRetryPayload] = useState<RequestPayload | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
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
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<RequestPayload | null>(null);
  const retryAfterAbortRef = useRef<RequestPayload | null>(null);
  const timedOutAbortRef = useRef(false);
  const shouldAutoscrollRef = useRef(true);
  const longWaitTimerRef = useRef<number | null>(null);
  const hardPendingTimerRef = useRef<number | null>(null);
  const {
    messages,
    sessionKey,
    appendMessage,
    appendAssistantDelta,
    actionPlan,
    setActionPlan,
    setActionResult,
    finalizeStreaming,
    setThinking,
    triageLevel,
    setTriageLevel,
  } = useChatStore();

  const clearLongWaitTimer = () => {
    if (longWaitTimerRef.current === null) return;
    window.clearTimeout(longWaitTimerRef.current);
    longWaitTimerRef.current = null;
  };

  const clearHardPendingTimer = () => {
    if (hardPendingTimerRef.current === null) return;
    window.clearTimeout(hardPendingTimerRef.current);
    hardPendingTimerRef.current = null;
  };

  const scheduleLongWaitEscalation = () => {
    clearLongWaitTimer();
    longWaitTimerRef.current = window.setTimeout(() => {
      if (!streamAbortRef.current) return;
      setRunState((current) => {
        if (current === "connecting" || current === "streaming" || current === "reconnecting") {
          return "delayed";
        }
        return current;
      });
      setRunStatusText("This response is taking longer than usual.");
    }, LONG_WAIT_MS);
  };

  const isNearBottom = (el: HTMLDivElement) =>
    el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_NEAR_BOTTOM_THRESHOLD_PX;

  const scrollToLatest = (behavior: ScrollBehavior = "smooth") => {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    shouldAutoscrollRef.current = true;
    setShowJumpToLatest(false);
  };

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const nearBottom = isNearBottom(el);
    shouldAutoscrollRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
  };

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_NEAR_BOTTOM_THRESHOLD_PX;
    if (shouldAutoscrollRef.current || nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: messages.length > 1 ? "smooth" : "auto" });
      shouldAutoscrollRef.current = true;
      setShowJumpToLatest(false);
      return;
    }
    setShowJumpToLatest(true);
  }, [messages, runState]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [input]);

  // Sync browser-restored textarea value (after refresh/back) into React state.
  useEffect(() => {
    const syncRestoredValue = () => {
      const restored = textareaRef.current?.value ?? "";
      if (!restored.trim()) return;
      setInput((current) => (current.trim().length > 0 ? current : restored));
    };
    syncRestoredValue();
    const rafId = window.requestAnimationFrame(syncRestoredValue);
    window.addEventListener("pageshow", syncRestoredValue);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("pageshow", syncRestoredValue);
    };
  }, []);

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

  useEffect(
    () => () => {
      if (longWaitTimerRef.current !== null) {
        window.clearTimeout(longWaitTimerRef.current);
        longWaitTimerRef.current = null;
      }
      if (hardPendingTimerRef.current !== null) {
        window.clearTimeout(hardPendingTimerRef.current);
        hardPendingTimerRef.current = null;
      }
      streamAbortRef.current?.abort();
    },
    []
  );

  const isAbortError = (error: unknown) =>
    (error instanceof Error && error.name === "AbortError") ||
    Boolean(streamAbortRef.current?.signal.aborted);

  const waitForRetryDelay = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
        return;
      }
      const timeoutId = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const isRetryableStreamError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    if (error.name === "AbortError") return false;
    const statusMatch = error.message.match(/Failed to open SSE stream \((\d{3})\b/);
    if (statusMatch) {
      const status = Number.parseInt(statusMatch[1], 10);
      return status === 404 || status === 503 || status >= 500;
    }
    return /network|fetch|connection|stream/i.test(error.message);
  };

  const runChatRequest = async (request: RequestPayload) => {
    setPending(true);
    setThinking(true);
    setRunState("connecting");
    setRunStatusText("Connecting to CarePilot...");
    setAssistiveStatusText("Sending your message to CarePilot.");
    setStreamErrorText("");
    setRetryPayload(null);
    activeRequestRef.current = request;
    scheduleLongWaitEscalation();

    const controller = new AbortController();
    streamAbortRef.current = controller;
    clearHardPendingTimer();
    hardPendingTimerRef.current = window.setTimeout(() => {
      if (streamAbortRef.current !== controller || controller.signal.aborted) return;
      timedOutAbortRef.current = true;
      retryAfterAbortRef.current = null;
      controller.abort();
    }, HARD_PENDING_TIMEOUT_MS);

    try {
      let idToken: string | undefined;
      const user = auth.currentUser;
      if (user) {
        try { idToken = await user.getIdToken(); } catch { /* noop */ }
      }

      const requestBody = JSON.stringify({
        message: request.content,
        session_key: sessionKey,
        history: request.historyForRequest.map((msg) => ({ role: msg.role, content: msg.content })),
        idToken,
      });
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const locationFromMessage = inferLocationHint(request.content);
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
          signal: controller.signal,
        });

      let sawToken = false;
      let fullContent = "";
      let attempt = 0;

      while (attempt <= STREAM_RETRY_DELAYS_MS.length) {
        try {
          if (attempt > 0) {
            setRunState("reconnecting");
            setRunStatusText(
              `Connection interrupted. Reconnecting (${attempt}/${STREAM_RETRY_DELAYS_MS.length})...`
            );
          }

          const response = await openStream();
          if (
            !response.ok &&
            (response.status === 404 || response.status === 503 || response.status >= 500) &&
            !sawToken &&
            attempt < STREAM_RETRY_DELAYS_MS.length
          ) {
            attempt += 1;
            await waitForRetryDelay(STREAM_RETRY_DELAYS_MS[attempt - 1], controller.signal);
            continue;
          }

          setRunState("streaming");
          setRunStatusText("CarePilot is responding...");
          await consumeSSE(
            response,
            (event) => {
              if (event.event === "token") {
                const delta =
                  typeof event.data === "string"
                    ? event.data
                    : (event.data as { delta?: string }).delta ?? "";
                if (!delta) return;
                if (!sawToken) {
                  setAssistiveStatusText("CarePilot started responding.");
                }
                sawToken = true;
                fullContent += delta;
                clearLongWaitTimer();
                appendAssistantDelta(delta);
                setRunState("streaming");
                setRunStatusText("CarePilot is responding...");
                return;
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
                  setAssistiveStatusText("CarePilot response is ready.");
                }
                clearLongWaitTimer();
                setThinking(false);
                return;
              }
              if (event.event === "action_plan") {
                setActionPlan(event.data as ActionPlan);
                return;
              }
              if (event.event === "error") {
                const message = (event.data as { message?: string }).message ?? "Unexpected error.";
                throw new Error(message);
              }
            },
            { signal: controller.signal }
          );
          break;
        } catch (error) {
          if (
            !controller.signal.aborted &&
            !sawToken &&
            attempt < STREAM_RETRY_DELAYS_MS.length &&
            isRetryableStreamError(error)
          ) {
            attempt += 1;
            await waitForRetryDelay(STREAM_RETRY_DELAYS_MS[attempt - 1], controller.signal);
            continue;
          }
          throw error;
        }
      }

      if (fullContent) {
        const inferred = inferTriageFromContent(fullContent);
        if (inferred) setTriageLevel(inferred);
      }

      setRunState("idle");
      setRunStatusText("");
      setStreamErrorText("");
      setAssistiveStatusText("CarePilot response is ready.");
    } catch (error) {
      const failedRequest = activeRequestRef.current;
      if ((isAbortError(error) || controller.signal.aborted) && timedOutAbortRef.current) {
        const message = `Request timed out after ${Math.round(HARD_PENDING_TIMEOUT_MS / 1000)} seconds.`;
        timedOutAbortRef.current = false;
        setRunState("error");
        setRunStatusText("Connection timed out.");
        setStreamErrorText(message);
        setAssistiveStatusText(message);
        setInput((current) => {
          if (current.trim().length > 0) return current;
          return failedRequest?.content ?? current;
        });
        if (failedRequest) setRetryPayload(failedRequest);
      } else if (isAbortError(error) || controller.signal.aborted) {
        if (retryAfterAbortRef.current) {
          setRunState("reconnecting");
          setRunStatusText("Retrying your last message...");
          setAssistiveStatusText("Retrying your last request.");
        } else {
          setRunState("canceled");
          setRunStatusText("Response canceled.");
          setAssistiveStatusText("Response canceled.");
          if (failedRequest) setRetryPayload(failedRequest);
        }
      } else {
        const message = error instanceof Error ? error.message : "Unexpected connection error.";
        appendMessage({ role: "system", content: `Connection error: ${message}` });
        push({ title: "Chat Error", description: message, variant: "error" });
        setRunState("error");
        setRunStatusText("Connection failed.");
        setStreamErrorText(message);
        setAssistiveStatusText(`Connection failed: ${message}`);
        setInput((current) => {
          if (current.trim().length > 0) return current;
          return failedRequest?.content ?? current;
        });
        if (failedRequest) setRetryPayload(failedRequest);
      }
    } finally {
      clearLongWaitTimer();
      clearHardPendingTimer();
      finalizeStreaming();
      setThinking(false);
      setPending(false);
      timedOutAbortRef.current = false;
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null;
      }
      const queuedRetry = retryAfterAbortRef.current;
      retryAfterAbortRef.current = null;
      activeRequestRef.current = null;
      if (queuedRetry) {
        shouldAutoscrollRef.current = true;
        void runChatRequest(queuedRetry);
      }
    }
  };

  const handleSend = async () => {
    const draft = input.trim().length > 0 ? input : (textareaRef.current?.value ?? "");
    if (!draft.trim()) return;
    setAttachmentMenuOpen(false);
    const content = draft.trim();
    const priorMessages = useChatStore.getState().messages;
    const historyForRequest = [...priorMessages, { role: "user" as const, content }];
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.value = "";
    }
    appendMessage({ role: "user", content });
    shouldAutoscrollRef.current = true;
    if (pending && activeRequestRef.current) {
      retryAfterAbortRef.current = { content, historyForRequest };
      streamAbortRef.current?.abort();
      return;
    }
    await runChatRequest({ content, historyForRequest });
  };

  const handleCancelStream = () => {
    retryAfterAbortRef.current = null;
    streamAbortRef.current?.abort();
  };

  const handleRetryLast = () => {
    if (!retryPayload || pending) return;
    shouldAutoscrollRef.current = true;
    void runChatRequest(retryPayload);
  };

  const handleRetryCurrent = () => {
    if (pending && activeRequestRef.current) {
      retryAfterAbortRef.current = activeRequestRef.current;
      streamAbortRef.current?.abort();
      return;
    }
    handleRetryLast();
  };

  const isStreamActive =
    runState === "connecting" ||
    runState === "streaming" ||
    runState === "reconnecting" ||
    runState === "delayed";

  const statusTextForIndicator = runState === "error" ? streamErrorText : runStatusText;

  const handleJumpToLatest = () => {
    scrollToLatest("smooth");
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
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {assistiveStatusText}
        </p>
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
        <div className="relative">
          <div
            ref={chatContainerRef}
            onScroll={handleChatScroll}
            className="min-h-[56vh] max-h-[72vh] space-y-3 overflow-y-auto rounded-2xl border border-[color:var(--cp-line)] bg-[color:var(--cp-surface)]/70 p-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-atomic="false"
            aria-busy={isStreamActive || undefined}
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
                    aria-live={msg.isStreaming ? "off" : undefined}
                    className={`max-w-[95%] whitespace-pre-wrap break-words rounded-2xl border px-4 py-3 text-sm ${
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
          </div>
          {showJumpToLatest && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="pointer-events-auto"
                onClick={handleJumpToLatest}
                aria-label="Jump to latest message"
                icon={<ArrowDown className="h-3.5 w-3.5" />}
              >
                Jump to latest
              </Button>
            </div>
          )}
        </div>
        {isStreamActive && (
          <ThinkingIndicator
            state={
              runState === "delayed"
                ? "delayed"
                : runState === "reconnecting"
                  ? "reconnecting"
                  : runState === "connecting"
                    ? "connecting"
                    : "streaming"
            }
            statusText={statusTextForIndicator}
            onCancel={handleCancelStream}
            onRetry={runState === "delayed" ? handleRetryCurrent : undefined}
          />
        )}

        {runState === "error" && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[color:var(--cp-danger)]/45 bg-[color:color-mix(in_srgb,var(--cp-danger)_10%,white_90%)] p-3 text-sm text-[color:var(--cp-danger)]"
            role="alert"
          >
            <span>{streamErrorText || "Chat stream failed."}</span>
            {retryPayload && (
              <Button type="button" variant="danger" size="sm" onClick={handleRetryLast} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                Retry
              </Button>
            )}
          </div>
        )}

        {runState === "canceled" && (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/72 p-3 text-sm text-[color:var(--cp-text)]"
            role="status"
          >
            <span>Response canceled.</span>
            {retryPayload && (
              <Button type="button" variant="outline" size="sm" onClick={handleRetryLast} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                Retry
              </Button>
            )}
          </div>
        )}

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
        <div className="space-y-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/80 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
              className="chat-textarea min-h-[44px] w-full flex-1 resize-none rounded-2xl border border-[color:var(--cp-line)] bg-white/80 px-4 py-3 text-sm text-[color:var(--cp-text)] placeholder:text-[color:var(--cp-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cp-primary)] focus-visible:ring-offset-2 sm:min-h-[48px]"
              aria-label="Chat message input"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
              <div ref={attachmentAreaRef} className="relative">
                <Button
                  type="button"
                  size="icon"
                  variant={attachmentMenuOpen ? "outline" : "ghost"}
                  onClick={() => setAttachmentMenuOpen((open) => !open)}
                  aria-haspopup="true"
                  aria-expanded={attachmentMenuOpen}
                  aria-controls={attachmentMenuOpen ? ATTACHMENT_POPOVER_ID : undefined}
                  aria-label="Add attachment"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
                {attachmentMenuOpen && (
                  <div
                    id={ATTACHMENT_POPOVER_ID}
                    className="absolute bottom-12 left-0 z-20 w-48 rounded-xl border border-[color:var(--cp-line)] bg-white p-1 shadow-xl"
                  >
                    <button
                      type="button"
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
              {pending && (
                <Button
                  type="button"
                  onClick={handleCancelStream}
                  variant="ghost"
                  size="icon"
                  aria-label="Cancel response"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                onClick={handleSend}
                disabled={!input.trim()}
                loading={pending && runState === "connecting"}
                size="icon"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
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
