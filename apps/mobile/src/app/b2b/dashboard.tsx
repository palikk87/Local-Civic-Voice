import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  BarChart3,
  Map,
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  MessageSquare,
  Vote,
  LogOut,
  ChevronRight,
  Activity,
  Target,
  Zap,
  Globe,
  Building2,
  AlertCircle,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useB2BStore } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  color: string;
}

function MetricCard({ title, value, change, icon, color }: MetricCardProps) {
  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 flex-1 min-w-[45%] m-1">
      <View className="flex-row items-center justify-between mb-2">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          {icon}
        </View>
        {change !== undefined && (
          <View className={`flex-row items-center px-2 py-1 rounded-full ${
            isPositive ? 'bg-emerald-500/20' : isNegative ? 'bg-red-500/20' : 'bg-slate-700/50'
          }`}>
            {isPositive ? (
              <TrendingUp size={12} color="#34D399" />
            ) : isNegative ? (
              <TrendingDown size={12} color="#EF4444" />
            ) : null}
            <Text className={`text-xs ml-1 font-medium ${
              isPositive ? 'text-emerald-400' : isNegative ? 'text-red-400' : 'text-slate-400'
            }`}>
              {isPositive ? '+' : ''}{change}%
            </Text>
          </View>
        )}
      </View>
      <Text className="text-2xl font-bold text-white">{value}</Text>
      <Text className="text-slate-400 text-sm mt-1">{title}</Text>
    </View>
  );
}

interface SentimentBarProps {
  label: string;
  support: number;
  oppose: number;
}

function SentimentBar({ label, support, oppose }: SentimentBarProps) {
  const total = support + oppose;
  const supportPercent = total > 0 ? (support / total) * 100 : 50;

  return (
    <View className="mb-4">
      <View className="flex-row justify-between mb-1">
        <Text className="text-slate-300 text-sm font-medium">{label}</Text>
        <Text className="text-slate-400 text-xs">
          {support.toLocaleString()} vs {oppose.toLocaleString()}
        </Text>
      </View>
      <View className="h-3 bg-slate-700 rounded-full overflow-hidden flex-row">
        <View
          className="h-full bg-emerald-500 rounded-l-full"
          style={{ width: `${supportPercent}%` }}
        />
        <View
          className="h-full bg-red-500 rounded-r-full"
          style={{ width: `${100 - supportPercent}%` }}
        />
      </View>
    </View>
  );
}

interface QuickLinkProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  gradient: string[];
}

function QuickLink({ title, subtitle, icon, onPress, gradient }: QuickLinkProps) {
  return (
    <TouchableOpacity onPress={onPress} className="mb-3">
      <LinearGradient
        colors={gradient as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 16, padding: 16 }}
      >
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <View className="w-12 h-12 bg-white/10 rounded-xl items-center justify-center mr-3">
              {icon}
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold text-base">{title}</Text>
              <Text className="text-white/70 text-sm">{subtitle}</Text>
            </View>
          </View>
          <ChevronRight size={20} color="white" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default function B2BDashboardScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const session = useB2BStore((s) => s.session);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const sentimentOverview = useB2BStore((s) => s.sentimentOverview);
  const trendingTopics = useB2BStore((s) => s.trendingTopics);
  const fetchSentimentOverview = useB2BStore((s) => s.fetchSentimentOverview);
  const fetchTrendingTopics = useB2BStore((s) => s.fetchTrendingTopics);
  const logout = useB2BStore((s) => s.logout);
  const verifySession = useB2BStore((s) => s.verifySession);

  useEffect(() => {
    if (hasHydrated) {
      checkAuth();
    }
  }, [hasHydrated]);

  const checkAuth = async () => {
    const isValid = await verifySession();
    if (!isValid) {
      router.replace('/b2b/login');
      return;
    }
    await loadData();
  };

  const loadData = async () => {
    await Promise.all([
      fetchSentimentOverview(),
      fetchTrendingTopics(),
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logout();
    router.replace('/b2b/login');
  };

  if (!hasHydrated || !isAuthenticated) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
    );
  }

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'enterprise':
        return { color: 'bg-purple-500', label: 'Enterprise' };
      case 'professional':
        return { color: 'bg-blue-500', label: 'Professional' };
      default:
        return { color: 'bg-slate-500', label: 'Basic' };
    }
  };

  const tierBadge = getTierBadge(session?.tier || 'basic');

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        {/* Header */}
        <View className="px-4 py-3 border-b border-slate-800/50">
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <TouchableOpacity
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace('/(tabs)/profile');
                  }
                }}
                className="p-2 -ml-2 mr-1"
              >
                <ArrowLeft size={22} color="#94A3B8" />
              </TouchableOpacity>
              <View className="w-10 h-10 bg-indigo-500/20 rounded-xl items-center justify-center">
                <BarChart3 size={20} color="#818CF8" />
              </View>
              <View className="ml-3">
                <Text className="text-white text-lg font-bold">Civic Intelligence</Text>
                <View className="flex-row items-center mt-0.5">
                  <Text className="text-slate-400 text-sm">{session?.clientName}</Text>
                  <View className={`ml-2 px-2 py-0.5 rounded-full ${tierBadge.color}`}>
                    <Text className="text-white text-xs font-medium">{tierBadge.label}</Text>
                  </View>
                </View>
              </View>
            </View>
            <TouchableOpacity
              onPress={handleLogout}
              className="p-2 bg-slate-800/50 rounded-xl"
            >
              <LogOut size={20} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          className="flex-1 px-4 py-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#818CF8" />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Overall Sentiment */}
          <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-6">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-lg font-bold">Platform Sentiment</Text>
              <View className={`flex-row items-center px-3 py-1 rounded-full ${
                (sentimentOverview?.overall?.score ?? 0) > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
              }`}>
                {(sentimentOverview?.overall?.score ?? 0) > 0 ? (
                  <TrendingUp size={14} color="#34D399" />
                ) : (
                  <TrendingDown size={14} color="#EF4444" />
                )}
                <Text className={`ml-1 font-medium ${
                  (sentimentOverview?.overall?.score ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {((sentimentOverview?.overall?.score ?? 0) * 100).toFixed(1)}%
                </Text>
              </View>
            </View>

            <SentimentBar
              label="Legislative"
              support={sentimentOverview?.byBranch?.legislative?.support ?? 0}
              oppose={sentimentOverview?.byBranch?.legislative?.oppose ?? 0}
            />
            <SentimentBar
              label="Executive"
              support={sentimentOverview?.byBranch?.executive?.support ?? 0}
              oppose={sentimentOverview?.byBranch?.executive?.oppose ?? 0}
            />
            <SentimentBar
              label="Judicial"
              support={sentimentOverview?.byBranch?.judicial?.support ?? 0}
              oppose={sentimentOverview?.byBranch?.judicial?.oppose ?? 0}
            />
          </View>

          {/* Engagement Metrics */}
          <Text className="text-white text-lg font-bold mb-3">Engagement Metrics</Text>
          <View className="flex-row flex-wrap -m-1 mb-6">
            <MetricCard
              title="Total Votes"
              value={(sentimentOverview?.engagement?.totalVotes ?? 0).toLocaleString()}
              change={12}
              icon={<Vote size={20} color="#818CF8" />}
              color="#818CF8"
            />
            <MetricCard
              title="Active Users"
              value={(sentimentOverview?.engagement?.activeUsers24h ?? 0).toLocaleString()}
              change={8}
              icon={<Users size={20} color="#34D399" />}
              color="#34D399"
            />
            <MetricCard
              title="Posts"
              value={(sentimentOverview?.engagement?.totalPosts ?? 0).toLocaleString()}
              change={15}
              icon={<FileText size={20} color="#FBBF24" />}
              color="#FBBF24"
            />
            <MetricCard
              title="Comments"
              value={(sentimentOverview?.engagement?.totalComments ?? 0).toLocaleString()}
              change={-3}
              icon={<MessageSquare size={20} color="#F472B6" />}
              color="#F472B6"
            />
          </View>

          {/* Trending Topics */}
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-white text-lg font-bold">Trending Topics</Text>
            <TouchableOpacity onPress={() => router.push('/b2b/trends')}>
              <Text className="text-indigo-400 text-sm">View All</Text>
            </TouchableOpacity>
          </View>
          <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-6">
            {trendingTopics.slice(0, 5).map((topic, index) => (
              <View
                key={topic.id || index}
                className={`flex-row items-center justify-between py-3 ${
                  index < 4 ? 'border-b border-slate-700/50' : ''
                }`}
              >
                <View className="flex-row items-center flex-1">
                  <View className={`w-8 h-8 rounded-lg items-center justify-center mr-3 ${
                    (topic.sentiment ?? 0) > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
                  }`}>
                    <Text className={`font-bold ${
                      (topic.sentiment ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      #{index + 1}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-medium">{topic.topic || 'Unknown'}</Text>
                    <Text className="text-slate-400 text-xs">{(topic.mentions ?? 0).toLocaleString()} mentions</Text>
                  </View>
                </View>
                <View className="flex-row items-center">
                  {topic.velocity === 'accelerating' ? (
                    <Zap size={14} color="#FBBF24" />
                  ) : (topic.change24h ?? 0) > 0 ? (
                    <TrendingUp size={14} color="#34D399" />
                  ) : (
                    <TrendingDown size={14} color="#EF4444" />
                  )}
                  <Text className={`ml-1 text-sm ${
                    (topic.change24h ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {(topic.change24h ?? 0) > 0 ? '+' : ''}{topic.change24h ?? 0}%
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Quick Links */}
          <Text className="text-white text-lg font-bold mb-3">Analytics</Text>

          <QuickLink
            title="District Heatmap"
            subtitle="Geographic sentiment visualization"
            icon={<Map size={24} color="white" />}
            onPress={() => router.push('/b2b/heatmap')}
            gradient={['#4338CA', '#6366F1']}
          />

          <QuickLink
            title="Issue Tracker"
            subtitle="Track sentiment by policy area"
            icon={<Target size={24} color="white" />}
            onPress={() => router.push('/b2b/issues')}
            gradient={['#059669', '#10B981']}
          />

          <QuickLink
            title="State Analysis"
            subtitle="State-by-state breakdown"
            icon={<Building2 size={24} color="white" />}
            onPress={() => router.push('/b2b/states')}
            gradient={['#D97706', '#F59E0B']}
          />

          <QuickLink
            title="Forecasting"
            subtitle="Predictive sentiment analysis"
            icon={<Activity size={24} color="white" />}
            onPress={() => router.push('/b2b/forecast')}
            gradient={['#DC2626', '#EF4444']}
          />

          <QuickLink
            title="Reports"
            subtitle="Generate custom reports"
            icon={<FileText size={24} color="white" />}
            onPress={() => router.push('/b2b/reports')}
            gradient={['#7C3AED', '#8B5CF6']}
          />

          {/* Privacy Notice */}
          <View className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mt-4 mb-8">
            <View className="flex-row items-start">
              <AlertCircle size={20} color="#64748B" />
              <View className="flex-1 ml-3">
                <Text className="text-slate-400 text-sm">
                  All data is aggregated and anonymized. Individual user information is never shared or accessible through this platform.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
