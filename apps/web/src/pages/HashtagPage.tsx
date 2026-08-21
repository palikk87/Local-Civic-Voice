import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Hash } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { postsApi } from "@/lib/civic";

/**
 * Everything written under one tag.
 *
 * Hashtags were collected into their own table and ranked into a trending list
 * long before anything wrote to that table or any page could show one. So the
 * tags were plain text in a post, the trending list was always empty, and the
 * whole feature was a schema.
 */
export default function HashtagPage() {
  const { tag = "" } = useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["hashtag", tag],
    queryFn: () => postsApi.hashtag(tag),
    enabled: tag.length > 0,
  });

  const posts = data?.results ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center gap-2">
          <Hash className="h-6 w-6 text-accent" aria-hidden="true" />
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {tag}
          </h1>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-display text-lg text-foreground">Nothing under this tag yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Write a post with #{tag} in it and it will show up here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((post) => (
              <Link
                key={post.id}
                to={
                  post.governmentReferenceId
                    ? `/reference/${post.governmentReferenceId}`
                    : "/timeline"
                }
                className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/40"
              >
                <p className="text-sm font-semibold text-foreground">
                  {post.author.displayName}{" "}
                  <span className="font-normal text-muted-foreground">
                    @{post.author.username}
                  </span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {post.content}
                </p>
                {post.referenceTitle ? (
                  <p className="mt-2 truncate text-xs text-muted-foreground">
                    on {post.referenceTitle}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
