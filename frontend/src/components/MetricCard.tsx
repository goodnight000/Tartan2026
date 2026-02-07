"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { LineChart, Line } from "recharts";
import { cn } from "@/lib/utils";
import type { HealthSignal } from "@/lib/types";

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
} as const;

export function MetricCard({
  signal,
  className,
}: {
  signal: HealthSignal;
  className?: string;
}) {
  const TrendIcon = signal.trend ? trendIcons[signal.trend] : null;
  const chartData = signal.data?.map((v, i) => ({ i, v }));
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = chartContainerRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const updateSize = () => {
      const rect = node.getBoundingClientRect();
      setChartSize({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
      });
    };
    updateSize();
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect;
      if (!next) {
        return;
      }
      setChartSize({
        width: Math.max(0, Math.floor(next.width)),
        height: Math.max(0, Math.floor(next.height)),
      });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-2xl border border-[color:var(--cp-line)] bg-white/78 p-4 space-y-2",
        className
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[color:var(--cp-muted)]">
        {signal.title}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-[color:var(--cp-text)]">{signal.value}</span>
        {TrendIcon && (
          <TrendIcon
            className={cn(
              "h-4 w-4",
              signal.trend === "up" && "text-[color:var(--cp-success)]",
              signal.trend === "down" && "text-[color:var(--cp-danger)]",
              signal.trend === "stable" && "text-[color:var(--cp-muted)]"
            )}
            aria-label={`Trending ${signal.trend}`}
          />
        )}
      </div>

      {chartData && chartData.length > 1 && (
        <div className="h-10 w-full" ref={chartContainerRef} aria-hidden="true">
          {chartSize.width > 0 && chartSize.height > 0 && (
            <LineChart width={chartSize.width} height={chartSize.height} data={chartData}>
              <Line
                type="monotone"
                dataKey="v"
                stroke="var(--cp-primary)"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-[10px] text-[color:var(--cp-muted)]">
        <span>{signal.lastSync}</span>
        <span className="font-mono text-[color:var(--cp-info)]">{signal.source}</span>
      </div>
    </motion.div>
  );
}
