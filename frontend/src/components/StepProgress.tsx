"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function StepProgress({
  steps,
  currentStep,
  className,
}: {
  steps: { id: string; title: string }[];
  currentStep: number;
  className?: string;
}) {
  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex items-center gap-0">
        {steps.map((step, index) => {
          const isComplete = index < currentStep;
          const isCurrent = index === currentStep;
          return (
            <li key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <motion.div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors",
                    isComplete &&
                      "border-[color:var(--cp-primary)] bg-[color:var(--cp-primary)] text-white",
                    isCurrent &&
                      "border-[color:var(--cp-primary)] bg-white text-[color:var(--cp-primary)]",
                    !isComplete &&
                      !isCurrent &&
                      "border-[color:var(--cp-line)] bg-white/60 text-[color:var(--cp-muted)]"
                  )}
                  initial={false}
                  animate={isComplete ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 0.3 }}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </motion.div>
                <span
                  className={cn(
                    "mt-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap",
                    isCurrent ? "text-[color:var(--cp-primary)]" : "text-[color:var(--cp-muted)]"
                  )}
                >
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 w-8 sm:w-12 rounded-full transition-colors",
                    isComplete
                      ? "bg-[color:var(--cp-primary)]"
                      : "bg-[color:var(--cp-line)]/50"
                  )}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
