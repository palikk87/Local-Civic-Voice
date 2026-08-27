import React, { useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Vote, Compass } from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { AuthForm } from '@/components/auth/AuthForm';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';

/**
 * Sign-up screen. Creates a REAL account against the same backend the web app uses
 * (Better Auth email + password, then PATCH /api/users/me for the username) — see
 * components/auth/AuthForm.tsx.
 *
 * Nobody is forced here any more: guests browse the app freely and only meet this
 * screen (or the auth sheet) when they try to participate.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useCurrentUser();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0F172A', '#1E3A5F', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={FadeInUp.delay(100).springify()} className="items-center mb-8">
              <View className="w-20 h-20 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                <Vote size={40} color="#F59E0B" />
              </View>
              <Text className="text-3xl font-bold text-white">Create Account</Text>
              <Text className="text-slate-400 mt-2 text-center">
                Join the civic community and make your voice heard
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              {/* A brand-new account lands on the one screen that asks what
                  they think before it shows them anybody. */}
              <AuthForm mode="signup" onSuccess={() => router.replace('/start')} />

              {/* Consent by action, the standard mobile pattern: creating an
                  account is agreement, and the Terms are one tap away. */}
              <Text className="text-slate-500 text-xs text-center mt-4">
                By creating an account you agree to our{' '}
                <Text
                  className="text-amber-400 underline"
                  onPress={() => router.push('/terms')}
                >
                  Terms of Use
                </Text>
                .
              </Text>

              <Pressable
                onPress={() => router.replace('/(tabs)/discover')}
                className="mt-6 flex-row items-center justify-center py-2"
              >
                <Compass size={16} color="#94A3B8" />
                <Text className="text-slate-400 ml-2">Browse without an account</Text>
              </Pressable>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
