// The last step of signing up: the code from the email.
// Web twin: apps/web/src/components/auth/VerifyEmailStep.tsx
//
// WHY THERE IS A STEP HERE AT ALL. Constitution Article I, Section 3 says only
// verified human beings may contribute to the Pulse, and Bill of Rights
// Article III asks for anti-bot verification so that "no bot-driven influence
// shall obscure the true will of the people". Until now nothing checked: an
// account could be created and vote in the same second, a thousand times over,
// from a script.
//
// WHAT IT HONESTLY BUYS. A code to an inbox makes a thousand accounts cost
// something instead of nothing. It is not proof that anybody is real —
// disposable inboxes exist — and the copy below does not claim it is.
//
// READING STAYS OPEN THROUGHOUT. Somebody who closes this can still browse
// every law, brief and tally; they simply cannot vote or post until they
// finish. The government's business is the public good; the Pulse is the thing
// that has to be protected.
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { MailCheck } from 'lucide-react-native';

import { authClient } from '@/lib/auth/auth-client';

export function VerifyEmailStep({
  email,
  onVerified,
  onSkip,
}: {
  email: string;
  onVerified: () => void;
  onSkip?: () => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function verify() {
    const clean = code.trim();
    if (clean.length < 4) {
      setError('Enter the code from your email');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.verifyEmail({ email, otp: clean });
      if (err) {
        setError(err.message || 'That code did not work. Check it and try again.');
        return;
      }

      // The session carries emailVerified, and so does every gated route's
      // answer. Both have to be re-read or the app keeps refusing writes that
      // would now succeed.
      await queryClient.invalidateQueries();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onVerified();
    } catch {
      setError('That code did not work. Check it and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: 'email-verification',
      });
      setNotice(err ? null : 'Sent. It can take a minute to arrive.');
      if (err) setError(err.message || 'Could not send another code.');
    } catch {
      setError('Could not send another code.');
    } finally {
      setResending(false);
    }
  }

  return (
    <View>
      <View className="items-center mb-4">
        <View className="w-12 h-12 rounded-full bg-amber-500/20 items-center justify-center mb-3">
          <MailCheck size={24} color="#F59E0B" />
        </View>
        <Text className="text-white text-xl font-semibold">Check your email</Text>
        <Text className="text-slate-400 text-sm mt-1 text-center">
          We sent a code to <Text className="text-white font-medium">{email}</Text>.
        </Text>
      </View>

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="6-digit code"
        placeholderTextColor="#475569"
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={8}
        className="bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-3 text-white text-lg text-center"
        style={{ letterSpacing: 8 }}
      />

      {/* Said plainly, because a claim of anti-bot protection that overstates
          itself is worse than none. */}
      <Text className="text-slate-500 text-xs mt-1.5">
        This is how the Pulse stays a count of citizens rather than of accounts.
      </Text>

      {error ? <Text className="text-red-400 text-sm mt-2">{error}</Text> : null}
      {notice ? <Text className="text-slate-400 text-sm mt-2">{notice}</Text> : null}

      <Pressable
        disabled={loading}
        onPress={() => void verify()}
        className="bg-amber-500 rounded-xl py-3 items-center mt-4"
        style={{ opacity: loading ? 0.6 : 1 }}
      >
        {loading ? (
          <ActivityIndicator color="#0F172A" />
        ) : (
          <Text className="text-slate-900 font-semibold">Verify</Text>
        )}
      </Pressable>

      <View className="flex-row items-center justify-between mt-4">
        <Pressable disabled={resending} onPress={() => void resend()}>
          <Text className="text-amber-500 text-sm">
            {resending ? 'Sending…' : 'Send another code'}
          </Text>
        </Pressable>

        {onSkip ? (
          <Pressable onPress={onSkip}>
            <Text className="text-slate-400 text-sm">Look around first</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
