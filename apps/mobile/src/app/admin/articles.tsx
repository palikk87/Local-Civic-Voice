// Article V filings — mobile twin of apps/web/src/components/admin/ArticlesTab.tsx.
//
// READ ONLY, AND THAT IS THE FEATURE. There is nothing on this screen that
// stops, pauses or overturns a proceeding, because there is no route behind
// one at any permission level, including the owner's. Article V is the
// people's remedy against borrowed power; a remedy the platform can switch off
// is not a remedy, and a queue with a Dismiss button would quietly become one.
//
// The remedy against a bad-faith filing is against the FILER, through the
// ordinary suspend and ban powers on the Users screen. That runs alongside the
// proceeding rather than stopping it: a filer being sanctioned does not make
// the accusation untrue.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Gavel, RotateCcw, Scale, ShieldOff } from 'lucide-react-native';
import { useAdminStore } from '@/lib/admin-store';
import { BACKEND_URL } from '@/lib/config';

interface Person {
  id: string;
  name: string;
  username: string | null;
  email: string;
}

interface ImpeachmentFiling {
  id: string;
  kind: 'impeachment';
  status: string;
  grounds: string;
  evidence: string;
  accused: Person;
  filedBy: Person;
  openedAt: string;
  expiresAt: string;
  suspendedUntil: string | null;
  votes: number;
  electorCount: number;
}

interface ResetFiling {
  id: string;
  kind: 'system_reset';
  status: string;
  grounds: string;
  evidence: string;
  /** Null when the filer's account is gone. There is no foreign key on purpose. */
  filedBy: Person | null;
  openedAt: string;
  expiresAt: string;
  executeAfter: string | null;
  executedAt: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
  eligibleCount: number;
}

interface ArticlesResponse {
  articles: ImpeachmentFiling[];
  resets: ResetFiling[];
  openCount: number;
  canStopProceedings: boolean;
}

function who(person: Person | null): string {
  if (!person) return 'an account that no longer exists';
  return person.username ? `@${person.username}` : person.name;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row py-0.5">
      <Text className="w-32 text-xs text-slate-400">{label}</Text>
      <Text className="flex-1 text-xs text-slate-100">{value}</Text>
    </View>
  );
}

function Filing({
  icon,
  title,
  status,
  rows,
  grounds,
  evidence,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  rows: { label: string; value: string }[];
  grounds: string;
  evidence: string;
}) {
  return (
    <View className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/60 p-4">
      <View className="flex-row items-center">
        {icon}
        <Text className="ml-2 flex-1 font-semibold text-white">{title}</Text>
        <View className="rounded-full bg-slate-600/40 px-2 py-0.5">
          <Text className="text-xs text-slate-200">{status}</Text>
        </View>
      </View>

      <View className="mt-3">
        {rows.map((row) => (
          <Row key={row.label} label={row.label} value={row.value} />
        ))}
      </View>

      <View className="mt-3 rounded-xl bg-slate-900/60 p-3">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Grounds
        </Text>
        <Text className="mt-1 text-sm leading-6 text-slate-100">{grounds}</Text>
        <Text className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Evidence
        </Text>
        <Text className="mt-1 text-sm leading-6 text-slate-100">{evidence}</Text>
      </View>
    </View>
  );
}

export default function AdminArticlesScreen() {
  const router = useRouter();
  const session = useAdminStore((s) => s.session);

  const [data, setData] = useState<ArticlesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/articles`, {
        headers: {
          'Content-Type': 'application/json',
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`Request failed: ${response.status}`);
      setData((await response.json()) as ArticlesResponse);
    } catch (error) {
      Alert.alert('Could not load', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const empty =
    !loading && data && data.articles.length === 0 && data.resets.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} className="p-1">
          <ArrowLeft size={22} color="#94A3B8" />
        </TouchableOpacity>
        <Scale size={18} color="#F59E0B" />
        <Text className="ml-2 flex-1 text-lg font-bold text-white">Article V filings</Text>
        {data?.openCount ? (
          <View className="rounded-full bg-amber-500/20 px-2 py-0.5">
            <Text className="text-xs text-amber-300">{data.openCount} open</Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#94A3B8"
          />
        }
      >
        {/* Said out loud, and read from the server's own answer rather than
            asserted by this file. */}
        <View className="mb-4 flex-row items-start rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3">
          <ShieldOff size={18} color="#F59E0B" />
          <Text className="ml-2 flex-1 text-sm leading-6 text-slate-100">
            <Text className="font-bold">You cannot stop a proceeding.</Text> Not from here, not
            from anywhere, at any permission level. Article V belongs to the people. If a filing
            is malicious or frivolous, act against the person who brought it — suspend or ban them
            from the Users screen. The proceeding still runs its course.
            {data?.canStopProceedings ? (
              <Text className="text-red-400"> The server reports otherwise. That is a bug.</Text>
            ) : null}
          </Text>
        </View>

        {loading ? (
          <Text className="py-8 text-center text-sm text-slate-500">Loading filings…</Text>
        ) : null}

        {empty ? (
          <Text className="rounded-2xl border border-slate-700/50 bg-slate-800/60 p-6 text-center text-sm text-slate-400">
            Nobody has filed Articles of Impeachment or Articles of System Reset. Filings appear
            here the moment they are made, at the same time they reach the person named.
          </Text>
        ) : null}

        {data?.articles.map((filing) => (
          <Filing
            key={filing.id}
            icon={<Gavel size={18} color="#EF4444" />}
            title={`Articles of Impeachment — ${who(filing.accused)}`}
            status={filing.status}
            grounds={filing.grounds}
            evidence={filing.evidence}
            rows={[
              { label: 'Filed by', value: `${who(filing.filedBy)} (${filing.filedBy.email})` },
              { label: 'Accused', value: `${who(filing.accused)} (${filing.accused.email})` },
              { label: 'Opened', value: when(filing.openedAt) },
              { label: 'Closes', value: when(filing.expiresAt) },
              { label: 'Votes', value: `${filing.votes} of ${filing.electorCount} electors` },
              { label: 'Suspended until', value: when(filing.suspendedUntil) },
            ]}
          />
        ))}

        {data?.resets.map((filing) => (
          <Filing
            key={filing.id}
            icon={<RotateCcw size={18} color="#EF4444" />}
            title="Articles of System Reset"
            status={filing.status}
            grounds={filing.grounds}
            evidence={filing.evidence}
            rows={[
              {
                label: 'Filed by',
                value: filing.filedBy
                  ? `${who(filing.filedBy)} (${filing.filedBy.email})`
                  : who(null),
              },
              { label: 'Opened', value: when(filing.openedAt) },
              { label: 'Closes', value: when(filing.expiresAt) },
              { label: 'Eligible', value: String(filing.eligibleCount) },
              { label: 'Runs after', value: when(filing.executeAfter) },
              { label: 'Executed', value: when(filing.executedAt) },
              ...(filing.revertedAt
                ? [
                    {
                      label: 'Put back',
                      value: `${when(filing.revertedAt)} by ${filing.revertedBy ?? 'unknown'}`,
                    },
                  ]
                : []),
            ]}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
