import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-2xl border border-[color:var(--cp-line)] bg-white/85 px-4 py-2.5 text-sm text-[color:var(--cp-text)]",
        "placeholder:text-[color:var(--cp-muted)]/80",
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--cp-primary)]/45 focus:border-[color:var(--cp-primary)]",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
