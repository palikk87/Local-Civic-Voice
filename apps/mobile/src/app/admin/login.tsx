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
} from 'react-native';
import { useRouter } from 'expo-router';
import { Shield, Eye, EyeOff, ArrowLeft, Lock } from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

export default function AdminLoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const isLoading = useAdminStore((s) => s.isLoading);
  const adminLogin = useAdminStore((s) => s.adminLogin);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setError('');
    const result = await adminLogin(username.trim(), password);

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/admin/dashboard');
    } else {
      setError(result.error || 'Login failed');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2 -ml-2"
          >
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <Text className="text-white text-lg font-semibold ml-2">Admin Login</Text>
        </View>

        <View className="flex-1 justify-center px-6">
          {/* Logo Section */}
          <View className="items-center mb-10">
            <View className="w-20 h-20 bg-amber-500/20 rounded-full items-center justify-center mb-4">
              <Shield size={40} color="#F59E0B" />
            </View>
            <Text className="text-white text-2xl font-bold">Admin Console</Text>
            <Text className="text-slate-400 text-center mt-2">
              Enter your admin credentials to access the management dashboard
            </Text>
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
            <View className="bg-slate-800 border border-slate-700 rounded-xl flex-row items-center px-4">
              <Shield size={20} color="#64748B" />
              <TextInput
                className="flex-1 text-white py-4 px-3 text-base"
                placeholder="Enter admin username"
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
            <View className="bg-slate-800 border border-slate-700 rounded-xl flex-row items-center px-4">
              <Lock size={20} color="#64748B" />
              <TextInput
                className="flex-1 text-white py-4 px-3 text-base"
                placeholder="Enter password"
                placeholderTextColor="#64748B"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
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
            className={`py-4 rounded-xl items-center justify-center flex-row ${
              isLoading ? 'bg-amber-500/50' : 'bg-amber-500'
            }`}
          >
            {isLoading ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <Shield size={20} color="#0F172A" />
                <Text className="text-slate-900 font-bold text-base ml-2">
                  Sign In to Admin
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Security Notice */}
          <View className="mt-8 items-center">
            <Text className="text-slate-500 text-xs text-center">
              This is a secure admin area. All actions are logged.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
