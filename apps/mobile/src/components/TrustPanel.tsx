/**
 * THE TRUST SCORE, ON A SCREEN.
 *
 * Phone twin of apps/web/src/components/trust/TrustPanel.tsx.
 *
 * "Trust scores are not meant to rank anyone. They are meant to inform people
 * when delegating votes."
 *
 * SO IT ALWAYS SHOWS ITS WORKING — every part that produced the number, with
 * its own count and contribution. And A NEW ACCOUNT GETS A SENTENCE, NOT AN
 * EMPTY BAR: a bar at zero beside somebody's name reads as a verdict on them,
 * which is the one thing this must never be.
 */

import React from 'react';
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Info } from 'lucide-react-native';
import { cn } from '@/lib/cn';
import { trust as trustApi, trustBand, type TrustResult } from '@/lib/trust';

function Meter({ score }: { score: number }) {
  return (
    <View className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
      <View
        className="h-full rounded-full bg-slate-200"
        style={{ width: `${Math.max(2, score)}%` }}
      />
    </View>
  );
}

function NotEnough({
  result,
  compact,
}: {
  result: Extract<TrustResult, { enough: false }>;
  compact?: boolean;
}) {
  return (
    <Text
      testID="trust-not-enough"
      className={cn('text-slate-400', compact ? 'text-xs' : 'text-sm leading-6')}
    >
      Not enough of a record yet to say anything useful. This account is {result.accountAgeDays} day
      {result.accountAgeDays === 1 ? '' : 's'} old with {result.actions} recorded action
      {result.actions === 1 ? '' : 's'}.
      {compact ? '' : ' A score appears once there is something to describe.'}
    </Text>
  );
}

export function TrustPanel({ userId, compact = false }: { userId: string; compact?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ['trust', userId],
    queryFn: () => trustApi.of(userId),
    enabled: Boolean(userId),
  });

  if (isLoading || !data) return null;
  const result = data.trust;

  if (!result.enough) {
    if (compact) return <NotEnough result={result} compact />;
    return (
      <View testID="trust-panel" className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
        <View className="mb-1 flex-row items-center">
          <ShieldCheck size={16} color="#94A3B8" />
          <Text className="ml-2 text-sm font-semibold text-white">Trust Score</Text>
        </View>
        <NotEnough result={result} />
      </View>
    );
  }

  if (compact) {
    return (
      <View testID="trust-compact" className="mt-2">
        <View className="flex-row items-baseline justify-between">
          <Text className="text-xs text-slate-400">{trustBand(result.score)}</Text>
          <Text className="text-xs font-semibold text-white">{result.score}/100</Text>
        </View>
        <View className="mt-1">
          <Meter score={result.score} />
        </View>
      </View>
    );
  }

  return (
    <View testID="trust-panel" className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1">
          <View className="flex-row items-center">
            <ShieldCheck size={16} color="#94A3B8" />
            <Text className="ml-2 text-sm font-semibold text-white">Trust Score</Text>
          </View>
          <Text className="mt-1 text-xs text-slate-400">{trustBand(result.score)}</Text>
        </View>
        <Text className="text-2xl font-semibold text-white">{result.score}</Text>
      </View>

      <View className="mt-3">
        <Meter score={result.score} />
      </View>

      <View className="mt-4">
        {result.parts.map((part) => (
          <View key={part.id} testID="trust-part" className="mb-2 flex-row items-start">
            <Text
              className={cn(
                'w-10 text-right text-xs font-semibold',
                part.points > 0
                  ? 'text-emerald-400'
                  : part.points < 0
                    ? 'text-amber-400'
                    : 'text-slate-500'
              )}
            >
              {part.points > 0 ? `+${part.points}` : part.points}
            </Text>
            <View className="ml-3 flex-1">
              <Text className="text-xs font-medium text-white">{part.label}</Text>
              <Text className="text-xs leading-5 text-slate-400">{part.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      <View className="mt-3 flex-row items-start border-t border-slate-700/50 pt-3">
        <Info size={12} color="#64748B" />
        <Text className="ml-1.5 flex-1 text-[11px] leading-4 text-slate-500">
          This is here to help you decide whether to lend somebody your vote. It ranks nobody, it
          changes nothing about what anybody sees on this platform, and it is not a judgement of a
          person — only a description of what this account has done here.
        </Text>
      </View>
    </View>
  );
}
