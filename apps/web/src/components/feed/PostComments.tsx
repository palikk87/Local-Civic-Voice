import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PersonAvatar, PersonHandle, PersonName } from "@/components/people/PersonLink";
import { useRequireAuth } from "@/hooks/use-civic-auth";

/**
 * THE COMMENT SECTION, WHEREVER THE POST IS.
 *
 * WHY THIS EXISTS. Comments only lived on /post/:id. Pressing Reply anywhere
 * else took you off the page you were reading — out of the feed, off somebody's
 * profile — to write one sentence, and then you had to find your way back and
 * lose your place doing it. Reported as "there should be a comment section to
 * every post".
 *
 * The comments themselves were never the problem: they are public, they thread,
 * and everybody who can see the post can see and reply to them. They were just
 * somewhere else. So this is one component, used by every surface that renders
 * a post, rather than a second implementation per screen — which is how the
 * two like buttons ended up disagreeing with each other and with the server.
 *
 * It reads and writes the same endpoints and the same query keys as the post
 * page, so a comment written in the feed is on the post page when you get
 * there, and the other way round.
 */

interface CommentAuthor {
  id: string;
  username: string | null;
  name: string | null;
  image: string | null;
}

/**
 * PersonLink wants a display name and a handle it can count on; the API sends
 * either of them as null for an account that has not filled them in. Mapped
 * once, here, so three call sites below do not each invent their own fallback
 * and disagree about what an unnamed account is called.
 */
function asPerson(author: CommentAuthor) {
  return {
    id: author.id,
    displayName: author.name ?? author.username ?? "Someone",
    username: author.username ?? "",
    avatar: author.image,
  };
}

interface CommentRow {
  id: string;
  content: string;
  author: CommentAuthor;
  repliesCount: number;
  likesCount: number;
  isLiked: boolean;
  createdAt: string;
}

function when(iso: string): string {
  const at = new Date(iso).getTime();
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PostComments({ postId, autoFocus }: { postId: string; autoFocus?: boolean }) {
  const queryClient = useQueryClient();
  const requireAuth = useRequireAuth();
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);

  const { data, isLoading } = useQuery({
    // The SAME key the post page uses, so the two are never two versions of
    // the same conversation.
    queryKey: ["post-comments", postId],
    queryFn: () => api.get<{ comments: CommentRow[] }>(`/api/posts/${postId}/comments?limit=50`),
  });

  const comments = Array.isArray(data?.comments) ? data.comments : [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["post-comments", postId] });
    void queryClient.invalidateQueries({ queryKey: ["post", postId] });
    // The card that opened this shows a comment count; it has to move too.
    void queryClient.invalidateQueries({ queryKey: ["algorithmic-feed"] });
  };

  const send = useMutation({
    mutationFn: () =>
      api.post(`/api/posts/${postId}/comments`, {
        content: draft.trim(),
        ...(replyTo ? { parentId: replyTo.id } : {}),
      }),
    onSuccess: () => {
      setDraft("");
      setReplyTo(null);
      refresh();
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "";
      toast.error(message || "Couldn't post that");
    },
  });

  const like = useMutation({
    mutationFn: (commentId: string) =>
      api.post(`/api/posts/${postId}/comments/${commentId}/like`),
    onSuccess: refresh,
    onError: () => toast.error("Couldn't do that"),
  });

  const submit = () => {
    if (!requireAuth("Sign in to join the conversation.")) return;
    if (!draft.trim() || send.isPending) return;
    send.mutate();
  };

  return (
    <div className="mt-3 border-t border-slate-700/40 pt-3">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading the conversation…</p>
      ) : comments.length === 0 ? (
        // NOT "be the first!" — an empty conversation is a fact, not a prompt.
        <p className="text-xs text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              <PersonAvatar person={asPerson(comment.author)} className="h-7 w-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <PersonName person={asPerson(comment.author)} className="text-sm font-medium text-foreground" />
                  <PersonHandle person={asPerson(comment.author)} className="text-xs text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">· {when(comment.createdAt)}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-200">
                  {comment.content}
                </p>
                <div className="mt-1 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (!requireAuth("Sign in to react.")) return;
                      like.mutate(comment.id);
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Heart
                      className={cn("h-3.5 w-3.5", comment.isLiked && "fill-red-500 text-red-500")}
                    />
                    {comment.likesCount > 0 ? comment.likesCount : null}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReplyTo(comment)}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Reply
                  </button>
                  {comment.repliesCount > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {comment.repliesCount} {comment.repliesCount === 1 ? "reply" : "replies"}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {replyTo ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Replying to{" "}
          <span className="text-foreground">
            {replyTo.author.username ? `@${replyTo.author.username}` : "them"}
          </span>{" "}
          <button
            type="button"
            onClick={() => setReplyTo(null)}
            className="underline hover:text-foreground"
          >
            cancel
          </button>
        </p>
      ) : null}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          autoFocus={autoFocus}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a paragraph. A comment box that
            // needs a mouse to submit is a comment box people abandon.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={replyTo ? "Write a reply" : "Write a comment"}
          className="min-h-[38px] flex-1 resize-none rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || send.isPending}
          aria-label="Post comment"
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-amber-500 text-emerald-950 disabled:bg-slate-700 disabled:text-slate-500"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
