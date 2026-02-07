import { create } from "zustand";
import type { ActionPlan, ActionResult } from "@/lib/types";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatState = {
  messages: ChatMessage[];
  actionPlan: ActionPlan | null;
  actionResult: ActionResult | null;
  appendMessage: (message: ChatMessage) => void;
  appendAssistantDelta: (delta: string) => void;
  setActionPlan: (plan: ActionPlan | null) => void;
  setActionResult: (result: ActionResult | null) => void;
  clear: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  actionPlan: null,
  actionResult: null,
  appendMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  appendAssistantDelta: (delta) =>
    set((state) => {
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") {
        return {
          messages: [...state.messages, { role: "assistant", content: delta }]
        };
      }
      return {
        messages: [
          ...state.messages.slice(0, -1),
          { ...last, content: last.content + delta }
        ]
      };
    }),
  setActionPlan: (plan) => set({ actionPlan: plan }),
  setActionResult: (result) => set({ actionResult: result }),
  clear: () => set({ messages: [], actionPlan: null, actionResult: null })
}));
