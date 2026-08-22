import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Hash } from "lucide-react";
import { api } from "@/lib/api";

/**
 * What people are tagging their posts with.
 *
 * The endpoint behind this has existed for a long time, ranked by a trending
 * score, and answered with an empty list every single time — because nothing
 * wrote to the table it reads. Now that posts file their tags, it has something
 * to say, and each one leads to a page.
 *
 * Renders nothing at all when there are no tags. An empty "Trending" panel on a
 * new platform reads as broken; no panel reads as a platform that is new.
 */
export function TrendingHashtags() {
  const { data } = useQuery({
    queryKey: ["trending-hashtags"],
    queryFn: () =>
      api.get<{ hashtags: Array<{ tag: string; count: number }> }>(
        "/api/feed/trending-hashtags",
      ),
  });

  const hashtags = data?.hashtags ?? [];
  if (hashtags.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-institutional text-accent">
        <Hash className="h-4 w-4" aria-hidden="true" />
        Trending tags
      </h2>

      <ul className="mt-3 flex flex-wrap gap-2">
        {hashtags.map((entry) => (
          <li key={entry.tag}>
            <Link
              to={`/hashtag/${entry.tag}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-foreground transition-colors hover:border-accent/50 hover:text-accent"
            >
              #{entry.tag}
              <span className="font-mono text-xs text-muted-foreground">{entry.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
