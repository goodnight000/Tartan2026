"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, ChevronDown } from "lucide-react";
import { TriageBadge } from "@/components/TriageBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TriageLevel } from "@/lib/types";

export function TriageCard({
  level,
  summary,
  actions,
  className,
}: {
  level: TriageLevel;
  summary: string;
  actions?: string[];
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isEmergent = level === "EMERGENT";

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        isEmergent
          ? "border-triage-emergent/40 bg-[color:color-mix(in_srgb,var(--cp-danger)_6%,white_94%)]"
          : level === "URGENT_24H"
            ? "border-triage-urgent/30 bg-[color:color-mix(in_srgb,var(--cp-warn)_6%,white_94%)]"
            : "border-triage-routine/25 bg-[color:color-mix(in_srgb,var(--cp-success)_4%,white_96%)]",
        className
      )}
      role={isEmergent ? "alert" : undefined}
      aria-label={`Triage level: ${level.replace(/_/g, " ").toLowerCase()}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <TriageBadge level={level} />
          <p className="text-sm text-[color:var(--cp-text)]">{summary}</p>
        </div>
        {isEmergent && (
          <Button
            variant="danger"
            size="sm"
            className="shrink-0"
            type="button"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            Call 911
          </Button>
        )}
      </div>

      {actions && actions.length > 0 && (
        <>
          <button
            type="button"
            className="mt-3 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)] hover:text-[color:var(--cp-text)]"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <ChevronDown
              className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")}
              aria-hidden="true"
            />
            Recommended Actions
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.ul
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="mt-2 space-y-1 overflow-hidden"
              >
                {actions.map((action) => (
                  <li key={action} className="text-xs text-[color:var(--cp-muted)]">
                    {action}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
