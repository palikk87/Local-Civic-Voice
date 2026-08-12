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
  Mail,
  ArrowRight,
  Lock,
  KeyRound,
  ChevronLeft,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { authClient } from '@/lib/auth/auth-client';

// Two-step password reset: email a one-time code, then set a new password.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  // Talks to Better Auth's emailOTP plugin directly. This screen previously went
  // through lib/auth-context, but that context is the Supabase-Auth path and its
  // resetPassword(email) has a different contract. The backend implements the
  // OTP reset flow (see backend/src/auth.ts, emailOTP.sendVerificationOTP), and
  // auth-client registers emailOTPClient(), so this is the path that works.

  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendCode = async () => {
    setError('');

    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) {
      setError('Please enter the email on your account');
      return;
    }

    setIsLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email: clean,
        type: 'forget-password',
      });
      if (err) {
        setError(err.message || 'Failed to send code. Please try again.');
      } else {
        setStep('reset');
      }
    } catch {
      setError('Failed to send code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setError('');

    if (!otp.trim()) {
      setError('Enter the code we emailed you');
      return;
    }
    if (password.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    setIsLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.resetPassword({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        password,
      });
      if (err) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setError(err.message || 'Invalid code. Please try again.');
        return;
      }

      // Password changed — sign straight in so the user isn't asked twice.
      const { error: signInErr } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInErr) {
        router.replace('/login');
      } else {
        router.replace('/(tabs)');
      }
    } catch {
      setError('Could not reset your password. Please try again.');
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
              <Text className="text-3xl font-bold text-white text-center">
                {step === 'email' ? 'Reset Password' : 'Check your email'}
              </Text>
              <Text className="text-slate-400 mt-2 text-center">
                {step === 'email'
                  ? "We'll email you a code to set a new password"
                  : `We sent a code to ${email.trim().toLowerCase()}`}
              </Text>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(200).springify()}>
              {step === 'email' ? (
                <View className="mb-6">
                  <Text className="text-slate-300 font-medium mb-2">Email</Text>
                  <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                    <Mail size={20} color="#64748B" />
                    <TextInput
                      className="flex-1 py-4 px-3 text-white text-base"
                      placeholder="you@example.com"
                      placeholderTextColor="#64748B"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      onSubmitEditing={handleSendCode}
                      returnKeyType="go"
                      autoFocus
                    />
                  </View>
                </View>
              ) : (
                <>
                  {/* Code */}
                  <View className="mb-4">
                    <View className="flex-row items-center mb-2">
                      <Pressable
                        onPress={() => {
                          setStep('email');
                          setOtp('');
                          setError('');
                        }}
                        className="mr-2"
                        hitSlop={8}
                      >
                        <ChevronLeft size={20} color="#64748B" />
                      </Pressable>
                      <Text className="text-slate-300 font-medium">Verification Code</Text>
                    </View>
                    <View className="flex-row items-center bg-slate-800/60 border border-slate-700 rounded-xl px-4">
                      <KeyRound size={20} color="#64748B" />
                      <TextInput
                        className="flex-1 py-4 px-3 text-white text-base tracking-widest"
                        placeholder="Enter code"
                        placeholderTextColor="#64748B"
                        value={otp}
                        onChangeText={setOtp}
                        keyboardType="number-pad"
                        autoFocus
                      />
                    </View>
                  </View>

                  {/* New password */}
                  <View className="mb-6">
                    <Text className="text-slate-300 font-medium mb-2">New Password</Text>
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
                        onSubmitEditing={handleReset}
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
                </>
              )}

              {error ? (
                <Animated.View entering={FadeInDown.springify()} className="mb-4">
                  <Text className="text-red-400 text-center">{error}</Text>
                </Animated.View>
              ) : null}

              <Pressable
                onPress={step === 'email' ? handleSendCode : handleReset}
                disabled={isLoading}
                className="bg-amber-500 rounded-xl py-4 flex-row items-center justify-center mb-6"
                style={{ opacity: isLoading ? 0.7 : 1 }}
              >
                {isLoading ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <>
                    <Text className="text-slate-900 font-bold text-lg mr-2">
                      {step === 'email' ? 'Send Code' : 'Save New Password'}
                    </Text>
                    <ArrowRight size={20} color="#0F172A" />
                  </>
                )}
              </Pressable>

              <View className="flex-row justify-center">
                <Text className="text-slate-400">Remembered it? </Text>
                <Pressable onPress={() => router.replace('/login')}>
                  <Text className="text-amber-500 font-semibold">Sign In</Text>
                </Pressable>
              </View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
