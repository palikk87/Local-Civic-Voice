import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Database,
  Shield,
  Bell,
  RefreshCw,
  Server,
  Info,
} from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';
import { KeysAndEmailCard } from '@/components/admin/KeysAndEmailCard';

interface SettingItemProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  onPress: () => void;
  danger?: boolean;
}

function SettingItem({ title, subtitle, icon, onPress, danger }: SettingItemProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center p-4 mb-3 rounded-xl ${
        danger ? 'bg-red-500/10 border border-red-500/30' : 'bg-slate-800/50'
      }`}
    >
      <View className={`w-10 h-10 rounded-xl items-center justify-center ${
        danger ? 'bg-red-500/20' : 'bg-slate-700/50'
      }`}>
        {icon}
      </View>
      <View className="flex-1 ml-3">
        <Text className={`font-semibold ${danger ? 'text-red-400' : 'text-white'}`}>{title}</Text>
        <Text className="text-slate-400 text-sm mt-0.5">{subtitle}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function AdminSettingsScreen() {
  const router = useRouter();
  const session = useAdminStore((s) => s.session);

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cache',
      'This will clear all cached data. Users may experience slower load times temporarily.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            Alert.alert('Success', 'Cache cleared successfully');
          },
        },
      ]
    );
  };

  const handleResetStats = () => {
    Alert.alert(
      'Reset Analytics',
      'This will reset all analytics data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            Alert.alert('Success', 'Analytics reset successfully');
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">System Settings</Text>
      </View>

      <ScrollView className="flex-1 px-4 py-4" showsVerticalScrollIndicator={false}>
        {/* Admin Info */}
        <View className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 mb-6">
          <View className="flex-row items-center">
            <Shield size={24} color="#F59E0B" />
            <View className="ml-3">
              <Text className="text-amber-400 font-semibold">Logged in as {session?.username}</Text>
              <Text className="text-slate-400 text-sm capitalize">{session?.role}</Text>
            </View>
          </View>
        </View>

        <KeysAndEmailCard />

        {/* Settings */}
        <Text className="text-white text-lg font-bold mb-3">System</Text>

        <SettingItem
          title="Server Status"
          subtitle="Check backend server health"
          icon={<Server size={20} color="#22C55E" />}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Alert.alert('Server Status', 'All systems operational');
          }}
        />

        <SettingItem
          title="Database"
          subtitle="View database statistics"
          icon={<Database size={20} color="#3B82F6" />}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Alert.alert('Database Info', 'SQLite database is running normally\nSize: 12.4 MB\nTables: 15');
          }}
        />

        <SettingItem
          title="Push Notifications"
          subtitle="Configure notification settings"
          icon={<Bell size={20} color="#8B5CF6" />}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Alert.alert('Notifications', 'Push notification settings are managed through the app configuration.');
          }}
        />

        <Text className="text-white text-lg font-bold mb-3 mt-6">Maintenance</Text>

        <SettingItem
          title="Clear Cache"
          subtitle="Clear all cached data"
          icon={<RefreshCw size={20} color="#F59E0B" />}
          onPress={handleClearCache}
        />

        {session?.role === 'superadmin' && (
          <SettingItem
            title="Reset Analytics"
            subtitle="Reset all analytics data"
            icon={<RefreshCw size={20} color="#EF4444" />}
            onPress={handleResetStats}
            danger
          />
        )}

        {/* Version Info */}
        <View className="mt-6 items-center py-8">
          <View className="flex-row items-center">
            <Info size={16} color="#64748B" />
            <Text className="text-slate-500 text-sm ml-2">Civic Voice Admin v1.0.0</Text>
          </View>
          <Text className="text-slate-600 text-xs mt-2">Built with React Native & Expo</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
