/**
 * Where opinion is concentrated — from voters, not from seat counts.
 *
 * Was: all 435 districts, always shaded. Colour from the one national sentiment
 * figure, intensity from the state's share of the 435 seats, and the party
 * stripe from Math.random() re-rolled per request — so a district changed
 * colour on refresh. Parity with the web screen.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, EyeOff, Info, MapPin, Users } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { useB2BStore, type HeatmapPoint } from '@/lib/b2b-store';

const PARTIES: { key: 'D' | 'R' | 'I' | undefined; label: string }[] = [
  { key: undefined, label: 'All' },
  { key: 'D', label: 'Democrat' },
  { key: 'R', label: 'Republican' },
  { key: 'I', label: 'Independent' },
];

function shadeFor(point: HeatmapPoint, max: number): string {
  const sentiment = point.sentiment ?? 0;
  const weight = max > 0 ? Math.max(0.25, point.value / max) : 0.25;
  const alpha = 0.15 + weight * 0.55;
  if (sentiment > 0.05) return `rgba(52, 211, 153, ${alpha})`;
  if (sentiment < -0.05) return `rgba(239, 68, 68, ${alpha})`;
  return `rgba(148, 163, 184, ${alpha})`;
}

export default function B2BHeatmapScreen() {
  const router = useRouter();
  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const verifySession = useB2BStore((s) => s.verifySession);
  const heatmapData = useB2BStore((s) => s.heatmapData);
  const fetchHeatmapData = useB2BStore((s) => s.fetchHeatmapData);

  const [party, setParty] = useState<'D' | 'R' | 'I' | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<HeatmapPoint | null>(null);

  const load = useCallback(async () => {
    await fetchHeatmapData({ party });
    setLoading(false);
  }, [fetchHeatmapData, party]);

  useEffect(() => {
    if (!hasHydrated) return;
    (async () => {
      const valid = await verifySession();
      if (!valid) {
        router.replace('/b2b/login');
        return;
      }
      await load();
    })();
  }, [hasHydrated, verifySession, load, router]);

  const points = heatmapData?.districts ?? [];
  const suppressed = heatmapData?.suppressed ?? [];
  const max = heatmapData?.range.max ?? 0;
  const coverage = heatmapData?.coverage;
  const floor = heatmapData?.floor ?? 5;

  if (loading) {
    return (
      <View className="flex-1 bg-slate-950 items-center justify-center">
        <ActivityIndicator size="large" color="#818CF8" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-950">
      <LinearGradient
        colors={['#0F172A', '#1E1B4B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <SafeAreaView className="flex-1">
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800/50">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <ArrowLeft size={24} color="#94A3B8" />
          </TouchableOpacity>
          <View className="flex-1 ml-2">
            <Text className="text-white text-lg font-semibold">Heatmap</Text>
            <Text className="text-slate-400 text-sm">Districts with enough voices to report</Text>
          </View>
        </View>

        <ScrollView
          className="flex-1 px-4 py-4"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor="#818CF8"
            />
          }
        >
          {coverage ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mb-4">
              <View className="flex-row items-center">
                <Users size={16} color="#818CF8" />
                <Text className="text-white font-medium ml-2">What this is drawn from</Text>
              </View>
              <Text className="text-slate-300 text-sm mt-2">
                {coverage.placed.toLocaleString()} of {coverage.participants.toLocaleString()}{' '}
                members have told us their district. {coverage.districtsReportable} of{' '}
                {coverage.districtsRepresented} have enough voices to report.
              </Text>
            </View>
          ) : null}

          <View className="flex-row flex-wrap mb-4">
            {PARTIES.map((option) => (
              <TouchableOpacity
                key={option.label}
                onPress={() => setParty(option.key)}
                className={`px-3 py-1.5 rounded-lg mr-2 mb-2 ${
                  party === option.key ? 'bg-indigo-500' : 'bg-slate-800/60'
                }`}
              >
                <Text className={party === option.key ? 'text-white' : 'text-slate-400'}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {points.length === 0 ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 items-center">
              <MapPin size={28} color="#64748B" />
              <Text className="text-white font-medium mt-3">Nothing can be shown yet.</Text>
              <Text className="text-slate-400 text-sm text-center mt-2">
                No district has reached {floor} voters. Districts appear as members declare where
                they are and vote — never before.
              </Text>
            </View>
          ) : (
            <View className="flex-row flex-wrap -mx-1">
              {points.map((point) => (
                <View key={point.districtId} className="w-1/2 px-1 mb-2">
                  <TouchableOpacity
                    onPress={() => setSelected(point)}
                    style={{ backgroundColor: shadeFor(point, max) }}
                    className="border border-slate-700/50 rounded-xl p-3"
                  >
                    <Text className="text-white font-semibold">{point.districtId}</Text>
                    <Text className="text-slate-300 text-xs" numberOfLines={1}>
                      {point.representative?.name ?? 'seat vacant'}
                    </Text>
                    <Text className="text-white font-medium mt-1">
                      {point.sentiment !== null
                        ? `${point.sentiment > 0 ? '+' : ''}${(point.sentiment * 100).toFixed(0)}%`
                        : '—'}
                    </Text>
                    <Text className="text-slate-300 text-xs">
                      {point.value} {point.value === 1 ? 'voice' : 'voices'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {selected ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 mt-4">
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="text-white text-lg font-bold">{selected.districtId}</Text>
                  <Text className="text-slate-400 text-sm">
                    {selected.representative
                      ? `${selected.representative.name} — ${selected.representative.party}`
                      : 'Seat vacant'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)}>
                  <Text className="text-slate-400 text-sm underline">Close</Text>
                </TouchableOpacity>
              </View>
              <Text className="text-slate-300 text-sm mt-3">
                {selected.value} {selected.value === 1 ? 'member' : 'members'} here have voted,
                leaning {selected.sentiment !== null && selected.sentiment > 0 ? 'for' : 'against'} on
                balance.
              </Text>
            </View>
          ) : null}

          {suppressed.length > 0 ? (
            <View className="bg-slate-800/20 border border-slate-700/50 rounded-2xl p-4 mt-4">
              <View className="flex-row items-center">
                <EyeOff size={16} color="#94A3B8" />
                <Text className="text-white font-medium ml-2">
                  {suppressed.length} {suppressed.length === 1 ? 'district' : 'districts'} withheld
                </Text>
              </View>
              <Text className="text-slate-400 text-sm mt-2">
                Fewer than {floor} people have voted in each. Publishing a percentage over that few
                would identify them, so the count is shown and the opinion is not.
              </Text>
              <View className="flex-row flex-wrap mt-3">
                {suppressed.map((d) => (
                  <View
                    key={d.districtId}
                    className="bg-slate-900/60 rounded-lg px-2.5 py-1 mr-2 mb-2"
                  >
                    <Text className="text-slate-300 text-xs">
                      {d.districtId} — {d.voices} {d.voices === 1 ? 'voice' : 'voices'}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <View className="flex-row items-start bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mt-4 mb-8">
            <Info size={16} color="#818CF8" />
            <Text className="text-slate-300 text-sm ml-2 flex-1">
              Every figure is counted from members who chose to say which district they are in.
              Nothing is estimated, apportioned by seat count, or inferred from a device.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
