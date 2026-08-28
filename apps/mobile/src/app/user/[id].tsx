// Public profile — any user's profile and personal timeline (their own posts
// and shares), with follow and delegate actions. Web twin: webapp/src/pages/UserProfile.tsx
// Data: GET /api/users/:id, GET /api/posts?authorId=:id, POST /api/users/:id/follow,
// POST /api/delegations (server enforces earned delegate eligibility).
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Calendar,
  FileText,
  MapPin,
  ShieldCheck,
  MessageCircle,
  UserMinus,
  UserPlus,
  AlertCircle,
  Gavel,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/cn';
import { CommonGroundPanel } from '@/components/CivicPanels';
import { ImpeachmentRecord } from '@/components/ImpeachmentRecord';
import { DelegateAuditPanel } from '@/components/IntegrityAuditPanel';
import { TrustPanel } from '@/components/TrustPanel';
import { FindingsRecord } from '@/components/FindingsRecord';
import { FileAgainstDelegate } from '@/components/FileArticles';
import type { MyDelegation } from '@/lib/article-v';
import { useStartConversation } from '@/lib/api/messages';

interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  location: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
  isFollowing: boolean;
}

interface UserPost {
  id: string;
  content: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceTitle: string | null;
  commentsCount: number;
  likesCount: number;
  createdAt: string;
}

// The delegation shape comes from lib/article-v, which is also what the filing
// form takes. This file used to declare a narrower local copy with three of its
// fields, which was fine until the same object had to be handed to something
// that needed the rest of them.

function referenceRoute(post: UserPost): string {
  const id = post.referenceId ?? '';
  switch (post.referenceType) {
    case 'executive_order':
      return `/executive-order/${id}`;
    case 'scotus_case':
      return `/scotus/${id}`;
    default:
      return `/bill/${id}`;
  }
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const startConversation = useStartConversation();
  const queryClient = useQueryClient();
  const requireAuth = useRequireAuth();
  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === id;

  const { data: profile, isLoading } = useQuery({
    queryKey: ['public-user', id],
    queryFn: () => api.get<PublicUser>(`/api/users/${id}`),
    enabled: !!id,
  });

  const { data: postsData, isLoading: postsLoading } = useQuery({
    queryKey: ['public-user-posts', id],
    queryFn: () =>
      api.get<{ posts: UserPost[] }>(
        `/api/posts?authorId=${encodeURIComponent(id ?? '')}&limit=30`
      ),
    enabled: !!id,
  });

  const { data: mine } = useQuery({
    queryKey: ['my-delegations'],
    queryFn: () => api.get<{ delegations: MyDelegation[] }>('/api/delegations/me'),
    enabled: !isSelf,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['public-user', id] });
    queryClient.invalidateQueries({ queryKey: ['my-delegations'] });
  };

  const followMutation = useMutation({
    mutationFn: () => api.post<{ following: boolean }>(`/api/users/${id}/follow`),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    },
  });

  const myDelegation = (mine?.delegations ?? []).find(
    (d) => d.isActive && d.toUser.id === id
  );

  const delegateMutation = useMutation({
    mutationFn: () =>
      api.post<{ delegation: MyDelegation }>('/api/delegations', { toUserId: id }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
    },
    onError: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete<{ success: boolean }>(`/api/delegations/${myDelegation?.id}`),
    onSuccess: invalidate,
  });

  if (isLoading || !profile) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View className="flex-1 bg-slate-900 items-center justify-center">
          {isLoading ? (
            <ActivityIndicator size="large" color="#F59E0B" />
          ) : (
            <>
              <AlertCircle size={48} color="#EF4444" />
              <Text className="text-white text-lg mt-4">User not found</Text>
              <Pressable
                onPress={() => router.back()}
                className="mt-4 bg-slate-800 px-6 py-3 rounded-xl"
              >
                <Text className="text-white">Go Back</Text>
              </Pressable>
            </>
          )}
        </View>
      </>
    );
  }

  const posts = postsData?.posts ?? [];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0F172A', '#1E293B', '#0F172A']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={() => router.back()}
              className="bg-slate-800 p-2 rounded-full mr-3"
            >
              <ArrowLeft size={20} color="#fff" />
            </Pressable>
            <Text className="text-white font-semibold text-lg flex-1" numberOfLines={1}>
              @{profile.username}
            </Text>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
          >
            {/* Profile header */}
            <View className="items-center px-4 py-6">
              <Image
                source={{ uri: profile.avatar }}
                className="w-24 h-24 rounded-full border-4 border-amber-500/30"
              />
              <Text className="text-white font-bold text-xl mt-4">{profile.displayName}</Text>
              <Text className="text-slate-400">@{profile.username}</Text>
              {profile.bio ? (
                <Text className="text-slate-300 text-center mt-2 px-8">{profile.bio}</Text>
              ) : null}

              <View className="flex-row items-center mt-2">
                {profile.location ? (
                  <>
                    <MapPin size={14} color="#64748B" />
                    <Text className="text-slate-400 text-sm ml-1">{profile.location}</Text>
                    <Text className="text-slate-600 mx-2">·</Text>
                  </>
                ) : null}
                <Calendar size={14} color="#64748B" />
                <Text className="text-slate-400 text-sm ml-1">
                  Joined{' '}
                  {new Date(profile.joinedDate).toLocaleDateString('en-US', {
                    month: 'short',
                    year: 'numeric',
                  })}
                </Text>
              </View>

              <View className="flex-row mt-4">
                <View className="items-center mr-8">
                  <Text className="text-white font-bold text-lg">{profile.followers}</Text>
                  <Text className="text-slate-400 text-sm">Followers</Text>
                </View>
                <View className="items-center mr-8">
                  <Text className="text-white font-bold text-lg">{profile.following}</Text>
                  <Text className="text-slate-400 text-sm">Following</Text>
                </View>
                {/* A citizen's positions are public. That is the premise: this
                    platform asks for public positions on public business, and a
                    position nobody can look up is a poll answer. The count was
                    inert text and there was no route to the record behind it.
                    Web twin embeds the record in the profile; a phone has less
                    room, so this pushes to it. */}
                <Pressable
                  onPress={() => router.push(`/record?user=${id}`)}
                  className="items-center"
                >
                  <Text className="text-white font-bold text-lg">{profile.votesCount}</Text>
                  <Text className="text-slate-400 text-sm underline">Positions</Text>
                </Pressable>
              </View>

              {/* Actions */}
              {!isSelf ? (
                <View className="flex-row mt-5 w-full px-4">
                  <Pressable
                    onPress={() => {
                      if (!requireAuth('Sign in to follow people.')) return;
                      followMutation.mutate();
                    }}
                    disabled={followMutation.isPending}
                    className={cn(
                      'flex-1 flex-row items-center justify-center rounded-xl py-3 mr-2',
                      profile.isFollowing ? 'bg-slate-700' : 'bg-amber-500'
                    )}
                  >
                    {profile.isFollowing ? (
                      <UserMinus size={16} color="#CBD5E1" />
                    ) : (
                      <UserPlus size={16} color="#0F172A" />
                    )}
                    <Text
                      className={cn(
                        'font-semibold ml-1.5',
                        profile.isFollowing ? 'text-slate-300' : 'text-slate-900'
                      )}
                    >
                      {profile.isFollowing ? 'Unfollow' : 'Follow'}
                    </Text>
                  </Pressable>

                  {/* MESSAGE. There was no way to start a conversation with
                      somebody from their profile — the only route into a thread
                      was a thread that already existed, so two people who had
                      never spoken could not begin. The backend returns the
                      existing conversation when there is one, so this is safe
                      to press twice. Web twin: apps/web/src/pages/UserProfile.tsx. */}
                  <Pressable
                    onPress={() => {
                      if (!requireAuth('Sign in to send a message.')) return;
                      startConversation.mutate(
                        { participantId: id },
                        {
                          onSuccess: (data) =>
                            router.push(`/conversation/${data.conversation.id}`),
                        },
                      );
                    }}
                    disabled={startConversation.isPending}
                    className="flex-1 flex-row items-center justify-center rounded-xl py-3 mx-2 bg-slate-800 border border-slate-600"
                  >
                    <MessageCircle size={16} color="#94A3B8" />
                    <Text className="text-slate-200 font-semibold ml-1.5">Message</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      if (!requireAuth('Sign in to delegate your vote.')) return;
                      if (myDelegation) {
                        revokeMutation.mutate();
                      } else {
                        delegateMutation.mutate();
                      }
                    }}
                    disabled={delegateMutation.isPending || revokeMutation.isPending}
                    className="flex-1 flex-row items-center justify-center rounded-xl py-3 ml-2 bg-slate-800 border border-slate-600"
                  >
                    <ShieldCheck size={16} color="#22C55E" />
                    <Text className="text-slate-200 font-semibold ml-1.5">
                      {myDelegation ? 'Revoke delegation' : 'Delegate'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {delegateMutation.isError ? (
                <View className="mx-4 mt-3 bg-amber-900/30 border border-amber-700/40 rounded-xl p-3">
                  <Text className="text-amber-300 text-sm text-center">
                    This user hasn't earned delegate eligibility yet — delegates must be
                    routinely active (votes, posts, and recent activity).
                  </Text>
                </View>
              ) : null}
            </View>

            {/* ARTICLE V. Above everything else about them, because somebody
                deciding whether to lend this person their vote needs to know
                before they read the rest. Renders nothing for almost every
                profile. */}
            <ImpeachmentRecord userId={id} />

            {/* ARTICLE III §2, where the support actually is. Somebody weighing
                up whether to lend this person their vote can check the support
                they already carry, in counts, without seeing a single name. */}
            {/* THE TRUST SCORE. Everything it is made of, on the same
                panel — it exists to inform a decision, not to be believed. */}
            <TrustPanel userId={id} />

            <DelegateAuditPanel userId={id} />

            {/* BILL OF RIGHTS ARTICLE V. Beside the impeachment record, for
                the same reason: somebody deciding whether to lend this person
                their vote is entitled to know what a jury found about how
                they used one. */}
            <FindingsRecord userId={id} />

            {/* BRINGING PROCEEDINGS, WHERE THE PERSON IS.
                Only for somebody who currently delegates to them — the same
                bar the server enforces, and exactly the person entitled to
                bring it. Before this the only way in was a card on your own
                profile leading to a screen most people never open, so the
                remedy existed and could not be found. */}
            {myDelegation ? (
              <View className="px-4 pt-6">
                <View className="mb-2 flex-row items-center">
                  <Gavel size={16} color="#EF4444" />
                  <Text className="ml-2 text-sm font-semibold text-white">
                    You lend this person your vote
                  </Text>
                </View>
                <Text className="mb-3 text-xs leading-5 text-slate-400">
                  You can take it back on your own at any time, with the button above. Article V
                  is the other route: if you think everybody who lends to them should decide
                  together, file Articles of Impeachment and all of their current delegators vote
                  on it.
                </Text>
                <FileAgainstDelegate
                  delegation={myDelegation}
                  minLength={40}
                  maxLength={5000}
                  onFiled={() => router.push('/article-v')}
                />
              </View>
            ) : null}

            {/* Where the two of you actually agree — and where you do not.
                Above their timeline: knowing you are with somebody on three
                records changes how their posts read. */}
            {isSelf ? null : (
              <CommonGroundPanel userId={id} name={profile.displayName} />
            )}

            {/* Their timeline */}
            <View className="px-4">
              <Text className="text-white font-semibold text-lg mb-3">
                {isSelf ? 'Your timeline' : `${profile.displayName.split(' ')[0]}'s timeline`}
              </Text>
              {postsLoading ? (
                <ActivityIndicator size="small" color="#F59E0B" className="mt-4" />
              ) : posts.length === 0 ? (
                <View className="bg-slate-800/40 rounded-xl p-8 items-center border border-slate-700/30">
                  <Text className="text-slate-400">No posts yet</Text>
                </View>
              ) : (
                posts.map((post) => (
                  <View
                    key={post.id}
                    className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-3"
                  >
                    <Text className="text-slate-200">{post.content}</Text>
                    {post.referenceTitle ? (
                      <Pressable
                        onPress={() => router.push(referenceRoute(post))}
                        className="flex-row items-center mt-3 bg-slate-900/50 border border-slate-700/50 rounded-lg px-3 py-2"
                      >
                        <FileText size={14} color="#F59E0B" />
                        <Text className="text-slate-300 text-sm ml-2 flex-1" numberOfLines={1}>
                          {post.referenceTitle}
                        </Text>
                        <View className="bg-slate-700/60 px-2 py-0.5 rounded-full ml-2">
                          <Text className="text-slate-300 text-xs capitalize">
                            {(post.referenceType ?? 'bill').replace(/_/g, ' ')}
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                    <Text className="text-slate-500 text-xs mt-2">
                      {new Date(post.createdAt).toLocaleString()} · {post.likesCount} likes ·{' '}
                      {post.commentsCount} comments
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </>
  );
}
