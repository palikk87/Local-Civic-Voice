/**
 * What a record's support has actually done, and where that points.
 *
 * Was: a hardcoded list of sample bills not in the database, a demo forecast
 * built from Math.random() whenever the API returned nothing, invented drivers
 * ("Media Coverage", "Opposition Campaign") with invented impact percentages,
 * and a written recommendation generated for every record regardless of data.
 * Parity with the web screen.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Activity, Info, Search, TrendingDown, TrendingUp } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useB2BStore, type TrajectoryData } from '@/lib/b2b-store';

/** A bar per observed day, then the projection dashed in a second colour. */
function Trace({ data }: { data: TrajectoryData }) {
  const observed = data.history.map((d) => {
    const total = d.support + d.oppose;
    return total > 0 ? (d.support - d.oppose) / total : 0;
  });
  const projected = data.projection?.points.map((p) => p.predicted) ?? [];
  const all = [...observed, ...projected];
  if (all.length < 2) return null;

  return (
    <View className="flex-row items-end h-24 mt-1">
      {all.map((value, index) => {
        const isProjection = index >= observed.length;
        // score is -1..1; render as height above a mid-line.
        const height = Math.max(2, ((value + 1) / 2) * 88);
        return (
          <View
            key={index}
            style={{ height, flex: 1, marginHorizontal: 0.5 }}
            className={isProjection ? 'bg-emerald-500/40' : 'bg-indigo-500/70'}
          />
        );
      })}
    </View>
  );
}

export default function B2BForecastScreen() {
  const router = useRouter();
  const session = useB2BStore((s) => s.session);
  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const verifySession = useB2BStore((s) => s.verifySession);
  const issues = useB2BStore((s) => s.issues);
  const fetchIssues = useB2BStore((s) => s.fetchIssues);
  const fetchForecast = useB2BStore((s) => s.fetchForecast);

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<TrajectoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOne, setLoadingOne] = useState(false);

  const isEnterprise = session?.tier === 'enterprise';

  useEffect(() => {
    if (!hasHydrated) return;
    (async () => {
      const valid = await verifySession();
      if (!valid) {
        router.replace('/b2b/login');
        return;
      }
      await fetchIssues();
      setLoading(false);
    })();
  }, [hasHydrated, verifySession, fetchIssues, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues.slice(0, 30);
    return issues
      .filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [issues, search]);

  const open = async (id: string) => {
    if (!isEnterprise) return;
    setSelectedId(id);
    setLoadingOne(true);
    // No fallback. When there is nothing, the screen says so.
    setData(await fetchForecast('bill', id));
    setLoadingOne(false);
  };

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0C1D18', '#1E1B4B', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#8FA79A" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Trajectory</Text>
            <Text className="text-slate-400 text-sm">Measured history, and where it points</Text>
          </View>
        </View>

        <ScrollView className="flex-1 px-4 py-4">
          {!isEnterprise ? (
            <View className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-4">
              <Text className="text-amber-400 font-medium">Enterprise plan</Text>
              <Text className="text-slate-300 text-sm mt-1">
                Trajectories are available on the Enterprise plan.
              </Text>
            </View>
          ) : null}

          <View className="flex-row items-center bg-slate-900/60 border border-slate-700 rounded-xl px-3 mb-4">
            <Search size={16} color="#6E8A7C" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search records"
              placeholderTextColor="#6E8A7C"
              className="flex-1 text-white py-2.5 px-2"
            />
          </View>

          {loading ? (
            <ActivityIndicator color="#818CF8" className="mt-8" />
          ) : filtered.length === 0 ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6">
              <Text className="text-white font-medium">No records yet.</Text>
              <Text className="text-slate-400 text-sm mt-1">
                This list is the records the platform actually holds. It was a fixed list of samples.
              </Text>
            </View>
          ) : (
            filtered.map((issue) => (
              <TouchableOpacity
                key={issue.id}
                onPress={() => open(issue.id)}
                disabled={!isEnterprise}
                className={`bg-slate-800/30 border rounded-xl p-4 mb-2 flex-row items-center justify-between ${
                  selectedId === issue.id ? 'border-indigo-500' : 'border-slate-700/50'
                } ${isEnterprise ? '' : 'opacity-60'}`}
              >
                <View className="flex-1 mr-2">
                  <Text className="text-white font-medium" numberOfLines={1}>
                    {issue.name}
                  </Text>
                  <Text className="text-slate-400 text-xs">
                    {issue.category ?? 'uncategorised'} — {issue.sentiment.total} votes
                  </Text>
                </View>
                <Activity size={16} color="#818CF8" />
              </TouchableOpacity>
            ))
          )}

          {selectedId ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-5 mt-4">
              {loadingOne ? (
                <ActivityIndicator color="#818CF8" />
              ) : !data ? (
                <Text className="text-slate-400 text-sm">Nothing recorded for this one yet.</Text>
              ) : (
                <>
                  <Trace data={data} />

                  <View className="flex-row mt-4">
                    <View className="flex-1">
                      <Text className="text-slate-400 text-xs">Now</Text>
                      <Text className="text-white text-lg font-bold">
                        {data.currentSentiment > 0 ? '+' : ''}
                        {(data.currentSentiment * 100).toFixed(0)}%
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-400 text-xs">Observed</Text>
                      <Text className="text-white text-lg font-bold">
                        {data.basis.days} {data.basis.days === 1 ? 'day' : 'days'}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-400 text-xs">Voices</Text>
                      <Text className="text-white text-lg font-bold">{data.basis.voices}</Text>
                    </View>
                  </View>

                  {data.projection ? (
                    <View className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 mt-4">
                      <View className="flex-row items-center">
                        {data.projection.slopePerDay >= 0 ? (
                          <TrendingUp size={16} color="#34D399" />
                        ) : (
                          <TrendingDown size={16} color="#EF4444" />
                        )}
                        <Text className="text-white font-medium ml-2 flex-1">
                          {data.projection.slopePerDay >= 0 ? 'Rising' : 'Falling'} by{' '}
                          {Math.abs(data.projection.slopePerDay * 100).toFixed(2)} points a day
                        </Text>
                      </View>
                      <Text className="text-slate-400 text-sm mt-2">
                        Fitted by {data.projection.method} over {data.basis.days} days.
                      </Text>
                    </View>
                  ) : (
                    <View className="bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 mt-4">
                      <Text className="text-white font-medium">No projection yet</Text>
                      <Text className="text-slate-400 text-sm mt-1">
                        {data.noProjection?.daysObserved ?? 0} days of history recorded;{' '}
                        {data.noProjection?.daysNeeded ?? 7} are needed before a line means
                        anything. The measured history above is real.
                      </Text>
                    </View>
                  )}

                  {data.basis.lawChangedOn.length > 0 ? (
                    <View className="flex-row items-start bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 mt-3">
                      <Info size={15} color="#818CF8" />
                      <Text className="text-slate-300 text-sm ml-2 flex-1">
                        The text of this law changed on {data.basis.lawChangedOn.join(', ')}.
                        Movement around those dates may be about the change rather than a shift of
                        opinion.
                      </Text>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          <View className="h-8" />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
