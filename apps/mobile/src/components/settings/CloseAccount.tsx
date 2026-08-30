// Closing your account, and being told the truth about it first.
// Web twin: apps/web/src/components/settings/CloseAccount.tsx
//
// WHY IT EXISTS. There was no way to leave. An account could only be removed by
// an administrator, so getting out meant asking permission from the people you
// were trying to leave. The owner's instruction: holding somebody's data to
// keep our own system tidy violates their sovereignty, and the decision should
// have real consequences for them and for others.
//
// WHY THE WARNING IS THIS LONG. Every line is a real consequence of what
// services/account-deletion.ts does, and several land on OTHER people — the
// conversation they are in, the count on a law somebody else is reading, the
// delegate whose borrowed voice goes back. Nothing here is written for effect:
// if a line could not be traced to code, it is not on the screen.
//
// WHY TWO STEPS. The password, because an unlocked phone must not be enough to
// erase somebody's civic record. And the typed name, because a single tap is
// how this happens by accident, and it cannot be undone by us or by anyone.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { TriangleAlert } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api/api';
import { useAuthStore } from '@/lib/auth-store';

export function CloseAccount() {
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Their username if they have one, otherwise their email. Not every account
  // carries a username, and one that does not must still be closable by the
  // person it belongs to.
  const identifier = me?.username || me?.email || '';
  const matches = confirm.trim().toLowerCase() === identifier.toLowerCase();

  async function close() {
    setWorking(true);
    setError(null);
    try {
      await api.delete('/api/users/me', { password, confirmUsername: confirm });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // The session is already dead on the server; clear it here too rather
      // than leaving a signed-in shell pointing at nothing.
      await signOut?.();
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The account could not be closed.');
      setWorking(false);
    }
  }

  if (!open) {
    return (
      <View className="bg-slate-900/60 border border-red-900/40 rounded-2xl p-4 mb-6">
        <Text className="text-white font-semibold text-base">Close your account</Text>
        <Text className="text-slate-400 text-sm mt-1">
          Erase your account and everything on it, permanently.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close my account"
          onPress={() => setOpen(true)}
          className="mt-4 border border-red-900/60 rounded-xl py-3 items-center"
        >
          <Text className="text-red-400 font-semibold">Close my account</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="bg-red-950/20 border border-red-900/60 rounded-2xl p-4 mb-6">
      <View className="flex-row items-center mb-3">
        <TriangleAlert size={18} color="#F87171" />
        <Text className="text-white font-semibold text-base ml-2">
          This erases everything, permanently.
        </Text>
      </View>

      {/* Each line is something the deletion routine actually does. */}
      {[
        'Your posts and replies disappear from every conversation they are in.',
        "Your votes are removed from every law's count. The published tally on those laws will change.",
        "Your messages vanish from the other person's inbox.",
        'Delegations end. Anyone who lent you their voice gets it back, and any voice you borrowed returns to them.',
        'Your trust score, your badges and your record are gone.',
        'If you are sitting on a jury right now, your seat is given up and a new juror is drawn at random.',
        'If you have voted in an impeachment or a system reset that is still open, that vote is withdrawn.',
      ].map((line) => (
        <Text key={line} className="text-slate-200 text-sm mb-1.5">
          • {line}
        </Text>
      ))}

      <Text className="text-slate-300 text-sm mt-2">
        Proceedings that have already finished are not undone. A jury that has returned its
        verdict, an impeachment that concluded, a reset that took effect — those outcomes
        stand, with your name off them.
      </Text>

      <Text className="text-white text-sm font-semibold mt-3">
        We keep no copy. There is no undo, and no support request can bring it back. If you
        sign up again later it will be a new account, starting at zero.
      </Text>

      <Text className="text-slate-400 text-xs mt-4 mb-1">Your password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholderTextColor="#64748B"
        className="bg-slate-800 text-white rounded-xl px-4 py-3"
      />

      <Text className="text-slate-400 text-xs mt-3 mb-1">
        Type {identifier} to confirm
      </Text>
      <TextInput
        value={confirm}
        onChangeText={setConfirm}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor="#64748B"
        className="bg-slate-800 text-white rounded-xl px-4 py-3"
      />

      {error ? <Text className="text-red-400 text-sm mt-3">{error}</Text> : null}

      <View className="flex-row mt-4">
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setOpen(false);
            setPassword('');
            setConfirm('');
            setError(null);
          }}
          disabled={working}
          className="flex-1 border border-slate-700 rounded-xl py-3 items-center mr-2"
        >
          <Text className="text-slate-300 font-semibold">Keep my account</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Erase my account permanently"
          onPress={() => void close()}
          disabled={working || password.length === 0 || !matches}
          className={`flex-1 rounded-xl py-3 items-center ${
            working || password.length === 0 || !matches ? 'bg-red-900/40' : 'bg-red-600'
          }`}
        >
          {working ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold">Erase permanently</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
