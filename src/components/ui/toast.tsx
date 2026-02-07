"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cn } from "@/lib/utils";

export type ToastMessage = {
  id: string;
  title: string;
  description?: string;
};

type ToastContextValue = {
  push: (message: Omit<ToastMessage, "id">) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);

  const push = (message: Omit<ToastMessage, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setMessages((prev) => [...prev, { id, ...message }]);
  };

  const remove = (id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  };

  return (
    <ToastContext.Provider value={{ push }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {messages.map((msg) => (
          <ToastPrimitive.Root
            key={msg.id}
            duration={5000}
            onOpenChange={(open) => {
              if (!open) remove(msg.id);
            }}
            className={cn(
              "glass rounded-xl border border-slate-200 px-4 py-3 shadow-lg"
            )}
          >
            <div className="text-sm font-semibold text-slate-800">
              {msg.title}
            </div>
            {msg.description && (
              <div className="text-xs text-slate-600">{msg.description}</div>
            )}
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
