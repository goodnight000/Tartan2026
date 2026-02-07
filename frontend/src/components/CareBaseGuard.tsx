"use client";

import { useEffect, useState } from "react";

export interface CareBaseRequest {
  key: string;
  context?: string;
}

interface CareBaseGuardProps {
  open: boolean;
  request: CareBaseRequest | null;
  onAllow: () => void;
  onDeny: () => void;
  onAlwaysAllow: () => void;
}

export function CareBaseGuard({
  open,
  request,
  onAllow,
  onDeny,
  onAlwaysAllow,
}: CareBaseGuardProps) {
  const displayKey = request?.key ? request.key.replace(/:[A-Za-z0-9_-]{6,}/g, "") : "";
  const displayContext = request?.context
    ? request.context.replace(/profile:[A-Za-z0-9_-]{6,}/g, "profile")
      .replace(/symptom_logs:[A-Za-z0-9_-]{6,}/g, "symptom_logs")
      .replace(/action_logs:[A-Za-z0-9_-]{6,}/g, "action_logs")
    : undefined;
  const [showContext, setShowContext] = useState(false);

  useEffect(() => {
    if (open) {
      setShowContext(false);
    }
  }, [open, request]);

  if (!open || !request) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl border border-[color:var(--cp-line)] bg-white p-6 shadow-xl">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--cp-primary)]">
            Data Access Request
          </p>
          <p className="text-sm text-[color:var(--cp-muted)]">Agent requests access to:</p>
          <h3 className="text-lg font-semibold text-[color:var(--cp-text)]">{displayKey}</h3>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-full bg-[color:var(--cp-primary)] px-4 py-2 text-sm text-white"
            onClick={onAllow}
          >
            Allow
          </button>
          <button
            className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
            onClick={onDeny}
          >
            Deny
          </button>
          <button
            className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
            onClick={onAlwaysAllow}
          >
            Always Allow
          </button>
          <button
            className="rounded-full border border-[color:var(--cp-line)] px-4 py-2 text-sm"
            onClick={() => setShowContext((prev) => !prev)}
          >
            {showContext ? "Hide Context" : "View Context"}
          </button>
        </div>
        {showContext ? (
          <div className="mt-4 rounded-xl bg-[color:var(--cp-surface)] p-3 text-xs text-[color:var(--cp-muted)]">
            <p className="font-semibold text-[color:var(--cp-text)]">Agent Context</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
              {displayContext || "No context available."}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
