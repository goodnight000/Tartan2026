"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

type Source = {
  label: string;
  url?: string;
};

export function SourceAttribution({
  sources,
  className,
}: {
  sources: Source[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className={cn("mt-2 border-t border-[color:var(--cp-line)]/30 pt-2", className)}>
      <button
        type="button"
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)] hover:text-[color:var(--cp-text)]"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${sources.length} source(s)`}
      >
        <ChevronDown
          className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
        {sources.length} Source{sources.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {sources.map((source, index) => (
            <li key={`${index}-${source.label}`} className="text-xs text-[color:var(--cp-muted)]">
              {source.url ? (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[color:var(--cp-info)] hover:underline"
                >
                  {source.label}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : (
                source.label
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
