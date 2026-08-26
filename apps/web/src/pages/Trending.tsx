import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ReferenceCard } from "@/components/civic/ReferenceCard";
import { Skeleton } from "@/components/ui/skeleton";
import { civicApi, type GovReference } from "@/lib/civic";
import { failureMessage } from "@/lib/request-failure";

interface TrendingResponse {
  references: GovReference[];
}

export default function Trending() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["trending-references"],
    queryFn: () =>
      civicApi.listReferences({
        sortBy: "supportVotes",
        sortOrder: "desc",
        limit: 30,
      }),
  });

  const references = data?.references ?? [];

  return (
    <AppShell wide>
      <div className="space-y-6">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <TrendingUp className="h-6 w-6 text-accent" />
            Trending
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The most discussed and voted on legislation right now.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-lg" />
              ))}
            </>
          ) : isError ? (
            /* NOT THE SAME AS QUIET. An unreachable server used to render the
               empty state below, which told readers nobody was voting or
               posting on anything — a claim about the country, made because a
               socket died. See docs/IF_THE_API_HOST_GOES_AWAY.md. */
            <div className="col-span-full rounded-xl border border-dashed border-border py-20 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                {failureMessage(error, "what's trending").title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {failureMessage(error, "what's trending").detail}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-4 text-sm font-medium text-amber-500 hover:underline"
              >
                Try again
              </button>
            </div>
          ) : references.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border py-20 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                No trending references
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start voting and posting to see what's trending.
              </p>
            </div>
          ) : (
            references.map((ref, i) => (
              <ReferenceCard key={ref.id} reference={ref} index={i} />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
