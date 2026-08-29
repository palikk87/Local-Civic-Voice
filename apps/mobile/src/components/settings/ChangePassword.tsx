// Change your own password, while signed in.
// Web twin: apps/web/src/components/settings/ChangePassword.tsx
//
// WHY THIS EXISTS. No backend process re-keys anybody on this platform — the
// seed scripts create and never overwrite, and a credential only moves through
// one audited service. That rule is only livable if the people who should be
// able to change a password still can, and until now a signed-in person could
// not. The only route to a new one was "forgot password": sign out, wait for an
// email, type a code — for something they already had every right to do.
//
// The current password is required. A session is not consent to change the
// credential behind it, and without that check anybody who picks up an unlocked
// phone takes the account for good.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Switch } from 'react-native';
import * as Haptics from 'expo-haptics';
import { KeyRound } from 'lucide-react-native';

import { api } from '@/lib/api/api';

export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function validate(): string | null {
    if (!current) return 'Enter your current password.';
    if (next.length < 8) return 'Use at least 8 characters for the new one.';
    if (next !== confirm) return 'The two new passwords do not match.';
    if (next === current) return 'That is the password you already have.';
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }

    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const result = await api.post<{ signedOutOtherDevices: number }>(
        '/api/users/me/password',
        { currentPassword: current, newPassword: next, signOutOtherDevices: signOutOthers },
      );

      setCurrent('');
      setNext('');
      setConfirm('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNotice(
        signOutOthers && result.signedOutOtherDevices > 0
          ? `Changed. Signed out on ${result.signedOutOtherDevices} other ${
              result.signedOutOtherDevices === 1 ? 'device' : 'devices'
            }. You are still signed in here.`
          : 'Changed. You are still signed in here.',
      );
    } catch (e) {
      // The server's own words — "That is not your current password", or a
      // validation message. Nothing here guesses.
      setError(e instanceof Error ? e.message : 'Could not change your password.');
    } finally {
      setSaving(false);
    }
  }

  const field =
    'bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white mt-1.5';

  return (
    <View className="bg-slate-800/40 rounded-xl p-4 mb-6">
      <View className="flex-row items-center mb-1">
        <KeyRound size={18} color="#F59E0B" />
        <Text className="text-white font-semibold ml-2">Password</Text>
      </View>
      <Text className="text-slate-400 text-sm">
        Yours to change, whenever you want. Nothing on this platform changes it for you.
      </Text>

      <View className="mt-4">
        <Text className="text-slate-300 text-sm">Current password</Text>
        <TextInput
          value={current}
          onChangeText={setCurrent}
          secureTextEntry
          autoComplete="current-password"
          placeholderTextColor="#4C6659"
          className={field}
        />
      </View>

      <View className="mt-3">
        <Text className="text-slate-300 text-sm">New password</Text>
        <TextInput
          value={next}
          onChangeText={setNext}
          secureTextEntry
          autoComplete="new-password"
          placeholderTextColor="#4C6659"
          className={field}
        />
      </View>

      <View className="mt-3">
        <Text className="text-slate-300 text-sm">New password again</Text>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoComplete="new-password"
          placeholderTextColor="#4C6659"
          className={field}
        />
      </View>

      <View className="flex-row items-center justify-between mt-4">
        <Text className="text-slate-300 text-sm flex-1 pr-3">
          {/* Default on: somebody changing a password usually thinks somebody
              else has it. This device is never signed out. */}
          Sign out everywhere else. This device stays signed in.
        </Text>
        <Switch
          value={signOutOthers}
          onValueChange={setSignOutOthers}
          trackColor={{ false: '#2C4A3C', true: '#F59E0B' }}
          thumbColor="#F5F0E6"
        />
      </View>

      {error ? <Text className="text-red-400 text-sm mt-3">{error}</Text> : null}
      {notice ? <Text className="text-slate-300 text-sm mt-3">{notice}</Text> : null}

      <Pressable
        disabled={saving}
        onPress={() => void submit()}
        className="bg-amber-500 rounded-xl py-3 items-center mt-4"
        style={{ opacity: saving ? 0.6 : 1 }}
      >
        {saving ? (
          <ActivityIndicator color="#0C1D18" />
        ) : (
          <Text className="text-slate-900 font-semibold">Change password</Text>
        )}
      </Pressable>
    </View>
  );
}
