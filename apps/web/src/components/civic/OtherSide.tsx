import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Scale } from "lucide-react";
import { api } from "@/lib/api";

interface OtherSideResponse {
  yourPosition: string | null;
  otherPosition: string | null;
  results: Array<{
    id: string;
    content: string;
    author: { id: string; displayName: string; username: string; avatar: string };
    commentsCount: number;
    likesCount: number;
    createdAt: string;
  }>;
  reason: string | null;
}

/**
 * What people who landed on the opposite side of this actually wrote.
 *
 * NOT AN ALGORITHM AND NOT A PANEL SOMEBODY CHOSE. Every other platform's
 * version of this either learns that outrage travels furthest, or hands the job
 * to an editor — and both end up showing the worst version of the other
 * argument, because that is what performs and what is easy to dismiss.
 *
 * Here the other side is not inferred. Every post is attached to a government
 * record and every citizen's position on that record is known, so this is
 * literally the people who voted the opposite way on this exact bill and then
 * wrote about it. Ordered by how much people engaged with the argument rather
 * than how much they liked it: a post nobody replied to is not the strongest
 * case for anything.
 *
 * Shows nothing until the reader has taken a position of their own. Without one
 * there is no "other" side, and picking one for them is the thing being avoided.
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
interface OtherSideProps {
  referenceId: string;
  /** False until this panel's turn in the page's load order. */
  ready?: boolean;
}

export function OtherSide({ referenceId, ready = true }: OtherSideProps) {
  const { data } = useQuery({
    queryKey: ["other-side", referenceId],
    queryFn: () =>
      api.get<OtherSideResponse>(`/api/government-references/${referenceId}/other-side`),
    enabled: Boolean(referenceId) && ready,
  });

  // A backend that answers this route with something else — an error envelope,
  // an empty object, an older deploy with no such route — must leave the panel
  // blank rather than take the page down with it. Checking one field and then
  // reading another is how the Government page white-screened once already.
  if (!Array.isArray(data?.results)) return null;
  if (data.reason === "take-a-position-first") return null;
  if (data.results.length === 0) return null;

  const theirSide = data.otherPosition === "support" ? "backed it" : "opposed it";

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-institutional text-accent">
        <Scale className="h-4 w-4" aria-hidden="true" />
        The other side
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        You {data.yourPosition === "support" ? "backed this" : "opposed this"}. These people{" "}
        {theirSide} and said why.
      </p>

      <ul className="mt-4 space-y-3">
        {data.results.map((entry) => (
          <li key={entry.id} className="rounded-xl border border-border bg-background/50 p-3">
            <Link
              to={`/user/${entry.author.id}`}
              className="text-sm font-semibold text-foreground hover:underline"
            >
              {entry.author.displayName}
            </Link>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {entry.content}
            </p>
            {entry.commentsCount > 0 ? (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {entry.commentsCount} {entry.commentsCount === 1 ? "reply" : "replies"}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
