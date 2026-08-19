import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, BarChart3 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Vote {
  id: string;
  referenceId: string;
  referenceTitle: string;
  referenceType: string;
  position: "support" | "oppose";
  createdAt: string;
}

interface VotesResponse {
  votes: Vote[];
  nextCursor?: string;
  hasMore: boolean;
}

function VoteItem({ vote }: { vote: Vote }) {
  const isSupport = vote.position === "support";

  return (
    <Link
      to={`/reference/${vote.referenceId}`}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card/80"
    >
      <div className="flex items-start gap-4">
        <div className={`mt-1 rounded-full p-2 ${isSupport ? "bg-green-500/10" : "bg-red-500/10"}`}>
          {isSupport ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <Badge
            variant={isSupport ? "default" : "destructive"}
            className="mb-2 text-xs"
          >
            {isSupport ? "Support" : "Oppose"}
          </Badge>
          <h3 className="font-semibold text-foreground line-clamp-2">
            {vote.referenceTitle}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">
            {vote.referenceType.replace("_", " ").toUpperCase()} · {new Date(vote.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>
    </Link>
  );
}

export default function VotingHistory() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["user-votes"],
      queryFn: ({ pageParam }) => {
        const query = new URLSearchParams({
          limit: "20",
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        return api.get<VotesResponse>(`/api/users/me/votes?${query}`);
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
    });

  const votes = data?.pages?.flatMap((p) => p.votes ?? []) ?? [];
  const supportCount = votes.filter((v) => v.position === "support").length;
  const opposeCount = votes.filter((v) => v.position === "oppose").length;

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <BarChart3 className="h-6 w-6 text-accent" />
            Voting history
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review all your votes on legislation, executive orders, and court cases.
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Total votes</p>
            <p className="mt-2 font-display text-2xl font-semibold text-foreground">
              {votes.length}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Support</p>
            <p className="mt-2 font-display text-2xl font-semibold text-green-600">
              {supportCount}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Oppose</p>
            <p className="mt-2 font-display text-2xl font-semibold text-red-600">
              {opposeCount}
            </p>
          </div>
        </div>

        {/* Votes list */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-40" />
                </div>
              ))}
            </>
          ) : votes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                No votes yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Browse and vote on legislation in the Explore section.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {votes.map((vote) => (
                  <VoteItem key={vote.id} vote={vote} />
                ))}
              </div>

              {hasNextPage ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
