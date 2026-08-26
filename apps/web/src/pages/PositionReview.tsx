import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { failureMessage } from "@/lib/request-failure";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { recordApi, type PositionNeedingReview } from "@/lib/civic";

/**
 * "You backed this in March. It has been amended since. Still with it?"
 *
 * A tally built from positions taken on text that no longer exists is a number
 * about nothing, and the only person who can fix any one of them is the person
 * who took it.
 *
 * NOTHING IS WITHDRAWN AUTOMATICALLY, and the screen says so. Silence is not a
 * change of mind, and a platform that decides on your behalf what your silence
 * meant has taken the position for you.
 */
function ReviewRow({ entry }: { entry: PositionNeedingReview }) {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["positions-review"] });
    void queryClient.invalidateQueries({ queryKey: ["positions"] });
  };

  // Re-affirming is a withdraw followed by the same position again, which is
  // what the vote endpoint's toggle does. The record keeps both acts, and
  // returning to where you were is not counted as a change of mind.
  const reaffirm = useMutation({
    mutationFn: async () => {
      await api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
      });
      return api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
        reason: "Re-read it after the change and stand by this.",
      });
    },
    onSuccess: () => {
      toast.success("Still with it", { description: "Recorded against the current text." });
      refresh();
    },
    onError: () => toast.error("Couldn't record that"),
  });

  const withdraw = useMutation({
    mutationFn: () =>
      api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
      }),
    onSuccess: () => {
      toast.success("Withdrawn", { description: "Your position is off this record." });
      refresh();
    },
    onError: () => toast.error("Couldn't withdraw that"),
  });

  const busy = reaffirm.isPending || withdraw.isPending;

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <Link
        to={`/reference/${entry.reference.id}`}
        className="block font-medium text-foreground hover:underline"
      >
        {entry.reference.title}
      </Link>

      <p className="mt-1 text-sm text-muted-foreground">
        You {entry.position === "support" ? "backed" : "opposed"} this on{" "}
        {new Date(entry.takenAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        , when it was on version {entry.takenOnVersion}. It is now on version{" "}
        {entry.nowAtVersion}.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => reaffirm.mutate()}>
          <Check className="mr-1.5 h-4 w-4" />
          Still with it
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => withdraw.mutate()}>
          <Undo2 className="mr-1.5 h-4 w-4" />
          Withdraw
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link to={`/reference/${entry.reference.id}`}>Read what changed</Link>
        </Button>
      </div>
    </li>
  );
}

export default function PositionReview() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["positions-review"],
    queryFn: recordApi.needingReview,
  });

  const entries = data?.results ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-5">
        {/* THE HEADING WAS A CLAIM, AND IT WAS PRINTED BEFORE ANYTHING WAS
            KNOWN. "The text moved — these laws changed after you took a
            position on them" sat above an empty list that said "Nothing to
            review", and above a failed request that knew nothing at all. On a
            page about not putting words in somebody's mouth, the title was
            doing exactly that. The claim now belongs to the list, which is the
            only part that has evidence for it. */}
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Positions to review
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            When a law changes after you took a position on it, it waits here. Nothing is ever
            withdrawn for you — silence is not a change of mind.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-display text-lg text-foreground">
              {failureMessage(error, "your positions").title}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {failureMessage(error, "your positions").detail}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-4 text-sm font-medium text-amber-500 hover:underline"
            >
              Try again
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-display text-lg text-foreground">Nothing to review</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Every position you hold was taken on the text as it stands.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              The text of {entries.length === 1 ? "this law" : "these laws"} moved after you took a
              position.
            </p>
            <p className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3 text-sm text-accent">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              Your vote still counts on each of these until you say otherwise.
            </p>
            <ul className="space-y-3">
              {entries.map((entry) => (
                <ReviewRow key={entry.reference.id} entry={entry} />
              ))}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}
