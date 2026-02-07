"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionConfirmModal } from "@/components/ActionConfirmModal";
import { Markdown } from "@/components/Markdown";
import { consumeSSE } from "@/lib/sse";
import { useChatStore } from "@/store/chat";
import { useToast } from "@/components/ui/toast";
import type { ActionPlan, ActionResult } from "@/lib/types";
import { auth } from "@/lib/firebase";
import { addActionLog } from "@/lib/firestore";

function formatActionResult(tool: string, data: ActionResult): string {
  if (data.status === "failure") {
    return `The action failed: ${data.result?.message ?? "Unknown error"}`;
  }
  const r = data.result;
  if (r?.confirmation_id) {
    return `Booking confirmed! Confirmation ID: **${r.confirmation_id}**. ${r.summary ?? ""}`;
  }
  if (Array.isArray(r?.items)) {
    const items = r.items as Array<Record<string, unknown>>;
    if (items.length === 0) return `No results found for ${tool}.`;
    const lines = items.map(
      (it, i) =>
        `${i + 1}. **${it.name ?? "Unknown"}** — ${it.address ?? "No address"}`
    );
    return `Found ${items.length} result(s):\n\n${lines.join("\n")}`;
  }
  return `Action completed: ${JSON.stringify(r)}`;
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const { push } = useToast();
  const {
    messages,
    appendMessage,
    appendAssistantDelta,
    actionPlan,
    setActionPlan,
    setActionResult
  } = useChatStore();

  const handleSend = async () => {
    if (!input.trim() || pending) return;
    const content = input.trim();
    setInput("");
    appendMessage({ role: "user", content });
    setPending(true);
    try {
      // Get Firebase ID token for server-side auth
      let idToken: string | undefined;
      const user = auth.currentUser;
      if (user) {
        try {
          idToken = await user.getIdToken();
        } catch {
          // Continue without token
        }
      }

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: messages.map((msg) => ({
            role: msg.role,
            content: msg.content
          })),
          idToken
        })
      });

      await consumeSSE(response, (event) => {
        if (event.event === "token") {
          const delta =
            typeof event.data === "string"
              ? event.data
              : (event.data as { delta?: string }).delta ?? "";
          appendAssistantDelta(delta);
        }
        if (event.event === "message") {
          const text =
            typeof event.data === "string"
              ? event.data
              : (event.data as { text?: string }).text;
          if (text) {
            appendMessage({ role: "assistant", content: text });
          }
        }
        if (event.event === "action_plan") {
          setActionPlan(event.data as ActionPlan);
        }
        if (event.event === "error") {
          const message =
            (event.data as { message?: string }).message ??
            "Unexpected error.";
          appendMessage({ role: "system", content: message });
        }
      });
    } catch (error) {
      push({
        title: "Chat error",
        description: (error as Error).message
      });
    } finally {
      setPending(false);
    }
  };

  const handleExecute = async () => {
    if (!actionPlan) return;
    try {
      const res = await fetch("/api/actions/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: actionPlan,
          user_confirmed: true
        })
      });
      const data: ActionResult = await res.json();
      setActionResult(data);
      const resultText = formatActionResult(actionPlan.tool, data);
      appendMessage({ role: "assistant", content: resultText });
      const user = auth.currentUser;
      if (user) {
        await addActionLog(user.uid, {
          action_type: actionPlan.tool,
          status: data.status
        });
      }
    } catch (error) {
      push({ title: "Action failed", description: (error as Error).message });
    } finally {
      setActionPlan(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 max-h-[70vh] overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-500">
            Ask a medical question or share symptoms.
          </p>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`rounded-xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-ink text-white ml-auto"
                  : "bg-white border border-slate-200"
              }`}
            >
              {msg.role === "assistant" ? (
                <Markdown content={msg.content} />
              ) : (
                msg.content
              )}
            </div>
          ))
        )}
      </Card>
      <div className="flex gap-2">
        <Input
          placeholder="Ask MedClaw..."
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <Button onClick={handleSend} disabled={pending}>
          {pending ? "Sending" : "Send"}
        </Button>
      </div>

      <ActionConfirmModal
        plan={actionPlan}
        open={Boolean(actionPlan)}
        onClose={() => setActionPlan(null)}
        onConfirm={handleExecute}
      />
    </div>
  );
}
