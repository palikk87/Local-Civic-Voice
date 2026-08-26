/**
 * The Citizen's Brief card.
 *
 * Three parts, always in this order and always with these headings, because
 * the headings are the product:
 *
 *   the brief        one neutral paragraph — what this law does
 *   THE CASE FOR     two to three sentences
 *   THE CASE AGAINST two to three sentences
 *
 * Both sides are shown together and given equal weight. A reader who only sees
 * the summary learns what the law says; a reader who sees both arguments can
 * decide what they think about it, which is the point.
 *
 * Four states, and every one of them is somewhere a reader can stand: the offer
 * (a button), the wait, the brief, and an honest "no text to read from". There
 * is deliberately no fifth state where something is happening the reader cannot
 * see the end of.
 *
 * This only DISPLAYS. The brief is written on the server from the document's
 * entire official text, so nothing here can produce one from a title.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Sparkles, RefreshCw, ExternalLink, ThumbsUp, ThumbsDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import type { CitizenBriefSections } from '@/lib/api/references';

export interface CitizensBriefCardProps {
  state: 'idle' | 'working' | 'ready' | 'unavailable';
  brief: CitizenBriefSections | null;
  /** The server's words for why there is no brief. */
  reason?: string | null;
  isRequesting?: boolean;
  onRequest: () => void;
  onRewrite?: () => void;
  /** What the brief would summarize, for the empty state's one-liner. */
  emptyDescription?: string;
  /** Link to the official document — the source everything here came from. */
  sourceUrl?: string | null;
  sourceLabel?: string;
  /** The stored brief describes an earlier text of this law. */
  isStale?: boolean;
}

/**
 * The wait, told as what is actually happening.
 *
 * Writing a brief takes thirty to forty-five seconds, because the whole law is
 * read before a word is written. That is a long time to look at a spinner, and
 * a spinner says only "something is happening, possibly forever" — so people
 * leave, and the work they paid for finishes for nobody.
 *
 * These are the real stages, in the real order the pipeline runs them: fetch
 * the official text, read it, write from what was read, then check every claim
 * back against the source. Nothing is invented to fill the time. If a stage
 * runs long the message stays put, which is honest — it IS still doing that.
 *
 * Word-for-word the same as the web card. A reader who uses both should not be
 * told two different stories about the same wait.
 */
const STAGES: Array<{ after: number; text: string }> = [
  { after: 0, text: 'Fetching the official text…' },
  { after: 6, text: 'Reading the law in full…' },
  { after: 18, text: 'Writing the brief…' },
  { after: 32, text: 'Checking every claim against the text…' },
];

function BriefInProgress() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const stage = [...STAGES].reverse().find((s) => seconds >= s.after) ?? STAGES[0]!;
  const reached = STAGES.filter((s) => seconds >= s.after).length;

  return (
    <Animated.View
      entering={FadeIn}
      className="rounded-[20px] p-8 bg-amber-500/10 border border-amber-500/20"
    >
      <View className="items-center">
        <ActivityIndicator size="large" color="#F59E0B" />

        <Text className="text-white text-base font-semibold mt-4 text-center">{stage.text}</Text>

        {/* Which of the four steps this is. Each fills when that step really
            starts, so the movement is something a reader can trust. */}
        <View className="flex-row items-center mt-4">
          {STAGES.map((s, index) => (
            <View
              key={s.after}
              className={`h-1.5 rounded-full mx-0.5 ${
                index < reached ? 'w-6 bg-amber-500' : 'w-1.5 bg-amber-500/25'
              }`}
            />
          ))}
        </View>

        <Text className="text-slate-400 text-sm mt-4 text-center">
          The whole document is read before a word is written, and the brief is saved for
          everyone — so this happens once, not once per reader.
        </Text>
      </View>
    </Animated.View>
  );
}

export function CitizensBriefCard({
  state,
  brief,
  reason,
  isRequesting = false,
  onRequest,
  onRewrite,
  emptyDescription = 'A plain-English summary of this law, written only from its full official text — plus the case for it and the case against it',
  sourceUrl,
  sourceLabel = 'Read the full official text',
  isStale = false,
}: CitizensBriefCardProps) {
  const sourceLink =
    sourceUrl && sourceLabel ? (
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          Linking.openURL(sourceUrl);
        }}
        className="flex-row items-center justify-center gap-2 mt-4 py-3 px-4 rounded-xl bg-white/5 w-full"
      >
        <ExternalLink size={16} color="#94A3B8" />
        <Text className="text-slate-400 text-sm ml-2">{sourceLabel}</Text>
      </Pressable>
    ) : null;

  if (state === 'working') {
    return <BriefInProgress />;
  }

  if (state === 'idle' || !brief) {
    const unavailable = state === 'unavailable';
    return (
      <Animated.View entering={FadeIn} className="rounded-[20px] p-5 bg-amber-500/10 border border-amber-500/20">
        <View className="items-center">
          <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
            <Sparkles size={32} color="#F59E0B" />
          </View>
          <Text className="text-white text-lg font-bold text-center mb-2">Citizen's Brief</Text>
          <Text className="text-slate-400 text-sm text-center mb-4 px-2">{emptyDescription}</Text>

          {unavailable && reason ? (
            <Text className="text-slate-400 text-sm text-center mb-6 px-2">{reason}</Text>
          ) : null}

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onRequest();
            }}
            disabled={isRequesting}
            className={`w-full rounded-xl py-3.5 px-6 flex-row items-center justify-center ${
              isRequesting ? 'bg-amber-500/50' : 'bg-amber-500'
            }`}
          >
            {isRequesting ? (
              <ActivityIndicator size="small" color="#0F172A" />
            ) : unavailable ? (
              <RefreshCw size={20} color="#0F172A" />
            ) : (
              <Sparkles size={20} color="#0F172A" />
            )}
            <Text className="text-slate-900 font-bold text-base ml-2">
              {unavailable ? 'Check the source again' : 'Get the Citizen\'s Brief'}
            </Text>
          </Pressable>

          {sourceLink}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={FadeIn} className="rounded-3xl overflow-hidden">
      <View className="p-5 bg-slate-900/95 rounded-3xl border border-slate-700/40">
        <View className="flex-row items-center justify-between mb-5">
          <View className="flex-row items-center">
            <View className="w-10 h-10 rounded-xl items-center justify-center bg-amber-500/20">
              <Sparkles size={20} color="#F59E0B" />
            </View>
            <View className="ml-3">
              <Text className="text-white font-bold text-lg">Citizen's Brief</Text>
              <Text className="text-slate-400 text-xs">
                Written only from the full official text
              </Text>
            </View>
          </View>
          {onRewrite ? (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onRewrite();
              }}
              disabled={isRequesting}
              className="p-2 rounded-lg bg-white/10"
            >
              <RefreshCw size={18} color="#9CA3AF" />
            </Pressable>
          ) : null}
        </View>

        {isStale ? (
          <View className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <Text className="text-amber-300 text-sm">
              This law has changed since this brief was written. It describes the earlier text.
            </Text>
          </View>
        ) : null}

        {/* The neutral paragraph. No icon, no colour, no framing — it is the
            plain account of the law, and dressing it up would editorialize it. */}
        <Text className="text-white text-base leading-relaxed">{brief.summary}</Text>

        {/* Both sides, identically weighted. Different colours so they are
            distinguishable at a glance; the same size and the same treatment
            otherwise, so neither reads as the answer. */}
        <View className="mt-5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <View className="flex-row items-center mb-2">
            <ThumbsUp size={16} color="#34D399" />
            <Text className="text-emerald-400 font-bold text-xs uppercase tracking-wider ml-2">
              The Case For
            </Text>
          </View>
          <Text className="text-slate-200 text-sm leading-6">{brief.argumentFor}</Text>
        </View>

        <View className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/10 p-4">
          <View className="flex-row items-center mb-2">
            <ThumbsDown size={16} color="#FB7185" />
            <Text className="text-rose-400 font-bold text-xs uppercase tracking-wider ml-2">
              The Case Against
            </Text>
          </View>
          <Text className="text-slate-200 text-sm leading-6">
            {brief.argumentAgainst}
          </Text>
        </View>

        {sourceLink}

        <Text className="text-slate-500 text-xs text-center mt-4">
          Written from the complete official text of this law and nothing else. Read the text
          itself for the full detail.
        </Text>
      </View>
    </Animated.View>
  );
}
