// Web port of webapp/mobile/src/app/b2b/heatmap.tsx — geographic sentiment heatmap.
import { useEffect, useMemo, useState } from "react";
import { Filter, TrendingUp, TrendingDown, Users, Vote, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

// Simplified US map positions (same layout as mobile, in a 520 x 320 space)
const STATE_POSITIONS: Record<string, { x: number; y: number; width: number; height: number }> = {
  WA: { x: 45, y: 20, width: 45, height: 35 },
  OR: { x: 40, y: 55, width: 50, height: 40 },
  CA: { x: 30, y: 95, width: 45, height: 85 },
  NV: { x: 65, y: 80, width: 40, height: 55 },
  ID: { x: 95, y: 35, width: 40, height: 60 },
  MT: { x: 135, y: 20, width: 70, height: 45 },
  WY: { x: 145, y: 65, width: 55, height: 40 },
  UT: { x: 105, y: 95, width: 40, height: 50 },
  AZ: { x: 95, y: 145, width: 50, height: 55 },
  CO: { x: 155, y: 105, width: 55, height: 45 },
  NM: { x: 145, y: 150, width: 50, height: 55 },
  ND: { x: 205, y: 25, width: 55, height: 35 },
  SD: { x: 205, y: 60, width: 55, height: 35 },
  NE: { x: 195, y: 95, width: 65, height: 35 },
  KS: { x: 205, y: 130, width: 60, height: 35 },
  OK: { x: 210, y: 165, width: 55, height: 35 },
  TX: { x: 195, y: 200, width: 85, height: 90 },
  MN: { x: 260, y: 30, width: 50, height: 55 },
  IA: { x: 270, y: 85, width: 45, height: 35 },
  MO: { x: 275, y: 120, width: 50, height: 45 },
  AR: { x: 280, y: 165, width: 40, height: 35 },
  LA: { x: 285, y: 210, width: 40, height: 40 },
  WI: { x: 310, y: 40, width: 40, height: 50 },
  IL: { x: 315, y: 90, width: 35, height: 60 },
  MS: { x: 320, y: 180, width: 30, height: 50 },
  MI: { x: 335, y: 35, width: 50, height: 55 },
  IN: { x: 350, y: 95, width: 30, height: 45 },
  KY: { x: 355, y: 140, width: 50, height: 30 },
  TN: { x: 345, y: 165, width: 60, height: 25 },
  AL: { x: 355, y: 190, width: 30, height: 45 },
  OH: { x: 380, y: 90, width: 35, height: 40 },
  WV: { x: 395, y: 120, width: 30, height: 30 },
  VA: { x: 405, y: 135, width: 50, height: 30 },
  NC: { x: 400, y: 165, width: 55, height: 25 },
  SC: { x: 405, y: 190, width: 35, height: 30 },
  GA: { x: 385, y: 200, width: 40, height: 45 },
  FL: { x: 395, y: 245, width: 50, height: 60 },
  PA: { x: 410, y: 80, width: 45, height: 30 },
  NY: { x: 420, y: 50, width: 50, height: 35 },
  VT: { x: 455, y: 30, width: 20, height: 25 },
  NH: { x: 470, y: 35, width: 15, height: 30 },
  ME: { x: 480, y: 15, width: 30, height: 45 },
  MA: { x: 470, y: 60, width: 25, height: 15 },
  RI: { x: 475, y: 75, width: 12, height: 12 },
  CT: { x: 460, y: 75, width: 18, height: 15 },
  NJ: { x: 455, y: 85, width: 15, height: 25 },
  DE: { x: 450, y: 110, width: 12, height: 18 },
  MD: { x: 430, y: 115, width: 25, height: 15 },
  DC: { x: 432, y: 125, width: 8, height: 8 },
  AK: { x: 30, y: 250, width: 70, height: 50 },
  HI: { x: 120, y: 280, width: 50, height: 30 },
};

const CATEGORIES = [
  "Healthcare", "Economy", "Immigration", "Environment", "Education",
  "Civil Rights", "Defense", "Technology", "Housing", "Crime",
];

function sentimentColor(sentiment: number): string {
  if (sentiment > 0.3) return "#22C55E";
  if (sentiment > 0.1) return "#86EFAC";
  if (sentiment > -0.1) return "#64748B";
  if (sentiment > -0.3) return "#FCA5A5";
  return "#EF4444";
}

export default function B2BHeatmap() {
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [partyFilter, setPartyFilter] = useState<string | null>(null);

  const states = useB2BStore((s) => s.states);
  const heatmapData = useB2BStore((s) => s.heatmapData);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const fetchStates = useB2BStore((s) => s.fetchStates);
  const fetchHeatmapData = useB2BStore((s) => s.fetchHeatmapData);

  useEffect(() => {
    if (isAuthenticated) fetchStates();
  }, [isAuthenticated, fetchStates]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchHeatmapData({
      category: categoryFilter ?? undefined,
      party: partyFilter ?? undefined,
    });
  }, [isAuthenticated, categoryFilter, partyFilter, fetchHeatmapData]);

  // Aggregate district heatmap data to state level; fall back to state
  // sentiment from /geo/states when district data is unavailable (same
  // source mobile lists below its map).
  const stateData = useMemo(() => {
    const aggregated: Record<string, { sentiment: number; engagement: number; count: number }> = {};

    heatmapData?.districts?.forEach((district) => {
      const stateCode = district.districtId.split("-")[0];
      if (!aggregated[stateCode]) {
        aggregated[stateCode] = { sentiment: 0, engagement: 0, count: 0 };
      }
      aggregated[stateCode].sentiment += district.sentiment;
      aggregated[stateCode].engagement += district.value;
      aggregated[stateCode].count += 1;
    });
    Object.keys(aggregated).forEach((state) => {
      if (aggregated[state].count > 0) {
        aggregated[state].sentiment /= aggregated[state].count;
      }
    });

    if (Object.keys(aggregated).length === 0) {
      states.forEach((s) => {
        aggregated[s.stateCode] = {
          sentiment: s.sentiment.overall,
          engagement: s.engagement.totalVotes,
          count: 1,
        };
      });
    }

    return aggregated;
  }, [heatmapData, states]);

  const selectedStateData = selectedState
    ? states.find((s) => s.stateCode === selectedState) ?? null
    : null;

  return (
    <B2BShell title="District Heatmap">
      <div className="-mt-4 mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Geographic sentiment analysis</p>
        <button
          onClick={() => setShowFilters(true)}
          className="flex items-center rounded-xl bg-slate-800/50 px-3 py-2 text-sm text-indigo-300 transition-colors hover:bg-slate-800"
        >
          <Filter size={16} className="mr-1.5" color="#818CF8" />
          Filters
        </button>
      </div>

      {/* Active Filters */}
      {categoryFilter || partyFilter ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {categoryFilter ? (
            <button
              onClick={() => setCategoryFilter(null)}
              className="flex items-center rounded-full bg-indigo-500/20 px-3 py-1 text-sm text-indigo-300"
            >
              {categoryFilter}
              <X size={14} color="#A5B4FC" className="ml-1" />
            </button>
          ) : null}
          {partyFilter ? (
            <button
              onClick={() => setPartyFilter(null)}
              className="flex items-center rounded-full bg-indigo-500/20 px-3 py-1 text-sm text-indigo-300"
            >
              {partyFilter === "D" ? "Democrat" : partyFilter === "R" ? "Republican" : "Independent"}
              <X size={14} color="#A5B4FC" className="ml-1" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        <div>
          {/* Map */}
          <div className="relative w-full overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/30" style={{ aspectRatio: "520 / 320" }}>
            {Object.keys(STATE_POSITIONS).map((stateCode) => {
              const pos = STATE_POSITIONS[stateCode];
              const data = stateData[stateCode] ?? { sentiment: 0, engagement: 100, count: 0 };
              const opacity = Math.min(0.4 + (data.engagement / 10000) * 0.6, 1);
              return (
                <button
                  key={stateCode}
                  onClick={() =>
                    setSelectedState(selectedState === stateCode ? null : stateCode)
                  }
                  className="absolute flex items-center justify-center rounded transition-transform hover:z-10 hover:scale-110"
                  style={{
                    left: `${(pos.x / 520) * 100}%`,
                    top: `${(pos.y / 320) * 100}%`,
                    width: `${(pos.width / 520) * 100}%`,
                    height: `${(pos.height / 320) * 100}%`,
                    backgroundColor: sentimentColor(data.sentiment),
                    opacity,
                    border: selectedState === stateCode ? "2px solid #FFF" : "none",
                  }}
                  title={stateCode}
                >
                  <span className="text-[9px] font-bold text-white">{stateCode}</span>
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 flex items-center justify-center gap-4">
            <div className="flex items-center">
              <span className="mr-1 h-4 w-4 rounded bg-emerald-500" />
              <span className="text-xs text-slate-400">Support</span>
            </div>
            <div className="flex items-center">
              <span className="mr-1 h-4 w-4 rounded bg-slate-500" />
              <span className="text-xs text-slate-400">Neutral</span>
            </div>
            <div className="flex items-center">
              <span className="mr-1 h-4 w-4 rounded bg-red-500" />
              <span className="text-xs text-slate-400">Oppose</span>
            </div>
          </div>
        </div>

        <div>
          {/* Selected State Details */}
          {selectedStateData ? (
            <div className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-lg font-bold text-white">{selectedStateData.name}</span>
                <div
                  className={cn(
                    "flex items-center rounded-full px-2 py-1",
                    selectedStateData.sentiment.overall > 0 ? "bg-emerald-500/20" : "bg-red-500/20",
                  )}
                >
                  {selectedStateData.sentiment.overall > 0 ? (
                    <TrendingUp size={14} color="#34D399" />
                  ) : (
                    <TrendingDown size={14} color="#EF4444" />
                  )}
                  <span
                    className={cn(
                      "ml-1 font-medium",
                      selectedStateData.sentiment.overall > 0 ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {(selectedStateData.sentiment.overall * 100).toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <div className="mb-1 flex items-center">
                    <Vote size={14} color="#818CF8" />
                    <span className="ml-1 text-xs text-slate-400">Votes</span>
                  </div>
                  <span className="text-lg font-bold text-white">
                    {selectedStateData.engagement.totalVotes.toLocaleString()}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-700/30 p-3">
                  <div className="mb-1 flex items-center">
                    <Users size={14} color="#34D399" />
                    <span className="ml-1 text-xs text-slate-400">Active Users</span>
                  </div>
                  <span className="text-lg font-bold text-white">
                    {selectedStateData.engagement.activeUsers.toLocaleString()}
                  </span>
                </div>
              </div>

              {selectedStateData.topIssues && selectedStateData.topIssues.length > 0 ? (
                <>
                  <span className="mb-2 block font-medium text-slate-300">Top Issues</span>
                  {selectedStateData.topIssues.slice(0, 3).map((issue) => (
                    <div
                      key={issue.id}
                      className="flex items-center justify-between border-b border-slate-700/30 py-2"
                    >
                      <span className="text-white">{issue.name}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-1 text-xs font-medium",
                          issue.sentiment > 0
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400",
                        )}
                      >
                        {issue.sentiment > 0 ? "+" : ""}
                        {(issue.sentiment * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-dashed border-slate-700/50 p-6 text-center">
              <p className="text-sm text-slate-500">Click a state on the map to see details</p>
            </div>
          )}

          {/* State List */}
          <span className="mb-3 block text-lg font-bold text-white">All States</span>
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-2">
            {[...states]
              .sort((a, b) => Math.abs(b.sentiment.overall) - Math.abs(a.sentiment.overall))
              .slice(0, 10)
              .map((state) => (
                <button
                  key={state.stateCode}
                  onClick={() => setSelectedState(state.stateCode)}
                  className="flex w-full items-center justify-between border-b border-slate-700/30 px-2 py-3 text-left last:border-b-0 hover:bg-slate-800/60"
                >
                  <div className="flex items-center">
                    <span
                      className={cn(
                        "mr-3 h-3 w-3 rounded-full",
                        state.sentiment.overall > 0.1
                          ? "bg-emerald-500"
                          : state.sentiment.overall < -0.1
                            ? "bg-red-500"
                            : "bg-slate-500",
                      )}
                    />
                    <span className="font-medium text-white">{state.name}</span>
                  </div>
                  <div className="flex items-center">
                    <span className="mr-2 text-sm text-slate-400">
                      {state.engagement.totalVotes.toLocaleString()} votes
                    </span>
                    <span
                      className={cn(
                        "font-medium",
                        state.sentiment.overall > 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      {state.sentiment.overall > 0 ? "+" : ""}
                      {(state.sentiment.overall * 100).toFixed(1)}%
                    </span>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Filter Dialog */}
      <Dialog open={showFilters} onOpenChange={setShowFilters}>
        <DialogContent className="border-slate-700 bg-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Filters</DialogTitle>
          </DialogHeader>

          <span className="text-slate-400">Issue Category</span>
          <div className="mb-4 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm",
                  categoryFilter === cat ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-300",
                )}
              >
                {cat}
              </button>
            ))}
          </div>

          <span className="text-slate-400">District Party</span>
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setPartyFilter(partyFilter === "D" ? null : "D")}
              className={cn(
                "flex-1 rounded-xl py-3 font-medium text-white",
                partyFilter === "D" ? "bg-blue-500" : "bg-slate-700",
              )}
            >
              Democrat
            </button>
            <button
              onClick={() => setPartyFilter(partyFilter === "R" ? null : "R")}
              className={cn(
                "flex-1 rounded-xl py-3 font-medium text-white",
                partyFilter === "R" ? "bg-red-500" : "bg-slate-700",
              )}
            >
              Republican
            </button>
            <button
              onClick={() => setPartyFilter(partyFilter === "I" ? null : "I")}
              className={cn(
                "flex-1 rounded-xl py-3 font-medium text-white",
                partyFilter === "I" ? "bg-purple-500" : "bg-slate-700",
              )}
            >
              Independent
            </button>
          </div>

          <button
            onClick={() => setShowFilters(false)}
            className="w-full rounded-xl bg-indigo-500 py-4 font-bold text-white"
          >
            Apply Filters
          </button>
        </DialogContent>
      </Dialog>
    </B2BShell>
  );
}
