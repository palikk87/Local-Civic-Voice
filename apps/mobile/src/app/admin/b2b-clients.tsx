// B2B portal accounts — mobile twin of apps/web/src/components/admin/B2BClientsTab.tsx.
//
// These accounts read every citizen's aggregated sentiment, so creating one is
// closer to granting a role than to adding a record. The API enforces that:
// listing is open to any admin, everything else is superadmin only.
//
// SECRETS ARE SHOWN ONCE. The password is stored as a scrypt hash and the API
// key as a SHA-256 digest, neither reversible, so there is no way to display
// them again — only to rotate. The reveal sheet has no dismiss-by-tapping-away
// for that reason.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Modal,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Building2,
  Plus,
  KeyRound,
  Trash2,
  Copy,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useAdminStore } from '@/lib/admin-store';
import { BACKEND_URL } from '@/lib/config';

interface B2BClient {
  id: string;
  username: string;
  name: string;
  type: string;
  tier: string;
  lastAccessAt: string | null;
  createdAt: string;
  activeSessions: number;
}

interface IssuedCredentials {
  username: string;
  password?: string;
  apiKey?: string;
}

const CLIENT_TYPES = ['research', 'media', 'campaign', 'lobbyist', 'ngo', 'corporation'] as const;
const TIERS = ['basic', 'professional', 'enterprise'] as const;

const TIER_STYLE: Record<string, string> = {
  basic: 'bg-slate-700 text-slate-300',
  professional: 'bg-blue-500/20 text-blue-400',
  enterprise: 'bg-amber-500/20 text-amber-400',
};

function formatDate(value: string | null): string {
  if (!value) return 'never';
  return new Date(value).toLocaleString();
}

export default function B2BClientsScreen() {
  const router = useRouter();
  const session = useAdminStore((s) => s.session);

  const [clients, setClients] = useState<B2BClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [form, setForm] = useState({
    username: '',
    name: '',
    type: 'research' as string,
    tier: 'professional' as string,
  });

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    }),
    [session?.token],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/b2b-clients`, {
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      const body = (await response.json()) as { clients: B2BClient[] };
      setClients(body.clients);
    } catch (error) {
      Alert.alert('Could not load', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    path: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetch(`${BACKEND_URL}${path}`, {
        method,
        headers: authHeaders(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error((parsed.error as string) ?? `Request failed: ${response.status}`);
      }
      await load();
      return parsed;
    } catch (error) {
      Alert.alert('Failed', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  };

  const create = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await mutate('/api/admin/b2b-clients', 'POST', form);
    if (result) {
      setCreateOpen(false);
      setForm({ username: '', name: '', type: 'research', tier: 'professional' });
      setIssued(result.credentials as IssuedCredentials);
    }
  };

  const rotate = async (id: string, what: 'apiKey') => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await mutate(`/api/admin/b2b-clients/${id}/rotate`, 'POST', { [what]: true });
    if (result) setIssued(result.credentials as IssuedCredentials);
  };

  const changeTier = async (id: string, tier: string) => {
    await mutate(`/api/admin/b2b-clients/${id}`, 'PATCH', { tier });
  };

  const remove = (client: B2BClient) => {
    Alert.alert(
      `Delete ${client.name}?`,
      'This signs out every session it has open and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void mutate(`/api/admin/b2b-clients/${client.id}`, 'DELETE'),
        },
      ],
    );
  };

  const copy = async (label: string, value: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', `${label} is on the clipboard.`);
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950">
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </TouchableOpacity>
        <View className="flex-1 ml-2">
          <Text className="text-white text-lg font-semibold">B2B clients</Text>
          <Text className="text-slate-500 text-xs">Analytics portal accounts</Text>
        </View>
        <TouchableOpacity
          onPress={() => setCreateOpen(true)}
          className="bg-blue-600 rounded-xl px-3 py-2 flex-row items-center"
        >
          <Plus size={16} color="#fff" />
          <Text className="text-white ml-1 font-medium">New</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#8FA79A"
          />
        }
      >
        {loading ? (
          <Text className="text-slate-500 text-center mt-10">Loading…</Text>
        ) : clients.length === 0 ? (
          <View className="items-center mt-16 px-8">
            <Building2 size={40} color="#4C6659" />
            <Text className="text-slate-400 text-center mt-4">
              No B2B accounts yet. Create one, or run scripts/seed-b2b.ts.
            </Text>
          </View>
        ) : (
          clients.map((client) => (
            <View key={client.id} className="bg-slate-900 rounded-2xl p-4 mb-3 border border-slate-800">
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-2">
                  <Text className="text-white font-semibold text-base">{client.name}</Text>
                  <Text className="text-slate-500 text-xs mt-0.5">{client.username}</Text>
                </View>
                <View className={`px-2 py-0.5 rounded-full ${TIER_STYLE[client.tier] ?? 'bg-slate-700'}`}>
                  <Text className="text-xs font-medium">{client.tier}</Text>
                </View>
              </View>

              <Text className="text-slate-500 text-xs mt-2">
                {client.type} · last login {formatDate(client.lastAccessAt)}
                {client.activeSessions > 0 ? ` · ${client.activeSessions} signed in` : ''}
              </Text>

              <View className="flex-row flex-wrap mt-3 -mx-1">
                {TIERS.filter((tier) => tier !== client.tier).map((tier) => (
                  <TouchableOpacity
                    key={tier}
                    onPress={() => void changeTier(client.id, tier)}
                    className="bg-slate-800 rounded-lg px-3 py-2 m-1"
                  >
                    <Text className="text-slate-300 text-xs">Set {tier}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/*
                THERE IS NO "GENERATE A RANDOM PASSWORD" BUTTON, DELIBERATELY.

                One sat here, and on this screen it did not even ask first — a
                single tap rotated a live paying client's password and signed
                out every session it had open. It was also redundant: setting a
                chosen password does the same job with a value a person can
                actually hand over.

                It went after the owner's own B2B login stopped working and he
                had to set a new password from the admin console to get back in.
                His instruction was to simplify rather than build a detector:
                remove the only control that can produce a password nobody
                chose, so there is one way a password changes and a person is
                always on the other end of it.

                Same removal on web — see B2BClientsTab. The API key button
                below stays, because a key is not something anyone types.
              */}
              <View className="flex-row mt-2 -mx-1">
                <TouchableOpacity
                  onPress={() => void rotate(client.id, 'apiKey')}
                  className="flex-1 bg-slate-800 rounded-lg py-2 m-1 flex-row items-center justify-center"
                >
                  <KeyRound size={14} color="#8FA79A" />
                  <Text className="text-slate-300 text-xs ml-1.5">API key</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => remove(client)}
                  className="bg-red-500/20 rounded-lg px-4 py-2 m-1 items-center justify-center"
                >
                  <Trash2 size={14} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
        <View className="h-10" />
      </ScrollView>

      <Modal visible={createOpen} animationType="slide" transparent onRequestClose={() => setCreateOpen(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-slate-900 max-h-[85%] rounded-t-3xl p-5 border-t border-slate-800">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-lg font-semibold">New B2B client</Text>
              <TouchableOpacity onPress={() => setCreateOpen(false)} className="p-1">
                <X size={22} color="#8FA79A" />
              </TouchableOpacity>
            </View>

            <Text className="text-slate-500 text-xs mb-3">
              A password and API key are generated for you and shown once.
            </Text>

            <TextInput
              placeholder="Username (letters, digits, _ . -)"
              placeholderTextColor="#4C6659"
              autoCapitalize="none"
              value={form.username}
              onChangeText={(username) => setForm({ ...form, username })}
              className="bg-slate-800 text-white rounded-xl px-4 py-3 mb-3"
            />
            <TextInput
              placeholder="Display name"
              placeholderTextColor="#4C6659"
              value={form.name}
              onChangeText={(name) => setForm({ ...form, name })}
              className="bg-slate-800 text-white rounded-xl px-4 py-3 mb-3"
            />

            <Text className="text-slate-400 text-xs mb-2">Type</Text>
            <View className="flex-row flex-wrap -mx-1 mb-3">
              {CLIENT_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  onPress={() => setForm({ ...form, type })}
                  className={`rounded-lg px-3 py-2 m-1 ${form.type === type ? 'bg-blue-600' : 'bg-slate-800'}`}
                >
                  <Text className={form.type === type ? 'text-white text-xs' : 'text-slate-300 text-xs'}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-slate-400 text-xs mb-2">Tier</Text>
            <View className="flex-row -mx-1 mb-5">
              {TIERS.map((tier) => (
                <TouchableOpacity
                  key={tier}
                  onPress={() => setForm({ ...form, tier })}
                  className={`flex-1 rounded-lg py-2 m-1 items-center ${form.tier === tier ? 'bg-blue-600' : 'bg-slate-800'}`}
                >
                  <Text className={form.tier === tier ? 'text-white text-xs' : 'text-slate-300 text-xs'}>
                    {tier}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              onPress={() => void create()}
              disabled={!form.username.trim() || !form.name.trim()}
              className={`rounded-xl py-3 items-center ${
                form.username.trim() && form.name.trim() ? 'bg-blue-600' : 'bg-slate-800'
              }`}
            >
              <Text className="text-white font-semibold">Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/*
        No onRequestClose that dismisses, and no tap-away. These values cannot be
        recovered, so closing this by accident means rotating again — the one
        interaction in this console where a stray tap has a real cost.
      */}
      <Modal visible={!!issued} animationType="fade" transparent>
        <View className="flex-1 bg-black/80 justify-center px-5">
          <View className="bg-slate-900 rounded-2xl p-5 border border-amber-500/40">
            <View className="flex-row items-center mb-2">
              <TriangleAlert size={20} color="#F59E0B" />
              <Text className="text-white text-lg font-semibold ml-2">Copy these now</Text>
            </View>
            <Text className="text-slate-400 text-xs mb-4">
              They are stored hashed and cannot be shown again. If you lose them, rotate.
            </Text>

            <CredentialRow label="Username" value={issued?.username ?? ''} onCopy={copy} />
            {issued?.password ? (
              <CredentialRow label="Password" value={issued.password} onCopy={copy} />
            ) : null}
            {issued?.apiKey ? (
              <CredentialRow label="API key" value={issued.apiKey} onCopy={copy} />
            ) : null}

            <TouchableOpacity
              onPress={() => setIssued(null)}
              className="bg-blue-600 rounded-xl py-3 items-center mt-2"
            >
              <Text className="text-white font-semibold">I have copied them</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string) => Promise<void>;
}) {
  return (
    <View className="mb-3">
      <Text className="text-slate-500 text-xs mb-1">{label}</Text>
      <View className="flex-row items-center">
        <View className="flex-1 bg-slate-800 rounded-lg px-3 py-2 mr-2">
          <Text className="text-white text-xs" numberOfLines={2}>
            {value}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void onCopy(label, value)}
          className="bg-slate-800 rounded-lg p-2.5"
        >
          <Copy size={16} color="#8FA79A" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
