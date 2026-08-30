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
import { shareMessage } from '@/lib/config';
import { useVotingStore, selectUserVote } from '@/lib/voting-store';
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from '@/lib/reference-votes';
import { cn } from '@/lib/cn';
import { IntegrityAuditPanel } from '@/components/IntegrityAuditPanel';
import {
  generateBillExplanation,
  askAboutBill,
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
import { PulseBar } from '@/components/PulseBar';
import CreatePostModal from '@/components/CreatePostModal';

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


/**
 * What this law does, from the official summary. One block, not three.
 *
 * WHAT WAS HERE. A reader could get the case for and against the same bill
 * THREE times, from three different generations, on one screen:
 *
 *   1. the Citizen's Brief tab — argumentFor / argumentAgainst, written on the
 *      server from the COMPLETE official text, stored on the record, one per
 *      version of the law, the same text for everybody;
 *   2. "AI Analysis" here — pros / cons, generated on the device from
 *      `bill.fullText.substring(0, 3000)`. The first three thousand characters
 *      of a bill are its title, its findings and its definitions; the operative
 *      provisions are further down. So the concerns were drawn from a fragment
 *      that mostly does not contain the law;
 *   3. "See Both Sides" here — arguments generated from `bill.simplifiedText`,
 *      which is the brief's own summary. Arguments about a summary, twice
 *      removed from the text they claim to describe.
 *
 * Both of the deleted ones ran at temperature 1, per reader, cached for thirty
 * minutes on that device and nowhere else. Two people looking at the same bill
 * got different concerns about it; one person looking twice in a day got
 * different concerns from themselves. On a platform whose claim is that its
 * records are the true ones, three disagreeing answers to "what does this do"
 * is worse than one — and the one that survives is the one that read the whole
 * law, is stored where everybody reads the same copy, and is paid for once.
 *
 * The official summary stays, under a label that says what it is. It was called
 * "Real-World Impact", which is a promise of analysis; it is the description
 * congress.gov publishes. Web twin: apps/web/src/pages/BillDetail.tsx.
 */
function OfficialSummarySection({ bill }: { bill: Bill }) {
  if (!bill.realWorldImpact?.trim()) {
    return (
      <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
        <Text className="text-slate-400">
          No official summary has been published for this one yet.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
      <View className="flex-row items-center mb-3">
        <Users size={20} color="#F59E0B" />
        <Text className="text-white font-semibold text-lg ml-2">Official summary</Text>
      </View>
      <Text className="text-slate-300 leading-6">{bill.realWorldImpact}</Text>
      <Text className="text-slate-500 text-xs mt-3">
        Published by the official source. For the case for and against, see the Citizen's
        Brief — written once from the complete text, and the same for every reader.
      </Text>
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
  const iconColor = isActive ? '#0C1D18' : '#F59E0B';

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
      // No fallback sentence. This used to assert a real-world effect whenever
      // the sharer had written nothing — a claim true of every law and
      // therefore about none of them. Empty renders nothing, which is what we
      // actually know.
      realWorldImpact: libraryPost.opinion ?? '',
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

  /**
   * SHARING THIS LAW TO YOUR OWN TIMELINE — the thing this screen could not do.
   *
   * The only share here was the Share2 icon in the header, which opens the
   * operating system's sheet. That sends the law OUT of AYE & NAY, to a person,
   * in another app. It is a good thing to have and it stays; it is not the same
   * act as saying "this one matters to me" where the people who can answer will
   * see it.
   *
   * Web parity: the record page's "Share to your timeline" button. Same
   * behaviour on both — it opens the composer with the law already attached and
   * waits. It does not post for you. The words are the reader's.
   */
  const [shareToTimeline, setShareToTimeline] = useState(false);

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

  const categoryColor = categoryColors[bill.category] ?? '#6E8A7C';
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
        message: shareMessage(bill.title, `/reference/${bill.id}`),
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
          colors={['#0C1D18', '#17362A', '#0C1D18']}
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
                <Bookmark size={20} color="#6E8A7C" />
              </Pressable>
              <Pressable
                onPress={handleShare}
                className="bg-slate-800 p-2 rounded-full"
              >
                <Share2 size={20} color="#6E8A7C" />
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

              {/*
                SPONSOR — a member, or nothing at all.

                This block rendered unconditionally and the mapper always
                supplied a sponsor, so every bill showed "Sponsored by U.S.
                House of Representatives / Independent - US" with a broken
                avatar. Bills are sponsored by a person; congress.gov names
                them, and until the provenance pass reaches this record the
                field is absent and the block does not render.
              */}
              {bill.sponsor ? (
                <View className="flex-row items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                  {bill.sponsor.imageUrl ? (
                    <Image
                      source={{ uri: bill.sponsor.imageUrl }}
                      className="w-10 h-10 rounded-full"
                    />
                  ) : null}
                  <View className="ml-3 flex-1">
                    <Text className="text-white font-medium">
                      Sponsored by {bill.sponsor.name}
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      {bill.sponsor.party === 'D'
                        ? 'Democrat'
                        : bill.sponsor.party === 'R'
                        ? 'Republican'
                        : 'Independent'}
                      {bill.sponsor.state ? ` — ${bill.sponsor.state}` : ''}
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
              ) : null}

              {/*
                DATES — from congress.gov, or absent.

                Both used to be `ref.createdAt`, the moment our own row was
                written, so a statute from 2007 read "Introduced today".
              */}
              {bill.introducedDate || bill.lastActionDate ? (
                <View className="flex-row mt-3">
                  {bill.introducedDate ? (
                    <View className="flex-row items-center mr-4">
                      <Clock size={14} color="#6E8A7C" />
                      <Text className="text-slate-400 text-sm ml-1.5">
                        Introduced {new Date(bill.introducedDate).toLocaleDateString()}
                      </Text>
                    </View>
                  ) : null}
                  {bill.lastActionDate ? (
                    <View className="flex-row items-center">
                      <Building2 size={14} color="#6E8A7C" />
                      <Text className="text-slate-400 text-sm ml-1.5">
                        Last action {new Date(bill.lastActionDate).toLocaleDateString()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
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

                <PulseBar yea={bill.communityVotes.yea} nay={bill.communityVotes.nay} className="mb-3" />

                <View className="flex-row justify-between">
                  <View className="flex-row items-center">
                    <ThumbsUp size={16} color="#22C55E" />
                    <Text className="text-emerald-500 font-semibold ml-1.5">
                      {yeaPercentage}% Aye
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

                {/* THE PROJECTION IS GONE, AND NOT REPLACED.
                    It read `votes.support > votes.oppose ? 'Likely to Pass'`
                    — our own readers' opinions relabelled as a forecast of
                    Congress. The official vote below is a real recorded fact
                    and stays. See packages/civic-core/src/types.ts. */}
                {bill.officialVotes ? (
                  <View className="flex-row items-center justify-end mt-4 pt-4 border-t border-slate-700/50">
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
                  </View>
                ) : null}
              </View>
            </Animated.View>

            {/* Representation Gap. The guard is the null, not a field check. */}
            {(() => {
              const gap = calculateRepresentationGap(bill);
              return gap ? (
                <Animated.View
                  entering={FadeInDown.delay(125).springify()}
                  className="px-4 mb-4"
                >
                  <PulseGap gap={gap} compact />
                </Animated.View>
              ) : null;
            })()}

            {/* Share to your own timeline. Filled and full width, because an
                action has to look different from the facts printed around it —
                the same lesson the web record page learned when its share
                control was rendering as grey 12px text between two counts and
                the owner of the product could not find it. */}
            <Animated.View
              entering={FadeInDown.delay(125).springify()}
              className="px-4 mb-4"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Share ${bill.title} to your timeline`}
                onPress={() => {
                  if (!requireAuth('Sign in to share this law.')) return;
                  if (!billRefData?.reference?.id) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShareToTimeline(true);
                }}
                disabled={!billRefData?.reference?.id}
                className={cn(
                  'flex-row items-center justify-center py-4 rounded-xl',
                  billRefData?.reference?.id ? 'bg-amber-500' : 'bg-amber-500/50'
                )}
              >
                <Share2 size={18} color="#0F172A" />
                <Text className="text-slate-900 font-bold text-base ml-2">
                  Share to my timeline
                </Text>
              </Pressable>
              <Text className="text-slate-500 text-xs text-center mt-2">
                {billRefData?.reference?.id
                  ? 'Opens the composer with this law attached. The words are yours.'
                  : 'Identifying this document at its official source…'}
              </Text>
            </Animated.View>

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

              {/* ARTICLE III §2. The tally above is the platform's claim; this
                  is where anybody can make it prove itself. */}
              {billRefData?.reference?.id ? (
                <IntegrityAuditPanel
                  subjectType="reference"
                  subjectId={billRefData.reference.id}
                  title="Integrity Audit of this vote"
                  what="the votes on this record, as totals and timings"
                />
              ) : null}
            </Animated.View>

            {/* Vote Transparency - Article III Compliance */}
            <Animated.View
              entering={FadeInDown.delay(130).springify()}
              className="px-4 mb-4"
            >
              <TransparencyIndicator referenceId={billRefData?.reference?.id} />
            </Animated.View>

            {/*
              THE NEWS CAROUSEL WAS INVENTED, so it is gone.

              It read `mockNewsReels` — a hand-written list of made-up clips
              with fake video URLs, fake outlets and fake durations — filtered
              by bill id. Every real record's id is a cuid and every mock reel's
              is "bill-1", so in practice it drew nothing; the only way it could
              ever draw something was by showing a citizen news coverage that
              does not exist, attributed to real outlets, on a page about a real
              law. The web twin carried the same component and was deleted with
              the screen it sat on.

              Real coverage would need a real source. When there is one, it can
              come back.
            */}

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
                  label="Citizen's Brief"
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
                <OfficialSummarySection bill={bill} />
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
                          <ExternalLink size={18} color="#6E8A7C" />
                        </View>
                      </View>
                    </Animated.View>
                  ))}

                  {bill.relatedLaws.length === 0 && (
                    <View className="bg-slate-800/40 rounded-xl p-8 items-center border border-slate-700/30">
                      <Scale size={40} color="#6E8A7C" />
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
                    userVote === 'yea' ? 'bg-emerald-400' : 'bg-emerald-400/20 border border-emerald-400/70'
                  )}
                >
                  <ThumbsUp
                    size={22}
                    color={userVote === 'yea' ? '#052E1B' : '#6EE7A8'}
                  />
                  <Text
                    className={cn(
                      'ml-2 font-bold text-lg',
                      userVote === 'yea' ? 'text-emerald-950' : 'text-emerald-300'
                    )}
                  >
                    Aye
                  </Text>
                </AnimatedPressable>

                <AnimatedPressable
                  onPress={() => handleVote('nay')}
                  style={nayAnimStyle}
                  className={cn(
                    'flex-1 flex-row items-center justify-center py-4 rounded-xl ml-2',
                    userVote === 'nay' ? 'bg-rose-900 border-2 border-rose-400' : 'bg-rose-950/70 border border-rose-700'
                  )}
                >
                  <ThumbsDown
                    size={22}
                    color={userVote === 'nay' ? '#FFE4E6' : '#FDA4AF'}
                  />
                  <Text
                    className={cn(
                      'ml-2 font-bold text-lg',
                      userVote === 'nay' ? 'text-rose-50' : 'text-rose-300'
                    )}
                  >
                    Nay
                  </Text>
                </AnimatedPressable>
              </View>
            </SafeAreaView>
          </View>
        </SafeAreaView>
      </View>

      {/* The composer, with the law already attached and nothing written.
          Same modal the Library sheet opens, so a law shared from either place
          reaches the same screen in the same state. */}
      {billRefData?.reference?.id ? (
        <CreatePostModal
          visible={shareToTimeline}
          onClose={() => setShareToTimeline(false)}
          shareMode={{
            type: 'bill',
            id: billRefData.reference.id,
            title: bill.title,
          }}
        />
      ) : null}
    </>
  );
}
