import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  chips,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  chips?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div>
        <p className="editorial-eyebrow">{eyebrow}</p>
        <h1 className="panel-title text-[clamp(2.1rem,5vw,4rem)] leading-[0.9]">{title}</h1>
        {subtitle && <p className="panel-subtitle mt-2 max-w-3xl text-base">{subtitle}</p>}
      </div>
      {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
    </div>
  );
}
