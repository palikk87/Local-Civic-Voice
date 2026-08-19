import { useInfiniteQuery } from "@tanstack/react-query";
import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PostCard } from "@/components/feed/PostCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

import { type Post } from "@/lib/civic";

interface SavedResponse {
  posts: Post[];
  nextCursor?: string;
  hasMore: boolean;
}

export default function Saved() {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["saved-posts"],
      queryFn: ({ pageParam }) => {
        const query = new URLSearchParams({
          limit: "20",
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        return api.get<SavedResponse>(`/api/feed/saved?${query}`);
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
    });

  const posts = data?.pages?.flatMap((p) => p.posts ?? []) ?? [];

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <Bookmark className="h-6 w-6 text-accent" />
            Saved posts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your reading list of posts you want to revisit.
          </p>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </>
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center">
              <Bookmark className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                No saved posts yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Save posts you want to read later from the feed.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}
              </div>

              {hasNextPage ? (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
