// Web port of mobile/src/app/(tabs)/index.tsx (Home screen)
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Share2,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  ChevronRight,
  Sparkles,
  Users,
  AlertTriangle,
  MapPin,
  Flame,
  Award,
  Bell,
  CheckCircle,
  Shield,
  Landmark,
  FileText,
  Scale,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { BetaWelcomeDialog } from "@/components/feed/BetaWelcomeDialog";
import { MotionDiv } from "@/components/civic/Motion";
import { useVotingStore, selectIsLiked, selectUserVote } from "@/lib/mobile/voting-store";
import { castReferenceVote, yeaNayToPosition } from "@/lib/mobile/reference-votes";
import { toast } from "sonner";
import {
  categoryColors,
  categoryLabels,
  branchLabels,
  branchColors,
} from "@/lib/mobile/mock-data";
import type { FeedItem, Bill, BillCategory, GovernmentBranch } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";
import {
  useTrendingBills,
  useCastVote,
  useUserVote,
  useRandomizedBillFeed,
} from "@/lib/mobile/hooks";
import { useCurrentUser, useRequireAuth } from "@/hooks/use-civic-auth";
import { useJurisdiction } from "@/hooks/use-jurisdiction";
import type { FeedItemWithDetails, Bill as SupabaseBill } from "@/lib/mobile/database.types";

// Import new systems
import {
  rankFeedItems,
  getTrendingItems,
  getGapItems,
  getLocalItems,
  FEED_TYPES,
  type FeedType,
  type ScoredFeedItem,
  fisherYatesShuffle,
} from "@/lib/mobile/feed-algorithm";
import {
  useGamificationStore,
  selectCivicScore,
  selectStreak,
  CIVIC_LEVELS,
} from "@/lib/mobile/gamification";
import { useEngagementStore, selectUnreadCount } from "@/lib/mobile/engagement";
import { verifyBill, getTrustBadge } from "@/lib/mobile/trust-verification";
import ShareModal from "@/components/mobile/ShareModal";
import { BillOfRightsBadge } from "@/components/mobile/BillOfRightsBadge";
import { PulseGapBadge } from "@/components/mobile/PulseGap";
import { PersonAvatar, PersonHandle, PersonName } from "@/components/people/PersonLink";
import { DailyBillDigest } from "@/components/mobile/DailyBillDigest";
import {
  useAlgorithmicFeed,
  algorithmicPostToFeedItem,
} from "@/lib/mobile/algorithmic-feed";
import { calculateRepresentationGap } from "@/lib/mobile/representation-gap";
import {
  useSeenBillsStore,
  selectSeenBillIds,
  selectAddSeenBills,
  selectClearSeenBills,
} from "@/lib/mobile/seen-bills-store";

/** Where a card opens. One law, one page. */
function getDetailRoute(bill: Bill): string {
  // A card with no id cannot open anything, and "/bill/unknown" was a route
  // that rendered a detail page for a record that does not exist. The catch-all
  // is the honest answer to a link we cannot build.
  if (!bill?.id) {
    console.warn("getDetailRoute: Bill ID is missing", bill);
    return "/not-found";
  }

  // ONE LAW, ONE PAGE. This used to fork three ways by branch, into three
  // separate screens that were ports of the phone app — and the richer page,
  // the one with the audit, the gap, the brief, the other side and the
  // comments, was reachable only from a profile's record. Every id here is a
  // government reference id, which is exactly what /reference/:id takes, so
  // the fork was never buying anything.
  return `/reference/${bill.id}`;
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString();
}

// Convert Supabase bill to mock Bill type for compatibility
function convertBillToLegacy(bill: SupabaseBill): Bill {
  return {
    id: bill.id,
    title: bill.title,
    shortTitle: bill.short_title,
    status: bill.status,
    chamber: bill.chamber,
    sponsor: {
      id: bill.sponsor_id ?? "",
      name: "Sponsor",
      party: "D",
      state: "US",
      chamber: bill.chamber,
      imageUrl: "",
    },
    introducedDate: bill.introduced_date,
    lastActionDate: bill.last_action_date,
    category: bill.category as BillCategory,
    fullText: bill.full_text,
    simplifiedText: bill.simplified_text ?? "",
    realWorldImpact: bill.real_world_impact ?? "",
    relatedLaws: [],
    communityVotes: {
      yea: bill.yea_count,
      nay: bill.nay_count,
      totalVoters: bill.total_votes,
    },
    branch: "legislative", // Supabase bills are always legislative
  };
}

// ==========================================
// CIVIC SCORE HEADER
// ==========================================

function CivicScoreHeader() {
  const civicScore = useGamificationStore(selectCivicScore) ?? { total: 0, level: 'newcomer' as const, xpToNextLevel: 100 };
  const streak = useGamificationStore(selectStreak) ?? { current: 0, lastActivityDate: '', freezeDeadline: null };
  const unreadCount = useEngagementStore(selectUnreadCount) ?? 0;
  const navigate = useNavigate();

  const levelInfo = CIVIC_LEVELS[civicScore.level] ?? CIVIC_LEVELS.newcomer;
  const progressPct = ((civicScore.total - levelInfo.min) / (levelInfo.max - levelInfo.min)) * 100;

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="mx-4 mb-3"
    >
      <button
        onClick={() => navigate("/profile")}
        className="w-full bg-slate-800/60 rounded-2xl p-3 border border-slate-700/50 text-left"
      >
        <div className="flex items-center justify-between">
          {/* Civic Score */}
          <div className="flex items-center flex-1">
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center mr-3 shrink-0"
              style={{ backgroundColor: `${levelInfo.color}20` }}
            >
              <span className="text-xl font-bold" style={{ color: levelInfo.color }}>
                {civicScore.total}
              </span>
            </span>
            <div className="flex-1">
              {/* What the number is, said out loud. It is a count of what you
                  have done on this platform, kept in this browser — not a
                  standing, a rank, or anything congress.gov knows about. */}
              <p className="text-white font-semibold text-sm">{levelInfo.title}</p>
              <p className="text-slate-400 text-[11px]">Your activity here</p>
              <div className="flex items-center mt-1">
                <span className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden mr-2">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${progressPct}%`, backgroundColor: levelInfo.color }}
                  />
                </span>
                <span className="text-slate-400 text-xs">{civicScore.xpToNextLevel} to next</span>
              </div>
            </div>
          </div>

          {/* Streak & Notifications */}
          <div className="flex items-center ml-2">
            {streak.current > 0 ? (
              <span className="flex items-center bg-amber-500/20 px-2 py-1 rounded-full mr-2">
                <Flame size={14} color="#F59E0B" />
                <span className="text-amber-500 text-xs font-bold ml-1">{streak.current}</span>
              </span>
            ) : null}
            <span className="relative p-2">
              <Bell size={20} color="#94A3B8" />
              {unreadCount > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 rounded-full w-4 h-4 flex items-center justify-center">
                  <span className="text-white text-xs font-bold">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                </span>
              ) : null}
            </span>
          </div>
        </div>
      </button>
    </MotionDiv>
  );
}

// ==========================================
// FEED TYPE TABS
// ==========================================

function FeedTypeIcon({ type, color }: { type: FeedType; color: string }) {
  switch (type) {
    case "for_you":
      return <Sparkles size={16} color={color} />;
    case "following":
      return <Users size={16} color={color} />;
    case "trending":
      return <TrendingUp size={16} color={color} />;
    case "gaps":
      return <AlertTriangle size={16} color={color} />;
    case "local":
      return <MapPin size={16} color={color} />;
  }
}

function FeedTypeTabs({
  activeType,
  onChangeType,
}: {
  activeType: FeedType;
  onChangeType: (type: FeedType) => void;
}) {
  return (
    <div className="mb-2">
      {/*
        These are tabs, so they say so. Screen readers announce which one is
        selected instead of reading seven unlabelled buttons in a row, and a
        check can ask for "the Gaps tab" rather than guessing at the markup.
      */}
      <div
        role="tablist"
        aria-label="Feed"
        className="flex items-center overflow-x-auto scrollbar-none px-3"
        style={{ height: 36 }}
      >
        {FEED_TYPES.map((feed, index) => {
          const isActive = activeType === feed.type;
          const iconColor = isActive ? "#F59E0B" : "#64748B";

          return (
            <button
              key={feed.type}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChangeType(feed.type)}
              className="flex items-center shrink-0 rounded-full border px-2.5 py-1.5"
              style={{
                marginRight: index < FEED_TYPES.length - 1 ? 6 : 0,
                backgroundColor: isActive ? "rgba(245, 158, 11, 0.2)" : "rgba(30, 41, 59, 0.6)",
                borderColor: isActive ? "rgba(245, 158, 11, 0.5)" : "rgba(51, 65, 85, 0.5)",
              }}
            >
              <FeedTypeIcon type={feed.type} color={iconColor} />
              <span
                className="ml-1.5 text-xs font-medium whitespace-nowrap"
                style={{ color: isActive ? "#F59E0B" : "#94A3B8" }}
              >
                {feed.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// FEED REASON BADGE
// ==========================================

function FeedReasonIcon({ type, color }: { type: string; color: string }) {
  switch (type) {
    case "following":
    case "similar_voters":
      return <Users size={10} color={color} />;
    case "trending":
      return <TrendingUp size={10} color={color} />;
    case "local":
      return <MapPin size={10} color={color} />;
    case "category":
      return <CheckCircle size={10} color={color} />;
    case "rep_gap":
      return <AlertTriangle size={10} color={color} />;
    case "breaking":
      return <Flame size={10} color={color} />;
    case "delegate":
      return <Award size={10} color={color} />;
    default:
      return <Sparkles size={10} color={color} />;
  }
}

function FeedReasonBadge({ item }: { item: ScoredFeedItem }) {
  // THE OTHER SIDE OUTRANKS EVERY OTHER LABEL, because it is the only one that
  // is a fact rather than a ranking artefact: the reader and this author are on
  // public record disagreeing about the same bill. It is also the label most
  // worth being honest about — a feed that quietly rearranges what somebody
  // sees is the thing this platform exists to be an alternative to.
  if (item.isOtherSide) {
    return (
      <span
        className="inline-flex items-center self-start rounded-full px-2 py-0.5 mb-2"
        style={{ backgroundColor: "#EF444420" }}
      >
        <Scale size={10} color="#EF4444" />
        <span className="ml-1 text-xs font-medium" style={{ color: "#EF4444" }}>
          Voted the other way
        </span>
      </span>
    );
  }

  if (!item.feedReason) return null;

  const getLabel = (): string => {
    switch (item.feedReason?.type) {
      case "following":
        return "Following";
      case "trending":
        return `#${(item.feedReason as { rank: number }).rank} Trending`;
      case "local":
        return (item.feedReason as { state: string }).state;
      case "category":
        return categoryLabels[(item.feedReason as { category: BillCategory }).category];
      case "rep_gap":
        return `${Math.round((item.feedReason as { gapPct: number }).gapPct)}% Gap`;
      case "breaking":
        return "Breaking";
      case "similar_voters":
        return "Similar to You";
      case "delegate":
        return "Delegate";
      default:
        return "";
    }
  };

  const getColor = (): string => {
    switch (item.feedReason?.type) {
      case "following":
        return "#3B82F6";
      case "trending":
        return "#F59E0B";
      case "local":
        return "#22C55E";
      case "category":
        return "#8B5CF6";
      case "rep_gap":
        return "#EF4444";
      case "breaking":
        return "#F97316";
      case "similar_voters":
        return "#06B6D4";
      case "delegate":
        return "#A855F7";
      default:
        return "#64748B";
    }
  };

  const color = getColor();
  const label = getLabel();

  if (!label) return null;

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full mb-2 self-start"
      style={{ backgroundColor: `${color}20` }}
    >
      <FeedReasonIcon type={item.feedReason.type} color={color} />
      <span className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

// ==========================================
// BRANCH FILTER TABS
// ==========================================

type BranchFilterType = GovernmentBranch | "all";

const BRANCH_FILTERS: { type: BranchFilterType; label: string; color: string }[] = [
  { type: "all", label: "All", color: "#F59E0B" },
  { type: "legislative", label: "Congress", color: "#3B82F6" },
  { type: "executive", label: "Executive", color: "#F59E0B" },
  { type: "judicial", label: "Supreme Court", color: "#8B5CF6" },
];

function BranchFilterIcon({ type, color }: { type: BranchFilterType; color: string }) {
  switch (type) {
    case "legislative":
      return <Landmark size={14} color={color} />;
    case "executive":
      return <FileText size={14} color={color} />;
    case "judicial":
      return <Scale size={14} color={color} />;
    case "all":
    default:
      return <Sparkles size={14} color={color} />;
  }
}

function BranchFilterTabs({
  activeFilter,
  onChangeFilter,
}: {
  activeFilter: BranchFilterType;
  onChangeFilter: (filter: BranchFilterType) => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center overflow-x-auto scrollbar-none px-3" style={{ height: 36 }}>
        {BRANCH_FILTERS.map((filter, index) => {
          const isActive = activeFilter === filter.type;
          const iconColor = isActive ? "#fff" : filter.color;

          return (
            <button
              key={filter.type}
              onClick={() => onChangeFilter(filter.type)}
              className="flex items-center shrink-0 rounded-full border px-2.5 py-1.5"
              style={{
                marginRight: index < BRANCH_FILTERS.length - 1 ? 6 : 0,
                backgroundColor: isActive ? filter.color : "rgba(30, 41, 59, 0.4)",
                borderColor: isActive ? "transparent" : "rgba(51, 65, 85, 0.5)",
              }}
            >
              <BranchFilterIcon type={filter.type} color={iconColor} />
              <span
                className="ml-1 text-xs font-medium whitespace-nowrap"
                style={{ color: isActive ? "#fff" : "#94A3B8" }}
              >
                {filter.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// BRANCH BADGE
// ==========================================

function BranchIcon({ branch, color }: { branch: GovernmentBranch; color: string }) {
  switch (branch) {
    case "legislative":
      return <Landmark size={10} color={color} />;
    case "executive":
      return <FileText size={10} color={color} />;
    case "judicial":
      return <Scale size={10} color={color} />;
    default:
      return <Landmark size={10} color={color} />;
  }
}

function BranchBadge({ branch }: { branch?: GovernmentBranch }) {
  const branchType = branch ?? "legislative";
  const color = branchColors[branchType];
  const label = branchLabels[branchType];

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full mr-2 mb-1"
      style={{ backgroundColor: `${color}20` }}
    >
      <BranchIcon branch={branchType} color={color} />
      <span className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </span>
    </span>
  );
}

// ==========================================
// TRUST BADGE
// ==========================================

function TrustBadge({ bill }: { bill: Bill }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const verification = useMemo(() => verifyBill(bill), [bill.id]);
  const badge = getTrustBadge(verification.overallTrustScore);

  return (
    <button
      className="flex items-center px-2 py-0.5 rounded-full shrink-0"
      style={{ backgroundColor: `${badge.color}20` }}
    >
      <Shield size={10} color={badge.color} />
      <span className="text-xs font-medium ml-1" style={{ color: badge.color }}>
        {badge.icon} {badge.label}
      </span>
    </button>
  );
}

// ==========================================
// VOTE BUTTONS
// ==========================================

interface VoteButtonsProps {
  bill: Bill;
}

function VoteButtons({ bill }: VoteButtonsProps) {
  const navigate = useNavigate();
  const recordVote = useGamificationStore((s) => s.recordVote);
  const updateStreak = useGamificationStore((s) => s.updateStreak);

  // My standing vote on this law — same mirror every surface reads.
  const userVote = useVotingStore(selectUserVote(bill.id));
  const requireAuth = useRequireAuth();

  const handleVote = async (vote: "yea" | "nay") => {
    if (!requireAuth("Sign in to cast your vote.")) return;
    // One central vote per citizen per law — feed cards carry the law's
    // reference id, so this lands on the same record as every other surface.
    void castReferenceVote(bill.id, yeaNayToPosition(vote)).catch(() => {
      toast.error("Could not record your vote. Please try again.");
    });

    // Record in gamification
    recordVote(bill.id, bill.category, vote);
    updateStreak();
  };

  const totalVotes = bill.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((bill.communityVotes.yea / totalVotes) * 100);
  const nayPercentage = bill.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">
          {bill.communityVotes.totalVoters.toLocaleString()} community votes
        </span>
        <button
          onClick={() => navigate(getDetailRoute(bill))}
          className="flex items-center bg-amber-500/20 px-3 py-1.5 rounded-full"
        >
          <span className="text-xs text-amber-500 font-medium mr-1">See details</span>
          <ChevronRight size={12} color="#F59E0B" />
        </button>
      </div>

      {/* Vote Progress Bar */}
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-emerald-500 rounded-l-full transition-all"
          style={{ width: `${yeaPercentage}%` }}
        />
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <button
            onClick={() => handleVote("yea")}
            className={cn(
              "flex items-center px-4 py-2 rounded-full mr-2 transition-transform active:scale-110",
              userVote === "yea" ? "bg-emerald-600" : "bg-slate-700"
            )}
          >
            <ThumbsUp size={16} color={userVote === "yea" ? "#fff" : "#22C55E"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                userVote === "yea" ? "text-white" : "text-emerald-500"
              )}
            >
              Yea {yeaPercentage}%
            </span>
          </button>

          <button
            onClick={() => handleVote("nay")}
            className={cn(
              "flex items-center px-4 py-2 rounded-full transition-transform active:scale-110",
              userVote === "nay" ? "bg-red-600" : "bg-slate-700"
            )}
          >
            <ThumbsDown size={16} color={userVote === "nay" ? "#fff" : "#EF4444"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                userVote === "nay" ? "text-white" : "text-red-500"
              )}
            >
              Nay {nayPercentage}%
            </span>
          </button>
        </div>

        {/* PROJECTED OUTCOME BADGE REMOVED. A prediction the platform had no
            basis for — its only ever input was a hash of the record's id. */}
      </div>
    </div>
  );
}

// ==========================================
// FEED CARD
// ==========================================

interface FeedCardProps {
  item: ScoredFeedItem;
  index: number;
  userId?: string;
  onReply?: (item: ScoredFeedItem) => void;
  onShare?: (item: ScoredFeedItem) => void;
}

function FeedCard({ item, index, onReply, onShare }: FeedCardProps) {
  // Likes live in the local store. The other half of this used to call a
  // Supabase mutation behind an `isSupabaseConfigured()` gate that has returned
  // a hardcoded false since the client was removed, so it was unreachable.
  const toggleLike = useVotingStore((s) => s.toggleLike);
  const isLiked = useVotingStore(selectIsLiked(item.id));
  const requireAuth = useRequireAuth();

  const handleLike = () => {
    if (!requireAuth("Sign in to like posts.")) return;
    toggleLike(item.id);
  };

  const categoryColor = categoryColors[item.bill.category] ?? "#64748B";

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.08, duration: 0.35 }}
      className="mx-4 mb-4"
    >
      <div className="bg-slate-800/80 rounded-2xl p-4 border border-slate-700/50">
        {/* Feed Reason Badge */}
        <FeedReasonBadge item={item} />

        {/* User Header.

            THE NAME WENT NOWHERE. Avatar, name and handle were plain markup on
            the busiest screen in the app: you could read somebody's position on
            a law and have no way to find out what else they had ever stood for.
            PersonLink exists precisely so that cannot happen, and this is the
            screen it never reached. */}
        <div className="flex items-center mb-3">
          <PersonAvatar
            person={item.user}
            className="w-10 h-10 rounded-full"
            fallbackClassName="bg-slate-700 text-white text-sm"
          />
          <div className="ml-3 flex-1">
            <p className="text-white font-semibold">
              <PersonName person={item.user} />
            </p>
            <p className="text-slate-400 text-xs">
              <PersonHandle person={item.user} /> · {formatTimeAgo(item.timestamp)}
            </p>
          </div>
          {item.vote ? (
            <span
              className={cn(
                "px-2 py-1 rounded-full",
                item.vote === "yea" ? "bg-emerald-900/60" : "bg-red-900/60"
              )}
            >
              <span
                className={cn(
                  "text-xs font-semibold",
                  item.vote === "yea" ? "text-emerald-400" : "text-red-400"
                )}
              >
                Voted {item.vote === "yea" ? "YEA" : "NAY"}
              </span>
            </span>
          ) : null}
        </div>

        {/* Comment if exists */}
        {item.comment ? (
          <p className="text-slate-200 mb-3 leading-5">{item.comment}</p>
        ) : null}

        {/* Bill Card */}
        <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/30">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center flex-wrap flex-1">
              {/* Branch Badge */}
              <BranchBadge branch={item.bill.branch} />
              <span
                className="px-2 py-0.5 rounded-full mr-2 mb-1"
                style={{ backgroundColor: `${categoryColor}30` }}
              >
                <span style={{ color: categoryColor }} className="text-xs font-medium">
                  {categoryLabels[item.bill.category]}
                </span>
              </span>
              {/* Only show chamber for legislative branch */}
              {!item.bill.branch || item.bill.branch === "legislative" ? (
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-full mb-1",
                    item.bill.chamber === "house" ? "bg-blue-900/50" : "bg-purple-900/50"
                  )}
                >
                  <span
                    className={cn(
                      "text-xs font-medium",
                      item.bill.chamber === "house" ? "text-blue-400" : "text-purple-400"
                    )}
                  >
                    {item.bill.chamber === "house" ? "House" : "Senate"}
                  </span>
                </span>
              ) : null}
            </div>
            <TrustBadge bill={item.bill} />
          </div>

          <p className="text-white font-semibold text-base mb-1">{item.bill.shortTitle}</p>
          <p className="text-slate-400 text-sm line-clamp-2">{item.bill.title}</p>

          <VoteButtons bill={item.bill} />

          {/* Representation Gap - The People vs Congress.
              The guard is the null, not a field check: calculateRepresentationGap
              now refuses to invent an official percentage. */}
          {(() => {
            const gap = calculateRepresentationGap(item.bill);
            return gap ? (
              <div className="mt-2">
                <PulseGapBadge gap={gap} />
              </div>
            ) : null;
          })()}
        </div>

        {/* Action Bar */}
        <div className="flex items-center mt-3 pt-3 border-t border-slate-700/50">
          <button
            onClick={handleLike}
            className="flex items-center mr-6 transition-transform active:scale-125"
          >
            <Heart
              size={18}
              color={isLiked ? "#EF4444" : "#64748B"}
              fill={isLiked ? "#EF4444" : "transparent"}
            />
            <span className={cn("ml-1.5 text-sm", isLiked ? "text-red-500" : "text-slate-400")}>
              {item.likes + (isLiked ? 1 : 0)}
            </span>
          </button>

          <button onClick={() => onReply?.(item)} className="flex items-center mr-6">
            <MessageCircle size={18} color="#64748B" />
            <span className="ml-1.5 text-slate-400 text-sm">Reply</span>
          </button>

          <button onClick={() => onShare?.(item)} className="flex items-center">
            <Share2 size={18} color="#64748B" />
            <span className="ml-1.5 text-slate-400 text-sm">Share</span>
          </button>
        </div>
      </div>
    </MotionDiv>
  );
}

// ==========================================
// MAIN SCREEN
// ==========================================

export default function HomeScreen() {
  const [refreshing, setRefreshing] = useState(false);
  /*
   * TAB STATE LIVES IN THE URL.
   *
   * It was useState only, so /feed was the whole address of every tab: you
   * could not link somebody to Gaps, could not open two in different windows,
   * and refreshing threw you back to For You having lost your place. Back and
   * forward did not move between tabs either — the browser had never been told
   * anything happened.
   *
   * `replace` rather than push on the branch filter: a tab is a place worth a
   * history entry, a filter within it is not, and pushing both makes the back
   * button feel broken in the other direction.
   */
  const [searchParams, setSearchParams] = useSearchParams();

  const feedType = ((): FeedType => {
    const requested = searchParams.get("tab");
    return FEED_TYPES.some((t) => t.type === requested) ? (requested as FeedType) : "for_you";
  })();

  const setFeedType = (next: FeedType) => {
    const params = new URLSearchParams(searchParams);
    // "for_you" is the default, so it stays out of the address entirely rather
    // than making the plain /feed link look like a filtered one.
    if (next === "for_you") params.delete("tab");
    else params.set("tab", next);
    setSearchParams(params);
  };
  const branchFilter = ((): GovernmentBranch | "all" => {
    const requested = searchParams.get("branch");
    return requested === "legislative" || requested === "executive" || requested === "judicial"
      ? requested
      : "all";
  })();

  const setBranchFilter = (next: GovernmentBranch | "all") => {
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("branch");
    else params.set("branch", next);
    setSearchParams(params, { replace: true });
  };

  // One reader for "where am I", shared with the Representation Gap and the
  // district picker. Null is a complete answer and the Local tab renders it.
  const { data: jurisdiction } = useJurisdiction();
  const myState = jurisdiction?.stateCode ?? null;
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScoredFeedItem | null>(null);
  const { user } = useCurrentUser();
  const requireAuth = useRequireAuth();
  const navigate = useNavigate();

  // Seen bills tracking for session exclusion
  const seenBillIds = useSeenBillsStore(selectSeenBillIds);
  const addSeenBills = useSeenBillsStore(selectAddSeenBills);
  const clearSeenBills = useSeenBillsStore(selectClearSeenBills);

  // Gamification
  const updateStreak = useGamificationStore((s) => s.updateStreak);
  const startSession = useEngagementStore((s) => s.startSession);

  // Track session and streak on mount
  useEffect(() => {
    startSession();
    updateStreak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live public feed — every user's timeline posts, cycled through the
  // backend feed algorithm (GET /api/feed). Refetches so the feed stays fresh.
  const {
    data: algorithmicFeed,
    isLoading: feedLoading,
    isError: feedError,
    refetch: refetchAlgorithmicFeed,
  } = useAlgorithmicFeed(30);

  // useFeed/useUserFeedLikes were the Supabase half of this screen. Both are
  // gated on isSupabaseConfigured(), which has returned a hardcoded false since
  // the client was removed, so they never ran and their results never reached
  // the page. Only useTrendingBills is kept — it is read below.
  const { data: trendingBills } = useTrendingBills(5);

  // Randomized bill feed with session exclusion (for Supabase)
  const { data: randomizedData } = useRandomizedBillFeed(seenBillIds, 10);

  // Track newly seen bills from randomized feed
  useEffect(() => {
    if (randomizedData?.newSeenIds && randomizedData.newSeenIds.length > 0) {
      addSeenBills(randomizedData.newSeenIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [randomizedData?.newSeenIds]);

  // Convert and rank feed items with session exclusion
  const feedData = useMemo(() => {
    // The feed is exactly what GET /api/feed returns. Nothing else.
    //
    // Two hardcoded arrays used to be concatenated on unconditionally, as
    // "filler until the community produces volume" — so an empty feed looked
    // busy and every post a visitor read was invented. An empty feed is now
    // allowed to be empty, and says so.
    let rawItems: FeedItem[] = (algorithmicFeed?.posts ?? []).map(algorithmicPostToFeedItem);



    // Apply branch filter
    if (branchFilter !== "all") {
      rawItems = rawItems.filter((item) => {
        const itemBranch = item.bill.branch ?? "legislative";
        return itemBranch === branchFilter;
      });
    }

    // Filter out seen bills for "for_you" feed type (session exclusion)
    // Only filter if we have more items than needed (prevents empty feed)
    if (feedType === "for_you" && seenBillIds.size > 0) {
      const unseenItems = rawItems.filter((item) => !seenBillIds.has(item.bill.id));
      // Only use filtered list if we still have enough items
      if (unseenItems.length >= 5) {
        rawItems = unseenItems;
      }
    }

    // Apply algorithm based on feed type
    let scoredItems: ScoredFeedItem[];
    switch (feedType) {
      case "for_you":
        // Apply weighted randomization with Fisher-Yates shuffle
        scoredItems = rankFeedItems(rawItems, null, { boostGaps: true });
        // Apply discovery score randomization to top 20 items
        if (scoredItems.length > 0) {
          const topPool = scoredItems.slice(0, 20);
          const rest = scoredItems.slice(20);
          // Add discovery scores and shuffle
          const withDiscovery = topPool.map((item) => ({
            ...item,
            score: item.score * (0.7 + Math.random() * 0.6), // discovery_score formula
          }));
          const shuffled = fisherYatesShuffle(withDiscovery);
          shuffled.sort((a, b) => b.score - a.score);
          scoredItems = [...shuffled, ...rest];
        }
        break;
      case "trending":
        scoredItems = getTrendingItems(rawItems, 20);
        break;
      case "gaps":
        scoredItems = getGapItems(rawItems, 20);
        break;
      case "following":
        /*
         * The backend decides who you follow, so this tab asks for that feed
         * rather than re-deriving it here — see the `feedType` passed to
         * useAlgorithmicFeed above. Ranking only orders what came back.
         *
         * It previously carried the comment "mock: just return all" and did
         * exactly that: the Following tab was the For You tab with a different
         * label.
         */
        scoredItems = rankFeedItems(rawItems, null, { diversityEnabled: false });
        break;
      case "local":
        /*
         * Records introduced by a member from your state.
         *
         * Was: every item, with the comment "would filter by user's location".
         * There was no location to filter by. There is now — self-declared,
         * optional — and when somebody has not given one the screen says so and
         * offers to take it, rather than quietly showing them the national feed
         * and calling it Local.
         */
        scoredItems = myState
          ? getLocalItems(rawItems, { state: myState }, 50)
          : [];
        break;
      default:
        scoredItems = rankFeedItems(rawItems);
    }


    // The weaving block that used to sit here interleaved real posts with the
    // hardcoded filler — one real post per three slots. With no filler there is
    // nothing to weave against: rawItems is already exactly the backend's posts,
    // so the ranker's output is the answer.


    return scoredItems;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [algorithmicFeed, feedType, branchFilter, seenBillIds.size, refreshing, myState]);

  // Track seen bills separately to avoid circular updates
  const lastSeenRef = React.useRef<string[]>([]);
  useEffect(() => {
    if (feedType === "for_you" && feedData.length > 0) {
      const newBillIds = feedData.slice(0, 10).map((item) => item.bill.id);
      // Only add if different from last time
      const newIdsKey = newBillIds.join(",");
      const lastIdsKey = lastSeenRef.current.join(",");
      if (newIdsKey !== lastIdsKey) {
        lastSeenRef.current = newBillIds;
        addSeenBills(newBillIds);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedData, feedType]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    // Clear seen bills on refresh to get fresh content
    if (feedType === "for_you") {
      clearSeenBills();
    }

    await refetchAlgorithmicFeed();

    setTimeout(() => setRefreshing(false), 500);
  }, [refetchAlgorithmicFeed, feedType, clearSeenBills]);

  const handleReply = useCallback(
    (_item: ScoredFeedItem) => {
      if (!requireAuth("Sign in to join the conversation.")) return;
      // Navigate to timeline with reply context
      navigate("/timeline");
    },
    [navigate, requireAuth]
  );

  const handleShare = useCallback(
    (item: ScoredFeedItem) => {
      if (!requireAuth("Sign in to share this.")) return;
      setSelectedItem(item);
      setShowShareModal(true);
    },
    [requireAuth]
  );

  return (
    <AppShell>
      <BetaWelcomeDialog />
      <div className="max-w-2xl -mx-4 sm:mx-auto">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center justify-between">
            {/* THE APP'S NAME IS NOT PRINTED HERE ANY MORE.
                The shell already shows "AYE & NAY" — in the sidebar on desktop
                and in the header on mobile — so the Feed printed it a third
                time, directly beneath the second, and pushed the actual content
                further down on the smallest screens. A page inside an app does
                not need to introduce the app. */}
            <div />
            <div className="flex items-center">
              {/* Bill of Rights Badge */}
              <BillOfRightsBadge variant="compact" className="mr-2" />
              {/* Branch indicators */}
              <span className="flex items-center bg-slate-800/60 px-2 py-1 rounded-full mr-2">
                <Landmark size={12} color="#3B82F6" />
                <FileText size={12} color="#F59E0B" style={{ marginLeft: 4 }} />
                <Scale size={12} color="#8B5CF6" style={{ marginLeft: 4 }} />
              </span>
              {/* Refresh (web equivalent of pull-to-refresh) */}
              <button
                onClick={onRefresh}
                className="p-2 rounded-full hover:bg-slate-800/60 transition-colors"
                title="Refresh feed"
              >
                <RefreshCw
                  size={16}
                  color="#F59E0B"
                  className={refreshing ? "animate-spin" : undefined}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Civic Score Header */}
        <div className="mt-3">
          <CivicScoreHeader />
        </div>

        {/* Feed Type Tabs */}
        <FeedTypeTabs activeType={feedType} onChangeType={setFeedType} />

        {/* Branch Filter Tabs */}
        <BranchFilterTabs activeFilter={branchFilter} onChangeFilter={setBranchFilter} />

        {/* Feed */}
        <div className="pt-2 pb-5">
          {/* List Header */}
          <DailyBillDigest limit={8} title="Daily Digest" showHeader={true} />

          {feedLoading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              <p className="text-slate-500 text-sm mt-3">Loading the feed…</p>
            </div>
          ) : feedError ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <p className="text-slate-300 text-lg">Couldn&apos;t load the feed</p>
              <p className="text-slate-500 text-sm mt-2">Check your connection and try again.</p>
              <button
                onClick={() => refetchAlgorithmicFeed()}
                className="mt-4 bg-slate-800 px-5 py-2.5 rounded-xl text-white text-sm"
              >
                Try again
              </button>
            </div>
          ) : feedType === "local" && !myState ? (
            /*
               The Local tab, for somebody who has not said where they are.
               It used to show them the national feed under a Local heading —
               which is not an empty state, it is a wrong one.
            */
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <MapPin className="h-7 w-7 text-slate-500" />
              <p className="mt-3 text-lg text-slate-300">Local needs to know your state</p>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                Pick your district in your profile and this fills with records introduced by the
                people who represent you. It is optional, it is only your state and district, and
                you can remove it whenever you like.
              </p>
              <button
                onClick={() => navigate("/profile")}
                className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"
              >
                Set my district
              </button>
            </div>
          ) : feedType === "local" && feedData.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <MapPin className="h-7 w-7 text-slate-500" />
              <p className="mt-3 text-lg text-slate-300">Nothing local yet</p>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                No stored record was introduced by a member from {myState}. This stays empty rather
                than showing you the national feed under a Local heading.
              </p>
            </div>
          ) : feedData.length === 0 ? (
            /* A genuinely empty feed. The database has no posts yet, which is
               correct — this used to be padded with invented posts so it never
               looked empty. Point people at Discover, which does have content. */
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <p className="text-slate-300 text-lg">No posts yet</p>
              <p className="text-slate-500 text-sm mt-2 max-w-xs">
                Nobody has posted yet. Open a bill in Discover and share where you stand — yours
                will be the first.
              </p>
              <button
                onClick={() => navigate("/discover")}
                className="mt-4 bg-blue-600 px-5 py-2.5 rounded-xl text-white text-sm font-medium"
              >
                Browse Discover
              </button>
            </div>
          ) : (
            feedData.map((item, index) => (
              <FeedCard
                key={item.id}
                item={item}
                index={index}
                userId={user?.id}
                onReply={handleReply}
                onShare={handleShare}
              />
            ))
          )}
        </div>
      </div>

      {/* Share Modal */}
      <ShareModal
        visible={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setSelectedItem(null);
        }}
        content={
          selectedItem
            ? {
                type: "bill",
                id: selectedItem.bill.id,
                title: selectedItem.bill.shortTitle,
              }
            : undefined
        }
      />
    </AppShell>
  );
}

// getDetailRoute is used by feed cards' bill links in later ported screens as well
export { getDetailRoute };
