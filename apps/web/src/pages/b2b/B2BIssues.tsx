// Web port of webapp/mobile/src/app/b2b/issues.tsx — issue sentiment tracker.
import { useEffect, useState } from "react";
import {
  Search,
  Target,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Users,
  MapPin,
  X,
  Zap,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type IssueData } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const CATEGORY_COLORS: Record<string, string> = {
  Healthcare: "#EF4444",
  Economy: "#F59E0B",
  Immigration: "#8B5CF6",
  Environment: "#22C55E",
  Education: "#3B82F6",
  "Civil Rights": "#EC4899",
  Defense: "#64748B",
  Technology: "#06B6D4",
  Housing: "#F97316",
  Crime: "#DC2626",
};

/**
 * "Trending" is gone.
 *
 * It sorted on `sentiment.trend`, which the API derived from the CURRENT score
 * rather than from any movement — an issue sitting steadily at 70% support was
 * labelled "rising" forever, having risen nowhere. Sorting by it therefore
 * sorted by "score above 0.1", which is what Sentiment already does. Nothing in
 * this database records an earlier score to compare against, so there is no
 * honest version of this sort yet.
 */
type SortKey = "sentiment" | "volume";

function IssueCard({ issue, onClick }: { issue: IssueData; onClick: () => void }) {
  const sentiment = issue.sentiment;
  const isPositive = sentiment.score > 0;
  const categoryColor = CATEGORY_COLORS[issue.category] ?? "#64748B";
  const total = sentiment.total || 1;

  return (
    <button
      onClick={onClick}
      className="mb-3 w-full rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors hover:bg-slate-800/60"
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-1 flex items-center">
            <span
              className="mr-2 h-3 w-3 rounded-full"
              style={{ backgroundColor: categoryColor }}
            />
            <span className="text-xs text-slate-400">{issue.category}</span>
          </div>
          <span className="text-lg font-semibold text-white">{issue.name}</span>
        </div>
        <div
          className={cn(
            "flex items-center rounded-full px-3 py-1",
            isPositive ? "bg-emerald-500/20" : "bg-red-500/20",
          )}
        >
          {isPositive ? (
            <TrendingUp size={14} color="#34D399" />
          ) : (
            <TrendingDown size={14} color="#EF4444" />
          )}
          <span className={cn("ml-1 font-bold", isPositive ? "text-emerald-400" : "text-red-400")}>
            {isPositive ? "+" : ""}
            {(sentiment.score * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex justify-between">
          <span className="text-xs text-emerald-400">
            {sentiment.support.toLocaleString()} Support
          </span>
          <span className="text-xs text-red-400">{sentiment.oppose.toLocaleString()} Oppose</span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${(sentiment.support / total) * 100}%` }}
          />
          <div
            className="h-full bg-red-500"
            style={{ width: `${(sentiment.oppose / total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <BarChart3 size={14} color="#64748B" />
            <span className="ml-1 text-sm text-slate-400">{issue.relatedBills} bills</span>
          </div>
          <div className="flex items-center">
            <Users size={14} color="#64748B" />
            <span className="ml-1 text-sm text-slate-400">
              {sentiment.total.toLocaleString()} votes
            </span>
          </div>
        </div>

        {/*
          Nothing at all when there is no measured direction, rather than a grey
          "stable" pill. "Stable" is a finding; the absence of a second
          measurement is not.
        */}
        {sentiment.trend === "rising" || sentiment.trend === "falling" ? (
          <div
            className={cn(
              "flex items-center rounded-full px-2 py-1",
              sentiment.trend === "rising" ? "bg-emerald-500/10" : "bg-red-500/10",
            )}
          >
            {sentiment.trend === "rising" ? (
              <Zap size={12} color="#34D399" />
            ) : (
              <TrendingDown size={12} color="#EF4444" />
            )}
            <span
              className={cn(
                "ml-1 text-xs capitalize",
                sentiment.trend === "rising" ? "text-emerald-400" : "text-red-400",
              )}
            >
              {sentiment.trend}
            </span>
          </div>
        ) : null}
      </div>

      {issue.hotspots && issue.hotspots.length > 0 ? (
        <div className="mt-3 flex items-center border-t border-slate-700/30 pt-3">
          <MapPin size={12} color="#64748B" />
          <span className="ml-1 text-xs text-slate-400">
            Hotspots: {issue.hotspots.slice(0, 3).join(", ")}
          </span>
        </div>
      ) : null}
    </button>
  );
}

export default function B2BIssues() {
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");
  const [selectedIssue, setSelectedIssue] = useState<IssueData | null>(null);

  const issues = useB2BStore((s) => s.issues);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const fetchIssues = useB2BStore((s) => s.fetchIssues);
  const fetchIssueDetails = useB2BStore((s) => s.fetchIssueDetails);

  useEffect(() => {
    if (isAuthenticated) fetchIssues();
  }, [isAuthenticated, fetchIssues]);

  const handleIssueClick = async (issue: IssueData) => {
    const details = await fetchIssueDetails(issue.id);
    setSelectedIssue(details ?? issue);
  };

  const filteredIssues = issues
    .filter(
      (issue) =>
        issue.name.toLowerCase().includes(search.toLowerCase()) ||
        issue.category.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "sentiment":
          return Math.abs(b.sentiment.score) - Math.abs(a.sentiment.score);
        case "volume":
          return b.sentiment.total - a.sentiment.total;
        default:
          return 0;
      }
    });

  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: "volume", label: "Volume" },
    { key: "sentiment", label: "Sentiment" },
  ];

  return (
    <B2BShell title="Issue Tracker">
      <p className="-mt-4 mb-4 text-sm text-slate-400">Track sentiment by policy area</p>

      {/* Search & Sort */}
      <div className="mb-3 flex items-center rounded-xl bg-slate-800/50 px-4 py-1">
        <Search size={20} color="#64748B" />
        <input
          className="flex-1 bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-500"
          placeholder="Search issues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.length > 0 ? (
          <button onClick={() => setSearch("")} aria-label="Clear search">
            <X size={18} color="#64748B" />
          </button>
        ) : null}
      </div>

      <div className="mb-4 flex gap-2">
        {sortOptions.map((option) => (
          <button
            key={option.key}
            onClick={() => setSortBy(option.key)}
            className={cn(
              "rounded-full px-4 py-2 text-sm transition-colors",
              sortBy === option.key
                ? "bg-indigo-500 font-medium text-white"
                : "bg-slate-800/50 text-slate-400 hover:bg-slate-800",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Issues List */}
      {filteredIssues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Target size={48} color="#475569" />
          <span className="mt-4 text-lg text-slate-400">No issues found</span>
        </div>
      ) : (
        <div className="md:columns-2 md:gap-4 [&>button]:break-inside-avoid">
          {filteredIssues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onClick={() => handleIssueClick(issue)} />
          ))}
        </div>
      )}

      {/* Issue Detail Dialog */}
      <Dialog open={!!selectedIssue} onOpenChange={(open) => !open && setSelectedIssue(null)}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">{selectedIssue?.name}</DialogTitle>
          </DialogHeader>

          {selectedIssue ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-700/30 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium text-slate-300">Overall Sentiment</span>
                  <div
                    className={cn(
                      "flex items-center rounded-full px-3 py-1",
                      selectedIssue.sentiment.score > 0 ? "bg-emerald-500/20" : "bg-red-500/20",
                    )}
                  >
                    {selectedIssue.sentiment.score > 0 ? (
                      <TrendingUp size={14} color="#34D399" />
                    ) : (
                      <TrendingDown size={14} color="#EF4444" />
                    )}
                    <span
                      className={cn(
                        "ml-1 font-bold",
                        selectedIssue.sentiment.score > 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {selectedIssue.sentiment.score > 0 ? "+" : ""}
                      {(selectedIssue.sentiment.score * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-emerald-400">
                    Support: {selectedIssue.sentiment.support.toLocaleString()}
                  </span>
                  <span className="text-red-400">
                    Oppose: {selectedIssue.sentiment.oppose.toLocaleString()}
                  </span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-600">
                  <div
                    className="h-full bg-emerald-500"
                    style={{
                      width: `${(selectedIssue.sentiment.support / (selectedIssue.sentiment.total || 1)) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-red-500"
                    style={{
                      width: `${(selectedIssue.sentiment.oppose / (selectedIssue.sentiment.total || 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Total Votes</span>
                  <span className="block text-lg font-bold text-white">
                    {selectedIssue.sentiment.total.toLocaleString()}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Related Bills</span>
                  <span className="block text-lg font-bold text-white">
                    {selectedIssue.relatedBills}
                  </span>
                </div>
                {/*
                  WAS "Confidence — 85%". That figure was the literal 0.85,
                  written into the API for any issue with more than ten votes.
                  It read as a statistical confidence level and was not derived
                  from anything. What a reader wants from that panel is how many
                  people the number stands on, which is a real count.
                */}
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Votes counted</span>
                  <span className="block text-lg font-bold text-white">
                    {(selectedIssue.sentiment.total ?? 0).toLocaleString()}
                  </span>
                </div>
              </div>

              {selectedIssue.hotspots && selectedIssue.hotspots.length > 0 ? (
                <div>
                  <span className="mb-2 block font-medium text-slate-300">
                    Geographic Hotspots
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {selectedIssue.hotspots.map((hotspot, index) => (
                      <span
                        key={index}
                        className="rounded-full bg-indigo-500/20 px-3 py-1 text-sm text-indigo-300"
                      >
                        {hotspot}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </B2BShell>
  );
}
