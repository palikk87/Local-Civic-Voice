/**
 * The law under a post, drawn the same way everywhere.
 *
 * WHAT WAS WRONG. Three card implementations on this web app, and a fourth
 * written inline on the profile page, each drew an attached law differently —
 * or, on the profile, drew a title and a badge and nothing else. The same post
 * looked like a different kind of object depending on which screen you found it
 * on, and the profile's version had no tally, no author block and no buttons.
 * Reported plainly: "the posts and shares on their profile should look the same
 * as they do on feed and time line."
 *
 * THE DATA WAS ALWAYS THERE. GET /api/posts batch-loads the full record for
 * every post in a page — status, category, source, the live tally, and the
 * reader's own position — precisely so a card can render all of it. Nothing on
 * the web read it. The server did the work and three cards threw it away.
 *
 * LIVE, NOT FROZEN. The tally is the record's, read at request time, not a
 * number copied into the post when it was written. The record is shared; the
 * post only frames it. A count copied at posting time is wrong by the next
 * vote, and every card showing a different one is worse than showing none.
 */
import { ChevronRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { recordPath } from "@/lib/record-url";
import { toast } from "sonner";
import { useVote } from "@/hooks/use-vote";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import type { PostReference } from "@/lib/civic";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  bill: "Bill",
  executive_order: "Executive Order",
  scotus_case: "Supreme Court",
};

export function AttachedLaw({
  reference,
  /** The law has moved since this post was written. */
  stale = false,
}: {
  reference: PostReference;
  stale?: boolean;
}) {
  const navigate = useNavigate();
  const vote = useVote(reference.id);
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();

  const total = reference.votes.total;
  // No votes is no votes. A denominator of one to avoid dividing by zero would
  // publish "Aye 0% / Nay 0%" as though somebody had been counted.
  const ayePct = total > 0 ? Math.round((reference.votes.support / total) * 100) : 0;
  const nayPct = total > 0 ? 100 - ayePct : 0;

  const cast = (position: "support" | "oppose") => {
    if (!isAuthenticated) {
      openAuth("Sign in to take a position on this law.");
      return;
    }
    vote.mutate({ position }, {
      onError: () => toast.error("Could not record your vote. Try again."),
    });
  };

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
          {TYPE_LABEL[reference.referenceType] ?? "Record"}
        </span>
        {reference.category ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
            {reference.category}
          </span>
        ) : null}
        {stale ? (
          // Not a warning about the post. The post is untouched; the law under
          // it moved after it was written, and the reader deserves to know
          // which of the two changed.
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
            Law changed since posting
          </span>
        ) : null}
      </div>

      <Link
        to={`/reference/${reference.id}`}
        className="block font-display text-base font-semibold leading-snug text-foreground hover:underline"
      >
        {reference.title}
      </Link>
      {reference.displayId ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{reference.displayId}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {total === 0
            ? "No positions taken yet"
            : `${total.toLocaleString()} community ${total === 1 ? "vote" : "votes"}`}
        </span>
        {/* A link, for the same reason as the one on the feed card: a crawler
            follows hrefs and does not click buttons. */}
        <Link
          to={recordPath(reference)}
          className="inline-flex shrink-0 items-center rounded-full bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent"
        >
          See details
          <ChevronRight className="ml-1 h-3 w-3" />
        </Link>
      </div>

      {/* The bar only means something once somebody has voted. Empty rather
          than a full green bar at 0%, which reads as unanimous support. */}
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        {total > 0 ? (
          <div
            className="h-full rounded-l-full bg-support transition-all"
            style={{ width: `${ayePct}%` }}
          />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => cast("support")}
          disabled={vote.isPending}
          aria-pressed={reference.userVote === "support"}
          className={cn(
            "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-transform active:scale-95",
            reference.userVote === "support"
              ? "bg-support text-slate-900"
              : "bg-secondary text-support",
          )}
        >
          <ThumbsUp className="mr-1.5 h-4 w-4" />
          Aye {total > 0 ? `${ayePct}%` : ""}
        </button>
        <button
          type="button"
          onClick={() => cast("oppose")}
          disabled={vote.isPending}
          aria-pressed={reference.userVote === "oppose"}
          className={cn(
            "inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold transition-transform active:scale-95",
            reference.userVote === "oppose"
              ? "bg-oppose text-slate-900"
              : "bg-secondary text-oppose",
          )}
        >
          <ThumbsDown className="mr-1.5 h-4 w-4" />
          Nay {total > 0 ? `${nayPct}%` : ""}
        </button>
      </div>
    </div>
  );
}
