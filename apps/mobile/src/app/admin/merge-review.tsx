// Two records that might be one law — mobile twin of
// apps/web/src/components/admin/MergeReviewTab.tsx.
//
// This screen exists because the system deliberately refuses to guess. Only
// congress.gov's "Identical bill" — a Library of Congress analyst confirming two
// texts match — is acted on automatically, and by the time such a pair appears
// here it is already merged and marked approved. Everything else is a question,
// and the answer is destructive: approving rewrites which record every affected
// post and vote belongs to.
//
// So the screen's job is to make the question answerable. Every card carries
// what the government called the relationship, who assigned it, a link to the
// page a reviewer can read for themselves, and what each record would cost to
// fold away — its posts, its real votes, whether it already has a brief.
//
// Look-alikes are this platform's own title guesses. They carry no source and no
// analyst, and the card says so in as many words.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  ExternalLink,
  GitMerge,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAdminStore } from '@/lib/admin-store';
import { BACKEND_URL } from '@/lib/config';

interface MergeSide {
  id: string;
  masterReferenceId: string;
  displayId: string;
  referenceType: string;
  title: string;
  status: string;
  congress: number | null;
  sourceUrl: string | null;
  votes: { support: number; oppose: number };
  posts: number;
  realVotes: number;
  hasBrief: boolean;
  createdAt: string;
}

interface MergeCandidate {
  id: string;
  relationship: string;
  identifiedBy: string | null;
  evidenceUrl: string | null;
  similarity: number | null;
  isSuggestion: boolean;
  status: string;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
  left: MergeSide;
  right: MergeSide;
}

/** Plain-language gloss on the government's own label. */
const RELATIONSHIP_MEANING: Record<string, string> = {
  'Identical bill': 'The Library of Congress confirmed both texts match.',
  'Companion measure': 'Filed in the other chamber to move in parallel.',
  'Procedurally-related': 'Linked by a rule or a motion, not by their text.',
  look_alike: 'A title match this platform noticed. No source, no analyst — a suggestion only.',
};

export default function MergeReviewScreen() {
  const router = useRouter();
  const session = useAdminStore((s) => s.session);

  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDecided, setShowDecided] = useState(false);
  const [rejecting, setRejecting] = useState<MergeCandidate | null>(null);
  const [note, setNote] = useState('');

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    }),
    [session?.token],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/reference-merges?status=${showDecided ? 'all' : 'pending'}`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const body = (await response.json()) as { candidates: MergeCandidate[] };
      setCandidates(body.candidates);
    } catch (error) {
      Alert.alert('Could not load', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authHeaders, showDecided]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((parsed.error as string) ?? `Request failed: ${response.status}`);
      }
      await load();
      return parsed;
    } catch (error) {
      Alert.alert('Failed', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  };

  /**
   * Approving is destructive and irreversible from this screen, so it is
   * confirmed in words that say what actually happens rather than "are you
   * sure".
   */
  const approve = (candidate: MergeCandidate, keep: MergeSide, fold: MergeSide) => {
    Alert.alert(
      `Keep ${keep.displayId}?`,
      `${fold.displayId} becomes part of it. Its ${fold.posts} post(s) and ` +
        `${fold.realVotes} vote(s) move across, and every vote on both lands in one count. ` +
        `Nobody's post is rewritten.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          style: 'destructive',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            void mutate(`/api/admin/reference-merges/${candidate.id}/approve`, {
              keepId: keep.id,
            });
          },
        },
      ],
    );
  };

  const recheck = async () => {
    const result = await mutate('/api/admin/reference-merges/refresh', {});
    if (result) Alert.alert('Checking congress.gov', result.message as string);
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="flex-row items-center">
          <ArrowLeft size={22} color="#94A3B8" />
          <Text className="text-slate-300 ml-2 text-base">Back</Text>
        </TouchableOpacity>
        <View className="flex-row items-center">
          <GitMerge size={20} color="#3B82F6" />
          <Text className="text-white font-bold text-base ml-2">Merge review</Text>
        </View>
        <TouchableOpacity onPress={() => void recheck()}>
          <RefreshCw size={20} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#94A3B8"
          />
        }
      >
        <Text className="text-slate-400 text-sm mt-4">
          Congress files the same law twice as a matter of routine. Until two records are joined,
          the country's opinion on that law is split across two counts. Pairs the Library of
          Congress has confirmed identical are already merged; these are the ones that need a
          person.
        </Text>

        <TouchableOpacity
          onPress={() => setShowDecided((v) => !v)}
          className="self-start mt-3 px-3 py-1.5 rounded-full bg-slate-800"
        >
          <Text className="text-slate-300 text-xs">
            {showDecided ? 'Pending only' : 'Show decided'}
          </Text>
        </TouchableOpacity>

        {loading ? (
          <Text className="text-slate-500 text-sm mt-8 text-center">Loading…</Text>
        ) : candidates.length === 0 ? (
          <Text className="text-slate-500 text-sm mt-8 text-center">
            Nothing waiting. Every pair the government has published a relationship for has been
            answered.
          </Text>
        ) : (
          candidates.map((candidate) => (
            <View
              key={candidate.id}
              className={`mt-4 rounded-xl p-4 border ${
                candidate.isSuggestion ? 'border-slate-700 bg-slate-900/60' : 'border-slate-800 bg-slate-900'
              }`}
            >
              <View className="flex-row flex-wrap items-center gap-2">
                {candidate.isSuggestion ? (
                  <View className="flex-row items-center px-2 py-1 rounded-full bg-slate-800">
                    <Lightbulb size={12} color="#94A3B8" />
                    <Text className="text-slate-300 text-xs ml-1">Suggestion only</Text>
                  </View>
                ) : (
                  <View className="flex-row items-center px-2 py-1 rounded-full bg-blue-500/20">
                    <ShieldCheck size={12} color="#60A5FA" />
                    <Text className="text-blue-400 text-xs ml-1">{candidate.relationship}</Text>
                  </View>
                )}
                {/* Who assigned it. Its absence on a suggestion is the point. */}
                {candidate.identifiedBy ? (
                  <Text className="text-slate-500 text-xs">
                    identified by {candidate.identifiedBy}
                  </Text>
                ) : null}
                {candidate.similarity !== null ? (
                  <Text className="text-slate-500 text-xs">
                    {Math.round(candidate.similarity * 100)}% title overlap
                  </Text>
                ) : null}
                {candidate.status !== 'pending' ? (
                  <Text className="text-slate-400 text-xs capitalize">{candidate.status}</Text>
                ) : null}
              </View>

              {RELATIONSHIP_MEANING[candidate.relationship] ? (
                <Text className="text-slate-400 text-sm mt-2">
                  {RELATIONSHIP_MEANING[candidate.relationship]}
                </Text>
              ) : null}
              {candidate.note ? (
                <Text className="text-slate-500 text-sm italic mt-1">{candidate.note}</Text>
              ) : null}

              {candidate.evidenceUrl ? (
                <TouchableOpacity
                  className="flex-row items-center mt-2"
                  onPress={() => void Linking.openURL(candidate.evidenceUrl!)}
                >
                  <Text className="text-blue-400 text-sm">Read it on congress.gov</Text>
                  <ExternalLink size={13} color="#60A5FA" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ) : null}

              <SideCard side={candidate.left} />
              <SideCard side={candidate.right} />

              {candidate.status === 'pending' ? (
                <View className="mt-3">
                  {/*
                    Which record survives is the reviewer's call, not the
                    system's: they can see which one carries the posts and the
                    votes. Both directions are offered explicitly.
                  */}
                  <TouchableOpacity
                    className="flex-row items-center justify-center py-2.5 rounded-lg bg-blue-600"
                    onPress={() => approve(candidate, candidate.left, candidate.right)}
                  >
                    <CircleCheck size={16} color="#FFFFFF" />
                    <Text className="text-white text-sm font-semibold ml-2">
                      Keep {candidate.left.displayId}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-row items-center justify-center py-2.5 rounded-lg bg-blue-600 mt-2"
                    onPress={() => approve(candidate, candidate.right, candidate.left)}
                  >
                    <CircleCheck size={16} color="#FFFFFF" />
                    <Text className="text-white text-sm font-semibold ml-2">
                      Keep {candidate.right.displayId}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    className="flex-row items-center justify-center py-2.5 rounded-lg bg-slate-800 mt-2"
                    onPress={() => {
                      setRejecting(candidate);
                      setNote('');
                    }}
                  >
                    <CircleX size={16} color="#94A3B8" />
                    <Text className="text-slate-300 text-sm ml-2">Different laws</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))
        )}

        <View className="h-10" />
      </ScrollView>

      <Modal visible={Boolean(rejecting)} transparent animationType="slide">
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-slate-900 rounded-t-2xl p-5">
            <Text className="text-white text-lg font-bold">These are two different laws</Text>
            <Text className="text-slate-400 text-sm mt-1">
              This pair will not be raised again. A note here is what stops somebody
              re-litigating it in six months — say what made them different.
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. Same subject, different appropriations year."
              placeholderTextColor="#64748B"
              multiline
              className="bg-slate-800 text-white rounded-lg p-3 mt-3 min-h-[80px]"
            />
            <View className="flex-row justify-end mt-4">
              <TouchableOpacity className="px-4 py-2.5" onPress={() => setRejecting(null)}>
                <Text className="text-slate-400">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="px-4 py-2.5 rounded-lg bg-blue-600"
                onPress={() => {
                  const target = rejecting;
                  if (!target) return;
                  setRejecting(null);
                  void mutate(`/api/admin/reference-merges/${target.id}/reject`, {
                    ...(note.trim() ? { note: note.trim() } : {}),
                  });
                }}
              >
                <Text className="text-white font-semibold">Record it</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** What one record would cost to fold away. */
function SideCard({ side }: { side: MergeSide }) {
  return (
    <View className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-white font-semibold text-sm">{side.displayId}</Text>
        <Text className="text-slate-500 text-xs capitalize">{side.status}</Text>
      </View>
      <Text className="text-slate-300 text-sm mt-1" numberOfLines={2}>
        {side.title}
      </Text>
      <Text className="text-slate-500 text-xs mt-2">
        {side.posts} post{side.posts === 1 ? '' : 's'} · {side.realVotes} real vote
        {side.realVotes === 1 ? '' : 's'} · {side.votes.support.toLocaleString()} for /{' '}
        {side.votes.oppose.toLocaleString()} against
        {side.hasBrief ? ' · has a brief' : ''}
      </Text>
      {side.sourceUrl ? (
        <TouchableOpacity
          className="flex-row items-center mt-2"
          onPress={() => void Linking.openURL(side.sourceUrl!)}
        >
          <Text className="text-blue-400 text-xs">Official page</Text>
          <ExternalLink size={11} color="#60A5FA" style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
