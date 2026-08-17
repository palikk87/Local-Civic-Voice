// Web port of the SlideOverPreview (Citizen's Brief) in
// mobile/src/app/(tabs)/library.tsx — same sections, same data calls.
//
// The brief is written on the SERVER from the entire official text and stored on
// the master reference, once, when a reader asks for it. This panel offers the
// button and displays the result. When no official source has the text, it says
// so — it never shows a guess.
import { X, ExternalLink, Share2, Loader2 } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { useLibraryBrief } from "@/hooks/use-library-brief";
import type { GovernmentSearchResult, SearchBranch } from "@/lib/mobile/government-api";
import { cn } from "@/lib/utils";

const BRANCH_COLORS: Record<SearchBranch, string> = {
  legislative: "#3B82F6",
  executive: "#F59E0B",
  judicial: "#8B5CF6",
};

const BRANCH_LABELS: Record<SearchBranch, string> = {
  legislative: "Congressional Bill",
  executive: "Executive Order",
  judicial: "Court Case",
};

export interface LibraryShareTarget {
  referenceId: string;
  brief: { summary: string; argumentFor: string; argumentAgainst: string };
}

interface CitizensBriefPanelProps {
  result: GovernmentSearchResult;
  onClose: () => void;
  onConvert: (share: LibraryShareTarget) => void;
  isConverting: boolean;
}

export function CitizensBriefPanel({
  result,
  onClose,
  onConvert,
  isConverting,
}: CitizensBriefPanelProps) {
  const {
    referenceId,
    brief,
    reason,
    state,
    isRequesting,
    isResolving,
    isUnidentifiable,
    request,
    rewrite,
  } = useLibraryBrief(result);

  const canShare = !!referenceId && !!brief;

  const friendlyName =
    typeof result.metadata?.friendlyName === "string" &&
    result.metadata.friendlyName !== result.shortTitle
      ? result.metadata.friendlyName
      : null;
  const congressNumber =
    typeof result.metadata?.congressNumber === "string" ? result.metadata.congressNumber : null;


  return (
    <>
      {/* Backdrop */}
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50"
      />

      <MotionDiv
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 32 }}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: BRANCH_COLORS[result.branch] }}
            />
            <span className="text-sm text-muted-foreground">{BRANCH_LABELS[result.branch]}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-muted p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {friendlyName ? (
            <h2 className="mb-1 text-xl font-bold text-accent">{friendlyName}</h2>
          ) : null}
          <h3 className="mb-2 text-lg font-bold leading-snug text-foreground">{result.title}</h3>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            {congressNumber ? (
              <span className="rounded-full bg-legislative/20 px-2 py-1 font-mono text-xs text-legislative">
                {congressNumber}
              </span>
            ) : null}
            {result.category ? (
              <span className="rounded-full bg-muted px-2 py-1 text-xs capitalize text-muted-foreground">
                {result.category.replace("_", " ")}
              </span>
            ) : null}
            {result.date ? (
              <span className="text-xs text-muted-foreground">
                {new Date(result.date).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            ) : null}
          </div>

          {/* Status */}
          <div className="mb-4 rounded-lg bg-muted/50 p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">STATUS</p>
            <p className="text-sm text-foreground">{result.status}</p>
          </div>

          {/* Citizen's Brief */}
          {isUnidentifiable ? (
            <div className="mb-4 rounded-2xl border border-border bg-muted/50 p-4">
              <p className="text-sm leading-6 text-muted-foreground">
                This record can't be matched to an official document yet, so there's nothing to
                summarize from.
              </p>
            </div>
          ) : (
            <CitizensBriefCard
              className="mb-4"
              state={state}
              brief={brief}
              reason={reason}
              // Resolving is a step the reader did not ask for and cannot act
              // on, so the button stays busy through it rather than appearing
              // ready to press before there is anything to press it against.
              isRequesting={isRequesting || isResolving}
              onRequest={request}
              onRewrite={brief ? rewrite : undefined}
              sourceUrl={result.sourceUrl}
              sourceLabel="View Official Source"
            />
          )}

        </div>

        {/* Convert to Post */}
        <div className="border-t border-border px-4 pb-6 pt-4">
          <button
            type="button"
            onClick={() => {
              if (referenceId && brief) onConvert({ referenceId, brief });
            }}
            disabled={isConverting || !canShare}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold text-slate-900 transition-opacity",
              isConverting || !canShare ? "bg-accent/50" : "bg-accent hover:bg-accent/90",
            )}
          >
            {isConverting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating Post…
              </>
            ) : (
              <>
                <Share2 className="h-[18px] w-[18px]" />
                Share to Feed
              </>
            )}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {canShare
              ? "Post this Citizen's Brief to start a discussion"
              : "Get the brief first — a post carries it with the law"}
          </p>
        </div>
      </MotionDiv>
    </>
  );
}
