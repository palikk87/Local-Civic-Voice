// One post, at an address. Web twin: apps/web/src/pages/PostDetail.tsx
//
// THERE WAS NO SUCH ADDRESS. Comments lived in a sheet over the timeline and
// nothing else, so a post could not be linked to and could not be opened from
// a notification — every "somebody replied to you" dropped the reader on the
// feed to go and find it. On a platform built around people writing about
// specific laws in public, a public statement with no address is a strange
// thing to ship.
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ArrowLeft, Heart, MessageCircle, Repeat2, Scale, Send } from 'lucide-react-native';

import { api } from '@/lib/api/api';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';

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
    media: { id: string; type: string; url: string; thumbnailUrl: string | null }[];
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
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Replies({ postId, comment }: { postId: string; comment: CommentRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['comment-replies', postId, comment.id],
    queryFn: () =>
      api.get<{ comments: CommentRow[] }>(`/api/posts/${postId}/comments/${comment.id}/replies`),
    enabled: open,
  });

  if (comment.repliesCount === 0) return null;

  const replies = Array.isArray(data?.comments) ? data.comments : [];

  return (
    <View className="mt-2 pl-3">
      <Pressable onPress={() => setOpen((was) => !was)}>
        <Text className="text-amber-500 text-xs font-medium">
          {open ? 'Hide' : 'Show'} {comment.repliesCount}{' '}
          {comment.repliesCount === 1 ? 'reply' : 'replies'}
        </Text>
      </Pressable>

      {open ? (
        isLoading ? (
          <ActivityIndicator size="small" color="#F59E0B" className="mt-2" />
        ) : (
          <View className="mt-2 border-l border-slate-700/50 pl-3">
            {replies.map((replyRow) => (
              <View key={replyRow.id} className="flex-row mb-2">
                <Image
                  source={{ uri: replyRow.author.avatar }}
                  className="w-7 h-7 rounded-full mr-2"
                />
                <View className="flex-1">
                  <Pressable onPress={() => router.push(`/user/${replyRow.author.id}`)}>
                    <Text className="text-white text-sm font-medium">
                      {replyRow.author.displayName}
                    </Text>
                  </Pressable>
                  <Text className="text-slate-300 text-sm">{replyRow.content}</Text>
                </View>
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

export default function PostDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['post', id],
    queryFn: () => api.get<PostDetailResponse>(`/api/posts/${id}`),
    enabled: Boolean(id),
    retry: false,
  });

  const { data: commentsData } = useQuery({
    queryKey: ['post-comments', id],
    queryFn: () => api.get<{ comments: CommentRow[] }>(`/api/posts/${id}/comments?limit=50`),
    enabled: Boolean(id),
  });

  const post = data?.post;
  const comments = Array.isArray(commentsData?.comments) ? commentsData.comments : [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['post', id] });
    void queryClient.invalidateQueries({ queryKey: ['post-comments', id] });
  };

  const like = useMutation({
    mutationFn: () => api.post(`/api/posts/${id}/like`),
    onSuccess: refresh,
    onError: () => Alert.alert("Couldn't do that"),
  });

  const repost = useMutation({
    mutationFn: () => api.post(`/api/posts/${id}/repost`, {}),
    onSuccess: refresh,
    onError: () => Alert.alert("Couldn't pass that on"),
  });

  const reply = useMutation({
    mutationFn: () =>
      api.post(`/api/posts/${id}/comments`, {
        content: draft.trim(),
        ...(replyTo ? { parentId: replyTo.id } : {}),
      }),
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      refresh();
    },
    onError: (error: unknown) =>
      Alert.alert(error instanceof Error ? error.message : "Couldn't post that"),
  });

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#F59E0B" />
      </SafeAreaView>
    );
  }

  // A deleted post and a blocked author's post give the same answer, and this
  // screen must not guess which.
  if (isError || !post) {
    return (
      <SafeAreaView className="flex-1 bg-slate-900 items-center justify-center px-8">
        <Stack.Screen options={{ headerShown: false }} />
        <Text className="text-white text-lg font-semibold">This post isn&apos;t here</Text>
        <Text className="text-slate-400 text-sm mt-1 text-center">
          It may have been deleted, or it may never have existed.
        </Text>
        <Pressable onPress={() => router.back()} className="mt-4">
          <Text className="text-amber-500 text-sm font-medium">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={22} color="#F5F0E6" />
        </Pressable>
        <Text className="text-white text-lg font-semibold">Post</Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View className="border-y border-slate-800 bg-slate-900/40 px-4 py-4">
            <View className="flex-row items-center">
              <Pressable onPress={() => router.push(`/user/${post.author.id}`)}>
                <Image source={{ uri: post.author.avatar }} className="w-10 h-10 rounded-full" />
              </Pressable>
              <View className="ml-3">
                <Pressable onPress={() => router.push(`/user/${post.author.id}`)}>
                  <Text className="text-white font-semibold">{post.author.displayName}</Text>
                </Pressable>
                <Text className="text-slate-500 text-xs">{when(post.createdAt)}</Text>
              </View>
            </View>

            <Text className="text-slate-200 mt-3">{post.content}</Text>

            {post.media
              .filter((item) => item.type === 'image')
              .map((item) => (
                <Image
                  key={item.id}
                  source={{ uri: item.url }}
                  className="w-full h-56 rounded-xl mt-3 border border-slate-800"
                  resizeMode="cover"
                />
              ))}

            {post.governmentReferenceId ? (
              <Pressable
                onPress={() => router.push(`/bill/${post.governmentReferenceId}`)}
                className="flex-row items-center mt-3 rounded-xl border border-slate-700/50 bg-slate-800/60 p-3"
              >
                <Scale size={16} color="#F59E0B" />
                <Text className="text-slate-200 text-sm ml-2 flex-1" numberOfLines={1}>
                  {post.referenceTitle}
                </Text>
              </Pressable>
            ) : null}

            {/* The post is never edited; the law under it moves on its own. */}
            {post.lawUpdatedSincePosting ? (
              <Text className="text-amber-400 text-xs mt-2 bg-amber-500/10 rounded-lg p-2">
                This law has been updated since this was posted.
              </Text>
            ) : null}

            <View className="flex-row items-center mt-4 pt-3 border-t border-slate-800">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  like.mutate();
                }}
                className="flex-row items-center mr-6"
              >
                <Heart
                  size={18}
                  color={post.isLiked ? '#EF4444' : '#6E8A7C'}
                  fill={post.isLiked ? '#EF4444' : 'transparent'}
                />
                <Text className={`ml-1.5 text-sm ${post.isLiked ? 'text-red-500' : 'text-slate-400'}`}>
                  {post.likesCount > 0 ? post.likesCount : ''}
                </Text>
              </Pressable>

              <View className="flex-row items-center mr-6">
                <MessageCircle size={18} color="#6E8A7C" />
                <Text className="text-slate-400 text-sm ml-1.5">
                  {post.commentsCount > 0 ? post.commentsCount : ''}
                </Text>
              </View>

              <Pressable onPress={() => repost.mutate()} className="flex-row items-center">
                <Repeat2 size={18} color="#6E8A7C" />
              </Pressable>
            </View>
          </View>

          {user ? (
            <View className="px-4 py-3">
              {replyTo ? (
                <View className="flex-row items-center mb-1.5">
                  <Text className="text-slate-400 text-xs">
                    Replying to {replyTo.author.displayName}{' '}
                  </Text>
                  <Pressable onPress={() => setReplyTo(null)}>
                    <Text className="text-amber-500 text-xs">cancel</Text>
                  </Pressable>
                </View>
              ) : null}

              <View className="flex-row items-end">
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={replyTo ? 'Write a reply' : 'Write a comment'}
                  placeholderTextColor="#4C6659"
                  multiline
                  maxLength={2000}
                  className="flex-1 bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2 text-white text-sm mr-2"
                  style={{ minHeight: 44, textAlignVertical: 'top' }}
                />
                <Pressable
                  disabled={!draft.trim() || reply.isPending}
                  onPress={() => reply.mutate()}
                  className="bg-amber-500 rounded-full p-3"
                  style={{ opacity: !draft.trim() || reply.isPending ? 0.4 : 1 }}
                >
                  <Send size={16} color="#0C1D18" />
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => router.push('/login')} className="px-4 py-3">
              <Text className="text-slate-400 text-sm">
                <Text className="text-amber-500">Sign in</Text> to reply.
              </Text>
            </Pressable>
          )}

          <View className="px-4">
            {comments.length === 0 ? (
              <Text className="text-slate-500 text-sm text-center py-8">No replies yet.</Text>
            ) : (
              comments.map((comment) => (
                <View key={comment.id} className="flex-row mb-4">
                  <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
                    <Image
                      source={{ uri: comment.author.avatar }}
                      className="w-8 h-8 rounded-full mr-2"
                    />
                  </Pressable>
                  <View className="flex-1">
                    <View className="bg-slate-800/60 rounded-xl px-3 py-2">
                      <Text className="text-white text-sm font-medium">
                        {comment.author.displayName}
                      </Text>
                      <Text className="text-slate-300 text-sm">{comment.content}</Text>
                    </View>

                    <View className="flex-row items-center mt-1 pl-1">
                      <Text className="text-slate-500 text-xs mr-4">{when(comment.createdAt)}</Text>
                      {user ? (
                        <Pressable onPress={() => setReplyTo(comment)}>
                          <Text className="text-slate-400 text-xs font-medium">Reply</Text>
                        </Pressable>
                      ) : null}
                    </View>

                    <Replies postId={String(id)} comment={comment} />
                  </View>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
