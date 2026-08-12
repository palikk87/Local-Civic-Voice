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
 * Sign-in screen. Email or username + password, resolved by the same backend routes
 * the web app uses (POST /api/login for usernames, Better Auth for the session).
 */
export default function LoginScreen() {
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
            <Animated.View entering={FadeInUp.delay(100).springify()} className="items-center mb-10">
              <View className="w-24 h-24 rounded-full bg-amber-500/20 items-center justify-center mb-6">
                <Vote size={48} color="#F59E0B" />
              </View>
              <Text className="text-3xl font-bold text-white">Welcome Back</Text>
              <Text className="text-slate-400 mt-2 text-center">
                Sign in to make your voice heard
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              <AuthForm mode="signin" onSuccess={() => router.replace('/(tabs)')} />

              <Pressable
                onPress={() => router.push('/forgot-password')}
                className="mt-4 py-2"
              >
                <Text className="text-amber-500 text-center">Forgot your password?</Text>
              </Pressable>

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
