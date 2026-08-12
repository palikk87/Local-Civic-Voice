import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Activity,
  User,
  FileText,
  MessageSquare,
  Shield,
  Ban,
  UserCheck,
  Trash2,
  Flag,
  Bell,
  Settings,
  Clock,
} from 'lucide-react-native';
import { useAdminStore, ActivityLog } from '@/lib/admin-store';

interface LogItemProps {
  log: ActivityLog;
}

function LogItem({ log }: LogItemProps) {
  const getActionIcon = (action: string, targetType: string) => {
    if (action.includes('ban')) return <Ban size={16} color="#EF4444" />;
    if (action.includes('unban')) return <UserCheck size={16} color="#22C55E" />;
    if (action.includes('delete')) return <Trash2 size={16} color="#EF4444" />;
    if (action.includes('flag')) return <Flag size={16} color="#F97316" />;
    if (action.includes('announce')) return <Bell size={16} color="#8B5CF6" />;
    if (action.includes('login')) return <Shield size={16} color="#3B82F6" />;
    if (action.includes('admin')) return <Shield size={16} color="#F59E0B" />;

    switch (targetType) {
      case 'user':
        return <User size={16} color="#3B82F6" />;
      case 'post':
        return <FileText size={16} color="#22C55E" />;
      case 'comment':
        return <MessageSquare size={16} color="#8B5CF6" />;
      case 'system':
        return <Settings size={16} color="#64748B" />;
      default:
        return <Activity size={16} color="#64748B" />;
    }
  };

  const getActionColor = (action: string) => {
    if (action.includes('ban') || action.includes('delete')) return 'bg-red-500/20 border-red-500/30';
    if (action.includes('unban')) return 'bg-green-500/20 border-green-500/30';
    if (action.includes('flag')) return 'bg-orange-500/20 border-orange-500/30';
    if (action.includes('announce')) return 'bg-purple-500/20 border-purple-500/30';
    if (action.includes('login')) return 'bg-blue-500/20 border-blue-500/30';
    if (action.includes('admin')) return 'bg-amber-500/20 border-amber-500/30';
    return 'bg-slate-700/50 border-slate-600';
  };

  const formatAction = (action: string) => {
    return action
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <View className={`rounded-xl p-4 mb-2 border ${getActionColor(log.action)}`}>
      <View className="flex-row items-start">
        <View className="w-8 h-8 bg-slate-800/50 rounded-lg items-center justify-center mt-0.5">
          {getActionIcon(log.action, log.targetType)}
        </View>
        <View className="flex-1 ml-3">
          <View className="flex-row items-center flex-wrap gap-1">
            <Text className="text-amber-400 font-medium">{log.adminUsername}</Text>
            <Text className="text-slate-400">{formatAction(log.action)}</Text>
          </View>

          {log.details && (
            <Text className="text-slate-300 text-sm mt-1">{log.details}</Text>
          )}

          {log.targetId && (
            <Text className="text-slate-500 text-xs mt-1 font-mono">
              Target: {log.targetId}
            </Text>
          )}

          <View className="flex-row items-center mt-2">
            <Clock size={12} color="#64748B" />
            <Text className="text-slate-500 text-xs ml-1">
              {new Date(log.timestamp).toLocaleString()}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export default function AdminLogsScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);

  const logs = useAdminStore((s) => s.logs);
  const fetchLogs = useAdminStore((s) => s.fetchLogs);

  useEffect(() => {
    fetchLogs({ action: filter || undefined });
  }, [filter]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLogs({ action: filter || undefined });
    setRefreshing(false);
  };

  const filters = [
    { key: null, label: 'All' },
    { key: 'login', label: 'Logins' },
    { key: 'ban', label: 'Bans' },
    { key: 'delete', label: 'Deletes' },
    { key: 'flag', label: 'Flags' },
    { key: 'admin', label: 'Admin' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">Activity Logs</Text>
        <View className="flex-1" />
        <View className="bg-slate-800 px-3 py-1 rounded-full">
          <Text className="text-slate-400 text-sm">{logs.length} entries</Text>
        </View>
      </View>

      {/* Filters */}
      <View className="px-4 py-3">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-1"
        >
          {filters.map((f) => (
            <TouchableOpacity
              key={f.key ?? 'all'}
              onPress={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-full mx-1 ${
                filter === f.key ? 'bg-amber-500' : 'bg-slate-800'
              }`}
            >
              <Text
                className={`font-medium ${
                  filter === f.key ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        className="flex-1 px-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
        }
        showsVerticalScrollIndicator={false}
      >
        {logs.length === 0 ? (
          <View className="flex-1 items-center justify-center py-20">
            <Activity size={48} color="#475569" />
            <Text className="text-slate-400 text-lg mt-4">No activity logs</Text>
            <Text className="text-slate-500 text-sm mt-1">Admin actions will appear here</Text>
          </View>
        ) : (
          logs.map((log) => <LogItem key={log.id} log={log} />)
        )}
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
