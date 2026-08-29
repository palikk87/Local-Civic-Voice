/**
 * THE DECISION PAGE — Constitution Article IV.
 *
 * Phone twin of apps/web/src/pages/JuryCase.tsx. Same routes, same words, same
 * refusals.
 *
 * WHAT A JUROR SEES HERE IS EVERYTHING THE CASE CAN SHOW THEM: the post or the
 * comment, the law it points at, that law's citizen brief, and what the report
 * said. Judging on a screenshot is not judging.
 *
 * PRIOR FINDINGS ARE WITHHELD UNTIL THE VERDICT IS IN. A jury that starts by
 * reading somebody's record is weighing the person and not the case.
 *
 * AND THE TWO WAYS OUT ARE ON THIS SCREEN, next to the vote, because once they
 * accept this is the only screen they have.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Scale, ShieldAlert, Clock, FileText, ArrowLeft } from 'lucide-react-native';
import { cn } from '@/lib/cn';
import { publicHandle } from '@/lib/public-identity';
import { juries, panelSentence, reasonLabel, type JuryCase } from '@/lib/juries';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Panel({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'danger' | 'quiet';
}) {
  return (
    <View
      className={cn(
        'mb-4 rounded-2xl border p-4',
        tone === 'danger'
          ? 'border-amber-500/40 bg-amber-500/10'
          : tone === 'quiet'
            ? 'border-slate-700/50 bg-slate-800/20'
            : 'border-slate-700/50 bg-slate-800/40'
      )}
    >
      {children}
    </View>
  );
}

function Evidence({ file }: { file: JuryCase }) {
  const content = file.comment ?? file.post;
  const reference =
    file.comment?.post?.governmentReference ?? file.post?.governmentReference ?? null;

  if (!content) {
    return (
      <Panel tone="quiet">
        <Text testID="jury-evidence-gone" className="text-sm leading-6 text-slate-400">
          What this report was about is no longer on the platform. The case can still be decided —
          but say so in your reasoning.
        </Text>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {file.comment ? 'The comment that was reported' : 'The post that was reported'}
        </Text>
        <Text testID="jury-evidence" className="text-sm leading-6 text-white">
          {content.content}
        </Text>
        <Text className="mt-2 text-xs text-slate-500">
          by @{publicHandle(content.author)} · {when(content.createdAt)}
        </Text>
      </Panel>

      {file.comment?.post ? (
        <Panel tone="quiet">
          <Text className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            The post it was a comment on
          </Text>
          <Text className="text-sm leading-6 text-slate-400">{file.comment.post.content}</Text>
        </Panel>
      ) : null}

      {reference ? (
        <Panel tone="quiet">
          <View className="mb-2 flex-row items-center">
            <FileText size={13} color="#8FA79A" />
            <Text className="ml-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              The law it points at
            </Text>
          </View>
          <Text className="text-sm font-medium text-white">{reference.title}</Text>
          <Text className="mt-0.5 text-xs text-slate-500">
            {reference.masterReferenceId} · {reference.status}
          </Text>
          {reference.citizenBrief ? (
            <Text testID="jury-brief" className="mt-2 text-sm leading-6 text-slate-400">
              {reference.citizenBrief}
            </Text>
          ) : (
            <Text className="mt-2 text-xs text-slate-500">
              No citizen's brief has been written for this law yet.
            </Text>
          )}
        </Panel>
      ) : null}
    </>
  );
}

export default function JuryCaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [ballot, setBallot] = useState<'uphold' | 'dismiss' | null>(null);
  const [reasoning, setReasoning] = useState('');
  const [recusing, setRecusing] = useState(false);
  const [recusalReason, setRecusalReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rules = useQuery({ queryKey: ['juries', 'rules'], queryFn: juries.rules });
  const { data, isLoading, isError } = useQuery({
    queryKey: ['juries', 'case', id],
    queryFn: () => juries.case(id!),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['juries'] });
  };

  const accepting = useMutation({
    mutationFn: () => juries.accept(id!),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not accept the summons.'),
  });

  const deciding = useMutation({
    mutationFn: () => juries.verdict(id!, ballot!, reasoning),
    onSuccess: () => {
      setError(null);
      setReasoning('');
      setBallot(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not record that verdict.'),
  });

  const steppingAside = useMutation({
    mutationFn: () => juries.recuse(id!, recusalReason),
    onSuccess: () => {
      setError(null);
      setRecusing(false);
      queryClient.clear();
      router.replace('/(tabs)');
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not step aside.'),
  });

  const file = data?.case;
  const minReasoning = rules.data?.minReasoningLength ?? 20;

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Pressable onPress={() => router.back()} className="mb-4 flex-row items-center">
          <ArrowLeft size={16} color="#8FA79A" />
          <Text className="ml-1 text-sm text-slate-400">Back</Text>
        </Pressable>

        <View className="mb-4 flex-row items-center">
          <Scale size={20} color="#D0E0D6" />
          <Text className="ml-2 text-xl font-semibold text-white">Community Jury</Text>
        </View>

        {isLoading ? <ActivityIndicator color="#8FA79A" /> : null}

        {isError ? (
          <Text testID="jury-not-yours" className="text-sm leading-6 text-slate-400">
            This case is still being heard. It is published in full, with every juror's reasoning,
            once it is decided.
          </Text>
        ) : null}

        {error ? (
          <View className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3">
            <Text className="text-sm text-red-300">{error}</Text>
          </View>
        ) : null}

        {file ? (
          <View testID="jury-case">
            <Panel tone={file.status === 'decided' ? 'quiet' : 'danger'}>
              <View className="flex-row items-start">
                <ShieldAlert size={20} color="#F59E0B" />
                <View className="ml-3 flex-1">
                  <Text className="text-sm font-semibold text-white">
                    {file.status === 'decided'
                      ? file.verdict === 'upheld'
                        ? 'This report was upheld'
                        : 'This report was dismissed'
                      : `Reported as: ${reasonLabel(file.report.reason)}`}
                  </Text>
                  <Text className="mt-1 text-sm leading-6 text-slate-400">
                    {panelSentence(file)}
                    {file.accusedIsCivilLeader
                      ? ` This account holds ${file.accusedDelegations} delegated votes, so the panel is larger.`
                      : ''}
                  </Text>
                  {file.report.detail ? (
                    <Text testID="jury-report-detail" className="mt-2 text-sm leading-6 text-white">
                      “{file.report.detail}”
                    </Text>
                  ) : null}
                </View>
              </View>
            </Panel>

            <Evidence file={file} />

            {file.viewer.seatState === 'summoned' ? (
              <Panel>
                <Text className="text-sm font-semibold text-white">You have been called</Text>
                <Text className="mt-1 text-sm leading-6 text-slate-400">
                  You were drawn at random. If you accept,{' '}
                  <Text className="font-semibold text-white">
                    the platform closes around this case until you have voted
                  </Text>{' '}
                  — no feed, no messages, nothing else. If you do nothing by{' '}
                  {file.viewer.answerBy ? when(file.viewer.answerBy) : 'tomorrow'}, the seat goes to
                  somebody else.
                </Text>
                <Pressable
                  testID="jury-accept"
                  disabled={accepting.isPending}
                  onPress={() => accepting.mutate()}
                  className="mt-3 items-center rounded-xl bg-white py-3"
                >
                  <Text className="text-sm font-semibold text-slate-900">Accept the summons</Text>
                </Pressable>
                <Pressable
                  testID="jury-step-aside"
                  onPress={() => setRecusing(true)}
                  className="mt-2 items-center rounded-xl border border-slate-600 py-3"
                >
                  <Text className="text-sm font-medium text-slate-200">Step aside</Text>
                </Pressable>
              </Panel>
            ) : null}

            {file.viewer.seatState === 'accepted' ? (
              <Panel>
                <View className="flex-row items-center">
                  <Gavel size={16} color="#D0E0D6" />
                  <Text className="ml-2 text-sm font-semibold text-white">Your decision</Text>
                </View>
                <Text className="mt-1 text-sm leading-6 text-slate-400">
                  Did this break the Code of Conduct? Say what you decided and why — your reasoning
                  is published with the verdict, without your name on it.
                </Text>

                <View className="mt-3 flex-row">
                  <Pressable
                    testID="jury-uphold"
                    onPress={() => setBallot('uphold')}
                    className={cn(
                      'mr-2 flex-1 items-center rounded-xl border py-3',
                      ballot === 'uphold'
                        ? 'border-amber-500 bg-amber-500/15'
                        : 'border-slate-700'
                    )}
                  >
                    <Text className="text-sm font-semibold text-white">It broke the rules</Text>
                  </Pressable>
                  <Pressable
                    testID="jury-dismiss"
                    onPress={() => setBallot('dismiss')}
                    className={cn(
                      'flex-1 items-center rounded-xl border py-3',
                      ballot === 'dismiss'
                        ? 'border-emerald-500 bg-emerald-500/15'
                        : 'border-slate-700'
                    )}
                  >
                    <Text className="text-sm font-semibold text-white">It did not</Text>
                  </Pressable>
                </View>

                <TextInput
                  testID="jury-reasoning"
                  value={reasoning}
                  onChangeText={setReasoning}
                  multiline
                  numberOfLines={4}
                  placeholder={`Why? At least ${minReasoning} characters.`}
                  placeholderTextColor="#6E8A7C"
                  className="mt-3 min-h-24 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
                />

                <Pressable
                  testID="jury-submit"
                  disabled={
                    deciding.isPending || !ballot || reasoning.trim().length < minReasoning
                  }
                  onPress={() => deciding.mutate()}
                  className={cn(
                    'mt-2 items-center rounded-xl py-3',
                    deciding.isPending || !ballot || reasoning.trim().length < minReasoning
                      ? 'bg-slate-700/50'
                      : 'bg-white'
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm font-semibold',
                      deciding.isPending || !ballot || reasoning.trim().length < minReasoning
                        ? 'text-slate-500'
                        : 'text-slate-900'
                    )}
                  >
                    Record my verdict
                  </Text>
                </Pressable>

                <View className="mt-4 border-t border-slate-700/50 pt-3">
                  <View className="flex-row items-center">
                    <Clock size={13} color="#8FA79A" />
                    <Text className="ml-1.5 flex-1 text-xs leading-5 text-slate-500">
                      If you do nothing, the platform releases you on its own
                      {file.viewer.releasedAt
                        ? ` at ${when(file.viewer.releasedAt)}`
                        : ' within a day'}
                      , and the seat is redrawn.
                    </Text>
                  </View>
                  <Pressable testID="jury-step-aside" onPress={() => setRecusing(true)}>
                    <Text className="mt-2 text-xs font-medium text-slate-400 underline">
                      Or step aside now, with a reason
                    </Text>
                  </Pressable>
                </View>
              </Panel>
            ) : null}

            {recusing ? (
              <Panel>
                <Text className="text-sm font-semibold text-white">Stepping aside</Text>
                <Text className="mt-1 text-sm leading-6 text-slate-400">
                  Sometimes you know the person, or the case is distressing, or you simply cannot be
                  fair to it. Forcing a verdict out of somebody who should not give one is worse
                  than redrawing. Say briefly why — it is recorded, and somebody else is drawn.
                </Text>
                <TextInput
                  testID="jury-recusal-reason"
                  value={recusalReason}
                  onChangeText={setRecusalReason}
                  multiline
                  numberOfLines={3}
                  placeholderTextColor="#6E8A7C"
                  className="mt-3 min-h-20 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
                />
                <Pressable
                  testID="jury-recuse-confirm"
                  disabled={steppingAside.isPending}
                  onPress={() => steppingAside.mutate()}
                  className="mt-2 items-center rounded-xl border border-slate-600 py-3"
                >
                  <Text className="text-sm font-medium text-slate-200">Step aside</Text>
                </Pressable>
                <Pressable onPress={() => setRecusing(false)} className="mt-2 items-center py-2">
                  <Text className="text-sm text-slate-500">Stay on the case</Text>
                </Pressable>
              </Panel>
            ) : null}

            {file.viewer.hasVoted && file.status !== 'decided' ? (
              <Panel tone="quiet">
                <Text testID="jury-voted" className="text-sm leading-6 text-slate-400">
                  Your verdict is recorded and you are free to go. The case closes when{' '}
                  {file.votesToDecide} jurors agree one way or the other.
                </Text>
              </Panel>
            ) : null}

            {file.status === 'decided' ? (
              <>
                <Panel>
                  <Text className="text-sm font-semibold text-white">What the jury said</Text>
                  <Text className="mt-1 text-xs text-slate-500">
                    {file.tally.uphold} of {file.tally.uphold + file.tally.dismiss} jurors found it
                    broke the rules. Reasons are published without names.
                  </Text>
                  {file.reasons.map((reason, index) => (
                    <View
                      key={index}
                      testID="jury-reason"
                      className="mt-2 rounded-xl border border-slate-700/50 bg-slate-800/30 p-3"
                    >
                      <Text className="text-xs font-medium text-slate-500">
                        {reason.vote === 'uphold' ? 'Broke the rules' : 'Did not break the rules'}
                      </Text>
                      <Text className="mt-1 text-sm leading-6 text-white">{reason.reasoning}</Text>
                    </View>
                  ))}
                </Panel>

                {file.priorFindings !== null ? (
                  <Panel tone="quiet">
                    <Text testID="jury-prior-findings" className="text-sm leading-6 text-slate-400">
                      {file.priorFindings === 0
                        ? 'No jury has upheld a report against this account before.'
                        : `${file.priorFindings} earlier report${file.priorFindings === 1 ? ' has' : 's have'} been upheld against this account.`}{' '}
                      This was withheld from the jury until they had decided.
                    </Text>
                  </Panel>
                ) : null}
              </>
            ) : null}

            <Panel tone="quiet">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                How this jury was drawn
              </Text>
              {file.draw.map((seat) => (
                <Text key={seat.id} testID="jury-seat" className="mt-1 text-xs text-slate-500">
                  Seat summoned {when(seat.summonedAt)} — {seat.state}
                  {seat.replacesSeatId ? ' (a replacement)' : ''}
                  {seat.isYou ? ' — you' : ''}
                </Text>
              ))}
              <Text className="mt-2 text-[11px] leading-4 text-slate-600">
                Jurors are drawn at random from people who have earned delegate standing, never from
                the accused's own delegators, the reporter, or anybody blocked either way.
              </Text>
            </Panel>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
