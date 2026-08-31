/**
 * "Share this to my timeline", from anywhere a law appears.
 *
 * WHAT WAS MISSING. Sharing existed in exactly one place: inside the Citizen's
 * Brief panel, behind a brief. Seeing a law in Discover, in Trending, or in a
 * search result, there was no way to say "that one matters to me" — the only
 * route was to open it, generate a brief, and share from there. So the thing a
 * person most wants to do at the moment they feel something took four steps and
 * a wait.
 *
 * IT RESOLVES BEFORE IT SHARES, and that is the whole reason this is a
 * component rather than a link. Cards on this platform carry two different
 * kinds of id — /api/bills returns Bill rows, the reference endpoints return
 * GovernmentReference rows — and a post must point at the master reference or
 * it joins nobody's vote count. So whatever identity a card holds is handed to
 * POST /api/government-references/resolve, which answers with the canonical
 * record, creating it from the official source if this is the first time
 * anybody has cared about it.
 *
 * IT DOES NOT POST FOR YOU. It opens the composer with the law attached and
 * the cursor waiting. Posting silently on a person's behalf, with wording they
 * did not choose, is putting words in their mouth — the same reason a shared
 * brief carries the neutral summary and leaves the case for and against on the
 * law's own card.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";

export type ShareBranch = "legislative" | "executive" | "judicial";

/** Whatever this card knows about the law. Title and branch are the minimum. */
export interface ShareTarget {
  branch: ShareBranch;
  title: string;
  sourceUrl?: string | undefined;
  summary?: string | undefined;
  masterReferenceId?: string | undefined;
  congress?: number | undefined;
  billType?: string | undefined;
  billNumber?: string | undefined;
  eoNumber?: string | undefined;
  documentNumber?: string | undefined;
  docketNumber?: string | undefined;
}

interface ResolveResponse {
  reference?: { id?: string };
}

export function ShareToTimeline({
  target,
  className,
  label = "Share",
}: {
  target: ShareTarget;
  className?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading, sessionUnavailable } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const [resolving, setResolving] = useState(false);

  async function share(event: React.MouseEvent): Promise<void> {
    // Cards are usually clickable themselves; sharing must not also open the law.
    event.stopPropagation();
    event.preventDefault();

    /*
     * THIS BUTTON MUST NEVER DO NOTHING.
     *
     * It read `sessionUnavailable` as signed out. The hook that returns it says
     * in its own docstring why that is wrong: when the API cannot be reached,
     * "you are signed out" and "I could not ask whether you are" became the same
     * answer, and fifteen routes showed a sign-in wall to people who were
     * already signed in. This was the sixteenth, and on this button the failure
     * is worse than a wall — the press produced nothing at all.
     *
     * The same goes for the moment before the session has loaded. Pressing then
     * is not a signed-out press; it is an early one, and it should say so rather
     * than open a sign-in dialog at somebody who is signed in.
     */
    if (sessionUnavailable) {
      toast.error("Couldn't check whether you're signed in. Try again in a moment.");
      return;
    }

    if (isLoading) {
      toast("Still checking your session — press it again in a second.");
      return;
    }

    if (!isAuthenticated) {
      openAuth("Sign in to share this to My Voice");
      return;
    }

    setResolving(true);
    try {
      const response = await fetch("/api/government-references/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(target),
      });

      if (!response.ok) {
        // Deliberately not a silent failure and not a guess. If the official
        // source cannot identify this document, sharing it would attach a post
        // to a record nobody can verify.
        toast.error("Couldn't identify this document at its official source.");
        return;
      }

      const referenceId = ((await response.json()) as ResolveResponse).reference?.id;
      if (!referenceId) {
        toast.error("Couldn't identify this document at its official source.");
        return;
      }

      // Straight to their own timeline, where the composer picks this up,
      // attaches the law, and waits for them to write. In the URL rather than
      // in memory so a refresh does not lose it.
      navigate(`/timeline?share=${encodeURIComponent(referenceId)}`);
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setResolving(false);
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      disabled={resolving}
      aria-label={`Share ${target.title} to My Voice`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        "text-muted-foreground transition-colors hover:bg-accent/15 hover:text-accent",
        "disabled:opacity-60",
        className,
      )}
    >
      {resolving ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      {label}
    </button>
  );
}
