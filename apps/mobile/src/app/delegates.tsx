// Delegates directory — EARNED eligibility only. The list comes from
// GET /api/delegations/delegates (computed server-side from routine activity),
// delegating/revoking goes through /api/delegations, and delegated votes are
// counted into every reference tally. Web twin: webapp/src/pages/Delegates.tsx
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Users,
  Shield,
  ShieldCheck,
  TrendingUp,
  Sparkles,
  XCircle,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { categoryLabels, categoryColors } from '@/lib/mock-data';
import { cn } from '@/lib/cn';
import { DelegationRightIndicator, ArticleBadge } from '@/components/BillOfRightsBadge';
import { AuthGate } from '@/components/auth/AuthGate';

interface DelegateListing {
  id: string;
  name: string;
  username: string;
  image: string | null;
  bio: string | null;
  delegatorCount: number;
  totalVotes: number;
  totalPosts: number;
  followerCount: number;
  topCategories: string[];
  memberSince: string;
  /**
   * How often this person has agreed with the reader, on the records where
   * both actually voted. Null when signed out; agreementPct is null below
   * three shared records, because a percentage from one is noise.
   */
  alignment: {
    shared: number;
    agreed: number;
    disagreed: number;
    agreementPct: number | null;
  } | null;
}

interface DelegatesResponse {
  delegates: DelegateListing[];
  requirements: {
    MIN_ACCOUNT_AGE_DAYS: number;
    MIN_VOTES: number;
    MIN_POSTS: number;
    ACTIVE_WITHIN_DAYS: number;
  };
}

interface ChainLink {
  id: string;
  name: string;
  username: string | null;
}

interface MyDelegation {
  id: string;
  toUser: { id: string; name: string; username: string | null; image: string | null };
  category: string | null;
  isActive: boolean;
  /**
   * Anyone your voice passes to after the person you picked.
   *
   * Usually empty. It fills in when your delegate has lent their own voice
   * onward, which means somebody you never chose ends up speaking for you.
   * Bill of Rights I calls for transparent delegation chains; this is it.
   */
  chain: ChainLink[];
}

interface EligibilityRequirement {
  key: string;
  label: string;
  required: number;
  current: number;
  met: boolean;
}

function avatarOf(d: { id: string; image: string | null }): string {
  return d.image ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${d.id}`;
}

function DelegateCard({
  delegate,
  index,
  isDelegatedTo,
  chain,
  onPress,
}: {
  delegate: DelegateListing;
  index: number;
  isDelegatedTo: boolean;
  chain: ChainLink[];
  onPress: () => void;
}) {
  const router = useRouter();

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).springify()} className="mx-4 mb-3">
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className={cn(
          'bg-slate-800/80 rounded-2xl p-4 border',
          isDelegatedTo ? 'border-amber-500/50' : 'border-slate-700/50'
        )}
      >
        <View className="flex-row items-start">
          <Pressable onPress={() => router.push(`/user/${delegate.id}`)}>
            <Image source={{ uri: avatarOf(delegate) }} className="w-14 h-14 rounded-full" />
          </Pressable>
          <View className="flex-1 ml-3">
            <View className="flex-row items-center flex-wrap">
              <Text className="text-white font-semibold text-lg mr-2">{delegate.name}</Text>
              <View className="bg-emerald-500/20 px-2 py-0.5 rounded-full flex-row items-center">
                <ShieldCheck size={10} color="#22C55E" />
                <Text className="text-emerald-400 text-xs font-medium ml-1">Earned</Text>
              </View>
              {isDelegatedTo && (
                <View className="ml-1.5 bg-amber-500/20 px-2 py-0.5 rounded-full">
                  <Text className="text-amber-500 text-xs font-medium">Your Delegate</Text>
                </View>
              )}
            </View>
            <Text className="text-slate-400 text-sm">@{delegate.username}</Text>

            {/* Expertise tags from their real voting record */}
            {delegate.topCategories.length > 0 && (
              <View className="flex-row flex-wrap mt-2">
                {delegate.topCategories.map((cat) => (
                  <View
                    key={cat}
                    className="mr-1.5 mb-1 px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: `${categoryColors[cat] ?? '#64748B'}30` }}
                  >
                    <Text
                      style={{ color: categoryColors[cat] ?? '#94A3B8' }}
                      className="text-xs font-medium capitalize"
                    >
                      {categoryLabels[cat] ?? cat.replace(/_/g, ' ')}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {delegate.bio ? (
          <Text className="text-slate-300 text-sm mt-3 leading-5" numberOfLines={2}>
            {delegate.bio}
          </Text>
        ) : null}

        {/* Where the reader and this person have actually landed, before they
            hand over a vote. Above the vanity counts on purpose: a follower
            number says nothing about whether somebody would have voted the way
            you did. */}
        {delegate.alignment && delegate.alignment.shared > 0 ? (
          <View className="mt-3 rounded-lg bg-slate-900/40 border border-slate-700/40 p-2.5">
            <Text className="text-slate-300 text-xs leading-5">
              {delegate.alignment.agreementPct === null
                ? `You have both voted on ${delegate.alignment.shared} record${
                    delegate.alignment.shared === 1 ? '' : 's'
                  } — too few to say much yet.`
                : `Agreed with you on ${delegate.alignment.agreed} of ${delegate.alignment.shared} records you both voted on (${delegate.alignment.agreementPct}%).`}
            </Text>
          </View>
        ) : null}

        {/* Stats */}
        <View className="flex-row mt-3 pt-3 border-t border-slate-700/50">
          <View className="flex-1 flex-row items-center">
            <Users size={14} color="#64748B" />
            <Text className="text-slate-400 text-sm ml-1.5">
              {delegate.delegatorCount.toLocaleString()} delegators
            </Text>
          </View>
          <View className="flex-row items-center">
            <TrendingUp size={14} color="#22C55E" />
            <Text className="text-emerald-500 text-sm ml-1.5">
              {delegate.totalVotes} votes cast
            </Text>
          </View>
        </View>

        {isDelegatedTo && chain.length > 0 ? (
          <View className="mt-3 rounded-xl border border-amber-700/40 bg-amber-900/20 p-3">
            <Text className="text-amber-100 text-xs leading-5">
              {delegate.name.split(' ')[0]} has passed their vote on, so your voice currently
              reaches{' '}
              <Text className="font-semibold">{chain[chain.length - 1]!.name}</Text>
              {chain.length > 1
                ? ` (via ${chain
                    .slice(0, -1)
                    .map((link) => link.name)
                    .join(', ')})`
                : ''}
              . Revoke any time.
            </Text>
          </View>
        ) : null}

        <View
          className={cn(
            'mt-3 rounded-xl py-2.5 items-center',
            isDelegatedTo ? 'bg-slate-700/60' : 'bg-amber-500/90'
          )}
        >
          <Text className={cn('font-semibold', isDelegatedTo ? 'text-slate-300' : 'text-slate-900')}>
            {isDelegatedTo ? 'Tap to revoke delegation' : `Delegate to ${delegate.name.split(' ')[0]}`}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function DelegatesScreen() {
  return (
    <AuthGate capability="viewDelegates" reason="Sign in to manage who you delegate your vote to.">
      <DelegatesContent />
    </AuthGate>
  );
}

function DelegatesContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['delegates-directory'],
    queryFn: () => api.get<DelegatesResponse>('/api/delegations/delegates'),
  });

  const { data: mine } = useQuery({
    queryKey: ['my-delegations'],
    queryFn: () => api.get<{ delegations: MyDelegation[] }>('/api/delegations/me'),
  });

  const { data: eligibility } = useQuery({
    queryKey: ['my-delegate-eligibility'],
    queryFn: () =>
      api.get<{ eligible: boolean; requirements: EligibilityRequirement[] }>(
        '/api/delegations/eligibility'
      ),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['my-delegations'] });
    queryClient.invalidateQueries({ queryKey: ['delegates-directory'] });
  };

  const delegateMutation = useMutation({
    mutationFn: (toUserId: string) =>
      api.post<{ delegation: MyDelegation }>('/api/delegations', { toUserId }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  const revokeMutation = useMutation({
    mutationFn: (delegationId: string) =>
      api.delete<{ success: boolean }>(`/api/delegations/${delegationId}`),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    },
  });

  // Memoised because handleSelectDelegate and renderItem depend on them. Rebuilt
  // inline, they were new objects on every render, so those useCallbacks were
  // never actually stable and every FlatList row re-rendered on any state change.
  const activeDelegations = useMemo(
    () => (mine?.delegations ?? []).filter((d) => d.isActive),
    [mine?.delegations]
  );
  const delegationsByUser = useMemo(
    () => new Map(activeDelegations.map((d) => [d.toUser.id, d])),
    [activeDelegations]
  );
  const activeDelegationsCount = activeDelegations.length;
  const requirements = data?.requirements;

  const query = searchQuery.trim().toLowerCase();
  const filteredDelegates = (data?.delegates ?? []).filter(
    (d) =>
      !query ||
      d.name.toLowerCase().includes(query) ||
      d.username.toLowerCase().includes(query) ||
      d.topCategories.some((c) => c.toLowerCase().includes(query))
  );

  // Destructured: a useMutation result is a new object every render, so passing
  // the mutation objects themselves as dependencies made this callback unstable.
  // The .mutate functions are stable.
  const { mutate: delegate } = delegateMutation;
  const { mutate: revoke } = revokeMutation;

  const handleSelectDelegate = useCallback(
    (delegateListing: DelegateListing) => {
      const existing = delegationsByUser.get(delegateListing.id);
      if (existing) {
        revoke(existing.id);
      } else {
        delegate(delegateListing.id);
      }
    },
    [delegationsByUser, delegate, revoke]
  );

  const handleRevokeAll = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await Promise.all(
      activeDelegations.map((d) =>
        api.delete<{ success: boolean }>(`/api/delegations/${d.id}`).catch(() => null)
      )
    );
    invalidate();
    setShowRevokeConfirm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDelegations]);

  const renderItem = useCallback(
    ({ item, index }: { item: DelegateListing; index: number }) => (
      <DelegateCard
        delegate={item}
        index={index}
        isDelegatedTo={delegationsByUser.has(item.id)}
        chain={delegationsByUser.get(item.id)?.chain ?? []}
        onPress={() => handleSelectDelegate(item)}
      />
    ),
    [handleSelectDelegate, delegationsByUser]
  );

  const keyExtractor = useCallback((item: DelegateListing) => item.id, []);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0F172A', '#1E293B', '#0F172A']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="px-4 py-3 border-b border-slate-800">
            <View className="flex-row items-center">
              <Pressable
                onPress={() => router.back()}
                className="bg-slate-800 p-2 rounded-full mr-3"
              >
                <ArrowLeft size={20} color="#fff" />
              </Pressable>
              <View className="flex-1">
                <Text className="text-xl font-bold text-white">Find Delegates</Text>
                <Text className="text-slate-400 text-sm">
                  Liquid Democracy • Eligibility is earned
                </Text>
              </View>
            </View>
          </View>

          <FlatList
            data={filteredDelegates}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={{ paddingBottom: 20 }}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <>
                {/* Info Banner */}
                <View className="mx-4 mt-4 mb-2 p-4 bg-amber-900/20 rounded-xl border border-amber-700/30">
                  <View className="flex-row items-start">
                    <Sparkles size={20} color="#F59E0B" />
                    <View className="flex-1 ml-3">
                      <View className="flex-row items-center justify-between mb-1">
                        <Text className="text-amber-400 font-semibold">
                          What is Liquid Democracy?
                        </Text>
                        <ArticleBadge articleNumber="I" size="sm" />
                      </View>
                      <Text className="text-slate-300 text-sm leading-5">
                        Delegate your vote to trusted, routinely active citizens. Their vote
                        carries yours on every tally. You can revoke anytime.
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Article I Rights Indicator */}
                <View className="mx-4 mb-4">
                  <DelegationRightIndicator canRevoke={true} />
                </View>

                {/* Own eligibility progress */}
                {eligibility ? (
                  <View className="mx-4 mb-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700/50">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-white font-medium flex-1">
                        {eligibility.eligible
                          ? 'You are an eligible delegate'
                          : 'Your progress toward eligibility'}
                      </Text>
                      {eligibility.eligible && (
                        <View className="bg-emerald-500/20 px-2 py-0.5 rounded-full flex-row items-center">
                          <ShieldCheck size={12} color="#22C55E" />
                          <Text className="text-emerald-400 text-xs font-medium ml-1">
                            Eligible
                          </Text>
                        </View>
                      )}
                    </View>
                    {eligibility.requirements.map((req) => (
                      <View key={req.key} className="flex-row items-center py-1">
                        {req.met ? (
                          <CheckCircle size={14} color="#22C55E" />
                        ) : (
                          <XCircle size={14} color="#64748B" />
                        )}
                        <Text
                          className={cn(
                            'text-sm ml-2',
                            req.met ? 'text-slate-300' : 'text-slate-500'
                          )}
                        >
                          {req.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Revoke All Delegations - Article I Right */}
                {activeDelegationsCount > 0 && (
                  <Animated.View entering={FadeIn.duration(300)} className="mx-4 mb-4">
                    {!showRevokeConfirm ? (
                      <Pressable
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          setShowRevokeConfirm(true);
                        }}
                        className="bg-red-900/30 rounded-xl p-4 border border-red-700/40"
                      >
                        <View className="flex-row items-center justify-between">
                          <View className="flex-row items-center flex-1">
                            <View className="w-10 h-10 rounded-full bg-red-500/20 items-center justify-center mr-3">
                              <XCircle size={20} color="#EF4444" />
                            </View>
                            <View className="flex-1">
                              <Text className="text-red-100 font-semibold">
                                Reclaim Your Voice
                              </Text>
                              <Text className="text-red-300/70 text-xs mt-0.5">
                                Revoke all delegations instantly
                              </Text>
                            </View>
                          </View>
                          <ArticleBadge articleNumber="I" size="sm" />
                        </View>
                      </Pressable>
                    ) : (
                      <View className="bg-red-900/40 rounded-xl p-4 border border-red-500/50">
                        <View className="flex-row items-center mb-3">
                          <AlertTriangle size={20} color="#EF4444" />
                          <Text className="text-red-100 font-semibold ml-2">
                            Confirm Revocation
                          </Text>
                        </View>
                        <Text className="text-red-200/80 text-sm mb-4">
                          Per Article I of the Bill of Rights, you have the absolute right to
                          revoke all delegations instantly, without penalty. Your{' '}
                          {activeDelegationsCount} active delegation
                          {activeDelegationsCount !== 1 ? 's' : ''} will be revoked.
                        </Text>
                        <View className="flex-row">
                          <Pressable
                            onPress={() => setShowRevokeConfirm(false)}
                            className="flex-1 bg-slate-700 rounded-lg py-3 mr-2 items-center"
                          >
                            <Text className="text-slate-300 font-medium">Cancel</Text>
                          </Pressable>
                          <Pressable
                            onPress={handleRevokeAll}
                            className="flex-1 bg-red-600 rounded-lg py-3 items-center"
                          >
                            <Text className="text-white font-semibold">Revoke All</Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </Animated.View>
                )}

                {/* Active Delegations */}
                {activeDelegationsCount > 0 && (
                  <View className="mx-4 mb-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/50">
                    <View className="flex-row items-center mb-2">
                      <Shield size={16} color="#22C55E" />
                      <Text className="text-emerald-400 font-medium ml-2">
                        Active Delegations: {activeDelegationsCount}
                      </Text>
                    </View>
                    <Text className="text-slate-400 text-sm">
                      Your vote is being carried by your delegates on every tally
                    </Text>
                  </View>
                )}

                {/* Search */}
                <View className="px-4 mb-4">
                  <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3">
                    <Search size={18} color="#64748B" />
                    <TextInput
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      placeholder="Search delegates by name or expertise..."
                      placeholderTextColor="#64748B"
                      className="flex-1 ml-3 text-white"
                    />
                  </View>
                </View>
              </>
            }
            ListEmptyComponent={
              isLoading ? (
                <ActivityIndicator size="large" color="#F59E0B" className="mt-8" />
              ) : (
                <View className="items-center py-12 px-8">
                  <ShieldCheck size={48} color="#64748B" />
                  <Text className="text-slate-400 text-lg mt-4 text-center">
                    No one has earned delegate eligibility yet
                  </Text>
                  <Text className="text-slate-500 text-sm mt-2 text-center leading-5">
                    Delegates must be routinely active citizens
                    {requirements
                      ? ` — an account at least ${requirements.MIN_ACCOUNT_AGE_DAYS} days old, ${requirements.MIN_VOTES}+ votes, ${requirements.MIN_POSTS}+ posts, and activity within the last ${requirements.ACTIVE_WITHIN_DAYS} days`
                      : ''}
                    . Keep participating and you could be the first.
                  </Text>
                </View>
              )
            }
          />
        </SafeAreaView>
      </View>
    </>
  );
}
