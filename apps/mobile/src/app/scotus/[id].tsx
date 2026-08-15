import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Share,
  Linking,
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
  Users,
  Clock,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Scale,
  Calendar,
  Gavel,
  HelpCircle,
  Sparkles,
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
import { justices } from '@/lib/government-data';
import { categoryColors, categoryLabels } from '@/lib/mock-data';
import { useVotingStore, selectUserVote } from '@/lib/voting-store';
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from '@/lib/reference-votes';
import { cn } from '@/lib/cn';
import type { SupremeCourtCase, JusticeVote } from '@/lib/types';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';
import { CitizensBriefCard } from '@/components/CitizensBrief';
import {
  useGovernmentReference,
  useReferenceBriefProps,
  referenceToScotusCase,
} from '@/lib/api/references';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ViewMode = 'brief' | 'question' | 'opinion' | 'impact';

function ViewModeButton({
  label,
  isActive,
  onPress,
  iconType,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  iconType: 'brief' | 'question' | 'opinion' | 'impact';
}) {
  const iconColor = isActive ? '#0F172A' : '#8B5CF6';

  const renderIcon = () => {
    switch (iconType) {
      case 'brief':
        return <Sparkles size={16} color={iconColor} />;
      case 'question':
        return <HelpCircle size={16} color={iconColor} />;
      case 'opinion':
        return <Gavel size={16} color={iconColor} />;
      case 'impact':
        return <Users size={16} color={iconColor} />;
    }
  };

  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'flex-row items-center px-4 py-2.5 rounded-xl mr-2',
        isActive ? 'bg-purple-500' : 'bg-slate-800'
      )}
    >
      {renderIcon()}
      <Text
        className={cn(
          'ml-2 font-medium',
          isActive ? 'text-white' : 'text-slate-300'
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CaseStatusBadge({ status, outcome }: { status: SupremeCourtCase['status']; outcome?: SupremeCourtCase['outcome'] }) {
  const statusConfig = {
    pending: { color: '#F59E0B', bgColor: 'bg-amber-900/50', label: 'Pending' },
    argued: { color: '#3B82F6', bgColor: 'bg-blue-900/50', label: 'Argued' },
    decided: { color: '#22C55E', bgColor: 'bg-emerald-900/50', label: 'Decided' },
    dismissed: { color: '#64748B', bgColor: 'bg-slate-700', label: 'Dismissed' },
    remanded: { color: '#8B5CF6', bgColor: 'bg-purple-900/50', label: 'Remanded' },
  };

  const outcomeLabels: Record<string, string> = {
    affirmed: 'Affirmed',
    reversed: 'Reversed',
    vacated: 'Vacated',
    remanded: 'Remanded',
    dismissed: 'Dismissed',
    per_curiam: 'Per Curiam',
  };

  const config = statusConfig[status];

  return (
    <View className="flex-row items-center">
      <View className={cn('flex-row items-center px-3 py-1.5 rounded-full', config.bgColor)}>
        {status === 'decided' ? (
          <CheckCircle size={14} color={config.color} />
        ) : status === 'argued' ? (
          <Gavel size={14} color={config.color} />
        ) : (
          <Clock size={14} color={config.color} />
        )}
        <Text className="ml-1.5 font-medium text-sm" style={{ color: config.color }}>
          {config.label}
        </Text>
      </View>
      {outcome && (
        <View className="bg-slate-700 px-3 py-1.5 rounded-full ml-2">
          <Text className="text-slate-300 text-sm font-medium">
            {outcomeLabels[outcome]}
          </Text>
        </View>
      )}
    </View>
  );
}

function JusticeVoteCard({ vote }: { vote: JusticeVote }) {
  const justice = justices.find(j => j.name.includes(vote.justiceName));

  const voteColors: Record<string, { bg: string; text: string; label: string }> = {
    majority: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', label: 'Majority' },
    dissent: { bg: 'bg-red-900/50', text: 'text-red-400', label: 'Dissent' },
    concurrence: { bg: 'bg-blue-900/50', text: 'text-blue-400', label: 'Concur' },
    concur_in_part: { bg: 'bg-purple-900/50', text: 'text-purple-400', label: 'Concur in Part' },
  };

  const voteStyle = voteColors[vote.vote] || voteColors.majority;

  return (
    <View className="flex-row items-center justify-between py-2 border-b border-slate-700/30 last:border-b-0">
      <View className="flex-row items-center flex-1">
        <View className={cn(
          'w-8 h-8 rounded-full items-center justify-center mr-2',
          justice?.ideology === 'conservative' ? 'bg-red-900/30' : 'bg-blue-900/30'
        )}>
          <Text className={cn(
            'text-xs font-bold',
            justice?.ideology === 'conservative' ? 'text-red-400' : 'text-blue-400'
          )}>
            {vote.justiceName.charAt(0)}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-white font-medium text-sm">{vote.justiceName}</Text>
          {vote.wroteOpinion && (
            <Text className="text-slate-400 text-xs">Wrote opinion</Text>
          )}
        </View>
      </View>
      <View className={cn('px-2 py-1 rounded-full', voteStyle.bg)}>
        <Text className={cn('text-xs font-medium', voteStyle.text)}>
          {voteStyle.label}
        </Text>
      </View>
    </View>
  );
}

export default function SupremeCourtDetailScreen() {
  const requireAuth = useRequireAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('brief');

  // Static landmark cases resolve locally; daily-synced cases come from the backend.
  // Every case comes from GET /api/government-references/:id. The hardcoded
  // array that used to be checked first also gated this query via
  // `enabled: !staticCase`, so for those ids the real fetch never ran.
  const { data: refData, isLoading: refLoading, isError, refetch } = useGovernmentReference(id);
  const scotusCase =
    refData?.reference?.referenceType === 'scotus_case'
      ? referenceToScotusCase(refData.reference)
      : undefined;
  const userVote = useVotingStore(selectUserVote(id ?? ''));
  // Brief stored on the master reference — written once, read by everyone after.
  const briefProps = useReferenceBriefProps(id, refData?.reference);

  // Mirror the server's record of my vote so every card for this law agrees.
  const serverUserVote = refData?.reference?.userVote;
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

  if (refLoading) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <Text className="text-slate-400 text-base">Loading case...</Text>
      </View>
    );
  }

  // A failed request is not a missing case.
  if (isError) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center px-6">
        <AlertCircle size={48} color="#EF4444" />
        <Text className="text-white text-lg mt-4 text-center">Couldn&apos;t load this case</Text>
        <Text className="text-slate-400 text-sm mt-2 text-center">
          Check your connection and try again.
        </Text>
        <Pressable onPress={() => refetch()} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl">
          <Text className="text-white">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!scotusCase) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <Text className="text-white text-lg mt-4">Case not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 bg-slate-800 px-6 py-3 rounded-xl"
        >
          <Text className="text-white">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const categoryColor = categoryColors[scotusCase.category] ?? '#64748B';
  const yeaPercentage = Math.round(
    (scotusCase.communityVotes.yea / (scotusCase.communityVotes.totalVoters || 1)) * 100
  );
  const nayPercentage = scotusCase.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: 'yea' | 'nay') => {
    if (!requireAuth('Sign in to cast your vote on this case.')) return;

    const scale = vote === 'yea' ? yeaScale : nayScale;
    scale.value = withSequence(
      withSpring(1.15, { damping: 4 }),
      withSpring(1, { damping: 6 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // One central vote per citizen per law, same record every surface uses.
    void castReferenceVote(scotusCase.id, yeaNayToPosition(vote)).catch(() => {
      Alert.alert('Vote not recorded', 'Could not record your vote. Please try again.', [
        { text: 'OK' },
      ]);
    });
  };

  const handleBookmark = () => {
    if (!requireAuth('Sign in to save cases to your library.')) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth('Sign in to share this case.')) return;

    try {
      await Share.share({
        message: `Check out this Supreme Court case: ${scotusCase.caseName}\n\nVote on Civic Voice!`,
      });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const handleOpenCourtListener = () => {
    if (scotusCase.courtListenerUrl) {
      Linking.openURL(scotusCase.courtListenerUrl);
    }
  };

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
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={() => router.back()}
              className="bg-slate-800 p-2 rounded-full"
            >
              <ArrowLeft size={22} color="#fff" />
            </Pressable>

            <View className="flex-row items-center">
              <View className="bg-purple-500/20 px-3 py-1 rounded-full mr-2">
                <Text className="text-purple-400 text-sm font-semibold">Supreme Court</Text>
              </View>
            </View>

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
            {/* Case Header */}
            <Animated.View
              entering={FadeInDown.springify()}
              className="px-4 py-4"
            >
              <View className="flex-row items-center flex-wrap mb-3">
                <View className="bg-purple-500/20 px-3 py-1 rounded-full mr-2 mb-2">
                  <Text className="text-purple-400 text-sm font-semibold">
                    {scotusCase.docketNumber}
                  </Text>
                </View>
                <View
                  className="px-3 py-1 rounded-full mr-2 mb-2"
                  style={{ backgroundColor: `${categoryColor}30` }}
                >
                  <Text style={{ color: categoryColor }} className="text-sm font-medium">
                    {categoryLabels[scotusCase.category]}
                  </Text>
                </View>
                <View className="mb-2">
                  <CaseStatusBadge status={scotusCase.status} outcome={scotusCase.outcome} />
                </View>
              </View>

              <Text className="text-white font-bold text-2xl mb-2">
                {scotusCase.shortName}
              </Text>
              <Text className="text-slate-400 text-base leading-6">
                {scotusCase.caseName}
              </Text>

              {/* Court Info */}
              <View className="flex-row items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <View className="w-10 h-10 rounded-full bg-purple-500/20 items-center justify-center">
                  <Scale size={20} color="#8B5CF6" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-medium">
                    {scotusCase.term} Term
                  </Text>
                  <Text className="text-slate-400 text-sm">
                    From {scotusCase.lowerCourt}
                  </Text>
                </View>
                {scotusCase.voteBreakdown && (
                  <View className="bg-slate-700 px-3 py-1.5 rounded-full">
                    <Text className="text-white font-bold">
                      {scotusCase.voteBreakdown.majority}-{scotusCase.voteBreakdown.dissent}
                    </Text>
                  </View>
                )}
              </View>

              {/* Dates */}
              <View className="flex-row mt-3 flex-wrap">
                {scotusCase.arguedDate && (
                  <View className="flex-row items-center mr-4 mb-2">
                    <Gavel size={14} color="#64748B" />
                    <Text className="text-slate-400 text-sm ml-1.5">
                      Argued {new Date(scotusCase.arguedDate).toLocaleDateString()}
                    </Text>
                  </View>
                )}
                {scotusCase.decidedDate && (
                  <View className="flex-row items-center mb-2">
                    <Calendar size={14} color="#64748B" />
                    <Text className="text-slate-400 text-sm ml-1.5">
                      Decided {new Date(scotusCase.decidedDate).toLocaleDateString()}
                    </Text>
                  </View>
                )}
              </View>

              {/* Parties */}
              <View className="mt-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <View className="flex-row items-center mb-2">
                  <Text className="text-slate-400 text-sm w-24">Petitioner:</Text>
                  <Text className="text-white flex-1">{scotusCase.petitioner}</Text>
                </View>
                <View className="flex-row items-center">
                  <Text className="text-slate-400 text-sm w-24">Respondent:</Text>
                  <Text className="text-white flex-1">{scotusCase.respondent}</Text>
                </View>
              </View>

              {/* CourtListener Link */}
              {scotusCase.courtListenerUrl && (
                <Pressable
                  onPress={handleOpenCourtListener}
                  className="flex-row items-center mt-3 bg-purple-900/30 px-4 py-2.5 rounded-xl border border-purple-700/30"
                >
                  <ExternalLink size={16} color="#8B5CF6" />
                  <Text className="text-purple-400 font-medium ml-2 flex-1">
                    View Full Opinion on CourtListener
                  </Text>
                </Pressable>
              )}
            </Animated.View>

            {/* Justice Votes */}
            {scotusCase.justiceVotes && scotusCase.justiceVotes.length > 0 && (
              <Animated.View
                entering={FadeInDown.delay(50).springify()}
                className="px-4 mb-4"
              >
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-white font-semibold">Justice Votes</Text>
                    {scotusCase.voteBreakdown && (
                      <View className="flex-row items-center">
                        <View className="bg-emerald-900/50 px-2 py-1 rounded-full mr-2">
                          <Text className="text-emerald-400 text-sm font-medium">
                            {scotusCase.voteBreakdown.majority} Majority
                          </Text>
                        </View>
                        <View className="bg-red-900/50 px-2 py-1 rounded-full">
                          <Text className="text-red-400 text-sm font-medium">
                            {scotusCase.voteBreakdown.dissent} Dissent
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                  {scotusCase.justiceVotes.map((vote, index) => (
                    <JusticeVoteCard key={index} vote={vote} />
                  ))}
                </View>
              </Animated.View>
            )}

            {/* Community Vote Stats */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              className="px-4 mb-4"
            >
              <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-white font-semibold">Community Opinion</Text>
                  <Text className="text-slate-400 text-sm">
                    {scotusCase.communityVotes.totalVoters.toLocaleString()} votes
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
                      {yeaPercentage}% Agree
                    </Text>
                    <Text className="text-slate-500 text-sm ml-1">
                      ({scotusCase.communityVotes.yea.toLocaleString()})
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-sm mr-1">
                      ({scotusCase.communityVotes.nay.toLocaleString()})
                    </Text>
                    <Text className="text-red-500 font-semibold mr-1.5">
                      {nayPercentage}% Disagree
                    </Text>
                    <ThumbsDown size={16} color="#EF4444" />
                  </View>
                </View>
              </View>
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
                  label="Brief"
                  isActive={viewMode === 'brief'}
                  onPress={() => setViewMode('brief')}
                  iconType="brief"
                />
                <ViewModeButton
                  label="Question"
                  isActive={viewMode === 'question'}
                  onPress={() => setViewMode('question')}
                  iconType="question"
                />
                {(scotusCase.majorityOpinion || scotusCase.dissentOpinion) && (
                  <ViewModeButton
                    label="Opinions"
                    isActive={viewMode === 'opinion'}
                    onPress={() => setViewMode('opinion')}
                    iconType="opinion"
                  />
                )}
                <ViewModeButton
                  label="Impact"
                  isActive={viewMode === 'impact'}
                  onPress={() => setViewMode('impact')}
                  iconType="impact"
                />
              </ScrollView>
            </Animated.View>

            {/* Content */}
            <Animated.View
              entering={FadeIn.delay(200)}
              key={viewMode}
              className="px-4"
            >
              {viewMode === 'brief' && (
                <CitizensBriefCard
                  initialBrief={briefProps.initialBrief}
                  serverPending={briefProps.serverPending}
                  onRefresh={briefProps.onRefresh}
                  labels={
                    briefProps.labels ?? {
                      goal: 'The Question',
                      wallet: scotusCase.status === 'decided' ? 'The Ruling' : "What's At Stake",
                    }
                  }
                  emptyDescription="A plain-English summary of this case, written from its complete official opinion"
                  loadingLabel="Reading the full opinion..."
                  sourceLabel={
                    scotusCase.courtListenerUrl ? 'View full opinion on CourtListener' : undefined
                  }
                  onOpenSource={handleOpenCourtListener}
                />
              )}

              {viewMode === 'question' && (
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center mb-3">
                    <HelpCircle size={20} color="#8B5CF6" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Question Presented
                    </Text>
                  </View>
                  <Text className="text-slate-300 leading-6 font-mono text-sm">
                    {scotusCase.questionPresented}
                  </Text>
                </View>
              )}

              {viewMode === 'opinion' && (
                <View>
                  {scotusCase.majorityOpinion && (
                    <View className="bg-emerald-900/20 rounded-xl p-4 border border-emerald-700/30 mb-4">
                      <View className="flex-row items-center mb-3">
                        <CheckCircle size={20} color="#22C55E" />
                        <Text className="text-emerald-400 font-semibold text-lg ml-2">
                          Majority Opinion
                        </Text>
                      </View>
                      <Text className="text-slate-300 leading-6">
                        {scotusCase.majorityOpinion}
                      </Text>
                    </View>
                  )}

                  {scotusCase.dissentOpinion && (
                    <View className="bg-red-900/20 rounded-xl p-4 border border-red-700/30">
                      <View className="flex-row items-center mb-3">
                        <XCircle size={20} color="#EF4444" />
                        <Text className="text-red-400 font-semibold text-lg ml-2">
                          Dissenting Opinion
                        </Text>
                      </View>
                      <Text className="text-slate-300 leading-6">
                        {scotusCase.dissentOpinion}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {viewMode === 'impact' && (
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center mb-3">
                    <Users size={20} color="#8B5CF6" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Real-World Impact
                    </Text>
                  </View>
                  <Text className="text-slate-300 leading-6">
                    {scotusCase.realWorldImpact}
                  </Text>
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
                    Agree
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
                    Disagree
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
