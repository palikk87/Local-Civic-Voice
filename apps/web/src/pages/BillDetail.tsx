// Web port of mobile/src/app/bill/[id].tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Bookmark,
  FileText,
  Lightbulb,
  Scale,
  Users,
  Clock,
  Building2,
  ExternalLink,
  AlertCircle,
  MessageCircle,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import { useVotingStore, selectUserVote } from "@/lib/mobile/voting-store";
import {
  castReferenceVote,
  syncServerVote,
  yeaNayToPosition,
} from "@/lib/mobile/reference-votes";
import { toast } from "sonner";
import { useRequireAuth } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";
import {
  analyzeBillImpact,
  generateDebatePoints,
  getAIAvailability,
} from "@/lib/mobile/ai-service";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { useCitizenBrief } from "@/hooks/use-citizen-brief";
import { NewsReelCarousel } from "@/components/mobile/NewsReelCarousel";
import { TransparencyIndicator, ArticleBadge } from "@/components/mobile/BillOfRightsBadge";
import { PulseBar } from "@/components/civic/PulseBar";
import { RepresentationGapPanel } from "@/components/civic/RepresentationGapPanel";
import type { Bill, Representative } from "@/lib/mobile/types";
import { useTimelineStore } from "@/lib/mobile/timeline-store";
import { bills } from "@/lib/mobile/mock-data";
import { fetchBillSponsor } from "@/lib/mobile/government-api";
import {
  useGovernmentReference,
} from "@/hooks/use-government-references";
import { referenceToBill } from "@/lib/mobile/reference-mappers";

type ViewMode = "simplified" | "full" | "impact" | "related";

function AIImpactSection({ bill }: { bill: Bill }) {
  const [showDebate, setShowDebate] = useState(false);

  const { data: analysisData, isLoading: analysisLoading } = useQuery({
    queryKey: ["bill-analysis", bill.id],
    queryFn: () => analyzeBillImpact(bill),
    staleTime: 1000 * 60 * 30,
  });

  const { data: debateData, isLoading: debateLoading } = useQuery({
    queryKey: ["bill-debate", bill.id],
    queryFn: () => generateDebatePoints(bill),
    enabled: showDebate,
    staleTime: 1000 * 60 * 30,
  });

  const analysis = analysisData?.data;
  const { data: aiAvailable } = useQuery({
    queryKey: ["ai-availability"],
    queryFn: getAIAvailability,
  });

  return (
    <div>
      {/* Static Impact */}
      <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-4">
        <div className="flex items-center mb-3">
          <Users size={20} color="#F59E0B" />
          <span className="text-white font-semibold text-lg ml-2">Real-World Impact</span>
        </div>
        <p className="text-slate-300 leading-6">{bill.realWorldImpact}</p>
      </div>

      {/* AI Analysis */}
      {aiAvailable?.openai ? (
        <div className="rounded-xl p-4 border border-amber-700/30 mb-4 bg-gradient-to-br from-amber-900/30 to-slate-800/60">
          <div className="flex items-center mb-3">
            <Sparkles size={20} color="#F59E0B" />
            <span className="text-amber-400 font-semibold text-lg ml-2">AI Analysis</span>
          </div>

          {analysisLoading ? (
            <div className="py-6 flex flex-col items-center">
              <Loader2 size={20} color="#F59E0B" className="animate-spin" />
              <p className="text-slate-400 mt-2">Analyzing bill...</p>
            </div>
          ) : analysis ? (
            <div>
              <p className="text-slate-300 leading-6 mb-4">{analysis.summary}</p>

              <div className="mb-3">
                <p className="text-emerald-400 font-semibold mb-2">Potential Benefits</p>
                {analysis.pros.map((pro, i) => (
                  <div key={i} className="flex items-start mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-2 mr-2 shrink-0" />
                    <span className="text-slate-300 flex-1">{pro}</span>
                  </div>
                ))}
              </div>

              <div className="mb-3">
                <p className="text-red-400 font-semibold mb-2">Potential Concerns</p>
                {analysis.cons.map((con, i) => (
                  <div key={i} className="flex items-start mb-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-2 mr-2 shrink-0" />
                    <span className="text-slate-300 flex-1">{con}</span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-slate-400 font-medium mb-2">Who This Affects</p>
                <div className="flex flex-wrap">
                  {analysis.impactedGroups.map((group, i) => (
                    <span key={i} className="bg-slate-700/50 px-3 py-1.5 rounded-full mr-2 mb-2 text-slate-300 text-sm">
                      {group}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-slate-400">Unable to load AI analysis</p>
          )}
        </div>
      ) : null}

      {/* Debate Points */}
      {aiAvailable?.openai ? (
        <div className="bg-slate-800/60 rounded-xl border border-slate-700/40">
          <button
            onClick={() => setShowDebate(true)}
            className="w-full flex items-center justify-between p-4"
          >
            <div className="flex items-center">
              <MessageCircle size={20} color="#64748B" />
              <span className="text-white font-semibold ml-2">See Both Sides</span>
            </div>
            {showDebate ? <ChevronUp size={20} color="#64748B" /> : <ChevronDown size={20} color="#64748B" />}
          </button>

          {showDebate ? (
            <div className="px-4 pb-4 border-t border-slate-700/50">
              {debateLoading ? (
                <div className="py-6 flex flex-col items-center">
                  <Loader2 size={20} color="#F59E0B" className="animate-spin" />
                  <p className="text-slate-400 mt-2">Generating arguments...</p>
                </div>
              ) : debateData?.data ? (
                <p className="text-slate-300 leading-6 mt-3 whitespace-pre-wrap">{debateData.data}</p>
              ) : (
                <p className="text-slate-400 mt-3">Tap to load debate points</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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
  const iconColor = isActive ? "#0F172A" : "#F59E0B";
  const renderIcon = () => {
    switch (iconType) {
      case "simplified":
        return <Lightbulb size={16} color={iconColor} />;
      case "full":
        return <FileText size={16} color={iconColor} />;
      case "impact":
        return <Users size={16} color={iconColor} />;
      case "related":
        return <Scale size={16} color={iconColor} />;
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
      <span className={cn("ml-2 font-medium", isActive ? "text-slate-900" : "text-slate-300")}>
        {label}
      </span>
    </button>
  );
}

/**
 * Stand-in when a bill"s sponsor cannot be resolved.
 *
 * The fallbacks this replaces printed a REAL member of Congress — `representatives[0]`,
 * or a random pick — as the sponsor of a bill they may have nothing to do with.
 * Naming the wrong legislator is worse than admitting we do not know.
 */
const UNKNOWN_SPONSOR: Representative = {
  id: "unknown",
  name: "Sponsor unknown",
  party: "I",
  state: "",
  district: undefined,
  chamber: "house",
  imageUrl: "",
  contactPhone: "",
  website: "",
};

export default function BillDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("simplified");

  // Every bill comes from GET /api/government-references/:id.
  //
  // Two hardcoded arrays used to be searched first, and the winner was passed
  // as `enabled: !bill` into this query — so for any id in either array the
  // real fetch never ran. Deleting the imports alone would not have fixed that;
  // the gate had to go with them.
  const {
    data: billRefData,
    isLoading: billRefLoading,
    isError: billRefError,
    refetch: refetchBill,
  } = useGovernmentReference(id);
  let bill: Bill | undefined;
  // Brief stored on the master reference — written once, read by everyone after.
  // Asked for, never automatic. Writing a brief means reading the whole bill,
  // so it is a choice the reader makes rather than a cost of opening the page.
  const citizenBrief = useCitizenBrief(billRefData?.reference?.id, {
    initialBrief: billRefData?.reference?.citizenBriefSections ?? null,
    initialState: billRefData?.reference?.briefState ?? "idle",
  });
  if (billRefData?.reference?.referenceType === "bill") {
    bill = referenceToBill(billRefData.reference);
  }

  const timelinePosts = useTimelineStore((s) => s.posts);
  const libraryPost = !bill
    ? timelinePosts.find((p) => p.sharedContent?.id === id && p.source === "library")
    : null;

  /**
   * Last resort: one of the sixteen bills kept for the Related Laws panel.
   *
   * ORDER MATTERS AND IS THE WHOLE POINT. This is read only after the API
   * query has finished and produced nothing, and after the library-post path
   * has produced nothing. The version of this that had to be deleted searched
   * a hardcoded array FIRST and then passed `enabled: !bill` into the query, so
   * for any id in that array the real fetch never ran at all and a live record
   * could never win. A real record always wins now, and this only fills a gap
   * the server could not.
   *
   * Their vote counts are zero and their sponsor is unknown — see mock-data.ts
   * for what was stripped and why.
   */
  const fallbackBill =
    !bill && !libraryPost && !billRefLoading ? bills.find((b) => b.id === id) : undefined;

  const { data: sponsorInfo } = useQuery({
    queryKey: ["billSponsor", libraryPost?.sharedContent?.sourceUrl],
    queryFn: () => fetchBillSponsor(libraryPost?.sharedContent?.sourceUrl ?? ""),
    enabled: !!libraryPost?.sharedContent?.sourceUrl,
    staleTime: 1000 * 60 * 60,
  });

  if (!bill && libraryPost) {
    const sponsor = sponsorInfo
      ? {
          id: sponsorInfo.bioguideId ?? "unknown",
          name: sponsorInfo.name,
          party: sponsorInfo.party as "R" | "D" | "I",
          state: sponsorInfo.state,
          district: sponsorInfo.district,
          chamber: "house" as const,
          imageUrl: sponsorInfo.imageUrl ?? "",
          contactPhone: "",
          website: "",
        }
      : UNKNOWN_SPONSOR;

    const titleText = libraryPost.sharedContent?.title ?? "Unknown Bill";
    const aiBriefText = libraryPost.aiBrief ?? "";
    const contentText = libraryPost.content ?? "";

    const simplifiedTextValue =
      aiBriefText ||
      contentText ||
      `${titleText}. This document was sourced from an official government database. Click the source link to view the full text.`;

    const fullTextValue = aiBriefText
      ? `${titleText}\n\n${aiBriefText}\n\n[Full text available at the official source. Click the source link above to view the complete document.]`
      : `${titleText}\n\n[Full text available at the official source. Click the source link above to view the complete document.]`;

    bill = {
      id: id ?? "",
      title: titleText,
      shortTitle: titleText.slice(0, 60),
      status: "introduced",
      chamber: "house",
      sponsor,
      introducedDate: new Date().toISOString().split("T")[0],
      lastActionDate: new Date().toISOString().split("T")[0],
      category: (libraryPost.sharedContent?.category ?? "economy") as Bill["category"],
      congressUrl: libraryPost.sharedContent?.sourceUrl,
      fullText: fullTextValue,
      simplifiedText: simplifiedTextValue,
      // No fallback sentence. This used to read "This legislation could have
      // significant impact on citizens" whenever the sharer had written
      // nothing — a claim about a specific law's real-world effect, asserted by
      // the app, true of every law and therefore about none of them. An empty
      // string renders nothing, which is what we actually know.
      realWorldImpact: libraryPost.opinion ?? "",
      relatedLaws: [],
      // A library item is a document someone saved, not a reference the
      // platform tracks, so it has no tallies. These used to be
      // Math.random() — invented numbers rendered as real citizen votes, and
      // different on every page load.
      communityVotes: { yea: 0, nay: 0, totalVoters: 0 },
      projectedOutcome: "uncertain",
      branch: "legislative",
    };
  }

  const userVote = useVotingStore(selectUserVote(id ?? ""));
  const requireAuth = useRequireAuth();

  // The server knows my standing vote on this law (cast from any surface, any
  // device). Mirror it locally so this page and every card agree.
  const serverUserVote = billRefData?.reference?.userVote;
  useEffect(() => {
    if (id && serverUserVote !== undefined) {
      syncServerVote(id, serverUserVote);
    }
  }, [id, serverUserVote]);

  if (billRefLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <p className="text-slate-400">Loading bill...</p>
      </div>
    );
  }

  // The fallback, applied after every live path has had its turn.
  if (!bill && fallbackBill) {
    bill = fallbackBill;
  }

  // A failed request is not a missing bill.
  if (!bill && billRefError) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Couldn&apos;t load this bill</p>
        <p className="text-slate-400 text-sm mt-2">Check your connection and try again.</p>
        <button onClick={() => refetchBill()} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Try again
        </button>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center">
        <AlertCircle size={48} color="#EF4444" />
        <p className="text-white text-lg mt-4">Bill not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 bg-slate-800 px-6 py-3 rounded-xl text-white">
          Go Back
        </button>
      </div>
    );
  }

  const categoryColor = categoryColors[bill.category] ?? "#64748B";
  const yeaPercentage = Math.round((bill.communityVotes.yea / (bill.communityVotes.totalVoters || 1)) * 100);
  const nayPercentage = bill.communityVotes.totalVoters > 0 ? 100 - yeaPercentage : 0;

  const handleVote = (vote: "yea" | "nay") => {
    if (!requireAuth("Sign in to cast your vote on this bill.")) return;
    // One central vote per citizen per law — same record the timeline,
    // feed and library vote into. Voting the same way again removes it.
    void castReferenceVote(bill!.id, yeaNayToPosition(vote)).catch(() => {
      toast.error("Could not record your vote. Please try again.");
    });
  };

  const handleBookmark = () => {
    if (!requireAuth("Sign in to save bills to your library.")) return;
    // Saving to the library isn't wired up yet — signed-in users see no change.
  };

  const handleShare = async () => {
    if (!requireAuth("Sign in to share this bill.")) return;
    const shareText = `Check out this bill: ${bill!.title}\n\nVote on AYE & NAY!`;
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

  const statusLabels: Record<string, string> = {
    introduced: "Introduced",
    in_committee: "In Committee",
    passed_house: "Passed House",
    passed_senate: "Passed Senate",
    enacted: "Enacted",
    vetoed: "Vetoed",
    signed_into_law: "Signed Into Law",
  };

  const relationshipLabels: Record<string, string> = {
    amends: "Amends",
    conflicts: "Conflicts With",
    supports: "Supports",
    references: "References",
  };

  const lawTypeLabels: Record<string, string> = {
    statutory: "Statutory Law",
    case_law: "Case Law",
    regulation: "Regulation",
    constitutional: "Constitutional",
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
          {/* Bill Header */}
          <div className="px-4 py-4">
            <div className="flex items-center mb-3 flex-wrap gap-2">
              <span
                className="px-3 py-1 rounded-full text-sm font-medium"
                style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
              >
                {categoryLabels[bill.category]}
              </span>
              <span
                className={cn(
                  "px-3 py-1 rounded-full text-sm font-medium",
                  bill.chamber === "house" ? "bg-blue-900/50 text-blue-400" : "bg-purple-900/50 text-purple-400"
                )}
              >
                {bill.chamber === "house" ? "House" : "Senate"}
              </span>
              <span className="bg-slate-700 px-3 py-1 rounded-full text-slate-300 text-sm font-medium">
                {statusLabels[bill.status]}
              </span>
            </div>

            <h1 className="text-white font-bold text-2xl mb-2">{bill.shortTitle}</h1>
            <p className="text-slate-400 text-base leading-6">{bill.title}</p>

            {/* Sponsor */}
            <div className="flex items-center mt-4 bg-slate-800/50 rounded-xl p-3 border border-slate-700/50">
              <img src={bill.sponsor.imageUrl} alt={bill.sponsor.name} className="w-10 h-10 rounded-full object-cover" />
              <div className="ml-3 flex-1">
                <p className="text-white font-medium">Sponsored by {bill.sponsor.name}</p>
                <p className="text-slate-400 text-sm">
                  {bill.sponsor.party === "D" ? "Democrat" : bill.sponsor.party === "R" ? "Republican" : "Independent"} -{" "}
                  {bill.sponsor.state}
                </p>
              </div>
              <span
                className={cn(
                  "px-2 py-1 rounded-full font-semibold",
                  bill.sponsor.party === "D"
                    ? "bg-blue-900/50 text-blue-400"
                    : bill.sponsor.party === "R"
                    ? "bg-red-900/50 text-red-400"
                    : "bg-purple-900/50 text-purple-400"
                )}
              >
                {bill.sponsor.party}
              </span>
            </div>

            {/* Dates */}
            <div className="flex mt-3 flex-wrap gap-4">
              <div className="flex items-center">
                <Clock size={14} color="#64748B" />
                <span className="text-slate-400 text-sm ml-1.5">
                  Introduced {new Date(bill.introducedDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center">
                <Building2 size={14} color="#64748B" />
                <span className="text-slate-400 text-sm ml-1.5">
                  Last action {new Date(bill.lastActionDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          {/* Community Vote Stats */}
          <div className="px-4 mb-4">
            <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <span className="text-white font-semibold">Community Vote</span>
                  <span className="ml-2">
                    <ArticleBadge articleNumber="III" size="sm" />
                  </span>
                </div>
                <span className="text-slate-400 text-sm">
                  {bill.communityVotes.totalVoters.toLocaleString()} votes
                </span>
              </div>

              <PulseBar yea={bill.communityVotes.yea} nay={bill.communityVotes.nay} height="h-3" className="mb-3" />

              <div className="flex justify-between">
                <div className="flex items-center">
                  <ThumbsUp size={16} color="#22C55E" />
                  <span className="text-emerald-500 font-semibold ml-1.5">{yeaPercentage}% Yea</span>
                  <span className="text-slate-500 text-sm ml-1">({bill.communityVotes.yea.toLocaleString()})</span>
                </div>
                <div className="flex items-center">
                  <span className="text-slate-500 text-sm mr-1">({bill.communityVotes.nay.toLocaleString()})</span>
                  <span className="text-red-500 font-semibold mr-1.5">{nayPercentage}% Nay</span>
                  <ThumbsDown size={16} color="#EF4444" />
                </div>
              </div>

              {/* PROJECTED OUTCOME IS GONE. Khalid's call, and the right one:
                  it was a prediction the platform had no basis for. Where it
                  had any input at all it came from gapStats(), which derived
                  the chamber's vote from a hash of the record's id — so the
                  "projection" was a restatement of a fabricated number. What
                  the chamber actually did, when it has done it, is below. */}
              {bill.officialVotes ? (
                <div className="flex items-center justify-end mt-4 pt-4 border-t border-slate-700/50">
                  <div>
                    <p className="text-slate-400 text-xs mb-1 text-right">Official Vote</p>
                    <div className="flex items-center">
                      <span className="text-emerald-500 font-medium mr-2">{bill.officialVotes.yea} Y</span>
                      <span className="text-red-500 font-medium">{bill.officialVotes.nay} N</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* The Gap — always rendered. It used to be hidden whenever the
              client-side `officialVotes` was absent, which is every record
              Congress has not voted on yet, so the platform's headline feature
              was silently missing from most pages. */}
          <div className="px-4 mb-4">
            <RepresentationGapPanel referenceId={billRefData?.reference?.id} />
          </div>

          {/* Vote Transparency */}
          <div className="px-4 mb-4">
            <TransparencyIndicator referenceId={billRefData?.reference?.id} />
          </div>

          {/* News Coverage Carousel */}
          <NewsReelCarousel billId={bill.id} />

          {/* View Mode Tabs */}
          <div className="px-4 mb-4">
            <div className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ViewModeButton label="Simple" isActive={viewMode === "simplified"} onPress={() => setViewMode("simplified")} iconType="simplified" />
              <ViewModeButton label="Full Text" isActive={viewMode === "full"} onPress={() => setViewMode("full")} iconType="full" />
              <ViewModeButton label="Impact" isActive={viewMode === "impact"} onPress={() => setViewMode("impact")} iconType="impact" />
              <ViewModeButton label="Related" isActive={viewMode === "related"} onPress={() => setViewMode("related")} iconType="related" />
            </div>
          </div>

          {/* Content */}
          <div className="px-4">
            {viewMode === "simplified" ? (
              <CitizensBriefCard
                state={citizenBrief.state}
                brief={citizenBrief.brief}
                reason={citizenBrief.reason}
                isRequesting={citizenBrief.isRequesting}
                onRequest={citizenBrief.request}
                onRewrite={citizenBrief.brief ? citizenBrief.rewrite : undefined}
                emptyDescription="A plain-English summary of this bill, written only from its complete official text — plus the case for it and the case against it"
                sourceUrl={bill.congressUrl}
                sourceLabel="Read the full text on Congress.gov"
              />
            ) : null}

            {viewMode === "full" ? (
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40">
                <div className="flex items-center mb-3">
                  <FileText size={20} color="#F59E0B" />
                  <span className="text-white font-semibold text-lg ml-2">Full Legislative Text</span>
                </div>
                <p className="text-slate-300 leading-6 font-mono text-sm whitespace-pre-wrap">{bill.fullText}</p>
              </div>
            ) : null}

            {viewMode === "impact" ? <AIImpactSection bill={bill} /> : null}

            {viewMode === "related" ? (
              <div>
                <div className="flex items-center mb-3">
                  <Scale size={20} color="#F59E0B" />
                  <span className="text-white font-semibold text-lg ml-2">Related Laws</span>
                </div>

                {bill.relatedLaws.map((law) => (
                  <div key={law.id} className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 mb-3">
                    <div className="flex items-start">
                      <div className="flex-1">
                        <div className="flex items-center mb-2 gap-2">
                          <span className="bg-amber-500/20 px-2 py-0.5 rounded-full text-amber-500 text-xs font-medium">
                            {relationshipLabels[law.relationship]}
                          </span>
                          <span className="bg-slate-700 px-2 py-0.5 rounded-full text-slate-300 text-xs">
                            {lawTypeLabels[law.type]}
                          </span>
                        </div>

                        <p className="text-white font-semibold mb-1">{law.title}</p>
                        <p className="text-slate-400 text-sm leading-5">{law.summary}</p>
                      </div>
                      <ExternalLink size={18} color="#64748B" className="ml-2 shrink-0" />
                    </div>
                  </div>
                ))}

                {bill.relatedLaws.length === 0 ? (
                  <div className="bg-slate-800/40 rounded-xl p-8 flex flex-col items-center border border-slate-700/30">
                    <Scale size={40} color="#64748B" />
                    <p className="text-slate-400 text-lg mt-4">No related laws</p>
                  </div>
                ) : null}
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
                Vote Yea
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
                Vote Nay
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
