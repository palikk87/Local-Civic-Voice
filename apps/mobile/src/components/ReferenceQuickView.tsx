/**
 * THE WHOLE LAW, WITHOUT LEAVING THE SEARCH.
 *
 * Web twin: apps/web/src/components/civic/ReferenceQuickView.tsx
 *
 * A search result is a title and a number, which is not enough to know whether
 * it is the law you meant. This opens the record's own detail — who is behind
 * it and their face, the bench where a ruling has one, its dates, what we hold
 * on it, and the brief if one has been written — over the results, so a reader
 * can look and go back to looking.
 *
 * IT DOES NOT REPLACE THE PAGE. Voting, the conversation, the audit and the
 * pulse live on the record's own screen, and the footer goes there. This is for
 * deciding whether to. Khalid: "keep the see details as a pop up rather than
 * opening the law card on a new page it maintains continuity."
 *
 * IT ASKS FOR NOTHING THAT COSTS MONEY. A brief already written is shown; one
 * that has not been is not commissioned from here — that is a button on the
 * full page, and a decision a person makes.
 */
import { useState } from 'react';
import { View, Text, Image, Modal, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, ExternalLink } from 'lucide-react-native';

import { RecordBadge } from '@/components/civic/RecordBadge';
import { useGovernmentReference } from '@/lib/api/references';

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
}

function Face({ uri, name, size }: { uri?: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="bg-slate-700 items-center justify-center"
      >
        <Text className="text-slate-300 text-[10px] font-medium">{initials(name)}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
    />
  );
}

function longDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function ReferenceQuickView({
  referenceId,
  onClose,
}: {
  referenceId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { data, isLoading, isError } = useGovernmentReference(
    referenceId ?? undefined,
    !!referenceId,
  );
  const reference = data?.reference;

  const typeLabel =
    reference?.referenceType === 'executive_order'
      ? 'Executive order'
      : reference?.referenceType === 'scotus_case'
        ? 'Supreme Court case'
        : 'Bill';

  const dates = [
    ['Introduced', longDate(reference?.introducedDate)],
    ['Signed', longDate(reference?.signedDate)],
    ['Decided', longDate(reference?.decidedDate)],
    ['Last action', longDate(reference?.lastActionDate)],
  ].filter((row): row is [string, string] => typeof row[1] === 'string');

  // Where the full record lives. The phone still has one screen per branch.
  const fullRecord =
    reference?.referenceType === 'executive_order'
      ? `/executive-order/${reference.id}`
      : reference?.referenceType === 'scotus_case'
        ? `/scotus/${reference.id}`
        : `/bill/${reference?.id}`;

  return (
    <Modal
      visible={!!referenceId}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/60 justify-end">
        <SafeAreaView edges={['bottom']} className="bg-slate-900 rounded-t-3xl max-h-[85%]">
          <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
            <Text className="text-slate-400 text-sm">Record details</Text>
            <Pressable onPress={onClose} hitSlop={8} className="p-1">
              <X size={20} color="#94A3B8" />
            </Pressable>
          </View>

          <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 24 }}>
            {isLoading ? (
              <View className="py-10 items-center">
                <ActivityIndicator color="#F59E0B" />
                <Text className="text-slate-400 text-sm mt-3">Loading the record…</Text>
              </View>
            ) : isError || !reference ? (
              <Text className="text-slate-400 text-sm py-10">
                We couldn&apos;t load this record. It may have been merged into another one.
              </Text>
            ) : (
              <>
                <View className="flex-row flex-wrap items-center">
                  <View className="px-1.5 py-0.5 rounded bg-slate-700 mr-2 mb-1">
                    <Text className="text-slate-200 text-[11px] font-medium uppercase">
                      {typeLabel}
                    </Text>
                  </View>
                  <Text className="text-slate-400 text-xs mr-2 mb-1">
                    {reference.displayId}
                  </Text>
                  {reference.completeness ? (
                    <View className="mb-1">
                      <RecordBadge completeness={reference.completeness} />
                    </View>
                  ) : null}
                </View>

                <Text className="text-white text-xl font-semibold mt-1">
                  {reference.title}
                </Text>

                {reference.attribution ? (
                  <View className="flex-row items-center bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 mt-4">
                    <Face
                      uri={reference.attribution.photoUrl}
                      name={reference.attribution.name}
                      size={40}
                    />
                    <Text className="text-white text-sm font-medium ml-3 flex-1">
                      {reference.attribution.role} {reference.attribution.name}
                    </Text>
                  </View>
                ) : null}

                {/*
                  THE BENCH, WITH FACES — the same thing the record screen shows.
                  A bill or an order has one person and gets their portrait; the
                  Court has nine and must not get none, which is exactly
                  backwards for the branch that needed it most. Every justice
                  since 1789 is held on our own server, so these cost nothing.
                */}
                {reference.attribution?.panel?.length ? (
                  <View className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 mt-3">
                    <Text className="text-slate-400 text-xs uppercase">
                      {reference.attribution.panelLabel}
                    </Text>
                    <View className="flex-row flex-wrap mt-3">
                      {reference.attribution.panel.map((justice) => (
                        <View key={justice.name} className="w-1/4 items-center mb-3 px-1">
                          <Face uri={justice.photoUrl} name={justice.name} size={40} />
                          <Text className="text-slate-400 text-[10px] text-center mt-1">
                            {justice.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                {dates.length > 0 ? (
                  <View className="flex-row flex-wrap mt-4">
                    {dates.map(([label, value]) => (
                      <View key={label} className="w-1/2 mb-3">
                        <Text className="text-slate-500 text-xs">{label}</Text>
                        <Text className="text-white text-sm">{value}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {reference.citizenBriefSections?.summary ? (
                  <View className="mt-2">
                    <Text className="text-slate-500 text-xs uppercase mb-1">
                      Citizen&apos;s Brief
                    </Text>
                    <Text className="text-white text-sm leading-relaxed">
                      {reference.citizenBriefSections.summary}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-slate-400 text-sm mt-2">
                    No Citizen&apos;s Brief has been written for this record yet. Open the
                    full page to ask for one.
                  </Text>
                )}

                <Pressable
                  onPress={() => {
                    onClose();
                    router.push(fullRecord as never);
                  }}
                  className="flex-row items-center justify-center bg-amber-500 rounded-xl py-3 mt-5"
                >
                  <Text className="text-slate-900 font-semibold mr-2">
                    Open the full record
                  </Text>
                  <ExternalLink size={16} color="#0F172A" />
                </Pressable>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
