import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeftRight, FileDiff } from "lucide-react";
import { api } from "@/lib/api";

interface TurningPoint {
  id: string;
  user: { id: string; displayName: string; username: string; avatar: string };
  from: string;
  to: string;
  reason: string | null;
  lawVersion: number;
  afterTextChanged: boolean;
  createdAt: string;
}

interface TurningPointsResponse {
  results: TurningPoint[];
  toSupport: number;
  toOppose: number;
  total: number;
  people: number;
  afterTextChanged: number;
}

/**
 * Who changed their mind on this law, which way, and what they said about it.
 *
 * EVERY OTHER PLATFORM MAKES THIS IMPOSSIBLE, and most make it dangerous. The
 * old post is still there and still screenshot-ready, so the rational move is
 * to never say anything you might have to walk back — which is exactly the
 * behaviour everybody complains about, people defending a position long after
 * they stopped believing it.
 *
 * Here a crossing is evidence rather than a gotcha, because the position is
 * attached to a government record and the record knows when its own text
 * changed. "Nine people moved after the amendment" is the most useful sentence
 * that can be written about a contested bill, and no feed can write it.
 */
export function TurningPoints({ referenceId }: { referenceId: string }) {
  const { data } = useQuery({
    queryKey: ["turning-points", referenceId],
    queryFn: () =>
      api.get<TurningPointsResponse>(
        `/api/government-references/${referenceId}/turning-points`,
      ),
    enabled: Boolean(referenceId),
  });

  // An unexpected shape leaves the panel blank rather than taking down the page
  // it sits on. Checking one field and then reading another is how the
  // Government page white-screened once already.
  if (!Array.isArray(data?.results)) return null;
  if (data.results.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-institutional text-accent">
        <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
        Who changed their mind
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {data.people} {data.people === 1 ? "person has" : "people have"} crossed sides on this
        {data.toSupport > 0 && data.toOppose > 0
          ? ` — ${data.toSupport} toward backing it, ${data.toOppose} toward opposing it`
          : data.toSupport > 0
            ? ", every one of them toward backing it"
            : ", every one of them toward opposing it"}
        .
        {data.afterTextChanged > 0 ? (
          <>
            {" "}
            <span className="text-accent">
              {data.afterTextChanged} moved after the text was amended.
            </span>
          </>
        ) : null}
      </p>

      <ul className="mt-4 space-y-3">
        {data.results.map((move) => (
          <li key={move.id} className="flex gap-3">
            <img
              src={move.user.avatar}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full bg-muted"
            />
            <div className="min-w-0">
              <p className="text-sm">
                <Link
                  to={`/user/${move.user.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {move.user.displayName}
                </Link>{" "}
                <span className="text-muted-foreground">went from</span>{" "}
                <span className={move.from === "support" ? "text-support" : "text-oppose"}>
                  {move.from === "support" ? "backing it" : "opposing it"}
                </span>{" "}
                <span className="text-muted-foreground">to</span>{" "}
                <span className={move.to === "support" ? "text-support" : "text-oppose"}>
                  {move.to === "support" ? "backing it" : "opposing it"}
                </span>
              </p>

              {/* The reason they gave, in their words. Never summarised and
                  never generated — a stated reason for moving is the most
                  valuable thing on this page and paraphrasing it would make it
                  the platform's sentence rather than theirs. */}
              {move.reason ? (
                <p className="mt-1 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                  {move.reason}
                </p>
              ) : null}

              {move.afterTextChanged ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-accent">
                  <FileDiff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  After reading version {move.lawVersion}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Changing your mind is recorded here, not held against you. The text of a law moves and so
        should a position on it.
      </p>
    </div>
  );
}
