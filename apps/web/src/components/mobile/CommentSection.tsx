// Web port of mobile/src/components/CommentSection.tsx
import { useState, useRef, useCallback, useEffect, type ReactNode } from "react";
import { Heart, Reply, Send, AtSign, ChevronDown, ChevronUp } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import {
  useTimelineStore,
  type TimelineComment,
  type TaggedUser,
} from "@/lib/mobile/timeline-store";
import { useSignedInIdentity } from "@/lib/mobile/signed-in-identity";
import type { User } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";

// Parse content to highlight @mentions
function parseContentWithMentions(content: string, taggedUsers: TaggedUser[]) {
  if (!taggedUsers.length) {
    return <span className="text-slate-300">{content}</span>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  // Sort tagged users by start index
  const sortedTags = [...taggedUsers].sort((a, b) => a.startIndex - b.startIndex);

  sortedTags.forEach((tag, index) => {
    // Add text before mention
    if (tag.startIndex > lastIndex) {
      parts.push(
        <span key={`text-${index}`} className="text-slate-300">
          {content.slice(lastIndex, tag.startIndex)}
        </span>
      );
    }

    // Add mention
    parts.push(
      <span key={`mention-${index}`} className="text-amber-400 font-medium">
        @{tag.username}
      </span>
    );

    lastIndex = tag.endIndex;
  });

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(
      <span key="text-end" className="text-slate-300">
        {content.slice(lastIndex)}
      </span>
    );
  }

  return <span>{parts}</span>;
}

// Single comment component
function CommentItem({
  comment,
  postId,
  onReply,
  depth = 0,
}: {
  comment: TimelineComment;
  postId: string;
  onReply: (commentId: string, username: string) => void;
  depth?: number;
}) {
  const [showReplies, setShowReplies] = useState(true);
  const likeComment = useTimelineStore((s) => s.likeComment);

  const handleLike = () => {
    likeComment(postId, comment.id);
  };

  const handleReply = () => {
    onReply(comment.id, comment.author.username);
  };

  const timeAgo = getTimeAgo(comment.createdAt);
  const hasReplies = comment.replies && comment.replies.length > 0;

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: depth * 0.05 }}
      className={cn("mb-3", depth > 0 && "ml-10")}
    >
      <div className="flex items-start">
        <img
          src={comment.author.avatar}
          alt={comment.author.displayName}
          className={cn("rounded-full", depth === 0 ? "w-10 h-10" : "w-8 h-8")}
        />

        <div className="flex-1 ml-3">
          {/* Comment bubble */}
          <div className="bg-slate-800/60 rounded-2xl rounded-tl-sm px-3 py-2">
            <div className="flex items-center mb-1">
              <span className="text-white font-semibold text-sm">
                {comment.author.displayName}
              </span>
              <span className="text-slate-500 text-xs ml-2">@{comment.author.username}</span>
            </div>
            {parseContentWithMentions(comment.content, comment.taggedUsers)}
          </div>

          {/* Actions */}
          <div className="flex items-center mt-1 ml-1">
            <span className="text-slate-500 text-xs">{timeAgo}</span>

            <button onClick={handleLike} className="flex items-center ml-4">
              <Heart
                size={14}
                color={comment.isLiked ? "#F59E0B" : "#64748B"}
                fill={comment.isLiked ? "#F59E0B" : "transparent"}
              />
              {comment.likes > 0 ? (
                <span
                  className={cn(
                    "text-xs ml-1",
                    comment.isLiked ? "text-amber-500" : "text-slate-500"
                  )}
                >
                  {comment.likes}
                </span>
              ) : null}
            </button>

            <button onClick={handleReply} className="flex items-center ml-4">
              <Reply size={14} color="#64748B" />
              <span className="text-slate-500 text-xs ml-1">Reply</span>
            </button>
          </div>
        </div>
      </div>

      {/* Replies */}
      {hasReplies ? (
        <div className="mt-2">
          <button
            onClick={() => setShowReplies(!showReplies)}
            className="flex items-center ml-12 mb-2"
          >
            {showReplies ? (
              <ChevronUp size={14} color="#F59E0B" />
            ) : (
              <ChevronDown size={14} color="#F59E0B" />
            )}
            <span className="text-amber-500 text-xs ml-1 font-medium">
              {showReplies ? "Hide" : "Show"} {comment.replies!.length}{" "}
              {comment.replies!.length === 1 ? "reply" : "replies"}
            </span>
          </button>

          {showReplies
            ? comment.replies!.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  postId={postId}
                  onReply={onReply}
                  depth={depth + 1}
                />
              ))
            : null}
        </div>
      ) : null}
    </MotionDiv>
  );
}

// Comment input component
function CommentInput({
  postId,
  replyTo,
  onCancelReply,
}: {
  postId: string;
  replyTo?: { commentId: string; username: string };
  onCancelReply: () => void;
}) {
  // The real signed-in person, not the fictional `currentUser` this was ported
  // against. Null while signed out, and the avatar slot renders empty rather
  // than borrowing somebody else's face.
  const me = useSignedInIdentity();
  const [content, setContent] = useState(replyTo ? `@${replyTo.username} ` : "");
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);
  const [userQuery, setUserQuery] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const addComment = useTimelineStore((s) => s.addComment);
  const replyToComment = useTimelineStore((s) => s.replyToComment);
  const searchUsers = useTimelineStore((s) => s.searchUsers);

  const suggestedUsers = searchUsers(userQuery);

  // Auto-focus when replying
  useEffect(() => {
    if (replyTo) {
      setContent(`@${replyTo.username} `);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [replyTo]);

  const handleTextChange = useCallback(
    (text: string) => {
      setContent(text);

      // Check for @ mentions
      const lastAtIndex = text.lastIndexOf("@", cursorPosition);
      if (lastAtIndex !== -1) {
        const textAfterAt = text.slice(lastAtIndex + 1, cursorPosition + 1);
        const hasSpace = textAfterAt.includes(" ");

        if (!hasSpace && textAfterAt.length > 0) {
          setUserQuery(textAfterAt);
          setShowUserSuggestions(true);
        } else if (textAfterAt.length === 0) {
          setUserQuery("");
          setShowUserSuggestions(true);
        } else {
          setShowUserSuggestions(false);
        }
      } else {
        setShowUserSuggestions(false);
      }
    },
    [cursorPosition]
  );

  const handleSelectionChange = useCallback(() => {
    setCursorPosition(inputRef.current?.selectionStart ?? 0);
  }, []);

  const handleSelectUser = useCallback(
    (user: User) => {
      const lastAtIndex = content.lastIndexOf("@", cursorPosition);
      if (lastAtIndex !== -1) {
        const beforeAt = content.slice(0, lastAtIndex);
        const afterCursor = content.slice(cursorPosition);
        const newContent = `${beforeAt}@${user.username} ${afterCursor}`;
        setContent(newContent);
      }
      setShowUserSuggestions(false);
      inputRef.current?.focus();
    },
    [content, cursorPosition]
  );

  const parseTaggedUsers = (text: string): TaggedUser[] => {
    const taggedUsers: TaggedUser[] = [];
    const mentionRegex = /@(\w+)/g;
    let match: RegExpExecArray | null = mentionRegex.exec(text);

    while (match !== null) {
      const currentMatch = match;
      const user = searchUsers(currentMatch[1]).find(
        (u) => u.username.toLowerCase() === currentMatch[1].toLowerCase()
      );

      if (user) {
        taggedUsers.push({
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          startIndex: currentMatch.index,
          endIndex: currentMatch.index + currentMatch[0].length,
        });
      }
      match = mentionRegex.exec(text);
    }

    return taggedUsers;
  };

  const handleSubmit = () => {
    if (!content.trim()) return;

    const taggedUsers = parseTaggedUsers(content);

    if (replyTo) {
      replyToComment(postId, replyTo.commentId, content.trim(), taggedUsers);
      onCancelReply();
    } else {
      addComment(postId, content.trim(), taggedUsers);
    }

    setContent("");
    setShowUserSuggestions(false);
  };

  return (
    <div>
      {/* Reply indicator */}
      {replyTo ? (
        <MotionDiv
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center px-4 py-2 bg-slate-800/60 border-b border-slate-700/50"
        >
          <Reply size={14} color="#F59E0B" />
          <span className="text-slate-400 text-sm ml-2 flex-1">
            Replying to <span className="text-amber-500">@{replyTo.username}</span>
          </span>
          <button onClick={onCancelReply}>
            <span className="text-slate-500 text-sm">Cancel</span>
          </button>
        </MotionDiv>
      ) : null}

      {/* User suggestions */}
      {showUserSuggestions && suggestedUsers.length > 0 ? (
        <MotionDiv
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 border-b border-slate-700 overflow-x-auto"
          style={{ maxHeight: 150 }}
        >
          <div className="flex px-3 py-2 gap-3">
            {suggestedUsers.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectUser(item)}
                className="flex items-center px-3 py-2 bg-slate-700/60 rounded-full shrink-0"
              >
                <img src={item.avatar} alt={item.displayName} className="w-6 h-6 rounded-full" />
                <span className="text-white text-sm ml-2 font-medium">@{item.username}</span>
              </button>
            ))}
          </div>
        </MotionDiv>
      ) : null}

      {/* Input */}
      <div className="flex items-end px-4 py-3 bg-slate-900 border-t border-slate-800">
        {me ? (
          <img src={me.avatar} alt={me.displayName} className="w-8 h-8 rounded-full mr-3" />
        ) : (
          <div className="w-8 h-8 rounded-full mr-3 bg-slate-700" aria-hidden />
        )}

        <div className="flex-1 flex items-end bg-slate-800 rounded-2xl px-4 py-2">
          <textarea
            ref={inputRef}
            value={content}
            onChange={(e) => handleTextChange(e.target.value)}
            onSelect={handleSelectionChange}
            placeholder="Write a comment..."
            rows={1}
            className="flex-1 bg-transparent text-white text-base max-h-24 outline-none resize-none placeholder:text-slate-500"
          />

          <button
            onClick={() => {
              const newContent = content + "@";
              setContent(newContent);
              setCursorPosition(newContent.length);
              setShowUserSuggestions(true);
              setUserQuery("");
              inputRef.current?.focus();
            }}
            className="ml-2 p-1"
          >
            <AtSign size={18} color="#64748B" />
          </button>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!content.trim()}
          className={cn(
            "ml-3 w-10 h-10 rounded-full flex items-center justify-center transition-colors",
            content.trim() ? "bg-amber-500" : "bg-slate-700"
          )}
        >
          <Send size={18} color={content.trim() ? "#0F172A" : "#64748B"} />
        </button>
      </div>
    </div>
  );
}

// Main comments section component
interface CommentSectionProps {
  postId: string;
  comments: TimelineComment[];
}

export default function CommentSection({ postId, comments }: CommentSectionProps) {
  const [replyTo, setReplyTo] = useState<{ commentId: string; username: string } | undefined>();

  const handleReply = (commentId: string, username: string) => {
    setReplyTo({ commentId, username });
  };

  const handleCancelReply = () => {
    setReplyTo(undefined);
  };

  return (
    <div className="flex-1">
      {/* Comments list */}
      {comments.length > 0 ? (
        <div className="px-4 py-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} postId={postId} onReply={handleReply} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 flex flex-col items-center">
          <p className="text-slate-500 text-center">No comments yet. Be the first to comment!</p>
        </div>
      )}

      {/* Comment input */}
      <CommentInput postId={postId} replyTo={replyTo} onCancelReply={handleCancelReply} />
    </div>
  );
}

// Export helper for parsing mentions
export { parseContentWithMentions };

// Time ago helper
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
