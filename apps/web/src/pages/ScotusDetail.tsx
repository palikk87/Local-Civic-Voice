// Web port of mobile/src/app/scotus/[id].tsx
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
  Users,
  Clock,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Scale,
  Calendar,
  Gavel,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import { justices } from "@/lib/mobile/government-data";
import { publicUrlFor } from "@/lib/config";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import { useVotingStore, selectUserVote } from "@/lib/mobile/voting-store";
import { useRequireAuth } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";
import type { SupremeCourtCase, JusticeVote } from "@/lib/mobile/types";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { ShareToTimeline } from "@/components/civic/ShareToTimeline";
import { PulseBar } from "@/components/civic/PulseBar";
import { useCitizenBrief } from "@/hooks/use-citizen-brief";
import {
  useGovernmentReference,
} from "@/hooks/use-government-references";
import { referenceToScotusCase } from "@/lib/mobile/reference-mappers";

type ViewMode = "brief" | "question" | "opinion" | "impact";

function ViewModeButton({
  label,
  isActive,
  onPress,
  iconType,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  iconType: ViewMode;
}) {
  const iconColor = isActive ? "#0F172A" : "#8B5CF6";
  const renderIcon = () => {
    switch (iconType) {
      case "brief":
        return <Sparkles size={16} color={iconColor} />;
      case "question":
        return <HelpCircle size={16} color={iconColor} />;
      case "opinion":
        return <Gavel size={16} color={iconColor} />;
      case "impact":
        return <Users size={16} color={iconColor} />;
    }
  };

  return (
    <button
      onClick={onPress}
      className={cn(
        "flex items-center px-4 py-2.5 rounded-xl mr-2 shrink-0",
        isActive ? "bg-purple-500" : "bg-slate-800"
      )}
    >
      {renderIcon()}
      <span className={cn("ml-2 font-medium", isActive ? "text-white" : "text-slate-300")}>{label}</span>
    </button>
  );
}

function CaseStatusBadge({
  status,
  outcome,
}: {
  status: SupremeCourtCase["status"];
  outcome?: SupremeCourtCase["outcome"];
}) {
  const statusConfig = {
    pending: { color: "#F59E0B", bgColor: "bg-amber-900/50", label: "Pending" },
    argued: { color: "#3B82F6", bgColor: "bg-blue-900/50", label: "Argued" },
    decided: { color: "#22C55E", bgColor: "bg-emerald-900/50", label: "Decided" },
    dismissed: { color: "#64748B", bgColor: "bg-slate-700", label: "Dismissed" },
    remanded: { color: "#8B5CF6", bgColor: "bg-purple-900/50", label: "Remanded" },
  } as const;

  const outcomeLabels: Record<string, string> = {
    affirmed: "Affirmed",
    reversed: "Reversed",
    vacated: "Vacated",
    remanded: "Remanded",
    dismissed: "Dismissed",
    per_curiam: "Per Curiam",
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center">
      <span className={cn("inline-flex items-center px-3 py-1.5 rounded-full", config.bgColor)}>
        {status === "decided" ? (
          <CheckCircle size={14} color={config.color} />
        ) : status === "argued" ? (
          <Gavel size={14} color={config.color} />
        ) : (
          <Clock size={14} color={config.color} />
        )}
        <span className="ml-1.5 font-medium text-sm" style={{ color: config.color }}>
          {config.label}
        </span>
      </span>
      {outcome ? (
        <span className="bg-slate-700 px-3 py-1.5 rounded-full ml-2">
          <span className="text-slate-300 text-sm font-medium">{outcomeLabels[outcome]}</span>
        </span>
      ) : null}
    </div>
  );
}

function JusticeVoteCard({ vote }: { vote: JusticeVote }) {
  const justice = justices.find((j) => j.name.includes(vote.justiceName));

  const voteColors: Record<string, { bg: string; text: string; label: string }> = {
    majority: { bg: "bg-emerald-900/50", text: "text-emerald-400", label: "Majority" },
    dissent: { bg: "bg-red-900/50", text: "text-red-400", label: "Dissent" },
    concurrence: { bg: "bg-blue-900/50", text: "text-blue-400", label: "Concur" },
    concur_in_part: { bg: "bg-purple-900/50", text: "text-purple-400", label: "Concur in Part" },
  };

  const voteStyle = voteColors[vote.vote] || voteColors.majority;

  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/30 last:border-b-0">
      <div className="flex items-center flex-1">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center mr-2",
            justice?.ideology === "conservative" ? "bg-red-900/30" : "bg-blue-900/30"
          )}
        >
          <span
            className={cn("text-xs font-bold", justice?.ideology === "conservative" ? "text-red-400" : "text-blue-400")}
          >
            {vote.justiceName.charAt(0)}
          </span>
        </div>
        <div className="flex-1">
          <p className="text-white font-medium text-sm">{vote.justiceName}</p>
          {vote.wroteOpinion ? <p className="text-slate-400 text-xs">Wrote opinion</p> : null}
        </div>
      </div>
      <span className={cn("px-2 py-1 rounded-full", voteStyle.bg)}>
        <span className={cn("text-xs font-medium", voteStyle.text)}>{voteStyle.label}</span>
      </span>
    </div>
  );
}

export default function ScotusDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("brief");

  // Static landmark cases resolve locally; daily-synced cases come from the backend.
  // Every case comes from GET /api/government-references/:id.
  //
  // The hardcoded array that used to be checked first also gated this query
  // via `enabled: !staticCase`, so for those ids the real fetch never ran.
  const { data: refData, isLoading: refLoading, isError, refetch } = useGovernmentReference(id);
  const scotusCase =
    refData?.reference?.referenceType === "scotus_case"
      ? referenceToScotusCase(refData.reference)
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
        <p className="text-slate-400">Loading case...</p>
      </div>
    );
  }

  // A failed request is not a missing case.
  if (isError) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Couldn&apos;t load this case</p>
        <p className="text-slate-400 text-sm mt-2">Check your connection and try again.</p>
        <button onClick={() => refetch()} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Try again
        </button>
      </div>
    );
  }

  if (!scotusCase) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Case not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Go Back
        </button>
      </div>
    );
  }

  const categoryColor = categoryColors[scotusCase.category] ?? "#64748B";
  const yeaPercentage = Math.round((scotusCase.communityVotes.yea / (scotusCase.communityVotes.totalVoters || 1)) * 100);
  const nayPercentage = scotusCase.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: "yea" | "nay") => {
    if (!requireAuth("Sign in to cast your vote on this case.")) return;
    // One central vote per citizen per law, same record every surface uses.
    void castReferenceVote(scotusCase.id, yeaNayToPosition(vote)).catch(() => {
      toast.error("Could not record your vote. Please try again.");
    });
  };

  const handleBookmark = () => {
    if (!requireAuth("Sign in to save cases to your library.")) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth("Sign in to share this case.")) return;
    const shareUrl = publicUrlFor(`/reference/${scotusCase.id}`);
    const shareText = `${scotusCase.caseName}\n\n${shareUrl}`;
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText, url: shareUrl });
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
            <span className="bg-purple-500/20 px-3 py-1 rounded-full mr-2">
              <span className="text-purple-400 text-sm font-semibold">Supreme Court</span>
            </span>
          </div>

          <div className="flex">
            <button onClick={handleBookmark} className="bg-slate-800 p-2 rounded-full mr-2">
              <Bookmark size={20} color="#64748B" />
            </button>
            <button onClick={handleShare} className="bg-slate-800 p-2 rounded-full mr-2">
              <Share2 size={20} color="#64748B" />
            </button>
            {/*
              SHARE TO TIMELINE, which this page did not have at all.
              ShareToTimeline was only on the Discover cards, so the one screen
              where somebody has actually read the law was the one screen they
              could not say anything about it from.
            */}
            <ShareToTimeline
              target={{
                branch: "judicial",
                title: scotusCase.caseName,
                masterReferenceId: scotusCase.id,
              }}
              label=""
            />
          </div>
        </div>

        <div className="flex-1 pb-32 max-w-3xl w-full mx-auto">
          {/* Case Header */}
          <div className="px-4 py-4">
            <div className="flex items-center flex-wrap mb-3 gap-2">
              <span className="bg-purple-500/20 px-3 py-1 rounded-full">
                <span className="text-purple-400 text-sm font-semibold">{scotusCase.docketNumber}</span>
              </span>
              <span
                className="px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
              >
                {categoryLabels[scotusCase.category]}
              </span>
              <CaseStatusBadge status={scotusCase.status} outcome={scotusCase.outcome} />
            </div>

            <h1 className="text-white font-bold text-2xl mb-2">{scotusCase.shortName}</h1>
            <p className="text-slate-400 text-base leading-6">{scotusCase.caseName}</p>

            {/* Court Info */}
            <div className="flex items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Scale size={20} color="#8B5CF6" />
              </div>
              <div className="ml-3 flex-1">
                <p className="text-white font-medium">{scotusCase.term} Term</p>
                <p className="text-slate-400 text-sm">From {scotusCase.lowerCourt}</p>
              </div>
              {scotusCase.voteBreakdown ? (
                <span className="bg-slate-700 px-3 py-1.5 rounded-full">
                  <span className="text-white font-bold">
                    {scotusCase.voteBreakdown.majority}-{scotusCase.voteBreakdown.dissent}
                  </span>
                </span>
              ) : null}
            </div>

            {/* Dates */}
            <div className="flex mt-3 flex-wrap gap-4">
              {scotusCase.arguedDate ? (
                <div className="flex items-center">
                  <Gavel size={14} color="#64748B" />
                  <span className="text-slate-400 text-sm ml-1.5">
                    Argued {new Date(scotusCase.arguedDate).toLocaleDateString()}
                  </span>
                </div>
              ) : null}
              {scotusCase.decidedDate ? (
                <div className="flex items-center">
                  <Calendar size={14} color="#64748B" />
                  <span className="text-slate-400 text-sm ml-1.5">
                    Decided {new Date(scotusCase.decidedDate).toLocaleDateString()}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Parties */}
            <div className="mt-3 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <div className="flex items-center mb-2">
                <span className="text-slate-400 text-sm w-24 shrink-0">Petitioner:</span>
                <span className="text-white flex-1">{scotusCase.petitioner}</span>
              </div>
              <div className="flex items-center">
                <span className="text-slate-400 text-sm w-24 shrink-0">Respondent:</span>
                <span className="text-white flex-1">{scotusCase.respondent}</span>
              </div>
            </div>

            {/* CourtListener Link */}
            {scotusCase.courtListenerUrl ? (
              <a
                href={scotusCase.courtListenerUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center mt-3 bg-purple-900/30 px-4 py-2.5 rounded-xl border border-purple-700/30"
              >
                <ExternalLink size={16} color="#8B5CF6" />
                <span className="text-purple-400 font-medium ml-2 flex-1">View Full Opinion on CourtListener</span>
              </a>
            ) : null}
          </div>

          {/* Justice Votes */}
          {scotusCase.justiceVotes && scotusCase.justiceVotes.length > 0 ? (
            <div className="px-4 mb-4">
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white font-semibold">Justice Votes</span>
                  {scotusCase.voteBreakdown ? (
                    <div className="flex items-center">
                      <span className="bg-emerald-900/50 px-2 py-1 rounded-full mr-2">
                        <span className="text-emerald-400 text-sm font-medium">
                          {scotusCase.voteBreakdown.majority} Majority
                        </span>
                      </span>
                      <span className="bg-red-900/50 px-2 py-1 rounded-full">
                        <span className="text-red-400 text-sm font-medium">{scotusCase.voteBreakdown.dissent} Dissent</span>
                      </span>
                    </div>
                  ) : null}
                </div>
                {scotusCase.justiceVotes.map((vote, index) => (
                  <JusticeVoteCard key={index} vote={vote} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Community Vote Stats */}
          <div className="px-4 mb-4">
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-white font-semibold">Community Opinion</span>
                <span className="text-slate-400 text-sm">
                  {scotusCase.communityVotes.totalVoters.toLocaleString()} votes
                </span>
              </div>

              <PulseBar yea={scotusCase.communityVotes.yea} nay={scotusCase.communityVotes.nay} height="h-3" className="mb-3" />

              <div className="flex justify-between">
                <div className="flex items-center">
                  <ThumbsUp size={16} color="#22C55E" />
                  <span className="text-emerald-500 font-semibold ml-1.5">{yeaPercentage}% Agree</span>
                  <span className="text-slate-500 text-sm ml-1">({scotusCase.communityVotes.yea.toLocaleString()})</span>
                </div>
                <div className="flex items-center">
                  <span className="text-slate-500 text-sm mr-1">({scotusCase.communityVotes.nay.toLocaleString()})</span>
                  <span className="text-red-500 font-semibold mr-1.5">{nayPercentage}% Disagree</span>
                  <ThumbsDown size={16} color="#EF4444" />
                </div>
              </div>
            </div>
          </div>

          {/* View Mode Tabs */}
          <div className="px-4 mb-4">
            <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ViewModeButton label="Citizen's Brief" isActive={viewMode === "brief"} onPress={() => setViewMode("brief")} iconType="brief" />
              <ViewModeButton label="Question" isActive={viewMode === "question"} onPress={() => setViewMode("question")} iconType="question" />
              {scotusCase.majorityOpinion || scotusCase.dissentOpinion ? (
                <ViewModeButton label="Opinions" isActive={viewMode === "opinion"} onPress={() => setViewMode("opinion")} iconType="opinion" />
              ) : null}
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
                emptyDescription={"A plain-English summary of this opinion, written only from its complete official text — plus the case for it and the case against it"}
                sourceUrl={scotusCase.courtListenerUrl}
                sourceLabel={"Read the full opinion on CourtListener"}
              />
            ) : null}

            {viewMode === "question" ? (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center mb-3">
                  <HelpCircle size={20} color="#8B5CF6" />
                  <span className="text-white font-semibold text-lg ml-2">Question Presented</span>
                </div>
                <p className="text-slate-300 leading-6 font-mono text-sm whitespace-pre-wrap">
                  {scotusCase.questionPresented}
                </p>
              </div>
            ) : null}

            {viewMode === "opinion" ? (
              <div>
                {scotusCase.majorityOpinion ? (
                  <div className="bg-emerald-900/20 rounded-xl p-4 border border-emerald-700/30 mb-4">
                    <div className="flex items-center mb-3">
                      <CheckCircle size={20} color="#22C55E" />
                      <span className="text-emerald-400 font-semibold text-lg ml-2">Majority Opinion</span>
                    </div>
                    <p className="text-slate-300 leading-6">{scotusCase.majorityOpinion}</p>
                  </div>
                ) : null}

                {scotusCase.dissentOpinion ? (
                  <div className="bg-red-900/20 rounded-xl p-4 border border-red-700/30">
                    <div className="flex items-center mb-3">
                      <XCircle size={20} color="#EF4444" />
                      <span className="text-red-400 font-semibold text-lg ml-2">Dissenting Opinion</span>
                    </div>
                    <p className="text-slate-300 leading-6">{scotusCase.dissentOpinion}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {viewMode === "impact" ? (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center mb-3">
                  <Users size={20} color="#8B5CF6" />
                  <span className="text-white font-semibold text-lg ml-2">Real-World Impact</span>
                </div>
                <p className="text-slate-300 leading-6">{scotusCase.realWorldImpact}</p>
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
                Agree
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
                Disagree
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
