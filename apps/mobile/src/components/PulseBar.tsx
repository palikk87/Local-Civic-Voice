// The split between Aye and Nay, drawn so both sides are visible.
// Web twin: apps/web/src/components/civic/PulseBar.tsx
//
// WHAT THIS REPLACES. Every copy of this bar drew one green fill sized to the
// Aye share over a plain grey track. The grey was a background, not the Nay
// share — nothing ever drew Nay at all. A record with two votes, both against,
// printed "100% Nay" beside a bar that was entirely empty. The bar had no way
// to express opposition, which on a platform about whether people are for or
// against something is the wrong half to leave out.
//
// NO VOTES IS ITS OWN STATE. With nothing cast, an empty track is honest and a
// half-and-half split is not — a 50/50 bar over zero votes invents a tie nobody
// voted for.
import React from 'react';
import { View } from 'react-native';

export function PulseBar({
  yea,
  nay,
  height = 12,
  className = '',
}: {
  yea: number;
  nay: number;
  height?: number;
  className?: string;
}) {
  const total = Math.max(0, yea) + Math.max(0, nay);
  const yeaPct = total > 0 ? (Math.max(0, yea) / total) * 100 : 0;
  const nayPct = total > 0 ? 100 - yeaPct : 0;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={
        total > 0
          ? `${Math.round(yeaPct)} percent Aye, ${Math.round(nayPct)} percent Nay, ${total} votes`
          : 'No votes yet'
      }
      style={{ height, borderRadius: height / 2 }}
      className={`flex-row overflow-hidden bg-slate-700 ${className}`}
    >
      {total > 0 ? (
        <>
          <View className="h-full bg-emerald-500" style={{ width: `${yeaPct}%` }} />
          <View className="h-full bg-red-500" style={{ width: `${nayPct}%` }} />
        </>
      ) : null}
    </View>
  );
}
