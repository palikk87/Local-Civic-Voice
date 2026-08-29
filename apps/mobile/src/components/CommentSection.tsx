import { useAuthStore } from '@/lib/auth-store';
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Heart, Reply, Send, AtSign, ChevronDown, ChevronUp } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, SlideInDown, FadeOut, Layout } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTimelineStore, type TimelineComment, type TaggedUser } from '@/lib/timeline-store';
import type { User } from '@/lib/types';
import { cn } from '@/lib/cn';

// Parse content to highlight @mentions
function parseContentWithMentions(content: string, taggedUsers: TaggedUser[]) {
  if (!taggedUsers.length) {
    return <Text className="text-slate-300">{content}</Text>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Sort tagged users by start index
  const sortedTags = [...taggedUsers].sort((a, b) => a.startIndex - b.startIndex);

  sortedTags.forEach((tag, index) => {
    // Add text before mention
    if (tag.startIndex > lastIndex) {
      parts.push(
        <Text key={`text-${index}`} className="text-slate-300">
          {content.slice(lastIndex, tag.startIndex)}
        </Text>
      );
    }

    // Add mention
    parts.push(
      <Text key={`mention-${index}`} className="text-amber-400 font-medium">
        @{tag.username}
      </Text>
    );

    lastIndex = tag.endIndex;
  });

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(
      <Text key="text-end" className="text-slate-300">
        {content.slice(lastIndex)}
      </Text>
    );
  }

  return <Text>{parts}</Text>;
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
  const router = useRouter();
  const [showReplies, setShowReplies] = useState(true);
  const likeComment = useTimelineStore((s) => s.likeComment);

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    likeComment(postId, comment.id);
  };

  const handleReply = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply(comment.id, comment.author.username);
  };

  const timeAgo = getTimeAgo(comment.createdAt);
  const hasReplies = comment.replies && comment.replies.length > 0;

  return (
    <Animated.View
      entering={FadeInDown.delay(depth * 50)}
      layout={Layout.springify()}
      className={cn('mb-3', depth > 0 && 'ml-10')}
    >
      <View className="flex-row">
        {/* THE WEB TWIN LINKS ALL THREE OF THESE and this screen linked none
            of them: face, name and handle were inert. Somebody could argue with
            you about a law and you had no way to see what they had ever stood
            for. */}
        <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
          <Image
            source={{ uri: comment.author.avatar }}
            className={cn('rounded-full', depth === 0 ? 'w-10 h-10' : 'w-8 h-8')}
          />
        </Pressable>

        <View className="flex-1 ml-3">
          {/* Comment bubble */}
          <View className="bg-slate-800/60 rounded-2xl rounded-tl-sm px-3 py-2">
            <View className="flex-row items-center mb-1">
              <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
                <Text className="text-white font-semibold text-sm">
                  {comment.author.displayName}
                </Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
                <Text className="text-slate-500 text-xs ml-2">
                  @{comment.author.username}
                </Text>
              </Pressable>
            </View>
            {parseContentWithMentions(comment.content, comment.taggedUsers)}
          </View>

          {/* Actions */}
          <View className="flex-row items-center mt-1 ml-1">
            <Text className="text-slate-500 text-xs">{timeAgo}</Text>

            <Pressable
              onPress={handleLike}
              className="flex-row items-center ml-4"
            >
              <Heart
                size={14}
                color={comment.isLiked ? '#F59E0B' : '#6E8A7C'}
                fill={comment.isLiked ? '#F59E0B' : 'transparent'}
              />
              {comment.likes > 0 && (
                <Text
                  className={cn(
                    'text-xs ml-1',
                    comment.isLiked ? 'text-amber-500' : 'text-slate-500'
                  )}
                >
                  {comment.likes}
                </Text>
              )}
            </Pressable>

            <Pressable
              onPress={handleReply}
              className="flex-row items-center ml-4"
            >
              <Reply size={14} color="#6E8A7C" />
              <Text className="text-slate-500 text-xs ml-1">Reply</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Replies */}
      {hasReplies && (
        <View className="mt-2">
          <Pressable
            onPress={() => setShowReplies(!showReplies)}
            className="flex-row items-center ml-12 mb-2"
          >
            {showReplies ? (
              <ChevronUp size={14} color="#F59E0B" />
            ) : (
              <ChevronDown size={14} color="#F59E0B" />
            )}
            <Text className="text-amber-500 text-xs ml-1 font-medium">
              {showReplies ? 'Hide' : 'Show'} {comment.replies!.length}{' '}
              {comment.replies!.length === 1 ? 'reply' : 'replies'}
            </Text>
          </Pressable>

          {showReplies &&
            comment.replies!.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                postId={postId}
                onReply={onReply}
                depth={depth + 1}
              />
            ))}
        </View>
      )}
    </Animated.View>
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
  // The real signed-in account, not the fictional `currentUser`.
  const me = useAuthStore((s) => s.user);
  const [content, setContent] = useState(replyTo ? `@${replyTo.username} ` : '');
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const inputRef = useRef<TextInput>(null);

  const addComment = useTimelineStore((s) => s.addComment);
  const replyToComment = useTimelineStore((s) => s.replyToComment);
  const searchUsers = useTimelineStore((s) => s.searchUsers);

  const suggestedUsers = searchUsers(userQuery);

  // Auto-focus when replying
  React.useEffect(() => {
    if (replyTo) {
      setContent(`@${replyTo.username} `);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [replyTo]);

  const handleTextChange = useCallback((text: string) => {
    setContent(text);

    // Check for @ mentions
    const lastAtIndex = text.lastIndexOf('@', cursorPosition);
    if (lastAtIndex !== -1) {
      const textAfterAt = text.slice(lastAtIndex + 1, cursorPosition + 1);
      const hasSpace = textAfterAt.includes(' ');

      if (!hasSpace && textAfterAt.length > 0) {
        setUserQuery(textAfterAt);
        setShowUserSuggestions(true);
      } else if (textAfterAt.length === 0) {
        setUserQuery('');
        setShowUserSuggestions(true);
      } else {
        setShowUserSuggestions(false);
      }
    } else {
      setShowUserSuggestions(false);
    }
  }, [cursorPosition]);

  const handleSelectionChange = useCallback((event: { nativeEvent: { selection: { start: number } } }) => {
    setCursorPosition(event.nativeEvent.selection.start);
  }, []);

  const handleSelectUser = useCallback((user: User) => {
    const lastAtIndex = content.lastIndexOf('@', cursorPosition);
    if (lastAtIndex !== -1) {
      const beforeAt = content.slice(0, lastAtIndex);
      const afterCursor = content.slice(cursorPosition);
      const newContent = `${beforeAt}@${user.username} ${afterCursor}`;
      setContent(newContent);
    }
    setShowUserSuggestions(false);
    inputRef.current?.focus();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [content, cursorPosition]);

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

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const taggedUsers = parseTaggedUsers(content);

    if (replyTo) {
      replyToComment(postId, replyTo.commentId, content.trim(), taggedUsers);
      onCancelReply();
    } else {
      addComment(postId, content.trim(), taggedUsers);
    }

    setContent('');
    setShowUserSuggestions(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Reply indicator */}
      {replyTo && (
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          className="flex-row items-center px-4 py-2 bg-slate-800/60 border-b border-slate-700/50"
        >
          <Reply size={14} color="#F59E0B" />
          <Text className="text-slate-400 text-sm ml-2 flex-1">
            Replying to{' '}
            <Text className="text-amber-500">@{replyTo.username}</Text>
          </Text>
          <Pressable onPress={onCancelReply}>
            <Text className="text-slate-500 text-sm">Cancel</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* User suggestions */}
      {showUserSuggestions && suggestedUsers.length > 0 && (
        <Animated.View
          entering={SlideInDown.springify()}
          exiting={FadeOut}
          className="bg-slate-800 border-b border-slate-700"
          style={{ maxHeight: 150 }}
        >
          <FlatList
            data={suggestedUsers}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleSelectUser(item)}
                className="flex-row items-center mr-3 px-3 py-2 bg-slate-700/60 rounded-full"
              >
                <Image
                  source={{ uri: item.avatar }}
                  className="w-6 h-6 rounded-full"
                />
                <Text className="text-white text-sm ml-2 font-medium">
                  @{item.username}
                </Text>
              </Pressable>
            )}
          />
        </Animated.View>
      )}

      {/* Input */}
      <View className="flex-row items-end px-4 py-3 bg-slate-900 border-t border-slate-800">
        <Image
          source={{ uri: me?.avatar }}
          className="w-8 h-8 rounded-full mr-3"
        />

        <View className="flex-1 flex-row items-end bg-slate-800 rounded-2xl px-4 py-2">
          <TextInput
            ref={inputRef}
            value={content}
            onChangeText={handleTextChange}
            onSelectionChange={handleSelectionChange}
            placeholder="Write a comment..."
            placeholderTextColor="#6E8A7C"
            multiline
            className="flex-1 text-white text-base max-h-24"
          />

          <Pressable
            onPress={() => {
              const newContent = content + '@';
              setContent(newContent);
              setCursorPosition(newContent.length);
              setShowUserSuggestions(true);
              setUserQuery('');
              inputRef.current?.focus();
            }}
            className="ml-2 p-1"
          >
            <AtSign size={18} color="#6E8A7C" />
          </Pressable>
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={!content.trim()}
          className={cn(
            'ml-3 w-10 h-10 rounded-full items-center justify-center',
            content.trim() ? 'bg-amber-500' : 'bg-slate-700'
          )}
        >
          <Send
            size={18}
            color={content.trim() ? '#0C1D18' : '#6E8A7C'}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
    <View className="flex-1">
      {/* Comments list */}
      {comments.length > 0 ? (
        <View className="px-4 py-3">
          {comments.map((comment, index) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              postId={postId}
              onReply={handleReply}
            />
          ))}
        </View>
      ) : (
        <View className="px-4 py-8 items-center">
          <Text className="text-slate-500 text-center">
            No comments yet. Be the first to comment!
          </Text>
        </View>
      )}

      {/* Comment input */}
      <CommentInput
        postId={postId}
        replyTo={replyTo}
        onCancelReply={handleCancelReply}
      />
    </View>
  );
}

// Export helper for parsing mentions
export { parseContentWithMentions };

// Time ago helper
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
