// Web port of mobile/src/app/executive-order/[id].tsx
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from "@/lib/mobile/reference-votes";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Bookmark,
  FileText,
  Users,
  Clock,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  RotateCcw,
  Calendar,
  Sparkles,
} from "lucide-react";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import { useVotingStore, selectUserVote } from "@/lib/mobile/voting-store";
import { useRequireAuth } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";
import type { ExecutiveOrder } from "@/lib/mobile/types";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { useCitizenBrief } from "@/hooks/use-citizen-brief";
import {
  useGovernmentReference,
} from "@/hooks/use-government-references";
import { referenceToExecutiveOrder } from "@/lib/mobile/reference-mappers";

type ViewMode = "brief" | "full" | "impact";

function ViewModeButton({
  label,
  isActive,
  onPress,
  iconType,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  iconType: "brief" | "full" | "impact";
}) {
  const iconColor = isActive ? "#0F172A" : "#F59E0B";
  const renderIcon = () => {
    switch (iconType) {
      case "brief":
        return <Sparkles size={16} color={iconColor} />;
      case "full":
        return <FileText size={16} color={iconColor} />;
      case "impact":
        return <Users size={16} color={iconColor} />;
    }
  };

  return (
    <button
      onClick={onPress}
      className={cn(
        "flex items-center px-4 py-2.5 rounded-xl mr-2 shrink-0",
        isActive ? "bg-amber-500" : "bg-slate-800"
      )}
    >
      {renderIcon()}
      <span className={cn("ml-2 font-medium", isActive ? "text-slate-900" : "text-slate-300")}>{label}</span>
    </button>
  );
}

function StatusBadge({ status }: { status: ExecutiveOrder["status"] }) {
  const statusConfig = {
    active: { color: "#22C55E", bgColor: "bg-emerald-900/50", label: "Active", Icon: CheckCircle },
    revoked: { color: "#EF4444", bgColor: "bg-red-900/50", label: "Revoked", Icon: XCircle },
    superseded: { color: "#F59E0B", bgColor: "bg-amber-900/50", label: "Superseded", Icon: RotateCcw },
    expired: { color: "#64748B", bgColor: "bg-slate-700", label: "Expired", Icon: Clock },
    partially_revoked: { color: "#F97316", bgColor: "bg-orange-900/50", label: "Partially Revoked", Icon: AlertCircle },
  } as const;

  const config = statusConfig[status];
  const IconComponent = config.Icon;

  return (
    <span className={cn("inline-flex items-center px-3 py-1.5 rounded-full", config.bgColor)}>
      <IconComponent size={14} color={config.color} />
      <span className="ml-1.5 font-medium text-sm" style={{ color: config.color }}>
        {config.label}
      </span>
    </span>
  );
}

export default function ExecutiveOrderDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("brief");

  // Every order comes from GET /api/government-references/:id.
  //
  // This used to check a hardcoded array first and pass `enabled: !staticEo`
  // into the query — so for any id that appeared in that array the real fetch
  // never ran at all, and the page rendered invented content. Removing the
  // import alone would not have fixed it; the gate had to go too.
  const { data: refData, isLoading: refLoading, isError, refetch } = useGovernmentReference(id);
  const eo =
    refData?.reference?.referenceType === "executive_order"
      ? referenceToExecutiveOrder(refData.reference)
      : undefined;
  const userVote = useVotingStore(selectUserVote(id ?? ""));
  const requireAuth = useRequireAuth();

  // Mirror the server's record of my vote so every card for this law agrees.
  // Brief stored on the master reference — written once, read by everyone after.
  // Asked for, never automatic. The brief is written from the full official
  // text of this document and nothing else, so it costs a real read — that
  // is a choice the reader makes, not a side effect of opening the page.
  const citizenBrief = useCitizenBrief(refData?.reference?.id, {
    initialBrief: refData?.reference?.citizenBriefSections ?? null,
    initialState: refData?.reference?.briefState ?? "idle",
  });

  const serverUserVote = refData?.reference?.userVote;
  useEffect(() => {
    if (id && serverUserVote !== undefined) {
      syncServerVote(id, serverUserVote);
    }
  }, [id, serverUserVote]);

  if (refLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading executive order...</p>
      </div>
    );
  }

  // A failed request is not a missing order. Saying "not found" for a network
  // error sends people looking for the wrong problem, and offers nothing to do.
  if (isError) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Couldn&apos;t load this executive order</p>
        <p className="text-slate-400 text-sm mt-2">Check your connection and try again.</p>
        <button onClick={() => refetch()} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Try again
        </button>
      </div>
    );
  }

  if (!eo) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Executive Order not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Go Back
        </button>
      </div>
    );
  }

  const categoryColor = categoryColors[eo.category] ?? "#64748B";
  const yeaPercentage = Math.round((eo.communityVotes.yea / (eo.communityVotes.totalVoters || 1)) * 100);
  const nayPercentage = eo.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: "yea" | "nay") => {
    if (!requireAuth("Sign in to cast your vote on this executive order.")) return;
    // One central vote per citizen per law, same record every surface uses.
    void castReferenceVote(eo.id, yeaNayToPosition(vote)).catch(() => {
      toast.error("Could not record your vote. Please try again.");
    });
  };

  const handleBookmark = () => {
    if (!requireAuth("Sign in to save executive orders to your library.")) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth("Sign in to share this executive order.")) return;
    const shareText = `Check out this Executive Order: ${eo.title}\n\nVote on Civic Voice!`;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
      } else {
        await navigator.clipboard.writeText(shareText);
      }
    } catch {
      // Share cancelled or failed
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 relative">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: "linear-gradient(180deg, #0F172A, #1E293B, #0F172A)" }}
      />

      <div className="relative flex flex-col min-h-screen">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 sticky top-0 bg-slate-900/95 backdrop-blur z-10">
          <button onClick={() => navigate(-1)} className="bg-slate-800 p-2 rounded-full">
            <ArrowLeft size={22} color="#fff" />
          </button>

          <div className="flex items-center">
            <span className="bg-amber-500/20 px-3 py-1 rounded-full mr-2">
              <span className="text-amber-500 text-sm font-semibold">Executive Order</span>
            </span>
          </div>

          <div className="flex">
            <button onClick={handleBookmark} className="bg-slate-800 p-2 rounded-full mr-2">
              <Bookmark size={20} color="#64748B" />
            </button>
            <button onClick={handleShare} className="bg-slate-800 p-2 rounded-full">
              <Share2 size={20} color="#64748B" />
            </button>
          </div>
        </div>

        <div className="flex-1 pb-32 max-w-3xl w-full mx-auto">
          {/* EO Header */}
          <div className="px-4 py-4">
            <div className="flex items-center flex-wrap mb-3 gap-2">
              <span className="bg-amber-500/20 px-3 py-1 rounded-full">
                <span className="text-amber-500 text-sm font-semibold">{eo.eoNumber}</span>
              </span>
              <span
                className="px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
              >
                {categoryLabels[eo.category]}
              </span>
              <StatusBadge status={eo.status} />
            </div>

            <h1 className="text-white font-bold text-2xl mb-2">{eo.shortTitle}</h1>
            <p className="text-slate-400 text-base leading-6">{eo.title}</p>

            {/* President Info */}
            <div className="flex items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                <FileText size={20} color="#F59E0B" />
              </div>
              <div className="ml-3 flex-1">
                <p className="text-white font-medium">Signed by {eo.president}</p>
                <p className="text-slate-400 text-sm">President of the United States</p>
              </div>
            </div>

            {/* Dates */}
            <div className="flex mt-3 flex-wrap gap-4">
              <div className="flex items-center">
                <Calendar size={14} color="#64748B" />
                <span className="text-slate-400 text-sm ml-1.5">
                  Signed {new Date(eo.signedDate).toLocaleDateString()}
                </span>
              </div>
              {eo.publishedDate ? (
                <div className="flex items-center">
                  <Clock size={14} color="#64748B" />
                  <span className="text-slate-400 text-sm ml-1.5">
                    Published {new Date(eo.publishedDate).toLocaleDateString()}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Federal Register Link */}
            {eo.federalRegisterUrl ? (
              <a
                href={eo.federalRegisterUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center mt-3 bg-blue-900/30 px-4 py-2.5 rounded-xl border border-blue-700/30"
              >
                <ExternalLink size={16} color="#3B82F6" />
                <span className="text-blue-400 font-medium ml-2 flex-1">View on Federal Register</span>
                <span className="text-blue-500 text-xs">{eo.federalRegisterNumber}</span>
              </a>
            ) : null}

            {/* Revoked By Info */}
            {eo.revokedBy ? (
              <div className="mt-3 bg-red-900/20 px-4 py-3 rounded-xl border border-red-700/30">
                <div className="flex items-center">
                  <XCircle size={16} color="#EF4444" />
                  <span className="text-red-400 font-medium ml-2">Revoked by {eo.revokedBy}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* Community Vote Stats */}
          <div className="px-4 mb-4">
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-semibold">Community Opinion</span>
                <span className="text-slate-400 text-sm">{eo.communityVotes.totalVoters.toLocaleString()} votes</span>
              </div>

              <div className="h-3 bg-slate-700 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-emerald-500 rounded-l-full" style={{ width: `${yeaPercentage}%` }} />
              </div>

              <div className="flex justify-between">
                <div className="flex items-center">
                  <ThumbsUp size={16} color="#22C55E" />
                  <span className="text-emerald-500 font-semibold ml-1.5">{yeaPercentage}% Support</span>
                  <span className="text-slate-500 text-sm ml-1">({eo.communityVotes.yea.toLocaleString()})</span>
                </div>
                <div className="flex items-center">
                  <span className="text-slate-500 text-sm mr-1">({eo.communityVotes.nay.toLocaleString()})</span>
                  <span className="text-red-500 font-semibold mr-1.5">{nayPercentage}% Oppose</span>
                  <ThumbsDown size={16} color="#EF4444" />
                </div>
              </div>
            </div>
          </div>

          {/* View Mode Tabs */}
          <div className="px-4 mb-4">
            <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ViewModeButton label="Brief" isActive={viewMode === "brief"} onPress={() => setViewMode("brief")} iconType="brief" />
              <ViewModeButton label="Full Text" isActive={viewMode === "full"} onPress={() => setViewMode("full")} iconType="full" />
              <ViewModeButton label="Impact" isActive={viewMode === "impact"} onPress={() => setViewMode("impact")} iconType="impact" />
            </div>
          </div>

          {/* Content */}
          <div className="px-4">
            {viewMode === "brief" ? (
              <CitizensBriefCard
                state={citizenBrief.state}
                brief={citizenBrief.brief}
                reason={citizenBrief.reason}
                isRequesting={citizenBrief.isRequesting}
                onRequest={citizenBrief.request}
                onRewrite={citizenBrief.brief ? citizenBrief.rewrite : undefined}
                emptyDescription={"A plain-English summary of this order, written only from its complete official text — plus the case for it and the case against it"}
                sourceUrl={eo.federalRegisterUrl}
                sourceLabel={"View the full text on the Federal Register"}
              />
            ) : null}

            {viewMode === "full" ? (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center mb-3">
                  <FileText size={20} color="#F59E0B" />
                  <span className="text-white font-semibold text-lg ml-2">Full Executive Order Text</span>
                </div>
                <p className="text-slate-300 leading-6 font-mono text-sm whitespace-pre-wrap">{eo.fullText}</p>
              </div>
            ) : null}

            {viewMode === "impact" ? (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center mb-3">
                  <Users size={20} color="#F59E0B" />
                  <span className="text-white font-semibold text-lg ml-2">Real-World Impact</span>
                </div>
                <p className="text-slate-300 leading-6">{eo.realWorldImpact}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Fixed Vote Buttons */}
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-800 px-4 py-4 backdrop-blur">
          <div className="flex max-w-3xl mx-auto">
            <button
              onClick={() => handleVote("yea")}
              className={cn(
                "flex-1 flex items-center justify-center py-4 rounded-xl mr-2 transition-transform active:scale-95",
                userVote === "yea" ? "bg-emerald-600" : "bg-emerald-900/60"
              )}
            >
              <ThumbsUp size={22} color={userVote === "yea" ? "#fff" : "#22C55E"} />
              <span className={cn("ml-2 font-bold text-lg", userVote === "yea" ? "text-white" : "text-emerald-500")}>
                Support
              </span>
            </button>

            <button
              onClick={() => handleVote("nay")}
              className={cn(
                "flex-1 flex items-center justify-center py-4 rounded-xl ml-2 transition-transform active:scale-95",
                userVote === "nay" ? "bg-red-600" : "bg-red-900/60"
              )}
            >
              <ThumbsDown size={22} color={userVote === "nay" ? "#fff" : "#EF4444"} />
              <span className={cn("ml-2 font-bold text-lg", userVote === "nay" ? "text-white" : "text-red-500")}>
                Oppose
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
