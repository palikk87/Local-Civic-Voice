import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Vote, X } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AuthForm } from './AuthForm';
import { useAuthUI } from '@/lib/auth/use-civic-auth';

/**
 * App-wide auth sheet opened via `useAuthUI().openAuth` — the phone twin of the web
 * app's AuthDialog. Bottom sheet instead of a centred modal; same copy, same form,
 * same accounts.
 */
export function AuthSheet() {
  const { open, reason, closeAuth } = useAuthUI();
  const insets = useSafeAreaInsets();
  // Force-remount the form each time the sheet opens so it resets cleanly.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (open) setFormKey((k) => k + 1);
  }, [open]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={closeAuth}
      statusBarTranslucent
    >
      <Animated.View entering={FadeIn} className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={closeAuth} accessibilityLabel="Dismiss" />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            entering={FadeInDown.springify().damping(18)}
            className="bg-slate-900 rounded-t-3xl border-t border-slate-700 overflow-hidden"
            style={{ maxHeight: '92%' }}
          >
            <View className="items-center pt-3">
              <View className="w-10 h-1.5 rounded-full bg-slate-600" />
            </View>

            <View className="px-6 pt-5 pb-4">
              <View className="flex-row items-start justify-between">
                <View className="w-14 h-14 rounded-full bg-amber-500/15 items-center justify-center mb-4">
                  <Vote size={28} color="#F59E0B" />
                </View>
                <Pressable onPress={closeAuth} hitSlop={10} className="p-1">
                  <X size={22} color="#6E8A7C" />
                </Pressable>
              </View>
              <Text className="text-2xl font-bold text-white">Claim your voice</Text>
              <Text className="text-slate-400 mt-1">
                {reason ??
                  'Join AYE & NAY to cast simulated votes and shape the Public Pulse.'}
              </Text>
            </View>

            <ScrollView
              className="px-6"
              contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <AuthForm key={formKey} mode="signin" onSuccess={closeAuth} />
            </ScrollView>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}
