import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
      <div className="mb-3 rounded-2xl bg-[color:var(--cp-surface-soft)] p-4">
        <Icon className="h-8 w-8 text-[color:var(--cp-muted)]" aria-hidden="true" />
      </div>
      <h3 className="text-lg font-semibold text-[color:var(--cp-text)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-xs text-sm text-[color:var(--cp-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
