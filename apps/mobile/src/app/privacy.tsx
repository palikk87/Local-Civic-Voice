import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { PRIVACY_EFFECTIVE_DATE, PRIVACY_SECTIONS } from '@/lib/privacy';

/**
 * The Privacy Policy. Content parity with apps/web/src/pages/Privacy.tsx, and
 * with apps/mobile/src/lib/privacy.ts enforced by terms-parity-check.
 *
 * The phone had a Terms screen and no Privacy screen at all, while the consent
 * gate on the web asks a person to agree to both. Agreeing to a document you
 * cannot open is not consent.
 */
export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </Pressable>
        <Text className="text-white text-lg font-semibold ml-2">Privacy Policy</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <Text className="text-slate-500 text-xs mb-4">
          Effective {PRIVACY_EFFECTIVE_DATE}
        </Text>
        {PRIVACY_SECTIONS.map((section) => (
          <View key={section.heading} className="mb-6">
            <Text className="text-white font-semibold text-base">{section.heading}</Text>
            {section.paragraphs.map((paragraph, index) => (
              <Text key={index} className="text-slate-400 text-sm leading-6 mt-2">
                {paragraph}
              </Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
