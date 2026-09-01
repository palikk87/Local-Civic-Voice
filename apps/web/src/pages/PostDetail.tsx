import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Heart,
  Link2,
  Loader2,
  MessageCircle,
  Repeat2,
  Scale,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { failureMessage } from "@/lib/request-failure";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-civic-auth";

/**
 * One post, at an address.
 *
 * THERE WAS NO SUCH ADDRESS. Comments lived in a modal over the timeline and
 * nothing else, so a post could not be linked to, could not be opened from a
 * notification — every "somebody replied to you" dropped the reader on the
 * feed to go and find it — and could not be shared with anybody off the
 * platform. On a platform built around people writing about specific laws in
 * public, a public statement with no address is a strange thing to ship.
 *
 * Loaded from the API rather than from the timeline store, because the whole
 * point is that it works when nothing else is loaded: a cold visit from a
 * link, signed out, with no feed behind it.
 */
interface PostAuthor {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
}

interface PostDetailResponse {
  post: {
    id: string;
    content: string;
    author: PostAuthor;
    governmentReferenceId: string | null;
    referenceTitle: string | null;
    lawUpdatedSincePosting?: boolean;
    media: Array<{ id: string; type: string; url: string; thumbnailUrl: string | null }>;
    commentsCount: number;
    likesCount: number;
    isLiked: boolean;
    createdAt: string;
  };
}

interface CommentRow {
  id: string;
  content: string;
  author: PostAuthor;
  repliesCount: number;
  likesCount: number;
  isLiked: boolean;
  createdAt: string;
}

function when(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Replies({ postId, comment }: { postId: string; comment: CommentRow }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["comment-replies", postId, comment.id],
    queryFn: () =>
      api.get<{ comments: CommentRow[] }>(
        `/api/posts/${postId}/comments/${comment.id}/replies`,
      ),
    enabled: open,
  });

  if (comment.repliesCount === 0) return null;

  return (
    <div className="mt-2 pl-4">
      <button
        onClick={() => setOpen((was) => !was)}
        className="text-xs font-medium text-amber-500 hover:underline"
      >
        {open ? "Hide" : "Show"} {comment.repliesCount}{" "}
        {comment.repliesCount === 1 ? "reply" : "replies"}
      </button>

      {open ? (
        isLoading ? (
          <Loader2 className="mt-2 h-4 w-4 animate-spin text-amber-500" />
        ) : (
          <ul className="mt-2 space-y-2 border-l border-slate-700/50 pl-3">
            {(Array.isArray(data?.comments) ? data.comments : []).map((reply) => (
              <li key={reply.id} className="flex gap-2">
                {/* The one avatar on this page that was not a link. */}
                <Link to={`/user/${reply.author.id}`} className="shrink-0">
                  <img src={reply.author.avatar} alt="" className="h-7 w-7 rounded-full" />
                </Link>
                <div>
                  <Link
                    to={`/user/${reply.author.id}`}
                    className="text-sm font-medium text-white hover:underline"
                  >
                    {reply.author.displayName}
                  </Link>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
                    {reply.content}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["post", id],
    queryFn: () => api.get<PostDetailResponse>(`/api/posts/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

  const { data: commentsData } = useQuery({
    queryKey: ["post-comments", id],
    queryFn: () => api.get<{ comments: CommentRow[] }>(`/api/posts/${id}/comments?limit=50`),
    enabled: Boolean(id),
  });

  const post = data?.post;
  const comments = Array.isArray(commentsData?.comments) ? commentsData.comments : [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["post", id] });
    void queryClient.invalidateQueries({ queryKey: ["post-comments", id] });
  };

  const like = useMutation({
    mutationFn: () => api.post(`/api/posts/${id}/like`),
    onSuccess: refresh,
    onError: () => toast.error("Couldn't do that"),
  });

  const repost = useMutation({
    mutationFn: () => api.post(`/api/posts/${id}/repost`, {}),
    onSuccess: () => {
      toast.success("Passed on");
      refresh();
    },
    onError: () => toast.error("Couldn't pass that on"),
  });

  const reply = useMutation({
    mutationFn: () =>
      api.post(`/api/posts/${id}/comments`, {
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

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
        </div>
      </AppShell>
    );
  }

  // A deleted post and a blocked author's post give the same answer, and this
  // page must not guess which.
  //
  // AND AN UNREACHABLE SERVER IS NEITHER. `isError` covers a dead socket too,
  // so with the API down this page told readers a real post had been deleted —
  // about a post that was sitting safely in the database the whole time.
  // Measured; see docs/IF_THE_API_HOST_GOES_AWAY.md.
  if (isError || !post) {
    const failure = failureMessage(error, "this post");
    return (
      <AppShell>
        <div className="mx-auto max-w-lg px-4 py-20 text-center">
          <p className="text-lg font-semibold text-white">{failure.title}</p>
          <p className="mt-1 text-sm text-slate-400">{failure.detail}</p>
          <button
            onClick={() => (failure.canRetry ? refetch() : navigate("/timeline"))}
            className="mt-4 text-sm font-medium text-amber-500 hover:underline"
          >
            {failure.canRetry ? "Try again" : "Back to My Voice"}
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-lg">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft size={20} className="text-slate-300" />
          </button>
          <span className="font-semibold text-white">Post</span>
        </div>

        <article className="border-y border-slate-800 bg-slate-900/40 px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to={`/user/${post.author.id}`}>
              <img src={post.author.avatar} alt="" className="h-10 w-10 rounded-full" />
            </Link>
            <div>
              <Link
                to={`/user/${post.author.id}`}
                className="font-semibold text-white hover:underline"
              >
                {post.author.displayName}
              </Link>
              <p className="text-xs text-slate-500">{when(post.createdAt)}</p>
            </div>
          </div>

          <p className="mt-3 whitespace-pre-wrap break-words text-slate-200">{post.content}</p>

          {post.media.length > 0 ? (
            <div className="mt-3 grid gap-2">
              {post.media
                .filter((item) => item.type === "image")
                .map((item) => (
                  <img
                    key={item.id}
                    src={item.url}
                    alt=""
                    className="w-full rounded-xl border border-slate-800 object-cover"
                  />
                ))}
            </div>
          ) : null}

          {post.governmentReferenceId ? (
            <Link
              to={`/reference/${post.governmentReferenceId}`}
              className="mt-3 flex items-center gap-2 rounded-xl border border-slate-700/50 bg-slate-800/60 p-3 text-sm text-slate-200 hover:border-slate-600"
            >
              <Scale className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{post.referenceTitle}</span>
            </Link>
          ) : null}

          {/* The post is never edited; the law under it moves on its own. */}
          {post.lawUpdatedSincePosting ? (
            <p className="mt-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-400">
              This law has been updated since this was posted.
            </p>
          ) : null}

          <div className="mt-4 flex items-center gap-6 border-t border-slate-800 pt-3">
            <button
              onClick={() => like.mutate()}
              className="flex items-center gap-1.5"
              aria-label="Like"
            >
              <Heart
                size={18}
                className={post.isLiked ? "text-red-500" : "text-slate-500"}
                fill={post.isLiked ? "currentColor" : "transparent"}
              />
              <span className={cn("text-sm", post.isLiked ? "text-red-500" : "text-slate-400")}>
                {post.likesCount || ""}
              </span>
            </button>

            <span className="flex items-center gap-1.5 text-slate-400">
              <MessageCircle size={18} className="text-slate-500" />
              <span className="text-sm">{post.commentsCount || ""}</span>
            </span>

            <button
              onClick={() => repost.mutate()}
              className="flex items-center gap-1.5 text-slate-400"
              aria-label="Pass this on"
            >
              <Repeat2 size={18} className="text-slate-500" />
            </button>

            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(window.location.href)
                  .then(() => toast.success("Link copied"))
                  .catch(() => toast.error("Couldn't copy that"));
              }}
              className="flex items-center gap-1.5 text-slate-400"
              aria-label="Copy link to this post"
            >
              <Link2 size={18} className="text-slate-500" />
            </button>
          </div>
        </article>

        {user ? (
          <div className="px-4 py-3">
            {replyTo ? (
              <p className="mb-1.5 text-xs text-slate-400">
                Replying to {replyTo.author.displayName}{" "}
                <button
                  onClick={() => setReplyTo(null)}
                  className="text-amber-500 hover:underline"
                >
                  cancel
                </button>
              </p>
            ) : null}

            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={replyTo ? "Write a reply" : "Write a comment"}
                rows={2}
                maxLength={2000}
                className="flex-1 resize-none rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <button
                disabled={!draft.trim() || reply.isPending}
                onClick={() => reply.mutate()}
                className="rounded-full bg-amber-500 p-2.5 disabled:opacity-40"
                aria-label="Post"
              >
                <Send size={16} className="text-slate-900" />
              </button>
            </div>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-slate-400">
            <Link to="/auth" className="text-amber-500 hover:underline">
              Sign in
            </Link>{" "}
            to reply.
          </p>
        )}

        <div className="px-4 pb-10">
          {comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No replies yet.</p>
          ) : (
            <ul className="space-y-4">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-2">
                  <Link to={`/user/${comment.author.id}`}>
                    <img src={comment.author.avatar} alt="" className="h-8 w-8 rounded-full" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-xl rounded-tl-sm bg-slate-800/60 px-3 py-2">
                      <Link
                        to={`/user/${comment.author.id}`}
                        className="text-sm font-medium text-white hover:underline"
                      >
                        {comment.author.displayName}
                      </Link>
                      <p className="whitespace-pre-wrap break-words text-sm text-slate-300">
                        {comment.content}
                      </p>
                    </div>

                    <div className="mt-1 flex items-center gap-4 pl-1">
                      <span className="text-xs text-slate-500">{when(comment.createdAt)}</span>
                      {user ? (
                        <button
                          onClick={() => setReplyTo(comment)}
                          className="text-xs font-medium text-slate-400 hover:text-amber-500"
                        >
                          Reply
                        </button>
                      ) : null}
                    </div>

                    <Replies postId={id!} comment={comment} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
