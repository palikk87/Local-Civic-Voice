// Web port of webapp/mobile/src/app/article-v.tsx — Article V: Self-Correction.
// Same functionality: impeachment votes on Civil Leaders and the System-Wide
// Reset super-majority vote, using the shared constitution rules lib.
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  AlertTriangle,
  RotateCcw,
  UserX,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Gavel,
  FileText,
  AlertOctagon,
  BookOpen,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SYSTEM_RESET_THRESHOLD,
  canTriggerSystemReset,
  type SystemResetVote,
} from "@/lib/mobile/constitution";
import { useRequireAuth } from "@/hooks/use-civic-auth";

// Civil Leader data mirrors mobile/src/app/article-v.tsx
interface CivilLeader {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  trustScore: number;
  delegatorCount: number;
  falsehoodCount: number;
  impeachmentVotes: number;
  totalEligibleVoters: number;
}

const civilLeaders: CivilLeader[] = [
  {
    id: "leader-1",
    displayName: "Dr. Sarah Chen",
    username: "healthpolicy_expert",
    avatar: "https://api.dicebear.com/7.x/avataaars/png?seed=sarah",
    trustScore: 92,
    delegatorCount: 1247,
    falsehoodCount: 0,
    impeachmentVotes: 23,
    totalEligibleVoters: 1247,
  },
  {
    id: "leader-2",
    displayName: "Marcus Rivera",
    username: "greenlegislation",
    avatar: "https://api.dicebear.com/7.x/avataaars/png?seed=marcus",
    trustScore: 78,
    delegatorCount: 892,
    falsehoodCount: 1,
    impeachmentVotes: 156,
    totalEligibleVoters: 892,
  },
  {
    id: "leader-3",
    displayName: "James Park",
    username: "techpolicy_watch",
    avatar: "https://api.dicebear.com/7.x/avataaars/png?seed=james",
    trustScore: 45,
    delegatorCount: 1089,
    falsehoodCount: 3,
    impeachmentVotes: 612,
    totalEligibleVoters: 1089,
  },
];

const activeResetVote: SystemResetVote = {
  id: "reset-2025-01",
  initiatedAt: "2025-01-15T00:00:00Z",
  reason: "Alleged algorithmic bias in feed ranking detected by community audit",
  evidence:
    "Community audit report #2025-001 showing 15% preference for certain content types",
  votesFor: 12450,
  votesAgainst: 45230,
  totalEligibleVoters: 94000,
  status: "voting",
  expiresAt: "2025-01-22T00:00:00Z",
};

function trustColor(score: number): string {
  if (score >= 80) return "#22C55E";
  if (score >= 60) return "#F59E0B";
  if (score >= 40) return "#F97316";
  return "#EF4444";
}

function LeaderCard({
  leader,
  onVoteImpeach,
  hasVoted,
}: {
  leader: CivilLeader;
  onVoteImpeach: (leaderId: string) => void;
  hasVoted: boolean;
}) {
  const impeachmentPct = (leader.impeachmentVotes / leader.totalEligibleVoters) * 100;
  const isNearImpeachment = impeachmentPct >= 40;
  const isImpeached = impeachmentPct >= 50;

  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border p-4",
        isImpeached
          ? "bg-red-900/30 border-red-700/50"
          : isNearImpeachment
            ? "bg-amber-900/20 border-amber-700/40"
            : "bg-slate-800/60 border-slate-700/50",
      )}
    >
      <div className="mb-3 flex items-center">
        <img src={leader.avatar} alt={leader.displayName} className="h-12 w-12 rounded-full" />
        <div className="ml-3 flex-1">
          <div className="flex items-center">
            <span className="text-lg font-semibold text-white">{leader.displayName}</span>
            {isImpeached ? (
              <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                Impeached
              </span>
            ) : null}
          </div>
          <span className="text-sm text-slate-400">@{leader.username}</span>
        </div>

        <div className="flex flex-col items-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: `${trustColor(leader.trustScore)}20` }}
          >
            <span className="text-lg font-bold" style={{ color: trustColor(leader.trustScore) }}>
              {leader.trustScore}
            </span>
          </div>
          <span className="mt-1 text-xs text-slate-500">Trust</span>
        </div>
      </div>

      <div className="mb-3 flex justify-between border-y border-slate-700/50 py-2">
        <div className="flex flex-col items-center">
          <span className="text-xs text-slate-400">Delegators</span>
          <span className="font-semibold text-white">
            {leader.delegatorCount.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-slate-400">Falsehoods</span>
          <span
            className={cn(
              "font-semibold",
              leader.falsehoodCount > 0 ? "text-red-400" : "text-emerald-400",
            )}
          >
            {leader.falsehoodCount}
          </span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-slate-400">Impeach Votes</span>
          <span className="font-semibold text-amber-400">
            {leader.impeachmentVotes.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex justify-between">
          <span className="text-xs text-slate-400">Impeachment Progress</span>
          <span
            className={cn(
              "text-xs font-medium",
              isImpeached ? "text-red-400" : isNearImpeachment ? "text-amber-400" : "text-slate-400",
            )}
          >
            {impeachmentPct.toFixed(1)}% of 50% needed
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-700">
          <div
            className={cn(
              "h-full rounded-full",
              isImpeached ? "bg-red-500" : isNearImpeachment ? "bg-amber-500" : "bg-slate-500",
            )}
            style={{ width: `${Math.min(100, (impeachmentPct / 50) * 100)}%` }}
          />
        </div>
      </div>

      {!isImpeached ? (
        <button
          onClick={() => onVoteImpeach(leader.id)}
          disabled={hasVoted}
          className={cn(
            "flex w-full items-center justify-center rounded-xl py-3 transition-colors",
            hasVoted ? "bg-slate-700/50" : "bg-red-600/80 hover:bg-red-600",
          )}
        >
          {hasVoted ? (
            <>
              <CheckCircle size={18} color="#22C55E" />
              <span className="ml-2 font-medium text-emerald-400">Vote Recorded</span>
            </>
          ) : (
            <>
              <Gavel size={18} color="#fff" />
              <span className="ml-2 font-semibold text-white">Vote to Impeach</span>
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function SystemResetCard({
  vote,
  onVoteFor,
  onVoteAgainst,
  userVote,
}: {
  vote: SystemResetVote;
  onVoteFor: () => void;
  onVoteAgainst: () => void;
  userVote: "for" | "against" | null;
}) {
  const totalVotes = vote.votesFor + vote.votesAgainst;
  const participation = totalVotes / vote.totalEligibleVoters;
  const approvalPct = totalVotes > 0 ? (vote.votesFor / totalVotes) * 100 : 0;
  const canTrigger = canTriggerSystemReset(vote);
  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(vote.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/60">
      <div className="bg-gradient-to-br from-[#7F1D1D] to-[#450A0A] p-4">
        <div className="mb-2 flex items-center">
          <AlertOctagon size={24} color="#FCA5A5" />
          <span className="ml-2 text-lg font-bold text-red-200">System-Wide Reset Vote</span>
        </div>
        <span className="text-sm text-red-300/80">Article V, Section 2: Platform Neutrality</span>
      </div>

      <div className="p-4">
        <div className="mb-4">
          <span className="mb-1 block text-xs font-semibold tracking-wider text-slate-400">
            REASON FOR RESET
          </span>
          <p className="text-white">{vote.reason}</p>
        </div>

        <div className="mb-4 rounded-lg bg-slate-900/50 p-3">
          <div className="mb-1 flex items-center">
            <FileText size={14} color="#94A3B8" />
            <span className="ml-1 text-xs font-semibold text-slate-400">EVIDENCE</span>
          </div>
          <p className="text-sm text-slate-300">{vote.evidence}</p>
        </div>

        <div className="mb-4">
          <div className="mb-2 flex justify-between">
            <div className="flex items-center">
              <Users size={14} color="#94A3B8" />
              <span className="ml-1 text-sm text-slate-400">
                {(participation * 100).toFixed(1)}% participation
              </span>
            </div>
            <div className="flex items-center">
              <Clock size={14} color="#94A3B8" />
              <span className="ml-1 text-sm text-slate-400">{daysRemaining} days left</span>
            </div>
          </div>

          <div className="mb-2">
            <div className="mb-1 flex justify-between">
              <span className="text-sm font-medium text-emerald-400">
                For Reset: {vote.votesFor.toLocaleString()}
              </span>
              <span className="text-sm font-medium text-emerald-400">
                {approvalPct.toFixed(1)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${approvalPct}%` }} />
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between">
              <span className="text-sm font-medium text-red-400">
                Against: {vote.votesAgainst.toLocaleString()}
              </span>
              <span className="text-sm font-medium text-red-400">
                {(100 - approvalPct).toFixed(1)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-700">
              <div
                className="h-full rounded-full bg-red-500"
                style={{ width: `${100 - approvalPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-lg bg-slate-900/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">
              Super-majority required: {(SYSTEM_RESET_THRESHOLD * 100).toFixed(0)}%
            </span>
            {canTrigger ? (
              <div className="flex items-center">
                <CheckCircle size={14} color="#22C55E" />
                <span className="ml-1 text-sm font-medium text-emerald-400">Threshold Met</span>
              </div>
            ) : (
              <div className="flex items-center">
                <XCircle size={14} color="#EF4444" />
                <span className="ml-1 text-sm font-medium text-red-400">Not Met</span>
              </div>
            )}
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            Requires 50% participation + 66% approval
          </span>
        </div>

        <div className="flex gap-4">
          <button
            onClick={onVoteFor}
            disabled={userVote !== null}
            className={cn(
              "flex flex-1 items-center justify-center rounded-xl py-3 transition-colors",
              userVote === "for"
                ? "bg-emerald-600"
                : userVote !== null
                  ? "bg-slate-700/50"
                  : "bg-emerald-600/80 hover:bg-emerald-600",
            )}
          >
            <CheckCircle size={18} color={userVote === "for" ? "#fff" : "#22C55E"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                userVote === "for" ? "text-white" : "text-emerald-400",
              )}
            >
              {userVote === "for" ? "Voted For" : "Vote For"}
            </span>
          </button>

          <button
            onClick={onVoteAgainst}
            disabled={userVote !== null}
            className={cn(
              "flex flex-1 items-center justify-center rounded-xl py-3 transition-colors",
              userVote === "against"
                ? "bg-red-600"
                : userVote !== null
                  ? "bg-slate-700/50"
                  : "bg-red-600/80 hover:bg-red-600",
            )}
          >
            <XCircle size={18} color={userVote === "against" ? "#fff" : "#EF4444"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                userVote === "against" ? "text-white" : "text-red-400",
              )}
            >
              {userVote === "against" ? "Voted Against" : "Vote Against"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ArticleV() {
  const requireAuth = useRequireAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"impeachment" | "reset">("impeachment");
  const [votedLeaders, setVotedLeaders] = useState<Set<string>>(new Set());
  const [resetVote, setResetVote] = useState<"for" | "against" | null>(null);

  const handleVoteImpeach = useCallback(
    (leaderId: string) => {
      if (!requireAuth("Sign in to cast your vote.")) return;
      setVotedLeaders((prev) => new Set(prev).add(leaderId));
    },
    [requireAuth],
  );

  const handleResetVoteFor = useCallback(() => {
    if (!requireAuth("Sign in to cast your vote.")) return;
    setResetVote("for");
  }, [requireAuth]);

  const handleResetVoteAgainst = useCallback(() => {
    if (!requireAuth("Sign in to cast your vote.")) return;
    setResetVote("against");
  }, [requireAuth]);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl py-4">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <div className="text-center">
            <span className="block font-bold text-white">Article V</span>
            <span className="block text-xs text-slate-400">Self-Correction Mechanism</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/constitution")}
            className="text-muted-foreground"
            aria-label="Open Constitution"
          >
            <BookOpen className="h-5 w-5" />
          </Button>
        </div>

        {/* Banner */}
        <div className="mb-6 overflow-hidden rounded-2xl border border-red-700/30 bg-gradient-to-br from-[#7F1D1D] to-[#450A0A] p-5">
          <div className="mb-3 flex items-center">
            <div className="mr-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
              <RotateCcw size={24} color="#FCA5A5" />
            </div>
            <div className="flex-1">
              <span className="block text-xl font-bold text-red-100">Self-Correction</span>
              <span className="block text-sm text-red-300/70">Constitutional Article V</span>
            </div>
          </div>
          <p className="italic leading-6 text-red-200/80">
            "The community retains the right to Impeach or demote any leader who
            misrepresents facts or violates the Code of Conduct, and may trigger a
            System-Wide Reset via super-majority vote."
          </p>
        </div>

        {/* Tab Selector */}
        <div className="mb-6 flex">
          <button
            onClick={() => setActiveTab("impeachment")}
            className={cn(
              "flex flex-1 items-center justify-center rounded-l-xl border py-3 transition-colors",
              activeTab === "impeachment"
                ? "border-amber-500/50 bg-amber-500/20"
                : "border-slate-700/50 bg-slate-800/60 hover:bg-slate-800",
            )}
          >
            <UserX size={18} color={activeTab === "impeachment" ? "#F59E0B" : "#64748B"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                activeTab === "impeachment" ? "text-amber-500" : "text-slate-400",
              )}
            >
              Impeachment
            </span>
          </button>

          <button
            onClick={() => setActiveTab("reset")}
            className={cn(
              "flex flex-1 items-center justify-center rounded-r-xl border py-3 transition-colors",
              activeTab === "reset"
                ? "border-red-500/50 bg-red-500/20"
                : "border-slate-700/50 bg-slate-800/60 hover:bg-slate-800",
            )}
          >
            <RotateCcw size={18} color={activeTab === "reset" ? "#EF4444" : "#64748B"} />
            <span
              className={cn(
                "ml-2 font-semibold",
                activeTab === "reset" ? "text-red-400" : "text-slate-400",
              )}
            >
              System Reset
            </span>
          </button>
        </div>

        {/* Content */}
        {activeTab === "impeachment" ? (
          <div>
            <div className="mb-4 rounded-xl border border-amber-700/30 bg-amber-900/20 p-4">
              <div className="mb-2 flex items-center">
                <Gavel size={18} color="#F59E0B" />
                <span className="ml-2 font-semibold text-amber-400">Leader Accountability</span>
              </div>
              <p className="text-sm leading-5 text-slate-300">
                Civil Leaders who misrepresent facts or violate the Code of Conduct can be
                impeached by their delegators. A 50% majority of delegators must vote to
                impeach for removal.
              </p>
            </div>

            <span className="mb-3 block text-xs font-semibold tracking-wider text-slate-400">
              CIVIL LEADERS
            </span>
            {civilLeaders.map((leader) => (
              <LeaderCard
                key={leader.id}
                leader={leader}
                onVoteImpeach={handleVoteImpeach}
                hasVoted={votedLeaders.has(leader.id)}
              />
            ))}
          </div>
        ) : (
          <div>
            <div className="mb-4 rounded-xl border border-red-700/30 bg-red-900/20 p-4">
              <div className="mb-2 flex items-center">
                <AlertTriangle size={18} color="#EF4444" />
                <span className="ml-2 font-semibold text-red-400">Platform Neutrality</span>
              </div>
              <p className="text-sm leading-5 text-slate-300">
                If platform administrators or developers are found biasing the Pulse, the
                Electorate may trigger a System-Wide Reset. This requires a super-majority
                vote (66%) with at least 50% participation.
              </p>
            </div>

            <span className="mb-3 block text-xs font-semibold tracking-wider text-slate-400">
              ACTIVE RESET VOTE
            </span>
            <SystemResetCard
              vote={activeResetVote}
              onVoteFor={handleResetVoteFor}
              onVoteAgainst={handleResetVoteAgainst}
              userVote={resetVote}
            />
          </div>
        )}

        {/* Footer link to the other documents */}
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => navigate("/documents")}>
            <BookOpen className="mr-2 h-4 w-4" />
            View All Founding Documents
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
