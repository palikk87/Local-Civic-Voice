import React, { useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Scale,
  Users,
  FileEdit,
  ChevronRight,
  Zap,
  Award,
} from 'lucide-react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { DailyDigestBill } from '@/lib/hooks';
import {
  useTrendingReferences,
  useLatestReferences,
  referenceToBill,
} from '@/lib/api/references';
import { categoryColors, categoryLabels } from '@/lib/mock-data';
import {
  calculateVoiceWeight,
  getWeightTier,
  getWeightTierColor,
  getWeightTierLabel,
  getStatusLabel,
  type WeightTier,
} from '@/lib/voice-weight';
import type { Bill, BillCategory } from '@/lib/types';
import type { BillStatus } from '@/lib/database.types';
import type { ReferenceType } from '@/lib/api/references';
import { cn } from '@/lib/cn';

// Map app bill status to database status
function mapStatusToDbStatus(status: Bill['status']): BillStatus {
  if (status === 'signed_into_law') return 'enacted';
  return status as BillStatus;
}

/** Where this record lives, so a card can route to it and say which branch it is. */
type DigestRow = DailyDigestBill & { weightTier: WeightTier; referenceType: ReferenceType };

const BRANCH_OF: Record<ReferenceType, { label: string; color: string; route: string }> = {
  bill: { label: 'Congress', color: '#3B82F6', route: 'bill' },
  executive_order: { label: 'Executive', color: '#F59E0B', route: 'executive-order' },
  scotus_case: { label: 'Supreme Court', color: '#8B5CF6', route: 'scotus' },
};

// Convert a reference-shaped bill into a digest row with its calculated weight.
function convertToDigestBill(bill: Bill, referenceType: ReferenceType): DigestRow {
  // COSPONSORS AND AMENDMENTS ARE GONE, AND NOT REPLACED.
  //
  // They were invented twice over: a lookup table that guessed a count from the
  // bill's status ("for demo"), plus Math.random() on top of that, evaluated on
  // every render. So the numbers changed while somebody watched — 45 to 64
  // cosponsors in about a minute, and one of them went down — and they fed
  // calculateVoiceWeight(), which is the figure this platform uses to tell a
  // citizen how much their vote counts. A fabricated decoration is bad; a
  // fabricated input to a civic weighting is a different thing entirely.
  //
  // GovernmentReference has no cosponsor or amendment column, so there is no
  // real source to rewire to. Both counts are removed from the card rather than
  // shown as zero, because zero asserts that a bill has no cosponsors, and what
  // is true is that we do not know.
  //
  // Voice weight now comes from status alone, which is a real column. The
  // multipliers for the other two default to 0 in calculateVoiceWeight().
  const weightResult = calculateVoiceWeight({
    status: mapStatusToDbStatus(bill.status),
  });

  const dbStatus = mapStatusToDbStatus(bill.status);

  return {
    id: bill.id,
    congress_number: 119, // Default to current congress
    bill_number: bill.congressNumber || null,
    title: bill.title,
    short_title: bill.shortTitle,
    status: dbStatus,
    chamber: bill.chamber,
    sponsor_id: bill.sponsor?.id || null,
    // Null rather than a stand-in. Both used to be the moment our row was
    // written, which made every record look like it dated from the sync.
    introduced_date: bill.introducedDate ?? null,
    last_action_date: bill.lastActionDate ?? null,
    category: bill.category,
    full_text: bill.fullText,
    simplified_text: bill.simplifiedText,
    real_world_impact: bill.realWorldImpact,
    // Nothing projects an outcome any more. See packages/civic-core/src/types.ts:
    // it was our own readers' votes relabelled as a forecast of Congress.
    projected_outcome: 'uncertain',
    yea_count: bill.communityVotes.yea,
    nay_count: bill.communityVotes.nay,
    total_votes: bill.communityVotes.totalVoters,
    official_yea: bill.officialVotes?.yea || null,
    official_nay: bill.officialVotes?.nay || null,
    official_present: bill.officialVotes?.abstain || null,
    official_not_voting: bill.officialVotes?.notVoting || null,
    is_trending: true,
    view_count: 0,
    weight_score: weightResult.weightScore,
    weight_last_calculated: new Date().toISOString(),
    created_at: bill.introducedDate ?? null,
    updated_at: bill.lastActionDate ?? null,
    weightTier: getWeightTier(weightResult.weightScore),
    referenceType,
  };
}

interface WeightBadgeProps {
  weightScore: number;
  size?: 'sm' | 'md';
}

function WeightBadge({ weightScore, size = 'sm' }: WeightBadgeProps) {
  const tier = getWeightTier(weightScore);
  const color = getWeightTierColor(tier);
  const label = getWeightTierLabel(tier);

  return (
    <View
      className={cn(
        'flex-row items-center rounded-full',
        size === 'sm' ? 'px-2 py-0.5' : 'px-3 py-1'
      )}
      style={{ backgroundColor: `${color}20` }}
    >
      <Zap size={size === 'sm' ? 10 : 12} color={color} />
      <Text
        className={cn('font-bold ml-1', size === 'sm' ? 'text-xs' : 'text-sm')}
        style={{ color }}
      >
        {Math.round(weightScore)}
      </Text>
      {size === 'md' && (
        <Text className="text-xs ml-1" style={{ color }}>
          {label}
        </Text>
      )}
    </View>
  );
}

interface DigestCardProps {
  row: DigestRow;
  index: number;
  onPress: () => void;
}

function DigestCard({ row: bill, index, onPress }: DigestCardProps) {
  const categoryColor = categoryColors[bill.category as BillCategory] || '#64748B';
  const tierColor = getWeightTierColor(bill.weightTier);
  const branch = BRANCH_OF[bill.referenceType];

  return (
    <Animated.View entering={FadeInRight.delay(index * 80).springify()}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        className="bg-slate-800/70 rounded-xl p-3 mr-3 border"
        style={{ width: 260, borderColor: `${tierColor}30` }}
      >
        {/* Header with rank and weight */}
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <View
              className="w-6 h-6 rounded-full items-center justify-center mr-2"
              style={{ backgroundColor: `${tierColor}20` }}
            >
              <Text className="text-xs font-bold" style={{ color: tierColor }}>
                {index + 1}
              </Text>
            </View>
            <WeightBadge weightScore={bill.weight_score} />
          </View>
          {/* Which branch this came from. The digest used to ask only for
              bills, so every card was a bill and no card had to say so. */}
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${branch.color}30` }}
          >
            <Text style={{ color: branch.color }} className="text-xs font-medium">
              {branch.label}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text className="text-white font-semibold text-sm mb-2" numberOfLines={2}>
          {bill.short_title}
        </Text>

        {/* Stats Row.
            The cosponsor and amendment counts that used to sit here are gone —
            both were invented, and neither had a label, so they announced two
            bare numbers that even this project's owner could not identify. */}
        <View className="flex-row items-center justify-between">
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${categoryColor}30` }}
          >
            <Text style={{ color: categoryColor }} className="text-xs font-medium">
              {categoryLabels[bill.category as BillCategory]}
            </Text>
          </View>
          <View
            className={cn(
              'px-2 py-0.5 rounded-full',
              bill.status === 'passed_house' || bill.status === 'passed_senate'
                ? 'bg-emerald-900/50'
                : bill.status === 'in_committee'
                ? 'bg-blue-900/50'
                : 'bg-slate-700'
            )}
          >
            <Text
              className={cn(
                'text-xs',
                bill.status === 'passed_house' || bill.status === 'passed_senate'
                  ? 'text-emerald-400'
                  : bill.status === 'in_committee'
                  ? 'text-blue-400'
                  : 'text-slate-400'
              )}
            >
              {getStatusLabel(bill.status)}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

interface DailyDigestProps {
  limit?: number;
  category?: BillCategory;
  showHeader?: boolean;
  title?: string;
}

export function DailyBillDigest({
  limit = 10,
  category,
  showHeader = true,
  title = 'Daily Digest',
}: DailyDigestProps) {
  const router = useRouter();

  // The Supabase digest query used to sit here as a second source. It is gated
  // on isSupabaseConfigured(), which has returned a hardcoded false since the
  // client was removed, so it never ran.

  /*
   * ALL THREE BRANCHES, not just Congress.
   *
   * This asked for 'bill' and was called "Daily Bill Digest", so the one ranked
   * list on the home tab silently excluded every executive order and every
   * Supreme Court case the platform holds — the same shape of bug the Library
   * had. The reference type is now omitted, which the list and trending routes
   * both read as "all", and each card says which branch it came from.
   *
   * Same source and query cache the Discover tab uses, so whatever Discover
   * pulls each day shows up here automatically.
   */
  const { data: latestRefs, isLoading: latestLoading } = useLatestReferences(undefined, 30);
  const { data: trendingRefs, isLoading: trendingLoading } = useTrendingReferences(undefined, 10);
  const isLoading = latestLoading || trendingLoading;

  const digestRows = useMemo(() => {
    const seen = new Set<string>();
    const rows = [...(latestRefs?.references ?? []), ...(trendingRefs?.references ?? [])]
      .filter((ref) => {
        if (seen.has(ref.id)) return false;
        seen.add(ref.id);
        return true;
      })
      .map((ref) => convertToDigestBill(referenceToBill(ref), ref.referenceType));

    // Nothing from the API means nothing to show. A hardcoded array used to
    // stand in here, so an unreachable backend produced a full digest of
    // invented bills.
    return rows
      .filter((row) => !category || row.category === category)
      .sort((a, b) => b.weight_score - a.weight_score)
      .slice(0, limit);
  }, [latestRefs, trendingRefs, category, limit]);

  if (digestRows.length === 0 && isLoading) {
    return (
      <View className="px-4 py-6">
        <ActivityIndicator size="small" color="#F59E0B" />
      </View>
    );
  }

  if (digestRows.length === 0) {
    return null;
  }

  return (
    <View className="mb-4">
      {showHeader && (
        <View className="px-4 mb-3">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="bg-amber-500/20 p-1.5 rounded-full mr-2">
                <Scale size={16} color="#F59E0B" />
              </View>
              <View>
                <Text className="text-white font-semibold text-lg">{title}</Text>
                <Text className="text-slate-400 text-xs">
                  Sorted by Voice Weight score
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push('/(tabs)/discover');
              }}
              className="flex-row items-center"
            >
              <Text className="text-amber-500 text-sm font-medium mr-1">See all</Text>
              <ChevronRight size={16} color="#F59E0B" />
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16 }}
        style={{ flexGrow: 0 }}
      >
        {digestRows.map((row, index) => (
          <DigestCard
            key={row.id}
            row={row}
            index={index}
            onPress={() => router.push(`/${BRANCH_OF[row.referenceType].route}/${row.id}`)}
          />
        ))}
      </ScrollView>

      {/* Weight Legend */}
      <View className="flex-row items-center justify-center mt-3 px-4">
        <Text className="text-slate-500 text-xs mr-2">Weight:</Text>
        {(['critical', 'high', 'medium', 'low'] as WeightTier[]).map((tier) => (
          <View key={tier} className="flex-row items-center mr-3">
            <View
              className="w-2 h-2 rounded-full mr-1"
              style={{ backgroundColor: getWeightTierColor(tier) }}
            />
            <Text className="text-slate-500 text-xs">{getWeightTierLabel(tier)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Compact version for smaller spaces
export function CompactDailyDigest({ limit = 5 }: { limit?: number }) {
  const router = useRouter();
  // Same live daily-synced source as Discover. The loading flag used to come
  // from a Supabase digest query gated on isSupabaseConfigured(), which has
  // returned a hardcoded false since the client was removed — so the spinner
  // was driven by a request that never ran.
  const { data: latestRefs, isLoading } = useLatestReferences(undefined, 30);

  const digestRows = useMemo(
    () =>
      (latestRefs?.references ?? [])
        .map((ref) => convertToDigestBill(referenceToBill(ref), ref.referenceType))
        .sort((a, b) => b.weight_score - a.weight_score)
        .slice(0, limit),
    [latestRefs, limit],
  );

  if (digestRows.length === 0 && isLoading) {
    return (
      <View className="py-2">
        <ActivityIndicator size="small" color="#F59E0B" />
      </View>
    );
  }

  return (
    <View className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
      <View className="flex-row items-center mb-2">
        <Award size={14} color="#F59E0B" />
        <Text className="text-white font-medium text-sm ml-1.5">Top Weighted Records</Text>
      </View>
      {digestRows.slice(0, 3).map((bill, index) => (
        <Pressable
          key={bill.id}
          onPress={() => router.push(`/${BRANCH_OF[bill.referenceType].route}/${bill.id}`)}
          className="flex-row items-center py-2 border-b border-slate-700/30 last:border-b-0"
        >
          <View
            className="w-5 h-5 rounded-full items-center justify-center mr-2"
            style={{ backgroundColor: `${getWeightTierColor(bill.weightTier)}20` }}
          >
            <Text
              className="text-xs font-bold"
              style={{ color: getWeightTierColor(bill.weightTier) }}
            >
              {index + 1}
            </Text>
          </View>
          <Text className="text-slate-200 text-sm flex-1" numberOfLines={1}>
            {bill.short_title}
          </Text>
          <WeightBadge weightScore={bill.weight_score} size="sm" />
        </Pressable>
      ))}
    </View>
  );
}

export default DailyBillDigest;
