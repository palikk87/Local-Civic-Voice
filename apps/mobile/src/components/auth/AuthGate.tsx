import React, { useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Lock, Compass } from 'lucide-react-native';

import { useAuthUI, usePermissions } from '@/lib/auth/use-civic-auth';
import type { Capability } from '@/lib/permissions';

interface AuthGateProps {
  /** What this screen is for — decides the tier needed. */
  capability: Capability;
  /** Shown in the auth sheet and on the blocked screen. */
  reason: string;
  children: React.ReactNode;
}

/**
 * Wraps a member-only screen. Phone twin of webapp/src/components/auth/RouteGuard.tsx.
 *
 * Guests get a sign-in wall (with the sheet opened for them) rather than being thrown
 * out of the app, so the screen they came for is still there once they're signed in.
 * Admin and B2B consoles keep their own separate logins and don't use this.
 */
export function AuthGate({ capability, reason, children }: AuthGateProps) {
  const { can, isLoading, isAuthenticated } = usePermissions();
  const { openAuth } = useAuthUI();

  const allowed = can(capability);
  const needsSignIn = !isLoading && !isAuthenticated;

  useEffect(() => {
    if (needsSignIn) openAuth(reason);
  }, [needsSignIn, openAuth, reason]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <ActivityIndicator color="#F59E0B" />
      </View>
    );
  }

  if (allowed) return <>{children}</>;

  return <SignInWall reason={reason} onSignIn={() => openAuth(reason)} />;
}

function SignInWall({ reason, onSignIn }: { reason: string; onSignIn: () => void }) {
  const router = useRouter();

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0F172A', '#1E3A5F', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SafeAreaView className="flex-1">
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-full bg-amber-500/15 items-center justify-center">
            <Lock size={28} color="#F59E0B" />
          </View>
          <Text className="mt-6 text-2xl font-bold text-white text-center">
            Sign in to continue
          </Text>
          <Text className="mt-2 text-slate-400 text-center">{reason}</Text>
          <Text className="mt-4 text-sm text-slate-500 text-center">
            You can keep browsing bills, executive orders, and Supreme Court cases without
            an account.
          </Text>

          <Pressable
            onPress={onSignIn}
            className="mt-8 w-full bg-amber-500 rounded-xl py-4 items-center"
          >
            <Text className="text-slate-900 font-bold text-base">
              Sign in or create account
            </Text>
          </Pressable>

          <Pressable
            onPress={() => router.replace('/(tabs)/discover')}
            className="mt-3 w-full border border-slate-700 rounded-xl py-4 flex-row items-center justify-center"
          >
            <Compass size={18} color="#94A3B8" />
            <Text className="text-slate-300 font-semibold text-base ml-2">
              Browse public records
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
