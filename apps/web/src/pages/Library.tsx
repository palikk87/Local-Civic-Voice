import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, X, CheckCircle } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { BranchTabs } from "@/components/library/BranchTabs";
import { LibraryEmptyState } from "@/components/library/LibraryEmptyState";
import { LibraryResults } from "@/components/library/LibraryResults";
import {
  CitizensBriefPanel,
  type LibraryShareTarget,
} from "@/components/library/CitizensBriefPanel";
import { useDebounce } from "@/hooks/use-debounce";
import {
  libraryApi,
  congressToSearchResult,
  executiveToSearchResult,
  judicialToSearchResult,
  type LibraryBranch,
  type CongressResult,
  type ExecutiveResult,
  type JudicialResult,
} from "@/lib/library";
import {
  determineStatusLabel,
  type GovernmentSearchResult,
} from "@/lib/mobile/government-api";
import { useTimelineStore } from "@/lib/mobile/timeline-store";

type LibraryResult = CongressResult | ExecutiveResult | JudicialResult;

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
  congress: 'Search bills (e.g., "healthcare", "tax")...',
  executive: "Search executive orders...",
  judicial: "Search court cases...",
};

export default function Library() {
  const [branch, setBranch] = useState<LibraryBranch>("congress");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 450);
  const enabled = debouncedQuery.trim().length > 1;

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["library", branch, debouncedQuery],
    queryFn: async (): Promise<{ results: LibraryResult[] }> => {
      const q = debouncedQuery.trim();
      if (branch === "congress") return libraryApi.congress(q);
      if (branch === "executive") return libraryApi.executive(q);
      return libraryApi.judicial(q);
    },
    enabled,
    staleTime: 60_000,
  });

  const results = data?.results ?? [];
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
  }, [branch, debouncedQuery]);

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

        {/* Search */}
        <div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={PLACEHOLDER[branch]}
              className="h-12 rounded-2xl pl-9 pr-10 text-[15px]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 px-1 text-xs text-muted-foreground">
            Just type what you're looking for - AI understands everyday language
          </p>
        </div>

        {/* Results */}
        {enabled ? (
          <LibraryResults
            branch={branch}
            isLoading={loading}
            isError={isError}
            congress={branch === "congress" ? (results as CongressResult[]) : []}
            executive={branch === "executive" ? (results as ExecutiveResult[]) : []}
            judicial={branch === "judicial" ? (results as JudicialResult[]) : []}
            statusLabelFor={(item) => determineStatusLabel(item.latestAction?.text)}
            onOpenCongress={(item) => setSelectedResult(congressToSearchResult(item))}
            onOpenExecutive={(item) => setSelectedResult(executiveToSearchResult(item))}
            onOpenJudicial={(item) => setSelectedResult(judicialToSearchResult(item))}
          />
        ) : (
          <LibraryEmptyState branch={branch} onSuggestionPress={(suggestion) => setQuery(suggestion)} />
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
