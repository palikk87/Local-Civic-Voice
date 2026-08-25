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
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
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

export function DistrictPicker({ onChange }: { onChange?: (id: string | null) => void }) {
  const [options, setOptions] = useState<DistrictOption[]>([]);
  const [mine, setMine] = useState<Mine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

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
        <MapPin size={16} color="#94A3B8" />
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

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search by state, district, or representative"
        placeholderTextColor="#64748B"
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
