import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-[color:var(--cp-line)] bg-white/85 px-4 py-3 text-sm text-[color:var(--cp-text)]",
        "placeholder:text-[color:var(--cp-muted)]/80",
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--cp-primary)]/45 focus:border-[color:var(--cp-primary)]",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";
