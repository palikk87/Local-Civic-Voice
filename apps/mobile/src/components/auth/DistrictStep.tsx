import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

import { DistrictPicker } from '@/components/civic/DistrictPicker';

/**
 * Where do you live? — asked once, at sign-up, and easy to walk past.
 * The phone twin of apps/web/src/components/auth/DistrictStep.tsx.
 *
 * WHY IT IS HERE. A district set later is a district almost nobody sets: the
 * profile editor is not somewhere people go on their first day. Asking once,
 * while somebody is already filling things in, is the difference between a map
 * with people on it and a map with nobody on it.
 *
 * WHY IT IS OPTIONAL, AND LOOKS IT. Amendment I holds that the power of the
 * vote originates in the individual. A ballot conditional on saying where you
 * live is the lock-in that Amendment forbids — so Skip is a real button with
 * the same weight as Done, and the words say plainly that the vote counts
 * either way.
 *
 * NOTHING NEW IS ASKED FOR. Same picker as the profile, same ZIP lookup, same
 * promise: the ZIP finds the district and is then discarded, and only the
 * district chosen is ever saved.
 */
export function DistrictStep({ onDone }: { onDone: () => void }) {
  return (
    <ScrollView testID="signup-district-step" keyboardShouldPersistTaps="handled">
      <View className="mb-4">
        <Text className="text-white text-xl font-bold">Where should your vote count?</Text>
        <Text className="text-slate-400 text-sm mt-1">
          Optional. Your vote counts either way — this places it in your own district, so the
          Pulse can be compared with how your representative actually voted.
        </Text>
      </View>

      <DistrictPicker />

      <View className="flex-row gap-3 mt-5">
        <TouchableOpacity
          testID="skip-district"
          onPress={onDone}
          className="flex-1 border border-slate-700 rounded-xl py-4 items-center"
        >
          <Text className="text-slate-300 font-semibold">Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="finish-signup"
          onPress={onDone}
          className="flex-1 bg-blue-600 rounded-xl py-4 items-center"
        >
          <Text className="text-white font-semibold">Done</Text>
        </TouchableOpacity>
      </View>

      <Text className="text-slate-500 text-xs mt-4">
        You can add or remove this at any time from your profile.
      </Text>
    </ScrollView>
  );
}
