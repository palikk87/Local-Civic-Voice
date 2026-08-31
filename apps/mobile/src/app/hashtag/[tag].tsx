import { useQuery } from '@tanstack/react-query';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Hash } from 'lucide-react-native';

import { api } from '@/lib/api/api';

/**
 * Everything written under one tag.
 *
 * Web twin: apps/web/src/pages/HashtagPage.tsx. Hashtags were collected into
 * their own table and ranked into a trending list long before anything could
 * show one; the web got a page for them and the phone did not, so a tag on a
 * phone was decoration.
 */
interface TaggedPost {
  id: string;
  content: string;
  author: { id: string; displayName: string; username: string };
}

export default function HashtagScreen() {
  const router = useRouter();
  const { tag = '' } = useLocalSearchParams<{ tag: string }>();
  const clean = String(tag).replace(/^#/, '');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['hashtag', clean],
    queryFn: () =>
      api.get<{ results: TaggedPost[] }>(
        `/api/posts/hashtag/${encodeURIComponent(clean)}`,
      ),
    enabled: clean.length > 0,
  });

  const posts = data?.results ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </Pressable>
        <Hash size={20} color="#F59E0B" style={{ marginLeft: 8 }} />
        <Text className="text-white text-lg font-semibold ml-1">{clean}</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        {isLoading ? (
          <View className="py-16 items-center">
            <ActivityIndicator color="#F59E0B" />
          </View>
        ) : isError ? (
          /* "Nothing under this tag yet" is a claim about what people have
             written. A failed request is not evidence of silence. */
          <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
            <Text className="text-white text-lg">We could not load these posts</Text>
            <Text className="text-slate-400 text-sm mt-1 text-center px-6">
              That is a problem reaching the server, not an empty tag.
            </Text>
            <Pressable onPress={() => refetch()} className="mt-4">
              <Text className="text-amber-500 text-sm font-medium">Try again</Text>
            </Pressable>
          </View>
        ) : posts.length === 0 ? (
          <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
            <Text className="text-white text-lg">Nothing under this tag yet</Text>
            <Text className="text-slate-400 text-sm mt-1">
              Write a post with #{clean} in it and it will show up here.
            </Text>
          </View>
        ) : (
          posts.map((post) => (
            /* Two honest targets, the person and the post — never one big link
               to the law with the author's name inside it. */
            <View
              key={post.id}
              className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 mb-3"
            >
              <Pressable onPress={() => router.push(`/user/${post.author.id}` as never)}>
                <Text className="text-white text-sm font-semibold">
                  {post.author.displayName}{' '}
                  <Text className="text-slate-500 font-normal">@{post.author.username}</Text>
                </Text>
              </Pressable>
              <Pressable onPress={() => router.push(`/post/${post.id}` as never)}>
                <Text className="text-slate-200 text-sm mt-1 leading-5">{post.content}</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
