/**
 * The bug queue, on the phone.
 *
 * Web twin: apps/web/src/components/admin/BugReportsTab.tsx.
 *
 * The REPORTER has always been on the phone — mounted above every screen,
 * including the ones a guest is on. The QUEUE was web-only, so an admin on a
 * phone could file a report and never read one. This is the reading half: the
 * list, what was pointed at, and the three states a report moves through.
 *
 * The read-link minting stays on the web. It hands out a bearer token that can
 * export the whole queue, and a token shown once is a thing to copy somewhere
 * safe — not something to generate on a phone and lose.
 */
import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bug, Check, CircleDot, Archive } from 'lucide-react-native';

import { BACKEND_URL } from '@/lib/config';
import { adminAuthHeader } from '@/lib/admin-store';

type Status = 'open' | 'in_progress' | 'closed';

interface BugReport {
  id: string;
  username: string | null;
  pagePath: string;
  elementLabel: string | null;
  message: string;
  status: Status;
  createdAt: string;
}

const FILTERS: { value: Status | 'all'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
];

const NEXT: Record<Status, { to: Status; label: string; icon: typeof Check }> = {
  open: { to: 'in_progress', label: 'Start', icon: CircleDot },
  in_progress: { to: 'closed', label: 'Close', icon: Check },
  closed: { to: 'open', label: 'Reopen', icon: Archive },
};

export default function AdminBugReportsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Status | 'all'>('open');

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['admin-bug-reports', filter],
    // The admin console has its own session, so these go through fetch with
    // adminAuthHeader rather than the app's api client, exactly like every
    // other admin screen here.
    queryFn: async () => {
      const response = await fetch(
        `${BACKEND_URL}/api/admin/bug-reports?status=${filter}`,
        { headers: adminAuthHeader() },
      );
      if (!response.ok) throw new Error(`The server answered ${response.status}`);
      return (await response.json()) as {
        reports: BugReport[];
        total: number;
        openCount: number;
      };
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: Status }) => {
      const response = await fetch(`${BACKEND_URL}/api/admin/bug-reports/${id}`, {
        method: 'PATCH',
        headers: { ...adminAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(`The server answered ${response.status}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-bug-reports'] });
    },
  });

  const reports = data?.reports ?? [];

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <Pressable onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </Pressable>
        <Bug size={20} color="#F59E0B" style={{ marginLeft: 8 }} />
        <Text className="text-white text-lg font-semibold ml-2">Bug reports</Text>
        {data ? (
          <Text className="text-slate-500 text-sm ml-auto">{data.openCount} open</Text>
        ) : null}
      </View>

      <View className="flex-row px-4 py-3">
        {FILTERS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => setFilter(option.value)}
            className={
              filter === option.value
                ? 'px-3 py-1.5 rounded-full bg-amber-500/20 mr-2'
                : 'px-3 py-1.5 rounded-full bg-slate-800 mr-2'
            }
          >
            <Text
              className={
                filter === option.value
                  ? 'text-amber-400 text-xs font-medium'
                  : 'text-slate-400 text-xs font-medium'
              }
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} tintColor="#F59E0B" />
        }
      >
        {isLoading ? (
          <View className="py-16 items-center">
            <ActivityIndicator color="#F59E0B" />
          </View>
        ) : isError ? (
          /* An empty queue and an unreachable server are different facts. */
          <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
            <Text className="text-white text-lg">We could not load the queue</Text>
            <Text className="text-slate-400 text-sm mt-1">
              That is the server, not an empty list.
            </Text>
            <Pressable onPress={() => refetch()} className="mt-4">
              <Text className="text-amber-500 text-sm font-medium">Try again</Text>
            </Pressable>
          </View>
        ) : reports.length === 0 ? (
          <View className="border border-dashed border-slate-700 rounded-xl py-16 items-center">
            <Text className="text-white text-lg">Nothing here</Text>
            <Text className="text-slate-400 text-sm mt-1">
              No reports with this status.
            </Text>
          </View>
        ) : (
          reports.map((report) => {
            const next = NEXT[report.status];
            const NextIcon = next.icon;
            return (
              <View
                key={report.id}
                className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4 mb-3"
              >
                <Text className="text-slate-500 text-xs">
                  {report.username ? `@${report.username}` : 'a signed-out visitor'} ·{' '}
                  {new Date(report.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
                <Text className="text-white text-sm mt-2 leading-5">{report.message}</Text>

                {/* WHAT WAS POINTED AT, not just what was said. A report that
                    names the screen and the control is one somebody can act on. */}
                <Text className="text-slate-500 text-xs mt-2">
                  {report.pagePath}
                  {report.elementLabel ? ` · ${report.elementLabel}` : ''}
                </Text>

                <Pressable
                  onPress={() => setStatus.mutate({ id: report.id, status: next.to })}
                  disabled={setStatus.isPending}
                  className="flex-row items-center self-start mt-3 px-3 py-1.5 rounded-full bg-slate-700"
                >
                  <NextIcon size={14} color="#F59E0B" />
                  <Text className="text-amber-400 text-xs font-medium ml-1.5">{next.label}</Text>
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
