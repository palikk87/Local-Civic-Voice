import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Vote, AtSign, ArrowRight, Lock, Eye, EyeOff } from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth-context';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async () => {
    setError('');

    if (!identifier.trim()) {
      setError('Enter your username or email');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }

    setIsLoading(true);
    try {
      // Username/email is case-insensitive; the password is not.
      const { error: err } = await signIn(identifier, password);
      if (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(err.message);
      }
      // On success the session updates and the root layout redirects into the app.
    } catch {
      setError('Could not sign in. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

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
                Sign in with your username or email
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              {/* Username or email */}
              <View className="mb-4">
                <Text className="text-slate-300 font-medium mb-2">Username or Email</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <AtSign size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="yourname or you@example.com"
                    placeholderTextColor="#64748B"
                    value={identifier}
                    onChangeText={setIdentifier}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    autoFocus
                  />
                </View>
              </View>

              {/* Password */}
              <View className="mb-2">
                <Text className="text-slate-300 font-medium mb-2">Password</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <Lock size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="Your password"
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    onSubmitEditing={handleSignIn}
                    returnKeyType="go"
                  />
                  <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10}>
                    {showPassword ? (
                      <EyeOff size={20} color="#64748B" />
                    ) : (
                      <Eye size={20} color="#64748B" />
                    )}
                  </Pressable>
                </View>
                <Text className="text-slate-500 text-xs mt-2">
                  Passwords are case-sensitive.
                </Text>
              </View>

              <Pressable
                onPress={() => router.push('/forgot-password')}
                className="self-end mb-5"
                hitSlop={8}
              >
                <Text className="text-amber-500 text-sm font-medium">Forgot password?</Text>
              </Pressable>

              {error ? (
                <Animated.View entering={FadeInDown.springify()} className="mb-4">
                  <Text className="text-red-400 text-center">{error}</Text>
                </Animated.View>
              ) : null}

              <Pressable
                onPress={handleSignIn}
                disabled={isLoading}
                className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center mb-6"
                style={{ opacity: isLoading ? 0.7 : 1 }}
              >
                {isLoading ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <>
                    <Text className="text-slate-900 font-bold text-lg mr-2">Sign In</Text>
                    <ArrowRight size={20} color="#0F172A" />
                  </>
                )}
              </Pressable>

              <View className="flex-row justify-center">
                <Text className="text-slate-400">Don&apos;t have an account? </Text>
                <Pressable onPress={() => router.push('/signup')}>
                  <Text className="text-amber-500 font-semibold">Sign Up</Text>
                </Pressable>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
