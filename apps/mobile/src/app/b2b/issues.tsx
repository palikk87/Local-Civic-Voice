import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  TextInput,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Target,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Users,
  MapPin,
  X,
  ChevronRight,
  Filter,
  Zap,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore, IssueData } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

interface IssueCardProps {
  issue: IssueData;
  onPress: () => void;
}

function IssueCard({ issue, onPress }: IssueCardProps) {
  const sentiment = issue.sentiment;
  const isPositive = sentiment.score > 0;

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Healthcare': '#EF4444',
      'Economy': '#F59E0B',
      'Immigration': '#8B5CF6',
      'Environment': '#22C55E',
      'Education': '#3B82F6',
      'Civil Rights': '#EC4899',
      'Defense': '#6E8A7C',
      'Technology': '#06B6D4',
      'Housing': '#F97316',
      'Crime': '#DC2626',
    };
    return colors[category] || '#6E8A7C';
  };

  const categoryColor = getCategoryColor(issue.category);

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <View
              className="w-3 h-3 rounded-full mr-2"
              style={{ backgroundColor: categoryColor }}
            />
            <Text className="text-slate-400 text-xs">{issue.category}</Text>
          </View>
          <Text className="text-white font-semibold text-lg">{issue.name}</Text>
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
            {isPositive ? '+' : ''}{(sentiment.score * 100).toFixed(1)}%
          </Text>
        </View>
      </View>

      {/* Sentiment Bar */}
      <View className="mb-3">
        <View className="flex-row justify-between mb-1">
          <Text className="text-emerald-400 text-xs">{sentiment.support.toLocaleString()} Support</Text>
          <Text className="text-red-400 text-xs">{sentiment.oppose.toLocaleString()} Oppose</Text>
        </View>
        <View className="h-2 bg-slate-700 rounded-full overflow-hidden flex-row">
          <View
            className="h-full bg-emerald-500"
            style={{ width: `${(sentiment.support / sentiment.total) * 100}%` }}
          />
          <View
            className="h-full bg-red-500"
            style={{ width: `${(sentiment.oppose / sentiment.total) * 100}%` }}
          />
        </View>
      </View>

      {/* Stats Row */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-4">
          <View className="flex-row items-center">
            <BarChart3 size={14} color="#6E8A7C" />
            <Text className="text-slate-400 text-sm ml-1">{issue.relatedBills} bills</Text>
          </View>
          <View className="flex-row items-center">
            <Users size={14} color="#6E8A7C" />
            <Text className="text-slate-400 text-sm ml-1">{sentiment.total.toLocaleString()} votes</Text>
          </View>
        </View>

        {/*
          Nothing at all when there is no measured direction, rather than a grey
          "stable" pill. "Stable" is a finding; the absence of a second
          measurement is not.
        */}
        {sentiment.trend === 'rising' || sentiment.trend === 'falling' ? (
          <View className={`flex-row items-center px-2 py-1 rounded-full ${
            sentiment.trend === 'rising' ? 'bg-emerald-500/10' : 'bg-red-500/10'
          }`}>
            {sentiment.trend === 'rising' ? (
              <Zap size={12} color="#34D399" />
            ) : (
              <TrendingDown size={12} color="#EF4444" />
            )}
            <Text className={`text-xs ml-1 capitalize ${
              sentiment.trend === 'rising' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {sentiment.trend}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Hotspots */}
      {issue.hotspots && issue.hotspots.length > 0 && (
        <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/30">
          <MapPin size={12} color="#6E8A7C" />
          <Text className="text-slate-400 text-xs ml-1">
            Hotspots: {issue.hotspots.slice(0, 3).join(', ')}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function B2BIssuesScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  /*
   * "Trending" is gone. It sorted on sentiment.trend, which the API derived
   * from the current score rather than from any movement, so it duplicated
   * Sentiment while claiming to measure direction. Nothing records an earlier
   * score to compare against yet.
   */
  const [sortBy, setSortBy] = useState<'sentiment' | 'volume'>('volume');
  const [selectedIssue, setSelectedIssue] = useState<IssueData | null>(null);

  const issues = useB2BStore((s) => s.issues);
  const fetchIssues = useB2BStore((s) => s.fetchIssues);
  const fetchIssueDetails = useB2BStore((s) => s.fetchIssueDetails);

  useEffect(() => {
    fetchIssues();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchIssues();
    setRefreshing(false);
  };

  const handleIssuePress = async (issue: IssueData) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const details = await fetchIssueDetails(issue.id);
    if (details) {
      setSelectedIssue(details);
    }
  };

  // Filter and sort issues
  const filteredIssues = issues
    .filter((issue) =>
      issue.name.toLowerCase().includes(search.toLowerCase()) ||
      issue.category.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sortBy) {
        case 'sentiment':
          return Math.abs(b.sentiment.score) - Math.abs(a.sentiment.score);
        case 'volume':
          return b.sentiment.total - a.sentiment.total;
        default:
          return 0;
      }
    });

  const sortOptions = [
    { key: 'volume', label: 'Volume' },
    { key: 'sentiment', label: 'Sentiment' },
  ];

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0C1D18', '#1E1B4B', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#8FA79A" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Issue Tracker</Text>
            <Text className="text-slate-400 text-sm">Track sentiment by policy area</Text>
          </View>
        </View>

        {/* Search & Sort */}
        <View className="px-4 py-3">
          <View className="flex-row items-center bg-slate-800/50 rounded-xl px-4 py-2 mb-3">
            <Search size={20} color="#6E8A7C" />
            <TextInput
              className="flex-1 text-white ml-3 py-2"
              placeholder="Search issues..."
              placeholderTextColor="#6E8A7C"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <X size={18} color="#6E8A7C" />
              </TouchableOpacity>
            )}
          </View>

          {/* Sort Options */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
            {sortOptions.map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => setSortBy(option.key as 'sentiment' | 'volume')}
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

        {/* Issues List */}
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#818CF8" />
          }
          showsVerticalScrollIndicator={false}
        >
          {filteredIssues.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <Target size={48} color="#4C6659" />
              <Text className="text-slate-400 text-lg mt-4">No issues found</Text>
            </View>
          ) : (
            filteredIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onPress={() => handleIssuePress(issue)}
              />
            ))
          )}
          <View className="h-8" />
        </ScrollView>

        {/* Issue Detail Modal */}
        <Modal
          visible={!!selectedIssue}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedIssue(null)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[80%]">
              <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-white text-xl font-bold flex-1">{selectedIssue?.name}</Text>
                <TouchableOpacity onPress={() => setSelectedIssue(null)}>
                  <X size={24} color="#8FA79A" />
                </TouchableOpacity>
              </View>

              {selectedIssue && (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Sentiment Summary */}
                  <View className="bg-slate-700/30 rounded-xl p-4 mb-4">
                    <View className="flex-row items-center justify-between mb-3">
                      <Text className="text-slate-300 font-medium">Overall Sentiment</Text>
                      <View className={`flex-row items-center px-3 py-1 rounded-full ${
                        selectedIssue.sentiment.score > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
                      }`}>
                        {selectedIssue.sentiment.score > 0 ? (
                          <TrendingUp size={14} color="#34D399" />
                        ) : (
                          <TrendingDown size={14} color="#EF4444" />
                        )}
                        <Text className={`ml-1 font-bold ${
                          selectedIssue.sentiment.score > 0 ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {selectedIssue.sentiment.score > 0 ? '+' : ''}
                          {(selectedIssue.sentiment.score * 100).toFixed(1)}%
                        </Text>
                      </View>
                    </View>

                    <View className="flex-row justify-between mb-2">
                      <Text className="text-emerald-400">
                        Support: {selectedIssue.sentiment.support.toLocaleString()}
                      </Text>
                      <Text className="text-red-400">
                        Oppose: {selectedIssue.sentiment.oppose.toLocaleString()}
                      </Text>
                    </View>
                    <View className="h-3 bg-slate-600 rounded-full overflow-hidden flex-row">
                      <View
                        className="h-full bg-emerald-500"
                        style={{ width: `${(selectedIssue.sentiment.support / selectedIssue.sentiment.total) * 100}%` }}
                      />
                      <View
                        className="h-full bg-red-500"
                        style={{ width: `${(selectedIssue.sentiment.oppose / selectedIssue.sentiment.total) * 100}%` }}
                      />
                    </View>
                  </View>

                  {/* Stats */}
                  <View className="flex-row gap-3 mb-4">
                    <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
                      <Text className="text-slate-400 text-xs">Total Votes</Text>
                      <Text className="text-white font-bold text-lg">
                        {selectedIssue.sentiment.total.toLocaleString()}
                      </Text>
                    </View>
                    <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
                      <Text className="text-slate-400 text-xs">Related Bills</Text>
                      <Text className="text-white font-bold text-lg">
                        {selectedIssue.relatedBills}
                      </Text>
                    </View>
                    {/*
                      WAS "Confidence — 85%": the literal 0.85, written into the
                      API for any issue with more than ten votes. It read as a
                      statistical confidence level and stood on nothing. The
                      honest version of that panel is how many people the number
                      is based on.
                    */}
                    <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
                      <Text className="text-slate-400 text-xs">Votes counted</Text>
                      <Text className="text-white font-bold text-lg">
                        {(selectedIssue.sentiment.total ?? 0).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {/* Hotspots */}
                  {selectedIssue.hotspots && selectedIssue.hotspots.length > 0 && (
                    <View className="mb-4">
                      <Text className="text-slate-300 font-medium mb-2">Geographic Hotspots</Text>
                      <View className="flex-row flex-wrap gap-2">
                        {selectedIssue.hotspots.map((hotspot, index) => (
                          <View
                            key={index}
                            className="bg-indigo-500/20 px-3 py-1 rounded-full"
                          >
                            <Text className="text-indigo-300 text-sm">{hotspot}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Actions */}
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedIssue(null);
                      router.push(`/b2b/issue/${selectedIssue.id}`);
                    }}
                    className="bg-indigo-500 py-4 rounded-xl items-center mt-2"
                  >
                    <Text className="text-white font-bold">View Full Analysis</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
