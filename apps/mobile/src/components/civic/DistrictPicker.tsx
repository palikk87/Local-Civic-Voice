/**
 * Tell us your district, or don't. Parity with the web picker.
 *
 * Bill of Rights Article IV names jurisdiction as a legitimate collection
 * purpose and caps collection at the minimum needed for it — which is why this
 * asks for a district and never a street, a ZIP it keeps, or a position from the
 * device. Article I is why declining costs nothing: the vote originates in the
 * individual, so a ballot conditional on an address would be a lock-in.
 *
 * The list is the congress.gov roster, so choosing shows the representative's
 * name and confirms the choice as it is made.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { Check, MapPin, ShieldCheck, Trash2 } from 'lucide-react-native';

import { api } from '@/lib/api/api';

interface DistrictOption {
  districtId: string;
  stateCode: string;
  stateName: string;
  district: number | null;
  representative: { name: string; party: string; photoUrl: string | null } | null;
}

interface Mine {
  districtId: string | null;
  stateCode: string | null;
  district: DistrictOption | null;
  explanation: { why: string; collected: string; shared: string; optional: string };
}

/**
 * THE OFFICIAL LOOKUP, FOR THE ONE IN SIX A ZIP CANNOT SETTLE.
 *
 * The House of Representatives runs a finder that takes a ZIP and, only when
 * the ZIP straddles districts, asks for a street address to settle it. The
 * address goes to the House — which already has it — and never touches this
 * platform. Web twin: apps/web/src/components/civic/DistrictPicker.tsx.
 */
const HOUSE_FINDER = 'https://www.house.gov/representatives/find-your-representative';

interface ZipLookup {
  districts: DistrictOption[];
  spansSeveral: boolean;
  source: string;
  vintage: string;
}

export function DistrictPicker({ onChange }: { onChange?: (id: string | null) => void }) {
  const [zip, setZip] = useState('');
  const [zipLooking, setZipLooking] = useState(false);
  const [zipResult, setZipResult] = useState<ZipLookup | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [options, setOptions] = useState<DistrictOption[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  /**
   * Look the ZIP up. Nothing is saved by this — it reads a table and forgets.
   *
   * An empty answer and a failed lookup are different sentences: "that ZIP is
   * in no district" is a claim about somebody's home and must never be what a
   * download failure looks like.
   */
  async function lookUpZip(value: string) {
    setZipLooking(true);
    setZipError(null);
    setZipResult(null);
    try {
      const found = await api.get<ZipLookup>(`/api/users/jurisdiction/by-zip/${value}`);
      setZipResult(found);
      if (found.districts.length === 0) {
        setZipError('No district matched that ZIP. Check the digits, or search by state below.');
      }
    } catch (error) {
      setZipError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not look that up. You can still search by state below.'
      );
    } finally {
      setZipLooking(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, current] = await Promise.all([
          api.get<{ districts: DistrictOption[] }>('/api/users/jurisdiction/districts'),
          api.get<Mine>('/api/users/me/jurisdiction'),
        ]);
        if (cancelled) return;
        setOptions(list.districts);
        setMine(current);
      } catch {
        if (!cancelled) Alert.alert('Could not load the district list.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter(
        (d) =>
          d.districtId.toLowerCase().includes(q) ||
          d.stateName.toLowerCase().includes(q) ||
          (d.representative?.name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 10);
  }, [options, search]);

  const choose = async (districtId: string) => {
    setSaving(true);
    try {
      await api.put('/api/users/me/jurisdiction', { districtId });
      setMine(await api.get<Mine>('/api/users/me/jurisdiction'));
      setSearch('');
      setZip('');
      setZipResult(null);
      setZipError(null);
      onChange?.(districtId);
    } catch (error) {
      Alert.alert('Not saved', error instanceof Error ? error.message : 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api.delete('/api/users/me/jurisdiction');
      setMine(await api.get<Mine>('/api/users/me/jurisdiction'));
      onChange?.(null);
    } catch {
      Alert.alert('Not saved', 'That did not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator color="#818CF8" />;
  }

  return (
    <View>
      <View className="flex-row items-center mb-2">
        <MapPin size={16} color="#8FA79A" />
        <Text className="text-white font-medium ml-2">Your district</Text>
        <View className="bg-slate-800 rounded-full px-2 py-0.5 ml-2">
          <Text className="text-slate-400 text-xs">optional</Text>
        </View>
      </View>

      {mine?.district ? (
        <View className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 mb-3">
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <Text className="text-white font-medium">
                {mine.district.districtId} — {mine.district.stateName}
              </Text>
              {mine.district.representative ? (
                <Text className="text-slate-400 text-sm">
                  Represented by {mine.district.representative.name} (
                  {mine.district.representative.party})
                </Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={remove} disabled={saving} className="flex-row items-center">
              <Trash2 size={14} color="#F87171" />
              <Text className="text-red-400 text-sm ml-1">Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text className="text-slate-400 text-sm mb-3">
          You have not said. Your votes still count — they just are not placed on a map.
        </Text>
      )}

      {/* THE ZIP BOX, FIRST, because it is the thing people know. Reported
          plainly: "almost no one knows what their district or reps are". */}
      <Text className="text-white text-sm font-medium mb-1.5">Find it with your ZIP code</Text>
      <View className="flex-row mb-1.5">
        <TextInput
          testID="district-zip"
          value={zip}
          onChangeText={(next) => {
            const digits = next.replace(/[^0-9]/g, '').slice(0, 5);
            setZip(digits);
            setZipError(null);
            if (digits.length < 5) setZipResult(null);
          }}
          onSubmitEditing={() => {
            if (zip.length === 5) void lookUpZip(zip);
          }}
          placeholder="e.g. 90210"
          placeholderTextColor="#6E8A7C"
          keyboardType="number-pad"
          maxLength={5}
          className="flex-1 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white"
        />
        <TouchableOpacity
          testID="district-zip-find"
          onPress={() => {
            if (zip.length === 5) void lookUpZip(zip);
          }}
          disabled={zip.length !== 5 || zipLooking}
          className={
            zip.length === 5 && !zipLooking
              ? 'ml-2 items-center justify-center rounded-lg bg-amber-500 px-4'
              : 'ml-2 items-center justify-center rounded-lg bg-slate-700 px-4'
          }
        >
          {zipLooking ? (
            <ActivityIndicator size="small" color="#0C1D18" />
          ) : (
            <Text className={zip.length === 5 ? 'text-slate-900 font-semibold' : 'text-slate-500 font-semibold'}>
              Find
            </Text>
          )}
        </TouchableOpacity>
      </View>
      <Text className="text-slate-500 text-xs mb-3">
        Used to look up the district and then discarded. It is not saved to your account.
      </Text>

      {zipError ? (
        <View className="mb-3">
          <Text testID="district-zip-error" className="text-amber-400 text-sm mb-1">
            {zipError}
          </Text>
          <TouchableOpacity onPress={() => void Linking.openURL(HOUSE_FINDER)}>
            <Text testID="house-finder-link" className="text-amber-400 text-sm underline">
              Look yourself up on house.gov
            </Text>
          </TouchableOpacity>
          <Text className="text-slate-500 text-xs mt-1">
            It asks the House for your address, not us. Come back and pick what it tells you.
          </Text>
        </View>
      ) : null}

      {zipResult && zipResult.districts.length > 0 ? (
        <View testID="district-zip-results" className="mb-3 rounded-lg border border-slate-700 p-3">
          {/* SAID OUT LOUD WHEN IT IS NOT ONE ANSWER. Seventeen ZIPs in every
              hundred straddle districts; hiding that would make this quietly
              wrong about one person in six. */}
          <Text className="text-slate-400 text-sm mb-2">
            {zipResult.spansSeveral
              ? `That ZIP crosses ${zipResult.districts.length} districts. Pick the one whose representative is yours — most of the ZIP is in the first.`
              : 'That ZIP is in this district.'}
          </Text>
          {zipResult.districts.map((d) => (
            <TouchableOpacity
              key={d.districtId}
              onPress={() => choose(d.districtId)}
              disabled={saving}
              className="flex-row items-center justify-between rounded-md border border-slate-700 px-3 py-2.5 mb-1.5"
            >
              <View className="flex-1">
                <Text className="text-white font-medium">{d.districtId}</Text>
                <Text className="text-slate-400 text-sm">
                  {d.representative?.name ?? 'seat vacant'}
                  {d.representative ? ` (${d.representative.party})` : ''}
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          {zipResult.spansSeveral ? (
            <View className="mt-2 border-t border-slate-800 pt-2">
              <Text className="text-slate-400 text-sm mb-1">Not sure which is yours?</Text>
              <TouchableOpacity onPress={() => void Linking.openURL(HOUSE_FINDER)}>
                <Text testID="house-finder-link" className="text-amber-400 text-sm underline">
                  Look yourself up on house.gov
                </Text>
              </TouchableOpacity>
              <Text className="text-slate-500 text-xs mt-1">
                It asks the House for your address, not us. Come back and pick what it tells you.
              </Text>
            </View>
          ) : null}

          <Text className="text-slate-500 text-xs mt-2">
            Boundaries from the U.S. Census Bureau ({zipResult.vintage}). Seats from congress.gov.
          </Text>
        </View>
      ) : null}

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Or search by state, district, or representative"
        placeholderTextColor="#6E8A7C"
        autoCapitalize="none"
        className="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5 text-white"
      />

      {matches.map((d) => (
        <TouchableOpacity
          key={d.districtId}
          onPress={() => choose(d.districtId)}
          disabled={saving}
          className="flex-row items-center justify-between px-3 py-2.5 border-b border-slate-800"
        >
          <View className="flex-1">
            <Text className="text-white font-medium">{d.districtId}</Text>
            <Text className="text-slate-400 text-sm">
              {d.representative?.name ?? 'seat vacant'}
            </Text>
          </View>
          {d.districtId === mine?.districtId ? <Check size={16} color="#34D399" /> : null}
        </TouchableOpacity>
      ))}

      {/* The reason and the limit, in the moment somebody is deciding — and the
          text comes from the API so it cannot drift out of step with what the
          server actually does. */}
      {mine?.explanation ? (
        <View className="bg-slate-800/40 border border-slate-700 rounded-lg p-3 mt-3">
          <View className="flex-row items-center mb-1.5">
            <ShieldCheck size={14} color="#34D399" />
            <Text className="text-white font-medium ml-1.5">What this is for</Text>
          </View>
          {[
            mine.explanation.why,
            mine.explanation.collected,
            mine.explanation.shared,
            mine.explanation.optional,
          ].map((line) => (
            <Text key={line} className="text-slate-400 text-sm mb-1">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
