/**
 * "This person has been impeached." On their profile, permanently.
 *
 * Phone twin of apps/web/src/components/profile/ImpeachmentRecord.tsx.
 *
 * WHY IT IS PERMANENT. A successful impeachment is not a punishment the
 * platform handed down — it is a finding two thirds of somebody's own
 * delegators made about how they used borrowed power. Anybody deciding whether
 * to lend them a vote is entitled to know it happened, and a record that
 * expires is one a person can simply wait out.
 *
 * WHY ONLY SUCCESSFUL ONES. If a failed accusation stayed on a profile, the
 * right to bring a charge would double as a way to mark somebody, which is the
 * opposite of what Article V is for. The server never sends those.
 */

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Gavel } from 'lucide-react-native';
import { cn } from '@/lib/cn';
import { articleV, personLabel, type ImpeachmentRecordEntry } from '@/lib/article-v';

function on(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'an unrecorded date';
}

function Entry({ entry }: { entry: ImpeachmentRecordEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <View
      className={cn(
        'mb-2 rounded-xl border p-3',
        entry.inForce
          ? 'border-red-500/40 bg-red-500/10'
          : 'border-slate-700/50 bg-slate-800/40'
      )}
    >
      <Pressable
        testID="impeachment-record-entry"
        onPress={() => setOpen((was) => !was)}
        className="flex-row items-start"
      >
        {open ? (
          <ChevronDown size={16} color="#94A3B8" />
        ) : (
          <ChevronRight size={16} color="#94A3B8" />
        )}
        <View className="ml-2 flex-1">
          <Text className="text-sm font-medium text-white">
            Impeached on {on(entry.decidedAt)}
          </Text>
          <Text className="mt-0.5 text-xs leading-5 text-slate-400">
            {entry.votes} of {entry.electorCount} of their delegators voted to impeach.
            {entry.inForce
              ? ` Suspended from receiving delegations until ${on(entry.suspendedUntil)}.`
              : entry.suspendedUntil
                ? ` The suspension ran until ${on(entry.suspendedUntil)} and has ended.`
                : ''}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            {open ? 'Hide' : 'Read'} the Articles of Impeachment
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View className="mt-3 rounded-lg border border-slate-700/50 bg-slate-900/60 p-3">
          <Text className="text-xs text-slate-400">
            Filed by {personLabel(entry.filedBy)} on {on(entry.openedAt)}
          </Text>
          <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Grounds
          </Text>
          <Text className="mt-1 text-sm leading-6 text-slate-100">{entry.grounds}</Text>
          <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Evidence
          </Text>
          <Text className="mt-1 text-sm leading-6 text-slate-100">{entry.evidence}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function ImpeachmentRecord({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['article-v', 'leader', userId],
    queryFn: () => articleV.forLeader(userId),
    enabled: !!userId,
  });

  // Nothing to say is said by saying nothing. Almost every profile has an
  // empty record, and a heading reading "no impeachments" on all of them would
  // make the platform look like a place where this is expected.
  // GUARD THE CONTAINER, DEREFERENCE THE FIELD. `!data` was checked and then
  // `data.record.length` was read — so any answer without a `record` key threw
  // during render and took the whole screen down with it.
  const record = data?.record ?? [];
  if (record.length === 0) return null;

  const inForce = record.some((entry) => entry.inForce);

  return (
    <View className="px-4 pt-6" testID="impeachment-record">
      <View className="mb-2 flex-row items-center">
        <Gavel size={16} color="#EF4444" />
        <Text className="ml-2 text-sm font-semibold text-white">Article V record</Text>
      </View>

      <Text className="mb-3 text-xs leading-5 text-slate-400">
        {inForce
          ? 'This person is currently suspended from receiving delegated votes. Everything ' +
            'else about their account is unaffected — they can post, comment, share, and ' +
            'cast their own vote.'
          : 'This person has been impeached by their own delegators. The suspension has ' +
            'ended and they can receive delegations again; the record stays.'}
      </Text>

      {record.map((entry) => (
        <Entry key={entry.id} entry={entry} />
      ))}
    </View>
  );
}
