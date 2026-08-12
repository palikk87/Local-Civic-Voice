import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Heart, MessageCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { postsApi, branchOf, relativeTime, type Post, type ReferenceType } from "@/lib/civic";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function branchColor(type: ReferenceType | null): string {
  if (type === "bill") return "hsl(var(--legislative))";
  if (type === "executive_order") return "hsl(var(--executive))";
  if (type === "scotus_case") return "hsl(var(--judicial))";
  return "hsl(var(--accent))";
}

export function PostCard({ post }: { post: Post }) {
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();

  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(post.likesCount);

  const likeMutation = useMutation({
    mutationFn: () => postsApi.like(post.id),
    onError: () => {
      // revert optimistic toggle
      setLiked((prev) => !prev);
      setLikes((prev) => prev + (liked ? 1 : -1));
      toast.error("Couldn't update like");
    },
  });

  function handleLike() {
    if (!isAuthenticated) {
      openAuth("Sign in to like posts");
      return;
    }
    const next = !liked;
    setLiked(next);
    setLikes((prev) => prev + (next ? 1 : -1));
    likeMutation.mutate();
  }

  function handleShare() {
    const url = post.referenceId
      ? `${window.location.origin}/reference/${post.referenceId}`
      : window.location.origin;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy link"));
  }

  const branch = post.referenceType ? branchOf(post.referenceType) : null;
  const color = branchColor(post.referenceType);
  const initials = initialsOf(post.author.displayName || post.author.username || "?");

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-accent/40">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10 border border-border">
          {post.author.avatar ? (
            <AvatarImage src={post.author.avatar} alt={post.author.displayName} />
          ) : null}
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-foreground">
            {post.author.displayName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{post.author.username} · {relativeTime(post.createdAt)}
          </p>
        </div>
      </div>

      {/* Reference chip */}
      {post.referenceId && post.referenceTitle ? (
        <Link
          to={`/reference/${post.referenceId}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:brightness-110"
          style={{
            color,
            borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
            backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
          }}
        >
          <span className="opacity-70">on</span>
          <span className="truncate">{post.referenceTitle}</span>
        </Link>
      ) : null}

      {/* Content */}
      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
        {post.content}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-6 pt-1 text-muted-foreground">
        <button
          type="button"
          onClick={handleLike}
          className="group flex items-center gap-1.5 text-sm transition-colors hover:text-accent"
          aria-label="Like"
        >
          <Heart
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              liked ? "fill-accent text-accent" : "group-hover:text-accent",
            )}
          />
          <span className={cn("tabular-nums", liked ? "text-accent" : "")}>{likes}</span>
        </button>

        <Link
          to={post.referenceId ? `/reference/${post.referenceId}` : "#"}
          className="flex items-center gap-1.5 text-sm transition-colors hover:text-foreground"
          aria-label="Comment"
        >
          <MessageCircle className="h-[18px] w-[18px]" />
          <span className="tabular-nums">{post.commentsCount}</span>
        </Link>

        <button
          type="button"
          onClick={handleShare}
          className="ml-auto flex items-center gap-1.5 text-sm transition-colors hover:text-foreground"
          aria-label="Share"
        >
          <Share2 className="h-[18px] w-[18px]" />
        </button>
        {branch ? <span className="sr-only">{branch.label}</span> : null}
      </div>
    </article>
  );
}
