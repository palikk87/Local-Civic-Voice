import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  Vote,
  FileText,
  X,
  ChevronRight,
  MapPin,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore, StateData } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

interface StateCardProps {
  state: StateData;
  onPress: () => void;
  rank: number;
}

function StateCard({ state, onPress, rank }: StateCardProps) {
  const isPositive = state.sentiment.overall > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <View className="w-8 h-8 bg-indigo-500/20 rounded-lg items-center justify-center mr-3">
            <Text className="text-indigo-400 font-bold">{rank}</Text>
          </View>
          <View>
            <Text className="text-white font-semibold text-lg">{state.name}</Text>
            <Text className="text-slate-400 text-sm">{state.totalDistricts} districts</Text>
          </View>
        </View>
        <View className={`flex-row items-center px-3 py-1 rounded-full ${
          isPositive ? 'bg-emerald-500/20' : 'bg-red-500/20'
        }`}>
          {isPositive ? (
            <TrendingUp size={14} color="#34D399" />
          ) : (
            <TrendingDown size={14} color="#EF4444" />
          )}
          <Text className={`ml-1 font-bold ${
            isPositive ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {isPositive ? '+' : ''}{(state.sentiment.overall * 100).toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Stats Row */}
      <View className="flex-row gap-3 mb-3">
        <View className="flex-1 bg-slate-700/30 rounded-xl p-2">
          <View className="flex-row items-center">
            <Vote size={12} color="#818CF8" />
            <Text className="text-slate-400 text-xs ml-1">Votes</Text>
          </View>
          <Text className="text-white font-bold">
            {state.engagement.totalVotes.toLocaleString()}
          </Text>
        </View>
        <View className="flex-1 bg-slate-700/30 rounded-xl p-2">
          <View className="flex-row items-center">
            <Users size={12} color="#34D399" />
            <Text className="text-slate-400 text-xs ml-1">Active</Text>
          </View>
          <Text className="text-white font-bold">
            {state.engagement.activeUsers.toLocaleString()}
          </Text>
        </View>
        <View className="flex-1 bg-slate-700/30 rounded-xl p-2">
          <View className="flex-row items-center">
            <FileText size={12} color="#FBBF24" />
            <Text className="text-slate-400 text-xs ml-1">Posts</Text>
          </View>
          <Text className="text-white font-bold">
            {state.engagement.postsCreated.toLocaleString()}
          </Text>
        </View>
      </View>

      {/* Top Issues */}
      {state.topIssues && state.topIssues.length > 0 && (
        <View className="flex-row items-center pt-3 border-t border-slate-700/30">
          <Text className="text-slate-400 text-xs mr-2">Top:</Text>
          {state.topIssues.slice(0, 3).map((issue, index) => (
            <View
              key={issue.id}
              className={`px-2 py-0.5 rounded-full mr-1 ${
                issue.sentiment > 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'
              }`}
            >
              <Text className={`text-xs ${
                issue.sentiment > 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {issue.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function B2BStatesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'engagement' | 'sentiment' | 'alphabetical'>('engagement');

  const states = useB2BStore((s) => s.states);
  const fetchStates = useB2BStore((s) => s.fetchStates);

  useEffect(() => {
    fetchStates();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStates();
    setRefreshing(false);
  };

  // Filter and sort states
  const filteredStates = states
    .filter((state) =>
      state.name.toLowerCase().includes(search.toLowerCase()) ||
      state.stateCode.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'engagement':
          return b.engagement.totalVotes - a.engagement.totalVotes;
        case 'sentiment':
          return Math.abs(b.sentiment.overall) - Math.abs(a.sentiment.overall);
        case 'alphabetical':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

  const sortOptions = [
    { key: 'engagement', label: 'Engagement' },
    { key: 'sentiment', label: 'Sentiment' },
    { key: 'alphabetical', label: 'A-Z' },
  ];

  // Summary stats
  const totalVotes = states.reduce((sum, s) => sum + s.engagement.totalVotes, 0);
  const totalActiveUsers = states.reduce((sum, s) => sum + s.engagement.activeUsers, 0);
  const avgSentiment = states.length > 0
    ? states.reduce((sum, s) => sum + s.sentiment.overall, 0) / states.length
    : 0;

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">State Analysis</Text>
            <Text className="text-slate-400 text-sm">State-by-state breakdown</Text>
          </View>
        </View>

        {/* Summary Stats */}
        <View className="px-4 py-4">
          <View className="flex-row gap-3 mb-4">
            <View className="flex-1 bg-slate-800/30 border border-slate-700/50 rounded-xl p-3">
              <Text className="text-slate-400 text-xs">Total Votes</Text>
              <Text className="text-white font-bold text-xl">{totalVotes.toLocaleString()}</Text>
            </View>
            <View className="flex-1 bg-slate-800/30 border border-slate-700/50 rounded-xl p-3">
              <Text className="text-slate-400 text-xs">Active Users</Text>
              <Text className="text-white font-bold text-xl">{totalActiveUsers.toLocaleString()}</Text>
            </View>
            <View className="flex-1 bg-slate-800/30 border border-slate-700/50 rounded-xl p-3">
              <Text className="text-slate-400 text-xs">Avg Sentiment</Text>
              <Text className={`font-bold text-xl ${avgSentiment > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {avgSentiment > 0 ? '+' : ''}{(avgSentiment * 100).toFixed(1)}%
              </Text>
            </View>
          </View>

          {/* Search */}
          <View className="flex-row items-center bg-slate-800/50 rounded-xl px-4 py-2 mb-3">
            <Search size={20} color="#64748B" />
            <TextInput
              className="flex-1 text-white ml-3 py-2"
              placeholder="Search states..."
              placeholderTextColor="#64748B"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <X size={18} color="#64748B" />
              </TouchableOpacity>
            )}
          </View>

          {/* Sort Options */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {sortOptions.map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => setSortBy(option.key as 'engagement' | 'sentiment' | 'alphabetical')}
                className={`px-4 py-2 rounded-full mx-1 ${
                  sortBy === option.key ? 'bg-indigo-500' : 'bg-slate-800/50'
                }`}
              >
                <Text className={sortBy === option.key ? 'text-white font-medium' : 'text-slate-400'}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* States List */}
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#818CF8" />
          }
          showsVerticalScrollIndicator={false}
        >
          {filteredStates.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <Building2 size={48} color="#475569" />
              <Text className="text-slate-400 text-lg mt-4">No states found</Text>
            </View>
          ) : (
            filteredStates.map((state, index) => (
              <StateCard
                key={state.stateCode}
                state={state}
                rank={index + 1}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/b2b/state/${state.stateCode}`);
                }}
              />
            ))
          )}
          <View className="h-8" />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
