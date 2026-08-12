import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface ComposeCommentProps {
  postId: string;
  parentId?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function ComposeComment({
  postId,
  parentId,
  onSuccess,
  onCancel,
}: ComposeCommentProps) {
  const { user, isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");

  const commentMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/posts/${postId}/comments`, {
        content,
        ...(parentId ? { parentId } : {}),
      }),
    onSuccess: () => {
      setContent("");
      queryClient.invalidateQueries({
        queryKey: ["post-comments", postId],
      });
      toast.success("Comment posted!");
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Failed to post comment");
      console.error(error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      openAuth("Sign up to share your perspective");
      return;
    }

    if (!content.trim()) {
      toast.error("Comment cannot be empty");
      return;
    }

    if (content.length > 2000) {
      toast.error("Comment must be under 2000 characters");
      return;
    }

    commentMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={
          parentId
            ? "Write a reply…"
            : "Share your take on this…"
        }
        className="min-h-20 resize-none"
        disabled={commentMutation.isPending}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {content.length}/2000
        </p>
        <div className="flex gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={commentMutation.isPending}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            disabled={
              commentMutation.isPending ||
              !content.trim() ||
              content.length > 2000
            }
          >
            {commentMutation.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </form>
  );
}
