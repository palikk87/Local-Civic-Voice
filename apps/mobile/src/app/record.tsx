// Your record — where you stood, when, on which version of the law, plus every
// time somebody else spoke in your name and where you stand most alone.
// Web twin: apps/web/src/pages/MyRecord.tsx and PositionReview.tsx, folded into
// one screen here because a phone should not make you leave a list to act on it.
import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  EyeOff,
  RefreshCw,
  Scale,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  Users,
} from 'lucide-react-native';

import { api } from '@/lib/api/api';
import { AuthGate } from '@/components/auth/AuthGate';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';

interface PositionRecord {
  id: string;
  position: string;
  reason: string | null;
  isChange: boolean;
  /** Only ever true on your own record — Bill of Rights Article IV. */
  isAnonymous: boolean;
  lawVersion: number;
  createdAt: string;
  lawMovedSince: boolean;
  reference: { id: string; title: string; lawVersion: number };
}

interface PositionSummary {
  total: number;
  support: number;
  oppose: number;
  changesOfMind: number;
  standingOnOldText: number;
}

interface NeedingReview {
  position: string;
  lawVersion: number;
  takenAt: string;
  reference: { id: string; title: string; lawVersion: number };
}

interface VoiceReceipt {
  referenceId: string;
  title: string;
  position: string;
  castBy: { id: string; name: string };
  lentTo: { id: string; name: string } | null;
}

interface StandingEntry {
  reference: { id: string; title: string };
  yourPosition: string;
  agreementPct: number;
}

interface Standing {
  measured: number;
  withMajority: number;
  inMinority: number;
  mostAlone: StandingEntry[];
}

const CARD = 'bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-3';

function when(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * "You backed this in March. It has been amended since. Still with it?"
 *
 * NOTHING IS WITHDRAWN AUTOMATICALLY. Silence is not a change of mind, and a
 * platform that decides what your silence meant has taken the position for you.
 */
function ReviewRow({ entry }: { entry: NeedingReview }) {
  const queryClient = useQueryClient();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['positions-review'] });
    void queryClient.invalidateQueries({ queryKey: ['positions'] });
  };

  // Re-affirming is a withdraw followed by the same position again — what the
  // vote endpoint's toggle does. The record keeps both acts, and returning to
  // where you were is not counted as a change of mind.
  const reaffirm = useMutation({
    mutationFn: async () => {
      await api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
      });
      return api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
        reason: 'Re-read it after the change and stand by this.',
      });
    },
    onSuccess: refresh,
    onError: () => Alert.alert("Couldn't record that"),
  });

  const withdraw = useMutation({
    mutationFn: () =>
      api.post(`/api/government-references/${entry.reference.id}/vote`, {
        position: entry.position,
      }),
    onSuccess: refresh,
    onError: () => Alert.alert("Couldn't withdraw that"),
  });

  const busy = reaffirm.isPending || withdraw.isPending;

  return (
    <View className="border-t border-slate-700/40 pt-3 mt-3">
      <Text className="text-white text-sm">{entry.reference.title}</Text>
      <Text className="text-slate-400 text-xs mt-1">
        You {entry.position === 'support' ? 'backed' : 'opposed'} version {entry.lawVersion} on{' '}
        {when(entry.takenAt)}. It is now on version {entry.reference.lawVersion}.
      </Text>

      <View className="flex-row mt-2">
        <Pressable
          disabled={busy}
          onPress={() => reaffirm.mutate()}
          className="flex-row items-center bg-amber-500 rounded-lg px-3 py-2 mr-2"
        >
          <Check size={14} color="#0F172A" />
          <Text className="text-slate-900 text-xs font-semibold ml-1.5">Still with it</Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => withdraw.mutate()}
          className="flex-row items-center border border-slate-600 rounded-lg px-3 py-2"
        >
          <Undo2 size={14} color="#CBD5E1" />
          <Text className="text-slate-300 text-xs font-semibold ml-1.5">Withdraw</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PositionRow({ entry }: { entry: PositionRecord }) {
  const router = useRouter();

  const tone =
    entry.position === 'support'
      ? 'text-emerald-400'
      : entry.position === 'oppose'
        ? 'text-rose-400'
        : 'text-slate-400';

  const Icon =
    entry.position === 'support' ? ThumbsUp : entry.position === 'oppose' ? ThumbsDown : Undo2;

  const label =
    entry.position === 'support' ? 'Backed' : entry.position === 'oppose' ? 'Opposed' : 'Withdrew';

  return (
    <Pressable onPress={() => router.push(`/bill/${entry.reference.id}`)} className={CARD}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Icon size={14} color={entry.position === 'support' ? '#34D399' : '#FB7185'} />
          <Text className={`text-sm font-semibold ml-1.5 ${tone}`}>{label}</Text>

          {/* Shown, not hidden. On a platform about legislation the text moves
              under people, and reconsidering is the correct response to new
              information rather than something to be caught at. */}
          {entry.isChange ? (
            <View className="flex-row items-center bg-amber-500/20 rounded-full px-2 py-0.5 ml-2">
              <RefreshCw size={10} color="#F59E0B" />
              <Text className="text-amber-500 text-[10px] font-medium ml-1">Changed my mind</Text>
            </View>
          ) : null}

          {/* Only ever reaches your own record. Article IV shields you from
              other people, not from yourself. */}
          {entry.isAnonymous ? (
            <View className="flex-row items-center bg-slate-700/60 rounded-full px-2 py-0.5 ml-2">
              <EyeOff size={10} color="#94A3B8" />
              <Text className="text-slate-400 text-[10px] font-medium ml-1">Anonymous</Text>
            </View>
          ) : null}
        </View>

        <Text className="text-slate-500 text-xs">{when(entry.createdAt)}</Text>
      </View>

      <Text className="text-white text-sm mt-1">{entry.reference.title}</Text>

      {entry.reason ? (
        <Text className="text-slate-400 text-sm italic mt-2 pl-3 border-l-2 border-slate-700">
          {entry.reason}
        </Text>
      ) : null}

      {entry.lawMovedSince ? (
        <View className="flex-row items-start mt-2 bg-amber-500/10 rounded-lg p-2">
          <AlertTriangle size={12} color="#F59E0B" />
          <Text className="text-amber-500 text-xs ml-1.5 flex-1">
            The text has changed since — you took this on version {entry.lawVersion}, it is now on{' '}
            {entry.reference.lawVersion}.
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function RecordContent() {
  const router = useRouter();
  const { user } = useCurrentUser();

  /*
   * SOMEBODY ELSE'S RECORD, when asked for.
   *
   * This screen only ever showed your own, so a public profile had no route to
   * the one thing this platform exists to record — you could read somebody's
   * posts and never find out what they had stood for. The web twin embeds the
   * record directly in the profile; a phone has less room, so the profile links
   * here with ?user=<id>.
   *
   * The privacy rule is unchanged and lives in the server: positions are
   * public, the anonymous ones come back only to their author. The two private
   * sections below — where you stand alone, and what was said in your name —
   * are not requested at all for anybody else.
   */
  const { user: viewingId } = useLocalSearchParams<{ user?: string }>();
  const userId = viewingId ?? user?.id;
  const isMine = !viewingId || viewingId === user?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['positions', userId],
    queryFn: () =>
      api.get<{ results: PositionRecord[]; summary: PositionSummary }>(
        `/api/users/${userId}/positions`,
      ),
    enabled: Boolean(userId),
  });

  const { data: review } = useQuery({
    queryKey: ['positions-review'],
    queryFn: () => api.get<{ results: NeedingReview[] }>('/api/users/me/positions/review'),
    enabled: isMine && Boolean(userId),
  });

  // What was said in your name is not somebody else's business, even though
  // the positions themselves are public.
  const { data: receipts } = useQuery({
    queryKey: ['voice-receipts'],
    queryFn: () => api.get<{ results: VoiceReceipt[] }>('/api/delegations/receipts'),
    enabled: isMine && Boolean(userId),
  });

  const { data: standing } = useQuery({
    queryKey: ['standing'],
    queryFn: () => api.get<Standing>('/api/users/me/standing'),
    enabled: isMine && Boolean(userId),
  });

  const summary = data?.summary;
  const positions = Array.isArray(data?.results) ? data.results : [];
  const needingReview = Array.isArray(review?.results) ? review.results : [];
  const alone = Array.isArray(standing?.mostAlone) ? standing.mostAlone : [];
  const spokenFor = Array.isArray(receipts?.results) ? receipts.results : [];

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center px-4 py-3">
        <Pressable onPress={() => router.back()} className="mr-3">
          <ArrowLeft size={22} color="#F8FAFC" />
        </Pressable>
        <View>
          <Text className="text-white text-xl font-semibold">
            {isMine ? 'Your record' : 'Their record'}
          </Text>
          <Text className="text-slate-400 text-xs">
            {isMine
              ? 'Every position you have taken, and everything said in your name.'
              : "Every position they have taken on the government's business."}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {summary ? (
          <Animated.View entering={FadeInDown.springify()} className="flex-row flex-wrap -mx-1">
            {[
              { label: 'Positions', value: summary.total },
              { label: 'Backed', value: summary.support },
              { label: 'Opposed', value: summary.oppose },
              { label: 'Changed my mind', value: summary.changesOfMind },
            ].map((stat) => (
              <View key={stat.label} className="w-1/2 px-1 mb-2">
                <View className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/40">
                  <Text className="text-white text-2xl font-semibold">{stat.value}</Text>
                  <Text className="text-slate-400 text-xs">{stat.label}</Text>
                </View>
              </View>
            ))}
          </Animated.View>
        ) : null}

        {needingReview.length > 0 ? (
          <View className="bg-amber-500/10 rounded-xl p-4 border border-amber-500/40 mb-3">
            <View className="flex-row items-center">
              <Scale size={16} color="#F59E0B" />
              <Text className="text-white font-semibold text-sm ml-2">
                {needingReview.length} position{needingReview.length === 1 ? '' : 's'} on text that
                has changed
              </Text>
            </View>
            <Text className="text-slate-400 text-xs mt-1">
              Nothing was withdrawn for you. Have a look and decide.
            </Text>

            {needingReview.map((entry) => (
              <ReviewRow key={entry.reference.id} entry={entry} />
            ))}
          </View>
        ) : null}

        {alone.length > 0 ? (
          <View className={CARD}>
            <Text className="text-amber-500 text-xs font-semibold uppercase tracking-wider">
              Where you stand alone
            </Text>
            {/* NOT A SCORE. An agreement percentage that goes up for agreeing
                would teach that being with the majority is the goal. The
                useful half is the uncomfortable half. */}
            <Text className="text-slate-400 text-xs mt-1">
              You are with most people on {standing?.withMajority} of {standing?.measured}. These
              are the ones where you are not.
            </Text>

            {alone.slice(0, 5).map((entry) => (
              <Pressable
                key={entry.reference.id}
                onPress={() => router.push(`/bill/${entry.reference.id}`)}
                className="mt-2"
              >
                <Text className="text-white text-sm">{entry.reference.title}</Text>
                <Text className="text-slate-400 text-xs">
                  You {entry.yourPosition === 'support' ? 'backed' : 'opposed'} it, with{' '}
                  {entry.agreementPct}% of the room
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {spokenFor.length > 0 ? (
          <View className={CARD}>
            <View className="flex-row items-center">
              <Users size={14} color="#F59E0B" />
              <Text className="text-amber-500 text-xs font-semibold uppercase tracking-wider ml-1.5">
                Spoken in your name
              </Text>
            </View>
            <Text className="text-slate-400 text-xs mt-1">
              You lent your voice. This is what was done with it.
            </Text>

            {spokenFor.slice(0, 8).map((receipt) => (
              <Pressable
                key={receipt.referenceId}
                onPress={() => router.push(`/bill/${receipt.referenceId}`)}
                className="mt-2"
              >
                <Text className="text-white text-sm">{receipt.title}</Text>
                <Text className="text-slate-400 text-xs">
                  <Text
                    className={
                      receipt.position === 'support' ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {receipt.position === 'support' ? 'Backed' : 'Opposed'}
                  </Text>
                  {` by ${receipt.castBy.name}`}
                  {/* A voice travels the chain, so it can land with somebody
                      the citizen never chose. */}
                  {receipt.lentTo ? (
                    <Text className="text-amber-500">{` — you lent this to ${receipt.lentTo.name}`}</Text>
                  ) : null}
                </Text>
              </Pressable>
            ))}

            <Pressable onPress={() => router.push('/delegates')} className="mt-3">
              <Text className="text-amber-500 text-xs">Change who speaks for you</Text>
            </Pressable>
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color="#F59E0B" className="mt-8" />
        ) : positions.length === 0 ? (
          <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
            <Text className="text-white text-base">You have not taken a position yet</Text>
            <Text className="text-slate-400 text-sm mt-1 text-center px-6">
              Back or oppose a law and it will appear here, permanently.
            </Text>
          </View>
        ) : (
          positions.map((entry) => <PositionRow key={entry.id} entry={entry} />)
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function RecordScreen() {
  return (
    <AuthGate
      capability="viewVotingHistory"
      reason="Sign in to see your record — every position you have taken, and everything said in your name."
    >
      <RecordContent />
    </AuthGate>
  );
}
