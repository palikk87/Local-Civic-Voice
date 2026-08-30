// Web port of the SlideOverPreview (Citizen's Brief) in
// mobile/src/app/(tabs)/library.tsx — same sections, same data calls.
//
// The brief is written on the SERVER from the entire official text and stored on
// the master reference, once, when a reader asks for it. This panel offers the
// button and displays the result. When no official source has the text, it says
// so — it never shows a guess.
import { X, ExternalLink, Share2 } from "lucide-react";
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

interface CitizensBriefPanelProps {
  result: GovernmentSearchResult;
  onClose: () => void;
  /** Hands back the resolved reference id. The caller opens the composer. */
  onShare: (referenceId: string) => void;
}

export function CitizensBriefPanel({
  result,
  onClose,
  onShare,
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
  } = useLibraryBrief(result);

  /*
   * SHARING NO LONGER WAITS FOR A BRIEF.
   *
   * This was `!!referenceId && !!brief`, so a reader who found a law in the
   * Library could not say "that one matters to me" until an AI had written
   * about it — and the caption under the greyed-out button told them so: "Get
   * the brief first". Sharing a law and paying to summarize it are different
   * acts. The record exists as soon as the document is identified, which is
   * what a post attaches to; the brief is a thing the law's own card carries,
   * for whoever wants it, whenever it is written.
   */
  const canShare = !!referenceId;

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
              sourceUrl={result.sourceUrl}
              sourceLabel="View Official Source"
            />
          )}

        </div>

        {/* Share.
            IT DOES NOT POST FOR YOU ANY MORE. This used to publish
            immediately, with the AI's summary as the body of the post and a
            question appended underneath, over the reader's name — so a person
            who pressed "Share to Feed" found words on their own timeline that
            they had not written and had not seen in a composer. Everywhere
            else on this platform, sharing opens the composer with the law
            attached and waits; the Library was the one place that did not, and
            share-check has been pinning the correct behaviour on the other
            surfaces for weeks. */}
        <div className="border-t border-border px-4 pb-6 pt-4">
          <button
            type="button"
            onClick={() => {
              if (referenceId) onShare(referenceId);
            }}
            disabled={!canShare}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold text-slate-900 transition-opacity",
              !canShare ? "bg-accent/50" : "bg-accent hover:bg-accent/90",
            )}
          >
            <Share2 className="h-[18px] w-[18px]" />
            Share to my timeline
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {canShare
              ? "Opens the composer with this law attached. The words are yours."
              : "Identifying this document at its official source…"}
          </p>
        </div>
      </MotionDiv>
    </>
  );
}
