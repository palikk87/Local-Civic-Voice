import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { api } from "@/lib/api";

interface PulsePoint {
  date: string;
  support: number;
  oppose: number;
  lawChanged: boolean;
}

/**
 * When opinion on this moved, and whether the text moved with it.
 *
 * The vote table can only ever say what the Pulse is now. This is readable at
 * all because positions are kept as events rather than as a current state — and
 * the day the law changed is marked, because on a platform about legislation
 * the amendment is usually the answer to "what turned it".
 *
 * Drawn as bars rather than a line chart on purpose: a line implies a
 * continuous measurement between two points and this is a count of discrete
 * days on which somebody actually did something. Nothing is interpolated.
 */
/**
 * `ready` is the page's load order, not a feature flag.
 *
 * This panel sits far below the fold on a law page, and the page used to ask
 * for it in the same breath as the record itself — so the thing a reader came
 * for queued behind panels they had not scrolled to. The page now opens its
 * requests top to bottom and passes `ready` when this one's turn arrives.
 *
 * Defaults to true, so every other caller behaves exactly as it did. Nothing is
 * ever skipped: a false here delays a request by a frame or two, it does not
 * cancel it.
 */
interface PulseHistoryProps {
  referenceId: string;
  /** False until this panel's turn in the page's load order. */
  ready?: boolean;
}

export function PulseHistory({ referenceId, ready = true }: PulseHistoryProps) {
  const { data } = useQuery({
    queryKey: ["pulse-history", referenceId],
    queryFn: () =>
      api.get<{ points: PulsePoint[]; count: number }>(
        `/api/government-references/${referenceId}/pulse-history`,
      ),
    enabled: Boolean(referenceId) && ready,
  });

  // Same rule as everywhere else here: an unexpected shape leaves the panel
  // blank rather than breaking the page it sits on.
  const points = Array.isArray(data?.points) ? data.points : [];
  // One day of data is a number, not a history.
  if (points.length < 2) return null;
  if (points.some((p) => typeof p?.support !== "number" || typeof p?.oppose !== "number")) {
    return null;
  }

  const peak = Math.max(...points.map((p) => p.support + p.oppose), 1);

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-institutional text-accent">
        <TrendingUp className="h-4 w-4" aria-hidden="true" />
        How opinion moved
      </div>

      <div className="mt-4 flex h-28 items-end gap-1 overflow-x-auto">
        {points.map((point) => {
          const total = point.support + point.oppose;
          const height = Math.max((total / peak) * 100, 4);
          const supportShare = total > 0 ? (point.support / total) * 100 : 0;

          return (
            <div
              key={point.date}
              className="flex min-w-[10px] flex-1 flex-col justify-end"
              title={`${point.date}: ${point.support} for, ${point.oppose} against${
                point.lawChanged ? " — the text changed this day" : ""
              }`}
            >
              {point.lawChanged ? (
                <span
                  className="mb-1 self-center text-[10px] leading-none text-accent"
                  aria-label="The text changed on this day"
                >
                  ✳
                </span>
              ) : null}
              <div
                className="w-full overflow-hidden rounded-sm bg-oppose"
                style={{ height: `${height}%` }}
              >
                <div className="w-full bg-support" style={{ height: `${supportShare}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        {points.some((p) => p.lawChanged)
          ? "✳ marks the day the text changed."
          : "The text has not changed since the first position was taken."}
      </p>
    </div>
  );
}
