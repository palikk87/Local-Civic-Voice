import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CommentCard } from "./CommentCard";
import { ComposeComment } from "./ComposeComment";
import { api } from "@/lib/api";

interface Comment {
  id: string;
  content: string;
  author: {
    id: string;
    displayName: string;
    username: string;
    avatar: string;
  };
  repliesCount: number;
  createdAt: string;
}

export function CommentThread({ postId }: { postId: string }) {
  const [showCompose, setShowCompose] = useState(false);

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["post-comments", postId],
      queryFn: async ({ pageParam }) => {
        const query = new URLSearchParams({
          limit: "20",
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        return api.get<{
          comments: Comment[];
          nextCursor?: string;
          hasMore: boolean;
        }>(`/api/posts/${postId}/comments?${query}`);
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
    });

  const comments = data?.pages?.flatMap((p) => p.comments ?? []) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">
          Discussion ({comments.length})
        </h3>
      </div>

      {!showCompose ? (
        <Button
          variant="outline"
          className="w-full rounded-full"
          onClick={() => setShowCompose(true)}
        >
          Add your take…
        </Button>
      ) : (
        <ComposeComment
          postId={postId}
          onSuccess={() => setShowCompose(false)}
          onCancel={() => setShowCompose(false)}
        />
      )}

      <div className="space-y-4">
        {isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </>
        ) : comments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No comments yet. Be the first to share your thoughts.
            </p>
          </div>
        ) : (
          <>
            {comments.map((comment) => (
              <CommentCard key={comment.id} comment={comment} postId={postId} />
            ))}

            {hasNextPage ? (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more comments"}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
