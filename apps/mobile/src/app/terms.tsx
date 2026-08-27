import React from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from '@/lib/terms';

/** The Terms of Use. Content parity with apps/web/src/pages/Terms.tsx. */
export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#94A3B8" />
        </Pressable>
        <Text className="text-white text-lg font-semibold ml-2">Terms of Use</Text>
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingVertical: 16 }}>
        <Text className="text-slate-500 text-xs mb-4">Effective {TERMS_EFFECTIVE_DATE}</Text>
        {TERMS_SECTIONS.map((section) => (
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
