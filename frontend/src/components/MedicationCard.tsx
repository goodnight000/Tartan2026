"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { MedicationCardData } from "@/lib/types";

const statusConfig = {
  "on-track": { dot: "bg-[color:var(--cp-success)]", label: "On Track" },
  missed: { dot: "bg-[color:var(--cp-danger)]", label: "Missed" },
  "due-soon": { dot: "bg-[color:var(--cp-warn)]", label: "Due Soon" },
} as const;

export function MedicationCard({
  med,
  onRefill,
  className,
}: {
  med: MedicationCardData;
  onRefill?: () => void;
  className?: string;
}) {
  const status = statusConfig[med.status];

  return (
    <div
      className={cn(
        "rounded-2xl border border-[color:var(--cp-line)] bg-white/75 p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-[color:var(--cp-text)]">{med.name}</div>
          <div className="text-xs text-[color:var(--cp-muted)]">{med.dose} · {med.frequency}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("h-2.5 w-2.5 rounded-full", status.dot)} aria-hidden="true" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--cp-muted)]">
            {status.label}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1" aria-label={`Adherence: ${med.adherenceStreak.filter(Boolean).length} of ${med.adherenceStreak.length} doses taken`}>
        {med.adherenceStreak.map((taken, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              taken ? "bg-[color:var(--cp-success)]" : "bg-[color:var(--cp-line)]"
            )}
            aria-hidden="true"
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-[color:var(--cp-muted)]">
        {med.nextDose && <span>Next: {med.nextDose}</span>}
        {med.daysUntilRefill !== undefined && (
          <span className={cn(med.daysUntilRefill <= 3 && "font-semibold text-[color:var(--cp-warn)]", med.daysUntilRefill < 0 && "text-[color:var(--cp-danger)]")}>
            {med.daysUntilRefill < 0
              ? `Overdue by ${Math.abs(med.daysUntilRefill)}d`
              : `Refill in ${med.daysUntilRefill}d`}
          </span>
        )}
      </div>

      {onRefill && med.daysUntilRefill !== undefined && med.daysUntilRefill <= 7 && (
        <Button variant="outline" size="sm" onClick={onRefill} className="w-full">
          Request Refill
        </Button>
      )}
    </div>
  );
}
