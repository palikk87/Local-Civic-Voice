/**
 * Somebody's civic record: where they stood, when, and on which version of the
 * law — plus, on your own, every time somebody else spoke in your name.
 *
 * WHY THIS IS A COMPONENT AND NOT A PAGE. It was a page, at /record, with its
 * own item in the sidebar, and it was the only place any of this appeared. So a
 * person's positions — the single thing this platform exists to record — lived
 * somewhere other than their profile, and looking somebody up told you their
 * bio and their posts and nothing about what they had ever stood for.
 *
 * It now renders inside both profiles, and the privacy rule travels with it
 * rather than with the page: positions are public, the anonymous ones are
 * withheld from everybody but their author, and the two private sections —
 * where you stand alone, and what was said in your name — appear only on your
 * own record. A mirror is for the person holding it.
 *
 * TWO SHAPES, AFTER A BUG REPORT. "should this be viewable… does it violate
 * the anonymity guaranteed by the constitution". It does not — anonymity here
 * is a switch a person turns on, and when it is on the server never hands
 * those positions to anybody else. But somebody else's whole voting history
 * sitting open on their profile, no click required, is further than the report
 * was comfortable with, and the call was: keep the numbers, put the list
 * behind a button.
 *
 *   `summary` — the counts, and a way through to the rest. Somebody else's.
 *   `full`    — everything. Your own, and the page the button leads to.
 *
 * The phone has always worked this way; it pushes to /record?user=<id>. This
 * is the web catching up rather than a new idea.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronRight,
  EyeOff,
  RefreshCw,
  Scale,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { recordApi, type PositionRecord } from "@/lib/civic";

function positionLook(position: string) {
  if (position === "support") {
    return { icon: <ThumbsUp className="h-4 w-4" />, label: "Backed", tone: "text-support" };
  }
  if (position === "oppose") {
    return { icon: <ThumbsDown className="h-4 w-4" />, label: "Opposed", tone: "text-oppose" };
  }
  return { icon: <Undo2 className="h-4 w-4" />, label: "Withdrew", tone: "text-muted-foreground" };
}

function when(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function PositionRow({ entry }: { entry: PositionRecord }) {
  const look = positionLook(entry.position);

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("flex items-center gap-1.5 text-sm font-semibold", look.tone)}>
            {look.icon}
            {look.label}
            {entry.isChange ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                <RefreshCw className="h-3 w-3" />
                Changed my mind
              </span>
            ) : null}

            {/* Only ever reaches your own record. Article IV shields a citizen
                from other people, not from themselves — you can always read
                back what you did, and this says which of it carries your name. */}
            {entry.isAnonymous ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <EyeOff className="h-3 w-3" />
                Anonymous
              </span>
            ) : null}
          </p>

          <Link
            to={`/reference/${entry.reference.id}`}
            className="mt-1 block truncate text-sm text-foreground hover:underline"
          >
            {entry.reference.title}
          </Link>

          {entry.reason ? (
            <p className="mt-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
              {entry.reason}
            </p>
          ) : null}
        </div>

        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {when(entry.createdAt)}
        </span>
      </div>

      {entry.lawMovedSince ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-accent/5 p-2 text-xs text-accent">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            The text has changed since — you took this on version {entry.lawVersion}, it is now
            on {entry.reference.lawVersion}.
          </span>
        </p>
      ) : null}
    </li>
  );
}

interface CivicRecordProps {
  /** Whose record. Undefined while the viewer's own id is still loading. */
  userId: string | undefined;
  /** Their own. Unlocks the two private sections and the anonymous positions. */
  isMine: boolean;
  /**
   * `full` renders the positions themselves. `summary` renders the counts and
   * a link to the page that does. Defaults to full, so a caller that has not
   * thought about it shows everything rather than silently hiding a record.
   */
  variant?: "full" | "summary";
}

export function CivicRecord({ userId, isMine, variant = "full" }: CivicRecordProps) {
  const summaryOnly = variant === "summary";
  const { data, isLoading } = useQuery({
    queryKey: ["positions", userId],
    queryFn: () => recordApi.positions(userId!),
    enabled: Boolean(userId),
  });

  // Receipts are yours alone: what was said in your name is not somebody
  // else's business, even though the positions themselves are public.
  const { data: receipts } = useQuery({
    queryKey: ["voice-receipts"],
    queryFn: recordApi.receipts,
    enabled: isMine && Boolean(userId),
  });

  // Where they stand relative to everyone else. Only for their own record: a
  // mirror is for the person holding it.
  const { data: standing } = useQuery({
    queryKey: ["standing"],
    queryFn: recordApi.standing,
    enabled: isMine && Boolean(userId),
  });

  // Optional all the way down. A response without `summary` is not a reason to
  // blank the page it is embedded in.
  const summary = data?.summary ?? null;

  return (
    <div className="space-y-6">
        <div>
          {/* A heading, not a title: this sits inside a profile page that
              already has one. */}
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground">
            {isMine ? "Your record" : "Their record"}
          </h2>
          {/* THIS LINE WAS NOT TRUE. "Every position they have taken" — except
              the anonymous ones, which are withheld from everybody but their
              author, so it was never every position. A document that says what
              it withholds is worth more than one that quietly withholds. */}
          <p className="mt-1 text-sm text-muted-foreground">
            {isMine
              ? "Every position you have taken, and everything said in your name — including the ones you took anonymously, which only you can see."
              : "Every position they have taken publicly. Anything they chose to take anonymously is not here, and only they can see it."}
          </p>
        </div>

        {summary ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Positions", value: summary.total },
              { label: "Backed", value: summary.support },
              { label: "Opposed", value: summary.oppose },
              // Shown, not hidden. On a platform about legislation the text
              // moves under people, and reconsidering is the correct response
              // to new information rather than something to be caught at.
              { label: "Changed my mind", value: summary.changesOfMind },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-3">
                <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {isMine && summary && (summary.standingOnOldText ?? 0) > 0 ? (
          <Link
            to="/record/review"
            className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4 transition-colors hover:border-accent/60"
          >
            <Scale className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {summary.standingOnOldText} position
                {summary.standingOnOldText === 1 ? "" : "s"} on text that has changed
              </p>
              <p className="text-xs text-muted-foreground">
                Nothing was withdrawn for you. Have a look and decide.
              </p>
            </div>
          </Link>
        ) : null}

        {isMine && Array.isArray(standing?.mostAlone) && standing.mostAlone.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase tracking-institutional text-accent">
              Where you stand alone
            </h2>
            {/* NOT A SCORE. The flattering version of this — a percentage that
                goes up for agreeing with people — would teach that being with
                the majority is the goal. The useful half is the uncomfortable
                half: the positions worth being certain about. */}
            <p className="mt-1 text-xs text-muted-foreground">
              You are with most people on {standing.withMajority} of {standing.measured}. These are
              the ones where you are not.
            </p>

            <ul className="mt-3 space-y-2">
              {standing.mostAlone.slice(0, 5).map((entry) => (
                <li key={entry.reference.id} className="text-sm">
                  <Link
                    to={`/reference/${entry.reference.id}`}
                    className="text-foreground hover:underline"
                  >
                    {entry.reference.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {" — you "}
                    {entry.yourPosition === "support" ? "backed" : "opposed"} it, with{" "}
                    <span className="font-mono">{entry.agreementPct}%</span> of the room
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {isMine && Array.isArray(receipts?.results) && receipts.results.length > 0 ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-institutional text-accent">
              <Users className="h-4 w-4" aria-hidden="true" />
              Spoken in your name
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              You lent your voice. This is what was done with it.
            </p>

            <ul className="mt-3 space-y-2">
              {receipts.results.slice(0, 8).map((receipt) => (
                <li key={receipt.referenceId} className="text-sm">
                  <Link
                    to={`/reference/${receipt.referenceId}`}
                    className="text-foreground hover:underline"
                  >
                    {receipt.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {" — "}
                    <span
                      className={
                        receipt.position === "support" ? "text-support" : "text-oppose"
                      }
                    >
                      {receipt.position === "support" ? "backed" : "opposed"}
                    </span>{" "}
                    by {receipt.castBy.name}
                    {/* The case worth showing: a voice travels the chain, so it
                        can land with somebody the citizen never chose. */}
                    {receipt.lentTo ? (
                      <span className="text-accent">
                        {" "}
                        — you lent this to {receipt.lentTo.name}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>

            <Link
              to="/delegates"
              className="mt-3 inline-block text-xs text-accent hover:underline"
            >
              Change who speaks for you
            </Link>
          </div>
        ) : null}

        {/* SOMEBODY ELSE'S RECORD STOPS HERE, at the numbers, until a reader
            asks for the rest. Nothing is hidden that was not already public —
            the same list is one click away and needs no account — but reading
            what a stranger has ever voted for is now something you do on
            purpose rather than something that happens to you while looking at
            their picture. */}
        {summaryOnly ? (
          <Link
            to={`/user/${userId}/record`}
            data-testid="see-full-record"
            className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/60"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                See what they backed and opposed
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Every public position, with the version of the law it was taken on.
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : !Array.isArray(data?.results) || data.results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-display text-lg text-foreground">
              {isMine ? "You have not taken a position yet" : "No positions yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isMine
                ? "Back or oppose a law and it will appear here, permanently."
                : "They have not backed or opposed anything yet."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {data.results.map((entry) => (
              <PositionRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
    </div>
  );
}
