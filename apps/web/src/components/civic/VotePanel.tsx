import { ThumbsUp, ThumbsDown, Loader2, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PublicPulseBar } from "@/components/civic/PublicPulseBar";
import { cn } from "@/lib/utils";
import { supportPct, type GovReferenceDetail, type VotePosition } from "@/lib/civic";
import { useVote } from "@/hooks/use-vote";
import { useAuthUI, useCurrentUser } from "@/hooks/use-civic-auth";

export function VotePanel({ reference }: { reference: GovReferenceDetail }) {
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const vote = useVote(reference.id);

  const pct = supportPct(reference.votes);
  const opposePct = reference.votes.total ? 100 - pct : 0;

  function handleVote(position: VotePosition) {
    if (!isAuthenticated) {
      openAuth("Sign up to cast your vote and shape the Public Pulse.");
      return;
    }
    vote.mutate(position);
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
