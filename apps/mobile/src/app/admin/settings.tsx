import React, { useCallback, useEffect, useState } from 'react';
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
  Server,
  Info,
} from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';
import { BACKEND_URL } from '@/lib/config';
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

  /**
   * What the backend says about itself, or the reason we could not ask.
   *
   * Nothing here is written unless /health returned it. When the request
   * fails, this reports the failure rather than falling back to a cheerful
   * default — an admin console that cannot reach the server must say so.
   */
  const [health, setHealth] = useState<{
    reachable: boolean;
    subtitle: string;
    schema: string;
  }>({ reachable: false, subtitle: 'Checking…', schema: 'Checking…' });

  const checkHealth = useCallback(async (announce = false) => {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (!response.ok) {
        const failed = {
          reachable: false,
          subtitle: `Server answered ${response.status}`,
          schema: 'Unknown — the server did not answer',
        };
        setHealth(failed);
        if (announce) Alert.alert('Server Status', failed.subtitle);
        return;
      }
      const body = await response.json();
      const minutes = Math.round((body.uptime ?? 0) / 60);
      const schema = body.schema;
      const schemaLine = !schema
        ? 'The server reported no schema state'
        : schema.inSync
          ? `In sync — ${schema.applied} migration(s) applied`
          : schema.failed?.length
            ? `${schema.failed.length} migration(s) FAILED`
            : `${schema.pending?.length ?? 0} migration(s) pending`;
      const next = {
        reachable: true,
        subtitle: `Up ${minutes} min · ${body.version ?? 'version unknown'}`,
        schema: schemaLine,
      };
      setHealth(next);
      if (announce) Alert.alert('Server Status', `${next.subtitle}\n${schemaLine}`);
    } catch {
      const failed = {
        reachable: false,
        subtitle: 'Could not reach the server',
        schema: 'Unknown — the server could not be reached',
      };
      setHealth(failed);
      if (announce) Alert.alert('Server Status', failed.subtitle);
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  // "Clear Cache" and "Reset Analytics" USED TO LIVE HERE. Neither called an
  // endpoint. Both popped a confirmation, played a haptic, and said "cleared
  // successfully" / "reset successfully" — an administrator could reset the
  // platform's analytics, be told it worked, and nothing on any server would
  // have changed. A control that reports a result it did not produce is worse
  // than no control, so they are gone rather than gated. If either is wanted,
  // it needs a route behind it first.

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

        {/* THESE TWO USED TO ANSWER WITHOUT ASKING.
            "Server Status" said "All systems operational" whether or not a
            server existed. "Database" said "SQLite database is running
            normally / Size: 12.4 MB / Tables: 15" — this platform runs
            PostgreSQL, and every one of those numbers was typed by hand. An
            administrator checking whether the backend was up got a reassuring
            answer from a string constant. They read /health now, and say what
            it says. */}
        <SettingItem
          title="Server Status"
          subtitle={health.subtitle}
          icon={<Server size={20} color={health.reachable ? '#22C55E' : '#EF4444'} />}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void checkHealth(true);
          }}
        />

        <SettingItem
          title="Database"
          subtitle={health.schema}
          icon={<Database size={20} color="#3B82F6" />}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            void checkHealth(true);
          }}
        />

        {/* "Push Notifications" was here and opened an alert saying the
            settings are managed elsewhere. It configured nothing. */}

        <Text className="text-white text-lg font-bold mb-3 mt-6">Maintenance</Text>

        {/* Version Info */}
        <View className="mt-6 items-center py-8">
          <View className="flex-row items-center">
            <Info size={16} color="#64748B" />
            <Text className="text-slate-500 text-sm ml-2">AYE & NAY Admin v1.0.0</Text>
          </View>
          <Text className="text-slate-600 text-xs mt-2">Built with React Native & Expo</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
