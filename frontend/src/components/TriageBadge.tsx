"use client";

import { AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TriageLevel } from "@/lib/types";

const config: Record<TriageLevel, { icon: typeof AlertTriangle; label: string; className: string }> = {
  EMERGENT: {
    icon: AlertTriangle,
    label: "Emergent",
    className:
      "border-triage-emergent/40 bg-[color:color-mix(in_srgb,var(--cp-danger)_10%,white_90%)] text-triage-emergent",
  },
  URGENT_24H: {
    icon: AlertCircle,
    label: "Urgent (24h)",
    className:
      "border-triage-urgent/40 bg-[color:color-mix(in_srgb,var(--cp-warn)_10%,white_90%)] text-triage-urgent",
  },
  ROUTINE: {
    icon: CheckCircle,
    label: "Routine",
    className:
      "border-triage-routine/40 bg-[color:color-mix(in_srgb,var(--cp-success)_8%,white_92%)] text-triage-routine",
  },
};

export function TriageBadge({
  level,
  className: extraClass,
}: {
  level: TriageLevel;
  className?: string;
}) {
  const c = config[level];
  const Icon = c.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.06em]",
        c.className,
        extraClass
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {c.label}
    </span>
  );
}
