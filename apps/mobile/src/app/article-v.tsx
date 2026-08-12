/**
 * Article V: Self-Correction Mechanism
 *
 * This screen implements the constitutional right of users to:
 * 1. Impeach Civil Leaders who misrepresent facts or violate Code of Conduct
 * 2. Trigger a System-Wide Reset via super-majority vote (66%)
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Stack } from 'expo-router';
import {
  ChevronLeft,
  AlertTriangle,
  RotateCcw,
  UserX,
  Shield,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Gavel,
  FileText,
  AlertOctagon,
  BookOpen,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { SYSTEM_RESET_THRESHOLD, canTriggerSystemReset, type SystemResetVote } from '@/lib/constitution';
import { ArticleBadge, FoundingDocumentsLink } from '@/components/BillOfRightsBadge';
import { cn } from '@/lib/cn';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Mock data for Civil Leaders
interface CivilLeader {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  trustScore: number;
  delegatorCount: number;
  falsehoodCount: number;
  impeachmentVotes: number;
  totalEligibleVoters: number;
}

const mockCivilLeaders: CivilLeader[] = [
  {
    id: 'leader-1',
    displayName: 'Dr. Sarah Chen',
    username: 'healthpolicy_expert',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=sarah',
    trustScore: 92,
    delegatorCount: 1247,
    falsehoodCount: 0,
    impeachmentVotes: 23,
    totalEligibleVoters: 1247,
  },
  {
    id: 'leader-2',
    displayName: 'Marcus Rivera',
    username: 'greenlegislation',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=marcus',
    trustScore: 78,
    delegatorCount: 892,
    falsehoodCount: 1,
    impeachmentVotes: 156,
    totalEligibleVoters: 892,
  },
  {
    id: 'leader-3',
    displayName: 'James Park',
    username: 'techpolicy_watch',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=james',
    trustScore: 45,
    delegatorCount: 1089,
    falsehoodCount: 3,
    impeachmentVotes: 612,
    totalEligibleVoters: 1089,
  },
];

// Mock system reset vote
const mockSystemResetVote: SystemResetVote = {
  id: 'reset-2025-01',
  initiatedAt: '2025-01-15T00:00:00Z',
  reason: 'Alleged algorithmic bias in feed ranking detected by community audit',
  evidence: 'Community audit report #2025-001 showing 15% preference for certain content types',
  votesFor: 12450,
  votesAgainst: 45230,
  totalEligibleVoters: 94000,
  status: 'voting',
  expiresAt: '2025-01-22T00:00:00Z',
};

// ==========================================
// IMPEACHMENT SECTION
// ==========================================

interface LeaderCardProps {
  leader: CivilLeader;
  onVoteImpeach: (leaderId: string) => void;
  hasVoted: boolean;
}

function LeaderCard({ leader, onVoteImpeach, hasVoted }: LeaderCardProps) {
  const impeachmentPct = (leader.impeachmentVotes / leader.totalEligibleVoters) * 100;
  const isNearImpeachment = impeachmentPct >= 40;
  const isImpeached = impeachmentPct >= 50;

  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handleVote = () => {
    scale.value = withSequence(
      withSpring(0.95, { damping: 15 }),
      withSpring(1, { damping: 15 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onVoteImpeach(leader.id);
  };

  // Trust score color
  const getTrustColor = (score: number) => {
    if (score >= 80) return '#22C55E';
    if (score >= 60) return '#F59E0B';
    if (score >= 40) return '#F97316';
    return '#EF4444';
  };

  return (
    <Animated.View entering={FadeInDown.springify()}>
      <AnimatedPressable style={animStyle}>
        <View
          className={cn(
            'rounded-2xl p-4 border mb-4',
            isImpeached
              ? 'bg-red-900/30 border-red-700/50'
              : isNearImpeachment
              ? 'bg-amber-900/20 border-amber-700/40'
              : 'bg-slate-800/60 border-slate-700/50'
          )}
        >
          {/* Header */}
          <View className="flex-row items-center mb-3">
            <Image
              source={{ uri: leader.avatar }}
              className="w-12 h-12 rounded-full"
            />
            <View className="flex-1 ml-3">
              <View className="flex-row items-center">
                <Text className="text-white font-semibold text-lg">
                  {leader.displayName}
                </Text>
                {isImpeached && (
                  <View className="ml-2 bg-red-500/20 px-2 py-0.5 rounded-full">
                    <Text className="text-red-400 text-xs font-medium">Impeached</Text>
                  </View>
                )}
              </View>
              <Text className="text-slate-400 text-sm">@{leader.username}</Text>
            </View>

            {/* Trust Score */}
            <View className="items-center">
              <View
                className="w-12 h-12 rounded-full items-center justify-center"
                style={{ backgroundColor: `${getTrustColor(leader.trustScore)}20` }}
              >
                <Text
                  className="text-lg font-bold"
                  style={{ color: getTrustColor(leader.trustScore) }}
                >
                  {leader.trustScore}
                </Text>
              </View>
              <Text className="text-slate-500 text-xs mt-1">Trust</Text>
            </View>
          </View>

          {/* Stats */}
          <View className="flex-row justify-between mb-3 py-2 border-y border-slate-700/50">
            <View className="items-center">
              <Text className="text-slate-400 text-xs">Delegators</Text>
              <Text className="text-white font-semibold">{leader.delegatorCount.toLocaleString()}</Text>
            </View>
            <View className="items-center">
              <Text className="text-slate-400 text-xs">Falsehoods</Text>
              <Text
                className={cn(
                  'font-semibold',
                  leader.falsehoodCount > 0 ? 'text-red-400' : 'text-emerald-400'
                )}
              >
                {leader.falsehoodCount}
              </Text>
            </View>
            <View className="items-center">
              <Text className="text-slate-400 text-xs">Impeach Votes</Text>
              <Text className="text-amber-400 font-semibold">{leader.impeachmentVotes.toLocaleString()}</Text>
            </View>
          </View>

          {/* Impeachment Progress */}
          <View className="mb-3">
            <View className="flex-row justify-between mb-1">
              <Text className="text-slate-400 text-xs">Impeachment Progress</Text>
              <Text
                className={cn(
                  'text-xs font-medium',
                  isImpeached ? 'text-red-400' : isNearImpeachment ? 'text-amber-400' : 'text-slate-400'
                )}
              >
                {impeachmentPct.toFixed(1)}% of 50% needed
              </Text>
            </View>
            <View className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <View
                className={cn(
                  'h-full rounded-full',
                  isImpeached ? 'bg-red-500' : isNearImpeachment ? 'bg-amber-500' : 'bg-slate-500'
                )}
                style={{ width: `${Math.min(100, (impeachmentPct / 50) * 100)}%` }}
              />
            </View>
          </View>

          {/* Vote Button */}
          {!isImpeached && (
            <Pressable
              onPress={handleVote}
              disabled={hasVoted}
              className={cn(
                'rounded-xl py-3 items-center flex-row justify-center',
                hasVoted ? 'bg-slate-700/50' : 'bg-red-600/80'
              )}
            >
              {hasVoted ? (
                <>
                  <CheckCircle size={18} color="#22C55E" />
                  <Text className="text-emerald-400 font-medium ml-2">Vote Recorded</Text>
                </>
              ) : (
                <>
                  <Gavel size={18} color="#fff" />
                  <Text className="text-white font-semibold ml-2">Vote to Impeach</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

// ==========================================
// SYSTEM RESET SECTION
// ==========================================

interface SystemResetCardProps {
  vote: SystemResetVote;
  onVoteFor: () => void;
  onVoteAgainst: () => void;
  userVote: 'for' | 'against' | null;
}

function SystemResetCard({ vote, onVoteFor, onVoteAgainst, userVote }: SystemResetCardProps) {
  const totalVotes = vote.votesFor + vote.votesAgainst;
  const participation = totalVotes / vote.totalEligibleVoters;
  const approvalPct = totalVotes > 0 ? (vote.votesFor / totalVotes) * 100 : 0;
  const canTrigger = canTriggerSystemReset(vote);

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(vote.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return (
    <Animated.View entering={FadeInDown.delay(200).springify()}>
      <View className="bg-slate-800/60 rounded-2xl overflow-hidden border border-slate-700/50">
        {/* Header */}
        <LinearGradient
          colors={['#7F1D1D', '#450A0A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 16 }}
        >
          <View className="flex-row items-center mb-2">
            <AlertOctagon size={24} color="#FCA5A5" />
            <Text className="text-red-200 font-bold text-lg ml-2">
              System-Wide Reset Vote
            </Text>
          </View>
          <Text className="text-red-300/80 text-sm">
            Article V, Section 2: Platform Neutrality
          </Text>
        </LinearGradient>

        <View className="p-4">
          {/* Reason */}
          <View className="mb-4">
            <Text className="text-slate-400 text-xs font-semibold tracking-wider mb-1">
              REASON FOR RESET
            </Text>
            <Text className="text-white leading-5">{vote.reason}</Text>
          </View>

          {/* Evidence */}
          <View className="mb-4 bg-slate-900/50 rounded-lg p-3">
            <View className="flex-row items-center mb-1">
              <FileText size={14} color="#94A3B8" />
              <Text className="text-slate-400 text-xs font-semibold ml-1">EVIDENCE</Text>
            </View>
            <Text className="text-slate-300 text-sm">{vote.evidence}</Text>
          </View>

          {/* Vote Stats */}
          <View className="mb-4">
            <View className="flex-row justify-between mb-2">
              <View className="flex-row items-center">
                <Users size={14} color="#94A3B8" />
                <Text className="text-slate-400 text-sm ml-1">
                  {(participation * 100).toFixed(1)}% participation
                </Text>
              </View>
              <View className="flex-row items-center">
                <Clock size={14} color="#94A3B8" />
                <Text className="text-slate-400 text-sm ml-1">
                  {daysRemaining} days left
                </Text>
              </View>
            </View>

            {/* Progress bars */}
            <View className="mb-2">
              <View className="flex-row justify-between mb-1">
                <Text className="text-emerald-400 text-sm font-medium">
                  For Reset: {vote.votesFor.toLocaleString()}
                </Text>
                <Text className="text-emerald-400 text-sm font-medium">
                  {approvalPct.toFixed(1)}%
                </Text>
              </View>
              <View className="h-3 bg-slate-700 rounded-full overflow-hidden">
                <View
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${approvalPct}%` }}
                />
              </View>
            </View>

            <View>
              <View className="flex-row justify-between mb-1">
                <Text className="text-red-400 text-sm font-medium">
                  Against: {vote.votesAgainst.toLocaleString()}
                </Text>
                <Text className="text-red-400 text-sm font-medium">
                  {(100 - approvalPct).toFixed(1)}%
                </Text>
              </View>
              <View className="h-3 bg-slate-700 rounded-full overflow-hidden">
                <View
                  className="h-full bg-red-500 rounded-full"
                  style={{ width: `${100 - approvalPct}%` }}
                />
              </View>
            </View>
          </View>

          {/* Threshold indicator */}
          <View className="bg-slate-900/50 rounded-lg p-3 mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-slate-300 text-sm">
                Super-majority required: {(SYSTEM_RESET_THRESHOLD * 100).toFixed(0)}%
              </Text>
              {canTrigger ? (
                <View className="flex-row items-center">
                  <CheckCircle size={14} color="#22C55E" />
                  <Text className="text-emerald-400 text-sm font-medium ml-1">
                    Threshold Met
                  </Text>
                </View>
              ) : (
                <View className="flex-row items-center">
                  <XCircle size={14} color="#EF4444" />
                  <Text className="text-red-400 text-sm font-medium ml-1">
                    Not Met
                  </Text>
                </View>
              )}
            </View>
            <Text className="text-slate-500 text-xs mt-1">
              Requires 50% participation + 66% approval
            </Text>
          </View>

          {/* Vote buttons */}
          <View className="flex-row">
            <Pressable
              onPress={onVoteFor}
              disabled={userVote !== null}
              className={cn(
                'flex-1 rounded-xl py-3 items-center mr-2 flex-row justify-center',
                userVote === 'for'
                  ? 'bg-emerald-600'
                  : userVote !== null
                  ? 'bg-slate-700/50'
                  : 'bg-emerald-600/80'
              )}
            >
              <CheckCircle size={18} color={userVote === 'for' ? '#fff' : '#22C55E'} />
              <Text
                className={cn(
                  'font-semibold ml-2',
                  userVote === 'for' ? 'text-white' : 'text-emerald-400'
                )}
              >
                {userVote === 'for' ? 'Voted For' : 'Vote For'}
              </Text>
            </Pressable>

            <Pressable
              onPress={onVoteAgainst}
              disabled={userVote !== null}
              className={cn(
                'flex-1 rounded-xl py-3 items-center ml-2 flex-row justify-center',
                userVote === 'against'
                  ? 'bg-red-600'
                  : userVote !== null
                  ? 'bg-slate-700/50'
                  : 'bg-red-600/80'
              )}
            >
              <XCircle size={18} color={userVote === 'against' ? '#fff' : '#EF4444'} />
              <Text
                className={cn(
                  'font-semibold ml-2',
                  userVote === 'against' ? 'text-white' : 'text-red-400'
                )}
              >
                {userVote === 'against' ? 'Voted Against' : 'Vote Against'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

// ==========================================
// MAIN SCREEN
// ==========================================

export default function ArticleVScreen() {
  const requireAuth = useRequireAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'impeachment' | 'reset'>('impeachment');
  const [votedLeaders, setVotedLeaders] = useState<Set<string>>(new Set());
  const [resetVote, setResetVote] = useState<'for' | 'against' | null>(null);

  const handleVoteImpeach = useCallback((leaderId: string) => {
    if (!requireAuth('Sign in to cast your vote.')) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVotedLeaders(prev => new Set(prev).add(leaderId));
  }, [requireAuth]);

  const handleResetVoteFor = useCallback(() => {
    if (!requireAuth('Sign in to cast your vote.')) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setResetVote('for');
  }, [requireAuth]);

  const handleResetVoteAgainst = useCallback(() => {
    if (!requireAuth('Sign in to cast your vote.')) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setResetVote('against');
  }, [requireAuth]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#1a1a2e', '#16213e', '#0f0f23']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="px-4 py-3 border-b border-slate-800">
            <View className="flex-row items-center">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.back();
                }}
                className="w-10 h-10 items-center justify-center rounded-full bg-slate-800/60"
              >
                <ChevronLeft size={24} color="#fff" />
              </Pressable>
              <View className="flex-1 items-center">
                <Text className="text-white font-bold text-lg">Article V</Text>
                <Text className="text-slate-400 text-xs">Self-Correction Mechanism</Text>
              </View>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/constitution');
                }}
                className="w-10 h-10 items-center justify-center rounded-full bg-slate-800/60"
              >
                <BookOpen size={20} color="#94A3B8" />
              </Pressable>
            </View>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Header Banner */}
            <Animated.View entering={FadeInUp.duration(500)} className="mb-6">
              <View className="rounded-2xl overflow-hidden border border-red-700/30">
                <LinearGradient
                  colors={['#7F1D1D', '#450A0A']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 20 }}
                >
                  <View className="flex-row items-center mb-3">
                    <View className="w-12 h-12 rounded-full bg-red-500/20 items-center justify-center mr-3">
                      <RotateCcw size={24} color="#FCA5A5" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-red-100 font-bold text-xl">
                        Self-Correction
                      </Text>
                      <Text className="text-red-300/70 text-sm">
                        Constitutional Article V
                      </Text>
                    </View>
                    <ArticleBadge articleNumber="V" size="md" source="constitution" />
                  </View>
                  <Text className="text-red-200/80 leading-5 italic">
                    "The community retains the right to Impeach or demote any leader who
                    misrepresents facts or violates the Code of Conduct, and may trigger
                    a System-Wide Reset via super-majority vote."
                  </Text>
                </LinearGradient>
              </View>
            </Animated.View>

            {/* Tab Selector */}
            <Animated.View entering={FadeIn.delay(200)} className="flex-row mb-6">
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTab('impeachment');
                }}
                className={cn(
                  'flex-1 py-3 rounded-l-xl flex-row items-center justify-center border',
                  activeTab === 'impeachment'
                    ? 'bg-amber-500/20 border-amber-500/50'
                    : 'bg-slate-800/60 border-slate-700/50'
                )}
              >
                <UserX
                  size={18}
                  color={activeTab === 'impeachment' ? '#F59E0B' : '#64748B'}
                />
                <Text
                  className={cn(
                    'font-semibold ml-2',
                    activeTab === 'impeachment' ? 'text-amber-500' : 'text-slate-400'
                  )}
                >
                  Impeachment
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTab('reset');
                }}
                className={cn(
                  'flex-1 py-3 rounded-r-xl flex-row items-center justify-center border',
                  activeTab === 'reset'
                    ? 'bg-red-500/20 border-red-500/50'
                    : 'bg-slate-800/60 border-slate-700/50'
                )}
              >
                <RotateCcw
                  size={18}
                  color={activeTab === 'reset' ? '#EF4444' : '#64748B'}
                />
                <Text
                  className={cn(
                    'font-semibold ml-2',
                    activeTab === 'reset' ? 'text-red-400' : 'text-slate-400'
                  )}
                >
                  System Reset
                </Text>
              </Pressable>
            </Animated.View>

            {/* Content */}
            {activeTab === 'impeachment' ? (
              <View>
                {/* Impeachment Explanation */}
                <Animated.View entering={FadeInDown.delay(100)} className="mb-4">
                  <View className="bg-amber-900/20 rounded-xl p-4 border border-amber-700/30">
                    <View className="flex-row items-center mb-2">
                      <Gavel size={18} color="#F59E0B" />
                      <Text className="text-amber-400 font-semibold ml-2">
                        Leader Accountability
                      </Text>
                    </View>
                    <Text className="text-slate-300 text-sm leading-5">
                      Civil Leaders who misrepresent facts or violate the Code of Conduct
                      can be impeached by their delegators. A 50% majority of delegators
                      must vote to impeach for removal.
                    </Text>
                  </View>
                </Animated.View>

                {/* Civil Leaders List */}
                <Text className="text-slate-400 text-xs font-semibold tracking-wider mb-3">
                  CIVIL LEADERS
                </Text>
                {mockCivilLeaders.map((leader, index) => (
                  <LeaderCard
                    key={leader.id}
                    leader={leader}
                    onVoteImpeach={handleVoteImpeach}
                    hasVoted={votedLeaders.has(leader.id)}
                  />
                ))}
              </View>
            ) : (
              <View>
                {/* Reset Explanation */}
                <Animated.View entering={FadeInDown.delay(100)} className="mb-4">
                  <View className="bg-red-900/20 rounded-xl p-4 border border-red-700/30">
                    <View className="flex-row items-center mb-2">
                      <AlertTriangle size={18} color="#EF4444" />
                      <Text className="text-red-400 font-semibold ml-2">
                        Platform Neutrality
                      </Text>
                    </View>
                    <Text className="text-slate-300 text-sm leading-5">
                      If platform administrators or developers are found biasing the Pulse,
                      the Electorate may trigger a System-Wide Reset. This requires a
                      super-majority vote (66%) with at least 50% participation.
                    </Text>
                  </View>
                </Animated.View>

                {/* Active Reset Vote */}
                <Text className="text-slate-400 text-xs font-semibold tracking-wider mb-3">
                  ACTIVE RESET VOTE
                </Text>
                <SystemResetCard
                  vote={mockSystemResetVote}
                  onVoteFor={handleResetVoteFor}
                  onVoteAgainst={handleResetVoteAgainst}
                  userVote={resetVote}
                />
              </View>
            )}

            {/* Footer */}
            <Animated.View entering={FadeIn.delay(600)} className="mt-6">
              <FoundingDocumentsLink variant="horizontal" />
            </Animated.View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </>
  );
}
