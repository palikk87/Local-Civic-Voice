import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BarChart3, Eye, EyeOff, ArrowLeft, User, Lock, Building2, TrendingUp } from 'lucide-react-native';
import { useB2BStore } from '@/lib/b2b-store';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';

export default function B2BLoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const isLoading = useB2BStore((s) => s.isLoading);
  const login = useB2BStore((s) => s.login);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError('');
    const result = await login(username.trim(), password);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/b2b/dashboard');
    } else {
      setError(result.error || 'Authentication failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          {/* Header */}
          <View className="flex-row items-center px-4 py-3">
            <TouchableOpacity
              onPress={() => router.back()}
              className="p-2 -ml-2"
            >
              <ArrowLeft size={24} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <ScrollView
            className="flex-1 px-6"
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Logo Section */}
            <View className="items-center mb-10">
              <View className="w-24 h-24 bg-indigo-500/20 rounded-3xl items-center justify-center mb-4 border border-indigo-500/30">
                <BarChart3 size={48} color="#818CF8" />
              </View>
              <Text className="text-white text-3xl font-bold">Civic Intelligence</Text>
              <Text className="text-indigo-300 text-lg mt-1">B2B Analytics Platform</Text>
              <Text className="text-slate-400 text-center mt-4 px-4">
                Real-time public sentiment analytics for informed decision making
              </Text>
            </View>

            {/* Features */}
            <View className="flex-row justify-center gap-4 mb-8">
              <View className="items-center">
                <View className="w-12 h-12 bg-emerald-500/20 rounded-xl items-center justify-center mb-2">
                  <TrendingUp size={24} color="#34D399" />
                </View>
                <Text className="text-slate-400 text-xs">Sentiment</Text>
              </View>
              <View className="items-center">
                <View className="w-12 h-12 bg-amber-500/20 rounded-xl items-center justify-center mb-2">
                  <Building2 size={24} color="#FBBF24" />
                </View>
                <Text className="text-slate-400 text-xs">Districts</Text>
              </View>
              <View className="items-center">
                <View className="w-12 h-12 bg-purple-500/20 rounded-xl items-center justify-center mb-2">
                  <BarChart3 size={24} color="#A78BFA" />
                </View>
                <Text className="text-slate-400 text-xs">Analytics</Text>
              </View>
            </View>

            {/* Error Message */}
            {error ? (
              <View className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-4">
                <Text className="text-red-400 text-center">{error}</Text>
              </View>
            ) : null}

            {/* Username Input */}
            <View className="mb-4">
              <Text className="text-slate-400 text-sm mb-2 font-medium">Username</Text>
              <View className="bg-slate-800/50 border border-slate-700 rounded-xl flex-row items-center px-4">
                <User size={20} color="#64748B" />
                <TextInput
                  className="flex-1 text-white py-4 px-3 text-base"
                  placeholder="Enter your username"
                  placeholderTextColor="#64748B"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* Password Input */}
            <View className="mb-6">
              <Text className="text-slate-400 text-sm mb-2 font-medium">Password</Text>
              <View className="bg-slate-800/50 border border-slate-700 rounded-xl flex-row items-center px-4">
                <Lock size={20} color="#64748B" />
                <TextInput
                  className="flex-1 text-white py-4 px-3 text-base"
                  placeholder="Enter your password"
                  placeholderTextColor="#64748B"
                  value={password}
                  onChangeText={setPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  className="p-2"
                >
                  {showPassword ? (
                    <EyeOff size={20} color="#64748B" />
                  ) : (
                    <Eye size={20} color="#64748B" />
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={isLoading}
              className="overflow-hidden rounded-xl"
            >
              <LinearGradient
                colors={isLoading ? ['#4338CA50', '#6366F150'] : ['#4338CA', '#6366F1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' }}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <BarChart3 size={20} color="white" />
                    <Text className="text-white font-bold text-base ml-2">
                      Access Analytics
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Info */}
            <View className="mt-8 items-center">
              <Text className="text-slate-500 text-xs text-center">
                This platform provides aggregated, anonymous public sentiment data.
              </Text>
              <Text className="text-slate-600 text-xs text-center mt-1">
                No individual user data is shared or exposed.
              </Text>
            </View>

            {/* Contact */}
            <View className="mt-6 mb-8 items-center">
              <Text className="text-slate-500 text-sm">
                Need access?{' '}
                <Text className="text-indigo-400">Contact sales</Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
