"use client";

import { Shield, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export function TrustBadge({
  variant = "inline",
  className,
}: {
  variant?: "inline" | "block";
  className?: string;
}) {
  if (variant === "block") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-[color:var(--cp-success)]/30 bg-[color:color-mix(in_srgb,var(--cp-success)_6%,white_94%)] px-4 py-3",
          className
        )}
      >
        <Shield className="h-5 w-5 text-[color:var(--cp-success)]" aria-hidden="true" />
        <div>
          <div className="text-xs font-semibold text-[color:var(--cp-success)]">
            Privacy Protected
          </div>
          <div className="text-[11px] text-[color:var(--cp-muted)]">
            End-to-end encrypted. Consent recorded for every action.
          </div>
        </div>
      </div>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-[color:var(--cp-success)]/30 bg-[color:color-mix(in_srgb,var(--cp-success)_6%,white_94%)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--cp-success)]",
        className
      )}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Encrypted
    </span>
  );
}
