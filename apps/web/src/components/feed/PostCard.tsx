import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, Heart, MessageCircle, Repeat2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar, PersonHandle, PersonName } from "@/components/people/PersonLink";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { postsApi, branchOf, relativeTime, type Post, type ReferenceType } from "@/lib/civic";
import { cn } from "@/lib/utils";


function branchColor(type: ReferenceType | null): string {
  if (type === "bill") return "hsl(var(--legislative))";
  if (type === "executive_order") return "hsl(var(--executive))";
  if (type === "scotus_case") return "hsl(var(--judicial))";
  return "hsl(var(--accent))";
}

/**
 * Post text with its hashtags turned into links.
 *
 * A tag was plain text everywhere, so the trending list — when it eventually
 * has anything in it — pointed at nothing a reader could reach.
 *
 * Same rules the server files them under: letters, numbers and underscore, and
 * never all digits, so "ranked #1" stays a sentence rather than becoming a
 * topic nobody meant to create.
 */
function withHashtagLinks(text: string) {
  const parts = text.split(/(#[A-Za-z0-9_]{1,64})\b/g);
  return parts.map((part, index) => {
    if (!part.startsWith("#")) return part;
    const tag = part.slice(1);
    if (/^\d+$/.test(tag)) return part;
    return (
      <Link
        key={`${tag}-${index}`}
        to={`/hashtag/${tag.toLowerCase()}`}
        className="text-accent hover:underline"
        onClick={(event) => event.stopPropagation()}
      >
        {part}
      </Link>
    );
  });
}

export function PostCard({ post }: { post: Post }) {
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();

  // FROM THE SERVER, NOT FROM ZERO. This started at false regardless, so a post
  // you had already liked showed an empty heart and your next tap removed the
  // like instead of adding one.
  const [liked, setLiked] = useState(post.isLiked ?? false);
  const [likes, setLikes] = useState(post.likesCount);
  const [saved, setSaved] = useState(false);
  const [reposted, setReposted] = useState(post.isRepostedByMe ?? false);
  const [reposts, setReposts] = useState(post.repostsCount ?? 0);

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

  const saveMutation = useMutation({
    mutationFn: () => postsApi.save(post.id),
    // The server says what the state now is, rather than us assuming our
    // optimistic guess was right — two quick taps otherwise leave the icon
    // disagreeing with the saved list.
    onSuccess: (result) => setSaved(Boolean(result?.saved)),
    onError: () => {
      setSaved((prev) => !prev);
      toast.error("Couldn't update your saved posts");
    },
  });

  const shareMutation = useMutation({ mutationFn: () => postsApi.share(post.id) });

  const repostMutation = useMutation({
    mutationFn: () => postsApi.repost(post.repostOf?.id ?? post.id),
    onSuccess: (result) => {
      setReposted(Boolean(result?.reposted));
      setReposts(result?.repostsCount ?? 0);
    },
    onError: () => {
      setReposted((prev) => !prev);
      setReposts((prev) => prev + (reposted ? 1 : -1));
      toast.error("Couldn't pass it on");
    },
  });

  function handleRepost() {
    if (!isAuthenticated) {
      openAuth("Sign in to pass this on");
      return;
    }
    const next = !reposted;
    setReposted(next);
    setReposts((prev) => prev + (next ? 1 : -1));
    repostMutation.mutate();
  }

  function handleSave() {
    if (!isAuthenticated) {
      openAuth("Sign in to save posts");
      return;
    }
    setSaved((prev) => !prev);
    saveMutation.mutate();
  }

  function handleShare() {
    const url = post.referenceId
      ? `${window.location.origin}/reference/${post.referenceId}`
      : window.location.origin;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied"))
      .catch(() => toast.error("Couldn't copy link"));

    // Copying the link was the whole of sharing on the web, so the author's
    // share count never moved however often their post travelled. Recorded
    // separately from the copy, because the copy is what the reader wanted and
    // must not fail on the count.
    if (isAuthenticated) shareMutation.mutate();
  }

  const branch = post.referenceType ? branchOf(post.referenceType) : null;
  const color = branchColor(post.referenceType);

  return (
    <article className="space-y-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-accent/40">
      {/* Passed on by, above everything: whose timeline this arrived through is
          the first thing a reader needs, or the post looks misattributed. */}
      {post.repostOf ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
          <PersonName person={post.author} /> passed this on
        </p>
      ) : null}

      {/* Header.
          The name and the face go to the person. They were plain text, on every
          card, so you could read somebody's argument and have no way to find out
          what they had ever voted for — on a platform whose premise is that
          positions are public and attributable. */}
      <div className="flex items-center gap-3">
        <PersonAvatar
          person={post.author}
          className="h-10 w-10 border border-border"
          fallbackClassName="bg-primary text-xs font-semibold text-primary-foreground"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-foreground">
            <PersonName person={post.author} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            <PersonHandle person={post.author} /> · {relativeTime(post.createdAt)}
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
        {withHashtagLinks(post.content)}
      </p>

      {post.repostOf ? (
        <div className="rounded-xl border border-border bg-background/50 p-3">
          <p className="text-xs font-semibold text-foreground">
            <PersonName person={post.repostOf.author} />{" "}
            <span className="font-normal text-muted-foreground">
              @{post.repostOf.author.username}
            </span>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {post.repostOf.content}
          </p>
        </div>
      ) : null}

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
          onClick={handleRepost}
          className="group flex items-center gap-1.5 text-sm transition-colors hover:text-support"
          aria-label={reposted ? "Undo repost" : "Repost"}
          aria-pressed={reposted}
        >
          <Repeat2
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              reposted ? "text-support" : "group-hover:text-support",
            )}
          />
          <span className={cn("tabular-nums", reposted ? "text-support" : "")}>{reposts}</span>
        </button>

        <button
          type="button"
          onClick={handleSave}
          className="ml-auto flex items-center gap-1.5 text-sm transition-colors hover:text-accent"
          aria-label={saved ? "Remove from saved" : "Save"}
          aria-pressed={saved}
        >
          <Bookmark
            className={cn(
              "h-[18px] w-[18px] transition-colors",
              saved ? "fill-accent text-accent" : "",
            )}
          />
        </button>

        <button
          type="button"
          onClick={handleShare}
          className="flex items-center gap-1.5 text-sm transition-colors hover:text-foreground"
          aria-label="Share"
        >
          <Share2 className="h-[18px] w-[18px]" />
        </button>
        {branch ? <span className="sr-only">{branch.label}</span> : null}
      </div>
    </article>
  );
}
