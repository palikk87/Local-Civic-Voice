/**
 * The three panels that only this platform can draw, on mobile.
 *
 * Each of them is readable because a position here is attached to a government
 * record rather than inferred from behaviour: who crossed sides and why, what
 * the people who landed on the other side actually wrote, and when opinion
 * moved relative to the text moving.
 *
 * Every one of them returns null on an unexpected shape. These sit inside the
 * bill screen, and a panel that throws takes the screen with it — checking one
 * field and then reading another is how the equivalent web page white-screened.
 */
import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ArrowLeftRight, FileDiff, Scale, TrendingUp } from 'lucide-react-native';

import { api } from '@/lib/api/api';

interface TurningPoint {
  id: string;
  user: { id: string; displayName: string; username: string; avatar: string };
  from: string;
  to: string;
  reason: string | null;
  lawVersion: number;
  afterTextChanged: boolean;
  createdAt: string;
}

interface TurningPointsResponse {
  results: TurningPoint[];
  toSupport: number;
  toOppose: number;
  total: number;
  people: number;
  afterTextChanged: number;
}

const CARD = 'bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-4';
const HEADING = 'text-white font-semibold text-base ml-2';

/**
 * Who changed their mind on this law, which way, and what they said about it.
 *
 * Nowhere else can show this, and most places make it dangerous to have done:
 * the old post stays up, screenshot-ready, so the safe move is never to move.
 * Here the record knows when its own text changed, which turns a crossing from
 * a gotcha into evidence.
 */
export function TurningPointsPanel({ referenceId }: { referenceId?: string | null }) {
  const { data } = useQuery({
    queryKey: ['turning-points', referenceId],
    queryFn: () =>
      api.get<TurningPointsResponse>(`/api/government-references/${referenceId}/turning-points`),
    enabled: Boolean(referenceId),
  });

  if (!Array.isArray(data?.results) || data.results.length === 0) return null;

  const direction =
    data.toSupport > 0 && data.toOppose > 0
      ? ` — ${data.toSupport} toward backing it, ${data.toOppose} toward opposing it`
      : data.toSupport > 0
        ? ', every one of them toward backing it'
        : ', every one of them toward opposing it';

  return (
    <View className={CARD}>
      <View className="flex-row items-center mb-2">
        <ArrowLeftRight size={18} color="#F59E0B" />
        <Text className={HEADING}>Who changed their mind</Text>
      </View>

      <Text className="text-slate-400 text-sm mb-3">
        {data.people} {data.people === 1 ? 'person has' : 'people have'} crossed sides on this
        {direction}.
        {data.afterTextChanged > 0
          ? ` ${data.afterTextChanged} moved after the text was amended.`
          : ''}
      </Text>

      {data.results.map((move) => (
        <View key={move.id} className="flex-row mb-3">
          <Image
            source={{ uri: move.user.avatar }}
            className="w-8 h-8 rounded-full bg-slate-700 mr-3"
          />
          <View className="flex-1">
            <Text className="text-slate-300 text-sm">
              <Text
                className="text-white font-medium"
                onPress={() => router.push(`/user/${move.user.id}`)}
              >
                {move.user.displayName}
              </Text>
              {' went from '}
              <Text className={move.from === 'support' ? 'text-emerald-400' : 'text-rose-400'}>
                {move.from === 'support' ? 'backing it' : 'opposing it'}
              </Text>
              {' to '}
              <Text className={move.to === 'support' ? 'text-emerald-400' : 'text-rose-400'}>
                {move.to === 'support' ? 'backing it' : 'opposing it'}
              </Text>
            </Text>

            {/* Their words, never summarised. A stated reason for moving is the
                most valuable thing on this screen and paraphrasing it would
                make it the platform's sentence rather than theirs. */}
            {move.reason ? (
              <Text className="text-slate-400 text-sm italic mt-1 pl-3 border-l-2 border-slate-700">
                {move.reason}
              </Text>
            ) : null}

            {move.afterTextChanged ? (
              <View className="flex-row items-center mt-1">
                <FileDiff size={12} color="#F59E0B" />
                <Text className="text-amber-500 text-xs ml-1">
                  After reading version {move.lawVersion}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}

      <Text className="text-slate-500 text-xs border-t border-slate-700/40 pt-3">
        Changing your mind is recorded here, not held against you. The text of a law moves and so
        should a position on it.
      </Text>
    </View>
  );
}

interface OtherSidePost {
  id: string;
  content: string;
  author: { id: string; displayName: string; username: string; avatar: string };
  commentsCount: number;
  likesCount: number;
}

interface OtherSideResponse {
  yourPosition: string | null;
  otherPosition: string | null;
  results: OtherSidePost[];
  reason: string | null;
}

/**
 * What the people who voted the opposite way on this exact record wrote.
 *
 * Not an algorithm and not a curated panel. Every other platform's "other
 * side" is inferred from clicks or chosen by somebody, and both select for the
 * version of the argument that is easiest to dislike. This is the set of
 * people who took the opposite position on this bill — no model, no guess.
 */
export function OtherSidePanel({ referenceId }: { referenceId?: string | null }) {
  const { data } = useQuery({
    queryKey: ['other-side', referenceId],
    queryFn: () =>
      api.get<OtherSideResponse>(`/api/government-references/${referenceId}/other-side`),
    enabled: Boolean(referenceId),
  });

  if (!Array.isArray(data?.results) || data.results.length === 0) return null;

  return (
    <View className={CARD}>
      <View className="flex-row items-center mb-2">
        <Scale size={18} color="#F59E0B" />
        <Text className={HEADING}>The other side</Text>
      </View>

      <Text className="text-slate-400 text-sm mb-3">
        You {data.yourPosition === 'support' ? 'backed' : 'opposed'} this. These are people who
        {data.otherPosition === 'support' ? ' backed it' : ' opposed it'} and said why.
      </Text>

      {data.results.map((post) => (
        <Pressable
          key={post.id}
          onPress={() => router.push(`/user/${post.author.id}`)}
          className="mb-3"
        >
          <View className="flex-row items-center mb-1">
            <Image
              source={{ uri: post.author.avatar }}
              className="w-6 h-6 rounded-full bg-slate-700 mr-2"
            />
            <Text className="text-white text-sm font-medium">{post.author.displayName}</Text>
          </View>
          <Text className="text-slate-300 text-sm">{post.content}</Text>
        </Pressable>
      ))}
    </View>
  );
}

interface PulsePoint {
  date: string;
  support: number;
  oppose: number;
  lawChanged: boolean;
}

/**
 * When opinion moved, and whether the text moved with it.
 *
 * Bars, not a line: a line implies a continuous measurement between two points
 * and this is a count of discrete days on which somebody did something.
 * Nothing is interpolated.
 */
export function PulseHistoryPanel({ referenceId }: { referenceId?: string | null }) {
  const { data } = useQuery({
    queryKey: ['pulse-history', referenceId],
    queryFn: () =>
      api.get<{ points: PulsePoint[]; count: number }>(
        `/api/government-references/${referenceId}/pulse-history`,
      ),
    enabled: Boolean(referenceId),
  });

  const points = Array.isArray(data?.points) ? data.points : [];
  // One day of data is a number, not a history.
  if (points.length < 2) return null;
  if (points.some((p) => typeof p?.support !== 'number' || typeof p?.oppose !== 'number')) {
    return null;
  }

  const peak = Math.max(...points.map((p) => p.support + p.oppose), 1);

  return (
    <View className={CARD}>
      <View className="flex-row items-center mb-3">
        <TrendingUp size={18} color="#F59E0B" />
        <Text className={HEADING}>How opinion moved</Text>
      </View>

      <View className="flex-row items-end h-24 gap-0.5">
        {points.map((point) => {
          const total = point.support + point.oppose;
          const height = Math.max((total / peak) * 100, 4);
          const supportShare = total > 0 ? (point.support / total) * 100 : 0;

          return (
            <View key={point.date} className="flex-1 justify-end">
              {point.lawChanged ? (
                <Text className="text-amber-500 text-[10px] text-center">✳</Text>
              ) : null}
              <View
                className="w-full rounded-sm overflow-hidden bg-rose-500"
                style={{ height: `${height}%` }}
              >
                <View className="w-full bg-emerald-500" style={{ height: `${supportShare}%` }} />
              </View>
            </View>
          );
        })}
      </View>

      <Text className="text-slate-500 text-xs mt-3">
        {points.some((p) => p.lawChanged)
          ? '✳ marks the day the text changed.'
          : 'The text has not changed since the first position was taken.'}
      </Text>
    </View>
  );
}
