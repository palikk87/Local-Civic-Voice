// Web port of mobile/src/app/(tabs)/profile.tsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Loader2,
  Pencil,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { EditProfileDialog } from "@/components/profile/EditProfileDialog";
import { AppShell } from "@/components/layout/AppShell";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import { CivicRecord } from "@/components/record/CivicRecord";
import { ImpeachmentRecord } from "@/components/profile/ImpeachmentRecord";
import { FindingsRecord } from "@/components/profile/FindingsRecord";
import { DelegateAuditPanel } from "@/components/audit/IntegrityAuditPanel";
import { TrustPanel } from "@/components/trust/TrustPanel";
import { recordApi } from "@/lib/civic";
import { useAuthStore, authUserFromSession } from "@/lib/mobile/auth-store";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/mobile/api-hooks";
import { cn } from "@/lib/utils";
import { useUserVoteHistory } from "@/lib/mobile/hooks";
import { useCurrentUser, usePermissions } from "@/hooks/use-civic-auth";
import { signOut as betterAuthSignOut } from "@/lib/auth-client";
import type { Bill } from "@/lib/mobile/types";

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
    <div
      className="flex-1 rounded-xl p-3 border"
      style={{
        backgroundColor: `${color}15`,
        borderColor: `${color}30`,
      }}
    >
      <div className="flex items-center mb-1">
        {icon}
        <span className="text-xs ml-1.5 font-medium" style={{ color }}>
          {label}
        </span>
      </div>
      <span className="block text-white font-bold text-xl">{value}</span>
    </div>
  );
}

function VoteHistoryCard({
  billId,
  vote,
  index,
  bill,
}: {
  billId: string;
  vote: "yea" | "nay";
  index: number;
  bill?: Bill | null;
}) {
  const navigate = useNavigate();

  // No bill, no card. This used to fall back to a hardcoded array, so a vote on
  // a bill the API could not return rendered as a vote on an invented one.
  if (!bill) return null;
  const displayBill = bill;

  const categoryColor = categoryColors[displayBill.category] ?? "#64748B";

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 120, damping: 16 }}
      className="mb-3"
    >
      <button
        onClick={() => navigate(`/bill/${displayBill.id}`)}
        className="w-full text-left bg-slate-800/60 rounded-xl p-4 border border-slate-700/40"
      >
        <div className="flex items-start">
          <div
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center mr-3 shrink-0",
              vote === "yea" ? "bg-emerald-900/60" : "bg-red-900/60"
            )}
          >
            {vote === "yea" ? (
              <ThumbsUp size={18} color="#22C55E" />
            ) : (
              <ThumbsDown size={18} color="#EF4444" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center mb-1">
              <span
                className="px-2 py-0.5 rounded-full mr-2 text-xs font-medium"
                style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
              >
                {categoryLabels[displayBill.category]}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded-full text-xs font-medium",
                  vote === "yea"
                    ? "bg-emerald-900/60 text-emerald-400"
                    : "bg-red-900/60 text-red-400"
                )}
              >
                {vote === "yea" ? "YEA" : "NAY"}
              </span>
            </div>

            <span className="block text-white font-semibold truncate">
              {displayBill.shortTitle}
            </span>
            <span className="block text-slate-400 text-sm truncate">
              {displayBill.title}
            </span>
          </div>

          <ChevronRight size={20} color="#64748B" className="shrink-0" />
        </div>
      </button>
    </MotionDiv>
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
    <div
      className={cn(
        "flex flex-col items-center p-3 rounded-xl mr-3 border shrink-0",
        earned
          ? "bg-amber-900/30 border-amber-700/50"
          : "bg-slate-800/40 border-slate-700/30"
      )}
      style={{ width: 100 }}
    >
      <div
        className={cn(
          "w-12 h-12 rounded-full flex items-center justify-center mb-2",
          earned ? "bg-amber-500/30" : "bg-slate-700/50"
        )}
      >
        {icon}
      </div>
      <span
        className={cn(
          "text-xs font-semibold text-center",
          earned ? "text-amber-400" : "text-slate-500"
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "text-xs text-center mt-0.5",
          earned ? "text-amber-500/70" : "text-slate-600"
        )}
      >
        {description}
      </span>
    </div>
  );
}

export default function Profile() {
  const navigate = useNavigate();
  // Auth — web equivalent of mobile: login populates the mock auth store from
  // the Better Auth session (mobile login.tsx does the same mapping after OTP
  // sign-in). If the store is empty but a session exists, derive the user.
  const { user: sessionUser, isLoading: sessionLoading } = useCurrentUser();
  // Admin tier comes from the separate admin-console session, never from a citizen
  // account — a brand-new signup is `user`, so the console card stays hidden.
  const { can, isStaff } = usePermissions();

  /**
   * The business account this person holds, if any.
   *
   * Self only — there is no endpoint that answers this about anybody else, on
   * purpose. Whether a citizen runs a research firm or a campaign is not a
   * public fact about them, and the only reason to show it is so its owner can
   * reach it.
   */
  const { data: business } = useQuery({
    queryKey: ["me", "business-account"],
    queryFn: () =>
      // ONE BIT, AND THE ENDPOINT SENDS NOTHING ELSE. It used to return the
      // username, business name and tier. A B2B login is username plus
      // password, so putting the username on a page people leave open and
      // screenshot gave away half the pair for free.
      api.get<{ hasBusinessAccount: boolean }>("/api/users/me/business-account"),
    // Nothing here changes minute to minute, and a failure is silent by design:
    // no card is the honest answer when we could not ask.
    staleTime: 5 * 60_000,
    retry: false,
  });
  const hasBusinessAccount = business?.hasBusinessAccount ?? false;

  /**
   * Whether this account carries an administrative role.
   *
   * Read from the CITIZEN account rather than from the console session, which
   * is what `isStaff` does. Somebody who holds a role but has not signed into
   * the console yet was previously shown no way to reach it — a door only
   * visible once you are already through it.
   */
  const { data: adminData } = useQuery({
    queryKey: ["me", "admin-access"],
    queryFn: () =>
      api.get<{ adminAccess: { role: string; name: string } | null }>(
        "/api/users/me/admin-access",
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const adminAccess = adminData?.adminAccess ?? null;
  const mockUser = useAuthStore((s) => s.user);
  const mockSignOut = useAuthStore((s) => s.signOut);
  const queryClient = useQueryClient();
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);

  const user = mockUser ?? (sessionUser ? authUserFromSession(sessionUser) : null);

  // NO HARDCODED USERNAME HERE ANY MORE. This used to also unlock the entry
  // cards for one literal username, which is an account identifier committed to
  // a public repository, and which hands the cards to whoever registers that
  // name next. `isStaff` reads the role off the signed-in account instead.

  // THE REAL COUNTS, FROM THE SERVER.
  //
  // These used to come off `user`, which is built by authUserFromSession() —
  // and that function sets `followers: 0, following: 0, votesCount: 0` as
  // literals, because a Better Auth session carries no such fields. So the
  // profile showed zero followers and zero following forever, no matter what
  // the database held. Khalid followed somebody and watched the number stay at
  // 0 and reasonably concluded following was broken; it was not, the display
  // was a constant.
  const { data: liveProfile } = useQuery({
    queryKey: queryKeys.user(user?.id ?? ""),
    queryFn: () =>
      api.get<{ followers: number; following: number; votesCount: number }>(
        `/api/users/${user?.id}`,
      ),
    enabled: !!user?.id,
  });

  const followerCount = liveProfile?.followers ?? 0;
  const followingCount = liveProfile?.following ?? 0;

  /*
   * THE VOTE COUNTS COME FROM THE SERVER NOW.
   *
   * They were read from `voting-store`, a zustand store persisted to this
   * browser's localStorage. So the three numbers on a person's own profile —
   * Yea, Nay, Total — described one device. Sign in on a phone after voting all
   * week on a laptop and the profile said you had never voted, on a platform
   * whose entire subject is the record of what you have stood for.
   *
   * `/api/users/:id/positions` is where positions actually live; it is the same
   * source the record below reads, so the headline numbers and the list under
   * them can no longer disagree.
   */
  const { data: positions } = useQuery({
    queryKey: ["positions", sessionUser?.id],
    queryFn: () => recordApi.positions(sessionUser!.id),
    enabled: Boolean(sessionUser?.id),
  });

  // The real count, from the server that holds them.
  //
  // This used to read a browser-only store that nothing ever filled, so a
  // citizen who had lent their voice to three people was told they had none.
  // The card is the only place most people will look to check.
  const { data: myDelegations } = useQuery({
    queryKey: ["my-delegations"],
    queryFn: () => api.get<{ activeCount: number }>("/api/delegations/me"),
    enabled: Boolean(sessionUser),
  });
  const activeDelegationsCount = myDelegations?.activeCount ?? 0;

  /*
   * Optional all the way down, not just past `positions`.
   *
   * `positions?.summary.support` guards the response and then dereferences
   * `summary` unconditionally, so any response without that key throws and the
   * whole profile goes to the error boundary — a blank page, from a number in
   * a corner. Three counts are not worth a page.
   */
  const yeaVotes = positions?.summary?.support ?? 0;
  const nayVotes = positions?.summary?.oppose ?? 0;
  const totalVotes = positions?.summary?.total ?? 0;

  const handleSignOut = async () => {
    // One click = one sign-out. Matches mobile: without the guard the button fired
    // again on every click while the first request was in flight, which tripped the
    // auth rate limiter and left the session alive.
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      await betterAuthSignOut();
    } catch {
      // Server said no (already signed out, offline, rate-limited) — we still sign
      // out locally below, so the app never gets stuck half-signed-in.
    }
    mockSignOut();
    // Drop every cached response belonging to the signed-out user (mobile does the
    // same) so the next visitor never sees the last person's data.
    queryClient.clear();
    setIsSigningOut(false);
    navigate("/");
  };

  /*
   * ACHIEVEMENTS, AND WHAT THEY ACTUALLY MEASURE.
   *
   * Two problems, both from the audit in docs/BADGE_AUDIT.md.
   *
   * "5 followers" read `user.followers`, and `user` here is built by
   * signed-in-identity.ts, which sets `followers: 0` as a literal because a
   * session carries no such field. So that one could never be earned by
   * anybody, ever, whatever the database held — the live count is right there
   * in `liveProfile`, three lines up, and was already being displayed.
   *
   * The vote thresholds read a browser-local store until this week; they read
   * the server now, which is what makes them mean anything on a second device.
   *
   * These four are ALSO not the badge system. gamification.ts declares its own
   * nineteen with different names and different thresholds, and nothing in
   * either app renders that list. Consolidating the two is a decision, not a
   * cleanup, and it is written up rather than made here.
   */
  const achievements = [
    {
      title: "First Vote",
      description: "Cast your first vote",
      icon: <ThumbsUp size={20} color={totalVotes > 0 ? "#F59E0B" : "#64748B"} />,
      earned: totalVotes > 0,
    },
    {
      title: "Voice Heard",
      description: "10 votes cast",
      icon: <TrendingUp size={20} color={totalVotes >= 10 ? "#F59E0B" : "#64748B"} />,
      earned: totalVotes >= 10,
    },
    {
      title: "Civic Hero",
      description: "50 votes cast",
      icon: <Award size={20} color={totalVotes >= 50 ? "#F59E0B" : "#64748B"} />,
      earned: totalVotes >= 50,
    },
    {
      title: "Engaged",
      description: "5 followers",
      icon: <Users size={20} color={followerCount >= 5 ? "#F59E0B" : "#64748B"} />,
      earned: followerCount >= 5,
    },
  ];

  if (!user) {
    // No profile yet. Only spin while the session is still resolving — once it says
    // "signed out", the RouteGuard around this page shows the sign-in wall, so
    // spinning here forever (the old behaviour after sign-out) would just hide it.
    const stillResolving = sessionLoading || (!!sessionUser && !isSigningOut);
    if (!stillResolving) return null;

    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 className="h-10 w-10 animate-spin" color="#F59E0B" />
          <span className="text-slate-400 mt-4">
            {isSigningOut ? "Signing out..." : "Loading profile..."}
          </span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-1 py-3">
          <h1 className="text-2xl font-bold text-white">Profile</h1>
          <div className="flex items-center">
            <button
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="bg-red-900/40 p-2 rounded-full mr-2 transition hover:bg-red-900/60 disabled:opacity-50"
              aria-label="Sign out"
            >
              {isSigningOut ? (
                <Loader2 className="h-5 w-5 animate-spin" color="#EF4444" />
              ) : (
                <LogOut size={20} color="#EF4444" />
              )}
            </button>
            {/* Editing an account was impossible: the endpoint existed and
                nothing but the signup form ever called it, so a name was
                whatever it was on the day the account was made. */}
            <button
              onClick={() => setEditing(true)}
              className="bg-slate-800 p-2 rounded-full transition hover:bg-slate-700"
              aria-label="Edit profile"
            >
              <Pencil size={20} color="#64748B" />
            </button>
            <button
              onClick={() => navigate("/settings")}
              className="bg-slate-800 p-2 rounded-full transition hover:bg-slate-700"
              aria-label="Settings"
            >
              <Settings size={22} color="#64748B" />
            </button>
          </div>
        </div>

        <div className="pb-5">
          {/* Profile Header */}
          <div className="flex flex-col items-center px-4 py-6">
            <div className="relative">
              <img
                src={user.avatar}
                alt={user.displayName}
                className="w-24 h-24 rounded-full border-4 border-amber-500/30 object-cover"
              />
              <div className="absolute -bottom-1 -right-1 bg-amber-500 w-8 h-8 rounded-full flex items-center justify-center border-4 border-slate-900">
                <span className="text-slate-900 font-bold text-xs">{totalVotes}</span>
              </div>
            </div>

            <span className="text-white font-bold text-xl mt-4">
              {user.displayName}
            </span>
            <span className="text-slate-400">@{user.username}</span>

            {user.bio ? (
              <p className="text-slate-300 text-center mt-2 px-8">{user.bio}</p>
            ) : null}

            <div className="flex items-center mt-2">
              <MapPin size={14} color="#64748B" />
              <span className="text-slate-400 text-sm ml-1">{user.location}</span>
              <span className="text-slate-600 mx-2">·</span>
              <Calendar size={14} color="#64748B" />
              <span className="text-slate-400 text-sm ml-1">
                Joined{" "}
                {new Date(user.joinedDate).toLocaleDateString("en-US", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* Follow Stats */}
            <div className="flex mt-4">
              <button className="flex flex-col items-center mr-6">
                <span className="text-white font-bold text-lg">{followerCount}</span>
                <span className="text-slate-400 text-sm">Followers</span>
              </button>
              <button className="flex flex-col items-center">
                <span className="text-white font-bold text-lg">{followingCount}</span>
                <span className="text-slate-400 text-sm">Following</span>
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex px-4 mb-6 gap-2">
            <StatCard
              icon={<ThumbsUp size={14} color="#22C55E" />}
              label="Yea Votes"
              value={yeaVotes}
              color="#22C55E"
            />
            <StatCard
              icon={<ThumbsDown size={14} color="#EF4444" />}
              label="Nay Votes"
              value={nayVotes}
              color="#EF4444"
            />
            <StatCard
              icon={<Award size={14} color="#F59E0B" />}
              label="Total"
              value={totalVotes}
              color="#F59E0B"
            />
          </div>

          {/* Founding Documents */}
          <div className="px-4 mb-6">
            <h2 className="text-white font-semibold text-lg mb-3">
              Founding Documents
            </h2>

            {/* Constitution Card */}
            <button
              onClick={() => navigate("/constitution")}
              className="w-full text-left rounded-xl overflow-hidden border border-slate-600/30 mb-3 bg-gradient-to-br from-[#334155] to-[#1e293b] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-slate-500/20 flex items-center justify-center mr-3 shrink-0">
                    <BookOpen size={24} color="#94A3B8" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-slate-100 font-semibold text-lg">
                      Constitution
                    </span>
                    <span className="block text-slate-400 text-sm">
                      The supreme law of the platform
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} color="#94A3B8" />
              </div>
            </button>

            {/* Bill of Rights Card */}
            <button
              onClick={() => navigate("/bill-of-rights")}
              className="w-full text-left rounded-xl overflow-hidden border border-amber-700/30 bg-gradient-to-br from-[#78350f] to-[#451a03] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mr-3 shrink-0">
                    <Scroll size={24} color="#FCD34D" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-amber-100 font-semibold text-lg">
                      Bill of Rights
                    </span>
                    <span className="block text-amber-300/70 text-sm">
                      Your individual protections
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} color="#FCD34D" />
              </div>
            </button>

            {/* Article V - Self-Correction Card */}
            <button
              onClick={() => navigate("/article-v")}
              className="w-full text-left rounded-xl overflow-hidden border border-red-700/30 mt-3 bg-gradient-to-br from-[#7F1D1D] to-[#450A0A] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mr-3 shrink-0">
                    <Shield size={24} color="#FCA5A5" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-red-100 font-semibold text-lg">
                      Article V: Self-Correction
                    </span>
                    <span className="block text-red-300/70 text-sm">
                      Impeachment &amp; System Reset
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} color="#FCA5A5" />
              </div>
            </button>
          </div>

          {/* Liquid Democracy Card */}
          <div className="px-4 mb-6">
            <button
              onClick={() => navigate("/delegates")}
              className="w-full text-left bg-gradient-to-br from-amber-900/30 to-slate-800/60 rounded-xl p-4 border border-amber-700/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mr-3 shrink-0">
                    <UserCheck size={24} color="#F59E0B" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-white font-semibold text-lg">
                      Liquid Democracy
                    </span>
                    <span className="block text-slate-400 text-sm">
                      {activeDelegationsCount > 0
                        ? `${activeDelegationsCount} active delegation${activeDelegationsCount > 1 ? "s" : ""}`
                        : "Delegate your vote to experts"}
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} color="#F59E0B" />
              </div>

              {activeDelegationsCount > 0 ? (
                <div className="flex items-center mt-3 pt-3 border-t border-amber-700/30">
                  <Shield size={14} color="#22C55E" />
                  <span className="text-emerald-400 text-sm ml-2">
                    Your vote is being represented
                  </span>
                </div>
              ) : null}
            </button>
          </div>

          {/* Admin Console — only for an account whose own role is staff. Not for
              whoever happens to have an admin-console flag left in this
              browser's storage, which is what this used to check. */}
          {adminAccess ? (
            <div className="px-4 mb-6">
              <button
                onClick={() => navigate("/admin")}
                className="w-full text-left rounded-xl overflow-hidden border border-purple-700/30 bg-gradient-to-br from-[#581C87] to-[#3B0764] p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1">
                    <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mr-3 shrink-0">
                      <Shield size={24} color="#C084FC" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-purple-100 font-semibold text-lg">
                        Admin Console
                      </span>
                      <span className="block text-purple-300/70 text-sm">
                        Signed in here as {adminAccess.name}
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={20} color="#C084FC" />
                </div>
              </button>
              <p className="mt-2 text-xs text-muted-foreground">
                A separate sign-in from this account&apos;s.
              </p>
            </div>
          ) : null}

          {/* The generic entry point, for anybody reaching the console without
              a role on this account. Hidden from somebody who has one. */}
          {isStaff && !adminAccess ? (
          <div className="px-4 mb-6">
            <button
              onClick={() => navigate("/admin/login")}
              className="w-full text-left rounded-xl overflow-hidden border border-purple-700/30 bg-gradient-to-br from-[#581C87] to-[#3B0764] p-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1">
                  <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center mr-3 shrink-0">
                    <Shield size={24} color="#C084FC" />
                  </div>
                  <div className="flex-1">
                    <span className="block text-purple-100 font-semibold text-lg">
                      Admin Console
                    </span>
                    <span className="block text-purple-300/70 text-sm">
                      Manage users, content &amp; analytics
                    </span>
                  </div>
                </div>
                <ChevronRight size={20} color="#C084FC" />
              </div>
            </button>
          </div>
          ) : null}

          {/* ONE B2B CARD, THE SAME FOR EVERYBODY WHO CAN REACH THE PORTAL.

              These were two cards. The staff one said "B2B Analytics / Civic
              Intelligence Platform". The one shown to somebody who actually
              HELD a business account said "{business name} / Sign in as
              {username} · {tier}" — so on a converted account it rendered as
              "khalid / Sign in as civicvoice · enterprise", putting a person's
              own display name where a product name goes, and reading like a
              different feature to the only people who use it.

              They are one branch now rather than two matching ones, because
              two copies of a card that must never differ is a promise the code
              cannot keep. Nothing about the viewer appears on it: no name, no
              username, no tier. It is a door, and a door does not need to know
              who you are. */}
          {hasBusinessAccount || isStaff ? (
            <div className="px-4 mb-6">
              <button
                onClick={() => navigate("/b2b/login")}
                className="w-full text-left rounded-xl overflow-hidden border border-indigo-700/30 bg-gradient-to-br from-[#312E81] to-[#1E1B4B] p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-1">
                    <div className="w-12 h-12 rounded-full bg-indigo-500/20 flex items-center justify-center mr-3 shrink-0">
                      <BarChart3 size={24} color="#818CF8" />
                    </div>
                    <div className="flex-1">
                      <span className="block text-indigo-100 font-semibold text-lg">
                        B2B Analytics
                      </span>
                      <span className="block text-indigo-300/70 text-sm">
                        Civic Intelligence Platform
                      </span>
                    </div>
                  </div>
                  <ChevronRight size={20} color="#818CF8" />
                </div>
              </button>
            </div>
          ) : null}

          {/* Achievements */}
          <div className="px-4 mb-6">
            <h2 className="text-white font-semibold text-lg mb-3">Achievements</h2>
            <div className="flex overflow-x-auto pb-1">
              {achievements.map((achievement, index) => (
                <AchievementBadge key={index} {...achievement} />
              ))}
            </div>
          </div>

          {/* ARTICLE V, on your own profile too. Somebody who has been
              impeached sees exactly what everybody else sees about it, in the
              same words. A finding hidden from the person it is about is a
              finding they cannot answer. */}
          {sessionUser?.id ? (
            <div className="px-4">
              <ImpeachmentRecord userId={sessionUser.id} />
            </div>
          ) : null}

          {/* BILL OF RIGHTS ARTICLE V, on your own profile too. A finding
              hidden from the person it is about is a finding they cannot
              answer. */}
          {sessionUser?.id ? (
            <div className="px-4">
              <FindingsRecord userId={sessionUser.id} />
            </div>
          ) : null}

          {/* ARTICLE III §2, on yourself. A leader can audit their own support
              whenever they want and the result is kept, so a clean history is
              something they can point at — and a stacked one is something they
              find out about before anybody else does. */}
          {/* THE TRUST SCORE, on your own profile too — the same number
              everybody else can see, with the same working shown. */}
          {sessionUser?.id ? (
            <div className="px-4 pb-4">
              <TrustPanel userId={sessionUser.id} />
            </div>
          ) : null}

          {sessionUser?.id ? (
            <div className="px-4">
              <DelegateAuditPanel userId={sessionUser.id} />
            </div>
          ) : null}

          {/* Your record — positions, changes of mind, and what was said in
              your name. It used to live on its own page at /record, behind its
              own sidebar item, which is why a profile could be read end to end
              without seeing a single thing the person had ever stood for. */}
          <div className="px-4">
            <CivicRecord userId={sessionUser?.id} isMine />
          </div>

          {/* The browser-only vote list that used to sit here is gone. It read
              zustand's `voting-store`, so it showed this device's votes and
              called them your history. The record above is the server's. */}
        </div>
      </div>

      <EditProfileDialog
        open={editing}
        onOpenChange={setEditing}
        profile={{
          displayName: user.displayName,
          username: user.username,
          bio: user.bio,
          location: user.location,
          avatar: user.avatar,
        }}
      />
    </AppShell>
  );
}
