"use client";

import { motion } from "framer-motion";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type ThinkingState = "connecting" | "streaming" | "reconnecting" | "delayed";

type ThinkingIndicatorProps = {
  state?: ThinkingState;
  statusText?: string;
  onCancel?: () => void;
  onRetry?: () => void;
};

const DEFAULT_STATUS_TEXT: Record<ThinkingState, string> = {
  connecting: "Connecting to CarePilot...",
  streaming: "CarePilot is responding...",
  reconnecting: "Reconnecting to continue your response...",
  delayed: "This is taking longer than usual.",
};

export function ThinkingIndicator({
  state = "streaming",
  statusText,
  onCancel,
  onRetry,
}: ThinkingIndicatorProps) {
  const text = statusText?.trim() || DEFAULT_STATUS_TEXT[state];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/80 px-4 py-3">
      <div role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="inline-block h-2 w-2 rounded-full bg-[color:var(--cp-primary)]"
              aria-hidden="true"
              animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: i * 0.2,
                ease: "easeInOut",
              }}
            />
          ))}
        </div>
        <span className="text-xs text-[color:var(--cp-muted)]">{text}</span>
      </div>
      {(onRetry || onCancel) && (
        <div className="ml-auto flex items-center gap-2">
          {onRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              icon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              Retry now
            </Button>
          )}
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
