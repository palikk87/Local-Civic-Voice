/**
 * The first-run welcome — a modal, shown until the Terms and the Privacy Policy
 * are accepted.
 *
 * Web twin: apps/web/src/components/feed/BetaWelcomeDialog.tsx
 *
 * THE PHONE HAD NOTHING LIKE THIS. Sign-up carried a line of "consent by
 * action" text and the Terms one tap away; the Privacy Policy was not mentioned
 * at all, and nothing was ever recorded. So an account created on the phone
 * reached the server with no acceptance against it, and the web then asked the
 * same person to accept again — which is exactly the "two profiles" feeling
 * ONE PROFILE, EVERY DEVICE exists to remove.
 *
 * ACCEPTANCE IS VERSIONED AND LIVES ON THE PROFILE, so it follows a person to
 * every device and a later material change re-prompts rather than being
 * assumed. A signed-out visitor has no profile to record against, so this
 * device remembers for them until they have one.
 *
 * IT IS MOUNTED LAST, on purpose. The vote-anonymity dialog and the jury gate
 * sit beside it in _layout, and the last modal mounted is the one that paints
 * on top — which is the right one here, because consent is the thing that must
 * be answered before anything else is asked. It is also the only one of the
 * three a brand-new visitor can meet, since the other two need a vote or a
 * summons to have happened first.
 */
import { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sparkles, Check } from 'lucide-react-native';

import { api } from '@/lib/api/api';
import { TERMS_VERSION } from '@/lib/terms';
import { PRIVACY_VERSION } from '@/lib/privacy';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';

/** What version THIS DEVICE has accepted — for signed-out visitors only. */
const ACCEPTED_KEY = 'ayeandnay:accepted-terms-version';

export function BetaWelcomeGate() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const { isAuthenticated, isLoading } = useCurrentUser();

  useEffect(() => {
    // Wait for the session before deciding. Asking a signed-in person to accept
    // again, because their session had not resolved yet, is the exact thing
    // this is meant to remove.
    if (isLoading) return;
    let cancelled = false;

    if (isAuthenticated) {
      api
        .get<{ acceptedVersion: string | null; privacyVersion: string | null }>(
          '/api/users/me/terms',
        )
        .then((answer) => {
          // Either being out of date brings this back. They are recorded
          // separately so a change to one does not silently re-ask for both.
          const stale =
            answer?.acceptedVersion !== TERMS_VERSION ||
            answer?.privacyVersion !== PRIVACY_VERSION;
          if (!cancelled) setShow(stale);
        })
        // Unreachable server: ask rather than assume. Accepting twice costs a
        // tap; assuming an agreement nobody gave costs more than that.
        .catch(() => {
          if (!cancelled) setShow(true);
        });
      return () => {
        cancelled = true;
      };
    }

    // Signed out: this device is the only thing that can remember.
    AsyncStorage.getItem(ACCEPTED_KEY)
      .then((stored) => {
        if (!cancelled && stored !== TERMS_VERSION) setShow(true);
      })
      .catch(() => {
        if (!cancelled) setShow(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading]);

  const accept = () => {
    if (!agreed) return;

    if (isAuthenticated) {
      // ON THE PROFILE, so it follows them to every device they ever use.
      // Fire and forget: the modal closes now either way, and a failed write
      // means they are asked once more rather than silently recorded.
      void api
        .post('/api/users/me/terms', {
          version: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        })
        .catch(() => undefined);
    } else {
      void AsyncStorage.setItem(ACCEPTED_KEY, TERMS_VERSION).catch(() => undefined);
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      {/* The backdrop deliberately does nothing on press — this is a consent
          gate, and a stray tap must never carry the visitor past it. */}
      <View className="flex-1 bg-black/70 items-center justify-center px-4">
        <View className="w-full max-w-md bg-slate-900 border border-amber-500/30 rounded-2xl p-6 max-h-[90%]">
          <ScrollView showsVerticalScrollIndicator={false}>
            <View className="w-12 h-12 rounded-2xl bg-amber-500 items-center justify-center mb-4">
              <Sparkles size={24} color="#0F172A" />
            </View>

            <Text className="text-white text-2xl font-semibold">Welcome to AYE &amp; NAY</Text>
            <Text className="text-slate-400 mt-2 leading-6">
              Real laws, your voice, still in beta. Found a rough edge? The bug reporter — on
              every screen — sends it straight to the team.
            </Text>

            <Pressable
              onPress={() => setAgreed((was) => !was)}
              className="flex-row items-start mt-5"
            >
              <View
                className={
                  agreed
                    ? 'w-5 h-5 rounded border border-amber-500 bg-amber-500 items-center justify-center mt-0.5'
                    : 'w-5 h-5 rounded border border-slate-600 mt-0.5'
                }
              >
                {agreed ? <Check size={14} color="#0F172A" /> : null}
              </View>
              <Text className="text-slate-400 text-sm ml-3 flex-1 leading-5">
                I have read and agree to the{' '}
                <Text
                  className="text-amber-400 underline"
                  onPress={() => router.push('/terms')}
                >
                  Terms of Use
                </Text>{' '}
                and the{' '}
                <Text
                  className="text-amber-400 underline"
                  onPress={() => router.push('/privacy')}
                >
                  Privacy Policy
                </Text>
                , including that my information is stored in the United States.
              </Text>
            </Pressable>

            <Pressable
              onPress={accept}
              disabled={!agreed}
              className={
                agreed
                  ? 'mt-5 bg-amber-500 rounded-xl py-3 items-center'
                  : 'mt-5 bg-slate-700 rounded-xl py-3 items-center'
              }
            >
              <Text className={agreed ? 'text-slate-900 font-bold' : 'text-slate-500 font-bold'}>
                Agree &amp; continue
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
