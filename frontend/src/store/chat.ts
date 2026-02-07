import { create } from "zustand";
import type { ActionPlan, ActionResult, TriageLevel } from "@/lib/types";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  triageLevel?: TriageLevel;
  isStreaming?: boolean;
};

type ChatState = {
  messages: ChatMessage[];
  sessionKey: string;
  actionPlan: ActionPlan | null;
  actionResult: ActionResult | null;
  isThinking: boolean;
  triageLevel: TriageLevel | null;
  appendMessage: (message: Omit<ChatMessage, "id" | "timestamp">) => void;
  appendAssistantDelta: (delta: string) => void;
  finalizeStreaming: () => void;
  setActionPlan: (plan: ActionPlan | null) => void;
  setActionResult: (result: ActionResult | null) => void;
  setThinking: (v: boolean) => void;
  setTriageLevel: (level: TriageLevel | null) => void;
  clear: () => void;
};

const SESSION_KEY_STORAGE = "carepilot.session_key";

function newId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function newSessionKey(): string {
  return `session-${newId()}`;
}

function loadOrCreateSessionKey(): string {
  if (typeof window === "undefined") return newSessionKey();
  const existing = window.localStorage.getItem(SESSION_KEY_STORAGE);
  if (existing && existing.trim()) return existing;
  const created = newSessionKey();
  window.localStorage.setItem(SESSION_KEY_STORAGE, created);
  return created;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionKey: loadOrCreateSessionKey(),
  actionPlan: null,
  actionResult: null,
  isThinking: false,
  triageLevel: null,
  appendMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...message, id: newId(), timestamp: Date.now() },
      ],
    })),
  appendAssistantDelta: (delta) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") {
        return {
          isThinking: false,
          messages: [
            ...state.messages,
            {
              id: newId(),
              role: "assistant" as const,
              content: delta,
              timestamp: Date.now(),
              isStreaming: true,
            },
          ],
        };
      }
      return {
        isThinking: false,
        messages: [
          ...state.messages.slice(0, -1),
          { ...last, content: last.content + delta, isStreaming: true },
        ],
      };
    }),
  finalizeStreaming: () =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || !last.isStreaming) return state;
      return {
        messages: [
          ...state.messages.slice(0, -1),
          { ...last, isStreaming: false },
        ],
      };
    }),
  setActionPlan: (plan) => set({ actionPlan: plan }),
  setActionResult: (result) => set({ actionResult: result }),
  setThinking: (v) => set({ isThinking: v }),
  setTriageLevel: (level) => set({ triageLevel: level }),
  clear: () =>
    set({
      messages: [],
      actionPlan: null,
      actionResult: null,
      isThinking: false,
      triageLevel: null,
    }),
}));
