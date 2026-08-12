// Web port of webapp/mobile/src/app/b2b/states.tsx — state-by-state analysis.
import { useEffect, useState } from "react";
import {
  Search,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  Vote,
  FileText,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type StateData } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

type SortKey = "engagement" | "sentiment" | "alphabetical";

function StateCard({
  state,
  rank,
  onClick,
}: {
  state: StateData;
  rank: number;
  onClick: () => void;
}) {
  const isPositive = state.sentiment.overall > 0;

  return (
    <button
      onClick={onClick}
      className="mb-3 w-full rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors hover:bg-slate-800/60"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center">
          <div className="mr-3 flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20">
            <span className="font-bold text-indigo-400">{rank}</span>
          </div>
          <div>
            <span className="block text-lg font-semibold text-white">{state.name}</span>
            <span className="block text-sm text-slate-400">
              {state.totalDistricts} districts
            </span>
          </div>
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
            {(state.sentiment.overall * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="mb-1 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-slate-700/30 p-2">
          <div className="flex items-center">
            <Vote size={12} color="#818CF8" />
            <span className="ml-1 text-xs text-slate-400">Votes</span>
          </div>
          <span className="font-bold text-white">
            {state.engagement.totalVotes.toLocaleString()}
          </span>
        </div>
        <div className="rounded-xl bg-slate-700/30 p-2">
          <div className="flex items-center">
            <Users size={12} color="#34D399" />
            <span className="ml-1 text-xs text-slate-400">Active</span>
          </div>
          <span className="font-bold text-white">
            {state.engagement.activeUsers.toLocaleString()}
          </span>
        </div>
        <div className="rounded-xl bg-slate-700/30 p-2">
          <div className="flex items-center">
            <FileText size={12} color="#FBBF24" />
            <span className="ml-1 text-xs text-slate-400">Posts</span>
          </div>
          <span className="font-bold text-white">
            {state.engagement.postsCreated.toLocaleString()}
          </span>
        </div>
      </div>

      {state.topIssues && state.topIssues.length > 0 ? (
        <div className="mt-3 flex items-center border-t border-slate-700/30 pt-3">
          <span className="mr-2 text-xs text-slate-400">Top:</span>
          {state.topIssues.slice(0, 3).map((issue) => (
            <span
              key={issue.id}
              className={cn(
                "mr-1 rounded-full px-2 py-0.5 text-xs",
                issue.sentiment > 0
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-red-500/10 text-red-400",
              )}
            >
              {issue.name}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

export default function B2BStates() {
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortKey>("engagement");
  const [selectedState, setSelectedState] = useState<StateData | null>(null);

  const states = useB2BStore((s) => s.states);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const fetchStates = useB2BStore((s) => s.fetchStates);
  const fetchStateDetails = useB2BStore((s) => s.fetchStateDetails);

  useEffect(() => {
    if (isAuthenticated) fetchStates();
  }, [isAuthenticated, fetchStates]);

  const handleStateClick = async (state: StateData) => {
    const details = await fetchStateDetails(state.stateCode);
    setSelectedState(details ?? state);
  };

  const filteredStates = states
    .filter(
      (state) =>
        state.name.toLowerCase().includes(search.toLowerCase()) ||
        state.stateCode.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      switch (sortBy) {
        case "engagement":
          return b.engagement.totalVotes - a.engagement.totalVotes;
        case "sentiment":
          return Math.abs(b.sentiment.overall) - Math.abs(a.sentiment.overall);
        case "alphabetical":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

  const sortOptions: Array<{ key: SortKey; label: string }> = [
    { key: "engagement", label: "Engagement" },
    { key: "sentiment", label: "Sentiment" },
    { key: "alphabetical", label: "A-Z" },
  ];

  const totalVotes = states.reduce((sum, s) => sum + s.engagement.totalVotes, 0);
  const totalActiveUsers = states.reduce((sum, s) => sum + s.engagement.activeUsers, 0);
  const avgSentiment =
    states.length > 0 ? states.reduce((sum, s) => sum + s.sentiment.overall, 0) / states.length : 0;

  return (
    <B2BShell title="State Analysis">
      <p className="-mt-4 mb-4 text-sm text-slate-400">State-by-state breakdown</p>

      {/* Summary Stats */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <span className="block text-xs text-slate-400">Total Votes</span>
          <span className="block text-xl font-bold text-white">{totalVotes.toLocaleString()}</span>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <span className="block text-xs text-slate-400">Active Users</span>
          <span className="block text-xl font-bold text-white">
            {totalActiveUsers.toLocaleString()}
          </span>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-3">
          <span className="block text-xs text-slate-400">Avg Sentiment</span>
          <span
            className={cn(
              "block text-xl font-bold",
              avgSentiment > 0 ? "text-emerald-400" : "text-red-400",
            )}
          >
            {avgSentiment > 0 ? "+" : ""}
            {(avgSentiment * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Search & Sort */}
      <div className="mb-3 flex items-center rounded-xl bg-slate-800/50 px-4 py-1">
        <Search size={20} color="#64748B" />
        <input
          className="flex-1 bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-500"
          placeholder="Search states..."
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

      {/* States List */}
      {filteredStates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Building2 size={48} color="#475569" />
          <span className="mt-4 text-lg text-slate-400">No states found</span>
        </div>
      ) : (
        <div className="md:columns-2 md:gap-4 [&>button]:break-inside-avoid">
          {filteredStates.map((state, index) => (
            <StateCard
              key={state.stateCode}
              state={state}
              rank={index + 1}
              onClick={() => handleStateClick(state)}
            />
          ))}
        </div>
      )}

      {/* State Detail Dialog */}
      <Dialog open={!!selectedState} onOpenChange={(open) => !open && setSelectedState(null)}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">
              {selectedState?.name} ({selectedState?.stateCode})
            </DialogTitle>
          </DialogHeader>

          {selectedState ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Total Votes</span>
                  <span className="block text-lg font-bold text-white">
                    {selectedState.engagement.totalVotes.toLocaleString()}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Active Users</span>
                  <span className="block text-lg font-bold text-white">
                    {selectedState.engagement.activeUsers.toLocaleString()}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <span className="block text-xs text-slate-400">Districts</span>
                  <span className="block text-lg font-bold text-white">
                    {selectedState.totalDistricts}
                  </span>
                </div>
              </div>

              <div className="rounded-xl bg-slate-700/30 p-4">
                <span className="mb-2 block font-medium text-slate-300">
                  Sentiment by Category
                </span>
                {Object.keys(selectedState.sentiment.byCategory ?? {}).length === 0 ? (
                  <p className="text-sm text-slate-500">No category data</p>
                ) : (
                  Object.entries(selectedState.sentiment.byCategory).map(([category, value]) => (
                    <div key={category} className="mb-2 flex items-center justify-between">
                      <span className="text-sm capitalize text-slate-300">
                        {category.replace(/_/g, " ")}
                      </span>
                      <span
                        className={cn(
                          "text-sm font-medium",
                          value > 0 ? "text-emerald-400" : "text-red-400",
                        )}
                      >
                        {value > 0 ? "+" : ""}
                        {(value * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))
                )}
              </div>

              {selectedState.topIssues && selectedState.topIssues.length > 0 ? (
                <div>
                  <span className="mb-2 block font-medium text-slate-300">Top Issues</span>
                  <div className="flex flex-wrap gap-2">
                    {selectedState.topIssues.map((issue) => (
                      <span
                        key={issue.id}
                        className={cn(
                          "rounded-full px-3 py-1 text-sm",
                          issue.sentiment > 0
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-red-500/10 text-red-400",
                        )}
                      >
                        {issue.name}
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
