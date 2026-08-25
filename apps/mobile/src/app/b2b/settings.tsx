/**
 * What a client can change about its own account, without asking us.
 *
 * Parity with apps/web/src/pages/b2b/B2BSettings.tsx. Same endpoints, same
 * rules: the current password is required for every change, a secret is shown
 * exactly once, and the credential history is readable by the party it is
 * about — because the last time a B2B password moved without an explanation it
 * cost a week and a customer's confidence.
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
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  Building2,
  Copy,
  History,
  KeyRound,
  Lock,
  ShieldAlert,
  User,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { BACKEND_URL } from '@/lib/config';
import { useB2BStore, type B2BAccountInfo } from '@/lib/b2b-store';

interface SecurityHistory {
  credentials: { lastRotatedAt: string | null; rotationCount: number };
  history: { action: string; at: string; changedBy: string; details: string }[];
}

function when(iso: string | null | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mb-4">
      <View className="flex-row items-center mb-3">
        {icon}
        <Text className="text-white font-semibold text-base ml-2">{title}</Text>
      </View>
      {children}
    </View>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <View className="flex-row justify-between py-1">
      <Text className="text-slate-400 text-sm">{term}</Text>
      <Text className="text-white text-sm font-medium flex-1 text-right ml-4">{value}</Text>
    </View>
  );
}

function ShownOnce({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <View className="mt-4 bg-amber-500/10 border border-amber-500/40 rounded-xl p-4">
      <View className="flex-row items-center">
        <ShieldAlert size={16} color="#FBBF24" />
        <Text className="text-amber-200 font-semibold text-sm ml-2">{label} — copy it now</Text>
      </View>
      <Text className="text-amber-200/80 text-xs mt-1">
        It is stored as a hash. Nobody, including us, can show it to you again.
      </Text>
      <View className="bg-slate-950/70 rounded-lg px-3 py-2 mt-3">
        <Text selectable className="text-amber-100 font-mono text-sm">
          {value}
        </Text>
      </View>
      <TouchableOpacity
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setCopied(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
        className="flex-row items-center justify-center bg-amber-500/20 rounded-lg px-3 py-2 mt-2"
      >
        <Copy size={14} color="#FDE68A" />
        <Text className="text-amber-100 text-sm font-medium ml-1.5">
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const FIELD =
  'bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white';

export default function B2BSettingsScreen() {
  const router = useRouter();
  const session = useB2BStore((s) => s.session);
  const verifySession = useB2BStore((s) => s.verifySession);
  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const token = session?.token;

  const [info, setInfo] = useState<B2BAccountInfo | null>(null);
  const [security, setSecurity] = useState<SecurityHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState<string | null>(null);

  const [keyPassword, setKeyPassword] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [accountRes, securityRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/b2b/account`, { headers }),
      fetch(`${BACKEND_URL}/api/b2b/account/security`, { headers }),
    ]);
    if (accountRes.ok) setInfo(await accountRes.json());
    if (securityRes.ok) setSecurity(await securityRes.json());
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

  const changePassword = async () => {
    setPasswordError(null);
    setPasswordDone(null);

    if (newPassword !== confirmPassword) {
      setPasswordError('The two new passwords do not match.');
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError('Use at least 12 characters.');
      return;
    }

    setPasswordBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/account/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPasswordError(body.error ?? 'That did not work.');
        return;
      }

      // The change ended every session this password opened, including this
      // one. The server hands back a replacement so the person who just
      // changed their own password is not thrown out of the app for it.
      if (body.token && session) {
        useB2BStore.setState({
          session: { ...session, token: body.token, expiresAt: body.expiresAt },
        });
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordDone(
        body.otherSessionsEnded > 0
          ? `Password changed. ${body.otherSessionsEnded} other device${
              body.otherSessionsEnded === 1 ? '' : 's'
            } signed out.`
          : 'Password changed.',
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch {
      setPasswordError('Network error. Nothing was changed.');
    } finally {
      setPasswordBusy(false);
    }
  };

  const issueKey = async () => {
    setKeyError(null);
    setIssuedKey(null);
    setKeyBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/account/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: keyPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setKeyError(body.error ?? 'That did not work.');
        return;
      }
      setIssuedKey(body.apiKey);
      setKeyPassword('');
      await load();
    } catch {
      setKeyError('Network error. Nothing was changed.');
    } finally {
      setKeyBusy(false);
    }
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
            <Text className="text-white text-lg font-semibold">Settings</Text>
            <Text className="text-slate-400 text-sm">Your account and its credentials</Text>
          </View>
        </View>

        <ScrollView className="flex-1 px-4 py-4" showsVerticalScrollIndicator={false}>
          <Card title="Account" icon={<Building2 size={18} color="#818CF8" />}>
            {info ? (
              <>
                <Row term="Company" value={info.account.name} />
                <Row term="Account login" value={info.account.username} />
                <Row term="Plan" value={info.account.tier} />
                <Row term="Type" value={info.account.type} />
                <Row term="Customer since" value={when(info.account.createdAt)} />
                <Row term="Last sign-in" value={when(info.account.lastAccessAt)} />
                <Row term="People who can sign in" value={String(info.account.activeSeats)} />
              </>
            ) : (
              <Text className="text-slate-400 text-sm">
                Account details are unavailable right now.
              </Text>
            )}
          </Card>

          {info ? (
            <Card title="Signed in as" icon={<User size={18} color="#818CF8" />}>
              <Text className="text-white text-lg font-semibold">
                {info.signedInAs.kind === 'member' ? info.signedInAs.name : info.account.name}
              </Text>
              <Text className="text-slate-400 text-sm">{info.signedInAs.username}</Text>
              <View className="bg-indigo-500/20 self-start rounded-full px-3 py-1 mt-3">
                <Text className="text-indigo-300 text-xs font-medium capitalize">{info.role}</Text>
              </View>
              <Text className="text-slate-400 text-xs mt-3">
                {info.signedInAs.kind === 'member'
                  ? 'This is your own seat. Your password is yours alone — changing it affects nobody else at your company.'
                  : 'This is the company account login. It cannot be removed, and it is the only login that holds the API key.'}
              </Text>
            </Card>
          ) : null}

          {info?.canManageSeats ? (
            <TouchableOpacity
              onPress={() => router.push('/b2b/team')}
              className="bg-indigo-500/10 border border-indigo-500/30 rounded-2xl p-4 mb-4"
            >
              <Text className="text-indigo-300 font-semibold">Manage who can sign in</Text>
              <Text className="text-slate-400 text-sm mt-1">
                Add a seat for each person, so nobody has to share a password.
              </Text>
            </TouchableOpacity>
          ) : null}

          <Card title="Change your password" icon={<Lock size={18} color="#818CF8" />}>
            <Text className="text-slate-300 text-sm mb-1">Current password</Text>
            <TextInput
              className={FIELD}
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Your current password"
              placeholderTextColor="#64748B"
            />
            <Text className="text-slate-500 text-xs mt-1 mb-3">
              Asked for every time. A phone left unlocked on a table should not be enough to lock
              you out of your own account.
            </Text>

            <Text className="text-slate-300 text-sm mb-1">New password</Text>
            <TextInput
              className={`${FIELD} mb-3`}
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 12 characters"
              placeholderTextColor="#64748B"
            />

            <Text className="text-slate-300 text-sm mb-1">New password again</Text>
            <TextInput
              className={FIELD}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Type it once more"
              placeholderTextColor="#64748B"
            />

            {passwordError ? (
              <Text className="text-red-400 text-sm mt-3">{passwordError}</Text>
            ) : null}
            {passwordDone ? (
              <Text className="text-emerald-400 text-sm mt-3">{passwordDone}</Text>
            ) : null}

            <TouchableOpacity
              onPress={changePassword}
              disabled={passwordBusy}
              className={`bg-indigo-600 rounded-lg py-3 mt-4 items-center ${
                passwordBusy ? 'opacity-60' : ''
              }`}
            >
              {passwordBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-medium">Change password</Text>
              )}
            </TouchableOpacity>
          </Card>

          {info?.canRotateApiKey ? (
            <Card title="API key" icon={<KeyRound size={18} color="#818CF8" />}>
              <Text className="text-slate-400 text-sm mb-3">
                Issuing a new key stops the old one working immediately. Anything using it — a
                script, a scheduled export — needs the new value.
              </Text>
              <Text className="text-slate-300 text-sm mb-1">Confirm with your password</Text>
              <TextInput
                className={FIELD}
                secureTextEntry
                value={keyPassword}
                onChangeText={setKeyPassword}
                placeholder="Your current password"
                placeholderTextColor="#64748B"
              />
              {keyError ? <Text className="text-red-400 text-sm mt-3">{keyError}</Text> : null}
              <TouchableOpacity
                onPress={issueKey}
                disabled={keyBusy}
                className={`bg-slate-800 border border-slate-600 rounded-lg py-3 mt-4 items-center ${
                  keyBusy ? 'opacity-60' : ''
                }`}
              >
                {keyBusy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-medium">Issue a new API key</Text>
                )}
              </TouchableOpacity>
              {issuedKey ? <ShownOnce label="New API key" value={issuedKey} /> : null}
            </Card>
          ) : null}

          <Card title="Credential history" icon={<History size={18} color="#818CF8" />}>
            <Text className="text-slate-400 text-sm mb-3">
              Every change ever made to this account's password or API key, and who made it. Nothing
              in our backend changes a credential on its own — if something moved, this says who
              moved it.
            </Text>
            {security && security.history.length > 0 ? (
              security.history.map((event, index) => (
                <View
                  key={`${event.at}-${index}`}
                  className="border-l-2 border-slate-700 pl-3 mb-3"
                >
                  <Text className="text-white text-sm font-medium">{event.details}</Text>
                  <Text className="text-slate-400 text-xs">
                    {when(event.at)} — {event.changedBy}
                  </Text>
                </View>
              ))
            ) : (
              /* The honest empty state. Nothing has happened, and that is the
                 good case — not a failure to load. */
              <Text className="text-slate-400 text-sm">
                Nothing has been changed since this account was created.
              </Text>
            )}
          </Card>

          <View className="h-8" />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
