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
 * The signature AYE & NAY motif: a two-tone bar showing the balance of Aye
 * against Nay across the aggregated Public Pulse.
 *
 * NOBODY HAS VOTED IS NOT THE SAME AS EVERYBODY VOTED NAY. The track used to be
 * painted Nay-coloured and then overlaid with an Aye-coloured fill, which meant
 * a record with zero votes rendered as a solid bar of opposition. It read as a
 * landslide against, and it was a law nobody had opened yet. That is precisely
 * the thing this platform is not allowed to do: when the data does not exist,
 * show nothing.
 *
 * So an empty tally gets an empty track and says so.
 *
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
  const nobodyHasVoted = votes.total === 0;

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
        nobodyHasVoted ? (
          <div className="mb-1.5 font-mono text-xs text-muted-foreground">
            No votes yet
          </div>
        ) : (
          <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
            <span className="font-semibold text-support">
              {votes.support.toLocaleString()} aye · {pct}%
            </span>
            <span className="font-semibold text-oppose">
              {opposePct}% · {votes.oppose.toLocaleString()} nay
            </span>
          </div>
        )
      ) : null}

      <div
        className={cn(
          "relative flex w-full overflow-hidden rounded-full ring-1 ring-border",
          // An empty tally is a muted, empty track. Only a real Nay count
          // paints the bar Nay-coloured.
          nobodyHasVoted ? "bg-muted" : "bg-oppose",
          HEIGHTS[size],
        )}
        role="img"
        aria-label={
          nobodyHasVoted
            ? "Public Pulse: nobody has voted on this yet"
            : `Public Pulse: ${pct} percent aye, ${opposePct} percent nay`
        }
      >
        {nobodyHasVoted ? null : (
          <div
            className="h-full bg-support transition-[width] duration-700 ease-out"
            style={{ width: `${fillWidth}%` }}
          />
        )}
        {/* center seam, only meaningful once there are two sides to divide */}
        {nobodyHasVoted ? null : (
          <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-background/40" />
        )}
      </div>
    </div>
  );
}
