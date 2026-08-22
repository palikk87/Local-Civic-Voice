// The first five minutes: start from where you stand, not from who is popular.
// Web twin: apps/web/src/pages/StartHere.tsx
//
// Every social platform opens by asking a new arrival to pick five accounts to
// follow, ranked by size. That one screen does most of the damage everybody
// complains about later: it sorts a person into a camp before they have said
// anything, it rewards whoever is already loudest, and the feed it produces is
// a prediction about who they are rather than a record of what they think.
//
// This opens the other way round, because the platform has public records with
// public positions on them. Positions first; people second, chosen by whether
// they actually agreed, and shown in BOTH directions.
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ThumbsDown, ThumbsUp, Users } from 'lucide-react-native';

import { api } from '@/lib/api/api';

interface StarterRecord {
  id: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  category: string | null;
  status: string;
  support: number;
  oppose: number;
  contested: number;
}

interface Neighbour {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  bio: string | null;
  shared: number;
  agreed: number;
  disagreed: number;
  agreementPct: number | null;
}

interface NeighboursResponse {
  positions: number;
  needed: number;
  agree: Neighbour[];
  disagree: Neighbour[];
}

function avatarOf(person: { id: string; image: string | null }) {
  return person.image ?? `https://api.dicebear.com/7.x/avataaars/png?seed=${person.id}`;
}

function PersonRow({ person }: { person: Neighbour }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [followed, setFollowed] = useState(false);

  const follow = useMutation({
    mutationFn: () => api.post(`/api/users/${person.id}/follow`),
    onSuccess: () => {
      setFollowed(true);
      void queryClient.invalidateQueries({ queryKey: ['start-neighbours'] });
    },
    onError: () => Alert.alert("Couldn't follow them"),
  });

  return (
    <View className="flex-row items-start bg-slate-800/60 border border-slate-700/40 rounded-xl p-3 mb-2">
      <Pressable onPress={() => router.push(`/user/${person.id}`)}>
        <Image source={{ uri: avatarOf(person) }} className="w-10 h-10 rounded-full mr-3" />
      </Pressable>

      <View className="flex-1">
        <Pressable onPress={() => router.push(`/user/${person.id}`)}>
          <Text className="text-white font-medium">{person.name}</Text>
        </Pressable>
        <Text className="text-slate-400 text-xs">
          Agreed with you on {person.agreed} of {person.shared} records you both voted on
          {person.agreementPct === null ? '' : ` (${person.agreementPct}%)`}.
        </Text>
      </View>

      <Pressable
        disabled={followed || follow.isPending}
        onPress={() => follow.mutate()}
        className={`rounded-full px-3 py-1.5 ${followed ? 'bg-slate-700' : 'bg-amber-500'}`}
      >
        <Text className={`text-xs font-semibold ${followed ? 'text-slate-400' : 'text-slate-900'}`}>
          {followed ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function StartScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [voted, setVoted] = useState<Record<string, 'support' | 'oppose'>>({});

  const { data: starters, isLoading } = useQuery({
    queryKey: ['start-records'],
    queryFn: () => api.get<{ results: StarterRecord[] }>('/api/onboarding/records'),
  });

  const { data: people } = useQuery({
    queryKey: ['start-neighbours'],
    queryFn: () => api.get<NeighboursResponse>('/api/onboarding/neighbours'),
  });

  const vote = useMutation({
    mutationFn: ({ id, position }: { id: string; position: 'support' | 'oppose' }) =>
      api.post(`/api/government-references/${id}/vote`, { position }),
    onSuccess: (_result, variables) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setVoted((was) => ({ ...was, [variables.id]: variables.position }));
      void queryClient.invalidateQueries({ queryKey: ['start-neighbours'] });
    },
    onError: () => Alert.alert("Couldn't record that"),
  });

  const records = Array.isArray(starters?.results) ? starters.results : [];
  const agree = Array.isArray(people?.agree) ? people.agree : [];
  const disagree = Array.isArray(people?.disagree) ? people.disagree : [];

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Animated.View entering={FadeInDown.springify()}>
          <Text className="text-white text-2xl font-semibold">Start from where you stand</Text>
          <Text className="text-slate-400 text-sm mt-2">
            Most apps open by asking you to pick people to follow. This one asks what you think
            first, and finds the people afterwards — the ones who agreed with you and the ones who
            did not.
          </Text>
        </Animated.View>

        <Text className="text-amber-500 text-xs font-semibold uppercase tracking-wider mt-6">
          What the room is most split about
        </Text>
        <Text className="text-slate-500 text-xs mt-1">
          No wrong answers, and you can change any of these later — every position is kept, and so
          is every change of mind.
        </Text>

        {isLoading ? (
          <ActivityIndicator color="#F59E0B" className="mt-8" />
        ) : records.length === 0 ? (
          <View className="border border-dashed border-slate-700 rounded-xl p-6 mt-3">
            <Text className="text-slate-400 text-sm text-center">
              Nobody has voted on enough records yet for this to mean anything.
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/library')} className="mt-2">
              <Text className="text-amber-500 text-sm text-center">Go and find a law instead</Text>
            </Pressable>
          </View>
        ) : (
          records.map((record) => {
            const mine = voted[record.id];
            return (
              <View
                key={record.id}
                className="bg-slate-800/60 border border-slate-700/40 rounded-xl p-4 mt-3"
              >
                <Pressable onPress={() => router.push(`/bill/${record.id}`)}>
                  <Text className="text-white font-medium">{record.title}</Text>
                </Pressable>
                <Text className="text-slate-500 text-xs mt-0.5">
                  {record.support} for, {record.oppose} against so far.
                </Text>

                <View className="flex-row mt-3">
                  <Pressable
                    disabled={vote.isPending}
                    onPress={() => vote.mutate({ id: record.id, position: 'support' })}
                    className={`flex-row items-center rounded-full px-4 py-2 mr-2 ${
                      mine === 'support' ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <ThumbsUp size={16} color={mine === 'support' ? '#FFFFFF' : '#22C55E'} />
                    <Text
                      className={`ml-2 font-semibold ${
                        mine === 'support' ? 'text-white' : 'text-emerald-500'
                      }`}
                    >
                      Back it
                    </Text>
                  </Pressable>

                  <Pressable
                    disabled={vote.isPending}
                    onPress={() => vote.mutate({ id: record.id, position: 'oppose' })}
                    className={`flex-row items-center rounded-full px-4 py-2 ${
                      mine === 'oppose' ? 'bg-red-600' : 'bg-slate-700'
                    }`}
                  >
                    <ThumbsDown size={16} color={mine === 'oppose' ? '#FFFFFF' : '#EF4444'} />
                    <Text
                      className={`ml-2 font-semibold ${
                        mine === 'oppose' ? 'text-white' : 'text-red-500'
                      }`}
                    >
                      Oppose it
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}

        <View className="flex-row items-center mt-8">
          <Users size={16} color="#F59E0B" />
          <Text className="text-amber-500 text-xs font-semibold uppercase tracking-wider ml-2">
            Then the people
          </Text>
        </View>

        {people && people.needed > 0 ? (
          <Text className="text-slate-400 text-sm mt-1">
            Take {people.needed} more position{people.needed === 1 ? '' : 's'} and this fills in.
            Two shared votes is a coincidence; nobody should be introduced to you as a match on a
            coincidence.
          </Text>
        ) : agree.length === 0 && disagree.length === 0 ? (
          <Text className="text-slate-400 text-sm mt-1">
            Nobody else has voted on the same records yet. Come back once they have.
          </Text>
        ) : (
          <View className="mt-3">
            <Text className="text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
              With you most often
            </Text>
            {agree.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}

            {/* BOTH LISTS, ALWAYS. Offering only the agreements would build the
                echo chamber on the very first screen — which is exactly what a
                follow-the-popular-accounts onboarding does by accident. */}
            <Text className="text-rose-400 text-xs font-semibold uppercase tracking-wider mb-2 mt-4">
              Against you most often
            </Text>
            {disagree.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </View>
        )}

        <Pressable
          onPress={() => router.replace('/(tabs)')}
          className="flex-row items-center mt-8"
        >
          <Text className="text-amber-500 font-semibold mr-2">Go to the feed</Text>
          <ArrowRight size={16} color="#F59E0B" />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
