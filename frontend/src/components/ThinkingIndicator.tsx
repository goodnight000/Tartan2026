"use client";

import { motion } from "framer-motion";

export function ThinkingIndicator() {
  return (
    <div
      className="flex items-center gap-2 rounded-2xl border border-[color:var(--cp-line)] bg-white/80 px-4 py-3"
      role="status"
      aria-label="CarePilot is analyzing"
    >
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="inline-block h-2 w-2 rounded-full bg-[color:var(--cp-primary)]"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1.1, 0.85] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      <span className="text-xs text-[color:var(--cp-muted)]">CarePilot is analyzing...</span>
    </div>
  );
}
