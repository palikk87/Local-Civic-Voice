/**
 * "A jury found that this person misrepresented a law." On their profile.
 *
 * Phone twin of apps/web/src/components/profile/FindingsRecord.tsx.
 *
 * Bill of Rights Article V: "The community retains the right to Impeach or
 * demote any leader who violates the platform's integrity or SPREADS VERIFIABLE
 * FALSEHOODS, as determined by the collective will of their followers."
 *
 * Only upheld findings, kept permanently, with the jurors' reasons in full and
 * unattributed. NOTHING WAS TAKEN AWAY BY THIS, and the panel says so — a
 * reader who assumes the platform has already punished somebody will not use
 * the remedy that is actually theirs.
 */

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react-native';
import { juries, type LeaderFinding } from '@/lib/juries';

function on(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : 'an unrecorded date';
}

function Entry({ finding }: { finding: LeaderFinding }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <View className="mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
      <Pressable
        testID="finding-entry"
        onPress={() => setOpen((was) => !was)}
        className="flex-row items-start"
      >
        {open ? (
          <ChevronDown size={16} color="#8FA79A" />
        ) : (
          <ChevronRight size={16} color="#8FA79A" />
        )}
        <View className="ml-2 flex-1">
          <Text className="text-sm font-medium text-white">
            A jury found this account misrepresented a law on {on(finding.decidedAt)}
          </Text>
          <Text className="mt-0.5 text-xs leading-5 text-slate-400">
            {finding.uphold} of {finding.uphold + finding.dismiss} jurors agreed.
            {finding.delegationsAtTheTime > 0
              ? ` ${finding.delegationsAtTheTime} people were lending them a vote at the time, and every one of them was told.`
              : ''}
          </Text>
          <Text className="mt-1 text-xs text-slate-500">
            {open ? 'Hide' : 'Read'} what was reported and what the jury said
          </Text>
        </View>
      </Pressable>

      {open ? (
        <View className="mt-3 border-t border-amber-500/30 pt-3">
          {finding.detail ? (
            <>
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                What was reported
              </Text>
              <Text className="mt-1 text-sm leading-6 text-white">{finding.detail}</Text>
            </>
          ) : null}

          <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            What the jury said
          </Text>
          {finding.reasons.map((reason, index) => (
            <Text key={index} className="mt-1 text-sm leading-6 text-white">
              “{reason.reasoning}”
            </Text>
          ))}

          <Pressable onPress={() => router.push(`/jury/${finding.juryId}`)}>
            <Text className="mt-3 text-xs font-medium text-slate-400 underline">
              The whole case, including how the jury was drawn
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function FindingsRecord({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['juries', 'findings', userId],
    queryFn: () => juries.findings(userId),
    enabled: Boolean(userId),
  });

  const findings = data?.findings ?? [];
  // Renders nothing at all for almost every profile, which is the point.
  if (findings.length === 0) return null;

  return (
    <View testID="findings-record" className="mb-4 px-4">
      <View className="mb-2 flex-row items-center">
        <AlertTriangle size={16} color="#F59E0B" />
        <Text className="ml-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Findings against this account
        </Text>
      </View>
      {findings.map((finding) => (
        <Entry key={finding.juryId} finding={finding} />
      ))}
      <Text className="mt-1 text-[11px] leading-4 text-slate-600">
        Nothing has been taken away from this account because of these. A jury decides whether
        something broke the rules; what to do about a person carrying your vote is yours to decide,
        and Article V is how you decide it.
      </Text>
    </View>
  );
}
