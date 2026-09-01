/**
 * What you saved, where you can find it again.
 *
 * Web twin: apps/web/src/pages/Saved.tsx.
 *
 * The phone could SAVE a post — the bookmark on every card called
 * /api/feed/posts/:id/save, and lib/api/feed.ts even had getSavedPosts sitting
 * ready — and then had no screen that ever called it. So saving on a phone put
 * something into a drawer with no handle.
 */
import { useQuery } from '@tanstack/react-query';
import { View, Text, Image, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bookmark, Heart, MessageCircle } from 'lucide-react-native';

import { getSavedPosts } from '@/lib/api/feed';
import { AuthGate } from '@/components/auth/AuthGate';

function SavedList() {
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['saved-posts'],
    queryFn: () => getSavedPosts(30),
  });

  const posts = data?.posts ?? [];

  if (isLoading) {
    return (
      <View className="py-16 items-center">
        <ActivityIndicator color="#F59E0B" />
      </View>
    );
  }

  if (isError) {
    /* "You have not saved anything" is a claim about what this person did. A
       failed request is not evidence of an empty drawer. */
    return (
      <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
        <Text className="text-white text-lg">We could not load your saved posts</Text>
        <Text className="text-slate-400 text-sm mt-1 text-center px-6">
          That is a problem reaching the server, not an empty list.
        </Text>
        <Pressable onPress={() => refetch()} className="mt-4">
          <Text className="text-amber-500 text-sm font-medium">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (posts.length === 0) {
    return (
      <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
        <Bookmark size={24} color="#6E8A7C" />
        <Text className="text-white text-lg mt-2">Nothing saved yet</Text>
        <Text className="text-slate-400 text-sm mt-1 text-center px-6">
          Tap the bookmark on any post and it will be waiting here.
        </Text>
      </View>
    );
  }

  return (
    <>
      {posts.map((post) => (
        <Pressable
          key={post.id}
          onPress={() => router.push(`/post/${post.id}` as never)}
          className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 mb-3 active:bg-slate-800/70"
        >
          {/* A NAME YOU CAN READ IS A PERSON YOU CAN LOOK UP. The card opens
              the post; the name is its own target and opens the person. */}
          <Pressable
            onPress={() => router.push(`/user/${post.author.id}` as never)}
            className="flex-row items-center mb-2"
          >
            <Image source={{ uri: post.author.avatar }} className="w-8 h-8 rounded-full" />
            <View className="ml-2 flex-1">
              <Text className="text-white text-sm font-semibold">
                {post.author.displayName}
              </Text>
              <Text className="text-slate-500 text-xs">@{post.author.username}</Text>
            </View>
          </Pressable>
          {post.content ? (
            <Text className="text-slate-200 text-sm" numberOfLines={6}>
              {post.content}
            </Text>
          ) : null}
          {post.bill ? (
            <Text className="text-amber-500/80 text-xs mt-2" numberOfLines={2}>
              {post.bill.title}
            </Text>
          ) : null}
          <View className="flex-row items-center mt-3">
            <MessageCircle size={14} color="#6E8A7C" />
            <Text className="text-slate-500 text-xs ml-1 mr-4">{post.metrics.comments}</Text>
            <Heart size={14} color="#6E8A7C" />
            <Text className="text-slate-500 text-xs ml-1">{post.metrics.likes}</Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}

export default function SavedScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </Pressable>
        <Text className="text-white text-lg font-semibold ml-2">Saved</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        {/* Your own drawer, so it needs an account to open. */}
        <AuthGate capability="viewSaved" reason="Sign in to see what you have saved.">
          <SavedList />
        </AuthGate>
      </ScrollView>
    </SafeAreaView>
  );
}
