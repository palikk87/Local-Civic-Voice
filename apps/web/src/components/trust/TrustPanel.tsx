/**
 * THE TRUST SCORE, ON A SCREEN.
 *
 * "Trust scores are not meant to rank anyone. They are meant to inform people
 * when delegating votes."
 *
 * SO IT ALWAYS SHOWS ITS WORKING. The number is never on its own: every part
 * that produced it is listed underneath with its own count and what it
 * contributed. A bare score is something a reader either believes or does not,
 * and belief is not what this is for.
 *
 * A NEW ACCOUNT GETS A SENTENCE, NOT A BAR. When there is not enough of a
 * record the server says so, and this prints that plainly rather than drawing
 * an empty meter — an empty meter next to somebody's name reads as a verdict on
 * them, which is the one thing this must never be.
 *
 * TWO SIZES, ONE SOURCE. `compact` is the line on a delegate card and the
 * delegation confirm step; the full panel is the profile. Both read the same
 * response, so a card and a profile can never disagree.
 */

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Info } from "lucide-react";
import { trust as trustApi, trustBand, type TrustResult } from "@/lib/trust";
import { cn } from "@/lib/utils";

function Meter({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-foreground/70"
        style={{ width: `${Math.max(2, score)}%` }}
      />
    </div>
  );
}

function NotEnough({
  result,
  compact,
}: {
  result: Extract<TrustResult, { enough: false }>;
  compact?: boolean;
}) {
  return (
    <p
      data-testid="trust-not-enough"
      className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm leading-6")}
    >
      Not enough of a record yet to say anything useful. This account is{" "}
      {result.accountAgeDays} day{result.accountAgeDays === 1 ? "" : "s"} old with{" "}
      {result.actions} recorded action{result.actions === 1 ? "" : "s"}.
      {compact ? "" : " A score appears once there is something to describe."}
    </p>
  );
}

export function TrustPanel({
  userId,
  compact = false,
}: {
  userId: string;
  compact?: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["trust", userId],
    queryFn: () => trustApi.of(userId),
    enabled: Boolean(userId),
  });

  if (isLoading || !data) return null;
  const result = data.trust;

  if (!result.enough) {
    if (compact) return <NotEnough result={result} compact />;
    return (
      <section className="rounded-2xl border border-border bg-card p-4" data-testid="trust-panel">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          Trust Score
        </h3>
        <NotEnough result={result} />
      </section>
    );
  }

  if (compact) {
    return (
      <div data-testid="trust-compact" className="mt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-muted-foreground">{trustBand(result.score)}</span>
          <span className="text-xs font-semibold tabular-nums text-foreground">
            {result.score}/100
          </span>
        </div>
        <div className="mt-1">
          <Meter score={result.score} />
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4" data-testid="trust-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Trust Score
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{trustBand(result.score)}</p>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-foreground">{result.score}</p>
      </div>

      <div className="mt-3">
        <Meter score={result.score} />
      </div>

      <dl className="mt-4 space-y-2">
        {result.parts.map((part) => (
          <div key={part.id} data-testid="trust-part" className="flex items-start gap-3">
            <dd
              className={cn(
                "w-10 shrink-0 text-right text-xs font-semibold tabular-nums",
                part.points > 0
                  ? "text-emerald-500"
                  : part.points < 0
                    ? "text-amber-500"
                    : "text-muted-foreground",
              )}
            >
              {part.points > 0 ? `+${part.points}` : part.points}
            </dd>
            <dt className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{part.label}</p>
              <p className="text-xs text-muted-foreground">{part.detail}</p>
            </dt>
          </div>
        ))}
      </dl>

      <p className="mt-4 flex items-start gap-1.5 border-t border-border pt-3 text-[11px] leading-4 text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          This is here to help you decide whether to lend somebody your vote. It ranks nobody, it
          changes nothing about what anybody sees on this platform, and it is not a judgement of a
          person — only a description of what this account has done here.
        </span>
      </p>
    </section>
  );
}
