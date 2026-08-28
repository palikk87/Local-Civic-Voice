import { ThumbsUp, ThumbsDown, Loader2, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Checkbox } from "@/components/ui/checkbox";
import { votePreferences } from "@/lib/mobile/vote-anonymity";
import { Button } from "@/components/ui/button";
import { PublicPulseBar } from "@/components/civic/PublicPulseBar";
import { PulseBreakdown } from "@/components/civic/PulseBreakdown";
import { cn } from "@/lib/utils";
import { supportPct, type GovReferenceDetail, type VotePosition } from "@/lib/civic";
import { useVote } from "@/hooks/use-vote";
import { useAuthUI, useCurrentUser } from "@/hooks/use-civic-auth";

export function VotePanel({ reference }: { reference: GovReferenceDetail }) {
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const vote = useVote(reference.id);

  /**
   * WITHOUT MY NAME, FOR THIS ONE.
   *
   * The standing choice lives in Settings and is what every other surface
   * follows. This page has room to show it and to depart from it for a single
   * record, which is the case worth having: most of somebody's positions are
   * ordinary and one of them is about their own health, their immigration
   * status, or their religion.
   *
   * `null` while we do not yet know the standing choice — the box is not
   * rendered rather than rendered wrong, because a checkbox that starts in the
   * opposite state to your setting and then flips is worse than a slow one.
   */
  const [anonymous, setAnonymous] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let live = true;
    void votePreferences().then((preferences) => {
      if (live && preferences) setAnonymous(preferences.voteAnonymously);
    });
    return () => {
      live = false;
    };
  }, [isAuthenticated]);

  const pct = supportPct(reference.votes);
  const opposePct = reference.votes.total ? 100 - pct : 0;

  function handleVote(position: VotePosition) {
    if (!isAuthenticated) {
      openAuth("Sign up to cast your vote and shape the Public Pulse.");
      return;
    }
    // Undefined until the standing choice has loaded, which lets the server
    // apply it rather than this page guessing at it.
    vote.mutate({ position, anonymous: anonymous ?? undefined });
  }

  const userVote = reference.userVote;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-institutional text-accent">
        <ScrollText className="h-4 w-4" />
        Public Pulse
      </div>

      {/* Article III transparency framing */}
      <p className="mt-2 text-xs text-muted-foreground">
        Per Article III, every tally is a public record. Here is the exact math.
      </p>

      <div className="mt-5">
        <PublicPulseBar votes={reference.votes} size="lg" showCounts={false} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-support/10 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-support">
            Support
          </div>
          <div className="mt-1 font-display text-3xl font-semibold tabular-nums text-foreground">
            {pct}%
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {reference.votes.support.toLocaleString()} votes
          </div>
        </div>
        <div className="rounded-xl bg-oppose/10 p-4 text-right">
          <div className="text-xs font-semibold uppercase tracking-wide text-oppose">
            Oppose
          </div>
          <div className="mt-1 font-display text-3xl font-semibold tabular-nums text-foreground">
            {opposePct}%
          </div>
          <div className="font-mono text-xs text-muted-foreground">
            {reference.votes.oppose.toLocaleString()} votes
          </div>
        </div>
      </div>

      <div className="mt-2 text-center font-mono text-xs text-muted-foreground">
        {reference.votes.total.toLocaleString()} total votes cast
      </div>

      {/* The exact math the line above promises: how much of this is people
          speaking for themselves, and how much is voice lent to someone else. */}
      <PulseBreakdown referenceId={reference.id} className="mt-3" />

      {/* Vote actions */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button
          size="lg"
          variant={userVote === "support" ? "default" : "outline"}
          className={cn(
            "h-12",
            userVote === "support" && "bg-support text-support-foreground hover:bg-support/90",
          )}
          disabled={vote.isPending}
          onClick={() => handleVote("support")}
        >
          {vote.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ThumbsUp className="mr-2 h-4 w-4" />
              {userVote === "support" ? "Supported" : "Support"}
            </>
          )}
        </Button>
        <Button
          size="lg"
          variant={userVote === "oppose" ? "default" : "outline"}
          className={cn(
            "h-12",
            userVote === "oppose" && "bg-oppose text-oppose-foreground hover:bg-oppose/90",
          )}
          disabled={vote.isPending}
          onClick={() => handleVote("oppose")}
        >
          {vote.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ThumbsDown className="mr-2 h-4 w-4" />
              {userVote === "oppose" ? "Opposed" : "Oppose"}
            </>
          )}
        </Button>
      </div>

      {/* WHOSE NAME IS ON THIS. It used to be nowhere near the button: the only
          switch was in Settings, off by default, so somebody who had never
          opened Settings was putting their name on public positions without
          being told. They are asked once, the first time they vote; this is
          where they can see the answer and depart from it for one record. */}
      {isAuthenticated && anonymous !== null ? (
        <div className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <Checkbox
              checked={anonymous}
              onCheckedChange={(checked) => setAnonymous(checked === true)}
              data-testid="vote-without-my-name"
              className="mt-0.5"
            />
            <span className="text-sm leading-snug text-foreground">
              Record this position without my name
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {anonymous
                  ? "Only you will see this on your record. It still counts in the Pulse."
                  : "Your name will be on this position, publicly and permanently."}
              </span>
            </span>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            This applies to this record.{" "}
            <Link to="/settings" className="underline underline-offset-2">
              Change your default
            </Link>
            .
          </p>
        </div>
      ) : null}

      {isAuthenticated ? (
        userVote ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Tap your choice again to withdraw your vote.
          </p>
        ) : null
      ) : (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          You can browse freely — voting takes 15 seconds to sign up.
        </p>
      )}
    </div>
  );
}
