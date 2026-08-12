/**
 * CitizensBrief Component (web port of mobile/src/components/CitizensBrief.tsx)
 *
 * Displays the AI-generated "Citizen's Brief" - a simplified,
 * non-partisan summary of a government action in three sections:
 * - The Goal: What it does
 * - The Wallet: Fiscal impact
 * - The Debate: Arguments for and against
 *
 * `CitizensBriefCard` is the shared presentation used by legislation, Supreme
 * Court cases and executive orders. It only DISPLAYS the brief the server wrote
 * from the document's entire official text — there is no client-side writer, so a
 * brief can never be produced from a title and a blurb.
 */

import { useEffect, useState } from "react";
import { Target, Wallet, Scale, Sparkles, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";

import type { Bill, CitizensBrief as CitizensBriefType } from "@/lib/mobile/types";

interface SectionConfig {
  label: string;
  Icon: LucideIcon;
  color: string;
  iconBg: string;
  textColor: string;
}

interface CitizensBriefCardProps {
  /** Brief the server already has stored on the master reference, when there is one. */
  initialBrief?: CitizensBriefType | null;
  /** Server is pulling text / writing the brief right now — show the waiting state. */
  serverPending?: boolean;
  /** Ask the server to re-pull the source and rewrite the stored brief. */
  onRefresh?: () => void | Promise<void>;
  /** Overrides for the three section headings. */
  labels?: { goal?: string; wallet?: string; debate?: string };
  /** Copy shown on the empty state. */
  emptyDescription?: string;
  /** Copy shown while the server is preparing the brief. */
  loadingLabel?: string;
  /** Optional "view the official text" link at the bottom of the brief. */
  sourceUrl?: string;
  sourceLabel?: string;
}

interface CitizensBriefProps {
  bill: Bill;
  /**
   * Brief stored on the master reference (from useReferenceBriefProps). Absent only
   * for documents with no reference row — those show the unavailable state rather
   * than a locally invented summary.
   */
  server?: {
    initialBrief: CitizensBriefType | null;
    labels?: { goal?: string; wallet?: string; debate?: string };
    serverPending: boolean;
    onRefresh?: () => Promise<void>;
  };
}

export function CitizensBriefCard({
  initialBrief = null,
  serverPending = false,
  onRefresh,
  labels,
  emptyDescription = "A plain-English summary, written from the complete official text",
  loadingLabel = "Reading the official text...",
  sourceUrl,
  sourceLabel,
}: CitizensBriefCardProps) {
  const [brief, setBrief] = useState<CitizensBriefType | null>(initialBrief);
  const [error, setError] = useState<string | null>(null);

  // The stored brief usually arrives a moment after mount (the detail query is
  // still in flight, or the server is still writing it), so adopt it when it lands.
  useEffect(() => {
    if (initialBrief) setBrief(initialBrief);
  }, [initialBrief]);

  const sections: SectionConfig[] = [
    {
      label: labels?.goal ?? "The Goal",
      Icon: Target,
      color: "#10B981",
      iconBg: "bg-emerald-500/20",
      textColor: "text-emerald-400",
    },
    {
      label: labels?.wallet ?? "The Wallet",
      Icon: Wallet,
      color: "#F59E0B",
      iconBg: "bg-amber-500/20",
      textColor: "text-amber-400",
    },
    {
      label: labels?.debate ?? "The Debate",
      Icon: Scale,
      color: "#A78BFA",
      iconBg: "bg-purple-500/20",
      textColor: "text-purple-400",
    },
  ];

  // The brief lives on the master reference, so "refresh" means asking the server
  // to re-pull the official text and rewrite it. The page polls for the result.
  const handleRefresh = async () => {
    if (!onRefresh) return;
    setError(null);
    await onRefresh();
  };

  if (!brief && serverPending) {
    return (
      <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <div
          className="rounded-[20px] p-8"
          style={{
            background:
              "linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1))",
          }}
        >
          <div className="flex flex-col items-center">
            <Loader2 size={32} color="#3B82F6" className="animate-spin" />
            <p className="text-white text-base font-semibold mt-4">{loadingLabel}</p>
            <p className="text-gray-400 text-sm mt-2 text-center">
              Pulling the complete official text and writing the brief. This is saved for everyone.
            </p>
          </div>
        </div>
      </MotionDiv>
    );
  }

  if (!brief) {
    return (
      <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        <div
          className="rounded-[20px] p-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(139, 92, 246, 0.1))",
          }}
        >
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mb-4">
              <Sparkles size={32} color="#3B82F6" />
            </div>
            <p className="text-white text-lg font-bold text-center mb-2">Citizen's Brief</p>
            <p className="text-gray-400 text-sm text-center mb-4 px-4">{emptyDescription}</p>

            {/* No official text means no brief. We say so instead of guessing. */}
            <p className="text-gray-400 text-sm text-center mb-6 px-4">
              The official text for this document isn't published anywhere we can read yet, so
              there's no brief to show. Rather than guess at what it says, we're not showing one.
            </p>

            {error ? <p className="text-red-400 text-sm text-center mb-4">{error}</p> : null}

            {onRefresh ? (
              <button
                onClick={handleRefresh}
                className="w-full rounded-xl py-3.5 px-6 flex items-center justify-center gap-2 transition-transform active:scale-95"
                style={{ background: "linear-gradient(to right, #3B82F6, #8B5CF6)" }}
              >
                <RefreshCw size={20} color="#FFFFFF" />
                <span className="text-white font-bold text-base">Check the source again</span>
              </button>
            ) : null}

            {sourceUrl && sourceLabel ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 mt-4 py-3 px-4 rounded-xl bg-white/5 w-full"
              >
                <ExternalLink size={16} color="#6B7280" />
                <span className="text-gray-400 text-sm">{sourceLabel}</span>
              </a>
            ) : null}
          </div>
        </div>
      </MotionDiv>
    );
  }

  const bodies = [brief?.theGoal, brief?.theWallet, brief?.theDebate];

  return (
    <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
      <div className="rounded-3xl overflow-hidden">
        <div
          className="p-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(24, 24, 27, 0.95), rgba(39, 39, 42, 0.9))",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #3B82F6, #8B5CF6)" }}
              >
                <Sparkles size={20} color="#FFFFFF" />
              </div>
              <div>
                <p className="text-white font-bold text-lg">Citizen's Brief</p>
                <p className="text-gray-400 text-xs">AI-Generated Summary</p>
              </div>
            </div>
            {onRefresh ? (
              <button onClick={handleRefresh} className="p-2 rounded-lg bg-white/10">
                <RefreshCw size={18} color="#9CA3AF" />
              </button>
            ) : null}
          </div>

          {sections.map((section, index) => (
            <div key={section.label} className={index === sections.length - 1 ? "mb-4" : "mb-5"}>
              <div className="flex items-center gap-2 mb-3">
                <div
                  className={`w-8 h-8 rounded-lg ${section.iconBg} flex items-center justify-center`}
                >
                  <section.Icon size={18} color={section.color} />
                </div>
                <span
                  className={`${section.textColor} font-bold text-sm uppercase tracking-wider`}
                >
                  {section.label}
                </span>
              </div>
              <p className="text-white text-base leading-relaxed pl-10">{bodies[index]}</p>
            </div>
          ))}

          {/* Official source link */}
          {sourceUrl && sourceLabel ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 mt-4 py-3 rounded-xl bg-white/5"
            >
              <ExternalLink size={16} color="#6B7280" />
              <span className="text-gray-400 text-sm">{sourceLabel}</span>
            </a>
          ) : null}

          {/* Disclaimer */}
          <p className="text-gray-500 text-xs text-center mt-4">
            AI summary of the complete official text. Review the official text for full details.
          </p>
        </div>
      </div>
    </MotionDiv>
  );
}

export function CitizensBrief({ bill, server }: CitizensBriefProps) {
  return (
    <CitizensBriefCard
      initialBrief={server?.initialBrief ?? bill.citizensBrief ?? null}
      serverPending={server?.serverPending ?? false}
      onRefresh={server?.onRefresh}
      labels={server?.labels}
      emptyDescription="A plain-English summary of this bill, written from its complete official text"
      loadingLabel="Reading the full bill text..."
      sourceUrl={bill.congressUrl}
      sourceLabel={bill.congressUrl ? "View full text on Congress.gov" : undefined}
    />
  );
}
