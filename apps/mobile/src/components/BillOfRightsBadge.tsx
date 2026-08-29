import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { Scroll, Shield, Scale, Eye, Crown, Award, BookOpen, CheckCircle, Lock, Unlock } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BILL_OF_RIGHTS, getAmendmentEnforcement } from '@/lib/bill-of-rights';
import { CONSTITUTION } from '@/lib/constitution';

interface BillOfRightsBadgeProps {
  variant?: 'compact' | 'full';
  showVersion?: boolean;
  className?: string;
}

/**
 * Bill of Rights Compliance Badge
 * Shows that this app operates under the Civil Voice Bill of Rights
 */
export function BillOfRightsBadge({
  variant = 'compact',
  showVersion = false,
  className = '',
}: BillOfRightsBadgeProps) {
  const router = useRouter();
  const enforcement = getAmendmentEnforcement();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/bill-of-rights');
  };

  if (variant === 'compact') {
    return (
      <Animated.View entering={FadeIn.duration(300)}>
        <Pressable
          onPress={handlePress}
          className={`flex-row items-center bg-amber-900/30 px-2 py-1 rounded-full border border-amber-700/30 ${className}`}
        >
          <Scroll size={12} color="#FCD34D" />
          <Text className="text-amber-300 text-xs font-medium ml-1">
            Rights Protected
          </Text>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Pressable
        onPress={handlePress}
        className={`bg-amber-900/20 rounded-xl p-3 border border-amber-700/30 ${className}`}
      >
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center mr-3">
            <Shield size={20} color="#FCD34D" />
          </View>
          <View className="flex-1">
            <Text className="text-amber-100 font-semibold">
              Bill of Rights Protected
            </Text>
            {/*
              This printed `BILL_OF_RIGHTS.articles.length` — the article count,
              wearing the words "enshrined in code". It would have read "5" with
              nothing behind any of them. It is the enforced count now, earned
              the way Article VI requires.
            */}
            <Text className="text-amber-300/70 text-xs">
              {enforcement.enforced} of {enforcement.total} Amendments enforced in code
            </Text>
          </View>
          <Scroll size={16} color="#FCD34D" />
        </View>
        {showVersion && (
          <Text className="text-amber-500/50 text-xs mt-2">
            v{BILL_OF_RIGHTS.version}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

interface ArticleBadgeProps {
  articleNumber: 'I' | 'II' | 'III' | 'IV' | 'V';
  size?: 'sm' | 'md';
  source?: 'bill-of-rights' | 'constitution';
}

/**
 * Individual Article Badge
 * Use to indicate which specific article protects a feature
 */
export function ArticleBadge({ articleNumber, size = 'sm', source = 'bill-of-rights' }: ArticleBadgeProps) {
  const article = source === 'bill-of-rights'
    ? BILL_OF_RIGHTS.articles.find(a => a.number === articleNumber)
    : CONSTITUTION.articles.find(a => a.number === articleNumber);
  if (!article) return null;

  const colors: Record<string, string> = {
    I: '#F59E0B',
    II: '#3B82F6',
    III: '#22C55E',
    IV: '#8B5CF6',
    V: '#EF4444',
  };

  const color = colors[articleNumber] ?? '#F59E0B';

  if (size === 'sm') {
    return (
      <View
        className="flex-row items-center px-1.5 py-0.5 rounded"
        style={{ backgroundColor: `${color}20` }}
      >
        <Text className="text-xs font-bold" style={{ color }}>
          Art. {articleNumber}
        </Text>
      </View>
    );
  }

  return (
    <View
      className="flex-row items-center px-2 py-1 rounded-lg"
      style={{ backgroundColor: `${color}20` }}
    >
      <Text className="text-xs font-bold mr-1" style={{ color }}>
        Article {articleNumber}:
      </Text>
      <Text className="text-xs" style={{ color: `${color}CC` }}>
        {'subtitle' in article ? article.subtitle : article.title}
      </Text>
    </View>
  );
}

/**
 * Compliance Statement
 * Shows a specific compliance message for a feature
 */
export function ComplianceStatement({
  article,
  statement,
}: {
  article: 'I' | 'II' | 'III' | 'IV' | 'V';
  statement: string;
}) {
  return (
    <View className="flex-row items-start bg-slate-800/40 rounded-lg p-2 mt-2">
      <ArticleBadge articleNumber={article} size="sm" />
      <Text className="text-slate-400 text-xs ml-2 flex-1">
        {statement}
      </Text>
    </View>
  );
}

// Icon mapping for articles
const ARTICLE_ICONS: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  I: Crown,      // Sovereignty
  II: Scale,     // Neutrality
  III: Eye,      // Transparency
  IV: Shield,    // Privacy
  V: Award,      // Leadership
};

interface RightProtectionBannerProps {
  article: 'I' | 'II' | 'III' | 'IV' | 'V';
  title: string;
  description: string;
  isActive?: boolean;
}

/**
 * Right Protection Banner
 * Shows when a specific right is being exercised or protected
 */
export function RightProtectionBanner({
  article,
  title,
  description,
  isActive = true,
}: RightProtectionBannerProps) {
  const router = useRouter();
  const colors: Record<string, string> = {
    I: '#F59E0B',
    II: '#3B82F6',
    III: '#22C55E',
    IV: '#8B5CF6',
    V: '#EF4444',
  };
  const color = colors[article] ?? '#F59E0B';
  const IconComponent = ARTICLE_ICONS[article] ?? Shield;

  return (
    <Animated.View entering={FadeInDown.duration(300)}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/bill-of-rights');
        }}
        className="rounded-xl p-3 border"
        style={{
          backgroundColor: `${color}10`,
          borderColor: `${color}30`,
        }}
      >
        <View className="flex-row items-center">
          <View
            className="w-8 h-8 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: `${color}20` }}
          >
            <IconComponent size={16} color={color} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center">
              <Text className="font-semibold text-sm" style={{ color }}>
                {title}
              </Text>
              {isActive && (
                <View className="ml-2 flex-row items-center">
                  <CheckCircle size={12} color="#22C55E" />
                  <Text className="text-emerald-400 text-xs ml-1">Active</Text>
                </View>
              )}
            </View>
            <Text className="text-slate-400 text-xs mt-0.5">
              {description}
            </Text>
          </View>
          <ArticleBadge articleNumber={article} size="sm" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

interface DelegationRightIndicatorProps {
  canRevoke: boolean;
  onLearnMore?: () => void;
}

/**
 * Delegation Right Indicator
 * Shows Article I protections for delegation actions
 */
export function DelegationRightIndicator({ canRevoke, onLearnMore }: DelegationRightIndicatorProps) {
  const router = useRouter();

  return (
    <View className="bg-amber-900/20 rounded-lg p-3 border border-amber-700/30">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          {canRevoke ? (
            <Unlock size={16} color="#22C55E" />
          ) : (
            <Lock size={16} color="#EF4444" />
          )}
          <Text className="text-amber-100 text-sm font-medium ml-2">
            {canRevoke ? 'Instant Revocation Available' : 'Revocation Blocked'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/bill-of-rights');
          }}
        >
          <ArticleBadge articleNumber="I" size="sm" />
        </Pressable>
      </View>
      <Text className="text-amber-300/70 text-xs mt-2">
        Per Article I, you can revoke your delegation at any time, for any reason, without delay or penalty.
      </Text>
    </View>
  );
}

/**
 * A response is only usable if it actually carries the numbers.
 *
 * A backend that answers this route with something else — an error envelope, an
 * empty object, an older deploy that has no such route — must leave the panel
 * blank, not crash the page it sits on. Checking one field and then reading a
 * nested one is exactly how the Government page white-screened.
 */
function usableVoteDetails(data: unknown): data is VoteDetails {
  const d = data as VoteDetails | undefined;
  return (
    typeof d?.total === 'number' &&
    typeof d?.support?.direct === 'number' &&
    typeof d?.support?.delegated === 'number' &&
    typeof d?.oppose?.direct === 'number' &&
    typeof d?.oppose?.delegated === 'number'
  );
}

interface TransparencyIndicatorProps {
  /** The master reference whose Pulse this describes. */
  referenceId: string | undefined;
}

export interface VoteDetails {
  support: { direct: number; delegated: number; total: number };
  oppose: { direct: number; delegated: number; total: number };
  total: number;
}

/**
 * Transparency Indicator
 * Shows Article III vote transparency breakdown
 */
/**
 * Transparency Indicator — Article III, actually honoured.
 *
 * THIS PANEL USED TO MAKE ITS NUMBERS UP. Both apps passed it
 * `totalVoters * 0.85` and `totalVoters * 0.15`: an invented split, printed in
 * bold under the quote "Every user has the right to see the mathematical path
 * of a decision". It was the fabrication sitting inside the guarantee against
 * fabrication, and it would have told a citizen a confident lie about how their
 * own delegation had been counted.
 *
 * It now reads the real breakdown, and shows nothing at all when there is no
 * record to read — an empty space is honest, an invented ratio is not.
 */
export function TransparencyIndicator({ referenceId }: TransparencyIndicatorProps) {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['vote-details', referenceId],
    queryFn: () => api.get<VoteDetails>(`/api/government-references/${referenceId}/vote-details`),
    enabled: Boolean(referenceId),
  });

  if (!usableVoteDetails(data)) return null;

  const directVotes = data.support.direct + data.oppose.direct;
  const delegatedVotes = data.support.delegated + data.oppose.delegated;
  const totalWeight = data.total;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push('/bill-of-rights');
      }}
      className="bg-emerald-900/20 rounded-lg p-3 border border-emerald-700/30"
    >
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <Eye size={16} color="#22C55E" />
          <Text className="text-emerald-100 text-sm font-medium ml-2">
            Vote Transparency
          </Text>
        </View>
        <ArticleBadge articleNumber="III" size="sm" />
      </View>
      <View className="flex-row justify-between">
        <View>
          <Text className="text-slate-400 text-xs">Direct</Text>
          <Text className="text-white font-bold">{directVotes.toLocaleString()}</Text>
        </View>
        <View>
          <Text className="text-slate-400 text-xs">Delegated</Text>
          <Text className="text-white font-bold">{delegatedVotes.toLocaleString()}</Text>
        </View>
        <View>
          <Text className="text-slate-400 text-xs">Total Weight</Text>
          <Text className="text-emerald-400 font-bold">{totalWeight.toLocaleString()}</Text>
        </View>
      </View>
      <Text className="text-emerald-300/60 text-xs mt-2 italic">
        "Every user has the right to see the mathematical path of a decision"
      </Text>
    </Pressable>
  );
}

interface ConstitutionalPowerBadgeProps {
  branch: 'electorate' | 'vanguard' | 'judiciary';
}

/**
 * Constitutional Power Badge
 * Shows which branch of platform governance the user belongs to
 */
export function ConstitutionalPowerBadge({ branch }: ConstitutionalPowerBadgeProps) {
  const router = useRouter();

  const branchInfo = {
    electorate: {
      label: 'Electorate',
      description: 'The sole source of all power',
      color: '#3B82F6',
      icon: Crown,
    },
    vanguard: {
      // "Magnification through merit" described nothing that exists. The title
      // marks how many people have lent a voice, and confers nothing else.
      label: 'Civil Leader',
      description: 'Carrying a voice that was lent',
      color: '#F59E0B',
      icon: Award,
    },
    judiciary: {
      label: 'Community Jury',
      description: 'Resolve disputes',
      color: '#8B5CF6',
      icon: Scale,
    },
  };

  const info = branchInfo[branch];
  const IconComponent = info.icon;

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push('/constitution');
      }}
      className="rounded-lg p-2 border"
      style={{
        backgroundColor: `${info.color}15`,
        borderColor: `${info.color}30`,
      }}
    >
      <View className="flex-row items-center">
        <IconComponent size={14} color={info.color} />
        <Text className="text-xs font-semibold ml-1.5" style={{ color: info.color }}>
          {info.label}
        </Text>
      </View>
      <Text className="text-slate-400 text-xs mt-0.5">
        {info.description}
      </Text>
    </Pressable>
  );
}

interface FoundingDocumentsLinkProps {
  variant?: 'horizontal' | 'vertical';
}

/**
 * Founding Documents Link
 * Quick access to both Constitution and Bill of Rights
 */
export function FoundingDocumentsLink({ variant = 'horizontal' }: FoundingDocumentsLinkProps) {
  const router = useRouter();

  if (variant === 'horizontal') {
    return (
      <View className="flex-row">
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/constitution');
          }}
          className="flex-1 flex-row items-center justify-center bg-slate-800/60 rounded-l-lg py-2 px-3 border-r border-slate-700"
        >
          <BookOpen size={14} color="#8FA79A" />
          <Text className="text-slate-300 text-xs font-medium ml-1.5">Constitution</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/bill-of-rights');
          }}
          className="flex-1 flex-row items-center justify-center bg-amber-900/30 rounded-r-lg py-2 px-3"
        >
          <Scroll size={14} color="#FCD34D" />
          <Text className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/constitution');
        }}
        className="flex-row items-center bg-slate-800/60 rounded-t-lg py-2 px-3 border-b border-slate-700"
      >
        <BookOpen size={14} color="#8FA79A" />
        <Text className="text-slate-300 text-xs font-medium ml-1.5">Constitution</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.push('/bill-of-rights');
        }}
        className="flex-row items-center bg-amber-900/30 rounded-b-lg py-2 px-3"
      >
        <Scroll size={14} color="#FCD34D" />
        <Text className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</Text>
      </Pressable>
    </View>
  );
}
