import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { ComposeComment } from "./ComposeComment";

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

interface CommentCardProps {
  comment: Comment;
  postId: string;
}

export function CommentCard({ comment, postId }: CommentCardProps) {
  const { user } = useCurrentUser();
  const queryClient = useQueryClient();
  const [showReplies, setShowReplies] = useState(false);
  const [showReply, setShowReply] = useState(false);

  const { data: replies, isLoading: repliesLoading } = useQuery({
    queryKey: ["comment-replies", comment.id],
    queryFn: () =>
      api.get<{
        comments: Comment[];
        nextCursor?: string;
        hasMore: boolean;
      }>(`/api/posts/${postId}/comments/${comment.id}/replies`),
    enabled: showReplies && comment.repliesCount > 0,
  });

  const deleteCommentMutation = useMutation({
    mutationFn: () =>
      api.delete(`/api/posts/${postId}/comments/${comment.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["post-comments", postId],
      });
    },
  });

  const isOwnComment = user?.id === comment.author.id;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/50 p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <img
            src={comment.author.avatar}
            alt={comment.author.displayName}
            className="h-8 w-8 rounded-full"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {comment.author.displayName}
            </p>
            <p className="text-xs text-muted-foreground">
              @{comment.author.username} •{" "}
              {formatDistanceToNow(new Date(comment.createdAt), {
                addSuffix: true,
              })}
            </p>
          </div>
        </div>

        {isOwnComment ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => deleteCommentMutation.mutate()}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Content */}
      <p className="text-sm text-foreground">{comment.content}</p>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {comment.repliesCount > 0 ? (
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            {comment.repliesCount} {comment.repliesCount === 1 ? "reply" : "replies"}
          </button>
        ) : null}

        <button
          onClick={() => setShowReply(!showReply)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Reply
        </button>
      </div>

      {/* Replies section */}
      {showReplies && comment.repliesCount > 0 ? (
        <div className="mt-3 space-y-3 border-t border-border/50 pt-3">
          {repliesLoading ? (
            <>
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </>
          ) : replies?.comments ? (
            replies.comments.map((reply) => (
              <CommentCard
                key={reply.id}
                comment={reply}
                postId={postId}
              />
            ))
          ) : null}
        </div>
      ) : null}

      {/* Reply form */}
      {showReply ? (
        <div className="mt-3 border-t border-border/50 pt-3">
          <ComposeComment
            postId={postId}
            parentId={comment.id}
            onSuccess={() => setShowReply(false)}
            onCancel={() => setShowReply(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
