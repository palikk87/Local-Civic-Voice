/**
 * THE INTEGRITY AUDIT, ON A SCREEN — Constitution Article III §2.
 *
 * Phone twin of apps/web/src/components/audit/IntegrityAuditPanel.tsx. Same
 * routes, same words, same refusals.
 *
 * "Any user or group of users may demand an Integrity Audit of a specific vote
 * if there is evidence of bot interference or system malfunction."
 *
 * THE BUTTON IS THE CLAUSE. There is no approval step and nothing to apply
 * for: pressing it runs the audit. That is what "demand" means.
 *
 * WHAT IT WILL NOT DO. It never shows a name, because the server never sends
 * one. It never says fraud — "worth reading" is the strongest thing here. And
 * when a figure covers too few people it prints the withheld notice rather
 * than a small number.
 *
 * WITH NOTHING AUDITED IT SAYS SO. No sample audit, no example findings.
 */

import React, { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, EyeOff, ScanSearch } from 'lucide-react-native';
import { cn } from '@/lib/cn';
import { usePermissions } from '@/lib/auth/use-civic-auth';
import { articleV } from '@/lib/article-v';
import {
  audits,
  auditHeadline,
  detailLabel,
  type AuditFinding,
  type AuditSubjectType,
  type IntegrityAudit,
} from '@/lib/integrity-audit';

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const entries = Object.entries(finding.detail);

  return (
    <View
      testID="audit-finding"
      className={cn(
        'mb-2 rounded-xl border p-3',
        finding.status === 'attention'
          ? 'border-amber-500/40 bg-amber-500/10'
          : 'border-slate-700/50 bg-slate-800/40'
      )}
    >
      <View className="flex-row items-start">
        {finding.status === 'attention' ? (
          <AlertTriangle size={16} color="#F59E0B" />
        ) : finding.status === 'withheld' ? (
          <EyeOff size={16} color="#8FA79A" />
        ) : (
          <Check size={16} color="#10B981" />
        )}
        <View className="ml-2 flex-1">
          <Text className="text-sm font-medium text-white">{finding.title}</Text>
          <Text className="mt-0.5 text-xs leading-5 text-slate-400">{finding.summary}</Text>

          {entries.length > 0 ? (
            <View className="mt-2">
              {entries.map(([key, value]) => (
                <View key={key} className="flex-row items-center justify-between py-0.5">
                  <Text className="flex-1 text-[11px] text-slate-500">{detailLabel(key)}</Text>
                  <Text className="text-[11px] font-medium text-slate-200">{value}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function AuditBody({ audit }: { audit: IntegrityAudit }) {
  return (
    <View testID="integrity-audit">
      <Text className="mb-2 text-xs leading-5 text-slate-500">
        Audited {when(audit.runAt)}
        {audit.automatic ? ' — run automatically when the articles were filed.' : '.'}{' '}
        {auditHeadline(audit)}
      </Text>
      {audit.findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
    </View>
  );
}

export function IntegrityAuditPanel({
  subjectType,
  subjectId,
  title = 'Integrity Audit',
  what,
}: {
  subjectType: AuditSubjectType;
  subjectId: string;
  title?: string;
  what: string;
}) {
  const { isAuthenticated } = usePermissions();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const historyKey = ['integrity-audit', subjectType, subjectId];

  const { data, isLoading } = useQuery({
    queryKey: historyKey,
    queryFn: () => audits.history(subjectType, subjectId),
    enabled: Boolean(subjectId),
  });

  const demand = useMutation({
    mutationFn: () => audits.demand(subjectType, subjectId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof Error ? caught.message : 'The audit could not be run.');
    },
  });

  const history = data?.audits ?? [];
  const latest = history[0] ?? null;

  return (
    <View className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4">
      <View className="flex-row items-start justify-between">
        <View className="flex-1 pr-3">
          <View className="flex-row items-center">
            <ScanSearch size={16} color="#8FA79A" />
            <Text className="ml-2 text-sm font-semibold text-white">{title}</Text>
          </View>
          <Text className="mt-1 text-xs leading-5 text-slate-400">
            An audit counts {what}. It reports patterns and never accuses, and it never names
            anybody — a person draws the conclusion.
          </Text>
        </View>

        {isAuthenticated ? (
          <Pressable
            testID="request-audit"
            disabled={demand.isPending}
            onPress={() => demand.mutate()}
            className="rounded-lg border border-slate-600 px-3 py-1.5"
          >
            {demand.isPending ? (
              <ActivityIndicator size="small" color="#8FA79A" />
            ) : (
              <Text className="text-xs font-medium text-slate-200">Request an audit</Text>
            )}
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text testID="audit-error" className="mt-3 text-xs text-red-400">
          {error}
        </Text>
      ) : null}

      <View className="mt-3">
        {isLoading ? (
          <Text className="text-xs text-slate-500">Looking for audits…</Text>
        ) : latest ? (
          <AuditBody audit={latest} />
        ) : (
          <Text testID="no-audit-yet" className="text-xs leading-5 text-slate-500">
            Nothing here has been audited yet.
            {isAuthenticated ? ' Anyone can ask for one.' : ' Sign in to ask for one.'}
          </Text>
        )}
      </View>

      {history.length > 1 ? (
        <Text className="mt-3 text-[11px] text-slate-500">
          {history.length} audits on record, kept permanently — the quiet ones beside the rest.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The audit panel on a profile — shown only for somebody who actually holds
 * delegated votes.
 *
 * WHY THE CONDITION. This panel is about lent voice. On an account nobody has
 * lent to there is nothing to count and every finding would be withheld, which
 * teaches people to stop reading it. It appears the moment somebody is
 * carrying a voice, which is the moment it starts to matter.
 */
export function DelegateAuditPanel({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['article-v', 'leader', userId],
    queryFn: () => articleV.forLeader(userId),
    enabled: Boolean(userId),
  });

  if (!data || data.delegatorCount === 0) return null;

  return (
    <IntegrityAuditPanel
      subjectType="leader"
      subjectId={userId}
      title="Integrity Audit of this support"
      what="the votes lent to this person, as totals and timings"
    />
  );
}
