"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import styles from "./AgentChat.module.css";
import DataflowGuard, {
  type DataflowRequest,
} from "../DataflowGuard/DataflowGuard";
import {
  processCareBaseText,
  type AccessDecision,
} from "../../lib/carebase/engine";
import { CareBaseDecryptError } from "../../lib/carebase/errors";
import { listRecords } from "../../lib/carebase/database";

interface ChatMessage {
  role: "user" | "assistant" | "carebase";
  content: string;
}

const DEFAULT_MESSAGES: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "Hello! I can help test CareBase command parsing. Try asking me to store a value.",
  },
];

const MAX_PIPELINE_STEPS = 5;

export default function AgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(DEFAULT_MESSAGES);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardRequest, setGuardRequest] = useState<DataflowRequest | null>(null);
  const [guardOpen, setGuardOpen] = useState(false);
  const decisionRef = useRef<((decision: AccessDecision) => void) | null>(null);

  const canSend = useMemo(
    () => input.trim().length > 0 && !loading,
    [input, loading]
  );

  const requestDecision = useCallback((request: DataflowRequest) => {
    return new Promise<AccessDecision>((resolve) => {
      decisionRef.current = resolve;
      setGuardRequest(request);
      setGuardOpen(true);
    });
  }, []);

  const closeGuard = useCallback(() => {
    setGuardOpen(false);
    setGuardRequest(null);
  }, []);

  const resolveGuard = useCallback(
    (decision: AccessDecision) => {
      decisionRef.current?.(decision);
      decisionRef.current = null;
      closeGuard();
    },
    [closeGuard]
  );

  const sendMessage = useCallback(async () => {
    if (!canSend) {
      return;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: input.trim() },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      let workingMessages = nextMessages;

      for (let step = 0; step < MAX_PIPELINE_STEPS; step += 1) {
        const storedKeys = await listRecords();
        const keyList = storedKeys.map((record) => record.key).join(", ");
        const systemPrompt = [
          "CareBase Context:",
          `Current datetime: ${new Date().toISOString()}.`,
          `Stored entry keys: ${keyList.length ? keyList : "none"}.`,
          "When storing times/dates, always use absolute timestamps (e.g., 2026-02-07 13:45 UTC).",
          "Never store relative time expressions like 'yesterday' or 'last week'.",
        ].join("\n");

        const response = await fetch("/api/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            system: systemPrompt,
            messages: workingMessages.map((message) => ({
              role: message.role === "assistant" ? "assistant" : "user",
              content:
                message.role === "carebase"
                  ? `CareBase Result:\n${message.content}`
                  : message.content,
            })),
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error ?? "Agent request failed.");
        }

        const payload = (await response.json()) as { reply: string };
        if (!payload.reply || payload.reply.trim().length === 0) {
          break;
        }

        workingMessages = [
          ...workingMessages,
          {
            role: "assistant",
            content: payload.reply,
          },
        ];

        const carebaseResult = await processCareBaseText(payload.reply, {
          context: workingMessages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
          requestAccess: requestDecision,
        });

        if (carebaseResult.responses.length === 0) {
          break;
        }

        const carebaseText = carebaseResult.responses.join("\n");
        workingMessages = [
          ...workingMessages,
          { role: "carebase", content: carebaseText },
        ];
      }

      setMessages(workingMessages);
    } catch (err) {
      const message =
        err instanceof CareBaseDecryptError
          ? "Failed to decrypt record. Check the master key."
          : err instanceof Error
            ? err.message
            : "Unknown error.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [canSend, input, messages, requestDecision]);

  return (
    <div className={styles.chat}>
      <div className={styles.messages}>
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={styles.message}>
            <strong>{message.role}</strong>
            {message.content}
          </div>
        ))}
      </div>
      <div className={styles.controls}>
        <input
          className={styles.input}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the agent to store or fetch data..."
        />
        <button
          className={styles.send}
          onClick={sendMessage}
          disabled={!canSend}
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>
      <div className={styles.status}>
        {error
          ? `Error: ${error}`
          : "Claude API test agent (requires ANTHROPIC_API_KEY)."}
      </div>
      <DataflowGuard
        open={guardOpen}
        request={guardRequest}
        onAllow={() => resolveGuard("allow")}
        onDeny={() => resolveGuard("deny")}
        onAlwaysAllow={() => resolveGuard("always")}
      />
    </div>
  );
}
