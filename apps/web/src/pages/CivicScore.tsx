import { ArrowLeft, Flame, MessageSquare, PenLine, Vote } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { useCivicScore } from "@/hooks/use-civic-score";
import { cn } from "@/lib/utils";

/**
 * WHAT YOUR SCORE IS MADE OF.
 *
 * WHY THIS PAGE EXISTS. The plaque on the feed showed a number and a level and
 * then took you to your profile when you pressed it — reported as "it just
 * takes you to your profile rather opening up the feature further". A number
 * with no explanation is a number nobody trusts, and one you cannot interrogate
 * is one you cannot aim at.
 *
 * EVERYTHING HERE IS COUNTED, NOT CLAIMED. Every figure comes from
 * /api/me/civic-score, which counts the person's real votes, posts and
 * comments. There is no sample data on this page and no encouraging round
 * number for a new account: somebody who has done nothing sees zero, and the
 * rules that would change that.
 *
 * IT SHOWS ONE PERSON THEIR OWN RECORD. There is no comparison to anybody else
 * anywhere on it, and no endpoint that would allow one. That is the platform's
 * own rule, not a gap.
 */

/** The rules, stated where the number is, so the two cannot drift apart. */
const WORTH = [
  { icon: Vote, label: "Voting on a law", points: 10, key: "votes" as const },
  { icon: PenLine, label: "Writing a post", points: 5, key: "posts" as const },
  { icon: MessageSquare, label: "Commenting", points: 2, key: "comments" as const },
];

/**
 * Twelve weeks of squares, one per day, lit when something happened.
 *
 * Drawn from the real dates rather than inferred from a streak length, which is
 * how the week strip on the feed used to do it — a streak of three lit the
 * previous three days whether or not those were the days.
 */
function ActivityGrid({ activeDays }: { activeDays: string[] }) {
  const active = new Set(activeDays);
  const weeks = 12;
  const days: Array<{ date: string; lit: boolean }> = [];

  for (let back = weeks * 7 - 1; back >= 0; back -= 1) {
    const at = new Date();
    at.setUTCDate(at.getUTCDate() - back);
    const date = at.toISOString().slice(0, 10);
    days.push({ date, lit: active.has(date) });
  }

  return (
    <div className="mt-4 grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
      {days.map((day) => (
        <span
          key={day.date}
          title={day.date}
          className={cn(
            "h-3 w-3 rounded-[3px]",
            day.lit ? "bg-accent" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

export default function CivicScorePage() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useCivicScore();
  const score = data?.score;

  return (
    <AppShell>
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Counting…</p>
        ) : isError || !score ? (
          // An unreachable server is said out loud rather than shown as a zero,
          // which would be a lie about somebody's record.
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              We couldn't reach your record just now. Nothing has been lost — this is counted
              from your votes and posts every time you open it.
            </p>
          </div>
        ) : (
          <>
            {/* ---------- The number ---------- */}
            <section className="felt-card felt-card-lit rounded-2xl p-6">
              <p className="plaque-label">Civic score</p>
              <div className="mt-2 flex items-end gap-3">
                <span className="font-display text-6xl font-semibold leading-none text-foreground">
                  {score.total}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">of 1000</span>
              </div>
              <p className="mt-2 text-lg text-foreground">{score.levelTitle}</p>

              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-500"
                    style={{
                      width: `${Math.min(100, Math.round((score.intoLevel / score.levelSpan) * 100))}%`,
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {score.toNextLevel > 0
                    ? `${score.toNextLevel} to the next level`
                    : "Top level reached"}
                </p>
              </div>
            </section>

            {/* ---------- Where it came from ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Where it came from
              </h2>
              <ul className="mt-4 space-y-3">
                {WORTH.map(({ icon: Icon, label, points, key }) => (
                  <li key={key} className="flex items-center gap-3">
                    <Icon className="h-4 w-4 shrink-0 text-accent" />
                    <span className="min-w-0 flex-1 text-sm text-foreground">{label}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {score.counts[key]} × {points}
                    </span>
                    <span className="w-16 text-right text-sm font-medium tabular-nums text-foreground">
                      {score.earned[key]}
                    </span>
                  </li>
                ))}
              </ul>
              {/* The cap is why these can add up to more than the score, and a
                  number that does not add up is the fastest way to lose trust
                  in all of them. */}
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                Up to 50 points count from any one day, so the score rewards turning up over time
                rather than one long sitting. That is why the figures above can total more than
                your score.
              </p>
            </section>

            {/* ---------- The streak ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                <Flame className={cn("h-5 w-5", score.streak.current > 0 ? "text-accent" : "text-muted-foreground")} />
                Streak
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="font-display text-3xl font-semibold text-foreground">
                    {score.streak.current}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {score.streak.current === 1 ? "day running" : "days running"}
                  </p>
                </div>
                <div>
                  <p className="font-display text-3xl font-semibold text-foreground">
                    {score.streak.longest}
                  </p>
                  <p className="text-xs text-muted-foreground">longest ever</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {score.streak.activeToday
                  ? "Today counts already."
                  : score.streak.current > 0
                    ? "Do anything today to keep it going — a vote, a post, a comment."
                    : "Vote, post or comment on any day to start one."}
              </p>
            </section>

            {/* ---------- Badges ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-semibold text-foreground">Badges</h2>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {score.badges.filter((b) => b.earned).length} of {score.badges.length}
                </span>
              </div>

              {/*
                LOCKED BADGES ARE SHOWN, NOT HIDDEN. A ladder you cannot see is
                not a ladder. Each one says what earns it and how far along you
                are, so there is nothing to guess at.

                Every badge here can actually be earned from things the platform
                records. Ones that would need data nobody keeps — which bills
                you read in full, which gaps you looked at — are not listed at
                all, because a badge nothing can unlock is a promise unkept.
              */}
              <ul className="mt-4 space-y-3">
                {score.badges.map((badge) => (
                  <li key={badge.id} className="flex items-center gap-3">
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
                        badge.earned
                          ? "border-amber-300/60 bg-gradient-to-b from-orange-300 to-amber-500 text-emerald-950"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {badge.earned ? "★" : `${Math.round((badge.progress / badge.requirement) * 100)}%`}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm font-medium",
                          badge.earned ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {badge.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {badge.description}
                      </span>
                      {!badge.earned ? (
                        <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-accent/70"
                            style={{ width: `${(badge.progress / badge.requirement) * 100}%` }}
                          />
                        </span>
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {badge.progress}/{badge.requirement}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            {/* ---------- The whole ladder ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">Levels</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Each level is twice as wide as the one below it, so the climb never gets easier.
              </p>
              <ol className="mt-4 space-y-2">
                {score.levels.map((band) => {
                  const here = band.id === score.level;
                  return (
                    <li
                      key={band.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2",
                        here ? "bg-accent/10 ring-1 ring-accent/40" : "",
                      )}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          band.reached ? "bg-accent" : "bg-muted-foreground/30",
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          band.reached ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {band.title}
                        {here ? " — you are here" : ""}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {band.min.toLocaleString()}+
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            {/* ---------- Where your votes go ---------- */}
            {score.byCategory.length > 0 ? (
              <section className="rounded-2xl border border-border p-5">
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Where your votes go
                </h2>
                <ul className="mt-4 space-y-2">
                  {score.byCategory.map((row) => (
                    <li key={row.category} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 truncate text-sm capitalize text-foreground">
                        {row.category.replace(/_/g, " ")}
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-accent/70"
                          style={{
                            width: `${(row.votes / (score.byCategory[0]?.votes || 1)) * 100}%`,
                          }}
                        />
                      </span>
                      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                        {row.votes}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* ---------- The last twelve weeks ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">
                The last twelve weeks
              </h2>
              <ActivityGrid activeDays={score.activeDays} />
              <p className="mt-3 text-xs text-muted-foreground">
                {score.activeDays.length} {score.activeDays.length === 1 ? "day" : "days"} active
                in all.
              </p>
            </section>

            {/* ---------- What it is not ---------- */}
            <section className="rounded-2xl border border-border p-5">
              <h2 className="font-display text-lg font-semibold text-foreground">
                What this score is not
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                It is not a ranking. Nobody can see yours, there is no leaderboard, and it is
                never compared to anybody else's — the Constitution of this platform says it
                never ranks people, and this is your own record of turning up.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                It is counted from your actual votes, posts and comments every time you open
                this page, so it is the same on every device you sign in on.
              </p>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
