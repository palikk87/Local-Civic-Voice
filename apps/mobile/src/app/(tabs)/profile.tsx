import React, { useMemo, useState } from 'react';
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
import { useRouter } from 'expo-router';
import {
  Settings,
  ThumbsUp,
  ThumbsDown,
  Calendar,
  MapPin,
  Users,
  Award,
  ChevronRight,
  TrendingUp,
  Bookmark,
  LogOut,
  UserCheck,
  Shield,
  Scroll,
  BookOpen,
  BarChart3,
  Scale,
  Pencil,
} from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { categoryColors, categoryLabels } from '@/lib/mock-data';
import { useVotingStore } from '@/lib/voting-store';
import { useAuthStore } from '@/lib/auth-store';
import { useAdminStore } from '@/lib/admin-store';
import { usePermissions, useCurrentUser } from '@/lib/auth/use-civic-auth';
import { cn } from '@/lib/cn';
import { useUserVoteHistory } from '@/lib/hooks';
import type { Bill, BillCategory } from '@/lib/types';
import type { VoteWithBill } from '@/lib/database.types';
import { AuthGate } from '@/components/auth/AuthGate';
import { ImpeachmentRecord } from '@/components/ImpeachmentRecord';
import { DelegateAuditPanel } from '@/components/IntegrityAuditPanel';
import { TrustPanel } from '@/components/TrustPanel';
import { FindingsRecord } from '@/components/FindingsRecord';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/api';
import { authClient } from '@/lib/auth/auth-client';
import { BACKEND_URL } from '@/lib/config';
import * as SecureStore from 'expo-secure-store';

// Where the Better Auth expo plugin keeps the session (see auth-client.ts:
// storagePrefix "civic"). Sign-out clears these directly so the phone ends up
// signed out even if the network call to the server fails or is rate-limited.
const SESSION_STORAGE_KEYS = ['civic_cookie', 'civic_session_data'];

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <View
      className="flex-1 rounded-xl p-3 border"
      style={{
        backgroundColor: `${color}15`,
        borderColor: `${color}30`,
      }}
    >
      <View className="flex-row items-center mb-1">
        {icon}
        <Text className="text-xs ml-1.5 font-medium" style={{ color }}>
          {label}
        </Text>
      </View>
      <Text className="text-white font-bold text-xl">{value}</Text>
    </View>
  );
}

function VoteHistoryCard({
  billId,
  vote,
  index,
  bill,
}: {
  billId: string;
  vote: 'yea' | 'nay';
  index: number;
  bill?: Bill | null;
}) {
  const router = useRouter();

  // Fall back to mock bill if not provided
  // No bill, no card. This used to fall back to a hardcoded array, so a vote on
  // a bill the API could not return rendered as a vote on an invented one.
  const displayBill = bill;

  if (!displayBill) return null;

  const categoryColor = categoryColors[displayBill.category] ?? '#6E8A7C';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).springify()}
      className="mb-3"
    >
      <Pressable
        onPress={() => router.push(`/bill/${displayBill.id}`)}
        className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40"
      >
        <View className="flex-row items-start">
          <View
            className={cn(
              'w-10 h-10 rounded-full items-center justify-center mr-3',
              vote === 'yea' ? 'bg-emerald-900/60' : 'bg-red-900/60'
            )}
          >
            {vote === 'yea' ? (
              <ThumbsUp size={18} color="#22C55E" />
            ) : (
              <ThumbsDown size={18} color="#EF4444" />
            )}
          </View>

          <View className="flex-1">
            <View className="flex-row items-center mb-1">
              <View
                className="px-2 py-0.5 rounded-full mr-2"
                style={{ backgroundColor: `${categoryColor}30` }}
              >
                <Text style={{ color: categoryColor }} className="text-xs font-medium">
                  {categoryLabels[displayBill.category]}
                </Text>
              </View>
              <View
                className={cn(
                  'px-2 py-0.5 rounded-full',
                  vote === 'yea' ? 'bg-emerald-900/60' : 'bg-red-900/60'
                )}
              >
                <Text
                  className={cn(
                    'text-xs font-medium',
                    vote === 'yea' ? 'text-emerald-400' : 'text-red-400'
                  )}
                >
                  {vote === 'yea' ? 'YEA' : 'NAY'}
                </Text>
              </View>
            </View>

            <Text className="text-white font-semibold" numberOfLines={1}>
              {displayBill.shortTitle}
            </Text>
            <Text className="text-slate-400 text-sm" numberOfLines={1}>
              {displayBill.title}
            </Text>
          </View>

          <ChevronRight size={20} color="#6E8A7C" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

function AchievementBadge({
  title,
  description,
  icon,
  earned,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  earned: boolean;
}) {
  return (
    <View
      className={cn(
        'items-center p-3 rounded-xl mr-3 border',
        earned
          ? 'bg-amber-900/30 border-amber-700/50'
          : 'bg-slate-800/40 border-slate-700/30'
      )}
      style={{ width: 100 }}
    >
      <View
        className={cn(
          'w-12 h-12 rounded-full items-center justify-center mb-2',
          earned ? 'bg-amber-500/30' : 'bg-slate-700/50'
        )}
      >
        {icon}
      </View>
      <Text
        className={cn(
          'text-xs font-semibold text-center',
          earned ? 'text-amber-400' : 'text-slate-500'
        )}
      >
        {title}
      </Text>
      <Text
        className={cn(
          'text-xs text-center mt-0.5',
          earned ? 'text-amber-500/70' : 'text-slate-600'
        )}
      >
        {description}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  return (
    <AuthGate capability="viewProfile" reason="Sign in to view your profile and civic record.">
      <ProfileContent />
    </AuthGate>
  );
}

function ProfileContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Auth — Better Auth only.
  //
  // This used to branch on isSupabaseConfigured() and read a Supabase profile
  // when the flag was on. That made one flag swap both the data source AND the
  // identity, which is why web and mobile could disagree about who was signed
  // in. The flag now gates data alone; identity always comes from Better Auth,
  // mirrored into the store by SessionBridge.
  const storedUser = useAuthStore((s) => s.user);
  const storeSignOut = useAuthStore((s) => s.signOut);
  const { user: sessionUser, isAuthenticated, isLoading: sessionLoading } = useCurrentUser();
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  const user = storedUser;

  /*
   * THE VOTE COUNTS COME FROM THE SERVER NOW.
   *
   * They were read from `voting-store`, a zustand store persisted to this
   * device. So the three numbers on a person's own profile — Aye, Nay, Total —
   * described one phone. Sign in on the web after voting all week here and the
   * profile said you had never voted, on a platform whose entire subject is the
   * record of what you have stood for.
   *
   * `/api/users/:id/positions` is where positions actually live; it is the same
   * source the record screen reads, so the headline numbers and the list behind
   * "Your record" can no longer disagree. Web twin: apps/web/src/pages/Profile.tsx.
   */
  const { data: positions } = useQuery({
    queryKey: ['positions', sessionUser?.id ?? ''],
    queryFn: () =>
      api.get<{ summary: { total: number; support: number; oppose: number } }>(
        `/api/users/${sessionUser?.id}/positions`,
      ),
    enabled: Boolean(sessionUser?.id),
  });

  // The real count, from the server that holds them. This used to read a
  // device-only store that nothing ever filled, so a citizen who had lent their
  // voice to three people was told they had none.
  // THE REAL COUNTS, FROM THE SERVER.
  //
  // These used to come off `user`, built by signed-in-identity.ts, which sets
  // `followers: 0` as a literal because a session carries no such field. So the
  // profile showed zero followers and zero following forever, whatever the
  // database held — following was working; the display was a constant.
  const { data: liveProfile } = useQuery({
    queryKey: ['users', user?.id ?? ''],
    queryFn: () =>
      api.get<{ followers: number; following: number; votesCount: number }>(
        `/api/users/${user?.id}`,
      ),
    enabled: !!user?.id,
  });

  const followerCount = liveProfile?.followers ?? 0;
  const followingCount = liveProfile?.following ?? 0;

  const { data: myDelegations } = useQuery({
    queryKey: ['my-delegations'],
    queryFn: () => api.get<{ activeCount: number }>('/api/delegations/me'),
    enabled: Boolean(sessionUser),
  });
  const activeDelegationsCount = myDelegations?.activeCount ?? 0;

  // Portal entry points, decided by the signed-in ACCOUNT's role.
  //
  // This used to read persisted flags — `isAdminAuthenticated` from the admin
  // store and `isAuthenticated` from the B2B store — neither of which is ever
  // reconciled against the citizen in front of them. Once anybody had signed
  // into either portal on a device, every later user of that device saw both
  // cards on their own profile. It also unlocked them for one hardcoded
  // username, which is an account identifier committed to a public repository.
  const { isStaff } = usePermissions();

  /**
   * The business account this person holds, if any.
   * Web twin: apps/web/src/pages/Profile.tsx.
   *
   * Self only — there is no endpoint that answers this about anybody else, on
   * purpose. Whether a citizen runs a research firm or a campaign is not a
   * public fact about them.
   */
  const { data: business } = useQuery({
    queryKey: ['me', 'business-account'],
    queryFn: async () => {
      const response = await fetch(`${BACKEND_URL}/api/users/me/business-account`, {
        headers: { Cookie: authClient.getCookie() },
      });
      // ONE BIT, AND THE ENDPOINT SENDS NOTHING ELSE. It used to return the
      // username, business name and tier. A B2B login is username plus
      // password, so putting the username on a page people leave open and
      // screenshot gave away half the pair for free.
      if (!response.ok) return { hasBusinessAccount: false };
      return (await response.json()) as { hasBusinessAccount: boolean };
    },
    staleTime: 5 * 60_000,
    // A failure is silent by design: no card is the honest answer when we
    // could not ask.
    retry: false,
  });
  const hasBusinessAccount = business?.hasBusinessAccount ?? false;

  /**
   * Whether this account carries an administrative role.
   * Web twin: apps/web/src/pages/Profile.tsx.
   *
   * Read from the CITIZEN account rather than the console session — somebody
   * who holds a role but has not signed into the console yet was shown no way
   * to reach it.
   */
  const { data: adminData } = useQuery({
    queryKey: ['me', 'admin-access'],
    queryFn: async () => {
      const response = await fetch(`${BACKEND_URL}/api/users/me/admin-access`, {
        headers: { Cookie: authClient.getCookie() },
      });
      if (!response.ok) return { adminAccess: null };
      return (await response.json()) as {
        adminAccess: { role: string; name: string } | null;
      };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const adminAccess = adminData?.adminAccess ?? null;

  const yeaVotes = positions?.summary.support ?? 0;
  const nayVotes = positions?.summary.oppose ?? 0;
  const totalVotes = positions?.summary.total ?? 0;

  const handleSignOut = async () => {
    // One tap = one sign-out. Without this the button fired again on every tap while
    // the first request was still in flight, which tripped the auth rate limiter and
    // left the session alive.
    if (isSigningOut) return;
    setIsSigningOut(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // End the real Better Auth session (the one the backend checks), then clear the
    // local mirror. Same outcome as the web app's sign-out.
    try {
      await authClient.signOut();
    } catch {
      // Server said no (already signed out, offline, rate-limited) — we still sign
      // out locally below, so the app never gets stuck in a half-signed-in state.
    }
    await Promise.all(
      SESSION_STORAGE_KEYS.map((key) => SecureStore.deleteItemAsync(key).catch(() => {})),
    );
    storeSignOut();
    queryClient.clear();
    await queryClient.invalidateQueries();
    setIsSigningOut(false);
    router.replace('/(tabs)');
  };

  const handleOpenSettings = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/notification-settings');
  };

  /*
   * ACHIEVEMENTS, AND WHAT THEY ACTUALLY MEASURE.
   *
   * Two problems, both from the audit in docs/BADGE_AUDIT.md.
   *
   * "5 followers" read `user.followers`, and `user` here is built by the auth
   * store, which carries no such field — so it was always undefined, always
   * fell through to 0, and that achievement could never be earned by anybody,
   * whatever the database held. The live count is in `liveProfile`, and was
   * already being displayed a few lines above.
   *
   * The vote thresholds read a device-local store until this week; they read
   * the server now, which is what makes them mean anything on a second device.
   *
   * These four are ALSO not the badge system. gamification.ts declares its own
   * nineteen with different names and different thresholds, and nothing in
   * either app renders that list. Consolidating the two is a decision, not a
   * cleanup, and it is written up rather than made here.
   * Web twin: apps/web/src/pages/Profile.tsx.
   */
  const achievements = [
    {
      title: 'First Vote',
      description: 'Cast your first vote',
      icon: <ThumbsUp size={20} color={totalVotes > 0 ? '#F59E0B' : '#6E8A7C'} />,
      earned: totalVotes > 0,
    },
    {
      title: 'Voice Heard',
      description: '10 votes cast',
      icon: <TrendingUp size={20} color={totalVotes >= 10 ? '#F59E0B' : '#6E8A7C'} />,
      earned: totalVotes >= 10,
    },
    {
      title: 'Civic Hero',
      description: '50 votes cast',
      icon: <Award size={20} color={totalVotes >= 50 ? '#F59E0B' : '#6E8A7C'} />,
      earned: totalVotes >= 50,
    },
    {
      title: 'Engaged',
      description: '5 followers',
      icon: <Users size={20} color={followerCount >= 5 ? '#F59E0B' : '#6E8A7C'} />,
      earned: followerCount >= 5,
    },
  ];

  if (!user) {
    // No profile yet. Only a spinner while the session is still resolving — once it
    // says "signed out", AuthGate above shows the sign-in wall, so spinning here
    // forever (the old behaviour after sign-out) would just hide it.
    const stillResolving = sessionLoading || (isAuthenticated && !isSigningOut);
    if (!stillResolving) return null;

    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text className="text-slate-400 mt-4">
          {isSigningOut ? 'Signing out...' : 'Loading profile...'}
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-2xl font-bold text-white">Profile</Text>
          <View className="flex-row items-center">
            <Pressable
              onPress={handleSignOut}
              disabled={isSigningOut}
              accessibilityLabel="Sign out"
              className={cn(
                'bg-red-900/40 p-2 rounded-full mr-2',
                isSigningOut && 'opacity-50',
              )}
            >
              {isSigningOut ? (
                <ActivityIndicator size="small" color="#EF4444" />
              ) : (
                <LogOut size={20} color="#EF4444" />
              )}
            </Pressable>
            {/* Editing an account was impossible: the endpoint existed and
                nothing but the signup form ever called it, so a name was
                whatever it was on the day the account was made. */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/edit-profile');
              }}
              accessibilityLabel="Edit profile"
              className="bg-slate-800 p-2 rounded-full mr-2"
            >
              <Pencil size={20} color="#6E8A7C" />
            </Pressable>
            <Pressable
              onPress={handleOpenSettings}
              accessibilityLabel="Settings"
              className="bg-slate-800 p-2 rounded-full"
            >
              <Settings size={22} color="#6E8A7C" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        >
          {/* Profile Header */}
          <View className="items-center px-4 py-6">
            <View className="relative">
              <Image
                source={{ uri: user.avatar }}
                className="w-24 h-24 rounded-full border-4 border-amber-500/30"
              />
              <View className="absolute -bottom-1 -right-1 bg-amber-500 w-8 h-8 rounded-full items-center justify-center border-4 border-slate-900">
                <Text className="text-slate-900 font-bold text-xs">
                  {totalVotes}
                </Text>
              </View>
            </View>

            <Text className="text-white font-bold text-xl mt-4">
              {user.displayName}
            </Text>
            <Text className="text-slate-400">@{user.username}</Text>

            {user.bio ? (
              <Text className="text-slate-300 text-center mt-2 px-8">
                {user.bio}
              </Text>
            ) : null}

            <View className="flex-row items-center mt-2">
              <MapPin size={14} color="#6E8A7C" />
              <Text className="text-slate-400 text-sm ml-1">
                {user.location}
              </Text>
              <Text className="text-slate-600 mx-2">·</Text>
              <Calendar size={14} color="#6E8A7C" />
              <Text className="text-slate-400 text-sm ml-1">
                Joined {new Date(user.joinedDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </Text>
            </View>

            {/* Follow Stats */}
            <View className="flex-row mt-4">
              <Pressable className="items-center mr-6">
                <Text className="text-white font-bold text-lg">
                  {followerCount}
                </Text>
                <Text className="text-slate-400 text-sm">Followers</Text>
              </Pressable>
              <Pressable className="items-center">
                <Text className="text-white font-bold text-lg">
                  {followingCount}
                </Text>
                <Text className="text-slate-400 text-sm">Following</Text>
              </Pressable>
            </View>
          </View>

          {/* Stats */}
          <View className="flex-row px-4 mb-6">
            <StatCard
              icon={<ThumbsUp size={14} color="#22C55E" />}
              label="Aye Votes"
              value={yeaVotes}
              color="#22C55E"
            />
            <View className="w-2" />
            <StatCard
              icon={<ThumbsDown size={14} color="#EF4444" />}
              label="Nay Votes"
              value={nayVotes}
              color="#EF4444"
            />
            <View className="w-2" />
            <StatCard
              icon={<Award size={14} color="#F59E0B" />}
              label="Total"
              value={totalVotes}
              color="#F59E0B"
            />
          </View>

          {/* Founding Documents */}
          <View className="px-4 mb-6">
            <Text className="text-white font-semibold text-lg mb-3">
              Founding Documents
            </Text>

            {/* Constitution Card */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/constitution');
              }}
              className="rounded-xl overflow-hidden border border-slate-600/30 mb-3"
            >
              <LinearGradient
                colors={['#2C4A3C', '#17362A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="w-12 h-12 rounded-full bg-slate-500/20 items-center justify-center mr-3">
                      <BookOpen size={24} color="#8FA79A" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-slate-100 font-semibold text-lg">
                        Constitution
                      </Text>
                      <Text className="text-slate-400 text-sm">
                        The supreme law of the platform
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#8FA79A" />
                </View>
              </LinearGradient>
            </Pressable>

            {/* Bill of Rights Card */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/bill-of-rights');
              }}
              className="rounded-xl overflow-hidden border border-amber-700/30"
            >
              <LinearGradient
                colors={['#78350f', '#451a03']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="w-12 h-12 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                      <Scroll size={24} color="#FCD34D" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-amber-100 font-semibold text-lg">
                        Bill of Rights
                      </Text>
                      <Text className="text-amber-300/70 text-sm">
                        Your individual protections
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#FCD34D" />
                </View>
              </LinearGradient>
            </Pressable>

            {/* Article V - Self-Correction Card */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/article-v');
              }}
              className="rounded-xl overflow-hidden border border-red-700/30 mt-3"
            >
              <LinearGradient
                colors={['#7F1D1D', '#450A0A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="w-12 h-12 rounded-full bg-red-500/20 items-center justify-center mr-3">
                      <Shield size={24} color="#FCA5A5" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-red-100 font-semibold text-lg">
                        Article V: Self-Correction
                      </Text>
                      <Text className="text-red-300/70 text-sm">
                        Impeachment & System Reset
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#FCA5A5" />
                </View>
              </LinearGradient>
            </Pressable>
          </View>

          {/* ARTICLE V, on your own profile too. Somebody who has been
              impeached sees exactly what everybody else sees about it, in the
              same words. A finding hidden from the person it is about is a
              finding they cannot answer. */}
          {sessionUser?.id ? <ImpeachmentRecord userId={sessionUser.id} /> : null}

          {/* ARTICLE III §2, on yourself. A leader can audit their own support
              whenever they want and the result is kept, so a clean history is
              something they can point at — and a stacked one is something they
              find out about before anybody else does. */}
          {/* THE TRUST SCORE, on your own profile too — the same number
              everybody else can see, with the same working shown. */}
          {sessionUser?.id ? <TrustPanel userId={sessionUser.id} /> : null}

          {sessionUser?.id ? <DelegateAuditPanel userId={sessionUser.id} /> : null}

          {/* BILL OF RIGHTS ARTICLE V, on your own profile too. A finding
              hidden from the person it is about is a finding they cannot
              answer. */}
          {sessionUser?.id ? <FindingsRecord userId={sessionUser.id} /> : null}

          {/* Your record — the platform could not answer this about its own
              users until now. Sits above delegation because what was said in
              your name is the reason to go and check who is saying it. */}
          <View className="px-4 mb-6">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/record');
              }}
              className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <View className="w-12 h-12 rounded-full bg-slate-700/60 items-center justify-center mr-3">
                    <Scale size={24} color="#F59E0B" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-lg">Your record</Text>
                    <Text className="text-slate-400 text-sm">
                      Every position you have taken, and everything said in your name
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#F59E0B" />
              </View>
            </Pressable>
          </View>

          {/* Liquid Democracy Card */}
          <View className="px-4 mb-6">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/delegates');
              }}
              className="bg-gradient-to-br from-amber-900/30 to-slate-800/60 rounded-xl p-4 border border-amber-700/30"
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center flex-1">
                  <View className="w-12 h-12 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                    <UserCheck size={24} color="#F59E0B" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white font-semibold text-lg">
                      Liquid Democracy
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      {activeDelegationsCount > 0
                        ? `${activeDelegationsCount} active delegation${activeDelegationsCount > 1 ? 's' : ''}`
                        : 'Delegate your vote to experts'}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={20} color="#F59E0B" />
              </View>

              {activeDelegationsCount > 0 && (
                <View className="flex-row items-center mt-3 pt-3 border-t border-amber-700/30">
                  <Shield size={14} color="#22C55E" />
                  <Text className="text-emerald-400 text-sm ml-2">
                    Your vote is being represented
                  </Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* Admin Console — only for an account whose own role is staff. */}
          {adminAccess ? (
            <View className="px-4 mb-6">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/admin/login');
                }}
                className="rounded-xl overflow-hidden border border-purple-700/30"
              >
                <LinearGradient
                  colors={['#581C87', '#3B0764']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16 }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="w-12 h-12 rounded-full bg-purple-500/20 items-center justify-center mr-3">
                        <Shield size={24} color="#C084FC" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-purple-100 font-semibold text-lg">
                          Admin Console
                        </Text>
                        <Text className="text-purple-300/70 text-sm">
                          Signed in here as {adminAccess.name}
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={20} color="#C084FC" />
                  </View>
                </LinearGradient>
              </Pressable>
              <Text className="text-slate-500 text-xs mt-2">
                A separate sign-in from this account&apos;s.
              </Text>
            </View>
          ) : null}

          {/* The generic entry point, for anybody reaching the console without
              a role on this account. Hidden from somebody who has one. */}
          {isStaff && !adminAccess ? (
          <View className="px-4 mb-6">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/admin/login');
              }}
              className="rounded-xl overflow-hidden border border-purple-700/30"
            >
              <LinearGradient
                colors={['#581C87', '#3B0764']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1">
                    <View className="w-12 h-12 rounded-full bg-purple-500/20 items-center justify-center mr-3">
                      <Shield size={24} color="#C084FC" />
                    </View>
                    <View className="flex-1">
                      <Text className="text-purple-100 font-semibold text-lg">
                        Admin Console
                      </Text>
                      <Text className="text-purple-300/70 text-sm">
                        Manage users, content & analytics
                      </Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#C084FC" />
                </View>
              </LinearGradient>
            </Pressable>
          </View>
          ) : null}

          {/* ONE B2B CARD, THE SAME FOR EVERYBODY WHO CAN REACH THE PORTAL.

              These were two cards. The staff one said "B2B Analytics / Civic
              Intelligence Platform". The one shown to somebody who actually
              HELD a business account said "{business name} / Sign in as
              {username} · {tier}", putting a person's own display name where a
              product name goes and reading like a different feature to the
              only people who use it.

              They are one branch now rather than two matching ones, because
              two copies of a card that must never differ is a promise the code
              cannot keep. Nothing about the viewer appears on it: no name, no
              username, no tier. It is a door, and a door does not need to know
              who you are. Web twin: apps/web/src/pages/Profile.tsx. */}
          {hasBusinessAccount || isStaff ? (
            <View className="px-4 mb-6">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/b2b/login');
                }}
                className="rounded-xl overflow-hidden border border-indigo-700/30"
              >
                <LinearGradient
                  colors={['#312E81', '#1E1B4B']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16 }}
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center flex-1">
                      <View className="w-12 h-12 rounded-full bg-indigo-500/20 items-center justify-center mr-3">
                        <BarChart3 size={24} color="#818CF8" />
                      </View>
                      <View className="flex-1">
                        <Text className="text-indigo-100 font-semibold text-lg">
                          B2B Analytics
                        </Text>
                        <Text className="text-indigo-300/70 text-sm">
                          Civic Intelligence Platform
                        </Text>
                      </View>
                    </View>
                    <ChevronRight size={20} color="#818CF8" />
                  </View>
                </LinearGradient>
              </Pressable>
            </View>
          ) : null}

          {/* Achievements */}
          <View className="px-4 mb-6">
            <Text className="text-white font-semibold text-lg mb-3">
              Achievements
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
            >
              {achievements.map((achievement, index) => (
                <AchievementBadge key={index} {...achievement} />
              ))}
            </ScrollView>
          </View>

          {/* THE DEVICE-ONLY VOTE LIST THAT USED TO SIT HERE IS GONE.
              It read zustand's `voting-store` and called it "Voting History",
              so it showed this phone's votes. The counts above and the "Your
              record" card higher up both read the server, which is the one
              place a position exists. Web twin: apps/web/src/pages/Profile.tsx,
              where the record is embedded rather than linked because a browser
              has the room for it. */}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
