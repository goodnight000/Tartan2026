import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  asChild?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = disabled || loading;
  return (
    <Comp
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-[0.01em] transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--cp-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--cp-surface)]",
        "disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" && "px-3 py-1.5 text-xs",
        size === "md" && "px-5 py-2.5 text-sm",
        size === "lg" && "px-6 py-3 text-base",
        size === "icon" && "h-10 w-10 p-0",
        variant === "default" &&
          "bg-[color:var(--cp-primary)] text-white shadow-[0_14px_24px_rgba(15,62,70,0.24)] hover:-translate-y-0.5 hover:brightness-105",
        variant === "outline" &&
          "border border-[color:var(--cp-line)] bg-white/72 text-[color:var(--cp-text)] hover:bg-white hover:border-[color:var(--cp-accent)]",
        variant === "ghost" &&
          "text-[color:var(--cp-muted)] hover:text-[color:var(--cp-text)] hover:bg-white/68",
        variant === "danger" &&
          "border border-[color:var(--cp-danger)] bg-[color:color-mix(in_srgb,var(--cp-danger)_10%,white_90%)] text-[color:var(--cp-danger)] hover:bg-[color:color-mix(in_srgb,var(--cp-danger)_16%,white_84%)]",
        className
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {children}
        </>
      ) : (
        <>
          {icon && <span className="shrink-0" aria-hidden="true">{icon}</span>}
          {children}
        </>
      )}
    </Comp>
  );
}
