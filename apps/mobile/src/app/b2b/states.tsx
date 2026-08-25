/**
 * States, counted from the people in them. Parity with the web screen.
 *
 * Was: all 51 states, each carrying the national sentiment figure multiplied by
 * its share of the 435 House seats — so every state showed the same number, and
 * an empty database looked like full national coverage.
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
import { ArrowLeft, Building2, ChevronRight, EyeOff, MapPin, Users } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';

import {
  useB2BStore,
  type Coverage,
  type DistrictRow,
  type PlaceResult,
  type StateRow,
} from '@/lib/b2b-store';

function Pulse({ pulse }: { pulse: PlaceResult }) {
  if (!pulse.enough) {
    return (
      <Text className="text-slate-400 text-sm">
        {pulse.voices === 0
          ? 'No votes yet'
          : `${pulse.voices} ${pulse.voices === 1 ? 'voice' : 'voices'} — too few`}
      </Text>
    );
  }
  const positive = pulse.score > 0;
  return (
    <Text
      className={`text-sm font-semibold ${
        pulse.score === 0 ? 'text-slate-300' : positive ? 'text-emerald-400' : 'text-red-400'
      }`}
    >
      {positive ? '+' : ''}
      {(pulse.score * 100).toFixed(0)}%
    </Text>
  );
}

function CoverageNote({ coverage }: { coverage: Coverage | null }) {
  if (!coverage) return null;
  return (
    <View className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-4 mb-4">
      <View className="flex-row items-center">
        <Users size={16} color="#818CF8" />
        <Text className="text-white font-medium ml-2">What this is drawn from</Text>
      </View>
      <Text className="text-slate-300 text-sm mt-2">
        {coverage.placed.toLocaleString()} of {coverage.participants.toLocaleString()} members have
        told us their district, across {coverage.districtsRepresented} of them.{' '}
        {coverage.districtsReportable} have enough voices to report.
      </Text>
      <Text className="text-slate-500 text-xs mt-1">
        Nothing is estimated from national totals.
      </Text>
    </View>
  );
}

export default function B2BStatesScreen() {
  const router = useRouter();
  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const verifySession = useB2BStore((s) => s.verifySession);
  const states = useB2BStore((s) => s.states);
  const coverage = useB2BStore((s) => s.coverage);
  const fetchStates = useB2BStore((s) => s.fetchStates);
  const fetchStateDetails = useB2BStore((s) => s.fetchStateDetails);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openState, setOpenState] = useState<string | null>(null);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);

  const load = useCallback(async () => {
    await fetchStates();
    setLoading(false);
  }, [fetchStates]);

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

  const open = async (state: StateRow) => {
    if (openState === state.stateCode) {
      setOpenState(null);
      return;
    }
    setOpenState(state.stateCode);
    const detail = await fetchStateDetails(state.stateCode);
    setDistricts(detail?.districts ?? []);
  };

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
            <Text className="text-white text-lg font-semibold">States</Text>
            <Text className="text-slate-400 text-sm">Counted from declared districts</Text>
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
          <CoverageNote coverage={coverage} />

          {states.length === 0 ? (
            <View className="bg-slate-800/30 border border-slate-700/50 rounded-2xl p-6 items-center">
              <MapPin size={28} color="#64748B" />
              <Text className="text-white font-medium mt-3">No state has voices in it yet.</Text>
              <Text className="text-slate-400 text-sm text-center mt-2">
                Members choose their district themselves, and it is optional. States appear here with
                real counts as they do.
              </Text>
            </View>
          ) : (
            states.map((state) => (
              <View
                key={state.stateCode}
                className="bg-slate-800/30 border border-slate-700/50 rounded-2xl mb-3"
              >
                <TouchableOpacity
                  onPress={() => open(state)}
                  className="flex-row items-center justify-between p-4"
                >
                  <View className="flex-row items-center flex-1">
                    <View className="w-10 h-10 bg-indigo-500/20 rounded-xl items-center justify-center">
                      <Building2 size={18} color="#818CF8" />
                    </View>
                    <View className="ml-3 flex-1">
                      <Text className="text-white font-semibold">{state.stateName}</Text>
                      <Text className="text-slate-400 text-xs">
                        {state.residents} {state.residents === 1 ? 'member' : 'members'} across{' '}
                        {state.districtsRepresented}{' '}
                        {state.districtsRepresented === 1 ? 'district' : 'districts'}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center">
                    <Pulse pulse={state.pulse} />
                    <ChevronRight size={18} color="#64748B" />
                  </View>
                </TouchableOpacity>

                {openState === state.stateCode ? (
                  <View className="border-t border-slate-700/50 p-4">
                    {districts.length === 0 ? (
                      <Text className="text-slate-400 text-sm">
                        No districts declared here yet.
                      </Text>
                    ) : (
                      districts.map((d) => (
                        <View
                          key={d.districtId}
                          className="bg-slate-900/40 rounded-lg px-3 py-2 mb-2"
                        >
                          <View className="flex-row items-center justify-between">
                            <Text className="text-white font-medium">{d.districtId}</Text>
                            <Pulse pulse={d.pulse} />
                          </View>
                          {/* A real name from the congress.gov roster. This used
                              to be the literal string "Representative". */}
                          <Text className="text-slate-400 text-sm">
                            {d.representative
                              ? `${d.representative.name} (${d.representative.party})`
                              : 'seat vacant'}
                          </Text>
                          <Text className="text-slate-500 text-xs">
                            {d.residents} {d.residents === 1 ? 'member' : 'members'}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            ))
          )}

          <View className="flex-row items-start bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4 mt-2 mb-8">
            <EyeOff size={16} color="#818CF8" />
            <Text className="text-slate-300 text-sm ml-2 flex-1">
              Districts with too few voters are withheld rather than estimated. Individual members are
              never identified.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
