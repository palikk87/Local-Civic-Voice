/**
 * PulseGap Component (web port of mobile/src/components/PulseGap.tsx)
 *
 * Visualizes the "Representation Gap" - the discrepancy between
 * public sentiment (AYE & NAY votes) and official Congressional votes.
 */
import { AlertTriangle, Users, Building2, Share2, ChevronRight } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { useRequireAuth } from "@/hooks/use-civic-auth";

import type { RepresentationGap } from "@/lib/mobile/types";
import {
  getGapSeverity,
  getGapColor,
  getGapDescription,
  generateShareText,
} from "@/lib/mobile/representation-gap";

interface PulseGapProps {
  gap: RepresentationGap;
  onPress?: () => void;
  compact?: boolean;
}

export function PulseGap({ gap, onPress, compact = false }: PulseGapProps) {
  const severity = getGapSeverity(gap);
  const severityColor = getGapColor(severity);
  const requireAuth = useRequireAuth();

  const handleShare = async () => {
    if (!requireAuth("Sign in to share this representation gap.")) return;
    const shareText = generateShareText(gap);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Representation Gap Detected", text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
      }
    } catch {
      // Share cancelled or failed
    }
  };

  if (compact) {
    return (
      <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <button
          onClick={onPress}
          className="overflow-hidden rounded-2xl w-full text-left relative"
          style={
            gap.hasSignificantGap
              ? { boxShadow: `0 0 0 2px ${severityColor}80` }
              : undefined
          }
        >
          <div
            className="p-4"
            style={{
              backgroundColor: gap.hasSignificantGap
                ? "rgba(239, 68, 68, 0.1)"
                : "rgba(255, 255, 255, 0.05)",
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {gap.hasSignificantGap ? <AlertTriangle size={16} color={severityColor} /> : null}
                <span
                  className="text-xs font-bold tracking-widest uppercase"
                  style={{ color: gap.hasSignificantGap ? severityColor : "#9CA3AF" }}
                >
                  {gap.hasSignificantGap ? "GAP DETECTED" : "ALIGNED"}
                </span>
              </div>
              <span className="text-2xl font-black text-white">
                {Math.round(gap.gapPercentage)}%
              </span>
            </div>

            {/* Compact bars */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users size={12} color="#60A5FA" />
                <div className="flex-1 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${gap.publicApprovalPct}%`, backgroundColor: "#3B82F6" }}
                  />
                </div>
                <span className="text-xs font-semibold text-blue-400 w-10 text-right">
                  {Math.round(gap.publicApprovalPct)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 size={12} color="#A78BFA" />
                <div className="flex-1 h-2 rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${gap.officialApprovalPct}%`, backgroundColor: "#8B5CF6" }}
                  />
                </div>
                <span className="text-xs font-semibold text-purple-400 w-10 text-right">
                  {Math.round(gap.officialApprovalPct)}%
                </span>
              </div>
            </div>
          </div>
        </button>
      </MotionDiv>
    );
  }

  return (
    <MotionDiv initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }}>
      <div
        className="overflow-hidden rounded-3xl"
        style={
          gap.hasSignificantGap ? { boxShadow: `0 0 0 3px ${severityColor}80` } : undefined
        }
      >
        <div
          className="p-5 rounded-3xl"
          style={{
            background: gap.hasSignificantGap
              ? "linear-gradient(135deg, rgba(127, 29, 29, 0.9), rgba(55, 48, 48, 0.95))"
              : "linear-gradient(135deg, rgba(39, 39, 42, 0.9), rgba(24, 24, 27, 0.95))",
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex-1 mr-4">
              {gap.hasSignificantGap ? (
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={18} color={severityColor} />
                  <span
                    className="text-xs font-black tracking-[0.2em] uppercase"
                    style={{ color: severityColor }}
                  >
                    REPRESENTATION GAP
                  </span>
                </div>
              ) : null}
              <p className="text-lg font-bold text-white leading-tight line-clamp-2">
                {gap.billTitle}
              </p>
            </div>

            {/* Gap percentage badge */}
            <div
              className="flex flex-col items-center justify-center rounded-2xl px-4 py-2"
              style={{
                backgroundColor: gap.hasSignificantGap
                  ? `${severityColor}30`
                  : "rgba(255, 255, 255, 0.1)",
              }}
            >
              <span
                className="text-3xl font-black"
                style={{ color: gap.hasSignificantGap ? severityColor : "#FFFFFF" }}
              >
                {Math.round(gap.gapPercentage)}
              </span>
              <span
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: gap.hasSignificantGap ? severityColor : "#9CA3AF" }}
              >
                % Gap
              </span>
            </div>
          </div>

          {/* Vote comparison bars */}
          <div className="mb-5">
            {/* Public Vote Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <Users size={16} color="#3B82F6" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Public Voice</p>
                    <p className="text-gray-400 text-xs">AYE & NAY Users</p>
                  </div>
                </div>
                <span className="text-2xl font-black text-blue-400">
                  {Math.round(gap.publicApprovalPct)}%
                </span>
              </div>
              <div className="h-4 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${gap.publicApprovalPct}%`,
                    background: "linear-gradient(to right, #3B82F6, #60A5FA)",
                  }}
                />
              </div>
            </div>

            {/* Official Vote Bar */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <Building2 size={16} color="#8B5CF6" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Congress Vote</p>
                    <p className="text-gray-400 text-xs">Official Record</p>
                  </div>
                </div>
                <span className="text-2xl font-black text-purple-400">
                  {Math.round(gap.officialApprovalPct)}%
                </span>
              </div>
              <div className="h-4 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${gap.officialApprovalPct}%`,
                    background: "linear-gradient(to right, #8B5CF6, #A78BFA)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Description */}
          <p className="text-gray-300 text-sm leading-relaxed mb-5">{getGapDescription(gap)}</p>

          {/* Actions */}
          <div className="flex gap-3">
            {gap.hasSignificantGap ? (
              <button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl"
                style={{ backgroundColor: `${severityColor}30` }}
              >
                <Share2 size={18} color={severityColor} />
                <span className="font-bold text-sm" style={{ color: severityColor }}>
                  Share the Gap
                </span>
              </button>
            ) : null}
            {onPress ? (
              <button
                onClick={onPress}
                className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/10"
              >
                <span className="text-white font-bold text-sm">View Bill</span>
                <ChevronRight size={18} color="#FFFFFF" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </MotionDiv>
  );
}

/**
 * Mini badge version for bill cards
 */
export function PulseGapBadge({ gap }: { gap: RepresentationGap }) {
  const severity = getGapSeverity(gap);
  const severityColor = getGapColor(severity);

  if (!gap.hasSignificantGap) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
        <span className="text-xs font-semibold text-green-400">Aligned</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full"
      style={{ backgroundColor: `${severityColor}20` }}
    >
      <AlertTriangle size={12} color={severityColor} />
      <span className="text-xs font-bold" style={{ color: severityColor }}>
        {Math.round(gap.gapPercentage)}% Gap
      </span>
    </span>
  );
}
