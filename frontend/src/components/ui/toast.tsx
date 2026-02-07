"use client";

import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle, AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "warning" | "error";

export type ToastMessage = {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
};

type ToastContextValue = {
  push: (message: Omit<ToastMessage, "id">) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const noopToast: ToastContextValue = { push: () => {} };

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    if (process.env.NODE_ENV === "development") {
      console.warn("useToast called outside ToastProvider — toasts will be silent");
    }
    return noopToast;
  }
  return context;
}

const variantConfig: Record<
  ToastVariant,
  { icon: typeof Info; borderClass: string; iconClass: string }
> = {
  info: {
    icon: Info,
    borderClass: "border-[color:var(--cp-info)]/30",
    iconClass: "text-[color:var(--cp-info)]",
  },
  success: {
    icon: CheckCircle,
    borderClass: "border-[color:var(--cp-success)]/30",
    iconClass: "text-[color:var(--cp-success)]",
  },
  warning: {
    icon: AlertTriangle,
    borderClass: "border-[color:var(--cp-warn)]/30",
    iconClass: "text-[color:var(--cp-warn)]",
  },
  error: {
    icon: XCircle,
    borderClass: "border-[color:var(--cp-danger)]/30",
    iconClass: "text-[color:var(--cp-danger)]",
  },
};

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
        {messages.map((msg) => {
          const variant = msg.variant ?? "info";
          const config = variantConfig[variant];
          const Icon = config.icon;
          return (
            <ToastPrimitive.Root
              key={msg.id}
              duration={5000}
              onOpenChange={(open) => {
                if (!open) remove(msg.id);
              }}
              className={cn(
                "w-[min(380px,calc(100vw-2rem))] rounded-2xl border",
                config.borderClass,
                "bg-[color:var(--cp-surface)] px-4 py-3 shadow-[0_22px_45px_rgba(34,24,12,0.24)]",
                "animate-slide-up"
              )}
            >
              <div className="flex items-start gap-3">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", config.iconClass)} aria-hidden="true" />
                <div className="flex-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--cp-primary)]">
                    {msg.title}
                  </div>
                  {msg.description && (
                    <div className="mt-1 text-sm text-[color:var(--cp-muted)]">
                      {msg.description}
                    </div>
                  )}
                </div>
              </div>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}
