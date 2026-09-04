import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BranchTabs } from "@/components/library/BranchTabs";
import { LibraryEmptyState } from "@/components/library/LibraryEmptyState";
import { LibraryResults } from "@/components/library/LibraryResults";
import { CitizensBriefPanel } from "@/components/library/CitizensBriefPanel";
/**
 * What one Library search comes back with.
 *
 * The rows, and whether the court records answered at all. The second is not a
 * property of the rows — an empty list means nothing on its own — so it has to
 * travel beside them rather than be inferred from them.
 */
interface LibrarySearch {
  rows: LibraryRow[];
  courtRecordsUnavailable: boolean;
}

import {
  libraryApi,
  congressToSearchResult,
  executiveToSearchResult,
  judicialToSearchResult,
  type LibraryBranch,
  type LibraryRow,
} from "@/lib/library";
import {
  determineStatusLabel,
  type GovernmentSearchResult,
} from "@/lib/mobile/government-api";

const PLACEHOLDER: Record<LibraryBranch, string> = {
  all: 'Search all three branches (e.g., "healthcare", "immigration")...',
  congress: 'Search bills (e.g., "healthcare", "tax")...',
  executive: "Search executive orders...",
  judicial: "Search court cases...",
};

export default function Library() {
  const navigate = useNavigate();
  /*
   * "all" by default. It was "congress", and the search only ever queried the
   * selected branch — so two thirds of the corpus was excluded by a default
   * nobody chose, silently.
   */
  const [branch, setBranch] = useState<LibraryBranch>("all");

  // Two pieces of state on purpose: what is in the box, and what was actually
  // searched for.
  //
  // These used to be one, behind a 450ms debounce, so the search ran itself
  // while you were still typing — results appeared before you had asked for
  // anything, and changed again every time you paused. Typing is not a request.
  // `submitted` only moves when a person says go.
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const enabled = submitted.trim().length > 1;

  const search = useCallback(() => {
    const next = query.trim();
    // Nothing to search, and no silent failure either — the button is disabled
    // and the hint below the box says what is needed.
    if (next.length < 2) return;
    setSubmitted(next);
  }, [query]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["library", branch, submitted],
    queryFn: async (): Promise<LibrarySearch> => {
      const q = submitted.trim();

      if (branch === "congress") {
        const { results } = await libraryApi.congress(q);
        return { rows: results.map((item) => ({ branch: "congress", item })), courtRecordsUnavailable: false };
      }
      if (branch === "executive") {
        const { results } = await libraryApi.executive(q);
        return { rows: results.map((item) => ({ branch: "executive", item })), courtRecordsUnavailable: false };
      }
      if (branch === "judicial") {
        const { results, sourceUnavailable } = await libraryApi.judicial(q);
        return {
          rows: results.map((item) => ({ branch: "judicial", item })),
          courtRecordsUnavailable: Boolean(sourceUnavailable),
        };
      }

      /*
       * All three, in parallel, interleaved.
       *
       * `allSettled` rather than `all`: one branch's source being down must not
       * blank the other two. A partial answer clearly drawn from what responded
       * beats an error page that hides two working branches.
       *
       * Interleaved rather than concatenated, so a search does not open with
       * fifteen bills and bury the executive orders and court cases below the
       * fold — which is the same exclusion the old default caused, just softer.
       *
       * Each row carries its branch. The three sources return three unrelated
       * shapes and nothing downstream can tell them apart by inspection, so the
       * tag goes on here, where which source answered is still known.
       */
      const [congress, executive, judicial] = await Promise.allSettled([
        libraryApi.congress(q),
        libraryApi.executive(q),
        libraryApi.judicial(q),
      ]);

      const lists: LibraryRow[][] = [
        congress.status === "fulfilled"
          ? congress.value.results.map((item) => ({ branch: "congress", item }))
          : [],
        executive.status === "fulfilled"
          ? executive.value.results.map((item) => ({ branch: "executive", item }))
          : [],
        judicial.status === "fulfilled"
          ? judicial.value.results.map((item) => ({ branch: "judicial", item }))
          : [],
      ];

      const interleaved: LibraryRow[] = [];
      const longest = Math.max(...lists.map((list) => list.length), 0);
      for (let i = 0; i < longest; i++) {
        for (const list of lists) {
          const row = list[i];
          if (row) interleaved.push(row);
        }
      }

      return {
        rows: interleaved,
        // Only the judicial source can say this, and only when it reached
        // nothing at all. The other two branches answering normally does not
        // make the court records reachable.
        courtRecordsUnavailable:
          judicial.status === "fulfilled" && Boolean(judicial.value.sourceUnavailable),
      };
    },
    enabled,
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  /*
   * THE COURT RECORDS DID NOT ANSWER, AND THAT IS NOT A FINDING.
   *
   * An empty judicial result used to mean one of two completely different
   * things with no way to tell them apart: the Supreme Court has never ruled on
   * this, or CourtListener refused us. It allows five requests a minute and one
   * search spends several, so the second search in a minute can come back with
   * nothing. Measured against production, two of eight identical searches did.
   *
   * Saying "no rulings found" in that case is the platform stating something it
   * does not know. So it says what actually happened instead.
   */
  const courtRecordsUnavailable = data?.courtRecordsUnavailable ?? false;
  // FIRST LOAD ONLY. This was (isLoading || isFetching), which swapped the
  // whole result list for a skeleton every time a background refetch ran —
  // including the one a vote triggers. The page lost its height and the reader
  // lost their place. With keepPreviousData set on the client, the old rows
  // stay put while the new ones arrive.
  const loading = enabled && isLoading;

  // Citizen's Brief preview — same flow as the mobile library screen.
  const [selectedResult, setSelectedResult] = useState<GovernmentSearchResult | null>(null);

  /*
   * Sharing sends the reader to the composer with the law attached.
   *
   * It used to call createLibraryPost, which published immediately with the
   * AI's summary as the body of the post, over the reader's name. Every other
   * surface on this platform opens the composer and waits — see
   * ShareToTimeline and the share-check that pins it. The Library was the one
   * place that posted for you.
   */
  const handleShare = useCallback(
    (referenceId: string) => {
      setSelectedResult(null);
      navigate(`/timeline?share=${encodeURIComponent(referenceId)}`);
    },
    [navigate],
  );

  // Clear the open brief when the search or branch changes.
  useEffect(() => {
    setSelectedResult(null);
  }, [branch, submitted]);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Live gateway to government records
            </p>
          </div>
          <div className="mt-1 flex items-center rounded-full bg-muted/60 px-3 py-1.5">
            <span className="mr-2 h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-medium text-emerald-400">Live</span>
          </div>
        </div>

        <BranchTabs value={branch} onChange={setBranch} />

        {/* Search
            A real <form>, so Enter submits the way it does in every other search
            box on the internet. The button and the Enter key are the same one
            action — there is no path that searches without the person asking. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={PLACEHOLDER[branch]}
                aria-label={PLACEHOLDER[branch]}
                enterKeyHint="search"
                className="h-12 rounded-2xl pl-9 pr-10 text-[15px]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setSubmitted("");
                  }}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <Button
              type="submit"
              disabled={query.trim().length < 2 || loading}
              className="h-12 rounded-2xl px-6 font-semibold"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
            </Button>
          </div>
          <p className="mt-1.5 px-1 text-xs text-muted-foreground">
            {query.trim().length === 1
              ? "Type at least two characters."
              : "Type what you're looking for in everyday language, then press Search."}
          </p>
        </form>

        {/* Results */}
        {enabled && courtRecordsUnavailable ? (
          <div
            role="status"
            className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
          >
            <span className="font-semibold">We couldn't reach the court records.</span>{" "}
            This isn't a finding about the Supreme Court — the source didn't answer.
            Try that search again in a moment.
          </div>
        ) : null}

        {enabled ? (
          <LibraryResults
            rows={rows}
            isLoading={loading}
            isError={isError}
            statusLabelFor={(item) => determineStatusLabel(item.latestAction?.text)}
            onOpenCongress={(item) => setSelectedResult(congressToSearchResult(item))}
            onOpenExecutive={(item) => setSelectedResult(executiveToSearchResult(item))}
            onOpenJudicial={(item) => setSelectedResult(judicialToSearchResult(item))}
          />
        ) : (
          <LibraryEmptyState
            branch={branch}
            onSuggestionPress={(suggestion) => {
              // Tapping a suggestion is a request, so it searches. Filling the
              // box and leaving the reader to press Search again is a dead end
              // dressed up as help.
              setQuery(suggestion);
              setSubmitted(suggestion.trim());
            }}
          />
        )}
      </div>

      {/* Slide-over Citizen's Brief */}
      {selectedResult ? (
        <CitizensBriefPanel
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
          onShare={handleShare}
        />
      ) : null}

    </AppShell>
  );
}
