/**
 * How current are the RECORDS — bills, executive orders, court cases?
 *
 * WHERE THIS BELONGS, learned the hard way. It was mounted on the Government
 * screen, which lists federal officials, so it announced a count of laws and
 * quoted a bill title as "the most recent action we hold" to somebody looking
 * up their senator. It reports on GovernmentReference and it belongs where
 * GovernmentReference is shown: Discover.
 *
 * Web twin: apps/web/src/components/civic/DataFreshness.tsx — same endpoint,
 * same words, same refusal to guess.
 *
 * WHY THIS EXISTS. A visitor had no way to tell whether this section showed
 * today's Congress or a snapshot from whenever the last sync happened to run.
 * After a deploy pause or a spent API key those two look identical, and a
 * platform whose entire claim is that its records are the real ones owes a
 * reader the date on them.
 *
 * Every figure comes from the database. The cadence is read from the API, which
 * reports the intervals the schedulers actually run at rather than a sentence
 * that can drift away from the code.
 */
import { View, Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Clock, RefreshCw } from 'lucide-react-native';
import { api } from '@/lib/api/api';

interface Freshness {
  syncedAt: string | null;
  newestAction: { date: string | null; referenceId: string; title: string } | null;
  counts: Record<string, number>;
  cadence: { recordsHours: number; rollCallsHours: number; provenanceHours: number };
  awaitingProvenance: number;
}

/** "3 hours ago", "yesterday" — plain words, because a raw timestamp is not an answer. */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'in the last hour';
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function DataFreshness() {
  const { data } = useQuery<Freshness>({
    queryKey: ['government', 'freshness'],
    queryFn: () => api.get<Freshness>('/api/government-references/freshness'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  /*
   * A payload that is not the shape this expects renders NOTHING.
   *
   * The web twin read `Object.values(data.counts)` the moment `data` was
   * truthy, and `Object.values(undefined)` throws — a response missing one key
   * took down the whole Government page through the error boundary. A strip
   * saying how fresh the records are is the least important thing on that
   * screen; it must never be the reason the screen is blank. Saying nothing is
   * also the honest answer: with no counts there is no freshness to report, and
   * a zero would assert we hold no records at all.
   */
  if (!data || !data.counts || !data.cadence) return null;

  const synced = ago(data.syncedAt);
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);

  return (
    <View className="mx-4 mb-4 rounded-xl border border-slate-700/50 bg-slate-800/40 p-3">
      <View className="flex-row items-center">
        <RefreshCw size={14} color="#8FA79A" />
        {/*
          Null is a real answer and it is said plainly. "Never" is alarming in
          exactly the way it should be — it means the sync has not run.
        */}
        <Text className="ml-1.5 flex-1 text-sm font-medium text-white">
          {synced ? `Records checked ${synced}` : 'Records have not been checked yet'}
        </Text>
      </View>

      <Text className="mt-1 text-xs text-slate-400">
        {`${total.toLocaleString()} records held — rechecked every ${data.cadence.recordsHours}h, roll calls every ${data.cadence.rollCallsHours}h`}
      </Text>

      {data.newestAction?.date ? (
        <View className="mt-1.5 flex-row items-start">
          <View className="mt-0.5">
            <Clock size={12} color="#8FA79A" />
          </View>
          <Text className="ml-1.5 flex-1 text-xs text-slate-400">
            Most recent action we hold: {new Date(data.newestAction.date).toLocaleDateString()} —{' '}
            {data.newestAction.title}
          </Text>
        </View>
      ) : null}

      {data.awaitingProvenance > 0 ? (
        /* Said out loud rather than hidden: those records show no date and no
           sponsor, and a reader should know that is a gap being filled rather
           than a fact about the law. */
        <Text className="mt-1 text-xs text-slate-400">
          {data.awaitingProvenance.toLocaleString()} still waiting on a sponsor and introduction
          date from congress.gov — those fields stay blank until they arrive.
        </Text>
      ) : null}
    </View>
  );
}
