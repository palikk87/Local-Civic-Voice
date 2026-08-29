import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { Flag } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { safetyApi, type ReportReason } from '@/lib/api/safety';

/**
 * Reporting somebody, with a reason and in their own words.
 *
 * WHAT THIS REPLACES. A button that fired instantly with `reason: 'other'` and
 * no description, then said "a moderator will look at this". Six reasons and
 * two thousand characters of detail have been in the API since it was written;
 * nothing ever sent either, so every report arrived saying "other" about
 * nothing in particular and whoever read it had no idea what they were being
 * asked to look at.
 *
 * Web twin: apps/web/src/components/safety/ReportDialog.tsx. Same six reasons,
 * same rule that "something else" requires the box, same words afterwards.
 */

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'harassment', label: 'Harassment', hint: 'Targeting or following somebody around' },
  { value: 'hate', label: 'Hate', hint: 'Attacks on people for who they are' },
  { value: 'violence', label: 'Violence or threats', hint: 'Threatening or encouraging harm' },
  {
    value: 'misinformation',
    label: 'Misrepresenting a law',
    hint: 'Saying a law does something it does not',
  },
  { value: 'spam', label: 'Spam', hint: 'Repetitive, automated or commercial' },
  { value: 'other', label: 'Something else', hint: 'Tell us below' },
];

export interface ReportTarget {
  postId?: string;
  commentId?: string;
  userId?: string;
  /** What the reader is looking at, for the heading. */
  what: string;
}

export function ReportSheet({
  target,
  onClose,
  onFiled,
}: {
  target: ReportTarget | null;
  onClose: () => void;
  /** Told the report landed, so the screen can say so in its own words. */
  onFiled: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  function close() {
    onClose();
    // Cleared on the way out, so a reopened sheet is never pre-filled with the
    // last thing somebody typed about somebody else.
    setReason(null);
    setDetail('');
    setFailed(false);
  }

  async function send() {
    if (!target || !reason) return;
    setSending(true);
    setFailed(false);
    try {
      await safetyApi.report({
        ...(target.postId ? { postId: target.postId } : {}),
        ...(target.commentId ? { commentId: target.commentId } : {}),
        ...(target.userId ? { userId: target.userId } : {}),
        reason,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onFiled();
      close();
    } catch {
      // Said on the sheet rather than in an Alert behind it, so what they wrote
      // is still on screen and one tap from being sent again.
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  const canSend = !sending && !!reason && !(reason === 'other' && !detail.trim());

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      <View className="flex-1 justify-end bg-black/70">
        <View
          testID="report-sheet"
          className="max-h-[85%] rounded-t-3xl border-t border-slate-700 bg-slate-900 p-5"
        >
          <View className="flex-row items-center mb-2">
            <Flag size={18} color="#F5F0E6" />
            <Text className="text-white text-lg font-bold ml-2">
              Report {target?.what ?? 'this'}
            </Text>
          </View>
          <Text className="text-slate-400 text-sm leading-5 mb-4">
            Reports are read by a jury of randomly drawn citizens. Nothing is hidden or removed
            because somebody complained — they decide, and they have to give reasons.
          </Text>

          <ScrollView className="mb-3" keyboardShouldPersistTaps="handled">
            <Text className="text-slate-300 text-sm font-semibold mb-2">What is wrong?</Text>
            {REASONS.map((entry) => (
              <Pressable
                key={entry.value}
                testID={`reason-${entry.value}`}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setReason(entry.value);
                }}
                className={
                  reason === entry.value
                    ? 'mb-2 rounded-xl border border-amber-500 bg-amber-500/10 p-3'
                    : 'mb-2 rounded-xl border border-slate-700 bg-slate-800/50 p-3'
                }
              >
                <Text className="text-white font-medium">{entry.label}</Text>
                <Text className="text-slate-400 text-xs mt-0.5">{entry.hint}</Text>
              </Pressable>
            ))}

            <Text className="text-slate-300 text-sm font-semibold mt-2 mb-1">
              What happened?{' '}
              <Text className="text-slate-500 font-normal">
                {reason === 'other' ? 'Required' : 'Optional, and it helps'}
              </Text>
            </Text>
            <TextInput
              testID="report-detail"
              value={detail}
              onChangeText={(next) => setDetail(next.slice(0, 2000))}
              placeholder="Where it happened, and what you saw. The jury reads this."
              placeholderTextColor="#6E8A7C"
              multiline
              numberOfLines={4}
              className="rounded-xl border border-slate-700 bg-slate-800/50 p-3 text-white"
              style={{ minHeight: 96, textAlignVertical: 'top' }}
            />
            <Text className="text-slate-500 text-xs text-right mt-1">{detail.length} / 2000</Text>

            {failed ? (
              <Text className="text-red-400 text-sm mt-2">
                Nothing was sent. Try again in a moment.
              </Text>
            ) : null}
          </ScrollView>

          <View className="flex-row">
            <Pressable
              onPress={close}
              disabled={sending}
              className="flex-1 items-center rounded-xl border border-slate-700 py-3 mr-2"
            >
              <Text className="text-slate-300 font-semibold">Cancel</Text>
            </Pressable>
            <Pressable
              testID="report-send"
              onPress={send}
              disabled={!canSend}
              className={
                canSend
                  ? 'flex-1 flex-row items-center justify-center rounded-xl bg-amber-500 py-3'
                  : 'flex-1 flex-row items-center justify-center rounded-xl bg-slate-700 py-3'
              }
            >
              {sending ? <ActivityIndicator size="small" color="#0C1D18" /> : null}
              <Text
                className={canSend ? 'text-slate-900 font-semibold ml-1.5' : 'text-slate-500 font-semibold ml-1.5'}
              >
                File report
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
