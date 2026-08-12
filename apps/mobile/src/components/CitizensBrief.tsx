/**
 * CitizensBrief Component
 *
 * Displays the AI-generated "Citizen's Brief" - a simplified,
 * non-partisan summary of a government action in three sections:
 * - The Goal: What it does
 * - The Wallet: Fiscal impact
 * - The Debate: Arguments for and against
 *
 * `CitizensBriefCard` is the shared presentation used by legislation, Supreme
 * Court cases and executive orders. It only DISPLAYS the brief the server wrote
 * from the document's entire official text — there is no on-device writer, so a
 * brief can never be produced from a title and a blurb.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { Target, Wallet, Scale, Sparkles, RefreshCw, ExternalLink } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import type { Bill, CitizensBrief as CitizensBriefType } from '@/lib/types';

interface SectionConfig {
  label: string;
  Icon: typeof Target;
  color: string;
  iconBg: string;
  textColor: string;
}

interface CitizensBriefCardProps {
  /** Brief the server already has stored on the master reference, when there is one. */
  initialBrief?: CitizensBriefType | null;
  /** Server is pulling text / writing the brief right now — show the waiting state. */
  serverPending?: boolean;
  /** Ask the server to re-pull the source and rewrite the stored brief. */
  onRefresh?: () => void | Promise<void>;
  /** Overrides for the three section headings. */
  labels?: { goal?: string; wallet?: string; debate?: string };
  /** Copy shown on the empty state. */
  emptyDescription?: string;
  /** Copy shown while the server is preparing the brief. */
  loadingLabel?: string;
  /** Optional "view the official text" link at the bottom of the brief. */
  sourceLabel?: string;
  onOpenSource?: () => void;
}

interface CitizensBriefProps {
  bill: Bill;
  /**
   * Brief stored on the master reference (from useReferenceBriefProps). Absent only
   * for documents with no reference row — those show the unavailable state rather
   * than a locally invented summary.
   */
  server?: {
    initialBrief: CitizensBriefType | null;
    labels?: { goal?: string; wallet?: string; debate?: string };
    serverPending: boolean;
    onRefresh?: () => Promise<void>;
  };
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function CitizensBriefCard({
  initialBrief = null,
  serverPending = false,
  onRefresh,
  labels,
  emptyDescription = 'A plain-English summary, written from the complete official text',
  loadingLabel = 'Reading the official text...',
  sourceLabel,
  onOpenSource,
}: CitizensBriefCardProps) {
  const [brief, setBrief] = useState<CitizensBriefType | null>(initialBrief);
  const [error, setError] = useState<string | null>(null);

  // The stored brief usually arrives a moment after mount (the detail query is
  // still in flight, or the server is still writing it), so adopt it when it lands.
  useEffect(() => {
    if (initialBrief) setBrief(initialBrief);
  }, [initialBrief]);

  const buttonScale = useSharedValue(1);

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const sections: SectionConfig[] = [
    {
      label: labels?.goal ?? 'The Goal',
      Icon: Target,
      color: '#10B981',
      iconBg: 'bg-emerald-500/20',
      textColor: 'text-emerald-400',
    },
    {
      label: labels?.wallet ?? 'The Wallet',
      Icon: Wallet,
      color: '#F59E0B',
      iconBg: 'bg-amber-500/20',
      textColor: 'text-amber-400',
    },
    {
      label: labels?.debate ?? 'The Debate',
      Icon: Scale,
      color: '#A78BFA',
      iconBg: 'bg-purple-500/20',
      textColor: 'text-purple-400',
    },
  ];

  // The brief lives on the master reference, so "refresh" means asking the server
  // to re-pull the official text and rewrite it. The screen polls for the result.
  const handleRefresh = async () => {
    if (!onRefresh) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setError(null);
    await onRefresh();
  };

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.95, { damping: 15 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15 });
  };

  if (!brief && serverPending) {
    return (
      <Animated.View entering={FadeIn.duration(300)}>
        <LinearGradient
          colors={['rgba(59, 130, 246, 0.1)', 'rgba(139, 92, 246, 0.1)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 32 }}
        >
          <View className="items-center">
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text className="text-white text-base font-semibold mt-4">{loadingLabel}</Text>
            <Text className="text-gray-400 text-sm mt-2 text-center">
              Pulling the complete official text and writing the brief. This is saved for everyone.
            </Text>
          </View>
        </LinearGradient>
      </Animated.View>
    );
  }

  if (!brief) {
    return (
      <Animated.View entering={FadeIn.duration(300)}>
        <LinearGradient
          colors={['rgba(59, 130, 246, 0.1)', 'rgba(139, 92, 246, 0.1)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 20, padding: 20 }}
        >
          <View className="items-center">
            <View className="w-16 h-16 rounded-full bg-blue-500/20 items-center justify-center mb-4">
              <Sparkles size={32} color="#3B82F6" />
            </View>
            <Text className="text-white text-lg font-bold text-center mb-2">
              Citizen's Brief
            </Text>
            <Text className="text-gray-400 text-sm text-center mb-4 px-4">
              {emptyDescription}
            </Text>

            {/* No official text means no brief. We say so instead of guessing. */}
            <Text className="text-gray-400 text-sm text-center mb-6 px-4">
              The official text for this document isn't published anywhere we can read yet, so
              there's no brief to show. Rather than guess at what it says, we're not showing one.
            </Text>

            {error && (
              <Text className="text-red-400 text-sm text-center mb-4">
                {error}
              </Text>
            )}

            {onRefresh && (
              <AnimatedPressable
                onPress={handleRefresh}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                style={buttonAnimatedStyle}
                className="w-full"
              >
                <LinearGradient
                  colors={['#3B82F6', '#8B5CF6']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    borderRadius: 12,
                    paddingVertical: 14,
                    paddingHorizontal: 24,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <RefreshCw size={20} color="#FFFFFF" />
                  <Text className="text-white font-bold text-base">Check the source again</Text>
                </LinearGradient>
              </AnimatedPressable>
            )}

            {sourceLabel && (
              <Pressable
                onPress={onOpenSource}
                className="flex-row items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-white/5 w-full"
              >
                <ExternalLink size={16} color="#6B7280" />
                <Text className="text-gray-400 text-sm">{sourceLabel}</Text>
              </Pressable>
            )}
          </View>
        </LinearGradient>
      </Animated.View>
    );
  }

  const bodies = [brief?.theGoal, brief?.theWallet, brief?.theDebate];

  return (
    <Animated.View entering={FadeIn.duration(400)}>
      <View className="rounded-3xl overflow-hidden">
        <LinearGradient
          colors={['rgba(24, 24, 27, 0.95)', 'rgba(39, 39, 42, 0.9)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 20 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between mb-6">
            <View className="flex-row items-center gap-3">
              <View className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 items-center justify-center">
                <Sparkles size={20} color="#FFFFFF" />
              </View>
              <View>
                <Text className="text-white font-bold text-lg">Citizen's Brief</Text>
                <Text className="text-gray-400 text-xs">AI-Generated Summary</Text>
              </View>
            </View>
            {onRefresh && (
              <Pressable onPress={handleRefresh} className="p-2 rounded-lg bg-white/10">
                <RefreshCw size={18} color="#9CA3AF" />
              </Pressable>
            )}
          </View>

          {sections.map((section, index) => (
            <Animated.View
              key={section.label}
              entering={FadeInDown.delay(100 * (index + 1)).springify()}
              className={index === sections.length - 1 ? 'mb-4' : 'mb-5'}
            >
              <View className="flex-row items-center gap-2 mb-3">
                <View className={`w-8 h-8 rounded-lg ${section.iconBg} items-center justify-center`}>
                  <section.Icon size={18} color={section.color} />
                </View>
                <Text className={`${section.textColor} font-bold text-sm uppercase tracking-wider`}>
                  {section.label}
                </Text>
              </View>
              <Text className="text-white text-base leading-relaxed pl-10">
                {bodies[index]}
              </Text>
            </Animated.View>
          ))}

          {/* Official source link */}
          {sourceLabel && (
            <Pressable
              onPress={onOpenSource}
              className="flex-row items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-white/5"
            >
              <ExternalLink size={16} color="#6B7280" />
              <Text className="text-gray-400 text-sm">
                {sourceLabel}
              </Text>
            </Pressable>
          )}

          {/* Disclaimer */}
          <Text className="text-gray-500 text-xs text-center mt-4">
            AI summary of the complete official text. Review the official text for full details.
          </Text>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

export function CitizensBrief({ bill, server }: CitizensBriefProps) {
  return (
    <CitizensBriefCard
      initialBrief={server?.initialBrief ?? bill.citizensBrief ?? null}
      serverPending={server?.serverPending ?? false}
      onRefresh={server?.onRefresh}
      labels={server?.labels}
      emptyDescription="A plain-English summary of this bill, written from its complete official text"
      loadingLabel="Reading the full bill text..."
      sourceLabel={bill.congressUrl ? 'View full text on Congress.gov' : undefined}
      onOpenSource={bill.congressUrl ? () => Linking.openURL(bill.congressUrl!) : undefined}
    />
  );
}
