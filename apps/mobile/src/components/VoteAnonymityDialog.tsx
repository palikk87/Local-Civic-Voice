import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { listenForTheQuestion } from '@/lib/vote-anonymity';

/**
 * The question, asked once, the first time somebody votes.
 *
 * Mounted once at the root, because the thing that raises it is the vote
 * pipeline rather than any particular screen — see lib/vote-anonymity.ts.
 *
 * TWO ANSWERS, NO DEFAULT. Neither is styled as the obvious one, because this
 * is not a decision the platform gets to lean on.
 *
 * Dismissing it cancels the vote. That sounds unhelpful until you consider the
 * alternative: publishing somebody's name against a position on immigration or
 * abortion because they tapped outside the sheet.
 *
 * Web twin: apps/web/src/components/civic/VoteAnonymityDialog.tsx.
 */
export function VoteAnonymityDialog() {
  const [pending, setPending] = useState<{
    resolve: (named: boolean) => void;
    dismiss: () => void;
  } | null>(null);

  useEffect(
    () =>
      listenForTheQuestion((resolve, dismiss) => {
        setPending({ resolve, dismiss });
      }),
    []
  );

  function answer(named: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    pending?.resolve(named);
    setPending(null);
  }

  function dismiss() {
    pending?.dismiss();
    setPending(null);
  }

  return (
    <Modal
      visible={pending !== null}
      transparent
      animationType="fade"
      onRequestClose={dismiss}
    >
      <Pressable
        onPress={dismiss}
        className="flex-1 items-center justify-center bg-black/70 px-6"
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          testID="vote-anonymity-dialog"
          className="w-full rounded-2xl border border-slate-700 bg-slate-900 p-5"
        >
          <Text className="text-white text-lg font-bold mb-3">
            Does your name go on this?
          </Text>
          <Text className="text-slate-300 text-sm leading-5 mb-2">
            Positions on this platform are public by default. Anyone can see how you voted
            on a law, on your profile, forever.
          </Text>
          <Text className="text-slate-300 text-sm leading-5 mb-2">
            Your vote counts exactly the same either way — including through anyone who has
            lent you their voice. What changes is whether your name is on it.
          </Text>
          <Text className="text-slate-500 text-xs mb-4">
            Asked once. You can change it any time in Settings.
          </Text>

          <Pressable
            testID="vote-publicly"
            onPress={() => answer(true)}
            className="mb-2 rounded-xl border border-slate-600 bg-slate-800/60 p-3"
          >
            <View className="flex-row items-center">
              <Eye size={16} color="#F8FAFC" />
              <Text className="text-white font-semibold ml-2">Put my name on it</Text>
            </View>
            <Text className="text-slate-400 text-xs mt-0.5">
              Your positions are public
            </Text>
          </Pressable>

          <Pressable
            testID="vote-anonymously"
            onPress={() => answer(false)}
            className="rounded-xl border border-slate-600 bg-slate-800/60 p-3"
          >
            <View className="flex-row items-center">
              <EyeOff size={16} color="#F8FAFC" />
              <Text className="text-white font-semibold ml-2">Keep my name off it</Text>
            </View>
            <Text className="text-slate-400 text-xs mt-0.5">
              Only you can see them
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
