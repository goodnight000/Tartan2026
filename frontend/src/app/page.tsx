 "use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  return (
    <div className="relative">
      <section
        className="surface-card reveal relative flex min-h-[72vh] flex-col justify-center gap-8 overflow-hidden p-10 md:min-h-[78vh] md:p-16"
        style={{ animationDuration: "1200ms" }}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;
          setCursor({ x: (x - 0.5) * 2, y: (y - 0.5) * 2 });
        }}
        onMouseLeave={() => setCursor({ x: 0, y: 0 })}
      >
        <div
          className="reveal text-xs font-semibold uppercase tracking-[0.5em] text-[color:var(--cp-muted)]"
          style={{ animationDelay: "120ms", animationDuration: "1400ms" }}
        >
          A new platform, tailored for you
        </div>

        <div className="space-y-6">
          <h1
            className="reveal text-[clamp(3.5rem,11vw,7.5rem)] leading-[0.9] text-[color:var(--cp-primary)]"
            style={{ animationDelay: "220ms", animationDuration: "1600ms" }}
          >
            CarePilot
          </h1>
          <p
            className="reveal max-w-4xl text-[clamp(1.4rem,3vw,2.4rem)] leading-[1.1]"
            style={{ animationDelay: "360ms", animationDuration: "1800ms" }}
          >
            Stop using general-purpose chatbots for healthcare. Use a platform that <span className="font-semibold">cares</span>.
          </p>
        </div>

        <div
          className="reveal flex flex-wrap gap-4"
          style={{ animationDelay: "520ms", animationDuration: "2000ms" }}
        >
          <Button asChild size="lg">
            <Link href="/login">
              Log in to CarePilot
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-sm text-[color:var(--cp-muted)]">
            <span className="h-[2px] w-8 bg-[color:var(--cp-line)]" />
            Care that keeps up.
          </div>
        </div>

        <div
          className="reveal pointer-events-none absolute right-6 top-6 h-24 w-24"
          style={{ animationDelay: "900ms", animationDuration: "2400ms" }}
          aria-hidden="true"
        >
          <div
            className="h-full w-full rounded-full border border-[color:var(--cp-line)] bg-white/60 blur-[0.5px] transition-transform duration-500 ease-out"
            style={{ transform: `translate3d(${cursor.x * 10}px, ${cursor.y * 10}px, 0)` }}
          />
        </div>
        <div
          className="reveal pointer-events-none absolute bottom-10 right-12 h-32 w-32"
          style={{ animationDelay: "1050ms", animationDuration: "2600ms" }}
          aria-hidden="true"
        >
          <div
            className="h-full w-full rounded-full border border-[color:var(--cp-line)] bg-[color:var(--cp-primary-soft)] blur-[1px] transition-transform duration-500 ease-out"
            style={{ transform: `translate3d(${cursor.x * 18}px, ${cursor.y * 18}px, 0)` }}
          />
        </div>
      </section>
    </div>
  );
}
