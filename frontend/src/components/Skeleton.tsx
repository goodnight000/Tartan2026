import { cn } from "@/lib/utils";

export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn("skeleton-shimmer h-4 rounded-lg", className)}
      role="status"
      aria-label="Loading"
    />
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[color:var(--cp-line)]/40 bg-white/60 p-5 space-y-3",
        className
      )}
      role="status"
      aria-label="Loading content"
    >
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-6 w-3/4" />
      <SkeletonLine className="h-4 w-full" />
      <SkeletonLine className="h-4 w-5/6" />
    </div>
  );
}

export function SkeletonChat({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading chat">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-2xl border border-[color:var(--cp-line)]/30 bg-white/50 p-4",
            i % 2 === 0 ? "ml-auto w-3/5" : "mr-auto w-4/5"
          )}
        >
          <SkeletonLine className={cn("h-4", i % 2 === 0 ? "w-full" : "w-4/5")} />
          {i % 2 !== 0 && <SkeletonLine className="mt-2 h-4 w-3/5" />}
        </div>
      ))}
    </div>
  );
}
