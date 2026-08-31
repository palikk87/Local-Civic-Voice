import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, UserPlus, TrendingUp, Clock, X } from 'lucide-react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';
import type { User } from '@/lib/types';
import { cn } from '@/lib/cn';
import * as Haptics from 'expo-haptics';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';

/**
 * People directory — real accounts from the shared backend, the same
 * /api/users endpoints the web app uses. Every list sends the caller's
 * follow state so cards render correctly.
 */
interface UsersListResponse {
  results: User[];
}

async function searchUsers(query: string): Promise<User[]> {
  if (!query.trim()) return [];
  const data = await api.get<UsersListResponse>(
    `/api/users/search?q=${encodeURIComponent(query)}&limit=20`
  );
  return data.results;
}

async function fetchSuggestedUsers(): Promise<User[]> {
  const data = await api.get<UsersListResponse>('/api/users/discover?limit=10');
  return data.results;
}

async function fetchActiveCitizens(): Promise<User[]> {
  const data = await api.get<UsersListResponse>('/api/users/active?limit=10');
  return data.results;
}

async function fetchNewMembers(): Promise<User[]> {
  const data = await api.get<UsersListResponse>('/api/users/new?limit=10');
  return data.results;
}

interface UserCardProps {
  user: User;
  currentUserId?: string;
  onPress: () => void;
  onFollowChange?: () => void;
}

function UserCard({ user, currentUserId, onPress, onFollowChange }: UserCardProps) {
  const requireAuth = useRequireAuth();
  const [isFollowing, setIsFollowing] = useState(user.isFollowing ?? false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFollowPress = async () => {
    // Guests get the sign-in sheet instead of a silent no-op.
    if (!requireAuth('Sign in to follow other citizens.')) return;

    setIsProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      if (isFollowing) {
        await api.delete(`/api/users/${user.id}/follow`);
        setIsFollowing(false);
      } else {
        await api.post(`/api/users/${user.id}/follow`);
        setIsFollowing(true);
      }
      onFollowChange?.();
    } catch (error) {
      console.error('Follow action failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Don't show follow button for own profile
  const showFollowButton = currentUserId !== user.id;

  return (
    <Pressable
      onPress={onPress}
      className="bg-slate-800 rounded-2xl p-4 mb-3 active:bg-slate-700"
    >
      <View className="flex-row items-center">
        <Image
          source={{ uri: user.avatar }}
          className="w-14 h-14 rounded-full bg-slate-700"
        />
        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold text-base" numberOfLines={1}>
            {user.displayName}
          </Text>
          <Text className="text-slate-400 text-sm" numberOfLines={1}>
            @{user.username}
          </Text>
          {user.bio && (
            <Text className="text-slate-300 text-xs mt-1" numberOfLines={2}>
              {user.bio}
            </Text>
          )}
        </View>
        <View className="items-end ml-2">
          {showFollowButton && (
            <Pressable
              onPress={handleFollowPress}
              disabled={isProcessing}
              className={cn(
                'rounded-full px-4 py-2 flex-row items-center',
                isFollowing ? 'bg-slate-600' : 'bg-amber-500'
              )}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={isFollowing ? '#F59E0B' : '#0C1D18'} />
              ) : (
                <>
                  {!isFollowing && <UserPlus size={14} color="#0C1D18" strokeWidth={2.5} />}
                  <Text
                    className={cn(
                      'font-semibold text-sm',
                      isFollowing ? 'text-white' : 'text-slate-900 ml-1'
                    )}
                  >
                    {isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </>
              )}
            </Pressable>
          )}
          <Text className="text-slate-500 text-xs mt-2">
            {(user.followers ?? 0).toLocaleString()} followers
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

function SectionHeader({ icon, title, subtitle }: SectionHeaderProps) {
  return (
    <View className="flex-row items-center mb-4 mt-6">
      <View className="bg-slate-700 rounded-full p-2 mr-3">{icon}</View>
      <View>
        <Text className="text-white font-bold text-lg">{title}</Text>
        {subtitle && <Text className="text-slate-400 text-xs">{subtitle}</Text>}
      </View>
    </View>
  );
}

export default function PeopleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Better Auth is the only session on this app. This previously read the
  // dormant Supabase context, which is never populated, so currentUserId was
  // permanently undefined: the signed-in user saw a Follow button on their own
  // card, and every user's suggestions collapsed into the one cache entry
  // keyed on ['suggestedUsers', undefined].
  const { user } = useCurrentUser();
  const currentUserId = user?.id;
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: suggestedUsers,
    isLoading: suggestedLoading,
    refetch: refetchSuggested,
  } = useQuery<User[]>({
    queryKey: ['suggestedUsers', currentUserId],
    queryFn: fetchSuggestedUsers,
  });

  const {
    data: activeCitizens,
    isLoading: activeLoading,
    refetch: refetchActive,
  } = useQuery<User[]>({
    queryKey: ['activeCitizens', currentUserId],
    queryFn: fetchActiveCitizens,
  });

  const {
    data: newMembers,
    isLoading: newMembersLoading,
    refetch: refetchNew,
  } = useQuery<User[]>({
    queryKey: ['newMembers', currentUserId],
    queryFn: fetchNewMembers,
  });

  const {
    data: searchResults,
    isLoading: searchLoading,
    refetch: refetchSearch,
  } = useQuery<User[]>({
    queryKey: ['searchUsers', searchQuery, currentUserId],
    queryFn: () => searchUsers(searchQuery),
    enabled: searchQuery.length > 0,
  });

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetchSuggested(), refetchActive(), refetchNew()]);
    if (searchQuery) {
      await refetchSearch();
    }
    setIsRefreshing(false);
  }, [refetchSuggested, refetchActive, refetchNew, refetchSearch, searchQuery]);

  const handleUserPress = (userId: string) => {
    router.push(`/user/${userId}`);
  };

  const handleFollowChange = () => {
    // Invalidate queries to refresh follow states
    queryClient.invalidateQueries({ queryKey: ['suggestedUsers'] });
    queryClient.invalidateQueries({ queryKey: ['activeCitizens'] });
    queryClient.invalidateQueries({ queryKey: ['newMembers'] });
  };

  const isSearching = searchQuery.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-900" edges={['top']}>
      <View className="px-4 pt-2 pb-4">
        <Text className="text-white text-2xl font-bold mb-4">Discover Citizens</Text>

        {/* Search Bar */}
        <View className="bg-slate-800 rounded-xl flex-row items-center px-4 py-3">
          <Search size={20} color="#6E8A7C" strokeWidth={2} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by name or username..."
            placeholderTextColor="#6E8A7C"
            className="flex-1 text-white text-base ml-3"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} className="p-1">
              <X size={18} color="#6E8A7C" strokeWidth={2} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#F59E0B"
            colors={['#F59E0B']}
          />
        }
      >
        {/* Search Results */}
        {isSearching && (
          <View>
            <Text className="text-slate-400 text-sm mb-3">
              {searchLoading
                ? 'Searching...'
                : `${searchResults?.length ?? 0} results for "${searchQuery}"`}
            </Text>
            {searchLoading ? (
              <View className="py-8 items-center">
                <ActivityIndicator size="large" color="#F59E0B" />
              </View>
            ) : searchResults && searchResults.length > 0 ? (
              searchResults.map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  onPress={() => handleUserPress(user.id)}
                  onFollowChange={handleFollowChange}
                />
              ))
            ) : (
              <View className="py-8 items-center">
                <Text className="text-slate-400 text-center">
                  No users found matching your search.
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Main Sections (shown when not searching) */}
        {!isSearching && (
          <>
            {/* Suggested For You */}
            <SectionHeader
              icon={<UserPlus size={18} color="#F59E0B" strokeWidth={2} />}
              title="Suggested For You"
              subtitle="Citizens you might know"
            />
            {suggestedLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator size="large" color="#F59E0B" />
              </View>
            ) : suggestedUsers && suggestedUsers.length > 0 ? (
              suggestedUsers.slice(0, 3).map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  onPress={() => handleUserPress(user.id)}
                  onFollowChange={handleFollowChange}
                />
              ))
            ) : (
              <View className="bg-slate-800 rounded-2xl p-6 items-center">
                <Text className="text-slate-400 text-center">
                  No suggestions available right now.
                </Text>
              </View>
            )}

            {/* Active Citizens */}
            <SectionHeader
              icon={<TrendingUp size={18} color="#22C55E" strokeWidth={2} />}
              title="Active Citizens"
              subtitle="Most engaged community members"
            />
            {activeLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator size="large" color="#F59E0B" />
              </View>
            ) : activeCitizens && activeCitizens.length > 0 ? (
              activeCitizens.slice(0, 3).map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  onPress={() => handleUserPress(user.id)}
                  onFollowChange={handleFollowChange}
                />
              ))
            ) : (
              <View className="bg-slate-800 rounded-2xl p-6 items-center">
                <Text className="text-slate-400 text-center">No active citizens to show.</Text>
              </View>
            )}

            {/* New Members */}
            <SectionHeader
              icon={<Clock size={18} color="#3B82F6" strokeWidth={2} />}
              title="New Members"
              subtitle="Recently joined the community"
            />
            {newMembersLoading ? (
              <View className="py-6 items-center">
                <ActivityIndicator size="large" color="#F59E0B" />
              </View>
            ) : newMembers && newMembers.length > 0 ? (
              newMembers.slice(0, 3).map((user) => (
                <UserCard
                  key={user.id}
                  user={user}
                  currentUserId={currentUserId}
                  onPress={() => handleUserPress(user.id)}
                  onFollowChange={handleFollowChange}
                />
              ))
            ) : (
              <View className="bg-slate-800 rounded-2xl p-6 items-center">
                <Text className="text-slate-400 text-center">No new members to show.</Text>
              </View>
            )}

            {/* Bottom spacing */}
            <View className="h-8" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
