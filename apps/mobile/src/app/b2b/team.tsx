/**
 * The account's own admin portal: who at this company can sign in.
 *
 * Parity with apps/web/src/pages/b2b/B2BAdmin.tsx. A seat is one person, so
 * removing one removes one — the alternative, which is what existed before, was
 * changing the shared password on everybody, and a login that stops working
 * with no explanation is the exact failure this whole subsystem was built to
 * end.
 *
 * Owner and admin reach this. An analyst is refused by the API as well; a
 * hidden link is not an access control.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { BACKEND_URL } from '@/lib/config';
import { useB2BStore, type B2BMemberRow } from '@/lib/b2b-store';

interface AccountLogin {
  username: string;
  name: string;
  role: 'owner';
  lastAccessAt: string | null;
  removable: false;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
}

const FIELD = 'bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white';

export default function B2BTeamScreen() {
  const router = useRouter();
  const session = useB2BStore((s) => s.session);
  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const verifySession = useB2BStore((s) => s.verifySession);
  const token = session?.token;

  const [members, setMembers] = useState<B2BMemberRow[]>([]);
  const [accountLogin, setAccountLogin] = useState<AccountLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<'admin' | 'analyst'>('analyst');
  const [addPassword, setAddPassword] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const [passwordForId, setPasswordForId] = useState<string | null>(null);
  /**
   * WHY THIS IS SEPARATE FROM `error`. Web twin:
   * apps/web/src/pages/b2b/B2BAdmin.tsx.
   *
   * Both the issued-credentials panel and the error line render near the top of
   * this screen; the set-password field sits inside a member's card, down a
   * scrolling list. On a phone that is reliably off-screen, so every answer
   * this form could give — the new password on success, the reason on failure —
   * was painted where the person who submitted it could not see it. It reads as
   * a button that does nothing, and that is how it was reported.
   */
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [typedPassword, setTypedPassword] = useState('');

  const headers = useCallback(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }),
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const body = await res.json();
      setMembers(body.members ?? []);
      setAccountLogin(body.accountLogin ?? null);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!hasHydrated) return;
    (async () => {
      const valid = await verifySession();
      if (!valid) {
        router.replace('/b2b/login');
        return;
      }
      await load();
    })();
  }, [hasHydrated, verifySession, load, router]);

  const addSeat = async () => {
    setError(null);
    if (addPassword && addPassword.length < 12) {
      setError('A password you type must be at least 12 characters. Leave it blank to generate one.');
      return;
    }
    setAddBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          username: addUsername.trim(),
          name: addName.trim(),
          role: addRole,
          ...(addEmail.trim() ? { email: addEmail.trim() } : {}),
          ...(addPassword ? { password: addPassword } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'That did not work.');
        return;
      }
      setIssued(body.credentials);
      setShowAdd(false);
      setAddUsername('');
      setAddName('');
      setAddEmail('');
      setAddPassword('');
      setAddRole('analyst');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch {
      setError('Network error. Nothing was created.');
    } finally {
      setAddBusy(false);
    }
  };

  const patchSeat = async (member: B2BMemberRow, data: Record<string, unknown>) => {
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${member.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) setError((await res.json()).error ?? 'That did not work.');
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const setPassword = async (memberId: string) => {
    setPasswordError(null);
    if (typedPassword && typedPassword.length < 12) {
      setPasswordError(
        'A password you type must be at least 12 characters. Leave it blank to generate one.',
      );
      return;
    }
    setBusyId(memberId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${memberId}/password`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(typedPassword ? { password: typedPassword } : {}),
      });
      const body = await res.json();
      if (!res.ok) {
        // Stays open, carrying its own reason. Closing on failure would throw
        // away what was typed AND hide why.
        setPasswordError(body.error ?? 'That did not work.');
        return;
      }
      setIssued(body.credentials);
      setPasswordForId(null);
      setTypedPassword('');
      await load();
    } catch {
      setPasswordError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusyId(null);
    }
  };

  const removeSeat = (member: B2BMemberRow) => {
    Alert.alert(
      `Remove ${member.name}?`,
      'Turning access off instead keeps their name on past activity. Removing is permanent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusyId(member.id);
            try {
              const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${member.id}`, {
                method: 'DELETE',
                headers: headers(),
              });
              if (!res.ok) setError((await res.json()).error ?? 'That did not work.');
              await load();
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Team</Text>
            <Text className="text-slate-400 text-sm">Who at your company can sign in</Text>
          </View>
          {!denied ? (
            <TouchableOpacity
              onPress={() => setShowAdd((open) => !open)}
              className="bg-indigo-500 px-3 py-2 rounded-xl flex-row items-center"
            >
              <Plus size={15} color="white" />
              <Text className="text-white font-medium ml-1">Add</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {denied ? (
          <View className="px-4 py-6">
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4">
              <Text className="text-white">
                Only an owner or admin on this account can manage who signs in.
              </Text>
              <Text className="text-slate-400 text-sm mt-2">
                Ask whoever set up your company's account to change your role, or to make the change
                for you.
              </Text>
            </View>
          </View>
        ) : (
          <ScrollView className="flex-1 px-4 py-4" showsVerticalScrollIndicator={false}>
            {issued ? (
              <View className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-4 mb-4">
                <View className="flex-row items-center">
                  <ShieldAlert size={16} color="#FBBF24" />
                  <Text className="text-amber-200 font-semibold text-sm ml-2">
                    Give these to {issued.username} now
                  </Text>
                </View>
                <Text className="text-amber-200/80 text-xs mt-1">
                  The password is stored as a hash. This is the only time it can be shown.
                </Text>
                <View className="bg-slate-950/70 rounded-lg px-3 py-2 mt-3">
                  <Text selectable className="text-amber-100 font-mono text-sm">
                    {issued.username} / {issued.password}
                  </Text>
                </View>
                <View className="flex-row mt-2">
                  <TouchableOpacity
                    onPress={async () => {
                      await Clipboard.setStringAsync(`${issued.username} / ${issued.password}`);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    }}
                    className="flex-row items-center bg-amber-500/20 rounded-lg px-3 py-2 flex-1 justify-center"
                  >
                    <Copy size={14} color="#FDE68A" />
                    <Text className="text-amber-100 text-sm font-medium ml-1.5">Copy</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setIssued(null)}
                    className="px-4 py-2 ml-2 justify-center"
                  >
                    <Text className="text-amber-200/80 text-sm">Done</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {error ? (
              <View className="bg-red-500/10 border border-red-500/40 rounded-lg px-4 py-2 mb-4">
                <Text className="text-red-300 text-sm">{error}</Text>
              </View>
            ) : null}

            <View className="flex-row items-center mb-4">
              <Users size={18} color="#818CF8" />
              <Text className="text-slate-300 ml-2">
                {members.length + (accountLogin ? 1 : 0)} people can sign in
              </Text>
            </View>

            {showAdd ? (
              <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-4">
                <Text className="text-slate-300 text-sm mb-1">Their name</Text>
                <TextInput
                  className={`${FIELD} mb-3`}
                  value={addName}
                  onChangeText={setAddName}
                  placeholder="Dana Okafor"
                  placeholderTextColor="#64748B"
                />

                <Text className="text-slate-300 text-sm mb-1">Username they will type</Text>
                <TextInput
                  className={`${FIELD} mb-3`}
                  value={addUsername}
                  onChangeText={setAddUsername}
                  autoCapitalize="none"
                  placeholder="dana"
                  placeholderTextColor="#64748B"
                />

                <Text className="text-slate-300 text-sm mb-1">Email (optional)</Text>
                <TextInput
                  className={`${FIELD} mb-3`}
                  value={addEmail}
                  onChangeText={setAddEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="dana@company.com"
                  placeholderTextColor="#64748B"
                />

                <Text className="text-slate-300 text-sm mb-1">What they can do</Text>
                <View className="flex-row mb-3">
                  {(['analyst', 'admin'] as const).map((role) => (
                    <TouchableOpacity
                      key={role}
                      onPress={() => setAddRole(role)}
                      className={`flex-1 py-2 rounded-lg mr-2 items-center border ${
                        addRole === role
                          ? 'bg-indigo-500/20 border-indigo-500'
                          : 'bg-slate-900/60 border-slate-700'
                      }`}
                    >
                      <Text
                        className={`text-sm capitalize ${
                          addRole === role ? 'text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        {role}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text className="text-slate-500 text-xs mb-3">
                  An analyst reads the dashboards. An admin can also manage this list.
                </Text>

                <Text className="text-slate-300 text-sm mb-1">Password (optional)</Text>
                <TextInput
                  className={FIELD}
                  value={addPassword}
                  onChangeText={setAddPassword}
                  autoCapitalize="none"
                  placeholder="Leave blank and one will be generated"
                  placeholderTextColor="#64748B"
                />
                {/* Both paths exist because both are things real administrators
                    do. Forcing a generated password is what gets it pasted into
                    a chat window so it can be read out. */}
                <Text className="text-slate-500 text-xs mt-1">
                  Type one if you are handing it over in person. Either way it is shown once and
                  stored hashed.
                </Text>

                <TouchableOpacity
                  onPress={addSeat}
                  disabled={addBusy}
                  className={`bg-indigo-600 rounded-lg py-3 mt-4 items-center ${
                    addBusy ? 'opacity-60' : ''
                  }`}
                >
                  {addBusy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-medium">Create the seat</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowAdd(false)} className="py-3 items-center">
                  <Text className="text-slate-400">Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {accountLogin ? (
              <View className="bg-slate-800/20 border border-slate-700/50 rounded-2xl p-4 mb-3">
                <Text className="text-white font-semibold">{accountLogin.name}</Text>
                <Text className="text-slate-400 text-sm">
                  {accountLogin.username} — last signed in {when(accountLogin.lastAccessAt)}
                </Text>
                <View className="flex-row items-center mt-2">
                  <View className="bg-purple-500/20 rounded-full px-3 py-1">
                    <Text className="text-purple-300 text-xs font-medium">Company account</Text>
                  </View>
                  {/* Listed rather than hidden: from the point of view of "who
                      can get in", it is one more login that exists. */}
                  <Text className="text-slate-500 text-xs ml-2">cannot be removed</Text>
                </View>
              </View>
            ) : null}

            {members.map((member) => (
              <View
                key={member.id}
                className={`rounded-2xl p-4 mb-3 border ${
                  member.disabled
                    ? 'bg-slate-900/40 border-slate-800 opacity-70'
                    : 'bg-slate-800/30 border-slate-700/50'
                }`}
              >
                <Text className="text-white font-semibold">
                  {member.name}
                  {member.disabled ? (
                    <Text className="text-slate-500 text-xs font-normal">  access off</Text>
                  ) : null}
                </Text>
                <Text className="text-slate-400 text-sm">
                  {member.username}
                  {member.email ? ` — ${member.email}` : ''}
                </Text>
                <Text className="text-slate-500 text-xs">
                  Last signed in {when(member.lastAccessAt)}
                </Text>

                <View className="flex-row mt-3">
                  {(['analyst', 'admin'] as const).map((role) => (
                    <TouchableOpacity
                      key={role}
                      onPress={() => {
                        if (member.role !== role) patchSeat(member, { role });
                      }}
                      disabled={busyId === member.id}
                      className={`px-3 py-1.5 rounded-lg mr-2 border ${
                        member.role === role
                          ? 'bg-indigo-500/20 border-indigo-500'
                          : 'bg-slate-900/60 border-slate-700'
                      }`}
                    >
                      <Text
                        className={`text-xs capitalize ${
                          member.role === role ? 'text-indigo-300' : 'text-slate-400'
                        }`}
                      >
                        {role}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View className="flex-row mt-3">
                  <TouchableOpacity
                    onPress={() => {
                      setPasswordForId(passwordForId === member.id ? null : member.id);
                      setPasswordError(null);
                      setTypedPassword('');
                    }}
                    disabled={busyId === member.id}
                    className="flex-row items-center bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 mr-2"
                  >
                    <KeyRound size={14} color="white" />
                    <Text className="text-white text-sm ml-1.5">Set password</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => patchSeat(member, { disabled: !member.disabled })}
                    disabled={busyId === member.id}
                    className="flex-row items-center bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 mr-2"
                  >
                    {member.disabled ? (
                      <UserCheck size={14} color="white" />
                    ) : (
                      <UserX size={14} color="white" />
                    )}
                    <Text className="text-white text-sm ml-1.5">
                      {member.disabled ? 'Access on' : 'Access off'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => removeSeat(member)}
                    disabled={busyId === member.id}
                    className="bg-red-950/40 border border-red-900/60 rounded-lg p-2"
                  >
                    <Trash2 size={14} color="#F87171" />
                  </TouchableOpacity>
                </View>

                {passwordForId === member.id ? (
                  <View className="mt-4 pt-4 border-t border-slate-700/50">
                    <Text className="text-slate-300 text-sm mb-1">
                      New password for {member.name}
                    </Text>
                    <TextInput
                      className={FIELD}
                      value={typedPassword}
                      onChangeText={setTypedPassword}
                      autoCapitalize="none"
                      placeholder="Leave blank and one will be generated"
                      placeholderTextColor="#64748B"
                    />
                    {passwordError ? (
                      <Text className="text-red-300 text-sm mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
                        {passwordError}
                      </Text>
                    ) : null}
                    <Text className="text-slate-500 text-xs mt-1">
                      This signs {member.name} out everywhere and nobody else at your company. The
                      new password appears at the top of this screen, once.
                    </Text>
                    <TouchableOpacity
                      onPress={() => setPassword(member.id)}
                      className="bg-indigo-600 rounded-lg py-2.5 mt-3 items-center"
                    >
                      <Text className="text-white font-medium">Set it</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ))}

            {members.length === 0 ? (
              <View className="bg-slate-800/20 border border-slate-700/50 rounded-2xl p-5">
                <Text className="text-white">Only the company account login exists so far.</Text>
                <Text className="text-slate-400 text-sm mt-1">
                  Add a seat for each person who needs the dashboards. Then nobody has to share a
                  password, and turning one person's access off leaves everyone else signed in.
                </Text>
              </View>
            ) : null}

            <View className="h-8" />
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
