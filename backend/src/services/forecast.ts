/**
 * WHERE OPINION HAS ACTUALLY BEEN, AND WHAT THAT DOES OR DOES NOT SUPPORT.
 *
 * WHAT THIS REPLACES. The forecast endpoints took a bill's current sentiment
 * and walked it forward thirty days with `(rand() - 0.5) * 0.05` per step. The
 * bounds were a flat ±0.15 regardless of anything. It reported
 * `confidence: total > 10 ? 0.8 : 0.5` — two literals — and
 * `modelVersion: "v2.3.1"`, which named a model that did not exist. Seeding the
 * generator from the bill id was an earlier fix, and it was a real improvement:
 * it stopped the chart reshuffling on every refresh. But it made the line
 * STABLE, not TRUE. A stable fiction is still a fiction, and it is a more
 * convincing one.
 *
 * WHAT IS ACTUALLY KNOWN. Every position anybody takes is recorded in
 * PositionEvent, and pulseOverTime already reconstructs the Pulse day by day
 * from it. That is real, observed movement — the most valuable thing on this
 * endpoint and the thing the random walk was drawn on top of and hid.
 *
 * SO: the history is always returned, because it is measured. A projection is
 * returned ONLY where there is enough real movement to fit a line to, it is a
 * least-squares fit over that movement and nothing else, and its bounds come
 * from how far the actual observations sat from that line. Where the history is
 * too short, the projection is null with a reason, and the client shows the
 * history alone.
 *
 * There is no confidence literal and no version string. What a reader needs in
 * order to judge this is how many days and how many voices it rests on, and
 * both are returned.
 */

import { pulseOverTime, type PulsePoint } from "./position-history";

/**
 * The fewest distinct days of observation that may be extrapolated from.
 *
 * Two points define a line and prove nothing; a week of daily readings is the
 * least that can distinguish a direction from a wobble. Below this the honest
 * output is the history and no line.
 */
export const MIN_HISTORY_DAYS = 7;

/** How far ahead a fitted line is carried. */
export const PROJECTION_DAYS = 30;

export interface ProjectedPoint {
  date: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

export interface Trajectory {
  /** Observed. Always present when anybody has voted. */
  history: PulsePoint[];
  /** What the history rests on, so a reader can judge it themselves. */
  basis: {
    days: number;
    voices: number;
    firstDay: string | null;
    lastDay: string | null;
    /** Days on which the law's own text changed. Movement may be about that. */
    lawChangedOn: string[];
  };
  /** Null when the history is too short to fit a line to. */
  projection: {
    points: ProjectedPoint[];
    /** Change in score per day, from the fit. */
    slopePerDay: number;
    /**
     * Typical distance between the observations and the fitted line. The bounds
     * are this, widened as the projection runs further from the last real
     * reading — because a line fitted to noisy data says less about day 30 than
     * about day 1.
     */
    residual: number;
    method: "least-squares over observed daily scores";
  } | null;
  /** Present exactly when projection is null. */
  noProjection: { reason: "not_enough_history"; daysObserved: number; daysNeeded: number } | null;
}

function scoreOf(point: PulsePoint): number {
  const total = point.support + point.oppose;
  return total > 0 ? (point.support - point.oppose) / total : 0;
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n));
const round = (n: number) => parseFloat(n.toFixed(3));

export async function trajectory(referenceId: string): Promise<Trajectory> {
  const history = await pulseOverTime(referenceId);

  const last = history[history.length - 1];
  const basis = {
    days: history.length,
    voices: last ? last.support + last.oppose : 0,
    firstDay: history[0]?.date ?? null,
    lastDay: last?.date ?? null,
    lawChangedOn: history.filter((p) => p.lawChanged).map((p) => p.date),
  };

  if (history.length < MIN_HISTORY_DAYS) {
    return {
      history,
      basis,
      projection: null,
      noProjection: {
        reason: "not_enough_history",
        daysObserved: history.length,
        daysNeeded: MIN_HISTORY_DAYS,
      },
    };
  }

  // Least squares over (day index, score). Ordinary, unweighted, and named as
  // such in the response — a simple method stated plainly beats an elaborate
  // one implied by a version number.
  const xs = history.map((_, i) => i);
  const ys = history.map(scoreOf);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  // Every reading on the same day index is impossible here (indices are
  // distinct), so den > 0 for n >= 2. Guarded anyway rather than dividing by
  // zero into NaN and rendering "NaN%".
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;

  // How far the real observations sat from the line. This is the honest width.
  const residual = Math.sqrt(
    ys.reduce((sum, y, i) => sum + (y - (intercept + slope * xs[i]!)) ** 2, 0) / n,
  );

  const lastDate = new Date(`${basis.lastDay}T00:00:00Z`);
  const points: ProjectedPoint[] = [];
  for (let step = 1; step <= PROJECTION_DAYS; step++) {
    const date = new Date(lastDate.getTime() + step * 24 * 60 * 60 * 1000);
    const predicted = clamp(intercept + slope * (n - 1 + step));
    // Widening with distance: a line fitted to scattered readings says less
    // about day 30 than about day 1, and flat bounds hid that.
    const spread = residual * Math.sqrt(1 + step / PROJECTION_DAYS);
    points.push({
      date: date.toISOString().slice(0, 10),
      predicted: round(predicted),
      lowerBound: round(clamp(predicted - spread)),
      upperBound: round(clamp(predicted + spread)),
    });
  }

  return {
    history,
    basis,
    projection: {
      points,
      slopePerDay: round(slope),
      residual: round(residual),
      method: "least-squares over observed daily scores",
    },
    noProjection: null,
  };
}
