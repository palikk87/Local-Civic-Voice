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
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import * as Haptics from 'expo-haptics';
import { TriangleAlert } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { api } from '@/lib/api/api';
import { useAuthStore } from '@/lib/auth-store';

interface HoldingProceeding {
  kind: 'impeachment' | 'system_reset' | 'report';
  id: string;
  role: 'filed' | 'subject';
  label: string;
  openedAt: string;
  expectedBy: string | null;
}

export function CloseAccount() {
  const router = useRouter();
  const me = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState<HoldingProceeding[] | null>(null);

  /*
   * WHAT WOULD HOLD THE RECORD BACK, ASKED BEFORE THEY CONFIRM.
   *
   * Amendment IV: the platform "shall state what it protects and how, and shall
   * claim no protection it does not provide." The "we keep no copy" line below
   * is true for almost everybody and false for somebody in the middle of a
   * proceeding, and a warning that goes wrong exactly when the stakes are
   * highest is worse than none. So the screen asks, and says what it is told.
   *
   * Identical to the web screen on purpose. This is the one sentence on the
   * platform that must not differ between a phone and a computer.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .get<{ wouldBeHeld: boolean; held: HoldingProceeding[] }>('/api/users/me/closing')
      .then((answer) => {
        if (!cancelled) setHeld(answer?.held ?? []);
      })
      // An unreachable server is not "nothing is holding you". Left null, which
      // shows the honest line rather than a false all-clear.
      .catch(() => {
        if (!cancelled) setHeld(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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

      {/*
        THE PROMISE, MADE ONLY WHERE IT IS TRUE. See the note on the effect
        above: "we keep no copy" is false while a proceeding is holding the
        record, so it is said three different ways depending on the answer.
      */}
      {held && held.length > 0 ? (
        <View className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <Text className="text-white text-sm font-semibold">
            Your account will not be erased immediately.
          </Text>
          <Text className="text-slate-300 text-sm mt-2">
            You are a party to {held.length === 1 ? 'a proceeding' : `${held.length} proceedings`}{' '}
            that {held.length === 1 ? 'has' : 'have'} not yet been decided. Your account is closed
            immediately — you are signed out and it cannot be used again — but your profile
            remains visible to those entitled to see it until{' '}
            {held.length === 1 ? 'it is' : 'they are'} concluded, so that the record before them
            stays complete for the duration of the proceedings.
          </Text>

          {held.map((one) => (
            <View
              key={`${one.kind}-${one.id}`}
              className="mt-3 border-l-2 border-amber-500/50 pl-3"
            >
              <Text className="text-slate-200 text-sm font-medium">{one.label}</Text>
              <Text className="text-slate-400 text-xs mt-0.5">
                {one.role === 'filed' ? 'Brought by you.' : 'Brought against you.'} Opened{' '}
                {new Date(one.openedAt).toLocaleDateString()}.{' '}
                {one.expectedBy
                  ? `Currently scheduled to conclude ${new Date(one.expectedBy).toLocaleDateString()}.`
                  : /*
                     * A report waits on a jury and a jury waits on people, so
                     * there is no honest date. Saying so beats inventing one.
                     */
                    'No scheduled conclusion — it ends when it is decided.'}
              </Text>
            </View>
          ))}

          <Text className="text-white text-sm font-semibold mt-3">
            This closure is final and takes effect immediately; it is not a waiting period, and
            it cannot be reversed. Your profile remains visible solely for the purposes of the
            proceedings listed above, and is permanently erased once the last of them has been
            decided.
          </Text>
        </View>
      ) : null}

      <Text className="text-white text-sm font-semibold mt-3">
        {held === null
          ? 'We could not check whether anything is holding your account right now. There is no undo either way, and no support request can bring it back. If you sign up again later it will be a new account, starting at zero.'
          : held.length > 0
            ? 'Once those are decided we keep no copy. There is no undo, and no support request can bring it back. If you sign up again later it will be a new account, starting at zero.'
            : 'We keep no copy. There is no undo, and no support request can bring it back. If you sign up again later it will be a new account, starting at zero.'}
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
