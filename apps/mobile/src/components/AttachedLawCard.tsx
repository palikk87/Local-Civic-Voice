/**
 * THE LAW YOU ARE ABOUT TO POST ABOUT, SHOWN AS A LAW.
 *
 * Web twin: apps/web/src/components/feed/AttachedLawCard.tsx
 *
 * Sharing from the Library dropped a single truncated line into the composer —
 * an icon, a badge and as much of the title as fitted. Reported as: "I don't
 * like the dead nature of a post shared from the library… it feels so bland."
 *
 * It is also the moment a person most needs to see what they have got. They
 * arrived from a search result, and the thing they are about to put their name
 * to is a law they have read one line of.
 *
 * So this shows the record: which branch it came from, its number, what we hold
 * on it, its whole title, who is behind it and their face, and when it
 * happened. The same facts the law's own card carries, at the size of a
 * paragraph.
 *
 * IT ASKS FOR NOTHING THAT COSTS MONEY. The record is read; no brief is
 * commissioned from a composer. What is already written is not shown here
 * either — the point is to identify the law, not to publish somebody else's
 * summary into a box the reader is writing their own words in.
 */
import { useState } from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { FileText, Landmark, Scale, X } from 'lucide-react-native';

import { RecordBadge } from '@/components/civic/RecordBadge';
import { useGovernmentReference } from '@/lib/api/references';

function on(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function AttachedLawCard({
  referenceId,
  fallbackTitle,
  fallbackIdentifier,
  onRemove,
  onPress,
}: {
  referenceId: string;
  fallbackTitle: string;
  fallbackIdentifier?: string | null;
  /** Absent when the law is fixed — sharing from the Library cannot swap it. */
  onRemove?: () => void;
  onPress?: () => void;
}) {
  const { data } = useGovernmentReference(referenceId);
  const reference = data?.reference;
  const [faceFailed, setFaceFailed] = useState(false);

  const type = reference?.referenceType;
  const Icon = type === 'scotus_case' ? Scale : type === 'bill' ? Landmark : FileText;
  const typeLabel =
    type === 'executive_order'
      ? 'Executive order'
      : type === 'scotus_case'
        ? 'Supreme Court'
        : type === 'bill'
          ? 'Bill'
          : 'Record';

  // Whatever the record actually has a date for. A bill is introduced, an order
  // is signed, a ruling is decided — no row is invented to fill the shape.
  const dates = [
    ['Introduced', on(reference?.introducedDate)],
    ['Signed', on(reference?.signedDate)],
    ['Decided', on(reference?.decidedDate)],
  ].filter((row): row is [string, string] => typeof row[1] === 'string');

  const identifier = reference?.displayId ?? fallbackIdentifier;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className="mx-4 mt-4 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5"
    >
      <View className="flex-row items-start">
        <Icon size={15} color="#F59E0B" style={{ marginTop: 2 }} />

        <View className="flex-1 ml-2">
          <View className="flex-row flex-wrap items-center">
            <View className="px-1.5 py-0.5 rounded bg-slate-700 mr-2 mb-1">
              <Text className="text-slate-200 text-[11px] font-medium uppercase">
                {typeLabel}
              </Text>
            </View>
            {identifier ? (
              <Text className="text-slate-400 text-xs mr-2 mb-1">{identifier}</Text>
            ) : null}
            {reference?.completeness ? (
              <View className="mb-1">
                <RecordBadge completeness={reference.completeness} />
              </View>
            ) : null}
          </View>

          {/* Not truncated. The title is the thing being shared. */}
          <Text className="text-white text-sm font-medium mt-1">
            {reference?.title ?? fallbackTitle}
          </Text>

          {reference?.attribution ? (
            <View className="flex-row items-center mt-2">
              {reference.attribution.photoUrl && !faceFailed ? (
                <Image
                  source={{ uri: reference.attribution.photoUrl }}
                  onError={() => setFaceFailed(true)}
                  className="w-6 h-6 rounded-full mr-2"
                  resizeMode="cover"
                />
              ) : null}
              <Text className="text-slate-400 text-xs flex-1">
                {reference.attribution.role} {reference.attribution.name}
              </Text>
            </View>
          ) : null}

          {dates.length > 0 ? (
            <Text className="text-slate-400 text-xs mt-1">
              {dates.map(([label, value]) => `${label} ${value}`).join(' · ')}
            </Text>
          ) : null}

          {onPress ? (
            <Text className="text-slate-500 text-xs mt-2">Tap to change</Text>
          ) : null}
        </View>

        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8} className="ml-2 p-1">
            <X size={14} color="#94A3B8" />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}
