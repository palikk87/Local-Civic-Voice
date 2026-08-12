// Web port of mobile/src/components/GlobalPulseDrawer.tsx
import { useMemo } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  X,
  TrendingUp,
  Award,
  ThumbsUp,
  ThumbsDown,
  Flame,
  Crown,
  Medal,
  ChevronRight,
  Landmark,
  FileText,
  Scale,
  UserPlus,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import {
  useGlobalEngagementStore,
  type GlobalEngagementRecord,
  type CivilLeader,
  type ReferenceType,
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

// Civil Leader Card
function LeaderCard({
  leader,
  index,
  onFollow,
}: {
  leader: CivilLeader;
  index: number;
  onFollow?: (userId: string) => void;
}) {
  const RankIcon = index === 0 ? Crown : index === 1 ? Medal : Award;
  const rankColor = index === 0 ? "#F59E0B" : index === 1 ? "#94A3B8" : "#CD7F32";

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <div className="flex items-center bg-slate-800/50 rounded-xl p-3 mb-2">
        {/* Rank */}
        <div className="w-8 flex items-center justify-center mr-3 shrink-0">
          {index < 3 ? (
            <RankIcon size={20} color={rankColor} />
          ) : (
            <span className="text-slate-500 font-bold">{index + 1}</span>
          )}
        </div>

        {/* Avatar */}
        <img src={leader.avatar} alt={leader.displayName} className="w-10 h-10 rounded-full" />

        {/* Info */}
        <div className="flex-1 ml-3 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{leader.displayName}</p>
          <p className="text-slate-500 text-xs">@{leader.username}</p>
        </div>

        {/* Stats */}
        <div className="flex flex-col items-end mr-3 shrink-0">
          <span className="text-amber-500 font-bold text-sm">
            {formatCount(leader.totalEngagementDriven)}
          </span>
          <span className="text-slate-500 text-xs">engagement</span>
        </div>

        {/* Follow Button */}
        <button
          onClick={() => onFollow?.(leader.userId)}
          className="bg-amber-500 px-3 py-1.5 rounded-full shrink-0"
        >
          <UserPlus size={14} color="#000" />
        </button>
      </div>
    </MotionDiv>
  );
}

// Main Drawer Component
export default function GlobalPulseDrawer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  // Select raw data from store (stable references)
  const engagementRecords = useGlobalEngagementStore((s) => s.engagementRecords);
  const civilLeadersData = useGlobalEngagementStore((s) => s.civilLeaders);

  // Compute derived data outside selector to prevent infinite loops
  const trendingReferences = useMemo(() => {
    const records = Object.values(engagementRecords);
    return records.sort((a, b) => b.trendingScore - a.trendingScore).slice(0, 5);
  }, [engagementRecords]);

  const civilLeaders = useMemo(() => civilLeadersData.slice(0, 10), [civilLeadersData]);

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

            {trendingReferences.map((record, idx) => (
              <TrendingCard key={record.referenceId} record={record} index={idx} />
            ))}
          </div>

          {/* Civil Leaders Section */}
          <div>
            <div className="flex items-center mb-4">
              <Crown size={18} color="#F59E0B" />
              <span className="text-white font-semibold text-lg ml-2">Civil Leaders</span>
              <span className="text-slate-500 text-xs ml-auto">Top engagement drivers</span>
            </div>

            {civilLeaders.map((leader, idx) => (
              <LeaderCard key={leader.userId} leader={leader} index={idx} onFollow={() => undefined} />
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
