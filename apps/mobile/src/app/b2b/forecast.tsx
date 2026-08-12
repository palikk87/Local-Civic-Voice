import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  TextInput,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Activity,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  CheckCircle,
  X,
  ChevronRight,
  Zap,
  Clock,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore, ForecastData } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

// Sample bills for forecasting
const SAMPLE_BILLS = [
  { id: 'hr-1049', name: 'SAVE Act', category: 'Election Security' },
  { id: 'hr-8281', name: 'Kids Online Safety Act', category: 'Technology' },
  { id: 's-686', name: 'TikTok Ban', category: 'Technology' },
  { id: 'hr-2', name: 'Secure the Border Act', category: 'Immigration' },
  { id: 'hr-3350', name: 'Medicare Drug Price Negotiation', category: 'Healthcare' },
];

const SAMPLE_ISSUES = [
  { id: 'healthcare', name: 'Healthcare', category: 'Policy' },
  { id: 'immigration', name: 'Immigration', category: 'Policy' },
  { id: 'economy', name: 'Economy', category: 'Policy' },
  { id: 'climate', name: 'Climate Change', category: 'Environment' },
  { id: 'education', name: 'Education', category: 'Policy' },
];

interface ForecastCardProps {
  item: { id: string; name: string; category: string };
  type: 'bill' | 'issue';
  onPress: () => void;
}

function ForecastCard({ item, type, onPress }: ForecastCardProps) {
  // Generate mock forecast data
  const currentSentiment = (Math.random() - 0.5) * 2;
  const projectedChange = (Math.random() - 0.3) * 0.5;
  const confidence = 0.6 + Math.random() * 0.35;
  const isRising = projectedChange > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-3"
    >
      <View className="flex-row items-start justify-between mb-3">
        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <View className={`px-2 py-0.5 rounded-full mr-2 ${
              type === 'bill' ? 'bg-indigo-500/20' : 'bg-emerald-500/20'
            }`}>
              <Text className={`text-xs ${
                type === 'bill' ? 'text-indigo-300' : 'text-emerald-300'
              }`}>
                {type === 'bill' ? 'Bill' : 'Issue'}
              </Text>
            </View>
            <Text className="text-slate-400 text-xs">{item.category}</Text>
          </View>
          <Text className="text-white font-semibold text-lg">{item.name}</Text>
        </View>
      </View>

      {/* Current vs Projected */}
      <View className="flex-row gap-3 mb-3">
        <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
          <Text className="text-slate-400 text-xs mb-1">Current</Text>
          <Text className={`font-bold text-lg ${
            currentSentiment > 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {currentSentiment > 0 ? '+' : ''}{(currentSentiment * 100).toFixed(1)}%
          </Text>
        </View>
        <View className="flex-1 bg-slate-700/30 rounded-xl p-3">
          <Text className="text-slate-400 text-xs mb-1">30-Day Projected</Text>
          <View className="flex-row items-center">
            {isRising ? (
              <TrendingUp size={16} color="#34D399" />
            ) : (
              <TrendingDown size={16} color="#EF4444" />
            )}
            <Text className={`font-bold text-lg ml-1 ${
              isRising ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {projectedChange > 0 ? '+' : ''}{(projectedChange * 100).toFixed(1)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Confidence & Action */}
      <View className="flex-row items-center justify-between pt-3 border-t border-slate-700/30">
        <View className="flex-row items-center">
          <View className={`w-2 h-2 rounded-full mr-2 ${
            confidence > 0.8 ? 'bg-emerald-500' : confidence > 0.6 ? 'bg-amber-500' : 'bg-red-500'
          }`} />
          <Text className="text-slate-400 text-sm">
            {(confidence * 100).toFixed(0)}% confidence
          </Text>
        </View>
        <View className="flex-row items-center">
          <Text className="text-indigo-400 text-sm">View forecast</Text>
          <ChevronRight size={16} color="#818CF8" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface ForecastDetailProps {
  forecast: ForecastData;
  onClose: () => void;
}

function ForecastDetail({ forecast, onClose }: ForecastDetailProps) {
  return (
    <View className="flex-1 bg-black/50 justify-end">
      <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[85%]">
        <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
        <View className="flex-row items-center justify-between mb-4">
          <Text className="text-white text-xl font-bold flex-1">Forecast Analysis</Text>
          <TouchableOpacity onPress={onClose}>
            <X size={24} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Current Sentiment */}
          <View className="bg-slate-700/30 rounded-xl p-4 mb-4">
            <Text className="text-slate-300 font-medium mb-2">Current Sentiment</Text>
            <Text className={`text-3xl font-bold ${
              forecast.currentSentiment > 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {forecast.currentSentiment > 0 ? '+' : ''}
              {(forecast.currentSentiment * 100).toFixed(1)}%
            </Text>
          </View>

          {/* Prediction Chart (Simplified) */}
          <View className="bg-slate-700/30 rounded-xl p-4 mb-4">
            <Text className="text-slate-300 font-medium mb-3">30-Day Projection</Text>
            <View className="h-32 flex-row items-end justify-between px-2">
              {forecast.predictions.map((pred, index) => {
                const height = Math.abs(pred.predicted) * 100;
                const isPositive = pred.predicted > 0;
                return (
                  <View key={index} className="items-center flex-1 mx-0.5">
                    <View
                      className={`w-full rounded-t-sm ${
                        isPositive ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                      style={{
                        height: `${Math.max(height, 10)}%`,
                        opacity: 0.5 + (pred.confidence * 0.5),
                      }}
                    />
                  </View>
                );
              })}
            </View>
            <View className="flex-row justify-between mt-2">
              <Text className="text-slate-500 text-xs">Now</Text>
              <Text className="text-slate-500 text-xs">+30 days</Text>
            </View>
          </View>

          {/* Impact Factors */}
          <View className="mb-4">
            <Text className="text-slate-300 font-medium mb-3">Impact Factors</Text>
            {forecast.factors.map((factor, index) => (
              <View
                key={index}
                className="flex-row items-center justify-between py-3 border-b border-slate-700/30"
              >
                <View className="flex-row items-center flex-1">
                  {factor.direction === 'positive' ? (
                    <CheckCircle size={16} color="#34D399" />
                  ) : (
                    <AlertTriangle size={16} color="#EF4444" />
                  )}
                  <Text className="text-white ml-2">{factor.factor}</Text>
                </View>
                <Text className={factor.direction === 'positive' ? 'text-emerald-400' : 'text-red-400'}>
                  {factor.impact > 0 ? '+' : ''}{(factor.impact * 100).toFixed(0)}%
                </Text>
              </View>
            ))}
          </View>

          {/* Recommendation */}
          <View className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mb-4">
            <View className="flex-row items-center mb-2">
              <Target size={16} color="#818CF8" />
              <Text className="text-indigo-300 font-medium ml-2">Recommendation</Text>
            </View>
            <Text className="text-slate-300">{forecast.recommendation}</Text>
          </View>

          {/* Disclaimer */}
          <View className="bg-slate-700/30 rounded-xl p-4">
            <View className="flex-row items-center mb-2">
              <Clock size={14} color="#64748B" />
              <Text className="text-slate-400 text-xs ml-2">Last updated: Just now</Text>
            </View>
            <Text className="text-slate-500 text-xs">
              Forecasts are based on historical trends and current engagement patterns.
              Actual outcomes may vary based on external events and policy changes.
            </Text>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

export default function B2BForecastScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'bills' | 'issues'>('bills');
  const [selectedForecast, setSelectedForecast] = useState<ForecastData | null>(null);

  const session = useB2BStore((s) => s.session);
  const fetchForecast = useB2BStore((s) => s.fetchForecast);

  const isEnterprise = session?.tier === 'enterprise';

  const onRefresh = async () => {
    setRefreshing(true);
    // In production, this would refresh forecast data
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setRefreshing(false);
  };

  const handleForecastPress = async (id: string, type: 'bill' | 'issue') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (!isEnterprise) {
      // Show upgrade prompt
      return;
    }

    const forecast = await fetchForecast(type, id);
    if (forecast) {
      setSelectedForecast(forecast);
    } else {
      // Generate mock forecast for demo
      setSelectedForecast({
        targetId: id,
        targetType: type,
        currentSentiment: (Math.random() - 0.5) * 2,
        predictions: Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() + i * 5 * 24 * 60 * 60 * 1000).toISOString(),
          predicted: (Math.random() - 0.5) * 2,
          confidence: 0.6 + Math.random() * 0.35,
          lowerBound: -0.5,
          upperBound: 0.5,
        })),
        factors: [
          { factor: 'Media Coverage', impact: 0.15, direction: 'positive' },
          { factor: 'Social Media Engagement', impact: 0.12, direction: 'positive' },
          { factor: 'Opposition Campaign', impact: -0.08, direction: 'negative' },
          { factor: 'Economic Conditions', impact: 0.05, direction: 'positive' },
        ],
        recommendation: 'Sentiment is projected to strengthen over the next 30 days. Consider timing public statements to align with peak engagement periods.',
      });
    }
  };

  const items = activeTab === 'bills' ? SAMPLE_BILLS : SAMPLE_ISSUES;
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.category.toLowerCase().includes(search.toLowerCase())
  );

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
            <Text className="text-white text-lg font-semibold">Forecasting</Text>
            <Text className="text-slate-400 text-sm">Predictive sentiment analysis</Text>
          </View>
          {!isEnterprise && (
            <View className="bg-amber-500/20 px-3 py-1 rounded-full">
              <Text className="text-amber-400 text-xs">Enterprise</Text>
            </View>
          )}
        </View>

        {/* Enterprise Notice */}
        {!isEnterprise && (
          <View className="mx-4 mt-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <View className="flex-row items-center mb-2">
              <Zap size={16} color="#FBBF24" />
              <Text className="text-amber-400 font-medium ml-2">Enterprise Feature</Text>
            </View>
            <Text className="text-slate-300 text-sm">
              Predictive forecasting is available on the Enterprise plan. Upgrade to access
              30-day sentiment projections and impact analysis.
            </Text>
          </View>
        )}

        {/* Tabs */}
        <View className="flex-row px-4 py-4 gap-2">
          <TouchableOpacity
            onPress={() => setActiveTab('bills')}
            className={`flex-1 py-3 rounded-xl items-center ${
              activeTab === 'bills' ? 'bg-indigo-500' : 'bg-slate-800/50'
            }`}
          >
            <Text className={activeTab === 'bills' ? 'text-white font-medium' : 'text-slate-400'}>
              Bills
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('issues')}
            className={`flex-1 py-3 rounded-xl items-center ${
              activeTab === 'issues' ? 'bg-indigo-500' : 'bg-slate-800/50'
            }`}
          >
            <Text className={activeTab === 'issues' ? 'text-white font-medium' : 'text-slate-400'}>
              Issues
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View className="px-4 mb-4">
          <View className="flex-row items-center bg-slate-800/50 rounded-xl px-4 py-2">
            <Search size={20} color="#64748B" />
            <TextInput
              className="flex-1 text-white ml-3 py-2"
              placeholder={`Search ${activeTab}...`}
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
        </View>

        {/* Forecast List */}
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#818CF8" />
          }
          showsVerticalScrollIndicator={false}
        >
          {filteredItems.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <Activity size={48} color="#475569" />
              <Text className="text-slate-400 text-lg mt-4">No forecasts available</Text>
            </View>
          ) : (
            filteredItems.map((item) => (
              <ForecastCard
                key={item.id}
                item={item}
                type={activeTab === 'bills' ? 'bill' : 'issue'}
                onPress={() => handleForecastPress(item.id, activeTab === 'bills' ? 'bill' : 'issue')}
              />
            ))
          )}
          <View className="h-8" />
        </ScrollView>

        {/* Forecast Detail Modal */}
        {selectedForecast && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          >
            <ForecastDetail
              forecast={selectedForecast}
              onClose={() => setSelectedForecast(null)}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}
