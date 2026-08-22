import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, ThumbsDown, ThumbsUp, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The first five minutes: start from where you stand, not from who is popular.
 *
 * WHY NOT THE USUAL ONBOARDING. Every social platform opens by asking a new
 * arrival to pick five accounts to follow, ranked by size. That one screen does
 * most of the damage everybody complains about later: it sorts a person into a
 * camp before they have said anything, it rewards whoever is already loudest,
 * and the feed it produces is a prediction about who they are rather than a
 * record of what they think.
 *
 * This platform can open the other way round, because it has public records
 * with public positions on them. The first thing a new citizen does here is
 * take positions on the records the room is most split about. Only then are
 * they shown people — chosen by whether they actually agreed, in BOTH
 * directions, and offered rather than recommended.
 */
interface StarterRecord {
  id: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  category: string | null;
  status: string;
  support: number;
  oppose: number;
  contested: number;
}

interface Neighbour {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  bio: string | null;
  shared: number;
  agreed: number;
  disagreed: number;
  agreementPct: number | null;
}

interface NeighboursResponse {
  positions: number;
  needed: number;
  agree: Neighbour[];
  disagree: Neighbour[];
}

function avatarOf(person: { id: string; image: string | null }) {
  return person.image ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${person.id}`;
}

function PersonRow({ person }: { person: Neighbour }) {
  const queryClient = useQueryClient();
  const [followed, setFollowed] = useState(false);

  const follow = useMutation({
    mutationFn: () => api.post(`/api/users/${person.id}/follow`),
    onSuccess: () => {
      setFollowed(true);
      void queryClient.invalidateQueries({ queryKey: ["start-neighbours"] });
    },
    onError: () => toast.error("Couldn't follow them"),
  });

  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
      <Link to={`/user/${person.id}`}>
        <img src={avatarOf(person)} alt="" className="h-10 w-10 rounded-full" />
      </Link>

      <div className="min-w-0 flex-1">
        <Link to={`/user/${person.id}`} className="font-medium text-foreground hover:underline">
          {person.name}
        </Link>
        <p className="text-xs text-muted-foreground">
          Agreed with you on {person.agreed} of {person.shared} records you both voted on
          {person.agreementPct === null ? "" : ` (${person.agreementPct}%)`}.
        </p>
        {person.bio ? (
          <p className="mt-1 line-clamp-2 text-sm text-foreground/80">{person.bio}</p>
        ) : null}
      </div>

      <button
        disabled={followed || follow.isPending}
        onClick={() => follow.mutate()}
        className={cn(
          "shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold",
          followed ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
        )}
      >
        {followed ? "Following" : "Follow"}
      </button>
    </li>
  );
}

export default function StartHere() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [voted, setVoted] = useState<Record<string, "support" | "oppose">>({});

  const { data: starters, isLoading } = useQuery({
    queryKey: ["start-records"],
    queryFn: () => api.get<{ results: StarterRecord[] }>("/api/onboarding/records"),
  });

  const { data: people } = useQuery({
    queryKey: ["start-neighbours"],
    queryFn: () => api.get<NeighboursResponse>("/api/onboarding/neighbours"),
  });

  const vote = useMutation({
    mutationFn: ({ id, position }: { id: string; position: "support" | "oppose" }) =>
      api.post(`/api/government-references/${id}/vote`, { position }),
    onSuccess: (_result, variables) => {
      setVoted((was) => ({ ...was, [variables.id]: variables.position }));
      void queryClient.invalidateQueries({ queryKey: ["start-neighbours"] });
    },
    onError: () => toast.error("Couldn't record that"),
  });

  const records = Array.isArray(starters?.results) ? starters.results : [];
  const agree = Array.isArray(people?.agree) ? people.agree : [];
  const disagree = Array.isArray(people?.disagree) ? people.disagree : [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-8 px-4 py-6">
        <header>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Start from where you stand
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Most platforms open by asking you to pick people to follow. This one asks what you
            think first, and finds the people afterwards — the ones who agreed with you and the
            ones who did not.
          </p>
        </header>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-institutional text-accent">
            What the room is most split about
          </h2>
          {/* THE MOST CONTESTED RECORDS, NOT THE MOST POPULAR. A record where
              97% agree teaches a newcomer nothing about themselves. */}
          <p className="mt-1 text-xs text-muted-foreground">
            No wrong answers, and you can change any of these later — every position you take is
            kept, and so is every change of mind.
          </p>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
          ) : records.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nobody has voted on enough records yet for this to mean anything.{" "}
              <Link to="/library" className="text-accent hover:underline">
                Go and find a law
              </Link>{" "}
              instead.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {records.map((record) => {
                const mine = voted[record.id];
                return (
                  <li key={record.id} className="rounded-xl border border-border bg-card p-4">
                    <Link
                      to={`/reference/${record.id}`}
                      className="block font-medium text-foreground hover:underline"
                    >
                      {record.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {record.support} for, {record.oppose} against so far.
                    </p>

                    <div className="mt-3 flex gap-2">
                      <button
                        disabled={vote.isPending}
                        onClick={() => vote.mutate({ id: record.id, position: "support" })}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold",
                          mine === "support"
                            ? "bg-support text-white"
                            : "bg-muted text-foreground",
                        )}
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Back it
                      </button>

                      <button
                        disabled={vote.isPending}
                        onClick={() => vote.mutate({ id: record.id, position: "oppose" })}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold",
                          mine === "oppose" ? "bg-oppose text-white" : "bg-muted text-foreground",
                        )}
                      >
                        <ThumbsDown className="h-4 w-4" />
                        Oppose it
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-institutional text-accent">
            <Users className="h-4 w-4" aria-hidden="true" />
            Then the people
          </h2>

          {people && people.needed > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Take {people.needed} more position{people.needed === 1 ? "" : "s"} and this fills in.
              Two shared votes is a coincidence; nobody should be introduced to you as a match on
              a coincidence.
            </p>
          ) : agree.length === 0 && disagree.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Nobody else has voted on the same records yet. Come back once they have.
            </p>
          ) : (
            <div className="mt-3 grid gap-6 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-support">
                  With you most often
                </p>
                <ul className="mt-2 space-y-2">
                  {agree.map((person) => (
                    <PersonRow key={person.id} person={person} />
                  ))}
                </ul>
              </div>

              <div>
                {/* BOTH LISTS, ALWAYS. Offering only the agreements would build
                    the echo chamber on the first screen — which is exactly what
                    a follow-the-popular-accounts onboarding does by accident. */}
                <p className="text-xs font-semibold uppercase tracking-wider text-oppose">
                  Against you most often
                </p>
                <ul className="mt-2 space-y-2">
                  {disagree.map((person) => (
                    <PersonRow key={person.id} person={person} />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        <button
          onClick={() => navigate("/feed")}
          className="flex items-center gap-2 text-sm font-semibold text-accent hover:underline"
        >
          Go to the feed
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </AppShell>
  );
}
