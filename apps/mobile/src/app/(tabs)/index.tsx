import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  RefreshControl,
  FlatList,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Heart,
  MessageCircle,
  Share2,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  ChevronRight,
  Sparkles,
  Users,
  AlertTriangle,
  MapPin,
  Flame,
  Award,
  Bell,
  CheckCircle,
  Shield,
  Landmark,
  FileText,
  Scale,
} from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
  FadeInDown,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useVotingStore, selectIsLiked, selectUserVote } from '@/lib/voting-store';
import { castReferenceVote, yeaNayToPosition } from '@/lib/reference-votes';
import { categoryColors, categoryLabels, branchLabels, branchColors } from '@/lib/mock-data';
import type { FeedItem, Bill, BillCategory, GovernmentBranch } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useTrendingBills, useRandomizedBillFeed } from '@/lib/hooks';
import { useAlgorithmicFeed, algorithmicPostToFeedItem } from '@/lib/algorithmic-feed';
import { useCurrentUser, useRequireAuth } from '@/lib/auth/use-civic-auth';
import type { FeedItemWithDetails, Bill as SupabaseBill } from '@/lib/database.types';

// Import new systems
import { useJurisdiction } from '@/lib/use-jurisdiction';
import { rankFeedItems, getTrendingItems, getGapItems, getLocalItems, FEED_TYPES, type FeedType, type ScoredFeedItem, getRandomizedBillFeed, fisherYatesShuffle } from '@/lib/feed-algorithm';
import { useGamificationStore, selectCivicScore, selectStreak, CIVIC_LEVELS } from '@/lib/gamification';
import { useEngagementStore, selectUnreadCount } from '@/lib/engagement';
import { verifyBill, getTrustBadge } from '@/lib/trust-verification';
import ShareModal from '@/components/ShareModal';
import { BillOfRightsBadge } from '@/components/BillOfRightsBadge';
import { PulseGapBadge } from '@/components/PulseGap';
import { DailyBillDigest } from '@/components/DailyBillDigest';
import { calculateRepresentationGap } from '@/lib/representation-gap';
import { useTimelineStore, type TimelinePost } from '@/lib/timeline-store';
import { useSeenBillsStore, selectSeenBillIds, selectAddSeenBills, selectClearSeenBills } from '@/lib/seen-bills-store';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Helper to get correct detail route based on branch
function getDetailRoute(bill: Bill): string {
  // Safety check - ensure we have a valid bill ID
  if (!bill?.id) {
    console.warn('getDetailRoute: Bill ID is missing', bill);
    return '/bill/unknown'; // Fallback route
  }
  
  const branch = bill.branch ?? 'legislative';
  switch (branch) {
    case 'executive':
      return `/executive-order/${bill.id}`;
    case 'judicial':
      return `/scotus/${bill.id}`;
    case 'legislative':
    default:
      return `/bill/${bill.id}`;
  }
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return 'Just now';
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

// Convert Supabase bill to mock Bill type for compatibility
function convertBillToLegacy(bill: SupabaseBill): Bill {
  return {
    id: bill.id,
    title: bill.title,
    shortTitle: bill.short_title,
    status: bill.status,
    chamber: bill.chamber,
    sponsor: {
      id: bill.sponsor_id ?? '',
      name: 'Sponsor',
      party: 'D',
      state: 'US',
      chamber: bill.chamber,
      imageUrl: '',
    },
    introducedDate: bill.introduced_date,
    lastActionDate: bill.last_action_date,
    category: bill.category as BillCategory,
    fullText: bill.full_text,
    simplifiedText: bill.simplified_text ?? '',
    realWorldImpact: bill.real_world_impact ?? '',
    relatedLaws: [],
    communityVotes: {
      yea: bill.yea_count,
      nay: bill.nay_count,
      totalVoters: bill.total_votes,
    },
    branch: 'legislative', // Supabase bills are always legislative
  };
}

// ==========================================
// CIVIC SCORE HEADER
// ==========================================

function CivicScoreHeader() {
  const civicScore = useGamificationStore(selectCivicScore);
  const streak = useGamificationStore(selectStreak);
  const unreadCount = useEngagementStore(selectUnreadCount);
  const router = useRouter();

  const levelInfo = CIVIC_LEVELS[civicScore.level];
  const progressPct = ((civicScore.total - levelInfo.min) / (levelInfo.max - levelInfo.min)) * 100;

  return (
    <Animated.View entering={FadeIn.duration(500)} className="mx-4 mb-3">
      <Pressable
        onPress={() => router.push('/(tabs)/profile')}
        className="bg-slate-800/60 rounded-2xl p-3 border border-slate-700/50"
      >
        <View className="flex-row items-center justify-between">
          {/* Civic Score */}
          <View className="flex-row items-center flex-1">
            <View
              className="w-12 h-12 rounded-full items-center justify-center mr-3"
              style={{ backgroundColor: `${levelInfo.color}20` }}
            >
              <Text className="text-xl font-bold" style={{ color: levelInfo.color }}>
                {civicScore.total}
              </Text>
            </View>
            <View className="flex-1">
              {/* What the number is, said out loud. It is a count of what you
                  have done on this platform, kept on this device — not a
                  standing, a rank, or anything congress.gov knows about. */}
              <Text className="text-white font-semibold text-sm">{levelInfo.title}</Text>
              <Text className="text-slate-400 text-[11px]">Your activity here</Text>
              <View className="flex-row items-center mt-1">
                <View className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden mr-2">
                  <View
                    className="h-full rounded-full"
                    style={{ width: `${progressPct}%`, backgroundColor: levelInfo.color }}
                  />
                </View>
                <Text className="text-slate-400 text-xs">{civicScore.xpToNextLevel} to next</Text>
              </View>
            </View>
          </View>

          {/* Streak & Notifications */}
          <View className="flex-row items-center ml-2">
            {streak.current > 0 && (
              <View className="flex-row items-center bg-amber-500/20 px-2 py-1 rounded-full mr-2">
                <Flame size={14} color="#F59E0B" />
                <Text className="text-amber-500 text-xs font-bold ml-1">{streak.current}</Text>
              </View>
            )}
            <Pressable className="relative p-2">
              <Bell size={20} color="#94A3B8" />
              {unreadCount > 0 && (
                <View className="absolute -top-0.5 -right-0.5 bg-red-500 rounded-full w-4 h-4 items-center justify-center">
                  <Text className="text-white text-xs font-bold">{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ==========================================
// FEED TYPE TABS
// ==========================================

function FeedTypeIcon({ type, color }: { type: FeedType; color: string }) {
  switch (type) {
    case 'for_you':
      return <Sparkles size={16} color={color} />;
    case 'following':
      return <Users size={16} color={color} />;
    case 'trending':
      return <TrendingUp size={16} color={color} />;
    case 'gaps':
      return <AlertTriangle size={16} color={color} />;
    case 'local':
      return <MapPin size={16} color={color} />;
  }
}

function FeedTypeTabs({
  activeType,
  onChangeType,
}: {
  activeType: FeedType;
  onChangeType: (type: FeedType) => void;
}) {
  return (
    <View style={{ height: 36 }} className="mb-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center', height: 36 }}
      >
        {FEED_TYPES.map((feed, index) => {
          const isActive = activeType === feed.type;
          const iconColor = isActive ? '#F59E0B' : '#64748B';

          return (
            <Pressable
              key={feed.type}
              onPress={() => {
                Haptics.selectionAsync();
                onChangeType(feed.type);
              }}
              style={{
                marginRight: index < FEED_TYPES.length - 1 ? 6 : 0,
                backgroundColor: isActive ? 'rgba(245, 158, 11, 0.2)' : 'rgba(30, 41, 59, 0.6)',
                borderRadius: 9999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: isActive ? 'rgba(245, 158, 11, 0.5)' : 'rgba(51, 65, 85, 0.5)',
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <FeedTypeIcon type={feed.type} color={iconColor} />
              <Text
                style={{ marginLeft: 6, color: isActive ? '#F59E0B' : '#94A3B8', fontSize: 12, fontWeight: '500' }}
              >
                {feed.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ==========================================
// FEED REASON BADGE
// ==========================================

function FeedReasonIcon({ type, color }: { type: string; color: string }) {
  switch (type) {
    case 'following':
    case 'similar_voters':
      return <Users size={10} color={color} />;
    case 'trending':
      return <TrendingUp size={10} color={color} />;
    case 'local':
      return <MapPin size={10} color={color} />;
    case 'category':
      return <CheckCircle size={10} color={color} />;
    case 'rep_gap':
      return <AlertTriangle size={10} color={color} />;
    case 'breaking':
      return <Flame size={10} color={color} />;
    case 'delegate':
      return <Award size={10} color={color} />;
    default:
      return <Sparkles size={10} color={color} />;
  }
}

function FeedReasonBadge({ item }: { item: ScoredFeedItem }) {
  // THE OTHER SIDE OUTRANKS EVERY OTHER LABEL, because it is the only one that
  // is a fact rather than a ranking artefact: the reader and this author are on
  // public record disagreeing about the same bill.
  if (item.isOtherSide) {
    return (
      <View
        className="flex-row items-center px-2 py-0.5 rounded-full mb-2 self-start"
        style={{ backgroundColor: '#EF444420' }}
      >
        <Scale size={10} color="#EF4444" />
        <Text className="text-xs font-medium ml-1" style={{ color: '#EF4444' }}>
          Voted the other way
        </Text>
      </View>
    );
  }

  if (!item.feedReason) return null;

  const getLabel = (): string => {
    switch (item.feedReason?.type) {
      case 'following':
        return 'Following';
      case 'trending':
        return `#${(item.feedReason as { rank: number }).rank} Trending`;
      case 'local':
        return (item.feedReason as { state: string }).state;
      case 'category':
        return categoryLabels[(item.feedReason as { category: BillCategory }).category];
      case 'rep_gap':
        return `${Math.round((item.feedReason as { gapPct: number }).gapPct)}% Gap`;
      case 'breaking':
        return 'Breaking';
      case 'similar_voters':
        return 'Similar to You';
      case 'delegate':
        return 'Delegate';
      default:
        return '';
    }
  };

  const getColor = (): string => {
    switch (item.feedReason?.type) {
      case 'following':
        return '#3B82F6';
      case 'trending':
        return '#F59E0B';
      case 'local':
        return '#22C55E';
      case 'category':
        return '#8B5CF6';
      case 'rep_gap':
        return '#EF4444';
      case 'breaking':
        return '#F97316';
      case 'similar_voters':
        return '#06B6D4';
      case 'delegate':
        return '#A855F7';
      default:
        return '#64748B';
    }
  };

  const color = getColor();
  const label = getLabel();

  if (!label) return null;

  return (
    <View
      className="flex-row items-center px-2 py-0.5 rounded-full mb-2 self-start"
      style={{ backgroundColor: `${color}20` }}
    >
      <FeedReasonIcon type={item.feedReason.type} color={color} />
      <Text className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

// ==========================================
// BRANCH FILTER TABS
// ==========================================

type BranchFilterType = GovernmentBranch | 'all';

const BRANCH_FILTERS: { type: BranchFilterType; label: string; color: string }[] = [
  { type: 'all', label: 'All', color: '#F59E0B' },
  { type: 'legislative', label: 'Congress', color: '#3B82F6' },
  { type: 'executive', label: 'Executive', color: '#F59E0B' },
  { type: 'judicial', label: 'Supreme Court', color: '#8B5CF6' },
];

function BranchFilterIcon({ type, color }: { type: BranchFilterType; color: string }) {
  switch (type) {
    case 'legislative':
      return <Landmark size={14} color={color} />;
    case 'executive':
      return <FileText size={14} color={color} />;
    case 'judicial':
      return <Scale size={14} color={color} />;
    case 'all':
    default:
      return <Sparkles size={14} color={color} />;
  }
}

function BranchFilterTabs({
  activeFilter,
  onChangeFilter,
}: {
  activeFilter: BranchFilterType;
  onChangeFilter: (filter: BranchFilterType) => void;
}) {
  return (
    <View style={{ height: 36 }} className="mb-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, alignItems: 'center', height: 36 }}
      >
        {BRANCH_FILTERS.map((filter, index) => {
          const isActive = activeFilter === filter.type;
          const iconColor = isActive ? '#fff' : filter.color;

          return (
            <Pressable
              key={filter.type}
              onPress={() => {
                Haptics.selectionAsync();
                onChangeFilter(filter.type);
              }}
              style={{
                marginRight: index < BRANCH_FILTERS.length - 1 ? 6 : 0,
                backgroundColor: isActive ? filter.color : 'rgba(30, 41, 59, 0.4)',
                borderRadius: 9999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderWidth: 1,
                borderColor: isActive ? 'transparent' : 'rgba(51, 65, 85, 0.5)',
                flexDirection: 'row',
                alignItems: 'center',
              }}
            >
              <BranchFilterIcon type={filter.type} color={iconColor} />
              <Text
                style={{ marginLeft: 4, color: isActive ? '#fff' : '#94A3B8', fontSize: 12, fontWeight: '500' }}
              >
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ==========================================
// BRANCH BADGE
// ==========================================

function BranchIcon({ branch, color }: { branch: GovernmentBranch; color: string }) {
  switch (branch) {
    case 'legislative':
      return <Landmark size={10} color={color} />;
    case 'executive':
      return <FileText size={10} color={color} />;
    case 'judicial':
      return <Scale size={10} color={color} />;
    default:
      return <Landmark size={10} color={color} />;
  }
}

function BranchBadge({ branch }: { branch?: GovernmentBranch }) {
  const branchType = branch ?? 'legislative';
  const color = branchColors[branchType];
  const label = branchLabels[branchType];

  return (
    <View
      className="flex-row items-center px-2 py-0.5 rounded-full mr-2 mb-1"
      style={{ backgroundColor: `${color}20` }}
    >
      <BranchIcon branch={branchType} color={color} />
      <Text className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}

// ==========================================
// TRUST BADGE
// ==========================================

function TrustBadge({ bill }: { bill: Bill }) {
  const verification = useMemo(() => verifyBill(bill), [bill.id]);
  const badge = getTrustBadge(verification.overallTrustScore);

  return (
    <Pressable
      className="flex-row items-center px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${badge.color}20` }}
    >
      <Shield size={10} color={badge.color} />
      <Text className="text-xs font-medium ml-1" style={{ color: badge.color }}>
        {badge.icon} {badge.label}
      </Text>
    </Pressable>
  );
}

// ==========================================
// VOTE BUTTONS
// ==========================================

interface VoteButtonsProps {
  bill: Bill;
}

function VoteButtons({ bill }: VoteButtonsProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();
  const recordVote = useGamificationStore((s) => s.recordVote);
  const updateStreak = useGamificationStore((s) => s.updateStreak);

  // My standing vote on this law — same mirror every surface reads.
  const userVote = useVotingStore(selectUserVote(bill.id));

  const yeaScale = useSharedValue(1);
  const nayScale = useSharedValue(1);

  const handleVote = async (vote: 'yea' | 'nay') => {
    // Guests can read the pulse but not move it — prompt instead of failing silently.
    if (!requireAuth('Sign in to cast your vote.')) return;

    const scale = vote === 'yea' ? yeaScale : nayScale;
    scale.value = withSequence(
      withSpring(1.2, { damping: 4 }),
      withSpring(1, { damping: 6 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // One central vote per citizen per law — feed cards carry the law's
    // reference id, so this lands on the same record as every other surface.
    void castReferenceVote(bill.id, yeaNayToPosition(vote)).catch(() => {
      Alert.alert('Vote not recorded', 'Could not record your vote. Please try again.', [
        { text: 'OK' },
      ]);
    });

    // Record in gamification
    recordVote(bill.id, bill.category, vote);
    updateStreak();
  };

  const yeaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: yeaScale.value }],
  }));

  const nayAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: nayScale.value }],
  }));

  const totalVotes = bill.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((bill.communityVotes.yea / totalVotes) * 100);
  const nayPercentage = bill.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  return (
    <View className="mt-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-xs text-slate-400">
          {bill.communityVotes.totalVoters.toLocaleString()} community votes
        </Text>
        <Pressable
          onPress={() => router.push(`/bill/${bill.id}` as any)}
          className="flex-row items-center bg-amber-500/20 px-3 py-1.5 rounded-full"
        >
          <Text className="text-xs text-amber-500 font-medium mr-1">See details</Text>
          <ChevronRight size={12} color="#F59E0B" />
        </Pressable>
      </View>

      {/* Vote Progress Bar */}
      <View className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
        <View
          className="h-full bg-emerald-500 rounded-l-full"
          style={{ width: `${yeaPercentage}%` }}
        />
      </View>

      <View className="flex-row justify-between items-center">
        <View className="flex-row items-center">
          <AnimatedPressable
            onPress={() => handleVote('yea')}
            style={yeaAnimStyle}
            className={cn(
              'flex-row items-center px-4 py-2 rounded-full mr-2',
              userVote === 'yea' ? 'bg-emerald-600' : 'bg-slate-700'
            )}
          >
            <ThumbsUp
              size={16}
              color={userVote === 'yea' ? '#fff' : '#22C55E'}
            />
            <Text
              className={cn(
                'ml-2 font-semibold',
                userVote === 'yea' ? 'text-white' : 'text-emerald-500'
              )}
            >
              Yea {yeaPercentage}%
            </Text>
          </AnimatedPressable>

          <AnimatedPressable
            onPress={() => handleVote('nay')}
            style={nayAnimStyle}
            className={cn(
              'flex-row items-center px-4 py-2 rounded-full',
              userVote === 'nay' ? 'bg-red-600' : 'bg-slate-700'
            )}
          >
            <ThumbsDown
              size={16}
              color={userVote === 'nay' ? '#fff' : '#EF4444'}
            />
            <Text
              className={cn(
                'ml-2 font-semibold',
                userVote === 'nay' ? 'text-white' : 'text-red-500'
              )}
            >
              Nay {nayPercentage}%
            </Text>
          </AnimatedPressable>
        </View>

        {/* PROJECTED OUTCOME BADGE REMOVED. A prediction the platform had no
            basis for — its only ever input was a hash of the record's id. */}
      </View>
    </View>
  );
}

// ==========================================
// FEED CARD
// ==========================================

interface FeedCardProps {
  item: ScoredFeedItem;
  index: number;
  userId?: string;
  onReply?: (item: ScoredFeedItem) => void;
  onShare?: (item: ScoredFeedItem) => void;
}

function FeedCard({ item, index, onReply, onShare }: FeedCardProps) {
  const router = useRouter();
  const requireAuth = useRequireAuth();

  // Likes live in the local store. The other half of this used to call a
  // Supabase mutation behind an `isSupabaseConfigured()` gate that has returned
  // a hardcoded false since the client was removed, so it was unreachable.
  const toggleLike = useVotingStore((s) => s.toggleLike);
  const isLiked = useVotingStore(selectIsLiked(item.id));

  const likeScale = useSharedValue(1);

  const handleLike = () => {
    if (!requireAuth('Sign in to like posts.')) return;

    likeScale.value = withSequence(
      withSpring(1.3, { damping: 4 }),
      withSpring(1, { damping: 6 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    toggleLike(item.id);
  };

  const likeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  const categoryColor = categoryColors[item.bill.category] ?? '#64748B';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 80).springify()}
      className="mx-4 mb-4"
    >
      <View className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/50">
        {/* Feed Reason Badge */}
        <FeedReasonBadge item={item} />

        {/* User Header */}
        <Pressable
          className="flex-row items-center mb-3"
          onPress={() => {}}
        >
          <Image
            source={{ uri: item.user.avatar }}
            className="w-10 h-10 rounded-full"
          />
          <View className="ml-3 flex-1">
            <Text className="text-white font-semibold">
              {item.user.displayName}
            </Text>
            <Text className="text-slate-400 text-xs">
              @{item.user.username} · {formatTimeAgo(item.timestamp)}
            </Text>
          </View>
          {item.vote && (
            <View
              className={cn(
                'px-2 py-1 rounded-full',
                item.vote === 'yea' ? 'bg-emerald-900/60' : 'bg-red-900/60'
              )}
            >
              <Text
                className={cn(
                  'text-xs font-semibold',
                  item.vote === 'yea' ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                Voted {item.vote === 'yea' ? 'YEA' : 'NAY'}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Comment if exists */}
        {item.comment && (
          <Text className="text-slate-200 mb-3 leading-5">{item.comment}</Text>
        )}

        {/* Bill Card */}
        <View className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/30">
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-row items-center flex-wrap flex-1">
              {/* Branch Badge */}
              <BranchBadge branch={item.bill.branch} />
              <View
                className="px-2 py-0.5 rounded-full mr-2 mb-1"
                style={{ backgroundColor: `${categoryColor}30` }}
              >
                <Text style={{ color: categoryColor }} className="text-xs font-medium">
                  {categoryLabels[item.bill.category]}
                </Text>
              </View>
              {/* Only show chamber for legislative branch */}
              {(!item.bill.branch || item.bill.branch === 'legislative') && (
                <View
                  className={cn(
                    'px-2 py-0.5 rounded-full mb-1',
                    item.bill.chamber === 'house' ? 'bg-blue-900/50' : 'bg-purple-900/50'
                  )}
                >
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      item.bill.chamber === 'house' ? 'text-blue-400' : 'text-purple-400'
                    )}
                  >
                    {item.bill.chamber === 'house' ? 'House' : 'Senate'}
                  </Text>
                </View>
              )}
            </View>
            <TrustBadge bill={item.bill} />
          </View>

          <Text className="text-white font-semibold text-base mb-1">
            {item.bill.shortTitle}
          </Text>
          <Text className="text-slate-400 text-sm" numberOfLines={2}>
            {item.bill.title}
          </Text>

          <VoteButtons bill={item.bill} />

          {/* Representation Gap - The People vs Congress.
              The guard is the null, not a field check. */}
          {(() => {
            const gap = calculateRepresentationGap(item.bill);
            return gap ? (
              <View className="mt-2">
                <PulseGapBadge gap={gap} />
              </View>
            ) : null;
          })()}
        </View>

        {/* Action Bar */}
        <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/50">
          <AnimatedPressable
            onPress={handleLike}
            style={likeAnimStyle}
            className="flex-row items-center mr-6"
          >
            <Heart
              size={18}
              color={isLiked ? '#EF4444' : '#64748B'}
              fill={isLiked ? '#EF4444' : 'transparent'}
            />
            <Text
              className={cn(
                'ml-1.5 text-sm',
                isLiked ? 'text-red-500' : 'text-slate-400'
              )}
            >
              {item.likes + (isLiked ? 1 : 0)}
            </Text>
          </AnimatedPressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onReply?.(item);
            }}
            className="flex-row items-center mr-6"
          >
            <MessageCircle size={18} color="#64748B" />
            <Text className="ml-1.5 text-slate-400 text-sm">Reply</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onShare?.(item);
            }}
            className="flex-row items-center"
          >
            <Share2 size={18} color="#64748B" />
            <Text className="ml-1.5 text-slate-400 text-sm">Share</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ==========================================
// MAIN SCREEN
// ==========================================

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [feedType, setFeedType] = useState<FeedType>('for_you');
  const [branchFilter, setBranchFilter] = useState<GovernmentBranch | 'all'>('all');

  // One reader for "where am I", shared with the web app and the district
  // picker. Null is a complete answer and the Local tab renders it.
  const { data: jurisdiction } = useJurisdiction();
  const myState = jurisdiction?.stateCode ?? null;
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScoredFeedItem | null>(null);
  // Better Auth session. Was the Supabase context, which is never populated —
  // so user?.id was always undefined here and the Supabase-backed like state
  // below could never resolve for a real account.
  const { user } = useCurrentUser();
  const router = useRouter();
  const requireAuth = useRequireAuth();

  // Seen bills tracking for session exclusion
  const seenBillIds = useSeenBillsStore(selectSeenBillIds);
  const addSeenBills = useSeenBillsStore(selectAddSeenBills);
  const clearSeenBills = useSeenBillsStore(selectClearSeenBills);

  // Gamification
  const updateStreak = useGamificationStore((s) => s.updateStreak);
  const startSession = useEngagementStore((s) => s.startSession);

  // Track session and streak on mount
  useEffect(() => {
    startSession();
    updateStreak();
  }, []);

  // Live public feed — every user's timeline posts, cycled through the
  // backend feed algorithm (GET /api/feed). Refetches so the feed stays fresh.
  const {
    data: algorithmicFeed,
    isLoading: feedLoading,
    isError: feedError,
    refetch: refetchAlgorithmicFeed,
  } = useAlgorithmicFeed(30);

  // useFeed/useUserFeedLikes were the Supabase half of this screen. Both are
  // gated on isSupabaseConfigured(), which has returned a hardcoded false since
  // the client was removed, so they never ran and their results never reached
  // the page. Only useTrendingBills is kept — it is read below.
  const { data: trendingBills } = useTrendingBills(5);

  // Randomized bill feed with session exclusion (for Supabase)
  const { data: randomizedData } = useRandomizedBillFeed(seenBillIds, 10);

  // Track newly seen bills from randomized feed
  useEffect(() => {
    if (randomizedData?.newSeenIds && randomizedData.newSeenIds.length > 0) {
      addSeenBills(randomizedData.newSeenIds);
    }
  }, [randomizedData?.newSeenIds]);

  // Convert and rank feed items with session exclusion
  const feedData = useMemo(() => {
    // The feed is exactly what GET /api/feed returns. Nothing else.
    //
    // Two hardcoded arrays used to be concatenated on unconditionally, as
    // "filler until the community produces volume" — so an empty feed looked
    // busy and every post a visitor read was invented. An empty feed is now
    // allowed to be empty, and says so.
    let rawItems: FeedItem[] = (algorithmicFeed?.posts ?? []).map(algorithmicPostToFeedItem);



    // Apply branch filter
    if (branchFilter !== 'all') {
      rawItems = rawItems.filter(item => {
        const itemBranch = item.bill.branch ?? 'legislative';
        return itemBranch === branchFilter;
      });
    }

    // Filter out seen bills for "for_you" feed type (session exclusion)
    // Only filter if we have more items than needed (prevents empty feed)
    if (feedType === 'for_you' && seenBillIds.size > 0) {
      const unseenItems = rawItems.filter(item => !seenBillIds.has(item.bill.id));
      // Only use filtered list if we still have enough items
      if (unseenItems.length >= 5) {
        rawItems = unseenItems;
      }
    }

    // Apply algorithm based on feed type
    let scoredItems: ScoredFeedItem[];
    switch (feedType) {
      case 'for_you':
        // Apply weighted randomization with Fisher-Yates shuffle
        scoredItems = rankFeedItems(rawItems, null, { boostGaps: true });
        // Apply discovery score randomization to top 20 items
        if (scoredItems.length > 0) {
          const topPool = scoredItems.slice(0, 20);
          const rest = scoredItems.slice(20);
          // Add discovery scores and shuffle
          const withDiscovery = topPool.map(item => ({
            ...item,
            score: item.score * (0.7 + Math.random() * 0.6), // discovery_score formula
          }));
          const shuffled = fisherYatesShuffle(withDiscovery);
          shuffled.sort((a, b) => b.score - a.score);
          scoredItems = [...shuffled, ...rest];
        }
        break;
      case 'trending':
        scoredItems = getTrendingItems(rawItems, 20);
        break;
      case 'gaps':
        scoredItems = getGapItems(rawItems, 20);
        break;
      case 'following':
        /*
         * The backend decides who you follow, so this tab asks for that feed
         * rather than re-deriving it here. Ranking only orders what came back.
         * It previously carried the comment "mock: just return all" and did
         * exactly that.
         */
        scoredItems = rankFeedItems(rawItems, null, { diversityEnabled: false });
        break;
      case 'local':
        /*
         * Records introduced by a member from your state. Was: every item, with
         * the comment "would filter by user's location" and no location to
         * filter by. There is one now — self-declared and optional — and the
         * screen says so when it is missing instead of showing the national
         * feed under a Local heading.
         */
        scoredItems = myState ? getLocalItems(rawItems, { state: myState }, 50) : [];
        break;
      default:
        scoredItems = rankFeedItems(rawItems);
    }


    // The weaving block that used to sit here interleaved real posts with the
    // hardcoded filler — one real post per three slots. With no filler there is
    // nothing to weave against: rawItems is already exactly the backend's posts,
    // so the ranker's output is the answer.


    return scoredItems;
  }, [algorithmicFeed, feedType, branchFilter, seenBillIds.size, myState]);

  // Track seen bills separately to avoid circular updates
  const lastSeenRef = React.useRef<string[]>([]);
  useEffect(() => {
    if (feedType === 'for_you' && feedData.length > 0) {
      const newBillIds = feedData.slice(0, 10).map(item => item.bill.id);
      // Only add if different from last time
      const newIdsKey = newBillIds.join(',');
      const lastIdsKey = lastSeenRef.current.join(',');
      if (newIdsKey !== lastIdsKey) {
        lastSeenRef.current = newBillIds;
        addSeenBills(newBillIds);
      }
    }
  }, [feedData, feedType]);


  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Clear seen bills on refresh to get fresh content
    if (feedType === 'for_you') {
      clearSeenBills();
    }

    await refetchAlgorithmicFeed();

    setTimeout(() => setRefreshing(false), 500);
  }, [feedType, clearSeenBills]);

  const handleReply = useCallback((item: ScoredFeedItem) => {
    if (!requireAuth('Sign in to join the conversation.')) return;

    // Navigate to timeline with reply context
    router.push('/(tabs)/timeline');
  }, [router, requireAuth]);

  const handleShare = useCallback((item: ScoredFeedItem) => {
    if (!requireAuth('Sign in to share this.')) return;

    setSelectedItem(item);
    setShowShareModal(true);
  }, [requireAuth]);

  const renderItem = useCallback(
    ({ item, index }: { item: ScoredFeedItem; index: number }) => (
      <FeedCard
        item={item}
        index={index}
        userId={user?.id}
        onReply={handleReply}
        onShare={handleShare}
      />
    ),
    [user?.id, handleReply, handleShare]
  );

  const keyExtractor = useCallback((item: ScoredFeedItem) => item.id, []);

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3 border-b border-slate-800">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-2xl font-bold text-white">AYE & NAY</Text>
              <Text className="text-slate-400 text-sm">All 3 branches of government</Text>
            </View>
            <View className="flex-row items-center">
              {/* Bill of Rights Badge */}
              <BillOfRightsBadge variant="compact" className="mr-2" />
              {/* Branch indicators */}
              <View className="flex-row items-center bg-slate-800/60 px-2 py-1 rounded-full mr-2">
                <Landmark size={12} color="#3B82F6" />
                <FileText size={12} color="#F59E0B" style={{ marginLeft: 4 }} />
                <Scale size={12} color="#8B5CF6" style={{ marginLeft: 4 }} />
              </View>
            </View>
          </View>
        </View>

        {/* Feed Type Tabs */}
        <FeedTypeTabs activeType={feedType} onChangeType={setFeedType} />

        {/* Branch Filter Tabs */}
        <BranchFilterTabs activeFilter={branchFilter} onChangeFilter={setBranchFilter} />

        {/* Feed */}
        <FlatList
          data={feedData}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
            />
          }
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={5}
          windowSize={5}
          ListHeaderComponent={
            <DailyBillDigest
              limit={8}
              title="Daily Digest"
              showHeader={true}
            />
          }
          ListEmptyComponent={
            feedLoading ? (
              <View className="items-center justify-center py-20">
                <ActivityIndicator color="#64748B" />
                <Text className="text-slate-500 text-sm mt-3">Loading the feed…</Text>
              </View>
            ) : feedError ? (
              <View className="items-center justify-center py-20 px-6">
                <Text className="text-slate-300 text-lg">Couldn&apos;t load the feed</Text>
                <Text className="text-slate-500 text-sm mt-2 text-center">
                  Check your connection and try again.
                </Text>
                <Pressable
                  onPress={() => refetchAlgorithmicFeed()}
                  className="mt-4 bg-slate-800 px-5 py-2.5 rounded-xl"
                >
                  <Text className="text-white text-sm">Try again</Text>
                </Pressable>
              </View>
            ) : feedType === 'local' && !myState ? (
              /*
                 The Local tab, for somebody who has not said where they are. It
                 used to show them the national feed under a Local heading —
                 which is not an empty state, it is a wrong one.
              */
              <View className="items-center justify-center py-20 px-6">
                <MapPin size={28} color="#64748B" />
                <Text className="text-slate-300 text-lg mt-3">Local needs your state</Text>
                <Text className="text-slate-500 text-sm mt-2 text-center">
                  Pick your district in your profile and this fills with records introduced by the
                  people who represent you. It is optional, it is only your state and district, and
                  you can remove it whenever you like.
                </Text>
                <Pressable
                  onPress={() => router.push('/edit-profile')}
                  className="mt-4 bg-blue-600 px-5 py-2.5 rounded-xl"
                >
                  <Text className="text-white text-sm font-medium">Set my district</Text>
                </Pressable>
              </View>
            ) : feedType === 'local' ? (
              <View className="items-center justify-center py-20 px-6">
                <MapPin size={28} color="#64748B" />
                <Text className="text-slate-300 text-lg mt-3">Nothing local yet</Text>
                <Text className="text-slate-500 text-sm mt-2 text-center">
                  No stored record was introduced by a member from {myState}. This stays empty
                  rather than showing you the national feed under a Local heading.
                </Text>
              </View>
            ) : (
              /* A genuinely empty feed. The database has no posts yet, which is
                 correct — this used to be padded with invented posts so it never
                 looked empty. Point people at Discover, which does have content. */
              <View className="items-center justify-center py-20 px-6">
                <Text className="text-slate-300 text-lg">No posts yet</Text>
                <Text className="text-slate-500 text-sm mt-2 text-center">
                  Nobody has posted yet. Open a bill in Discover and share where you stand — yours
                  will be the first.
                </Text>
                <Pressable
                  onPress={() => router.push('/(tabs)/discover')}
                  className="mt-4 bg-blue-600 px-5 py-2.5 rounded-xl"
                >
                  <Text className="text-white text-sm font-medium">Browse Discover</Text>
                </Pressable>
              </View>
            )
          }
        />
      </SafeAreaView>

      {/* Share Modal */}
      <ShareModal
        visible={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setSelectedItem(null);
        }}
        content={selectedItem ? {
          type: 'bill',
          id: selectedItem.bill.id,
          title: selectedItem.bill.shortTitle,
        } : undefined}
      />
    </View>
  );
}
