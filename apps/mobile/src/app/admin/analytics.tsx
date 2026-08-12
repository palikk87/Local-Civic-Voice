import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  TrendingUp,
  Users,
  FileText,
  Vote,
  MessageSquare,
  Activity,
  Calendar,
  BarChart3,
} from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';

const { width } = Dimensions.get('window');

interface MetricCardProps {
  title: string;
  value: number | string;
  change: string;
  changeType: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
}

function MetricCard({ title, value, change, changeType, icon }: MetricCardProps) {
  const changeColors = {
    positive: 'text-green-400',
    negative: 'text-red-400',
    neutral: 'text-slate-400',
  };

  return (
    <View className="bg-slate-800/50 rounded-2xl p-4 flex-1 min-w-[45%] m-1">
      <View className="flex-row items-center justify-between mb-3">
        <View className="w-10 h-10 bg-slate-700/50 rounded-xl items-center justify-center">
          {icon}
        </View>
        <View className="flex-row items-center">
          <TrendingUp
            size={12}
            color={changeType === 'positive' ? '#22C55E' : changeType === 'negative' ? '#EF4444' : '#64748B'}
          />
          <Text className={`text-xs ml-1 ${changeColors[changeType]}`}>{change}</Text>
        </View>
      </View>
      <Text className="text-2xl font-bold text-white">{value}</Text>
      <Text className="text-slate-400 text-sm mt-1">{title}</Text>
    </View>
  );
}

interface SimpleBarProps {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}

function SimpleBar({ label, value, maxValue, color }: SimpleBarProps) {
  const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;

  return (
    <View className="mb-4">
      <View className="flex-row justify-between mb-1">
        <Text className="text-slate-400 text-sm">{label}</Text>
        <Text className="text-white font-medium">{value.toLocaleString()}</Text>
      </View>
      <View className="h-3 bg-slate-700 rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{ width: `${percentage}%`, backgroundColor: color }}
        />
      </View>
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');

  const stats = useAdminStore((s) => s.stats);
  const fetchStats = useAdminStore((s) => s.fetchStats);

  useEffect(() => {
    fetchStats();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  // Mock engagement data for visualization
  const engagementData = [
    { label: 'Mon', value: 1250 },
    { label: 'Tue', value: 1480 },
    { label: 'Wed', value: 1320 },
    { label: 'Thu', value: 1670 },
    { label: 'Fri', value: 1890 },
    { label: 'Sat', value: 2100 },
    { label: 'Sun', value: 1750 },
  ];

  const maxEngagement = Math.max(...engagementData.map((d) => d.value));

  // Category breakdown
  const categoryData = [
    { label: 'Healthcare', value: 2340, color: '#EF4444' },
    { label: 'Environment', value: 1890, color: '#22C55E' },
    { label: 'Education', value: 1650, color: '#8B5CF6' },
    { label: 'Economy', value: 1420, color: '#F59E0B' },
    { label: 'Civil Rights', value: 1180, color: '#3B82F6' },
  ];

  const maxCategory = Math.max(...categoryData.map((d) => d.value));

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">Analytics</Text>
      </View>

      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Period Selector */}
        <View className="flex-row bg-slate-800/50 rounded-xl p-1 mb-6">
          {(['day', 'week', 'month'] as const).map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-lg ${period === p ? 'bg-amber-500' : ''}`}
            >
              <Text
                className={`text-center font-medium capitalize ${
                  period === p ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Key Metrics */}
        <Text className="text-white text-lg font-bold mb-3">Key Metrics</Text>
        <View className="flex-row flex-wrap -m-1 mb-6">
          <MetricCard
            title="Total Users"
            value={stats?.totalUsers ?? 0}
            change="+12%"
            changeType="positive"
            icon={<Users size={20} color="#3B82F6" />}
          />
          <MetricCard
            title="Total Posts"
            value={stats?.totalPosts ?? 0}
            change="+8%"
            changeType="positive"
            icon={<FileText size={20} color="#22C55E" />}
          />
          <MetricCard
            title="Total Votes"
            value={stats?.totalVotes ?? 0}
            change="+23%"
            changeType="positive"
            icon={<Vote size={20} color="#F59E0B" />}
          />
          <MetricCard
            title="Comments"
            value={stats?.totalComments ?? 0}
            change="+5%"
            changeType="positive"
            icon={<MessageSquare size={20} color="#8B5CF6" />}
          />
        </View>

        {/* Daily Activity */}
        <View className="bg-slate-800/50 rounded-2xl p-4 mb-6">
          <View className="flex-row items-center justify-between mb-4">
            <Text className="text-white text-lg font-bold">Daily Activity</Text>
            <View className="bg-green-500/20 px-2 py-1 rounded-full">
              <Text className="text-green-400 text-xs">+18% this week</Text>
            </View>
          </View>

          {/* Simple Bar Chart */}
          <View className="flex-row items-end justify-between h-32 mb-2">
            {engagementData.map((item, index) => {
              const height = (item.value / maxEngagement) * 100;
              return (
                <View key={index} className="items-center flex-1 mx-0.5">
                  <View
                    className="w-full bg-amber-500/80 rounded-t-md"
                    style={{ height: `${height}%` }}
                  />
                </View>
              );
            })}
          </View>
          <View className="flex-row justify-between">
            {engagementData.map((item, index) => (
              <Text key={index} className="text-slate-500 text-xs flex-1 text-center">
                {item.label}
              </Text>
            ))}
          </View>
        </View>

        {/* Engagement Breakdown */}
        <View className="bg-slate-800/50 rounded-2xl p-4 mb-6">
          <Text className="text-white text-lg font-bold mb-4">Top Categories</Text>
          {categoryData.map((item, index) => (
            <SimpleBar
              key={index}
              label={item.label}
              value={item.value}
              maxValue={maxCategory}
              color={item.color}
            />
          ))}
        </View>

        {/* Quick Stats */}
        <View className="bg-slate-800/50 rounded-2xl p-4 mb-6">
          <Text className="text-white text-lg font-bold mb-4">Today's Summary</Text>

          <View className="flex-row items-center justify-between py-3 border-b border-slate-700">
            <View className="flex-row items-center">
              <View className="w-8 h-8 bg-blue-500/20 rounded-lg items-center justify-center">
                <Users size={16} color="#3B82F6" />
              </View>
              <Text className="text-slate-300 ml-3">New Users</Text>
            </View>
            <Text className="text-white font-bold">{stats?.newUsersToday ?? 0}</Text>
          </View>

          <View className="flex-row items-center justify-between py-3 border-b border-slate-700">
            <View className="flex-row items-center">
              <View className="w-8 h-8 bg-green-500/20 rounded-lg items-center justify-center">
                <FileText size={16} color="#22C55E" />
              </View>
              <Text className="text-slate-300 ml-3">Posts Created</Text>
            </View>
            <Text className="text-white font-bold">{stats?.postsToday ?? 0}</Text>
          </View>

          <View className="flex-row items-center justify-between py-3">
            <View className="flex-row items-center">
              <View className="w-8 h-8 bg-amber-500/20 rounded-lg items-center justify-center">
                <Activity size={16} color="#F59E0B" />
              </View>
              <Text className="text-slate-300 ml-3">Active Users</Text>
            </View>
            <Text className="text-white font-bold">{stats?.activeToday ?? 0}</Text>
          </View>
        </View>

        {/* Moderation Stats */}
        <View className="bg-slate-800/50 rounded-2xl p-4 mb-8">
          <Text className="text-white text-lg font-bold mb-4">Moderation</Text>

          <View className="flex-row gap-3">
            <View className="flex-1 bg-red-500/10 border border-red-500/30 rounded-xl p-3">
              <Text className="text-red-400 text-sm">Banned Users</Text>
              <Text className="text-white text-2xl font-bold mt-1">{stats?.bannedUsers ?? 0}</Text>
            </View>
            <View className="flex-1 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3">
              <Text className="text-orange-400 text-sm">Flagged Posts</Text>
              <Text className="text-white text-2xl font-bold mt-1">{stats?.flaggedPosts ?? 0}</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
