import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[color:var(--cp-line)] bg-white/75 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--cp-muted)]",
        className
      )}
      {...props}
    />
  );
}
