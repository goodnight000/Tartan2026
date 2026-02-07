import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "triage-emergent" | "triage-urgent" | "triage-routine";
}

export function Card({
  className,
  variant = "default",
  ...props
}: CardProps) {
  return (
    <div
      className={cn(
        "surface-card rounded-[var(--cp-radius-lg)] border border-[color:var(--cp-line)]/70 p-6",
        variant === "elevated" && "shadow-[0_32px_64px_rgba(37,29,14,0.18)]",
        variant === "triage-emergent" &&
          "border-triage-emergent/40 bg-[color:color-mix(in_srgb,var(--cp-danger)_6%,white_94%)]",
        variant === "triage-urgent" &&
          "border-triage-urgent/30 bg-[color:color-mix(in_srgb,var(--cp-warn)_6%,white_94%)]",
        variant === "triage-routine" &&
          "border-triage-routine/25 bg-[color:color-mix(in_srgb,var(--cp-success)_4%,white_96%)]",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1.5", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mt-4 flex items-center justify-between border-t border-[color:var(--cp-line)]/30 pt-4",
        className
      )}
      {...props}
    />
  );
}
