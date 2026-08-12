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
import { useDailyBillDigest, type DailyDigestBill } from '@/lib/hooks';
import {
  useTrendingReferences,
  useLatestReferences,
  referenceToBill,
} from '@/lib/api/references';
import { mockBills, categoryColors, categoryLabels } from '@/lib/mock-data';
import {
  calculateVoiceWeight,
  getWeightTier,
  getWeightTierColor,
  getWeightTierLabel,
  getStatusLabel,
  type WeightTier,
} from '@/lib/voice-weight';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Bill, BillCategory } from '@/lib/types';
import type { BillStatus, ProjectedOutcome } from '@/lib/database.types';
import { cn } from '@/lib/cn';

// Map app bill status to database status
function mapStatusToDbStatus(status: Bill['status']): BillStatus {
  if (status === 'signed_into_law') return 'enacted';
  return status as BillStatus;
}

// Map app projected outcome to database type
function mapOutcomeToDbOutcome(outcome: Bill['projectedOutcome']): ProjectedOutcome {
  if (outcome === 'unlikely_pass') return 'likely_fail';
  return outcome as ProjectedOutcome;
}

// Convert mock bill to digest bill with calculated weight
function convertToDigestBill(bill: Bill): DailyDigestBill & { weightTier: WeightTier } {
  // Generate mock cosponsor/amendment counts based on status for demo
  const statusMultipliers: Record<string, { cosponsor: number; amendment: number }> = {
    introduced: { cosponsor: 5, amendment: 0 },
    in_committee: { cosponsor: 15, amendment: 2 },
    passed_house: { cosponsor: 50, amendment: 8 },
    passed_senate: { cosponsor: 45, amendment: 6 },
    enacted: { cosponsor: 100, amendment: 15 },
    signed_into_law: { cosponsor: 120, amendment: 20 },
  };

  const multiplier = statusMultipliers[bill.status] || statusMultipliers.introduced;
  const cosponsorCount = multiplier.cosponsor + Math.floor(Math.random() * 20);
  const amendmentCount = multiplier.amendment + Math.floor(Math.random() * 5);

  const weightResult = calculateVoiceWeight({
    status: mapStatusToDbStatus(bill.status),
    cosponsorCount,
    amendmentCount,
  });

  const dbStatus = mapStatusToDbStatus(bill.status);
  const dbOutcome = mapOutcomeToDbOutcome(bill.projectedOutcome);

  return {
    id: bill.id,
    congress_number: 119, // Default to current congress
    bill_number: bill.congressNumber || null,
    title: bill.title,
    short_title: bill.shortTitle,
    status: dbStatus,
    chamber: bill.chamber,
    sponsor_id: bill.sponsor?.id || null,
    introduced_date: bill.introducedDate,
    last_action_date: bill.lastActionDate,
    category: bill.category,
    full_text: bill.fullText,
    simplified_text: bill.simplifiedText,
    real_world_impact: bill.realWorldImpact,
    projected_outcome: dbOutcome,
    yea_count: bill.communityVotes.yea,
    nay_count: bill.communityVotes.nay,
    total_votes: bill.communityVotes.totalVoters,
    official_yea: bill.officialVotes?.yea || null,
    official_nay: bill.officialVotes?.nay || null,
    official_present: bill.officialVotes?.abstain || null,
    official_not_voting: bill.officialVotes?.notVoting || null,
    is_trending: true,
    view_count: 0,
    cosponsor_count: cosponsorCount,
    amendment_count: amendmentCount,
    weight_score: weightResult.weightScore,
    weight_last_calculated: new Date().toISOString(),
    created_at: bill.introducedDate,
    updated_at: bill.lastActionDate,
    weightTier: getWeightTier(weightResult.weightScore),
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

interface DigestBillCardProps {
  bill: DailyDigestBill & { weightTier: WeightTier };
  index: number;
  onPress: () => void;
}

function DigestBillCard({ bill, index, onPress }: DigestBillCardProps) {
  const categoryColor = categoryColors[bill.category as BillCategory] || '#64748B';
  const tierColor = getWeightTierColor(bill.weightTier);

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
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${categoryColor}30` }}
          >
            <Text style={{ color: categoryColor }} className="text-xs font-medium">
              {categoryLabels[bill.category as BillCategory]}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text className="text-white font-semibold text-sm mb-2" numberOfLines={2}>
          {bill.short_title}
        </Text>

        {/* Stats Row */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="flex-row items-center mr-3">
              <Users size={12} color="#64748B" />
              <Text className="text-slate-400 text-xs ml-1">
                {bill.cosponsor_count}
              </Text>
            </View>
            <View className="flex-row items-center">
              <FileEdit size={12} color="#64748B" />
              <Text className="text-slate-400 text-xs ml-1">
                {bill.amendment_count}
              </Text>
            </View>
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

interface DailyBillDigestProps {
  limit?: number;
  category?: BillCategory;
  showHeader?: boolean;
  title?: string;
}

export function DailyBillDigest({
  limit = 10,
  category,
  showHeader = true,
  title = 'Daily Bill Digest',
}: DailyBillDigestProps) {
  const router = useRouter();
  const useSupabase = isSupabaseConfigured();

  // Fetch from Supabase if configured
  const { data: supabaseBills, isLoading: supabaseLoading } = useDailyBillDigest(limit, category);

  // Live daily-synced bills — the SAME source and query cache the Discover tab
  // uses, so whatever Discover pulls each day shows up here automatically.
  const { data: latestRefs, isLoading: latestLoading } = useLatestReferences('bill', 30);
  const { data: trendingRefs, isLoading: trendingLoading } = useTrendingReferences('bill', 10);
  const isLoading = supabaseLoading || latestLoading || trendingLoading;

  // Calculate weights for bills (live references first, then Supabase, then mock)
  const digestBills = useMemo(() => {
    const seen = new Set<string>();
    const liveBills: Bill[] = [
      ...(latestRefs?.references ?? []).map(referenceToBill),
      ...(trendingRefs?.references ?? []).map(referenceToBill),
    ].filter((bill) => {
      if (seen.has(bill.id)) return false;
      seen.add(bill.id);
      return true;
    });

    if (liveBills.length > 0) {
      return liveBills
        .filter((bill) => !category || bill.category === category)
        .map(convertToDigestBill)
        .sort((a, b) => b.weight_score - a.weight_score)
        .slice(0, limit);
    }

    if (useSupabase && supabaseBills && supabaseBills.length > 0) {
      return supabaseBills.map((bill) => ({
        ...bill,
        weightTier: getWeightTier(bill.weight_score || 0),
      }));
    }

    // Fallback when the backend is unreachable
    const mockDigest = mockBills
      .filter((bill) => !category || bill.category === category)
      .map(convertToDigestBill)
      .sort((a, b) => b.weight_score - a.weight_score)
      .slice(0, limit);

    return mockDigest;
  }, [latestRefs, trendingRefs, useSupabase, supabaseBills, category, limit]);

  if (digestBills.length === 0 && isLoading) {
    return (
      <View className="px-4 py-6">
        <ActivityIndicator size="small" color="#F59E0B" />
      </View>
    );
  }

  if (digestBills.length === 0) {
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
        {digestBills.map((bill, index) => (
          <DigestBillCard
            key={bill.id}
            bill={bill as DailyDigestBill & { weightTier: WeightTier }}
            index={index}
            onPress={() => router.push(`/bill/${bill.id}`)}
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
  const useSupabase = isSupabaseConfigured();
  const { data: supabaseBills, isLoading } = useDailyBillDigest(limit);
  // Same live daily-synced source as Discover
  const { data: latestRefs } = useLatestReferences('bill', 30);

  const digestBills = useMemo(() => {
    const liveBills = (latestRefs?.references ?? []).map(referenceToBill);
    if (liveBills.length > 0) {
      return liveBills
        .map(convertToDigestBill)
        .sort((a, b) => b.weight_score - a.weight_score)
        .slice(0, limit);
    }

    if (useSupabase && supabaseBills && supabaseBills.length > 0) {
      return supabaseBills.map((bill) => ({
        ...bill,
        weightTier: getWeightTier(bill.weight_score || 0),
      }));
    }

    return mockBills
      .map(convertToDigestBill)
      .sort((a, b) => b.weight_score - a.weight_score)
      .slice(0, limit);
  }, [latestRefs, useSupabase, supabaseBills, limit]);

  if (digestBills.length === 0 && isLoading) {
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
        <Text className="text-white font-medium text-sm ml-1.5">Top Weighted Bills</Text>
      </View>
      {digestBills.slice(0, 3).map((bill, index) => (
        <Pressable
          key={bill.id}
          onPress={() => router.push(`/bill/${bill.id}`)}
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
