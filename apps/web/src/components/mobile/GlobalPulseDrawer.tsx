// Web port of mobile/src/components/GlobalPulseDrawer.tsx
import { useMemo } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  X,
  TrendingUp,
  ThumbsUp,
  ThumbsDown,
  Flame,
  ChevronRight,
  Landmark,
  FileText,
  Scale,
  UserPlus,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
// Types only: the store behind them fed the leaderboard that was dropped, and
// nothing here reads its state any more.
import type {
  GlobalEngagementRecord,
  ReferenceType,
} from "@/lib/mobile/global-engagement-store";

// Format large numbers
function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Get icon for reference type
function getReferenceIcon(type: ReferenceType) {
  switch (type) {
    case "bill":
      return <Landmark size={16} color="#3B82F6" />;
    case "executive_order":
      return <FileText size={16} color="#F59E0B" />;
    case "scotus_case":
      return <Scale size={16} color="#8B5CF6" />;
  }
}

// Get color for reference type
function getReferenceColor(type: ReferenceType): string {
  switch (type) {
    case "bill":
      return "#3B82F6";
    case "executive_order":
      return "#F59E0B";
    case "scotus_case":
      return "#8B5CF6";
  }
}

// Trending Reference Card
function TrendingCard({
  record,
  index,
  onPress,
}: {
  record: GlobalEngagementRecord;
  index: number;
  onPress?: () => void;
}) {
  const totalVotes = record.supportVotes + record.opposeVotes;
  const supportPercent = totalVotes > 0 ? Math.round((record.supportVotes / totalVotes) * 100) : 50;
  const color = getReferenceColor(record.referenceType);

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 }}
    >
      <button
        onClick={onPress}
        className="w-full bg-slate-800/70 rounded-xl p-4 mb-3 border border-slate-700/50 text-left"
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center flex-1">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mr-3 shrink-0"
              style={{ backgroundColor: `${color}20` }}
            >
              {getReferenceIcon(record.referenceType)}
            </div>
            <div className="flex-1">
              <p className="text-white font-semibold text-sm line-clamp-2">{record.title}</p>
              <p className="text-slate-500 text-xs mt-0.5 uppercase">{record.referenceId}</p>
            </div>
          </div>
          <div className="flex items-center bg-amber-500/20 px-2 py-1 rounded-full shrink-0">
            <Flame size={12} color="#F59E0B" />
            <span className="text-amber-500 text-xs font-medium ml-1">#{index + 1}</span>
          </div>
        </div>

        {/* Vote Bar */}
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${supportPercent}%` }} />
        </div>

        {/* Stats Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <ThumbsUp size={14} color="#22C55E" />
            <span className="text-emerald-500 text-sm font-medium ml-1">
              {formatCount(record.supportVotes)}
            </span>
            <ThumbsDown size={14} color="#EF4444" className="ml-3" />
            <span className="text-red-500 text-sm font-medium ml-1">
              {formatCount(record.opposeVotes)}
            </span>
          </div>
          <span className="text-slate-500 text-xs">{formatCount(totalVotes)} total votes</span>
        </div>

        {/* Top Contributors */}
        {record.topContributors.length > 0 ? (
          <div className="flex items-center mt-3 pt-3 border-t border-slate-700/50">
            <span className="text-slate-500 text-xs mr-2">Top Leaders:</span>
            <div className="flex items-center flex-1">
              {record.topContributors.slice(0, 3).map((contributor, idx) => (
                <img
                  key={contributor.userId}
                  src={contributor.avatar}
                  alt={contributor.username}
                  className="w-5 h-5 rounded-full border border-slate-800"
                  style={{ marginLeft: idx > 0 ? -8 : 0 }}
                />
              ))}
              {record.topContributors.length > 0 ? (
                <span className="text-slate-400 text-xs ml-1">
                  @{record.topContributors[0].username}
                  {record.topContributors.length > 1 ? ` +${record.topContributors.length - 1}` : ""}
                </span>
              ) : null}
            </div>
            <ChevronRight size={14} color="#64748B" />
          </div>
        ) : null}
      </button>
    </MotionDiv>
  );
}

// One row of the engagement leaderboard
export default function GlobalPulseDrawer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  /**
   * THE PULSE IS THE PLATFORM'S, NOT THIS BROWSER'S.
   *
   * Reported as "there is nothing really inside of it not sure if that's
   * because a lack of content so far on the platform". It was not a content
   * shortage. This panel read a zustand store filled in as YOU used the app, so
   * it could only ever show what this one browser had done — empty in a fresh
   * session, empty on a second device, and never anybody else's activity. A
   * "global pulse" that is local is the one thing it must not be.
   *
   * /api/government-references/trending is the real ranking, across everybody.
   */
  const { data: pulse } = useQuery({
    queryKey: ["global-pulse", 7],
    queryFn: () =>
      api.get<{
        days: number;
        records: Array<{
          id: string;
          title: string;
          referenceType: string;
          category: string | null;
          recentVotes: number;
          recentPosts: number;
          activity: number;
          supportVotes: number;
          opposeVotes: number;
        }>;
      }>("/api/government-references/pulse?days=7&limit=5"),
    enabled: visible,
  });

  const trendingReferences = useMemo(
    () =>
      (pulse?.records ?? []).map((record) => ({
        referenceId: record.id,
        referenceType: record.referenceType,
        title: record.title,
        supportVotes: record.supportVotes,
        opposeVotes: record.opposeVotes,
        commentCount: record.recentPosts,
        shareCount: 0,
        trendingScore: record.activity,
        // NOT SYNTHESISED. Naming who voted on what is precisely what this
        // platform promises never to publish.
        topContributors: [],
      })) as unknown as GlobalEngagementRecord[],
    [pulse],
  );


  return (
    <Sheet open={visible} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent
        side="bottom"
        className="bg-slate-900 border-slate-800 p-0 max-w-lg mx-auto rounded-t-3xl h-[85vh] flex flex-col overflow-hidden [&>button]:hidden bg-gradient-to-b from-slate-800 to-slate-900"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="w-10 h-1 bg-slate-600 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-4 shrink-0">
          <div className="flex items-center">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center mr-3">
              <TrendingUp size={20} color="#F59E0B" />
            </div>
            <div>
              <p className="text-white font-bold text-xl">Global Pulse</p>
              <p className="text-slate-400 text-sm">Real-time civic engagement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"
          >
            <X size={18} color="#94A3B8" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-10">
          {/* Trending Section */}
          <div className="mb-6">
            <div className="flex items-center mb-4">
              <Flame size={18} color="#F59E0B" />
              <span className="text-white font-semibold text-lg ml-2">Trending Now</span>
              <span className="ml-auto bg-amber-500/20 px-2 py-0.5 rounded-full text-amber-500 text-xs font-medium">
                LIVE
              </span>
            </div>

            {trendingReferences.length === 0 ? (
              // Nothing moved in the last week. Said plainly rather than filled
              // with the biggest records of all time pretending to be current.
              <p className="text-slate-400 text-sm">
                Nothing has moved in the last seven days. Vote on a law or post about one and it
                shows up here.
              </p>
            ) : (
              trendingReferences.map((record, idx) => (
                <TrendingCard key={record.referenceId} record={record} index={idx} />
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
