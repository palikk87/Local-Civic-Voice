// Who may do what — mobile twin of apps/web/src/components/admin/RolesTab.tsx.
//
// WHY THIS SCREEN EXISTS. The platform shipped with three fixed roles whose
// powers lived in fourteen scattered `role !== 'superadmin'` checks. The answer
// to "what can a moderator actually do" could only be found by reading every
// route, and changing it meant a code change, a review and a deploy. Roles are
// rows now, and this is where they are edited.
//
// EVERY CHECKBOX HERE NAMES SOMETHING REAL. The capability list comes from the
// API, which builds it from the same literals the routes check by name — there
// is no way to invent a permission here, because a permission that gates
// nothing is worse than no permission system at all.
//
// THE OWNER IS SHOWN AND CANNOT BE EDITED. That is not an oversight to fix
// later: it is the property that makes every other row safe to change.
// Somebody has to be able to undo a mistake, including the mistake of removing
// their own access.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Check,
  Lock,
  Plus,
  Shield,
  Trash2,
  TriangleAlert,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { adminAuthHeader, adminCan, useAdminStore } from '@/lib/admin-store';
import { BACKEND_URL } from '@/lib/config';

interface CapabilityDefinition {
  key: string;
  label: string;
  grants: string;
  group: string;
  severe?: boolean;
}

interface RoleRow {
  slug: string;
  name: string;
  description: string | null;
  capabilities: string[];
  builtIn: boolean;
  editable: boolean;
  holders: number;
}

export default function AdminRolesScreen() {
  const router = useRouter();
  const session = useAdminStore((s) => s.session);
  const mayManage = adminCan(session, 'roles.manage');

  const [owner, setOwner] = useState<RoleRow | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityDefinition[]>([]);
  const [note, setNote] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftCaps, setDraftCaps] = useState<string[]>([]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/roles`, {
        headers: adminAuthHeader(),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setLoadError(body?.error ?? `The server answered ${response.status}`);
        return;
      }
      const body = await response.json();
      setOwner(body.data.owner);
      setRoles(body.data.roles);
      setCapabilities(body.data.capabilities);
      setNote(body.data.note);
      setLoadError(null);
    } catch {
      setLoadError('Could not reach the server.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = [...new Set(capabilities.map((c) => c.group))];

  function startEditing(role: RoleRow) {
    setEditing(role.slug);
    setDraftName(role.name);
    setDraftCaps([...role.capabilities]);
  }

  function toggle(key: string) {
    setDraftCaps((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
    );
  }

  async function save(slug: string) {
    setSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/roles/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
        body: JSON.stringify({ slug, name: draftName.trim(), capabilities: draftCaps }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        Alert.alert('Could not save', body?.error ?? `The server answered ${response.status}`);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setEditing(null);
      await load();
      Alert.alert('Saved', 'It applies to their next request, not their next login.');
    } catch {
      Alert.alert('Could not save', 'The server could not be reached.');
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    setSaving(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeader() },
        body: JSON.stringify({
          slug: newSlug.trim().toLowerCase(),
          name: newName.trim(),
          capabilities: [],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        Alert.alert(
          'Could not create the role',
          body?.error ?? `The server answered ${response.status}`
        );
        return;
      }
      setCreating(false);
      setNewName('');
      setNewSlug('');
      await load();
    } catch {
      Alert.alert('Could not create the role', 'The server could not be reached.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(role: RoleRow) {
    Alert.alert(
      `Delete "${role.name}"?`,
      role.holders > 0
        ? `${role.holders} account(s) hold this role. The server will refuse while anybody does.`
        : 'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const response = await fetch(`${BACKEND_URL}/api/admin/roles/${role.slug}`, {
              method: 'DELETE',
              headers: adminAuthHeader(),
            }).catch(() => null);
            if (!response || !response.ok) {
              const body = await response?.json().catch(() => null);
              Alert.alert('Could not delete it', body?.error ?? 'The server could not be reached.');
              return;
            }
            await load();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">Roles</Text>
      </View>

      <ScrollView
        className="flex-1 px-4 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor="#94A3B8"
          />
        }
      >
        {loadError ? (
          <Text className="text-red-400 text-sm mb-4">{loadError}</Text>
        ) : null}

        {note ? <Text className="text-slate-400 text-sm mb-4">{note}</Text> : null}

        {/* The owner, first and uneditable. */}
        {owner ? (
          <View className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 mb-4">
            <View className="flex-row items-center">
              <Lock size={16} color="#F59E0B" />
              <Text className="text-white font-semibold ml-2">{owner.name}</Text>
              <Text className="text-slate-400 text-xs ml-2">
                {owner.holders} account
              </Text>
            </View>
            {owner.description ? (
              <Text className="text-slate-400 text-sm mt-2">{owner.description}</Text>
            ) : null}
            <Text className="text-slate-500 text-xs mt-2">
              The seat is not assignable from here, and the account holding it cannot be banned,
              deleted, re-keyed or re-roled by anybody — including itself. That is what makes
              every role below safe to change.
            </Text>
          </View>
        ) : null}

        {roles.map((role) => {
          const isEditing = editing === role.slug;
          return (
            <View
              key={role.slug}
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 mb-4"
            >
              <View className="flex-row items-center flex-wrap">
                <Shield size={16} color="#94A3B8" />
                {isEditing ? (
                  <TextInput
                    value={draftName}
                    onChangeText={setDraftName}
                    className="text-white bg-slate-900 rounded-lg px-3 py-1.5 ml-2 flex-1"
                    placeholderTextColor="#64748B"
                  />
                ) : (
                  <Text className="text-white font-semibold ml-2">{role.name}</Text>
                )}
                <Text className="text-slate-500 text-xs ml-2">{role.slug}</Text>
                {role.builtIn ? (
                  <Text className="text-slate-500 text-xs ml-2">built in</Text>
                ) : null}
                <Text className="text-slate-400 text-xs ml-2">
                  {role.holders} {role.holders === 1 ? 'account' : 'accounts'}
                </Text>
              </View>

              {role.description ? (
                <Text className="text-slate-400 text-sm mt-2">{role.description}</Text>
              ) : null}

              <View className="mt-3">
                {groups.map((group) => (
                  <View key={group} className="mb-3">
                    <Text className="text-slate-500 text-xs uppercase tracking-wide">
                      {group}
                    </Text>
                    {capabilities
                      .filter((capability) => capability.group === group)
                      .map((capability) => {
                        const held = isEditing
                          ? draftCaps.includes(capability.key)
                          : role.capabilities.includes(capability.key);
                        return (
                          <TouchableOpacity
                            key={capability.key}
                            disabled={!isEditing}
                            onPress={() => {
                              Haptics.selectionAsync();
                              toggle(capability.key);
                            }}
                            className="flex-row items-start mt-2"
                          >
                            <View
                              className={`w-5 h-5 rounded border items-center justify-center mt-0.5 ${
                                held
                                  ? 'bg-indigo-500 border-indigo-500'
                                  : 'border-slate-600'
                              }`}
                            >
                              {held ? <Check size={14} color="#FFFFFF" /> : null}
                            </View>
                            <View className="flex-1 ml-3">
                              <View className="flex-row items-center">
                                <Text
                                  className={held ? 'text-white' : 'text-slate-400'}
                                >
                                  {capability.label}
                                </Text>
                                {capability.severe ? (
                                  <View className="ml-1.5">
                                    <TriangleAlert size={12} color="#F59E0B" />
                                  </View>
                                ) : null}
                              </View>
                              <Text className="text-slate-500 text-xs mt-0.5">
                                {capability.grants}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                  </View>
                ))}
              </View>

              {mayManage ? (
                <View className="flex-row mt-2">
                  {isEditing ? (
                    <>
                      <TouchableOpacity
                        onPress={() => setEditing(null)}
                        className="px-4 py-2 rounded-lg bg-slate-700 mr-2"
                      >
                        <Text className="text-slate-300 font-medium">Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={saving || !draftName.trim()}
                        onPress={() => void save(role.slug)}
                        className="px-4 py-2 rounded-lg bg-indigo-500"
                      >
                        <Text className="text-white font-medium">
                          {saving ? 'Saving…' : 'Save'}
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity
                        onPress={() => startEditing(role)}
                        className="px-4 py-2 rounded-lg bg-slate-700 mr-2"
                      >
                        <Text className="text-slate-300 font-medium">Edit</Text>
                      </TouchableOpacity>
                      {!role.builtIn ? (
                        <TouchableOpacity
                          onPress={() => confirmDelete(role)}
                          className="px-4 py-2 rounded-lg bg-red-500/20 flex-row items-center"
                        >
                          <Trash2 size={16} color="#EF4444" />
                        </TouchableOpacity>
                      ) : null}
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {mayManage ? (
          creating ? (
            <View className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 mb-8">
              <Text className="text-white font-semibold">A new role</Text>
              <Text className="text-slate-400 text-sm mt-1">
                It starts with nothing. Create it, then tick what it may do.
              </Text>
              <Text className="text-slate-500 text-xs mt-3 mb-1">Name</Text>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Content Editor"
                placeholderTextColor="#64748B"
                className="text-white bg-slate-900 rounded-lg px-3 py-2"
              />
              <Text className="text-slate-500 text-xs mt-3 mb-1">Slug (permanent)</Text>
              <TextInput
                value={newSlug}
                onChangeText={(text) => setNewSlug(text.toLowerCase())}
                placeholder="content-editor"
                placeholderTextColor="#64748B"
                autoCapitalize="none"
                className="text-white bg-slate-900 rounded-lg px-3 py-2"
              />
              <View className="flex-row mt-3">
                <TouchableOpacity
                  onPress={() => setCreating(false)}
                  className="px-4 py-2 rounded-lg bg-slate-700 mr-2"
                >
                  <Text className="text-slate-300 font-medium">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  disabled={!newName.trim() || !newSlug.trim() || saving}
                  onPress={() => void create()}
                  className="px-4 py-2 rounded-lg bg-indigo-500"
                >
                  <Text className="text-white font-medium">Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => setCreating(true)}
              className="flex-row items-center justify-center p-4 rounded-xl border border-slate-700 mb-8"
            >
              <Plus size={18} color="#94A3B8" />
              <Text className="text-slate-300 font-medium ml-2">New role</Text>
            </TouchableOpacity>
          )
        ) : (
          <View className="h-8" />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
