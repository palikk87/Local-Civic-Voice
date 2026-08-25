/**
 * PulseGap Component
 *
 * Visualizes the "Representation Gap" - the discrepancy between
 * public sentiment (AYE & NAY votes) and official Congressional votes.
 *
 * Design: Editorial/Data journalism aesthetic with bold typography
 * and dramatic visual hierarchy. Red alert state for significant gaps.
 */

import React, { useEffect } from 'react';
import { View, Text, Pressable, Share, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  interpolate,
  Easing,
  FadeIn,
  SlideInRight,
} from 'react-native-reanimated';
import { AlertTriangle, Users, Building2, Share2, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import type { RepresentationGap } from '@/lib/types';
import {
  getGapSeverity,
  getGapColor,
  getGapDescription,
  generateShareText,
} from '@/lib/representation-gap';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';

interface PulseGapProps {
  gap: RepresentationGap;
  onPress?: () => void;
  compact?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PulseGap({ gap, onPress, compact = false }: PulseGapProps) {
  const requireAuth = useRequireAuth();
  const severity = getGapSeverity(gap);
  const severityColor = getGapColor(severity);

  // Animation values
  const publicBarWidth = useSharedValue(0);
  const officialBarWidth = useSharedValue(0);
  const alertPulse = useSharedValue(0);
  const cardScale = useSharedValue(1);

  useEffect(() => {
    // Animate bars on mount
    publicBarWidth.value = withDelay(200, withSpring(gap.publicApprovalPct, { damping: 15 }));
    officialBarWidth.value = withDelay(400, withSpring(gap.officialApprovalPct, { damping: 15 }));

    // Pulse animation for significant gaps
    if (gap.hasSignificantGap) {
      alertPulse.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    }
  }, [gap, publicBarWidth, officialBarWidth, alertPulse]);

  const publicBarStyle = useAnimatedStyle(() => ({
    width: `${publicBarWidth.value}%`,
  }));

  const officialBarStyle = useAnimatedStyle(() => ({
    width: `${officialBarWidth.value}%`,
  }));

  const alertGlowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(alertPulse.value, [0, 1], [0.3, 0.8]),
    transform: [{ scale: interpolate(alertPulse.value, [0, 1], [1, 1.02]) }],
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }],
  }));

  const handlePressIn = () => {
    cardScale.value = withSpring(0.98, { damping: 15 });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = () => {
    cardScale.value = withSpring(1, { damping: 15 });
  };

  const handleShare = async () => {
    if (!requireAuth('Sign in to share this representation gap.')) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const shareText = generateShareText(gap);
    try {
      await Share.share({
        message: shareText,
        title: 'Representation Gap Detected',
      });
    } catch {
      // Share cancelled or failed
    }
  };

  if (compact) {
    return (
      <Animated.View entering={FadeIn.duration(300)}>
        <AnimatedPressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={cardAnimatedStyle}
          className="overflow-hidden rounded-2xl"
        >
          {gap.hasSignificantGap && (
            <Animated.View
              style={[
                alertGlowStyle,
                {
                  position: 'absolute',
                  top: -2,
                  left: -2,
                  right: -2,
                  bottom: -2,
                  borderRadius: 18,
                  borderWidth: 2,
                  borderColor: severityColor,
                },
              ]}
            />
          )}
          <View
            className="p-4"
            style={{
              backgroundColor: gap.hasSignificantGap ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255, 255, 255, 0.05)',
            }}
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                {gap.hasSignificantGap && (
                  <AlertTriangle size={16} color={severityColor} />
                )}
                <Text
                  className="text-xs font-bold tracking-widest uppercase"
                  style={{ color: gap.hasSignificantGap ? severityColor : '#9CA3AF' }}
                >
                  {gap.hasSignificantGap ? 'GAP DETECTED' : 'ALIGNED'}
                </Text>
              </View>
              <Text className="text-2xl font-black text-white">
                {Math.round(gap.gapPercentage)}%
              </Text>
            </View>

            {/* Compact bars */}
            <View className="gap-2">
              <View className="flex-row items-center gap-2">
                <Users size={12} color="#60A5FA" />
                <View className="flex-1 h-2 rounded-full bg-white/10">
                  <Animated.View
                    className="h-full rounded-full"
                    style={[publicBarStyle, { backgroundColor: '#3B82F6' }]}
                  />
                </View>
                <Text className="text-xs font-semibold text-blue-400 w-10 text-right">
                  {Math.round(gap.publicApprovalPct)}%
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Building2 size={12} color="#A78BFA" />
                <View className="flex-1 h-2 rounded-full bg-white/10">
                  <Animated.View
                    className="h-full rounded-full"
                    style={[officialBarStyle, { backgroundColor: '#8B5CF6' }]}
                  />
                </View>
                <Text className="text-xs font-semibold text-purple-400 w-10 text-right">
                  {Math.round(gap.officialApprovalPct)}%
                </Text>
              </View>
            </View>
          </View>
        </AnimatedPressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View entering={SlideInRight.duration(400).springify()}>
      <AnimatedPressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={cardAnimatedStyle}
        className="overflow-hidden rounded-3xl"
      >
        {/* Alert glow border for significant gaps */}
        {gap.hasSignificantGap && (
          <Animated.View
            style={[
              alertGlowStyle,
              {
                position: 'absolute',
                top: -3,
                left: -3,
                right: -3,
                bottom: -3,
                borderRadius: 27,
                borderWidth: 3,
                borderColor: severityColor,
              },
            ]}
          />
        )}

        <LinearGradient
          colors={
            gap.hasSignificantGap
              ? ['rgba(127, 29, 29, 0.9)', 'rgba(55, 48, 48, 0.95)']
              : ['rgba(39, 39, 42, 0.9)', 'rgba(24, 24, 27, 0.95)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 20, borderRadius: 24 }}
        >
          {/* Header */}
          <View className="flex-row items-start justify-between mb-5">
            <View className="flex-1 mr-4">
              {gap.hasSignificantGap && (
                <Animated.View
                  entering={FadeIn.delay(200)}
                  className="flex-row items-center gap-2 mb-2"
                >
                  <AlertTriangle size={18} color={severityColor} />
                  <Text
                    className="text-xs font-black tracking-[0.2em] uppercase"
                    style={{ color: severityColor }}
                  >
                    REPRESENTATION GAP
                  </Text>
                </Animated.View>
              )}
              <Text
                className="text-lg font-bold text-white leading-tight"
                numberOfLines={2}
              >
                {gap.billTitle}
              </Text>
            </View>

            {/* Gap percentage badge */}
            <View
              className="items-center justify-center rounded-2xl px-4 py-2"
              style={{
                backgroundColor: gap.hasSignificantGap
                  ? `${severityColor}30`
                  : 'rgba(255, 255, 255, 0.1)',
              }}
            >
              <Text
                className="text-3xl font-black"
                style={{ color: gap.hasSignificantGap ? severityColor : '#FFFFFF' }}
              >
                {Math.round(gap.gapPercentage)}
              </Text>
              <Text
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: gap.hasSignificantGap ? severityColor : '#9CA3AF' }}
              >
                % Gap
              </Text>
            </View>
          </View>

          {/* Vote comparison bars */}
          <View className="mb-5">
            {/* Public Vote Bar */}
            <View className="mb-4">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-blue-500/20 items-center justify-center">
                    <Users size={16} color="#3B82F6" />
                  </View>
                  <View>
                    <Text className="text-white font-semibold text-sm">Public Voice</Text>
                    <Text className="text-gray-400 text-xs">AYE & NAY Users</Text>
                  </View>
                </View>
                <Text className="text-2xl font-black text-blue-400">
                  {Math.round(gap.publicApprovalPct)}%
                </Text>
              </View>
              <View className="h-4 rounded-full bg-white/10 overflow-hidden">
                <Animated.View
                  className="h-full rounded-full"
                  style={[publicBarStyle]}
                >
                  <LinearGradient
                    colors={['#3B82F6', '#60A5FA']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderRadius: 8 }}
                  />
                </Animated.View>
              </View>
            </View>

            {/* Official Vote Bar */}
            <View>
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 rounded-full bg-purple-500/20 items-center justify-center">
                    <Building2 size={16} color="#8B5CF6" />
                  </View>
                  <View>
                    <Text className="text-white font-semibold text-sm">Congress Vote</Text>
                    <Text className="text-gray-400 text-xs">Official Record</Text>
                  </View>
                </View>
                <Text className="text-2xl font-black text-purple-400">
                  {Math.round(gap.officialApprovalPct)}%
                </Text>
              </View>
              <View className="h-4 rounded-full bg-white/10 overflow-hidden">
                <Animated.View
                  className="h-full rounded-full"
                  style={[officialBarStyle]}
                >
                  <LinearGradient
                    colors={['#8B5CF6', '#A78BFA']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ flex: 1, borderRadius: 8 }}
                  />
                </Animated.View>
              </View>
            </View>
          </View>

          {/* Description */}
          <Text className="text-gray-300 text-sm leading-relaxed mb-5">
            {getGapDescription(gap)}
          </Text>

          {/* Actions */}
          <View className="flex-row gap-3">
            {gap.hasSignificantGap && (
              <Pressable
                onPress={handleShare}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 px-4 rounded-xl"
                style={{ backgroundColor: `${severityColor}30` }}
              >
                <Share2 size={18} color={severityColor} />
                <Text
                  className="font-bold text-sm"
                  style={{ color: severityColor }}
                >
                  Share the Gap
                </Text>
              </Pressable>
            )}
            {onPress && (
              <Pressable
                onPress={onPress}
                className="flex-1 flex-row items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/10"
              >
                <Text className="text-white font-bold text-sm">View Bill</Text>
                <ChevronRight size={18} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </LinearGradient>
      </AnimatedPressable>
    </Animated.View>
  );
}

/**
 * Mini badge version for bill cards
 */
export function PulseGapBadge({ gap }: { gap: RepresentationGap }) {
  const severity = getGapSeverity(gap);
  const severityColor = getGapColor(severity);

  if (!gap.hasSignificantGap) {
    return (
      <View className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-green-500/20">
        <View className="w-1.5 h-1.5 rounded-full bg-green-500" />
        <Text className="text-xs font-semibold text-green-400">Aligned</Text>
      </View>
    );
  }

  return (
    <View
      className="flex-row items-center gap-1 px-2 py-1 rounded-full"
      style={{ backgroundColor: `${severityColor}20` }}
    >
      <AlertTriangle size={12} color={severityColor} />
      <Text className="text-xs font-bold" style={{ color: severityColor }}>
        {Math.round(gap.gapPercentage)}% Gap
      </Text>
    </View>
  );
}
