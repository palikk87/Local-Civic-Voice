// Web port of mobile/src/components/DailyBillDigest.tsx
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Scale, Users, FileEdit, ChevronRight, Zap, Award, Loader2 } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { DailyDigestBill } from "@/lib/mobile/hooks";
import { useTrendingReferences, useLatestReferences } from "@/hooks/use-government-references";
import { referenceToBill } from "@/lib/mobile/reference-mappers";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import type { Bill as AppBill } from "@/lib/mobile/types";
import {
  calculateVoiceWeight,
  getWeightTier,
  getWeightTierColor,
  getWeightTierLabel,
  getStatusLabel,
  type WeightTier,
} from "@/lib/mobile/voice-weight";
import type { Bill, BillCategory } from "@/lib/mobile/types";
import type { BillStatus, ProjectedOutcome } from "@/lib/mobile/database.types";
import { cn } from "@/lib/utils";

// Map app bill status to database status
function mapStatusToDbStatus(status: Bill["status"]): BillStatus {
  if (status === "signed_into_law") return "enacted";
  return status as BillStatus;
}

// Map app projected outcome to database type
function mapOutcomeToDbOutcome(outcome: Bill["projectedOutcome"]): ProjectedOutcome {
  if (outcome === "unlikely_pass") return "likely_fail";
  return outcome as ProjectedOutcome;
}

// Convert mock bill to digest bill with calculated weight
function convertToDigestBill(bill: Bill): DailyDigestBill & { weightTier: WeightTier } {
  // Generate mock cosponsor/amendment counts based on status for demo
  const statusMultipliers: Record<string, { cosponsor: number; amendment: number }> = {
    introduced: { cosponsor: 5, amendment: 0 },
    in_committee: { cosponsor: 15, amendment: 2 },
    passed_house: { cosponsor: 50, amendment: 8 },
    passed_senate: { cosponsor: 45, amendment: 6 },
    enacted: { cosponsor: 100, amendment: 15 },
    signed_into_law: { cosponsor: 120, amendment: 20 },
  };

  const multiplier = statusMultipliers[bill.status] || statusMultipliers.introduced;
  const cosponsorCount = multiplier.cosponsor + Math.floor(Math.random() * 20);
  const amendmentCount = multiplier.amendment + Math.floor(Math.random() * 5);

  const weightResult = calculateVoiceWeight({
    status: mapStatusToDbStatus(bill.status),
    cosponsorCount,
    amendmentCount,
  });

  const dbStatus = mapStatusToDbStatus(bill.status);
  const dbOutcome = mapOutcomeToDbOutcome(bill.projectedOutcome);

  return {
    id: bill.id,
    congress_number: 119, // Default to current congress
    bill_number: bill.congressNumber || null,
    title: bill.title,
    short_title: bill.shortTitle,
    status: dbStatus,
    chamber: bill.chamber,
    sponsor_id: bill.sponsor?.id || null,
    introduced_date: bill.introducedDate,
    last_action_date: bill.lastActionDate,
    category: bill.category,
    full_text: bill.fullText,
    simplified_text: bill.simplifiedText,
    real_world_impact: bill.realWorldImpact,
    projected_outcome: dbOutcome,
    yea_count: bill.communityVotes.yea,
    nay_count: bill.communityVotes.nay,
    total_votes: bill.communityVotes.totalVoters,
    official_yea: bill.officialVotes?.yea || null,
    official_nay: bill.officialVotes?.nay || null,
    official_present: bill.officialVotes?.abstain || null,
    official_not_voting: bill.officialVotes?.notVoting || null,
    is_trending: true,
    view_count: 0,
    cosponsor_count: cosponsorCount,
    amendment_count: amendmentCount,
    weight_score: weightResult.weightScore,
    weight_last_calculated: new Date().toISOString(),
    created_at: bill.introducedDate,
    updated_at: bill.lastActionDate,
    weightTier: getWeightTier(weightResult.weightScore),
  };
}

interface WeightBadgeProps {
  weightScore: number;
  size?: "sm" | "md";
}

function WeightBadge({ weightScore, size = "sm" }: WeightBadgeProps) {
  const tier = getWeightTier(weightScore);
  const color = getWeightTierColor(tier);
  const label = getWeightTierLabel(tier);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full",
        size === "sm" ? "px-2 py-0.5" : "px-3 py-1"
      )}
      style={{ backgroundColor: `${color}20` }}
    >
      <Zap size={size === "sm" ? 10 : 12} color={color} />
      <span className={cn("font-bold ml-1", size === "sm" ? "text-xs" : "text-sm")} style={{ color }}>
        {Math.round(weightScore)}
      </span>
      {size === "md" ? (
        <span className="text-xs ml-1" style={{ color }}>
          {label}
        </span>
      ) : null}
    </span>
  );
}

interface DigestBillCardProps {
  bill: DailyDigestBill & { weightTier: WeightTier };
  index: number;
  onPress: () => void;
}

function DigestBillCard({ bill, index, onPress }: DigestBillCardProps) {
  const categoryColor = categoryColors[bill.category as BillCategory] || "#64748B";
  const tierColor = getWeightTierColor(bill.weightTier);

  return (
    <MotionDiv
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, duration: 0.3 }}
      className="shrink-0"
    >
      <button
        onClick={onPress}
        className="bg-slate-800/70 rounded-xl p-3 mr-3 border text-left hover:bg-slate-800 transition-colors"
        style={{ width: 260, borderColor: `${tierColor}30` }}
      >
        {/* Header with rank and weight */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center mr-2"
              style={{ backgroundColor: `${tierColor}20` }}
            >
              <span className="text-xs font-bold" style={{ color: tierColor }}>
                {index + 1}
              </span>
            </span>
            <WeightBadge weightScore={bill.weight_score} />
          </div>
          <span
            className="px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${categoryColor}30` }}
          >
            <span style={{ color: categoryColor }} className="text-xs font-medium">
              {categoryLabels[bill.category as BillCategory]}
            </span>
          </span>
        </div>

        {/* Title */}
        <p className="text-white font-semibold text-sm mb-2 line-clamp-2">{bill.short_title}</p>

        {/* Stats Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="flex items-center mr-3">
              <Users size={12} color="#64748B" />
              <span className="text-slate-400 text-xs ml-1">{bill.cosponsor_count}</span>
            </span>
            <span className="flex items-center">
              <FileEdit size={12} color="#64748B" />
              <span className="text-slate-400 text-xs ml-1">{bill.amendment_count}</span>
            </span>
          </div>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full",
              bill.status === "passed_house" || bill.status === "passed_senate"
                ? "bg-emerald-900/50"
                : bill.status === "in_committee"
                ? "bg-blue-900/50"
                : "bg-slate-700"
            )}
          >
            <span
              className={cn(
                "text-xs",
                bill.status === "passed_house" || bill.status === "passed_senate"
                  ? "text-emerald-400"
                  : bill.status === "in_committee"
                  ? "text-blue-400"
                  : "text-slate-400"
              )}
            >
              {getStatusLabel(bill.status)}
            </span>
          </span>
        </div>
      </button>
    </MotionDiv>
  );
}

interface DailyBillDigestProps {
  limit?: number;
  category?: BillCategory;
  showHeader?: boolean;
  title?: string;
}

export function DailyBillDigest({
  limit = 10,
  category,
  showHeader = true,
  title = "Daily Bill Digest",
}: DailyBillDigestProps) {
  const navigate = useNavigate();

  // The Supabase digest query used to sit here as a second source. It is gated
  // on isSupabaseConfigured(), which has returned a hardcoded false since the
  // client was removed, so it never ran.

  // Live daily-synced bills — the SAME source and query cache the Discover page
  // uses, so whatever Discover pulls each day shows up here automatically.
  const { data: latestRefs, isLoading: latestLoading } = useLatestReferences("bill", 30);
  const { data: trendingRefs, isLoading: trendingLoading } = useTrendingReferences("bill", 10);
  const isLoading = latestLoading || trendingLoading;

  // Calculate weights for bills from the live daily-synced references.
  const digestBills = useMemo(() => {
    const seen = new Set<string>();
    const liveBills: AppBill[] = [
      ...(latestRefs?.references ?? []).map(referenceToBill),
      ...(trendingRefs?.references ?? []).map(referenceToBill),
    ].filter((bill) => {
      if (seen.has(bill.id)) return false;
      seen.add(bill.id);
      return true;
    });

    if (liveBills.length > 0) {
      return liveBills
        .filter((bill) => !category || bill.category === category)
        .map(convertToDigestBill)
        .sort((a, b) => b.weight_score - a.weight_score)
        .slice(0, limit);
    }

    // Nothing from the API means nothing to show. A hardcoded array used to
    // stand in here, so an unreachable backend produced a full digest of
    // invented bills.
    return [];
  }, [latestRefs, trendingRefs, category, limit]);

  if (digestBills.length === 0 && isLoading) {
    return (
      <div className="px-4 py-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-amber-500" />
      </div>
    );
  }

  if (digestBills.length === 0) {
    return null;
  }

  return (
    <div className="mb-4">
      {showHeader ? (
        <div className="px-4 mb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="bg-amber-500/20 p-1.5 rounded-full mr-2">
                <Scale size={16} color="#F59E0B" />
              </span>
              <div>
                <p className="text-white font-semibold text-lg">{title}</p>
                <p className="text-slate-400 text-xs">Sorted by Voice Weight score</p>
              </div>
            </div>
            <button onClick={() => navigate("/discover")} className="flex items-center">
              <span className="text-amber-500 text-sm font-medium mr-1">See all</span>
              <ChevronRight size={16} color="#F59E0B" />
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex overflow-x-auto px-4 pb-1 scrollbar-none">
        {digestBills.map((bill, index) => (
          <DigestBillCard
            key={bill.id}
            bill={bill as DailyDigestBill & { weightTier: WeightTier }}
            index={index}
            onPress={() => navigate(`/bill/${bill.id}`)}
          />
        ))}
      </div>

      {/* Weight Legend */}
      <div className="flex items-center justify-center mt-3 px-4">
        <span className="text-slate-500 text-xs mr-2">Weight:</span>
        {(["critical", "high", "medium", "low"] as WeightTier[]).map((tier) => (
          <span key={tier} className="flex items-center mr-3">
            <span
              className="w-2 h-2 rounded-full mr-1"
              style={{ backgroundColor: getWeightTierColor(tier) }}
            />
            <span className="text-slate-500 text-xs">{getWeightTierLabel(tier)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Compact version for smaller spaces
export function CompactDailyDigest({ limit = 5 }: { limit?: number }) {
  const navigate = useNavigate();
  // Same live daily-synced source as Discover. The loading flag used to come
  // from a Supabase digest query gated on isSupabaseConfigured(), which has
  // returned a hardcoded false since the client was removed — so the spinner
  // was driven by a request that never ran.
  const { data: latestRefs, isLoading } = useLatestReferences("bill", 30);

  const digestBills = useMemo(() => {
    const liveBills = (latestRefs?.references ?? []).map(referenceToBill);
    if (liveBills.length > 0) {
      return liveBills
        .map(convertToDigestBill)
        .sort((a, b) => b.weight_score - a.weight_score)
        .slice(0, limit);
    }

    return [];
  }, [latestRefs, limit]);

  if (digestBills.length === 0 && isLoading) {
    return (
      <div className="py-2 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
      <div className="flex items-center mb-2">
        <Award size={14} color="#F59E0B" />
        <span className="text-white font-medium text-sm ml-1.5">Top Weighted Bills</span>
      </div>
      {digestBills.slice(0, 3).map((bill, index) => (
        <button
          key={bill.id}
          onClick={() => navigate(`/bill/${bill.id}`)}
          className="w-full flex items-center py-2 border-b border-slate-700/30 last:border-b-0 text-left"
        >
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center mr-2"
            style={{ backgroundColor: `${getWeightTierColor(bill.weightTier)}20` }}
          >
            <span
              className="text-xs font-bold"
              style={{ color: getWeightTierColor(bill.weightTier) }}
            >
              {index + 1}
            </span>
          </span>
          <span className="text-slate-200 text-sm flex-1 truncate">{bill.short_title}</span>
          <WeightBadge weightScore={bill.weight_score} size="sm" />
        </button>
      ))}
    </div>
  );
}

export default DailyBillDigest;
