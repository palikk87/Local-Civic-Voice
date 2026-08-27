/**
 * ARTICLE V — SELF-CORRECTION, on real proceedings.
 *
 * PHONE TWIN of apps/web/src/pages/ArticleV.tsx.
 *
 * WHAT THIS SCREEN USED TO BE. Three hardcoded people — "Dr. Sarah Chen",
 * "Marcus Rivera", "James Park" — with invented trust scores and invented
 * impeachment tallies, and a Vote to Impeach button that set a local flag. The
 * System Reset tab showed "12,450 for, 45,230 against", numbers that had never
 * existed. A citizen could believe they had exercised a constitutional power
 * and nothing at all had happened.
 *
 * Everything below reads the server. When nothing is happening, it says so.
 */

import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Stack } from 'expo-router';
import {
  ChevronLeft,
  AlertTriangle,
  RotateCcw,
  Users,
  CheckCircle,
  Gavel,
  FileText,
  BookOpen,
  Scale,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/auth/use-civic-auth';
import {
  articleV,
  daysLeft,
  hoursLeft,
  personLabel,
  type ArticleVPerson,
  type ImpeachmentProceeding,
  type MyDelegation,
  type SystemResetState,
} from '@/lib/article-v';

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Panel({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
}) {
  return (
    <View
      className={cn(
        'mb-4 rounded-2xl border p-4',
        tone === 'danger'
          ? 'border-red-700/50 bg-red-900/25'
          : tone === 'warning'
            ? 'border-amber-700/40 bg-amber-900/20'
            : 'border-slate-700/50 bg-slate-800/60'
      )}
    >
      {children}
    </View>
  );
}

/** An empty state that teaches the mechanism instead of inventing one. */
function Nothing({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <View className="flex-row items-start">
        <Scale size={20} color="#94A3B8" />
        <View className="ml-3 flex-1">
          <Text className="font-semibold text-white">{title}</Text>
          <View className="mt-1">{children}</View>
        </View>
      </View>
    </Panel>
  );
}

function filedOn(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * THE FILING ITSELF, as the person who brought it wrote it.
 *
 * Presented as the document it is — named, attributed, dated — rather than two
 * unlabelled paragraphs. Somebody deciding how to vote is being asked to judge
 * a formal accusation, and they cannot do that without seeing that it IS one,
 * who made it, and when. Never truncated and never behind a "read more".
 */
function Articles({
  kind,
  filedBy,
  openedAt,
  grounds,
  evidence,
}: {
  kind: 'impeachment' | 'reset';
  filedBy: ArticleVPerson | null;
  openedAt: string;
  grounds: string;
  evidence: string;
}) {
  return (
    <View
      testID={kind === 'impeachment' ? 'articles-of-impeachment' : 'articles-of-reset'}
      className="mt-3 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3"
    >
      <View className="flex-row items-start border-b border-slate-700/50 pb-2">
        <FileText size={16} color="#94A3B8" />
        <View className="ml-2 flex-1">
          <Text className="text-sm font-semibold text-white">
            {kind === 'impeachment'
              ? 'Articles of Impeachment'
              : 'Articles of System Reset'}
          </Text>
          <Text className="text-xs text-slate-400">
            Filed by {personLabel(filedBy)} on {filedOn(openedAt)}
          </Text>
        </View>
      </View>

      <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Grounds
      </Text>
      <Text className="mt-1 text-sm leading-6 text-slate-200">{grounds}</Text>
      <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Evidence
      </Text>
      <Text className="mt-1 text-sm leading-6 text-slate-200">{evidence}</Text>
    </View>
  );
}

function Bar({ value, max, tone }: { value: number; max: number; tone: 'amber' | 'red' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <View className="h-2 overflow-hidden rounded-full bg-slate-700">
      <View
        className={cn('h-full rounded-full', tone === 'red' ? 'bg-red-500' : 'bg-amber-500')}
        style={{ width: `${pct}%` }}
      />
    </View>
  );
}

function ArticlesForm({
  minLength,
  maxLength,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  minLength: number;
  maxLength: number;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (grounds: string, evidence: string) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState('');
  const [evidence, setEvidence] = useState('');
  const ready = grounds.trim().length >= minLength && evidence.trim().length >= minLength;

  return (
    <View className="mt-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Grounds — what they are accused of
      </Text>
      <TextInput
        testID="articles-grounds"
        value={grounds}
        onChangeText={(text) => setGrounds(text.slice(0, maxLength))}
        multiline
        numberOfLines={4}
        placeholder="State the accusation plainly."
        placeholderTextColor="#64748B"
        className="mt-1 min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
      />
      <Text className="mt-1 text-xs text-slate-500">
        {grounds.trim().length} of at least {minLength} characters
      </Text>

      <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Evidence — what shows it
      </Text>
      <TextInput
        testID="articles-evidence"
        value={evidence}
        onChangeText={(text) => setEvidence(text.slice(0, maxLength))}
        multiline
        numberOfLines={4}
        placeholder="Point at what anybody can check."
        placeholderTextColor="#64748B"
        className="mt-1 min-h-[96px] rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100"
      />
      <Text className="mt-1 text-xs text-slate-500">
        {evidence.trim().length} of at least {minLength} characters
      </Text>

      {/* Said before they file, not after. */}
      <Text className="mt-3 rounded-xl border border-amber-700/40 bg-amber-900/20 p-3 text-xs leading-5 text-amber-200">
        This is a formal filing. It is delivered to the person it names, in their inbox and by
        email, and it goes to the platform's administrators. Nobody can stop the proceeding once
        it starts — but a filing made in bad faith is grounds for suspending or banning the person
        who made it.
      </Text>

      {error ? <Text className="mt-2 text-sm text-red-400">{error}</Text> : null}

      <View className="mt-3 flex-row">
        <Pressable
          testID="articles-submit"
          disabled={!ready || busy}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onSubmit(grounds.trim(), evidence.trim());
          }}
          className={cn(
            'flex-1 items-center rounded-xl py-3',
            ready && !busy ? 'bg-red-600' : 'bg-slate-700/50'
          )}
        >
          <Text className={cn('font-semibold', ready && !busy ? 'text-white' : 'text-slate-500')}>
            {busy ? 'Filing…' : submitLabel}
          </Text>
        </Pressable>
        <Pressable
          onPress={onCancel}
          className="ml-2 rounded-xl border border-slate-700 px-4 py-3"
        >
          <Text className="text-sm text-slate-300">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Impeachment
// ---------------------------------------------------------------------------

function ProceedingCard({
  proceeding,
  onVote,
  onWithdraw,
  busy,
}: {
  proceeding: ImpeachmentProceeding;
  onVote: (id: string, days: number) => void;
  onWithdraw: (id: string) => void;
  busy: boolean;
}) {
  const [days, setDays] = useState('30');
  const open = proceeding.status === 'open';
  const needed = Math.ceil(proceeding.electorCount * 0.66);
  const proposed = Number(days);

  return (
    <Panel tone={proceeding.status === 'passed' ? 'danger' : open ? 'warning' : 'neutral'}>
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <Text className="text-lg font-semibold text-white">
            {personLabel(proceeding.leader)}
          </Text>
          <Text className="text-sm text-slate-400">
            {proceeding.electorCount} delegator{proceeding.electorCount === 1 ? '' : 's'} may vote
          </Text>
        </View>
        <View
          className={cn(
            'rounded-full px-2 py-0.5',
            proceeding.status === 'passed'
              ? 'bg-red-500/20'
              : open
                ? 'bg-amber-500/20'
                : 'bg-slate-600/30'
          )}
        >
          <Text
            className={cn(
              'text-xs font-medium',
              proceeding.status === 'passed'
                ? 'text-red-300'
                : open
                  ? 'text-amber-300'
                  : 'text-slate-300'
            )}
          >
            {proceeding.status === 'passed'
              ? 'Impeached'
              : open
                ? `${daysLeft(proceeding.expiresAt)} days left`
                : 'Closed without two thirds'}
          </Text>
        </View>
      </View>

      <Articles
        kind="impeachment"
        filedBy={proceeding.filedBy}
        openedAt={proceeding.openedAt}
        grounds={proceeding.grounds}
        evidence={proceeding.evidence}
      />

      <View className="mt-3">
        <View className="mb-1 flex-row justify-between">
          <Text className="text-xs text-slate-400">Votes to impeach</Text>
          <Text className="text-xs font-medium text-amber-300">
            {proceeding.votes} of {proceeding.electorCount} — {needed} needed
          </Text>
        </View>
        <Bar
          value={proceeding.votes}
          max={Math.max(needed, 1)}
          tone={proceeding.status === 'passed' ? 'red' : 'amber'}
        />
        <Text className="mt-2 text-xs leading-5 text-slate-500">
          Two thirds of the people who were delegating to {personLabel(proceeding.leader)} when
          this was filed. Nobody who delegated afterwards has a vote.
        </Text>
      </View>

      {proceeding.status === 'passed' && proceeding.suspendedUntil ? (
        <Text className="mt-3 text-sm text-red-200">
          Suspended from receiving delegations until{' '}
          {new Date(proceeding.suspendedUntil).toLocaleDateString()}. Their account, followers,
          posts and their own vote are untouched.
        </Text>
      ) : null}

      {open ? (
        proceeding.viewerHasVoted ? (
          <View className="mt-4">
            <View className="flex-row items-center rounded-xl bg-slate-700/40 p-3">
              <CheckCircle size={18} color="#34D399" />
              <Text className="ml-2 text-sm font-medium text-emerald-300">
                You voted to impeach
                {proceeding.viewerProposedDays
                  ? `, and proposed ${proceeding.viewerProposedDays} days`
                  : ''}
              </Text>
            </View>
            <Pressable
              testID="impeachment-withdraw"
              disabled={busy}
              onPress={() => onWithdraw(proceeding.id)}
              className="mt-2 items-center rounded-xl border border-slate-700 py-2"
            >
              <Text className="text-sm text-slate-300">Take my vote back</Text>
            </Pressable>
          </View>
        ) : (
          <View className="mt-4">
            <Text className="text-xs text-slate-400">
              How long should the suspension run? The average of everybody who votes sets the
              date.
            </Text>
            <TextInput
              testID="impeachment-days"
              value={days}
              onChangeText={setDays}
              keyboardType="number-pad"
              className="mt-1 rounded-xl border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100"
            />
            <Pressable
              testID="impeachment-vote"
              disabled={busy || !(proposed >= 1 && proposed <= 365)}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                onVote(proceeding.id, proposed);
              }}
              className={cn(
                'mt-2 flex-row items-center justify-center rounded-xl py-3',
                busy || !(proposed >= 1 && proposed <= 365) ? 'bg-slate-700/50' : 'bg-red-600/80'
              )}
            >
              <Gavel size={18} color="#fff" />
              <Text className="ml-2 font-semibold text-white">Vote to impeach</Text>
            </Pressable>
          </View>
        )
      ) : null}
    </Panel>
  );
}

function FileAgainstDelegate({
  delegation,
  minLength,
  maxLength,
  onFiled,
}: {
  delegation: MyDelegation;
  minLength: number;
  maxLength: number;
  onFiled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filing = useMutation({
    mutationFn: ({ grounds, evidence }: { grounds: string; evidence: string }) =>
      articleV.file(delegation.toUser.id, grounds, evidence),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      onFiled();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not file.'),
  });

  return (
    <Panel>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-3">
          <Text className="font-semibold text-white">{personLabel(delegation.toUser)}</Text>
          <Text className="text-xs text-slate-400">
            {delegation.category
              ? `You delegate your vote on ${delegation.category}`
              : 'You delegate your vote across every category'}
          </Text>
        </View>
        {!open ? (
          <Pressable
            testID="open-articles-form"
            onPress={() => setOpen(true)}
            className="rounded-xl border border-red-700/50 px-3 py-2"
          >
            <Text className="text-sm text-red-300">File Articles</Text>
          </Pressable>
        ) : null}
      </View>

      {open ? (
        <ArticlesForm
          minLength={minLength}
          maxLength={maxLength}
          submitLabel="File Articles of Impeachment"
          busy={filing.isPending}
          error={error}
          onSubmit={(grounds, evidence) => filing.mutate({ grounds, evidence })}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </Panel>
  );
}

function ImpeachmentTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = usePermissions();
  const [error, setError] = useState<string | null>(null);

  const rules = useQuery({ queryKey: ['article-v', 'rules'], queryFn: articleV.rules });
  const mine = useQuery({
    queryKey: ['article-v', 'my-proceedings'],
    queryFn: articleV.myProceedings,
    enabled: isAuthenticated,
  });
  const delegations = useQuery({
    queryKey: ['article-v', 'my-delegations'],
    queryFn: articleV.myDelegations,
    enabled: isAuthenticated,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['article-v'] });
  };

  const voting = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => articleV.vote(id, days),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not record that vote.'),
  });

  const withdrawing = useMutation({
    mutationFn: (id: string) => articleV.withdraw(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not take that vote back.'),
  });

  const proceedings = mine.data?.proceedings ?? [];
  const open = proceedings.filter((item) => item.status === 'open');
  const closed = proceedings.filter((item) => item.status !== 'open');

  const openLeaderIds = new Set(open.map((item) => item.leader.id));
  const impeachable = (delegations.data?.delegations ?? []).filter(
    (delegation) => delegation.isActive && !openLeaderIds.has(delegation.toUser.id)
  );

  const minLength = rules.data?.minArticleLength ?? 40;
  const maxLength = rules.data?.maxArticleLength ?? 5000;

  if (!isAuthenticated) {
    return (
      <Nothing title="Impeachment belongs to the people who lent the power">
        <Text className="text-sm leading-6 text-slate-400">
          Only somebody currently delegating their vote to a person can move to take it back, and
          only the people who were delegating when proceedings opened can vote on it. Sign in to
          take part.
        </Text>
      </Nothing>
    );
  }

  return (
    <View testID="impeachment-tab">
      {error ? (
        <Text className="mb-3 rounded-xl border border-red-700/50 bg-red-900/25 p-3 text-sm text-red-200">
          {error}
        </Text>
      ) : null}

      <Panel>
        <Text className="font-semibold text-white">What impeachment does</Text>
        <Text className="mt-1 text-sm leading-6 text-slate-400">
          It suspends one person from receiving delegated votes, and nothing else. Their account
          stays open, they keep their followers, they can still post and comment and share, and
          they keep their own vote — including delegating it to somebody else. Power here is
          borrowed; this calls in the loan.
        </Text>
        {rules.data ? (
          <Text className="mt-2 text-sm text-slate-500">
            {Math.round(rules.data.threshold * 100)}% of the people delegating to them when
            proceedings opened, within {rules.data.windowDays} days.
          </Text>
        ) : null}
      </Panel>

      {mine.isLoading ? <ActivityIndicator className="py-6" color="#94A3B8" /> : null}

      {!mine.isLoading && open.length === 0 ? (
        <Nothing title="No proceedings are open that you can vote in">
          <Text className="text-sm leading-6 text-slate-400">
            You are shown a vote here when somebody files Articles of Impeachment against a person
            you were delegating to at that moment. Nobody who delegates after a filing gets a vote
            — that is what stops a proceeding being swung by whoever turns up once it starts.
          </Text>
        </Nothing>
      ) : null}

      {open.map((proceeding) => (
        <ProceedingCard
          key={proceeding.id}
          proceeding={proceeding}
          busy={voting.isPending || withdrawing.isPending}
          onVote={(id, days) => voting.mutate({ id, days })}
          onWithdraw={(id) => withdrawing.mutate(id)}
        />
      ))}

      <Text className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Bring proceedings
      </Text>

      {impeachable.length === 0 ? (
        <Nothing title="You are not delegating to anybody">
          <Text className="text-sm leading-6 text-slate-400">
            Impeachment recalls borrowed power, so it belongs to the people who lent it. Delegate
            your vote to somebody and you can also take it back — instantly and alone at any time,
            or through Article V when you think everybody who lent to them should decide together.
          </Text>
        </Nothing>
      ) : (
        impeachable.map((delegation) => (
          <FileAgainstDelegate
            key={delegation.id}
            delegation={delegation}
            minLength={minLength}
            maxLength={maxLength}
            onFiled={refresh}
          />
        ))
      )}

      {closed.length > 0 ? (
        <>
          <Text className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Decided
          </Text>
          {closed.map((proceeding) => (
            <ProceedingCard
              key={proceeding.id}
              proceeding={proceeding}
              busy={false}
              onVote={() => undefined}
              onWithdraw={() => undefined}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// System-Wide Reset
// ---------------------------------------------------------------------------

/** Full disclosure, shown before any reset vote can be cast. */
function Disclosure({ disclosure }: { disclosure: SystemResetState['disclosure'] }) {
  return (
    <Panel tone="danger">
      <View testID="reset-disclosure">
        <Text className="font-semibold text-red-100">What a reset does</Text>

        <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-red-300">
          What everybody loses
        </Text>
        {disclosure.lost.map((line) => (
          <Text key={line} className="mt-1 text-sm leading-6 text-red-100">
            • {line}
          </Text>
        ))}

        <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-300">
          What you keep
        </Text>
        {disclosure.kept.map((line) => (
          <Text key={line} className="mt-1 text-sm leading-6 text-slate-200">
            • {line}
          </Text>
        ))}

        <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Afterwards
        </Text>
        {disclosure.afterwards.map((line) => (
          <Text key={line} className="mt-1 text-sm leading-6 text-slate-300">
            • {line}
          </Text>
        ))}
      </View>
    </Panel>
  );
}

function ResetTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);

  const state = useQuery({ queryKey: ['article-v', 'reset'], queryFn: articleV.reset });
  const restorable = useQuery({
    queryKey: ['article-v', 'restorable'],
    queryFn: articleV.restorable,
    enabled: isAuthenticated,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['article-v'] });
  };

  const balloting = useMutation({
    mutationFn: ({ id, support }: { id: string; support: boolean }) =>
      articleV.voteReset(id, support),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not record that vote.'),
  });

  const opening = useMutation({
    mutationFn: ({ grounds, evidence }: { grounds: string; evidence: string }) =>
      articleV.fileReset(grounds, evidence),
    onSuccess: () => {
      setFiling(false);
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not file.'),
  });

  const restoring = useMutation({
    mutationFn: () => articleV.restoreMine(),
    onSuccess: () => refresh(),
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Could not restore your positions.'),
  });

  if (state.isLoading) return <ActivityIndicator className="py-6" color="#94A3B8" />;

  if (!state.data) {
    return (
      <Nothing title="Could not reach the platform">
        <Text className="text-sm leading-6 text-slate-400">
          Article V could not be loaded. This is a connection problem, not an empty result.
        </Text>
      </Nothing>
    );
  }

  const proceeding = state.data.proceeding;
  const rules = state.data.rules;

  return (
    <View testID="reset-tab">
      {error ? (
        <Text className="mb-3 rounded-xl border border-red-700/50 bg-red-900/25 p-3 text-sm text-red-200">
          {error}
        </Text>
      ) : null}

      {/* DISCLOSURE FIRST, ALWAYS. Before the numbers, before the buttons. */}
      <Disclosure disclosure={state.data.disclosure} />

      {proceeding ? (
        <Panel tone="danger">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-lg font-semibold text-white">System-Wide Reset</Text>
              <Text className="text-sm text-slate-400">
                {proceeding.eligibleCount} accounts may vote
              </Text>
            </View>
            <View className="rounded-full bg-red-500/20 px-2 py-0.5">
              <Text className="text-xs font-medium text-red-300">
                {proceeding.status === 'voting'
                  ? `${daysLeft(proceeding.expiresAt)} days left`
                  : proceeding.status === 'scheduled'
                    ? `Runs in ${hoursLeft(proceeding.executeAfter ?? proceeding.expiresAt)}h`
                    : proceeding.status}
              </Text>
            </View>
          </View>

          <Articles
            kind="reset"
            filedBy={proceeding.filedBy}
            openedAt={proceeding.openedAt}
            grounds={proceeding.grounds}
            evidence={proceeding.evidence}
          />

          <View className="mt-4 flex-row border-y border-slate-700/50 py-3">
            <View className="flex-1 items-center">
              <Text className="text-xs text-slate-400">For</Text>
              <Text className="font-semibold text-red-300">{proceeding.support}</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-xs text-slate-400">Against</Text>
              <Text className="font-semibold text-emerald-300">{proceeding.oppose}</Text>
            </View>
            <View className="flex-1 items-center">
              <Text className="text-xs text-slate-400">Eligible</Text>
              <Text className="font-semibold text-white">{proceeding.eligibleCount}</Text>
            </View>
          </View>

          <View className="mt-3">
            <View className="flex-row justify-between">
              <Text className="text-xs text-slate-400">
                Turnout — {Math.round(rules.participationFloor * 100)}% needed
              </Text>
              <Text className="text-xs font-medium text-slate-300">
                {Math.round(proceeding.participation * 100)}%
              </Text>
            </View>
            <View className="mt-1">
              <Bar
                value={proceeding.turnout}
                max={Math.max(1, Math.ceil(proceeding.eligibleCount * rules.participationFloor))}
                tone="amber"
              />
            </View>
            <View className="mt-3 flex-row justify-between">
              <Text className="text-xs text-slate-400">
                Approval — {Math.round(rules.approvalThreshold * 100)}% of those who voted
              </Text>
              <Text className="text-xs font-medium text-slate-300">
                {proceeding.turnout > 0
                  ? `${Math.round(proceeding.approval * 100)}%`
                  : 'no votes yet'}
              </Text>
            </View>
            <View className="mt-1">
              <Bar
                value={proceeding.support}
                max={Math.max(1, Math.ceil(proceeding.turnout * rules.approvalThreshold))}
                tone="red"
              />
            </View>
          </View>

          {proceeding.status === 'scheduled' ? (
            <Text className="mt-4 rounded-xl border border-red-700/50 bg-red-950/50 p-3 text-sm leading-6 text-red-100">
              The vote passed. Everything above happens in{' '}
              {hoursLeft(proceeding.executeAfter ?? proceeding.expiresAt)} hours. Nothing has
              changed yet — the delay exists so nobody loses their delegations to a vote that
              closed while they slept.
            </Text>
          ) : null}

          {proceeding.status === 'voting' ? (
            proceeding.viewerHasVoted ? (
              <Text className="mt-4 rounded-xl bg-slate-700/40 p-3 text-sm text-slate-200">
                You voted {proceeding.viewerSupported ? 'for' : 'against'} the reset.
              </Text>
            ) : (
              <View className="mt-4 flex-row">
                <Pressable
                  testID="reset-vote-for"
                  disabled={balloting.isPending}
                  onPress={() => balloting.mutate({ id: proceeding.id, support: true })}
                  className="flex-1 items-center rounded-xl bg-red-600/80 py-3"
                >
                  <Text className="font-semibold text-white">Vote for the reset</Text>
                </Pressable>
                <Pressable
                  testID="reset-vote-against"
                  disabled={balloting.isPending}
                  onPress={() => balloting.mutate({ id: proceeding.id, support: false })}
                  className="ml-2 flex-1 items-center rounded-xl border border-slate-600 py-3"
                >
                  <Text className="font-semibold text-slate-200">Vote against</Text>
                </Pressable>
              </View>
            )
          ) : null}
        </Panel>
      ) : (
        <Nothing title="No System-Wide Reset is before the platform">
          <Text className="text-sm leading-6 text-slate-400">
            Any verified account can bring one, and only one can stand at a time. It runs for{' '}
            {rules.windowDays} days, every account is notified, and it passes only if more than{' '}
            {Math.round(rules.participationFloor * 100)}% of the platform votes and at least{' '}
            {Math.round(rules.approvalThreshold * 100)}% of those votes are in favour. If it
            passes, it runs {rules.disclosureHours} hours later — not immediately.
          </Text>
        </Nothing>
      )}

      {restorable.data?.reset && restorable.data.available > 0 ? (
        <Panel>
          <Text className="font-semibold text-white">Put your own positions back</Text>
          <Text className="mt-1 text-sm leading-6 text-slate-400">
            The last reset cleared {restorable.data.available} position
            {restorable.data.available === 1 ? '' : 's'} you had taken yourself. Only what you cast
            personally — nothing a delegate cast in your name, because that was never stored as
            yours.
          </Text>
          <Pressable
            testID="restore-my-positions"
            disabled={restoring.isPending}
            onPress={() => restoring.mutate()}
            className="mt-3 items-center rounded-xl bg-slate-700 py-3"
          >
            <Text className="font-medium text-white">
              {restoring.isPending ? 'Restoring…' : 'Restore my positions'}
            </Text>
          </Pressable>
        </Panel>
      ) : null}

      {!proceeding && isAuthenticated ? (
        <Panel>
          {!filing ? (
            <Pressable
              testID="open-reset-form"
              onPress={() => setFiling(true)}
              className="items-center rounded-xl border border-red-700/50 py-3"
            >
              <Text className="text-sm font-medium text-red-300">
                File Articles of System Reset
              </Text>
            </Pressable>
          ) : (
            <ArticlesForm
              minLength={rules.minArticleLength}
              maxLength={rules.maxArticleLength}
              submitLabel="File Articles of System Reset"
              busy={opening.isPending}
              error={null}
              onSubmit={(grounds, evidence) => opening.mutate({ grounds, evidence })}
              onCancel={() => setFiling(false)}
            />
          )}
        </Panel>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function ArticleVScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'impeachment' | 'reset'>('impeachment');

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View className="flex-row items-center justify-between px-4 py-3">
        <Pressable onPress={() => router.back()} className="p-1">
          <ChevronLeft size={24} color="#94A3B8" />
        </Pressable>
        <View className="items-center">
          <Text className="font-bold text-white">Article V</Text>
          <Text className="text-xs text-slate-400">Self-Correction</Text>
        </View>
        <Pressable onPress={() => router.push('/constitution')} className="p-1">
          <BookOpen size={22} color="#94A3B8" />
        </Pressable>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingBottom: 48 }}>
        <Animated.View entering={FadeInDown.duration(300)}>
          <LinearGradient
            colors={['#7F1D1D', '#450A0A']}
            className="mb-6 overflow-hidden rounded-2xl p-5"
          >
            <View className="mb-3 flex-row items-center">
              <View className="mr-3 h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
                <RotateCcw size={24} color="#FCA5A5" />
              </View>
              <View className="flex-1">
                <Text className="text-xl font-bold text-red-100">Self-Correction</Text>
                <Text className="text-sm text-red-300">Constitutional Article V</Text>
              </View>
            </View>
            <Text className="italic leading-6 text-red-200">
              "The community retains the right to Impeach or demote any leader who misrepresents
              facts or violates the Code of Conduct, and may trigger a System-Wide Reset via
              super-majority vote."
            </Text>
          </LinearGradient>
        </Animated.View>

        <View className="mb-6 flex-row">
          <Pressable
            testID="tab-impeachment"
            onPress={() => setTab('impeachment')}
            className={cn(
              'flex-1 flex-row items-center justify-center rounded-l-xl border py-3',
              tab === 'impeachment'
                ? 'border-amber-500/50 bg-amber-500/20'
                : 'border-slate-700/50 bg-slate-800/40'
            )}
          >
            <Users size={16} color={tab === 'impeachment' ? '#FCD34D' : '#94A3B8'} />
            <Text
              className={cn(
                'ml-2',
                tab === 'impeachment' ? 'text-amber-200' : 'text-slate-400'
              )}
            >
              Impeachment
            </Text>
          </Pressable>
          <Pressable
            testID="tab-reset"
            onPress={() => setTab('reset')}
            className={cn(
              'flex-1 flex-row items-center justify-center rounded-r-xl border border-l-0 py-3',
              tab === 'reset'
                ? 'border-red-500/50 bg-red-500/20'
                : 'border-slate-700/50 bg-slate-800/40'
            )}
          >
            <AlertTriangle size={16} color={tab === 'reset' ? '#FCA5A5' : '#94A3B8'} />
            <Text className={cn('ml-2', tab === 'reset' ? 'text-red-200' : 'text-slate-400')}>
              System Reset
            </Text>
          </Pressable>
        </View>

        {tab === 'impeachment' ? <ImpeachmentTab /> : <ResetTab />}

        <View className="mt-8 flex-row items-start">
          <FileText size={16} color="#64748B" />
          <Text className="ml-2 flex-1 text-xs leading-5 text-slate-500">
            Both filings are formal documents. They go to the platform's administrators, and the
            person named in Articles of Impeachment is sent a copy. Nobody — no administrator, no
            owner, not the person accused — can stop a proceeding once it has started. A filing
            made in bad faith is grounds for suspending or banning whoever made it, and the
            proceeding still runs.
          </Text>
        </View>

        <Text className="mt-3 text-xs text-slate-600">
          Every number on this screen is counted from real proceedings. Nothing here is a sample.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
