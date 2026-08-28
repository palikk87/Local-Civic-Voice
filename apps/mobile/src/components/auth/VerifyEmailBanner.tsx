// "You can read everything. You can't take part yet." — and here is where you finish.
// Web twin: apps/web/src/components/auth/VerifyEmailBanner.tsx
//
// WHAT THIS FIXES. Until now the code box lived inside the sign-up form and
// nowhere else, on either client. Close that form — a reload, a backgrounded
// app, or pressing "Look around first" — and there was no way back to it. On
// mobile there was not even a banner: an unverified account browsed a normal
// app whose vote buttons quietly answered 403, with nothing on screen to say
// why or what to do.
//
// This is that missing sign, and it opens the same VerifyEmailStep the last
// step of sign-up uses, so there is one place that knows how to finish
// verifying and both routes in lead to it.
//
// Renders nothing for a verified account and nothing for a signed-out visitor.
import React, { useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MailWarning, X } from 'lucide-react-native';

import { useCurrentUser } from '@/lib/auth/use-civic-auth';
import { VerifyEmailStep } from './VerifyEmailStep';

/**
 * Whether this visitor is signed in but has not entered their code.
 *
 * Exported because the tab layout needs the same answer the banner does: it has
 * to know whether the top inset was spent by the banner before handing the
 * screens below a zeroed one. Two copies of this condition would drift.
 */
export function useNeedsEmailVerification(): boolean {
  const { user } = useCurrentUser();
  // Better Auth carries emailVerified on the session user. An older session
  // shape without the field must not paint a banner at everybody.
  const verified = (user as { emailVerified?: boolean } | null)?.emailVerified;
  return !!user && verified === false;
}

export function VerifyEmailBanner() {
  const { user } = useCurrentUser();
  const needsVerification = useNeedsEmailVerification();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!needsVerification) return null;

  const email = (user as { email?: string } | null)?.email ?? '';

  return (
    <>
      <View
        style={{ paddingTop: insets.top }}
        className="flex-row items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5"
      >
        <MailWarning size={16} color="#F59E0B" />
        <Text className="flex-1 text-slate-100 text-sm">
          Enter the code we emailed you to vote, delegate or post.{' '}
          <Text className="text-slate-400">Reading stays open either way.</Text>
        </Text>
        <Pressable
          onPress={() => setOpen(true)}
          className="rounded-lg bg-amber-500 px-3 py-1.5"
        >
          <Text className="text-slate-900 text-sm font-semibold">Enter code</Text>
        </Pressable>
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView className="flex-1 bg-slate-900">
          <View className="flex-row justify-end px-4 py-3">
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <X size={22} color="#94A3B8" />
            </Pressable>
          </View>
          {/* SCROLLS. The code box, the resend link and the explanation are
              taller than a short phone with the keyboard up, and without this
              the bottom of it could not be reached at all. */}
          <ScrollView className="px-5" keyboardShouldPersistTaps="handled">
            {/* No "Look around first" here: they already are. Closing the sheet
                costs nothing and the banner stays until they finish. */}
            <VerifyEmailStep email={email} onVerified={() => setOpen(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
