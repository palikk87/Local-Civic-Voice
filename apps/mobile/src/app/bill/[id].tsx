import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Share,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Bookmark,
  FileText,
  Lightbulb,
  Scale,
  Users,
  Clock,
  Building2,
  ExternalLink,
  AlertCircle,
  MessageCircle,
  Send,
  Sparkles,
  ChevronDown,
  ChevronUp,
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
import { useQuery, useMutation } from '@tanstack/react-query';
import { bills, categoryColors, categoryLabels } from '@/lib/mock-data';
import { useVotingStore, selectUserVote } from '@/lib/voting-store';
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from '@/lib/reference-votes';
import { cn } from '@/lib/cn';
import {
  generateBillExplanation,
  analyzeBillImpact,
  askAboutBill,
  generateDebatePoints,
  getAIAvailability,
} from '@/lib/ai-service';
import { calculateRepresentationGap } from '@/lib/representation-gap';
import { PulseGap } from '@/components/PulseGap';
import { CitizensBriefCard } from '@/components/CitizensBrief';
import {
  TurningPointsPanel,
  OtherSidePanel,
  PulseHistoryPanel,
} from '@/components/CivicPanels';
import { NewsReelCarousel } from '@/components/NewsReelCarousel';
import { TransparencyIndicator, ArticleBadge } from '@/components/BillOfRightsBadge';
import type { Bill, Representative } from '@/lib/types';
import { useTimelineStore } from '@/lib/timeline-store';
import { useCitizenBrief } from '@/lib/use-citizen-brief';
import { fetchBillSponsor } from '@/lib/government-api';
import { useBill } from '@/lib/hooks';
import {
  useGovernmentReference,
  referenceToBill,
} from '@/lib/api/references';
import type { Bill as SupabaseBill, Representative as SupabaseRepresentative } from '@/lib/database.types';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ViewMode = 'simplified' | 'full' | 'impact' | 'related';

/**
 * Stand-in when a bill's sponsor cannot be resolved.
 *
 * The fallbacks this replaces printed a REAL member of Congress — `representatives[0]`,
 * or a random pick — as the sponsor of a bill they may have nothing to do with.
 * Naming the wrong legislator is worse than admitting we do not know.
 */
const UNKNOWN_SPONSOR: Representative = {
  id: 'unknown',
  name: 'Sponsor unknown',
  party: 'I',
  state: '',
  district: undefined,
  chamber: 'house',
  imageUrl: '',
  contactPhone: '',
  website: '',
};

function mapSupabaseBillToBill(
  bill: SupabaseBill,
  representative: SupabaseRepresentative | null
): Bill {
  const sponsor = representative
    ? {
        id: representative.id,
        name: representative.name,
        party: representative.party as 'D' | 'R' | 'I',
        state: representative.state,
        district: representative.district ?? undefined,
        chamber: representative.chamber,
        imageUrl: representative.image_url ?? '',
        contactEmail: representative.contact_email ?? undefined,
        contactPhone: representative.contact_phone ?? undefined,
        website: representative.website ?? undefined,
        socialMedia: representative.twitter || representative.facebook
          ? {
              twitter: representative.twitter ?? undefined,
              facebook: representative.facebook ?? undefined,
            }
          : undefined,
      }
    : UNKNOWN_SPONSOR;

  const hasOfficialVotes = [
    bill.official_yea,
    bill.official_nay,
    bill.official_present,
    bill.official_not_voting,
  ].some((value) => value !== null);

  return {
    id: bill.id,
    title: bill.title,
    shortTitle: bill.short_title,
    status: bill.status,
    chamber: bill.chamber,
    sponsor,
    introducedDate: bill.introduced_date,
    lastActionDate: bill.last_action_date,
    category: bill.category as Bill['category'],
    fullText: bill.full_text,
    simplifiedText: bill.simplified_text ?? '',
    realWorldImpact: bill.real_world_impact ?? '',
    relatedLaws: [],
    communityVotes: {
      yea: bill.yea_count ?? 0,
      nay: bill.nay_count ?? 0,
      totalVoters: bill.total_votes ?? 0,
    },
    projectedOutcome: bill.projected_outcome,
    officialVotes: hasOfficialVotes
      ? {
          yea: bill.official_yea ?? 0,
          nay: bill.official_nay ?? 0,
          abstain: bill.official_present ?? 0,
          notVoting: bill.official_not_voting ?? 0,
        }
      : undefined,
    branch: 'legislative',
  };
}

// AI-powered Impact Analysis Section
function AIImpactSection({ bill }: { bill: Bill }) {
  const [showDebate, setShowDebate] = useState(false);

  const { data: analysisData, isLoading: analysisLoading } = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: ['bill-analysis', bill.id],
    queryFn: () => analyzeBillImpact(bill),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const { data: debateData, isLoading: debateLoading } = useQuery({
    // eslint-disable-next-line @tanstack/query/exhaustive-deps
    queryKey: ['bill-debate', bill.id],
    queryFn: () => generateDebatePoints(bill),
    enabled: showDebate,
    staleTime: 1000 * 60 * 30,
  });

  const handleShowDebate = useCallback(() => {
    setShowDebate(true);
  }, []);

  const analysis = analysisData?.data;
  const { data: aiAvailable } = useQuery({
    queryKey: ['ai-availability'],
    queryFn: getAIAvailability,
  });

  return (
    <View>
      {/* Static Impact */}
      <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-4">
        <View className="flex-row items-center mb-3">
          <Users size={20} color="#F59E0B" />
          <Text className="text-white font-semibold text-lg ml-2">
            Real-World Impact
          </Text>
        </View>
        <Text className="text-slate-300 leading-6">
          {bill.realWorldImpact}
        </Text>
      </View>

      {/* AI Analysis */}
      {aiAvailable?.openai && (
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          className="bg-gradient-to-br from-amber-900/30 to-slate-800/60 rounded-xl p-4 border border-amber-700/30 mb-4"
        >
          <View className="flex-row items-center mb-3">
            <Sparkles size={20} color="#F59E0B" />
            <Text className="text-amber-400 font-semibold text-lg ml-2">
              AI Analysis
            </Text>
          </View>

          {analysisLoading ? (
            <View className="py-6 items-center">
              <ActivityIndicator color="#F59E0B" size="small" />
              <Text className="text-slate-400 mt-2">Analyzing bill...</Text>
            </View>
          ) : analysis ? (
            <View>
              <Text className="text-slate-300 leading-6 mb-4">{analysis.summary}</Text>

              {/* Pros */}
              <View className="mb-3">
                <Text className="text-emerald-400 font-semibold mb-2">Potential Benefits</Text>
                {analysis.pros.map((pro, i) => (
                  <View key={i} className="flex-row items-start mb-1.5">
                    <View className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 mr-2" />
                    <Text className="text-slate-300 flex-1">{pro}</Text>
                  </View>
                ))}
              </View>

              {/* Cons */}
              <View className="mb-3">
                <Text className="text-red-400 font-semibold mb-2">Potential Concerns</Text>
                {analysis.cons.map((con, i) => (
                  <View key={i} className="flex-row items-start mb-1.5">
                    <View className="w-1.5 h-1.5 rounded-full bg-red-500 mt-2 mr-2" />
                    <Text className="text-slate-300 flex-1">{con}</Text>
                  </View>
                ))}
              </View>

              {/* Impacted Groups */}
              <View>
                <Text className="text-slate-400 font-medium mb-2">Who This Affects</Text>
                <View className="flex-row flex-wrap">
                  {analysis.impactedGroups.map((group, i) => (
                    <View key={i} className="bg-slate-700/50 px-3 py-1.5 rounded-full mr-2 mb-2">
                      <Text className="text-slate-300 text-sm">{group}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <Text className="text-slate-400">Unable to load AI analysis</Text>
          )}
        </Animated.View>
      )}

      {/* Debate Points */}
      {aiAvailable?.openai && (
        <Animated.View
          entering={FadeInDown.delay(200).springify()}
          className="bg-slate-800/60 rounded-xl border border-slate-700/40"
        >
          <Pressable
            onPress={handleShowDebate}
            className="flex-row items-center justify-between p-4"
          >
            <View className="flex-row items-center">
              <MessageCircle size={20} color="#64748B" />
              <Text className="text-white font-semibold ml-2">
                See Both Sides
              </Text>
            </View>
            {showDebate ? (
              <ChevronUp size={20} color="#64748B" />
            ) : (
              <ChevronDown size={20} color="#64748B" />
            )}
          </Pressable>

          {showDebate && (
            <View className="px-4 pb-4 border-t border-slate-700/50">
              {debateLoading ? (
                <View className="py-6 items-center">
                  <ActivityIndicator color="#F59E0B" size="small" />
                  <Text className="text-slate-400 mt-2">Generating arguments...</Text>
                </View>
              ) : debateData?.data ? (
                <Text className="text-slate-300 leading-6 mt-3 whitespace-pre-wrap">
                  {debateData.data}
                </Text>
              ) : (
                <Text className="text-slate-400 mt-3">Tap to load debate points</Text>
              )}
            </View>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function ViewModeButton({
  mode,
  label,
  isActive,
  onPress,
  iconType,
}: {
  mode: ViewMode;
  label: string;
  isActive: boolean;
  onPress: () => void;
  iconType: 'simplified' | 'full' | 'impact' | 'related';
}) {
  const iconColor = isActive ? '#0F172A' : '#F59E0B';

  const renderIcon = () => {
    switch (iconType) {
      case 'simplified':
        return <Lightbulb size={16} color={iconColor} />;
      case 'full':
        return <FileText size={16} color={iconColor} />;
      case 'impact':
        return <Users size={16} color={iconColor} />;
      case 'related':
        return <Scale size={16} color={iconColor} />;
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center px-4 py-2.5 rounded-xl mr-2',
        isActive ? 'bg-amber-500' : 'bg-slate-800'
      )}
    >
      {renderIcon()}
      <Text
        className={cn(
          'ml-2 font-medium',
          isActive ? 'text-slate-900' : 'text-slate-300'
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function BillDetailScreen() {
  const requireAuth = useRequireAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('simplified');

  const { data: supabaseBill } = useBill(id ?? '');
  const supabaseBillData = (supabaseBill ?? null) as (SupabaseBill & {
    representatives?: SupabaseRepresentative | null;
  }) | null;

  let bill: Bill | undefined;

  // If Supabase has this bill, map it to the app Bill shape
  if (!bill && supabaseBillData) {
    bill = mapSupabaseBillToBill(
      supabaseBillData,
      supabaseBillData.representatives ?? null
    );
  }

  // Every bill comes from GET /api/government-references/:id.
  //
  // Two hardcoded arrays used to be searched first, and the winner was passed
  // as `enabled: !bill` into this query — so for any id in either array the
  // real fetch never ran. Deleting the imports alone would not have fixed that;
  // the gate had to go with them.
  const {
    data: billRefData,
    isLoading: billRefLoading,
    isError: billRefError,
    refetch: refetchBill,
  } = useGovernmentReference(id);
  // Brief stored on the master reference — written once, read by everyone after.
  // Asked for, never automatic. Writing a brief means reading the whole
  // document, so it is a choice the reader makes rather than a cost of
  // opening the screen.
  const citizenBrief = useCitizenBrief(billRefData?.reference?.id, {
    initialBrief: billRefData?.reference?.citizenBriefSections ?? null,
    initialState: billRefData?.reference?.briefState ?? 'idle',
  });
  if (!bill && billRefData?.reference?.referenceType === 'bill') {
    bill = referenceToBill(billRefData.reference);
  }

  // If not found, check if it's a library post and create bill data from it
  const timelinePosts = useTimelineStore((s) => s.posts);
  const libraryPost = !bill
    ? timelinePosts.find((p) => p.sharedContent?.id === id && p.source === 'library')
    : null;

  /**
   * Last resort: one of the sixteen bills kept for the Related Laws panel.
   *
   * ORDER MATTERS AND IS THE WHOLE POINT. Read only after the API query has
   * finished and produced nothing, and after the library-post path has produced
   * nothing. The version of this that had to be deleted searched a hardcoded
   * array FIRST and then passed `enabled: !bill` into the query, so for any id
   * in that array the real fetch never ran and a live record could never win.
   *
   * Their vote counts are zero and their sponsor is unknown — see mock-data.ts
   * for what was stripped and why.
   */
  const fallbackBill =
    !bill && !libraryPost && !billRefLoading ? bills.find((b) => b.id === id) : undefined;

  // Fetch real sponsor info if this is a library post
  const { data: sponsorInfo } = useQuery({
    queryKey: ['billSponsor', libraryPost?.sharedContent?.sourceUrl],
    queryFn: () => fetchBillSponsor(libraryPost?.sharedContent?.sourceUrl ?? ''),
    enabled: !!libraryPost?.sharedContent?.sourceUrl,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  // If we have a library post but no bill, create a virtual bill from the post data
  if (!bill && libraryPost) {
    const sponsor = sponsorInfo
      ? {
          id: sponsorInfo.bioguideId ?? 'unknown',
          name: sponsorInfo.name,
          party: sponsorInfo.party as 'R' | 'D' | 'I',
          state: sponsorInfo.state,
          district: sponsorInfo.district,
          chamber: 'house' as const,
          imageUrl: sponsorInfo.imageUrl ?? '',
          contactPhone: '',
          website: '',
        }
      : UNKNOWN_SPONSOR;

    // Extract text content for fullText and simplifiedText
    // The aiBrief is a simplified summary, so use it for simplifiedText
    // For fullText, use a placeholder that directs to source, or use title if available
    const titleText = libraryPost.sharedContent?.title ?? 'Unknown Bill';
    const aiBriefText = libraryPost.aiBrief ?? '';
    const contentText = libraryPost.content ?? '';
    
    // simplifiedText: Use aiBrief if available (it's already simplified), otherwise use content or title
    const simplifiedTextValue = aiBriefText || contentText || `${titleText}. This document was sourced from an official government database. Click the source link to view the full text.`;
    
    // fullText: Use a placeholder directing to source, since we don't have full text in library posts
    const fullTextValue = aiBriefText 
      ? `${titleText}\n\n${aiBriefText}\n\n[Full text available at the official source. Click the source link above to view the complete document.]`
      : `${titleText}\n\n[Full text available at the official source. Click the source link above to view the complete document.]`;

    bill = {
      id: id ?? '',
      title: titleText,
      shortTitle: titleText.slice(0, 60),
      status: 'introduced',
      chamber: 'house',
      sponsor,
      introducedDate: new Date().toISOString().split('T')[0],
      lastActionDate: new Date().toISOString().split('T')[0],
      category: (libraryPost.sharedContent?.category ?? 'economy') as Bill['category'],
      congressUrl: libraryPost.sharedContent?.sourceUrl,
      fullText: fullTextValue,
      simplifiedText: simplifiedTextValue,
      realWorldImpact: libraryPost.opinion ?? 'This legislation could have significant impact on citizens.',
      relatedLaws: [],
      communityVotes: {
        // A library item is a document someone saved, not a reference the
        // platform tracks, so it has no tallies. These used to be
        // Math.random() — invented numbers rendered as real citizen votes, and
        // different on every open.
        yea: 0,
        nay: 0,
        totalVoters: 0,
      },
      projectedOutcome: 'uncertain',
      branch: 'legislative',
      // Don't set citizensBrief - let the CitizensBrief component generate it if needed
    };
  }

  const userVote = useVotingStore(selectUserVote(id ?? ''));

  // The server knows my standing vote on this law (cast from any surface, any
  // device). Mirror it locally so this screen and every card agree.
  const serverUserVote = billRefData?.reference?.userVote;
  useEffect(() => {
    if (id && serverUserVote !== undefined) {
      syncServerVote(id, serverUserVote);
    }
  }, [id, serverUserVote]);

  const yeaScale = useSharedValue(1);
  const nayScale = useSharedValue(1);

  const yeaAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: yeaScale.value }],
  }));

  const nayAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: nayScale.value }],
  }));

  // Early return AFTER all hooks
  if (!bill && billRefLoading) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <Text className="text-slate-400 text-base">Loading bill...</Text>
      </View>
    );
  }

  // The fallback, applied after every live path has had its turn.
  if (!bill && fallbackBill) {
    bill = fallbackBill;
  }

  if (!bill) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <Text className="text-white text-lg mt-4">Bill not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 bg-slate-800 px-6 py-3 rounded-xl"
        >
          <Text className="text-white">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const categoryColor = categoryColors[bill.category] ?? '#64748B';
  const yeaPercentage = Math.round(
    (bill.communityVotes.yea / (bill.communityVotes.totalVoters || 1)) * 100
  );
  const nayPercentage = bill.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: 'yea' | 'nay') => {
    if (!requireAuth('Sign in to cast your vote on this bill.')) return;

    const scale = vote === 'yea' ? yeaScale : nayScale;
    scale.value = withSequence(
      withSpring(1.15, { damping: 4 }),
      withSpring(1, { damping: 6 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // One central vote per citizen per law — same record the timeline,
    // feed and library vote into. Voting the same way again removes it.
    void castReferenceVote(bill.id, yeaNayToPosition(vote)).catch(() => {
      Alert.alert('Vote not recorded', 'Could not record your vote. Please try again.', [
        { text: 'OK' },
      ]);
    });
  };

  const handleBookmark = () => {
    if (!requireAuth('Sign in to save bills to your library.')) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth('Sign in to share this bill.')) return;

    try {
      await Share.share({
        message: `Check out this bill: ${bill.title}\n\nVote on AYE & NAY!`,
      });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const statusLabels: Record<string, string> = {
    introduced: 'Introduced',
    in_committee: 'In Committee',
    passed_house: 'Passed House',
    passed_senate: 'Passed Senate',
    enacted: 'Enacted',
    vetoed: 'Vetoed',
  };

  const relationshipLabels: Record<string, string> = {
    amends: 'Amends',
    conflicts: 'Conflicts With',
    supports: 'Supports',
    references: 'References',
  };

  const lawTypeLabels: Record<string, string> = {
    statutory: 'Statutory Law',
    case_law: 'Case Law',
    regulation: 'Regulation',
    constitutional: 'Constitutional',
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0F172A', '#1E293B', '#0F172A']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={() => router.back()}
              className="bg-slate-800 p-2 rounded-full"
            >
              <ArrowLeft size={22} color="#fff" />
            </Pressable>

            <View className="flex-row">
              <Pressable
                onPress={handleBookmark}
                className="bg-slate-800 p-2 rounded-full mr-2"
              >
                <Bookmark size={20} color="#64748B" />
              </Pressable>
              <Pressable
                onPress={handleShare}
                className="bg-slate-800 p-2 rounded-full"
              >
                <Share2 size={20} color="#64748B" />
              </Pressable>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 120 }}
          >
            {/* Bill Header */}
            <Animated.View
              entering={FadeInDown.springify()}
              className="px-4 py-4"
            >
              <View className="flex-row items-center mb-3">
                <View
                  className="px-3 py-1 rounded-full mr-2"
                  style={{ backgroundColor: `${categoryColor}30` }}
                >
                  <Text style={{ color: categoryColor }} className="text-sm font-medium">
                    {categoryLabels[bill.category]}
                  </Text>
                </View>
                <View
                  className={cn(
                    'px-3 py-1 rounded-full mr-2',
                    bill.chamber === 'house' ? 'bg-blue-900/50' : 'bg-purple-900/50'
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm font-medium',
                      bill.chamber === 'house' ? 'text-blue-400' : 'text-purple-400'
                    )}
                  >
                    {bill.chamber === 'house' ? 'House' : 'Senate'}
                  </Text>
                </View>
                <View className="bg-slate-700 px-3 py-1 rounded-full">
                  <Text className="text-slate-300 text-sm font-medium">
                    {statusLabels[bill.status]}
                  </Text>
                </View>
              </View>

              <Text className="text-white font-bold text-2xl mb-2">
                {bill.shortTitle}
              </Text>
              <Text className="text-slate-400 text-base leading-6">
                {bill.title}
              </Text>

              {/* Sponsor */}
              <View className="flex-row items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <Image
                  source={{ uri: bill.sponsor.imageUrl }}
                  className="w-10 h-10 rounded-full"
                />
                <View className="ml-3 flex-1">
                  <Text className="text-white font-medium">
                    Sponsored by {bill.sponsor.name}
                  </Text>
                  <Text className="text-slate-400 text-sm">
                    {bill.sponsor.party === 'D'
                      ? 'Democrat'
                      : bill.sponsor.party === 'R'
                      ? 'Republican'
                      : 'Independent'}{' '}
                    - {bill.sponsor.state}
                  </Text>
                </View>
                <View
                  className={cn(
                    'px-2 py-1 rounded-full',
                    bill.sponsor.party === 'D'
                      ? 'bg-blue-900/50'
                      : bill.sponsor.party === 'R'
                      ? 'bg-red-900/50'
                      : 'bg-purple-900/50'
                  )}
                >
                  <Text
                    className={cn(
                      'font-semibold',
                      bill.sponsor.party === 'D'
                        ? 'text-blue-400'
                        : bill.sponsor.party === 'R'
                        ? 'text-red-400'
                        : 'text-purple-400'
                    )}
                  >
                    {bill.sponsor.party}
                  </Text>
                </View>
              </View>

              {/* Dates */}
              <View className="flex-row mt-3">
                <View className="flex-row items-center mr-4">
                  <Clock size={14} color="#64748B" />
                  <Text className="text-slate-400 text-sm ml-1.5">
                    Introduced {new Date(bill.introducedDate).toLocaleDateString()}
                  </Text>
                </View>
                <View className="flex-row items-center">
                  <Building2 size={14} color="#64748B" />
                  <Text className="text-slate-400 text-sm ml-1.5">
                    Last action {new Date(bill.lastActionDate).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            </Animated.View>

            {/* Community Vote Stats */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              className="px-4 mb-4"
            >
              <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <View className="flex-row items-center justify-between mb-3">
                  <View className="flex-row items-center">
                    <Text className="text-white font-semibold">Community Vote</Text>
                    <View className="ml-2">
                      <ArticleBadge articleNumber="III" size="sm" />
                    </View>
                  </View>
                  <Text className="text-slate-400 text-sm">
                    {bill.communityVotes.totalVoters.toLocaleString()} votes
                  </Text>
                </View>

                <View className="h-3 bg-slate-700 rounded-full overflow-hidden mb-3">
                  <View
                    className="h-full bg-emerald-500 rounded-l-full"
                    style={{ width: `${yeaPercentage}%` }}
                  />
                </View>

                <View className="flex-row justify-between">
                  <View className="flex-row items-center">
                    <ThumbsUp size={16} color="#22C55E" />
                    <Text className="text-emerald-500 font-semibold ml-1.5">
                      {yeaPercentage}% Yea
                    </Text>
                    <Text className="text-slate-500 text-sm ml-1">
                      ({bill.communityVotes.yea.toLocaleString()})
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-sm mr-1">
                      ({bill.communityVotes.nay.toLocaleString()})
                    </Text>
                    <Text className="text-red-500 font-semibold mr-1.5">
                      {nayPercentage}% Nay
                    </Text>
                    <ThumbsDown size={16} color="#EF4444" />
                  </View>
                </View>

                {/* Projected vs Community */}
                <View className="flex-row items-center justify-between mt-4 pt-4 border-t border-slate-700/50">
                  <View>
                    <Text className="text-slate-400 text-xs mb-1">Projected Outcome</Text>
                    <View
                      className={cn(
                        'px-3 py-1.5 rounded-full',
                        bill.projectedOutcome === 'likely_pass'
                          ? 'bg-emerald-900/50'
                          : bill.projectedOutcome === 'likely_fail'
                          ? 'bg-red-900/50'
                          : 'bg-slate-700'
                      )}
                    >
                      <Text
                        className={cn(
                          'font-medium',
                          bill.projectedOutcome === 'likely_pass'
                            ? 'text-emerald-400'
                            : bill.projectedOutcome === 'likely_fail'
                            ? 'text-red-400'
                            : 'text-slate-400'
                        )}
                      >
                        {bill.projectedOutcome === 'likely_pass'
                          ? 'Likely to Pass'
                          : bill.projectedOutcome === 'likely_fail'
                          ? 'Likely to Fail'
                          : 'Uncertain'}
                      </Text>
                    </View>
                  </View>

                  {bill.officialVotes && (
                    <View>
                      <Text className="text-slate-400 text-xs mb-1 text-right">
                        Official Vote
                      </Text>
                      <View className="flex-row items-center">
                        <Text className="text-emerald-500 font-medium mr-2">
                          {bill.officialVotes.yea} Y
                        </Text>
                        <Text className="text-red-500 font-medium">
                          {bill.officialVotes.nay} N
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>
            </Animated.View>

            {/* Representation Gap - Shows discrepancy between public and official votes */}
            {bill.officialVotes && (
              <Animated.View
                entering={FadeInDown.delay(125).springify()}
                className="px-4 mb-4"
              >
                <PulseGap
                  gap={calculateRepresentationGap(bill)}
                  compact
                />
              </Animated.View>
            )}

            {/* The three things only this platform can show: who crossed
                sides and why, what the other side actually wrote, and when
                opinion moved relative to the text moving. Web parity. */}
            <Animated.View
              entering={FadeInDown.delay(127).springify()}
              className="px-4"
            >
              <TurningPointsPanel referenceId={billRefData?.reference?.id} />
              <OtherSidePanel referenceId={billRefData?.reference?.id} />
              <PulseHistoryPanel referenceId={billRefData?.reference?.id} />
            </Animated.View>

            {/* Vote Transparency - Article III Compliance */}
            <Animated.View
              entering={FadeInDown.delay(130).springify()}
              className="px-4 mb-4"
            >
              <TransparencyIndicator referenceId={billRefData?.reference?.id} />
            </Animated.View>

            {/* News Coverage Carousel */}
            <Animated.View entering={FadeInDown.delay(140).springify()}>
              <NewsReelCarousel billId={bill.id} />
            </Animated.View>

            {/* View Mode Tabs */}
            <Animated.View
              entering={FadeInDown.delay(150).springify()}
              className="px-4 mb-4"
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
              >
                <ViewModeButton
                  mode="simplified"
                  label="Simple"
                  isActive={viewMode === 'simplified'}
                  onPress={() => setViewMode('simplified')}
                  iconType="simplified"
                />
                <ViewModeButton
                  mode="full"
                  label="Full Text"
                  isActive={viewMode === 'full'}
                  onPress={() => setViewMode('full')}
                  iconType="full"
                />
                <ViewModeButton
                  mode="impact"
                  label="Impact"
                  isActive={viewMode === 'impact'}
                  onPress={() => setViewMode('impact')}
                  iconType="impact"
                />
                <ViewModeButton
                  mode="related"
                  label="Related"
                  isActive={viewMode === 'related'}
                  onPress={() => setViewMode('related')}
                  iconType="related"
                />
              </ScrollView>
            </Animated.View>

            {/* Content */}
            <Animated.View
              entering={FadeIn.delay(200)}
              key={viewMode}
              className="px-4"
            >
              {viewMode === 'simplified' && (
                <View>
                  {/* Citizen's Brief */}
                  <CitizensBriefCard
                  state={citizenBrief.state}
                  brief={citizenBrief.brief}
                  reason={citizenBrief.reason}
                  isRequesting={citizenBrief.isRequesting}
                  onRequest={citizenBrief.request}
                  onRewrite={citizenBrief.brief ? citizenBrief.rewrite : undefined}
                  emptyDescription={"A plain-English summary of this bill, written only from its complete official text — plus the case for it and the case against it"}
                  sourceUrl={bill.congressUrl}
                  sourceLabel={'Read the full text on Congress.gov'}
                />
                </View>
              )}

              {viewMode === 'full' && (
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center mb-3">
                    <FileText size={20} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Full Legislative Text
                    </Text>
                  </View>
                  <Text className="text-slate-300 leading-6 font-mono text-sm">
                    {bill.fullText}
                  </Text>
                </View>
              )}

              {viewMode === 'impact' && (
                <AIImpactSection bill={bill} />
              )}

              {viewMode === 'related' && (
                <View>
                  <View className="flex-row items-center mb-3">
                    <Scale size={20} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Related Laws
                    </Text>
                  </View>

                  {bill.relatedLaws.map((law, index) => (
                    <Animated.View
                      key={law.id}
                      entering={FadeInDown.delay(index * 80).springify()}
                      className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-3"
                    >
                      <View className="flex-row items-start">
                        <View className="flex-1">
                          <View className="flex-row items-center mb-2">
                            <View className="bg-amber-500/20 px-2 py-0.5 rounded-full mr-2">
                              <Text className="text-amber-500 text-xs font-medium">
                                {relationshipLabels[law.relationship]}
                              </Text>
                            </View>
                            <View className="bg-slate-700 px-2 py-0.5 rounded-full">
                              <Text className="text-slate-300 text-xs">
                                {lawTypeLabels[law.type]}
                              </Text>
                            </View>
                          </View>

                          <Text className="text-white font-semibold mb-1">
                            {law.title}
                          </Text>
                          <Text className="text-slate-400 text-sm leading-5">
                            {law.summary}
                          </Text>
                        </View>
                        <View className="ml-2">
                          <ExternalLink size={18} color="#64748B" />
                        </View>
                      </View>
                    </Animated.View>
                  ))}

                  {bill.relatedLaws.length === 0 && (
                    <View className="bg-slate-800/40 rounded-xl p-8 items-center border border-slate-700/30">
                      <Scale size={40} color="#64748B" />
                      <Text className="text-slate-400 text-lg mt-4">
                        No related laws
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Animated.View>
          </ScrollView>

          {/* Fixed Vote Buttons */}
          <View className="absolute bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4">
            <SafeAreaView edges={['bottom']}>
              <View className="flex-row">
                <AnimatedPressable
                  onPress={() => handleVote('yea')}
                  style={yeaAnimStyle}
                  className={cn(
                    'flex-1 flex-row items-center justify-center py-4 rounded-xl mr-2',
                    userVote === 'yea' ? 'bg-emerald-600' : 'bg-emerald-900/60'
                  )}
                >
                  <ThumbsUp
                    size={22}
                    color={userVote === 'yea' ? '#fff' : '#22C55E'}
                  />
                  <Text
                    className={cn(
                      'ml-2 font-bold text-lg',
                      userVote === 'yea' ? 'text-white' : 'text-emerald-500'
                    )}
                  >
                    Vote Yea
                  </Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={() => handleVote('nay')}
                  style={nayAnimStyle}
                  className={cn(
                    'flex-1 flex-row items-center justify-center py-4 rounded-xl ml-2',
                    userVote === 'nay' ? 'bg-red-600' : 'bg-red-900/60'
                  )}
                >
                  <ThumbsDown
                    size={22}
                    color={userVote === 'nay' ? '#fff' : '#EF4444'}
                  />
                  <Text
                    className={cn(
                      'ml-2 font-bold text-lg',
                      userVote === 'nay' ? 'text-white' : 'text-red-500'
                    )}
                  >
                    Vote Nay
                  </Text>
                </AnimatedPressable>
              </View>
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </View>
    </>
  );
}
