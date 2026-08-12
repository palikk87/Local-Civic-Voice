// Account storage health. Same capability as the web admin console's
// StorageHealthCard, reading the same /api/admin/storage-health endpoint.
//
// Accounts live in Supabase Postgres, outside this container, so they survive
// restarts on their own. This panel confirms that live — the database the app is
// actually connected to, and how many accounts are in it. The old "back up now"
// button and vault counters are gone with the vault they belonged to.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAdminStore } from '@/lib/admin-store';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL) || 'http://localhost:3000';

interface StorageHealth {
  databaseDurable: boolean;
  databaseKind: string;
  totalUsers: number;
  realAccounts: number;
  accountsProtected: boolean;
  warning: string | null;
}

export function StorageHealthCard() {
  const session = useAdminStore((s) => s.session);
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(async () => {
    if (!session?.token) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/storage-health`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      const json = (await response.json()) as { data?: StorageHealth };
      setHealth(json.data ?? null);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, [session?.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <View className="bg-slate-800 rounded-2xl p-4 mb-4">
        <ActivityIndicator color="#F59E0B" />
      </View>
    );
  }

  if (!health) return null;

  const isProtected = health.accountsProtected;

  return (
    <View
      className={`rounded-2xl p-4 mb-4 border ${
        isProtected ? 'bg-slate-800 border-slate-700' : 'bg-red-950 border-red-800'
      }`}
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-row items-center flex-1">
          {isProtected ? (
            <ShieldCheck size={20} color="#10B981" />
          ) : (
            <AlertTriangle size={20} color="#EF4444" />
          )}
          <View className="ml-2 flex-1">
            <Text className="text-white text-base font-bold">Account Storage</Text>
            <Text className="text-slate-400 text-xs mt-0.5">
              {isProtected ? 'Accounts are safe and permanent' : 'Accounts are at risk'}
            </Text>
          </View>
        </View>

        <Pressable
          onPress={refresh}
          disabled={refreshing}
          className="flex-row items-center bg-slate-700 px-3 py-2 rounded-xl"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#F59E0B" />
          ) : (
            <RefreshCw size={14} color="#F59E0B" />
          )}
          <Text className="text-white text-xs font-medium ml-1.5">Refresh</Text>
        </Pressable>
      </View>

      <View className="flex-row flex-wrap mt-4 -m-1">
        <View className="w-1/2 p-1">
          <Text className="text-slate-400 text-xs">Database</Text>
          <Text className="text-white text-sm font-semibold mt-0.5">
            {health.databaseKind}
          </Text>
        </View>
        <View className="w-1/2 p-1">
          <Text className="text-slate-400 text-xs">Survives restarts</Text>
          <Text className="text-white text-sm font-semibold mt-0.5">
            {health.databaseDurable ? 'Yes' : 'No'}
          </Text>
        </View>
        <View className="w-1/2 p-1">
          <Text className="text-slate-400 text-xs">Sign-in accounts</Text>
          <Text className="text-white text-sm font-semibold mt-0.5">
            {health.realAccounts}
          </Text>
        </View>
        <View className="w-1/2 p-1">
          <Text className="text-slate-400 text-xs">Total profiles</Text>
          <Text className="text-white text-sm font-semibold mt-0.5">
            {health.totalUsers}
          </Text>
        </View>
      </View>

      {health.warning ? (
        <Text className="text-slate-400 text-xs leading-5 mt-3 bg-slate-900/60 p-2.5 rounded-xl">
          {health.warning}
        </Text>
      ) : null}
    </View>
  );
}
