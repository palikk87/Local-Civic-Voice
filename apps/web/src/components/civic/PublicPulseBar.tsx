import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Votes } from "@/lib/civic";
import { supportPct } from "@/lib/civic";

interface PublicPulseBarProps {
  votes: Votes;
  size?: "sm" | "md" | "lg";
  showCounts?: boolean;
  className?: string;
  animate?: boolean;
}

const HEIGHTS: Record<string, string> = {
  sm: "h-2",
  md: "h-3",
  lg: "h-5",
};

/**
 * The signature Civic Voice motif: a two-tone bar showing the balance of
 * support vs. oppose across the aggregated Public Pulse.
 * Uses a CSS width transition (mount -> target) to avoid motion prop typing edge cases.
 */
export function PublicPulseBar({
  votes,
  size = "md",
  showCounts = true,
  className,
  animate = true,
}: PublicPulseBarProps) {
  const pct = supportPct(votes);
  const opposePct = votes.total ? 100 - pct : 0;

  const [grown, setGrown] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const fillWidth = grown ? pct : 0;

  return (
    <div className={cn("w-full", className)}>
      {showCounts ? (
        <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
          <span className="font-semibold text-support">
            {votes.support.toLocaleString()} support · {pct}%
          </span>
          <span className="font-semibold text-oppose">
            {opposePct}% · {votes.oppose.toLocaleString()} oppose
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "relative flex w-full overflow-hidden rounded-full bg-oppose ring-1 ring-border",
          HEIGHTS[size],
        )}
        role="img"
        aria-label={`Public Pulse: ${pct} percent support, ${opposePct} percent oppose`}
      >
        <div
          className="h-full bg-support transition-[width] duration-700 ease-out"
          style={{ width: `${fillWidth}%` }}
        />
        {/* center seam */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-background/40" />
      </div>
    </div>
  );
}
