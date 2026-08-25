import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X, CheckCircle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BranchTabs } from "@/components/library/BranchTabs";
import { LibraryEmptyState } from "@/components/library/LibraryEmptyState";
import { LibraryResults } from "@/components/library/LibraryResults";
import {
  CitizensBriefPanel,
  type LibraryShareTarget,
} from "@/components/library/CitizensBriefPanel";
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
import { useTimelineStore } from "@/lib/mobile/timeline-store";

function SuccessToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-24 left-4 right-4 z-[60] mx-auto max-w-md">
      <div className="flex items-center gap-3 rounded-xl bg-emerald-600 p-4 shadow-lg">
        <CheckCircle className="h-5 w-5 shrink-0 text-white" />
        <span className="flex-1 font-medium text-white">{message}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          <X className="h-4 w-4 text-white" />
        </button>
      </div>
    </div>
  );
}

const PLACEHOLDER: Record<LibraryBranch, string> = {
  all: 'Search all three branches (e.g., "healthcare", "immigration")...',
  congress: 'Search bills (e.g., "healthcare", "tax")...',
  executive: "Search executive orders...",
  judicial: "Search court cases...",
};

export default function Library() {
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

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["library", branch, submitted],
    queryFn: async (): Promise<LibraryRow[]> => {
      const q = submitted.trim();

      if (branch === "congress") {
        const { results } = await libraryApi.congress(q);
        return results.map((item) => ({ branch: "congress", item }));
      }
      if (branch === "executive") {
        const { results } = await libraryApi.executive(q);
        return results.map((item) => ({ branch: "executive", item }));
      }
      if (branch === "judicial") {
        const { results } = await libraryApi.judicial(q);
        return results.map((item) => ({ branch: "judicial", item }));
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

      return interleaved;
    },
    enabled,
    staleTime: 60_000,
  });

  const rows = data ?? [];
  const loading = enabled && (isLoading || isFetching);

  // Citizen's Brief preview — same flow as the mobile library screen.
  const [selectedResult, setSelectedResult] = useState<GovernmentSearchResult | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const createLibraryPost = useTimelineStore((s) => s.createLibraryPost);

  // The brief was written server-side from the full official text and is already
  // stored on the reference — sharing just publishes a post pointing at it.
  const convertMutation = useMutation({
    mutationFn: (share: LibraryShareTarget) => createLibraryPost(share),
    onSuccess: () => {
      setSelectedResult(null);
      setSuccessMessage("Shared! It's on your timeline and will cycle into the public feed.");
    },
  });

  const handleConvert = useCallback(
    (share: LibraryShareTarget) => {
      convertMutation.mutate(share);
    },
    [convertMutation],
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
          onConvert={handleConvert}
          isConverting={convertMutation.isPending}
        />
      ) : null}

      {successMessage ? (
        <SuccessToast message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      ) : null}
    </AppShell>
  );
}
