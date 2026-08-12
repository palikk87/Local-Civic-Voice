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
  UserMinus,
  UserPlus,
  AlertCircle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';
import { useAuthStore } from '@/lib/auth-store';
import { cn } from '@/lib/cn';

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

interface MyDelegation {
  id: string;
  toUser: { id: string };
  isActive: boolean;
}

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
                <View className="items-center">
                  <Text className="text-white font-bold text-lg">{profile.votesCount}</Text>
                  <Text className="text-slate-400 text-sm">Votes</Text>
                </View>
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
