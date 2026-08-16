import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Shield,
  Users,
  FileText,
  BarChart3,
  Settings,
  LogOut,
  TrendingUp,
  UserX,
  Flag,
  Activity,
  Bell,
  ChevronRight,
  MessageSquare,
  Vote,
  Building2,
} from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';
import { StorageHealthCard } from '@/components/admin/StorageHealthCard';
import * as Haptics from 'expo-haptics';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  trend?: string;
}

function StatCard({ title, value, icon, color, bgColor, trend }: StatCardProps) {
  return (
    <View className="bg-slate-800/50 rounded-2xl p-4 flex-1 min-w-[45%] m-1">
      <View className="flex-row items-center justify-between mb-2">
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${bgColor}`}>
          {icon}
        </View>
        {trend && (
          <View className="flex-row items-center">
            <TrendingUp size={12} color="#22C55E" />
            <Text className="text-green-500 text-xs ml-1">{trend}</Text>
          </View>
        )}
      </View>
      <Text className="text-2xl font-bold text-white mt-2">{value}</Text>
      <Text className="text-slate-400 text-sm mt-1">{title}</Text>
    </View>
  );
}

interface MenuItemProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  badge?: number;
}

function MenuItem({ title, subtitle, icon, onPress, badge }: MenuItemProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-slate-800/50 rounded-2xl p-4 flex-row items-center mb-3"
      activeOpacity={0.7}
    >
      <View className="w-12 h-12 bg-slate-700/50 rounded-xl items-center justify-center">
        {icon}
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-white font-semibold text-base">{title}</Text>
        <Text className="text-slate-400 text-sm mt-0.5">{subtitle}</Text>
      </View>
      {badge !== undefined && badge > 0 && (
        <View className="bg-red-500 rounded-full min-w-[24px] h-6 items-center justify-center px-2 mr-2">
          <Text className="text-white text-xs font-bold">{badge}</Text>
        </View>
      )}
      <ChevronRight size={20} color="#64748B" />
    </TouchableOpacity>
  );
}

export default function AdminDashboardScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const session = useAdminStore((s) => s.session);
  const isAdminAuthenticated = useAdminStore((s) => s.isAdminAuthenticated);
  const stats = useAdminStore((s) => s.stats);
  const fetchStats = useAdminStore((s) => s.fetchStats);
  const adminLogout = useAdminStore((s) => s.adminLogout);
  const verifySession = useAdminStore((s) => s.verifySession);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const isValid = await verifySession();
    if (!isValid) {
      router.replace('/admin/login');
      return;
    }
    fetchStats();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout from the admin console?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await adminLogout();
            router.replace('/admin/login');
          },
        },
      ]
    );
  };

  if (!isAdminAuthenticated) {
    return null;
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'superadmin':
        return 'bg-purple-500';
      case 'admin':
        return 'bg-amber-500';
      case 'moderator':
        return 'bg-blue-500';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="px-4 py-3 border-b border-slate-800">
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
            <View className="w-10 h-10 bg-amber-500/20 rounded-full items-center justify-center">
              <Shield size={20} color="#F59E0B" />
            </View>
            <View className="ml-3">
              <Text className="text-white text-lg font-bold">Admin Console</Text>
              <View className="flex-row items-center mt-0.5">
                <Text className="text-slate-400 text-sm">{session?.username}</Text>
                <View className={`ml-2 px-2 py-0.5 rounded-full ${getRoleBadgeColor(session?.role || '')}`}>
                  <Text className="text-white text-xs font-medium capitalize">{session?.role}</Text>
                </View>
              </View>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleLogout}
            className="p-2 bg-slate-800 rounded-xl"
          >
            <LogOut size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4 py-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F59E0B"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Account storage health — same panel as the web admin console */}
        <StorageHealthCard />

        {/* Stats Grid */}
        <Text className="text-white text-lg font-bold mb-3">Overview</Text>
        <View className="flex-row flex-wrap -m-1 mb-4">
          <StatCard
            title="Total Users"
            value={stats?.totalUsers ?? 0}
            icon={<Users size={20} color="#3B82F6" />}
            color="#3B82F6"
            bgColor="bg-blue-500/20"
            trend="+12%"
          />
          <StatCard
            title="Total Posts"
            value={stats?.totalPosts ?? 0}
            icon={<FileText size={20} color="#22C55E" />}
            color="#22C55E"
            bgColor="bg-green-500/20"
            trend="+8%"
          />
          <StatCard
            title="Total Votes"
            value={stats?.totalVotes ?? 0}
            icon={<Vote size={20} color="#F59E0B" />}
            color="#F59E0B"
            bgColor="bg-amber-500/20"
          />
          <StatCard
            title="Comments"
            value={stats?.totalComments ?? 0}
            icon={<MessageSquare size={20} color="#8B5CF6" />}
            color="#8B5CF6"
            bgColor="bg-purple-500/20"
          />
        </View>

        {/* Quick Stats */}
        <View className="flex-row mb-6 -mx-1">
          <View className="flex-1 bg-red-500/10 border border-red-500/30 rounded-xl p-3 mx-1">
            <View className="flex-row items-center">
              <UserX size={16} color="#EF4444" />
              <Text className="text-red-400 text-sm ml-2">Banned</Text>
            </View>
            <Text className="text-white text-xl font-bold mt-1">{stats?.bannedUsers ?? 0}</Text>
          </View>
          <View className="flex-1 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mx-1">
            <View className="flex-row items-center">
              <Flag size={16} color="#F97316" />
              <Text className="text-orange-400 text-sm ml-2">Flagged</Text>
            </View>
            <Text className="text-white text-xl font-bold mt-1">{stats?.flaggedPosts ?? 0}</Text>
          </View>
          <View className="flex-1 bg-green-500/10 border border-green-500/30 rounded-xl p-3 mx-1">
            <View className="flex-row items-center">
              <Activity size={16} color="#22C55E" />
              <Text className="text-green-400 text-sm ml-2">Active</Text>
            </View>
            <Text className="text-white text-xl font-bold mt-1">{stats?.activeToday ?? 0}</Text>
          </View>
        </View>

        {/* Menu Items */}
        <Text className="text-white text-lg font-bold mb-3">Management</Text>

        <MenuItem
          title="User Management"
          subtitle="View, edit, ban, or delete users"
          icon={<Users size={24} color="#3B82F6" />}
          onPress={() => router.push('/admin/users')}
          badge={stats?.bannedUsers}
        />

        <MenuItem
          title="Content Moderation"
          subtitle="Review flagged posts and comments"
          icon={<FileText size={24} color="#22C55E" />}
          onPress={() => router.push('/admin/posts')}
          badge={stats?.flaggedPosts}
        />

        <MenuItem
          title="Analytics"
          subtitle="View engagement and growth metrics"
          icon={<BarChart3 size={24} color="#F59E0B" />}
          onPress={() => router.push('/admin/analytics')}
        />

        <MenuItem
          title="Announcements"
          subtitle="Create system-wide announcements"
          icon={<Bell size={24} color="#8B5CF6" />}
          onPress={() => router.push('/admin/announcements')}
        />

        <MenuItem
          title="Activity Logs"
          subtitle="View admin actions and audit trail"
          icon={<Activity size={24} color="#EC4899" />}
          onPress={() => router.push('/admin/logs')}
        />

        <MenuItem
          title="System Settings"
          subtitle="Configure app settings"
          icon={<Settings size={24} color="#64748B" />}
          onPress={() => router.push('/admin/settings')}
        />

        {/* Footer */}
        <View className="mt-6 mb-8 items-center">
          <Text className="text-slate-500 text-xs">
            Civic Voice Admin Console v1.0
          </Text>
          <Text className="text-slate-600 text-xs mt-1">
            All admin actions are logged for security
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
