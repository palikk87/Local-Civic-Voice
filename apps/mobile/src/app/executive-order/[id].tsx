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
  RotateCcw,
  Calendar,
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
import { categoryColors, categoryLabels } from '@/lib/mock-data';
import { shareMessage } from '@/lib/config';
import { useVotingStore, selectUserVote } from '@/lib/voting-store';
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from '@/lib/reference-votes';
import { cn } from '@/lib/cn';
import type { ExecutiveOrder } from '@/lib/types';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';
import { CitizensBriefCard } from '@/components/CitizensBrief';
import {
  useGovernmentReference,
  referenceToExecutiveOrder,
} from '@/lib/api/references';
import { useCitizenBrief } from '@/lib/use-citizen-brief';
import { PulseBar } from '@/components/PulseBar';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type ViewMode = 'brief' | 'full' | 'impact';

function ViewModeButton({
  label,
  isActive,
  onPress,
  iconType,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  iconType: 'brief' | 'full' | 'impact';
}) {
  const iconColor = isActive ? '#0C1D18' : '#F59E0B';

  const renderIcon = () => {
    switch (iconType) {
      case 'brief':
        return <Sparkles size={16} color={iconColor} />;
      case 'full':
        return <FileText size={16} color={iconColor} />;
      case 'impact':
        return <Users size={16} color={iconColor} />;
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

function StatusBadge({ status }: { status: ExecutiveOrder['status'] }) {
  const statusConfig = {
    active: { color: '#22C55E', bgColor: 'bg-emerald-900/50', label: 'Active', Icon: CheckCircle },
    revoked: { color: '#EF4444', bgColor: 'bg-red-900/50', label: 'Revoked', Icon: XCircle },
    superseded: { color: '#F59E0B', bgColor: 'bg-amber-900/50', label: 'Superseded', Icon: RotateCcw },
    expired: { color: '#6E8A7C', bgColor: 'bg-slate-700', label: 'Expired', Icon: Clock },
    partially_revoked: { color: '#F97316', bgColor: 'bg-orange-900/50', label: 'Partially Revoked', Icon: AlertCircle },
  };

  const config = statusConfig[status];
  const IconComponent = config.Icon;

  return (
    <View className={cn('flex-row items-center px-3 py-1.5 rounded-full', config.bgColor)}>
      <IconComponent size={14} color={config.color} />
      <Text className="ml-1.5 font-medium text-sm" style={{ color: config.color }}>
        {config.label}
      </Text>
    </View>
  );
}

export default function ExecutiveOrderDetailScreen() {
  const requireAuth = useRequireAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('brief');

  // Every order comes from GET /api/government-references/:id.
  //
  // This used to check a hardcoded array first and pass `enabled: !staticEo`
  // into the query — so for any id in that array the real fetch never ran and
  // the screen rendered invented content. Removing the import alone would not
  // have fixed it; the gate had to go too.
  const { data: refData, isLoading: refLoading, isError, refetch } = useGovernmentReference(id);
  const eo =
    refData?.reference?.referenceType === 'executive_order'
      ? referenceToExecutiveOrder(refData.reference)
      : undefined;
  const userVote = useVotingStore(selectUserVote(id ?? ''));
  // Brief stored on the master reference — written once, read by everyone after.
  // Asked for, never automatic. Writing a brief means reading the whole
  // document, so it is a choice the reader makes rather than a cost of
  // opening the screen.
  const citizenBrief = useCitizenBrief(refData?.reference?.id, {
    initialBrief: refData?.reference?.citizenBriefSections ?? null,
    initialState: refData?.reference?.briefState ?? 'idle',
  });

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
        <Text className="text-slate-400 text-base">Loading executive order...</Text>
      </View>
    );
  }

  // A failed request is not a missing order.
  if (isError) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center px-6">
        <AlertCircle size={48} color="#EF4444" />
        <Text className="text-white text-lg mt-4 text-center">
          Couldn&apos;t load this executive order
        </Text>
        <Text className="text-slate-400 text-sm mt-2 text-center">
          Check your connection and try again.
        </Text>
        <Pressable onPress={() => refetch()} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl">
          <Text className="text-white">Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (!eo) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <Text className="text-white text-lg mt-4">Executive Order not found</Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-4 bg-slate-800 px-6 py-3 rounded-xl"
        >
          <Text className="text-white">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const categoryColor = categoryColors[eo.category] ?? '#6E8A7C';
  const yeaPercentage = Math.round(
    (eo.communityVotes.yea / (eo.communityVotes.totalVoters || 1)) * 100
  );
  const nayPercentage = eo.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: 'yea' | 'nay') => {
    if (!requireAuth('Sign in to cast your vote on this executive order.')) return;

    const scale = vote === 'yea' ? yeaScale : nayScale;
    scale.value = withSequence(
      withSpring(1.15, { damping: 4 }),
      withSpring(1, { damping: 6 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // One central vote per citizen per law, same record every surface uses.
    void castReferenceVote(eo.id, yeaNayToPosition(vote)).catch(() => {
      Alert.alert('Vote not recorded', 'Could not record your vote. Please try again.', [
        { text: 'OK' },
      ]);
    });
  };

  const handleBookmark = () => {
    if (!requireAuth('Sign in to save executive orders to your library.')) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth('Sign in to share this executive order.')) return;

    try {
      await Share.share({
        message: shareMessage(eo.title, `/reference/${eo.id}`),
      });
    } catch (error) {
      console.log('Error sharing:', error);
    }
  };

  const handleOpenFederalRegister = () => {
    if (eo.federalRegisterUrl) {
      Linking.openURL(eo.federalRegisterUrl);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
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

            <View className="flex-row items-center">
              <View className="bg-amber-500/20 px-3 py-1 rounded-full mr-2">
                <Text className="text-amber-500 text-sm font-semibold">Executive Order</Text>
              </View>
            </View>

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
            {/* EO Header */}
            <Animated.View
              entering={FadeInDown.springify()}
              className="px-4 py-4"
            >
              <View className="flex-row items-center flex-wrap mb-3">
                <View className="bg-amber-500/20 px-3 py-1 rounded-full mr-2 mb-2">
                  <Text className="text-amber-500 text-sm font-semibold">
                    {eo.eoNumber}
                  </Text>
                </View>
                <View
                  className="px-3 py-1 rounded-full mr-2 mb-2"
                  style={{ backgroundColor: `${categoryColor}30` }}
                >
                  <Text style={{ color: categoryColor }} className="text-sm font-medium">
                    {categoryLabels[eo.category]}
                  </Text>
                </View>
                <View className="mb-2">
                  <StatusBadge status={eo.status} />
                </View>
              </View>

              <Text className="text-white font-bold text-2xl mb-2">
                {eo.shortTitle}
              </Text>
              <Text className="text-slate-400 text-base leading-6">
                {eo.title}
              </Text>

              {/* President Info */}
              <View className="flex-row items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
                <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center">
                  <FileText size={20} color="#F59E0B" />
                </View>
                <View className="ml-3 flex-1">
                  <Text className="text-white font-medium">
                    Signed by {eo.president}
                  </Text>
                  <Text className="text-slate-400 text-sm">
                    President of the United States
                  </Text>
                </View>
              </View>

              {/* Dates */}
              <View className="flex-row mt-3 flex-wrap">
                <View className="flex-row items-center mr-4 mb-2">
                  <Calendar size={14} color="#6E8A7C" />
                  <Text className="text-slate-400 text-sm ml-1.5">
                    Signed {new Date(eo.signedDate).toLocaleDateString()}
                  </Text>
                </View>
                {eo.publishedDate && (
                  <View className="flex-row items-center mb-2">
                    <Clock size={14} color="#6E8A7C" />
                    <Text className="text-slate-400 text-sm ml-1.5">
                      Published {new Date(eo.publishedDate).toLocaleDateString()}
                    </Text>
                  </View>
                )}
              </View>

              {/* Federal Register Link */}
              {eo.federalRegisterUrl && (
                <Pressable
                  onPress={handleOpenFederalRegister}
                  className="flex-row items-center mt-3 bg-blue-900/30 px-4 py-2.5 rounded-xl border border-blue-700/30"
                >
                  <ExternalLink size={16} color="#3B82F6" />
                  <Text className="text-blue-400 font-medium ml-2 flex-1">
                    View on Federal Register
                  </Text>
                  <Text className="text-blue-500 text-xs">
                    {eo.federalRegisterNumber}
                  </Text>
                </Pressable>
              )}

              {/* Revoked By Info */}
              {eo.revokedBy && (
                <View className="mt-3 bg-red-900/20 px-4 py-3 rounded-xl border border-red-700/30">
                  <View className="flex-row items-center">
                    <XCircle size={16} color="#EF4444" />
                    <Text className="text-red-400 font-medium ml-2">
                      Revoked by {eo.revokedBy}
                    </Text>
                  </View>
                </View>
              )}
            </Animated.View>

            {/* Community Vote Stats */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              className="px-4 mb-4"
            >
              <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-white font-semibold">Community Opinion</Text>
                  <Text className="text-slate-400 text-sm">
                    {eo.communityVotes.totalVoters.toLocaleString()} votes
                  </Text>
                </View>

                <PulseBar yea={eo.communityVotes.yea} nay={eo.communityVotes.nay} className="mb-3" />

                <View className="flex-row justify-between">
                  <View className="flex-row items-center">
                    <ThumbsUp size={16} color="#22C55E" />
                    <Text className="text-emerald-500 font-semibold ml-1.5">
                      {yeaPercentage}% Aye
                    </Text>
                    <Text className="text-slate-500 text-sm ml-1">
                      ({eo.communityVotes.yea.toLocaleString()})
                    </Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-slate-500 text-sm mr-1">
                      ({eo.communityVotes.nay.toLocaleString()})
                    </Text>
                    <Text className="text-red-500 font-semibold mr-1.5">
                      {nayPercentage}% Nay
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
                  label="Citizen's Brief"
                  isActive={viewMode === 'brief'}
                  onPress={() => setViewMode('brief')}
                  iconType="brief"
                />
                <ViewModeButton
                  label="Full Text"
                  isActive={viewMode === 'full'}
                  onPress={() => setViewMode('full')}
                  iconType="full"
                />
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
                  state={citizenBrief.state}
                  brief={citizenBrief.brief}
                  reason={citizenBrief.reason}
                  isRequesting={citizenBrief.isRequesting}
                  onRequest={citizenBrief.request}
                  onRewrite={citizenBrief.brief ? citizenBrief.rewrite : undefined}
                  emptyDescription={"A plain-English summary of this order, written only from its complete official text — plus the case for it and the case against it"}
                  sourceUrl={eo.federalRegisterUrl}
                  sourceLabel={'Read the full text on the Federal Register'}
                />
              )}

              {viewMode === 'full' && (
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center mb-3">
                    <FileText size={20} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Full Executive Order Text
                    </Text>
                  </View>
                  <Text className="text-slate-300 leading-6 font-mono text-sm">
                    {eo.fullText}
                  </Text>
                </View>
              )}

              {viewMode === 'impact' && (
                <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                  <View className="flex-row items-center mb-3">
                    <Users size={20} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Real-World Impact
                    </Text>
                  </View>
                  <Text className="text-slate-300 leading-6">
                    {eo.realWorldImpact}
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
    </>
  );
}
