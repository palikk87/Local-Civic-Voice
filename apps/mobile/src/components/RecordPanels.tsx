/**
 * WHAT EVERY LAW CARRIES, ON EVERY LAW.
 *
 * Web twin: the lower half of apps/web/src/pages/ReferenceDetail.tsx, which is
 * ONE page for all three branches, so a ruling and an order get exactly what a
 * bill gets. The phone still has three screens, and only the bill screen ever
 * mounted these — so an executive order or a Supreme Court ruling opened with
 * no turning points, no other side, no pulse history and no audit. Nothing was
 * missing from the server; nobody had put the panels on the other two screens.
 *
 * One component, mounted three times, so they cannot drift apart again.
 */
import { useQuery } from '@tanstack/react-query';
import { View, Text, Image, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { MessageSquare, Heart, MessageCircle } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api } from '@/lib/api/api';
import { IntegrityAuditPanel } from '@/components/IntegrityAuditPanel';
import {
  TurningPointsPanel,
  OtherSidePanel,
  PulseHistoryPanel,
} from '@/components/CivicPanels';

interface AboutPost {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; displayName: string; username: string; avatar: string };
  commentsCount: number;
  likesCount: number;
}

/**
 * POSTS ABOUT THIS LAW — not comments on it.
 *
 * A law is not a thing you reply to, it is a thing people write about. Each
 * card here opens the post's own screen, where the reply and the like already
 * work; it deliberately does not offer them inline, because these posts are not
 * in the timeline store and a like button that cannot know whether you have
 * liked something is worse than no button.
 */
function Conversation({ referenceId }: { referenceId: string }) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['reference-posts', referenceId],
    queryFn: () => api.get<{ posts: AboutPost[] }>(
      `/api/government-references/${referenceId}/posts`,
    ),
  });
  const posts = data?.posts ?? [];

  return (
    <View className="mt-6">
      <Text className="text-white text-lg font-bold">What people are saying</Text>
      <Text className="text-slate-400 text-sm mt-1 mb-3">
        Posts about this law. Open one to reply, or share the law to write your own.
      </Text>

      {isLoading ? (
        <View className="py-8 items-center">
          <ActivityIndicator color="#F59E0B" />
        </View>
      ) : posts.length === 0 ? (
        /* An honest empty state. Nobody has written about this yet, and saying
           so is a finished feature — the invitation is the share button above. */
        <View className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6 items-center">
          <MessageSquare size={24} color="#6E8A7C" />
          <Text className="text-slate-400 text-sm text-center mt-2">
            Nobody has written about this one yet. Share it and you will be first.
          </Text>
        </View>
      ) : (
        posts.map((post) => (
          <Pressable
            key={post.id}
            onPress={() => router.push(`/post/${post.id}` as never)}
            className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 mb-3 active:bg-slate-800/70"
          >
            <View className="flex-row items-center mb-2">
              <Image source={{ uri: post.author.avatar }} className="w-8 h-8 rounded-full" />
              <View className="ml-2 flex-1">
                <Text className="text-white text-sm font-semibold">
                  {post.author.displayName}
                </Text>
                <Text className="text-slate-500 text-xs">@{post.author.username}</Text>
              </View>
            </View>
            {post.content ? (
              <Text className="text-slate-200 text-sm" numberOfLines={6}>
                {post.content}
              </Text>
            ) : null}
            <View className="flex-row items-center mt-3">
              <MessageCircle size={14} color="#6E8A7C" />
              <Text className="text-slate-500 text-xs ml-1 mr-4">{post.commentsCount}</Text>
              <Heart size={14} color="#6E8A7C" />
              <Text className="text-slate-500 text-xs ml-1">{post.likesCount}</Text>
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

export function RecordPanels({
  referenceId,
  auditWhat,
}: {
  referenceId: string | undefined;
  /** What the audit is counting, in plain words, for the panel's own copy. */
  auditWhat?: string;
}) {
  if (!referenceId) return null;

  return (
    <Animated.View entering={FadeInDown.delay(127).springify()} className="px-4">
      {/* The three things only this platform can show: who crossed sides and
          why, what the other side actually wrote, and when opinion moved
          relative to the text moving. */}
      <TurningPointsPanel referenceId={referenceId} />
      <OtherSidePanel referenceId={referenceId} />
      <PulseHistoryPanel referenceId={referenceId} />

      {/* ARTICLE III §2. The tally is the platform's claim; this is where
          anybody can make it prove itself. */}
      <IntegrityAuditPanel
        subjectType="reference"
        subjectId={referenceId}
        title="Integrity Audit of this vote"
        what={auditWhat ?? 'the votes on this record, as totals and timings'}
      />

      <Conversation referenceId={referenceId} />
    </Animated.View>
  );
}
