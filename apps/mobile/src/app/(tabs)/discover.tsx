import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Search,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
  Users,
  Flame,
  Clock,
  Landmark,
  FileText,
  Scale,
  Building2,
  Star,
  Shield,
  Briefcase,
  Crown,
  Gavel,
  RefreshCw,
  MapPin,
  Phone,
  Globe,
  ChevronDown,
  ChevronUp,
} from 'lucide-react-native';
import Animated, { FadeInRight, FadeInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { mockUsers, categoryColors, categoryLabels, branchColors, branchLabels } from '@/lib/mock-data';
import type { ExecutiveOrder, SupremeCourtCase } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import {
  fetchOfficials,
  type Official,
  type Department,
} from '@/lib/government-service';
import { useVotingStore, selectUserVote } from '@/lib/voting-store';
import type { Bill, User, BillCategory, GovernmentBranch } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useBills as useApiBills, type ApiBill } from '@/lib/api/hooks';
import {
  useTrendingReferences,
  useLatestReferences,
  referenceToBill,
  referenceToExecutiveOrder,
  referenceToScotusCase,
} from '@/lib/api/references';
import { DataFreshness } from '@/components/civic/DataFreshness';

// Tab types
type DiscoverTab = 'trending' | 'legislative' | 'executive' | 'judicial' | 'government';

/** Photo for a live official, with an initials fallback. */
function officialPhoto(official: Official): string {
  return (
    official.photoUrl ??
    `https://api.dicebear.com/7.x/initials/png?seed=${encodeURIComponent(official.name)}`
  );
}

const categories: BillCategory[] = [
  'healthcare',
  'education',
  'environment',
  'economy',
  'technology',
  'housing',
  'civil_rights',
  'immigration',
];

// Convert API bill to legacy format for existing components
function convertApiBillToLegacy(bill: ApiBill): Bill {
  return {
    id: bill.id,
    title: bill.title,
    shortTitle: bill.title.length > 50 ? bill.title.substring(0, 50) + '...' : bill.title,
    status: bill.status as Bill['status'],
    chamber: bill.chamber,
    sponsor: {
      id: 'sponsor',
      name: bill.sponsor,
      party: 'D' as const,
      state: 'US',
      chamber: bill.chamber,
      imageUrl: '',
    },
    introducedDate: bill.introducedDate ?? new Date().toISOString(),
    lastActionDate: bill.lastActionDate ?? new Date().toISOString(),
    category: bill.category as BillCategory,
    fullText: bill.fullText ?? bill.summary,
    simplifiedText: bill.summary,
    realWorldImpact: '',
    relatedLaws: [],
    communityVotes: {
      yea: bill.votes.support,
      nay: bill.votes.oppose,
      totalVoters: bill.votes.total || 1,
    },
  };
}

// ==========================================
// DISCOVER TAB SELECTOR
// ==========================================

function DiscoverTabSelector({
  activeTab,
  onChangeTab,
}: {
  activeTab: DiscoverTab;
  onChangeTab: (tab: DiscoverTab) => void;
}) {
  const tabs: { id: DiscoverTab; label: string; color: string }[] = [
    { id: 'trending', label: 'Trending', color: '#F59E0B' },
    { id: 'legislative', label: 'Congress', color: '#3B82F6' },
    { id: 'executive', label: 'Executive', color: '#F59E0B' },
    { id: 'judicial', label: 'SCOTUS', color: '#8B5CF6' },
    { id: 'government', label: 'Gov Map', color: '#3B82F6' },
  ];

  const renderIcon = (tabId: DiscoverTab, color: string) => {
    switch (tabId) {
      case 'trending':
        return <Flame size={16} color={color} />;
      case 'legislative':
        return <Landmark size={16} color={color} />;
      case 'executive':
        return <FileText size={16} color={color} />;
      case 'judicial':
        return <Scale size={16} color={color} />;
      case 'government':
        return <Building2 size={16} color={color} />;
    }
  };

  return (
    <View className="flex-row px-4 mb-4">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const iconColor = isActive ? '#fff' : tab.color;

        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              Haptics.selectionAsync();
              onChangeTab(tab.id);
            }}
            className={cn(
              'flex-1 flex-row items-center justify-center py-2.5 rounded-xl mx-1',
              isActive ? 'border-transparent' : 'bg-slate-800/60 border border-slate-700/50'
            )}
          >
            {isActive && (
              <LinearGradient
                colors={[tab.color, `${tab.color}AA`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 12,
                }}
              />
            )}
            {renderIcon(tab.id, iconColor)}
            <Text
              className={cn(
                'ml-1.5 font-medium text-xs',
                isActive ? 'text-white' : 'text-slate-400'
              )}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ==========================================
// TRENDING BILL CARD
// ==========================================

function TrendingBillCard({ bill, index }: { bill: Bill; index: number }) {
  const router = useRouter();
  const userVote = useVotingStore(selectUserVote(bill.id));
  const categoryColor = categoryColors[bill.category] ?? '#6E8A7C';

  const totalVotes = bill.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((bill.communityVotes.yea / totalVotes) * 100);

  return (
    <Animated.View entering={FadeInRight.delay(index * 80).springify()}>
      <Pressable
        onPress={() => router.push(`/bill/${bill.id}`)}
        className="bg-slate-800/70 rounded-xl p-4 mr-3 border border-slate-700/50"
        style={{ width: 280 }}
      >
        <View className="flex-row items-center justify-between mb-2">
          <View className="flex-row items-center">
            <View className="bg-amber-500/20 p-1.5 rounded-full mr-2">
              <Flame size={14} color="#F59E0B" />
            </View>
            <Text className="text-amber-500 text-xs font-semibold">
              #{index + 1} Trending
            </Text>
          </View>
          <View
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${categoryColor}30` }}
          >
            <Text style={{ color: categoryColor }} className="text-xs font-medium">
              {categoryLabels[bill.category]}
            </Text>
          </View>
        </View>

        <Text className="text-white font-semibold text-base mb-1" numberOfLines={2}>
          {bill.shortTitle}
        </Text>
        <Text className="text-slate-400 text-sm mb-3" numberOfLines={2}>
          {bill.title}
        </Text>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View className="flex-row items-center mr-3">
              <ThumbsUp size={12} color="#22C55E" />
              <Text className="text-emerald-500 text-xs ml-1">{yeaPercentage}%</Text>
            </View>
            <View className="flex-row items-center">
              <Users size={12} color="#6E8A7C" />
              <Text className="text-slate-400 text-xs ml-1">
                {bill.communityVotes.totalVoters.toLocaleString()}
              </Text>
            </View>
          </View>
          {userVote && (
            <View
              className={cn(
                'px-2 py-0.5 rounded-full',
                userVote === 'yea' ? 'bg-emerald-900/60' : 'bg-red-900/60'
              )}
            >
              <Text
                className={cn(
                  'text-xs',
                  userVote === 'yea' ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                You voted {userVote}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ==========================================
// EXECUTIVE ORDER CARD
// ==========================================


/**
 * What a branch section shows when it has nothing to show.
 *
 * Each section used to fall back to a hardcoded array whenever the API returned
 * an empty list, so "the sync has not run yet" and "the backend is unreachable"
 * both rendered as a full, convincing list of invented laws. Telling those two
 * apart — and offering a retry instead of a blank panel — is the point.
 */
function SectionState({
  isError,
  onRetry,
  emptyLabel,
}: {
  isError: boolean;
  onRetry: () => void;
  emptyLabel: string;
}) {
  return (
    <View className="mt-4 rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-8 items-center">
      {isError ? (
        <>
          <Text className="text-slate-200 text-sm">Couldn&apos;t load this section</Text>
          <Text className="text-slate-400 text-xs mt-1 text-center">
            Check your connection and try again.
          </Text>
          <Pressable onPress={onRetry} className="mt-3 bg-slate-700 px-4 py-2 rounded-lg">
            <Text className="text-white text-xs font-medium">Try again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="text-slate-400 text-sm">{emptyLabel}</Text>
          <Text className="text-slate-500 text-xs mt-1 text-center">
            New items appear here after the daily government sync runs.
          </Text>
        </>
      )}
    </View>
  );
}

function ExecutiveOrderCard({ eo, index }: { eo: ExecutiveOrder; index: number }) {
  const router = useRouter();
  const categoryColor = categoryColors[eo.category] ?? '#6E8A7C';

  const statusColors: Record<string, { bg: string; text: string }> = {
    active: { bg: 'bg-emerald-900/50', text: 'text-emerald-400' },
    revoked: { bg: 'bg-red-900/50', text: 'text-red-400' },
    superseded: { bg: 'bg-amber-900/50', text: 'text-amber-400' },
  };

  const status = statusColors[eo.status] || statusColors.active;
  const totalVotes = eo.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((eo.communityVotes.yea / totalVotes) * 100);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify()}
      className="mx-4 mb-3"
    >
      <Pressable
        onPress={() => router.push(`/executive-order/${eo.id}`)}
        className="bg-slate-800/60 rounded-xl p-4 border border-amber-700/30"
      >
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-row items-center flex-wrap flex-1">
            <View className="bg-amber-500/20 px-2 py-0.5 rounded-full mr-2 mb-1">
              <Text className="text-amber-500 text-xs font-semibold">{eo.eoNumber}</Text>
            </View>
            <View
              className="px-2 py-0.5 rounded-full mr-2 mb-1"
              style={{ backgroundColor: `${categoryColor}30` }}
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {categoryLabels[eo.category]}
              </Text>
            </View>
            <View className={cn('px-2 py-0.5 rounded-full mb-1', status.bg)}>
              <Text className={cn('text-xs font-medium capitalize', status.text)}>
                {eo.status}
              </Text>
            </View>
          </View>
        </View>

        <Text className="text-white font-semibold text-base mb-1">
          {eo.shortTitle}
        </Text>
        <Text className="text-slate-400 text-sm mb-2" numberOfLines={2}>
          Signed by {eo.president} on {new Date(eo.signedDate).toLocaleDateString()}
        </Text>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <ThumbsUp size={14} color="#22C55E" />
            <Text className="text-emerald-500 text-sm ml-1 font-medium">{yeaPercentage}%</Text>
            <Text className="text-slate-500 text-sm ml-2">
              ({eo.communityVotes.totalVoters.toLocaleString()} votes)
            </Text>
          </View>
          <ChevronRight size={18} color="#6E8A7C" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ==========================================
// SUPREME COURT CASE CARD
// ==========================================

function SupremeCourtCaseCard({ scotusCase, index }: { scotusCase: SupremeCourtCase; index: number }) {
  const router = useRouter();
  const categoryColor = categoryColors[scotusCase.category] ?? '#6E8A7C';

  const statusColors: Record<string, { bg: string; text: string }> = {
    decided: { bg: 'bg-emerald-900/50', text: 'text-emerald-400' },
    argued: { bg: 'bg-blue-900/50', text: 'text-blue-400' },
    pending: { bg: 'bg-amber-900/50', text: 'text-amber-400' },
  };

  const status = statusColors[scotusCase.status] || statusColors.pending;
  const totalVotes = scotusCase.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((scotusCase.communityVotes.yea / totalVotes) * 100);

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify()}
      className="mx-4 mb-3"
    >
      <Pressable
        onPress={() => router.push(`/scotus/${scotusCase.id}`)}
        className="bg-slate-800/60 rounded-xl p-4 border border-purple-700/30"
      >
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-row items-center flex-wrap flex-1">
            <View className="bg-purple-500/20 px-2 py-0.5 rounded-full mr-2 mb-1">
              <Text className="text-purple-400 text-xs font-semibold">{scotusCase.docketNumber}</Text>
            </View>
            <View
              className="px-2 py-0.5 rounded-full mr-2 mb-1"
              style={{ backgroundColor: `${categoryColor}30` }}
            >
              <Text style={{ color: categoryColor }} className="text-xs font-medium">
                {categoryLabels[scotusCase.category]}
              </Text>
            </View>
            <View className={cn('px-2 py-0.5 rounded-full mb-1', status.bg)}>
              <Text className={cn('text-xs font-medium capitalize', status.text)}>
                {scotusCase.status}
              </Text>
            </View>
            {scotusCase.voteBreakdown && (
              <View className="bg-slate-700 px-2 py-0.5 rounded-full mb-1">
                <Text className="text-white text-xs font-bold">
                  {scotusCase.voteBreakdown.majority}-{scotusCase.voteBreakdown.dissent}
                </Text>
              </View>
            )}
          </View>
        </View>

        <Text className="text-white font-semibold text-base mb-1">
          {scotusCase.shortName}
        </Text>
        <Text className="text-slate-400 text-sm mb-2" numberOfLines={2}>
          {scotusCase.simplifiedQuestion}
        </Text>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <Text className="text-slate-500 text-sm">
              {scotusCase.term} Term
            </Text>
            {scotusCase.outcome && (
              <View className="bg-slate-700 px-2 py-0.5 rounded-full ml-2">
                <Text className="text-slate-300 text-xs capitalize">{scotusCase.outcome}</Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center">
            <Text className="text-purple-400 text-sm mr-1">{yeaPercentage}% agree</Text>
            <ChevronRight size={18} color="#6E8A7C" />
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ==========================================
// OFFICE HOLDER CARD
// ==========================================

function OfficeHolderCard({ holder, index }: { holder: Official; index: number }) {
  const partyColors: Record<string, { bg: string; text: string }> = {
    D: { bg: 'bg-blue-900/50', text: 'text-blue-400' },
    R: { bg: 'bg-red-900/50', text: 'text-red-400' },
    I: { bg: 'bg-purple-900/50', text: 'text-purple-400' },
    none: { bg: 'bg-slate-700', text: 'text-slate-300' },
  };

  const party = partyColors[holder.party ?? 'none'];

  return (
    <Animated.View entering={FadeInRight.delay(index * 60).springify()}>
      <View
        className="bg-slate-800/70 rounded-xl p-3 mr-3 border border-slate-700/50"
        style={{ width: 160 }}
      >
        <Image
          source={{ uri: officialPhoto(holder) }}
          className="w-full h-24 rounded-lg mb-2"
          style={{ backgroundColor: '#2C4A3C' }}
        />
        <Text className="text-white font-semibold text-sm" numberOfLines={1}>
          {holder.name}
        </Text>
        <Text className="text-slate-400 text-xs mb-1" numberOfLines={2}>
          {holder.shortTitle || holder.title}
        </Text>
        <View className="flex-row items-center">
          {holder.party && (
            <View className={cn('px-1.5 py-0.5 rounded-full mr-1', party.bg)}>
              <Text className={cn('text-xs font-medium', party.text)}>{holder.party}</Text>
            </View>
          )}
          {holder.acting && (
            <Text className="text-slate-500 text-xs">Acting</Text>
          )}
        </View>
      </View>
    </Animated.View>
  );
}

// ==========================================
// GOVERNMENT BRANCH SECTION
// ==========================================

function GovernmentBranchSection({
  branch,
  holders,
  departments,
  expanded,
  onToggle,
}: {
  branch: GovernmentBranch;
  holders: Official[];
  departments: Department[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const branchConfig = {
    executive: { color: '#F59E0B', icon: <FileText size={20} color="#F59E0B" />, label: 'Executive Branch' },
    legislative: { color: '#3B82F6', icon: <Landmark size={20} color="#3B82F6" />, label: 'Legislative Branch' },
    judicial: { color: '#8B5CF6', icon: <Scale size={20} color="#8B5CF6" />, label: 'SCOTUS' },
  };

  const config = branchConfig[branch];

  return (
    <Animated.View entering={FadeInDown.springify()} className="mx-4 mb-4">
      <Pressable
        onPress={onToggle}
        className="bg-slate-800/60 rounded-xl p-4 border"
        style={{ borderColor: `${config.color}40` }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <View
              className="p-2 rounded-full mr-3"
              style={{ backgroundColor: `${config.color}20` }}
            >
              {config.icon}
            </View>
            <View>
              <Text className="text-white font-semibold text-lg">{config.label}</Text>
              <Text className="text-slate-400 text-sm">
                {holders.length} officials · {departments.length} departments
              </Text>
            </View>
          </View>
          {expanded ? (
            <ChevronUp size={20} color="#6E8A7C" />
          ) : (
            <ChevronDown size={20} color="#6E8A7C" />
          )}
        </View>

        {expanded && (
          <View className="mt-4 pt-4 border-t border-slate-700/50">
            {/* Key Officials */}
            <Text className="text-white font-medium mb-3">Key Officials</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -16, paddingHorizontal: 0, flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: 0 }}
            >
              {holders.slice(0, 6).map((holder, index) => (
                <OfficeHolderCard key={holder.id} holder={holder} index={index} />
              ))}
            </ScrollView>

            {/* Departments */}
            {departments.length > 0 && (
              <>
                <Text className="text-white font-medium mt-4 mb-2">Departments</Text>
                <View className="flex-row flex-wrap">
                  {departments.map((dept) => (
                    <View
                      key={dept.id}
                      className="bg-slate-700/50 px-3 py-1.5 rounded-full mr-2 mb-2"
                    >
                      <Text className="text-slate-300 text-xs">{dept.abbreviation}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ==========================================
// PRESIDENTIAL SUCCESSION
// ==========================================

function PresidentialSuccessionSection({ succession: successionInput }: { succession: Official[] }) {
  const succession = successionInput.slice(0, 10);

  return (
    <Animated.View entering={FadeInDown.springify()} className="mx-4 mb-4">
      <View className="bg-slate-800/60 rounded-xl p-4 border border-amber-700/30">
        <View className="flex-row items-center mb-3">
          <Crown size={18} color="#F59E0B" />
          <Text className="text-white font-semibold text-lg ml-2">
            Presidential Succession
          </Text>
        </View>
        <Text className="text-slate-400 text-sm mb-3">
          Order of succession to the Presidency
        </Text>

        {succession.map((holder, index) => {
          return (
            <View
              key={holder.id}
              className="flex-row items-center py-2 border-b border-slate-700/30 last:border-b-0"
            >
              <View className="w-6 h-6 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                <Text className="text-amber-500 text-xs font-bold">
                  {holder.successionOrder ?? index + 1}
                </Text>
              </View>
              <Image
                source={{ uri: officialPhoto(holder) }}
                className="w-8 h-8 rounded-full mr-3"
                style={{ backgroundColor: '#2C4A3C' }}
              />
              <View className="flex-1">
                <Text className="text-white font-medium text-sm">{holder.name}</Text>
                <Text className="text-slate-400 text-xs">{holder.title}</Text>
              </View>
              {holder.party && (
                <View
                  className={cn(
                    'px-2 py-0.5 rounded-full',
                    holder.party === 'R' ? 'bg-red-900/50' : 'bg-blue-900/50'
                  )}
                >
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      holder.party === 'R' ? 'text-red-400' : 'text-blue-400'
                    )}
                  >
                    {holder.party}
                  </Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

// ==========================================
// SUPREME COURT JUSTICES SECTION
// ==========================================

function SupremeCourtJusticesSection({ justices }: { justices: Official[] }) {
  return (
    <Animated.View entering={FadeInDown.springify()} className="mx-4 mb-4">
      <View className="bg-slate-800/60 rounded-xl p-4 border border-purple-700/30">
        <View className="flex-row items-center mb-3">
          <Gavel size={18} color="#8B5CF6" />
          <Text className="text-white font-semibold text-lg ml-2">
            Supreme Court Justices
          </Text>
        </View>

        <View className="flex-row flex-wrap">
          {justices.map((justice) => {
            const isChief = /chief justice/i.test(justice.title);

            return (
              <View
                key={justice.id}
                className="w-1/3 p-1"
              >
                <View className="bg-slate-700/50 rounded-lg p-2 items-center">
                  <Image
                    source={{ uri: officialPhoto(justice) }}
                    className="w-12 h-12 rounded-full mb-1"
                    style={{ backgroundColor: '#2C4A3C' }}
                  />
                  <Text className="text-white text-xs font-medium text-center" numberOfLines={1}>
                    {justice.name.split(' ').pop()}
                  </Text>
                  {isChief && (
                    <View className="bg-purple-500/30 px-1.5 py-0.5 rounded-full mt-1">
                      <Text className="text-purple-400 text-[10px]">Chief</Text>
                    </View>
                  )}
                  <Text className="text-slate-500 text-[10px] mt-0.5">
                    {justice.appointedBy ? `${justice.appointedBy.split(' ').pop()} ` : ''}
                    {justice.since ? `'${justice.since.slice(2, 4)}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>
    </Animated.View>
  );
}

// ==========================================
// DATA FRESHNESS INDICATOR
// ==========================================

function DataFreshnessIndicator({ lastUpdated }: { lastUpdated: string | null }) {
  const lastUpdate = lastUpdated ? new Date(lastUpdated) : null;
  // Live endpoint data is considered stale after 90 days without a refresh
  const isStale = lastUpdate
    ? Date.now() - lastUpdate.getTime() > 90 * 24 * 60 * 60 * 1000
    : true;

  return (
    <View className="flex-row items-center justify-between px-4 py-2 bg-slate-800/40 mx-4 rounded-lg mb-4">
      <View className="flex-row items-center">
        <RefreshCw size={14} color={isStale ? '#F59E0B' : '#22C55E'} />
        <Text className="text-slate-400 text-xs ml-2">
          Last updated: {lastUpdate ? lastUpdate.toLocaleDateString() : '—'}
        </Text>
      </View>
      <View
        className={cn(
          'px-2 py-0.5 rounded-full',
          isStale ? 'bg-amber-900/50' : 'bg-emerald-900/50'
        )}
      >
        <Text
          className={cn(
            'text-xs font-medium',
            isStale ? 'text-amber-400' : 'text-emerald-400'
          )}
        >
          {isStale ? 'Update available' : 'Current'}
        </Text>
      </View>
    </View>
  );
}

// ==========================================
// MAIN SCREEN
// ==========================================

export default function DiscoverScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DiscoverTab>('trending');
  const [expandedBranches, setExpandedBranches] = useState<Record<GovernmentBranch, boolean>>({
    executive: true,
    legislative: false,
    judicial: false,
  });
  const [refreshing, setRefreshing] = useState(false);

  // API data - uses real backend
  const { data: apiBillsData, isLoading, refetch } = useApiBills();

  // Live daily-synced data: 10 most popular per branch of government
  const {
    data: billRefsData,
    isLoading: billRefsLoading,
    isError: billRefsError,
    refetch: refetchBillRefs,
  } = useTrendingReferences('bill', 10);
  const {
    data: eoRefsData,
    isLoading: eoRefsLoading,
    isError: eoRefsError,
    refetch: refetchEoRefs,
  } = useTrendingReferences('executive_order', 10);
  const {
    data: scotusRefsData,
    isLoading: scotusRefsLoading,
    isError: scotusRefsError,
    refetch: refetchScotusRefs,
  } = useTrendingReferences('scotus_case', 10);
  // Newest synced bills — keeps the "All Legislation" list up to date even
  // before the community has voted on them.
  const { data: latestBillsData, refetch: refetchLatestBills } = useLatestReferences('bill', 30);

  // Toggle branch expansion
  const toggleBranch = useCallback((branch: GovernmentBranch) => {
    setExpandedBranches((prev) => ({
      ...prev,
      [branch]: !prev[branch],
    }));
  }, []);

  // Refresh handler
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Promise.all([
      refetch(),
      refetchBillRefs(),
      refetchEoRefs(),
      refetchScotusRefs(),
      refetchLatestBills(),
    ]);
    setRefreshing(false);
  }, [refetch, refetchBillRefs, refetchEoRefs, refetchScotusRefs, refetchLatestBills]);

  // Filterable bill list: newest synced bills first, then popular ones and any
  // DB bills. Static mock bills are only a fallback when the backend is unreachable.
  const filteredBills = useMemo(() => {
    const latestBills = (latestBillsData?.references ?? []).map(referenceToBill);
    const trendingRefBills = (billRefsData?.references ?? []).map(referenceToBill);
    const apiBills = (apiBillsData?.pages?.flatMap(page => page.bills ?? []) ?? []).map(convertApiBillToLegacy);
    const seen = new Set<string>();
    const liveBills = [...latestBills, ...trendingRefBills, ...apiBills].filter((bill) => {
      if (seen.has(bill.id)) return false;
      seen.add(bill.id);
      return true;
    });

    // Filter by category and search
    return liveBills.filter((bill) => {
      if (selectedCategory && bill.category !== selectedCategory) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          bill.title.toLowerCase().includes(query) ||
          bill.shortTitle.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [latestBillsData, billRefsData, apiBillsData, selectedCategory, searchQuery]);

  // 10 most popular bills in the legislative branch (live, daily-synced)
  const trendingBills = useMemo(() => {
    const referenceBills = (billRefsData?.references ?? []).map(referenceToBill);
    if (referenceBills.length > 0) return referenceBills.slice(0, 10);

    // /api/bills is a second real source, not a fallback to invented content.
    const apiBills = (apiBillsData?.pages?.flatMap(page => page.bills ?? []) ?? []).map(convertApiBillToLegacy);
    return apiBills
      .sort((a, b) => b.communityVotes.totalVoters - a.communityVotes.totalVoters)
      .slice(0, 10);
  }, [billRefsData, apiBillsData]);

  // 10 most popular executive orders (live, daily-synced)
  const executiveOrderItems = useMemo(() => {
    return (eoRefsData?.references ?? []).map(referenceToExecutiveOrder).slice(0, 10);
  }, [eoRefsData]);

  // 10 most popular Supreme Court cases (live, daily-synced)
  const scotusItems = useMemo(() => {
    return (scotusRefsData?.references ?? []).map(referenceToScotusCase).slice(0, 10);
  }, [scotusRefsData]);

  // Live government data — the SAME endpoint and query cache the Government tab
  // uses (/api/government/officials), so the Gov Map always matches it.
  const { data: officials, isLoading: officialsLoading } = useQuery({
    queryKey: ['government-officials'],
    queryFn: fetchOfficials,
    staleTime: 5 * 60 * 1000,
  });

  const executiveDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === 'executive'),
    [officials],
  );
  const legislativeDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === 'legislative'),
    [officials],
  );
  const judicialDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === 'judicial'),
    [officials],
  );

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3">
          <Text className="text-2xl font-bold text-white mb-1">Discover</Text>
          <Text className="text-slate-400 text-sm mb-3">
            Explore all 3 branches of government
          </Text>

          {/* Search Bar */}
          <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50">
            <Search size={20} color="#6E8A7C" />
            <TextInput
              placeholder="Search bills, cases, officials..."
              placeholderTextColor="#6E8A7C"
              value={searchQuery}
              onChangeText={setSearchQuery}
              className="flex-1 text-white ml-3 text-base"
            />
            {(isLoading || billRefsLoading) && (
              <ActivityIndicator size="small" color="#F59E0B" />
            )}
          </View>
        </View>

        {/* Tab Selector */}
        <DiscoverTabSelector activeTab={activeTab} onChangeTab={setActiveTab} />

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
            />
          }
        >
          {/* TRENDING TAB */}
          {activeTab === 'trending' && (
            <>
              {/* Categories */}
              <View className="mb-4">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 16 }}
                  style={{ flexGrow: 0 }}
                >
                  <Pressable
                    onPress={() => setSelectedCategory(null)}
                    className={cn(
                      'px-4 py-2 rounded-full mr-2',
                      selectedCategory === null ? 'bg-amber-500' : 'bg-slate-800'
                    )}
                  >
                    <Text
                      className={cn(
                        'text-sm font-medium',
                        selectedCategory === null ? 'text-slate-900' : 'text-slate-300'
                      )}
                    >
                      All
                    </Text>
                  </Pressable>
                  {categories.map((cat) => (
                    <Pressable
                      key={cat}
                      onPress={() => setSelectedCategory(cat)}
                      className={cn(
                        'px-4 py-2 rounded-full mr-2',
                        selectedCategory === cat ? 'bg-amber-500' : 'bg-slate-800'
                      )}
                    >
                      <Text
                        className={cn(
                          'text-sm font-medium',
                          selectedCategory === cat ? 'text-slate-900' : 'text-slate-300'
                        )}
                      >
                        {categoryLabels[cat]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* How current the RECORDS below are. This is the screen that
                  lists them, which is why the strip lives here rather than on
                  the Government screen — where it used to sit and describe laws
                  to somebody looking up an official.
                  Web twin: apps/web/src/pages/Discover.tsx. */}
              <DataFreshness />

              {/* Trending Bills */}
              <View className="px-4 mb-3">
                <View className="flex-row items-center">
                  <TrendingUp size={18} color="#F59E0B" />
                  <Text className="text-white font-semibold text-lg ml-2">
                    Trending Legislation
                  </Text>
                </View>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
                style={{ flexGrow: 0 }}
                className="mb-6"
              >
                {trendingBills.map((bill, index) => (
                  <TrendingBillCard key={bill.id} bill={bill} index={index} />
                ))}
              </ScrollView>

              {/* All Bills List */}
              <View className="px-4 mb-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Landmark size={18} color="#3B82F6" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      {selectedCategory ? categoryLabels[selectedCategory as BillCategory] : 'All Legislation'}
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-sm">{filteredBills.length} bills</Text>
                </View>
              </View>

              {filteredBills.slice(0, 10).map((bill, index) => (
                <Animated.View
                  key={bill.id}
                  entering={FadeInDown.delay(index * 60).springify()}
                  className="mx-4 mb-3"
                >
                  <Pressable
                    onPress={() => router.push(`/bill/${bill.id}`)}
                    className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40"
                  >
                    <Text className="text-white font-semibold">{bill.shortTitle}</Text>
                    <Text className="text-slate-400 text-sm mt-1" numberOfLines={2}>
                      {bill.title}
                    </Text>
                  </Pressable>
                </Animated.View>
              ))}
            </>
          )}

          {/* CONGRESS (LEGISLATIVE) TAB */}
          {activeTab === 'legislative' && (
            <>
              <View className="px-4 mb-3">
                <View className="flex-row items-center">
                  <Landmark size={18} color="#3B82F6" />
                  <Text className="text-white font-semibold text-lg ml-2">
                    Legislation
                  </Text>
                </View>
                <Text className="text-slate-400 text-sm mt-1">
                  The 10 most popular bills in Congress
                </Text>
              </View>

              {billRefsLoading && trendingBills.length === 0 ? (
                <ActivityIndicator size="large" color="#3B82F6" className="mt-8" />
              ) : trendingBills.length === 0 ? (
                <SectionState
                  isError={billRefsError}
                  onRetry={() => refetchBillRefs()}
                  emptyLabel="No bills yet"
                />
              ) : (
                trendingBills.map((bill, index) => (
                  <Animated.View
                    key={bill.id}
                    entering={FadeInDown.delay(index * 60).springify()}
                    className="mx-4 mb-3"
                  >
                    <Pressable
                      onPress={() => router.push(`/bill/${bill.id}`)}
                      className="bg-slate-800/60 rounded-xl p-4 border border-blue-700/30"
                    >
                      <View className="flex-row items-center flex-wrap mb-1">
                        <View className="bg-blue-500/20 px-2 py-0.5 rounded-full mr-2 mb-1">
                          <Text className="text-blue-400 text-xs font-semibold">#{index + 1}</Text>
                        </View>
                        {bill.congressNumber ? (
                          <View className="bg-slate-700/60 px-2 py-0.5 rounded-full mr-2 mb-1">
                            <Text className="text-slate-300 text-xs">{bill.congressNumber}</Text>
                          </View>
                        ) : null}
                        <View className="bg-slate-700/60 px-2 py-0.5 rounded-full mb-1">
                          <Text className="text-slate-300 text-xs">
                            {categoryLabels[bill.category] ?? bill.category}
                          </Text>
                        </View>
                      </View>
                      <Text className="text-white font-semibold">{bill.shortTitle}</Text>
                      <Text className="text-slate-400 text-sm mt-1" numberOfLines={2}>
                        {bill.title}
                      </Text>
                      <Text className="text-slate-500 text-xs mt-2">
                        {bill.communityVotes.totalVoters.toLocaleString()} community votes
                      </Text>
                    </Pressable>
                  </Animated.View>
                ))
              )}

              {/* Freshly pulled bills, straight from the daily congress.gov sync */}
              <View className="px-4 mb-3 mt-4">
                <View className="flex-row items-center">
                  <TrendingUp size={18} color="#22C55E" />
                  <Text className="text-white font-semibold text-lg ml-2">
                    Newest from Congress
                  </Text>
                </View>
                <Text className="text-slate-400 text-sm mt-1">
                  Pulled in the latest daily sync
                </Text>
              </View>
              {(latestBillsData?.references ?? []).slice(0, 10).map((ref) => {
                const bill = referenceToBill(ref);
                return (
                  <View key={`latest-${bill.id}`} className="mx-4 mb-3">
                    <Pressable
                      onPress={() => router.push(`/bill/${bill.id}`)}
                      className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40"
                    >
                      <View className="flex-row items-center flex-wrap mb-1">
                        {bill.congressNumber ? (
                          <View className="bg-slate-700/60 px-2 py-0.5 rounded-full mr-2 mb-1">
                            <Text className="text-slate-300 text-xs">{bill.congressNumber}</Text>
                          </View>
                        ) : null}
                        <View className="bg-emerald-500/15 px-2 py-0.5 rounded-full mb-1">
                          <Text className="text-emerald-400 text-xs">New</Text>
                        </View>
                      </View>
                      <Text className="text-white font-semibold">{bill.shortTitle}</Text>
                      <Text className="text-slate-400 text-sm mt-1" numberOfLines={2}>
                        {bill.title}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </>
          )}

          {/* EXECUTIVE TAB */}
          {activeTab === 'executive' && (
            <>
              <View className="px-4 mb-3">
                <View className="flex-row items-center">
                  <FileText size={18} color="#F59E0B" />
                  <Text className="text-white font-semibold text-lg ml-2">
                    Executive Orders
                  </Text>
                </View>
                <Text className="text-slate-400 text-sm mt-1">
                  The 10 most popular presidential directives
                </Text>
              </View>

              {eoRefsLoading && executiveOrderItems.length === 0 ? (
                <ActivityIndicator size="large" color="#F59E0B" className="mt-8" />
              ) : executiveOrderItems.length === 0 ? (
                <SectionState
                  isError={eoRefsError}
                  onRetry={() => refetchEoRefs()}
                  emptyLabel="No executive orders yet"
                />
              ) : (
                executiveOrderItems.map((eo, index) => (
                  <ExecutiveOrderCard key={eo.id} eo={eo} index={index} />
                ))
              )}
            </>
          )}

          {/* JUDICIAL TAB */}
          {activeTab === 'judicial' && (
            <>
              <View className="px-4 mb-3">
                <View className="flex-row items-center">
                  <Scale size={18} color="#8B5CF6" />
                  <Text className="text-white font-semibold text-lg ml-2">
                    Supreme Court Cases
                  </Text>
                </View>
                <Text className="text-slate-400 text-sm mt-1">
                  The 10 most popular Supreme Court decisions
                </Text>
              </View>

              {scotusRefsLoading && scotusItems.length === 0 ? (
                <ActivityIndicator size="large" color="#8B5CF6" className="mt-8" />
              ) : scotusItems.length === 0 ? (
                <SectionState
                  isError={scotusRefsError}
                  onRetry={() => refetchScotusRefs()}
                  emptyLabel="No Supreme Court cases yet"
                />
              ) : (
                scotusItems.map((scotusCase, index) => (
                  <SupremeCourtCaseCard key={scotusCase.id} scotusCase={scotusCase} index={index} />
                ))
              )}
            </>
          )}

          {/* GOVERNMENT MAP TAB — live /api/government/officials, same as the Government tab */}
          {activeTab === 'government' && (
            officialsLoading || !officials ? (
              <ActivityIndicator size="large" color="#3B82F6" className="mt-8" />
            ) : (
              <>
                <DataFreshnessIndicator lastUpdated={officials.lastUpdated ?? null} />

                <PresidentialSuccessionSection succession={officials.succession} />

                <SupremeCourtJusticesSection justices={officials.judicial} />

                <GovernmentBranchSection
                  branch="executive"
                  holders={officials.executive}
                  departments={executiveDepts}
                  expanded={expandedBranches.executive}
                  onToggle={() => toggleBranch('executive')}
                />

                <GovernmentBranchSection
                  branch="legislative"
                  holders={officials.congressionalLeadership}
                  departments={legislativeDepts}
                  expanded={expandedBranches.legislative}
                  onToggle={() => toggleBranch('legislative')}
                />

                <GovernmentBranchSection
                  branch="judicial"
                  holders={officials.judicial}
                  departments={judicialDepts}
                  expanded={expandedBranches.judicial}
                  onToggle={() => toggleBranch('judicial')}
                />
              </>
            )
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
