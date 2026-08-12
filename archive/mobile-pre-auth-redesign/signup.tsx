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
import {
  Vote,
  User,
  AtSign,
  Mail,
  ArrowRight,
  Scroll,
  BookOpen,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth-context';

const USERNAME_PATTERN = /^[a-zA-Z0-9._]{3,30}$/;

export default function SignUpScreen() {
  const router = useRouter();

  // Same shared-backend flow as the web app: username + email + password.
  const { signUp } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async () => {
    setError('');

    if (!displayName.trim()) {
      setError('Please enter your name');
      return;
    }
    if (!USERNAME_PATTERN.test(username.trim())) {
      setError('Username must be 3–30 characters: letters, numbers, dots or underscores');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    try {
      const { error: err } = await signUp({
        name: displayName,
        username,
        email,
        password,
      });
      if (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(err.message);
      }
      // On success the session updates and the root layout redirects into the app.
    } catch {
      setError('Could not create your account. Please try again.');
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
            {/* Logo & Header */}
            <Animated.View entering={FadeInUp.delay(100).springify()} className="items-center mb-8">
              <View className="w-20 h-20 rounded-full bg-amber-500/20 items-center justify-center mb-4">
                <Vote size={40} color="#F59E0B" />
              </View>
              <Text className="text-3xl font-bold text-white">Create Account</Text>
              <Text className="text-slate-400 mt-2 text-center">
                Join the civic community and make your voice heard
              </Text>
            </Animated.View>

            {/* Form */}
            <Animated.View entering={FadeInDown.delay(200).springify()}>
              {/* Display Name */}
              <View className="mb-4">
                <Text className="text-slate-300 font-medium mb-2">Full Name</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <User size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="John Doe"
                    placeholderTextColor="#64748B"
                    value={displayName}
                    onChangeText={setDisplayName}
                    autoCapitalize="words"
                  />
                </View>
              </View>

              {/* Username */}
              <View className="mb-4">
                <Text className="text-slate-300 font-medium mb-2">Username</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <AtSign size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="johndoe"
                    placeholderTextColor="#64748B"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                  />
                </View>
                <Text className="text-slate-500 text-xs mt-2">
                  Letters, numbers, dots and underscores. Not case-sensitive at sign-in.
                </Text>
              </View>

              {/* Email */}
              <View className="mb-4">
                <Text className="text-slate-300 font-medium mb-2">Email</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <Mail size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="john@example.com"
                    placeholderTextColor="#64748B"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                  />
                </View>
              </View>

              {/* Password */}
              <View className="mb-6">
                <Text className="text-slate-300 font-medium mb-2">Password</Text>
                <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                  <Lock size={20} color="#64748B" />
                  <TextInput
                    className="flex-1 py-4 px-3 text-white text-base"
                    placeholder="At least 8 characters"
                    placeholderTextColor="#64748B"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                    onSubmitEditing={handleSignUp}
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

              {/* Error */}
              {error ? (
                <Animated.View entering={FadeInDown.springify()} className="mb-4">
                  <Text className="text-red-400 text-center">{error}</Text>
                </Animated.View>
              ) : null}

              {/* Submit */}
              <Pressable
                onPress={handleSignUp}
                disabled={isLoading}
                className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center mb-6"
                style={{ opacity: isLoading ? 0.7 : 1 }}
              >
                {isLoading ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <>
                    <Text className="text-slate-900 font-bold text-lg mr-2">Create Account</Text>
                    <ArrowRight size={20} color="#0F172A" />
                  </>
                )}
              </Pressable>

              {/* Sign In Link */}
              <View className="flex-row justify-center mb-6">
                <Text className="text-slate-400">Already have an account? </Text>
                <Pressable onPress={() => router.push('/login')}>
                  <Text className="text-amber-500 font-semibold">Sign In</Text>
                </Pressable>
              </View>

              {/* Founding Documents */}
              <Animated.View entering={FadeInDown.delay(300).springify()}>
                <View className="border-t border-slate-700/50 pt-4">
                  <Text className="text-slate-500 text-xs text-center mb-3">
                    By joining, you agree to operate under our
                  </Text>
                  <View className="flex-row">
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push('/constitution');
                      }}
                      className="flex-1 flex-row items-center justify-center bg-slate-800/60 rounded-l-lg py-2.5 px-3 border-r border-slate-700"
                    >
                      <BookOpen size={14} color="#94A3B8" />
                      <Text className="text-slate-300 text-xs font-medium ml-1.5">Constitution</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        router.push('/bill-of-rights');
                      }}
                      className="flex-1 flex-row items-center justify-center bg-amber-900/30 rounded-r-lg py-2.5 px-3"
                    >
                      <Scroll size={14} color="#FCD34D" />
                      <Text className="text-amber-300 text-xs font-medium ml-1.5">Bill of Rights</Text>
                    </Pressable>
                  </View>
                </View>
              </Animated.View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
