import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Dimensions,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Map,
  Filter,
  X,
  TrendingUp,
  TrendingDown,
  Users,
  Vote,
  ChevronDown,
  Info,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

// US State coordinates for simplified map
const STATE_POSITIONS: Record<string, { x: number; y: number; width: number; height: number }> = {
  'WA': { x: 45, y: 20, width: 45, height: 35 },
  'OR': { x: 40, y: 55, width: 50, height: 40 },
  'CA': { x: 30, y: 95, width: 45, height: 85 },
  'NV': { x: 65, y: 80, width: 40, height: 55 },
  'ID': { x: 95, y: 35, width: 40, height: 60 },
  'MT': { x: 135, y: 20, width: 70, height: 45 },
  'WY': { x: 145, y: 65, width: 55, height: 40 },
  'UT': { x: 105, y: 95, width: 40, height: 50 },
  'AZ': { x: 95, y: 145, width: 50, height: 55 },
  'CO': { x: 155, y: 105, width: 55, height: 45 },
  'NM': { x: 145, y: 150, width: 50, height: 55 },
  'ND': { x: 205, y: 25, width: 55, height: 35 },
  'SD': { x: 205, y: 60, width: 55, height: 35 },
  'NE': { x: 195, y: 95, width: 65, height: 35 },
  'KS': { x: 205, y: 130, width: 60, height: 35 },
  'OK': { x: 210, y: 165, width: 55, height: 35 },
  'TX': { x: 195, y: 200, width: 85, height: 90 },
  'MN': { x: 260, y: 30, width: 50, height: 55 },
  'IA': { x: 270, y: 85, width: 45, height: 35 },
  'MO': { x: 275, y: 120, width: 50, height: 45 },
  'AR': { x: 280, y: 165, width: 40, height: 35 },
  'LA': { x: 285, y: 210, width: 40, height: 40 },
  'WI': { x: 310, y: 40, width: 40, height: 50 },
  'IL': { x: 315, y: 90, width: 35, height: 60 },
  'MS': { x: 320, y: 180, width: 30, height: 50 },
  'MI': { x: 335, y: 35, width: 50, height: 55 },
  'IN': { x: 350, y: 95, width: 30, height: 45 },
  'KY': { x: 355, y: 140, width: 50, height: 30 },
  'TN': { x: 345, y: 165, width: 60, height: 25 },
  'AL': { x: 355, y: 190, width: 30, height: 45 },
  'OH': { x: 380, y: 90, width: 35, height: 40 },
  'WV': { x: 395, y: 120, width: 30, height: 30 },
  'VA': { x: 405, y: 135, width: 50, height: 30 },
  'NC': { x: 400, y: 165, width: 55, height: 25 },
  'SC': { x: 405, y: 190, width: 35, height: 30 },
  'GA': { x: 385, y: 200, width: 40, height: 45 },
  'FL': { x: 395, y: 245, width: 50, height: 60 },
  'PA': { x: 410, y: 80, width: 45, height: 30 },
  'NY': { x: 420, y: 50, width: 50, height: 35 },
  'VT': { x: 455, y: 30, width: 20, height: 25 },
  'NH': { x: 470, y: 35, width: 15, height: 30 },
  'ME': { x: 480, y: 15, width: 30, height: 45 },
  'MA': { x: 470, y: 60, width: 25, height: 15 },
  'RI': { x: 475, y: 75, width: 12, height: 12 },
  'CT': { x: 460, y: 75, width: 18, height: 15 },
  'NJ': { x: 455, y: 85, width: 15, height: 25 },
  'DE': { x: 450, y: 110, width: 12, height: 18 },
  'MD': { x: 430, y: 115, width: 25, height: 15 },
  'DC': { x: 432, y: 125, width: 8, height: 8 },
  'AK': { x: 30, y: 250, width: 70, height: 50 },
  'HI': { x: 120, y: 280, width: 50, height: 30 },
};

interface StateBoxProps {
  stateCode: string;
  sentiment: number;
  engagement: number;
  isSelected: boolean;
  onPress: () => void;
}

function StateBox({ stateCode, sentiment, engagement, isSelected, onPress }: StateBoxProps) {
  const pos = STATE_POSITIONS[stateCode];
  if (!pos) return null;

  // Color based on sentiment (-1 to 1 scale)
  const getColor = () => {
    if (sentiment > 0.3) return '#22C55E'; // Strong support - green
    if (sentiment > 0.1) return '#86EFAC'; // Moderate support - light green
    if (sentiment > -0.1) return '#64748B'; // Neutral - gray
    if (sentiment > -0.3) return '#FCA5A5'; // Moderate oppose - light red
    return '#EF4444'; // Strong oppose - red
  };

  // Opacity based on engagement
  const opacity = Math.min(0.4 + (engagement / 10000) * 0.6, 1);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        position: 'absolute',
        left: pos.x * (width - 32) / 520,
        top: pos.y * 280 / 320,
        width: pos.width * (width - 32) / 520,
        height: pos.height * 280 / 320,
        backgroundColor: getColor(),
        opacity: opacity,
        borderRadius: 4,
        borderWidth: isSelected ? 2 : 0,
        borderColor: '#FFF',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#FFF', fontSize: 8, fontWeight: 'bold' }}>{stateCode}</Text>
    </TouchableOpacity>
  );
}

export default function B2BHeatmapScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [partyFilter, setPartyFilter] = useState<string | null>(null);

  const states = useB2BStore((s) => s.states);
  const heatmapData = useB2BStore((s) => s.heatmapData);
  const fetchStates = useB2BStore((s) => s.fetchStates);
  const fetchHeatmapData = useB2BStore((s) => s.fetchHeatmapData);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    fetchHeatmapData({
      category: categoryFilter || undefined,
      party: partyFilter || undefined,
    });
  }, [categoryFilter, partyFilter]);

  const loadData = async () => {
    await Promise.all([
      fetchStates(),
      fetchHeatmapData(),
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Aggregate district data to state level
  const stateData = useMemo(() => {
    const aggregated: Record<string, { sentiment: number; engagement: number; count: number }> = {};

    heatmapData?.districts?.forEach((district) => {
      const stateCode = district.districtId.split('-')[0];
      if (!aggregated[stateCode]) {
        aggregated[stateCode] = { sentiment: 0, engagement: 0, count: 0 };
      }
      aggregated[stateCode].sentiment += district.sentiment;
      aggregated[stateCode].engagement += district.value;
      aggregated[stateCode].count += 1;
    });

    // Average the sentiment
    Object.keys(aggregated).forEach((state) => {
      if (aggregated[state].count > 0) {
        aggregated[state].sentiment /= aggregated[state].count;
      }
    });

    return aggregated;
  }, [heatmapData]);

  const selectedStateData = selectedState ? states.find((s) => s.stateCode === selectedState) : null;

  const categories = [
    'Healthcare', 'Economy', 'Immigration', 'Environment', 'Education',
    'Civil Rights', 'Defense', 'Technology', 'Housing', 'Crime',
  ];

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
            <Text className="text-white text-lg font-semibold">District Heatmap</Text>
            <Text className="text-slate-400 text-sm">Geographic sentiment analysis</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowFilters(true)}
            className="p-2 bg-slate-800/50 rounded-xl"
          >
            <Filter size={20} color="#818CF8" />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#818CF8" />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Active Filters */}
          {(categoryFilter || partyFilter) && (
            <View className="flex-row flex-wrap px-4 py-2 gap-2">
              {categoryFilter && (
                <TouchableOpacity
                  onPress={() => setCategoryFilter(null)}
                  className="flex-row items-center bg-indigo-500/20 px-3 py-1 rounded-full"
                >
                  <Text className="text-indigo-300 text-sm">{categoryFilter}</Text>
                  <X size={14} color="#A5B4FC" className="ml-1" />
                </TouchableOpacity>
              )}
              {partyFilter && (
                <TouchableOpacity
                  onPress={() => setPartyFilter(null)}
                  className="flex-row items-center bg-indigo-500/20 px-3 py-1 rounded-full"
                >
                  <Text className="text-indigo-300 text-sm">
                    {partyFilter === 'D' ? 'Democrat' : partyFilter === 'R' ? 'Republican' : 'Independent'}
                  </Text>
                  <X size={14} color="#A5B4FC" className="ml-1" />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Map Container */}
          <View className="px-4 py-4">
            <View
              className="bg-slate-800/30 border border-slate-700/50 rounded-2xl overflow-hidden"
              style={{ height: 300, position: 'relative' }}
            >
              {/* Render states */}
              {Object.keys(STATE_POSITIONS).map((stateCode) => {
                const data = stateData[stateCode] || { sentiment: 0, engagement: 100 };
                return (
                  <StateBox
                    key={stateCode}
                    stateCode={stateCode}
                    sentiment={data.sentiment}
                    engagement={data.engagement}
                    isSelected={selectedState === stateCode}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSelectedState(selectedState === stateCode ? null : stateCode);
                    }}
                  />
                );
              })}
            </View>

            {/* Legend */}
            <View className="flex-row items-center justify-center mt-4 gap-3">
              <View className="flex-row items-center">
                <View className="w-4 h-4 rounded bg-emerald-500 mr-1" />
                <Text className="text-slate-400 text-xs">Support</Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-4 h-4 rounded bg-slate-500 mr-1" />
                <Text className="text-slate-400 text-xs">Neutral</Text>
              </View>
              <View className="flex-row items-center">
                <View className="w-4 h-4 rounded bg-red-500 mr-1" />
                <Text className="text-slate-400 text-xs">Oppose</Text>
              </View>
            </View>
          </View>

          {/* Selected State Details */}
          {selectedStateData && (
            <View className="px-4 mb-4">
              <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-white text-lg font-bold">{selectedStateData.name}</Text>
                  <View className={`flex-row items-center px-2 py-1 rounded-full ${
                    selectedStateData.sentiment.overall > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
                  }`}>
                    {selectedStateData.sentiment.overall > 0 ? (
                      <TrendingUp size={14} color="#34D399" />
                    ) : (
                      <TrendingDown size={14} color="#EF4444" />
                    )}
                    <Text className={`ml-1 font-medium ${
                      selectedStateData.sentiment.overall > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {(selectedStateData.sentiment.overall * 100).toFixed(1)}%
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-3 mb-4">
                  <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Vote size={14} color="#818CF8" />
                      <Text className="text-slate-400 text-xs ml-1">Votes</Text>
                    </View>
                    <Text className="text-white font-bold text-lg">
                      {selectedStateData.engagement.totalVotes.toLocaleString()}
                    </Text>
                  </View>
                  <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
                    <View className="flex-row items-center mb-1">
                      <Users size={14} color="#34D399" />
                      <Text className="text-slate-400 text-xs ml-1">Active Users</Text>
                    </View>
                    <Text className="text-white font-bold text-lg">
                      {selectedStateData.engagement.activeUsers.toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Top Issues */}
                <Text className="text-slate-300 font-medium mb-2">Top Issues</Text>
                {selectedStateData.topIssues?.slice(0, 3).map((issue, index) => (
                  <View
                    key={issue.id}
                    className="flex-row items-center justify-between py-2 border-b border-slate-700/30"
                  >
                    <Text className="text-white">{issue.name}</Text>
                    <View className={`px-2 py-1 rounded-full ${
                      issue.sentiment > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
                    }`}>
                      <Text className={`text-xs font-medium ${
                        issue.sentiment > 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {issue.sentiment > 0 ? '+' : ''}{(issue.sentiment * 100).toFixed(0)}%
                      </Text>
                    </View>
                  </View>
                ))}

                <TouchableOpacity
                  onPress={() => router.push(`/b2b/state/${selectedState}`)}
                  className="mt-4 bg-indigo-500/20 py-3 rounded-xl items-center"
                >
                  <Text className="text-indigo-400 font-medium">View Full Analysis</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* State List */}
          <View className="px-4 mb-8">
            <Text className="text-white text-lg font-bold mb-3">All States</Text>
            {states
              .sort((a, b) => Math.abs(b.sentiment.overall) - Math.abs(a.sentiment.overall))
              .slice(0, 10)
              .map((state) => (
                <TouchableOpacity
                  key={state.stateCode}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedState(state.stateCode);
                  }}
                  className="flex-row items-center justify-between py-3 border-b border-slate-700/30"
                >
                  <View className="flex-row items-center">
                    <View className={`w-3 h-3 rounded-full mr-3 ${
                      state.sentiment.overall > 0.1 ? 'bg-emerald-500' :
                      state.sentiment.overall < -0.1 ? 'bg-red-500' : 'bg-slate-500'
                    }`} />
                    <Text className="text-white font-medium">{state.name}</Text>
                  </View>
                  <View className="flex-row items-center">
                    <Text className="text-slate-400 text-sm mr-2">
                      {state.engagement.totalVotes.toLocaleString()} votes
                    </Text>
                    <Text className={`font-medium ${
                      state.sentiment.overall > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {state.sentiment.overall > 0 ? '+' : ''}{(state.sentiment.overall * 100).toFixed(1)}%
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
          </View>
        </ScrollView>

        {/* Filter Modal */}
        <Modal
          visible={showFilters}
          transparent
          animationType="slide"
          onRequestClose={() => setShowFilters(false)}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[70%]">
              <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
              <View className="flex-row items-center justify-between mb-4">
                <Text className="text-white text-xl font-bold">Filters</Text>
                <TouchableOpacity onPress={() => setShowFilters(false)}>
                  <X size={24} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Category Filter */}
                <Text className="text-slate-400 mb-2">Issue Category</Text>
                <View className="flex-row flex-wrap gap-2 mb-6">
                  {categories.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                      className={`px-4 py-2 rounded-full ${
                        categoryFilter === cat ? 'bg-indigo-500' : 'bg-slate-700'
                      }`}
                    >
                      <Text className={categoryFilter === cat ? 'text-white' : 'text-slate-300'}>
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Party Filter */}
                <Text className="text-slate-400 mb-2">District Party</Text>
                <View className="flex-row gap-2 mb-6">
                  <TouchableOpacity
                    onPress={() => setPartyFilter(partyFilter === 'D' ? null : 'D')}
                    className={`flex-1 py-3 rounded-xl items-center ${
                      partyFilter === 'D' ? 'bg-blue-500' : 'bg-slate-700'
                    }`}
                  >
                    <Text className="text-white font-medium">Democrat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPartyFilter(partyFilter === 'R' ? null : 'R')}
                    className={`flex-1 py-3 rounded-xl items-center ${
                      partyFilter === 'R' ? 'bg-red-500' : 'bg-slate-700'
                    }`}
                  >
                    <Text className="text-white font-medium">Republican</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPartyFilter(partyFilter === 'I' ? null : 'I')}
                    className={`flex-1 py-3 rounded-xl items-center ${
                      partyFilter === 'I' ? 'bg-purple-500' : 'bg-slate-700'
                    }`}
                  >
                    <Text className="text-white font-medium">Independent</Text>
                  </TouchableOpacity>
                </View>

                {/* Apply Button */}
                <TouchableOpacity
                  onPress={() => setShowFilters(false)}
                  className="bg-indigo-500 py-4 rounded-xl items-center"
                >
                  <Text className="text-white font-bold">Apply Filters</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}
