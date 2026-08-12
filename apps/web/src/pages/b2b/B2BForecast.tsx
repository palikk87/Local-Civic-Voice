// Web port of webapp/mobile/src/app/b2b/forecast.tsx — predictive sentiment analysis.
import { useMemo, useState } from "react";
import {
  Search,
  Activity,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  CheckCircle,
  X,
  ChevronRight,
  Zap,
  Clock,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type ForecastData } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

// Same sample targets as mobile
const SAMPLE_BILLS = [
  { id: "hr-1049", name: "SAVE Act", category: "Election Security" },
  { id: "hr-8281", name: "Kids Online Safety Act", category: "Technology" },
  { id: "s-686", name: "TikTok Ban", category: "Technology" },
  { id: "hr-2", name: "Secure the Border Act", category: "Immigration" },
  { id: "hr-3350", name: "Medicare Drug Price Negotiation", category: "Healthcare" },
];

const SAMPLE_ISSUES = [
  { id: "healthcare", name: "Healthcare", category: "Policy" },
  { id: "immigration", name: "Immigration", category: "Policy" },
  { id: "economy", name: "Economy", category: "Policy" },
  { id: "climate", name: "Climate Change", category: "Environment" },
  { id: "education", name: "Education", category: "Policy" },
];

/** Stable pseudo-random in [0,1) from a string seed, so cards don't flicker. */
function seeded(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 1000) / 1000;
}

function ForecastCard({
  item,
  type,
  onClick,
}: {
  item: { id: string; name: string; category: string };
  type: "bill" | "issue";
  onClick: () => void;
}) {
  const currentSentiment = (seeded(item.id, 1) - 0.5) * 2;
  const projectedChange = (seeded(item.id, 2) - 0.3) * 0.5;
  const confidence = 0.6 + seeded(item.id, 3) * 0.35;
  const isRising = projectedChange > 0;

  return (
    <button
      onClick={onClick}
      className="mb-3 w-full rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors hover:bg-slate-800/60"
    >
      <div className="mb-3">
        <div className="mb-1 flex items-center">
          <span
            className={cn(
              "mr-2 rounded-full px-2 py-0.5 text-xs",
              type === "bill" ? "bg-indigo-500/20 text-indigo-300" : "bg-emerald-500/20 text-emerald-300",
            )}
          >
            {type === "bill" ? "Bill" : "Issue"}
          </span>
          <span className="text-xs text-slate-400">{item.category}</span>
        </div>
        <span className="text-lg font-semibold text-white">{item.name}</span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-slate-700/30 p-3">
          <span className="mb-1 block text-xs text-slate-400">Current</span>
          <span
            className={cn(
              "text-lg font-bold",
              currentSentiment > 0 ? "text-emerald-400" : "text-red-400",
            )}
          >
            {currentSentiment > 0 ? "+" : ""}
            {(currentSentiment * 100).toFixed(1)}%
          </span>
        </div>
        <div className="rounded-xl bg-slate-700/30 p-3">
          <span className="mb-1 block text-xs text-slate-400">30-Day Projected</span>
          <div className="flex items-center">
            {isRising ? (
              <TrendingUp size={16} color="#34D399" />
            ) : (
              <TrendingDown size={16} color="#EF4444" />
            )}
            <span
              className={cn("ml-1 text-lg font-bold", isRising ? "text-emerald-400" : "text-red-400")}
            >
              {projectedChange > 0 ? "+" : ""}
              {(projectedChange * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-700/30 pt-3">
        <div className="flex items-center">
          <span
            className={cn(
              "mr-2 h-2 w-2 rounded-full",
              confidence > 0.8 ? "bg-emerald-500" : confidence > 0.6 ? "bg-amber-500" : "bg-red-500",
            )}
          />
          <span className="text-sm text-slate-400">
            {(confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <div className="flex items-center">
          <span className="text-sm text-indigo-400">View forecast</span>
          <ChevronRight size={16} color="#818CF8" />
        </div>
      </div>
    </button>
  );
}

export default function B2BForecast() {
  const [search, setSearch] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"bills" | "issues">("bills");
  const [selectedForecast, setSelectedForecast] = useState<ForecastData | null>(null);

  const session = useB2BStore((s) => s.session);
  const fetchForecast = useB2BStore((s) => s.fetchForecast);

  const isEnterprise = session?.tier === "enterprise";

  const handleForecastClick = async (id: string, type: "bill" | "issue") => {
    if (!isEnterprise) return;

    const forecast = await fetchForecast(type, id);
    if (forecast) {
      setSelectedForecast(forecast);
    } else {
      // Demo forecast fallback — same as mobile
      setSelectedForecast({
        targetId: id,
        targetType: type,
        currentSentiment: (seeded(id, 4) - 0.5) * 2,
        predictions: Array.from({ length: 7 }, (_, i) => ({
          date: new Date(Date.now() + i * 5 * 24 * 60 * 60 * 1000).toISOString(),
          predicted: (seeded(id, 5 + i) - 0.5) * 2,
          confidence: 0.6 + seeded(id, 20 + i) * 0.35,
          lowerBound: -0.5,
          upperBound: 0.5,
        })),
        factors: [
          { factor: "Media Coverage", impact: 0.15, direction: "positive" },
          { factor: "Social Media Engagement", impact: 0.12, direction: "positive" },
          { factor: "Opposition Campaign", impact: -0.08, direction: "negative" },
          { factor: "Economic Conditions", impact: 0.05, direction: "positive" },
        ],
        recommendation:
          "Sentiment is projected to strengthen over the next 30 days. Consider timing public statements to align with peak engagement periods.",
      });
    }
  };

  const items = activeTab === "bills" ? SAMPLE_BILLS : SAMPLE_ISSUES;
  const filteredItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.name.toLowerCase().includes(search.toLowerCase()) ||
          item.category.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search],
  );

  return (
    <B2BShell title="Forecasting">
      <div className="-mt-4 mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Predictive sentiment analysis</p>
        {!isEnterprise ? (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-400">
            Enterprise
          </span>
        ) : null}
      </div>

      {!isEnterprise ? (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="mb-2 flex items-center">
            <Zap size={16} color="#FBBF24" />
            <span className="ml-2 font-medium text-amber-400">Enterprise Feature</span>
          </div>
          <p className="text-sm text-slate-300">
            Predictive forecasting is available on the Enterprise plan. Upgrade to access
            30-day sentiment projections and impact analysis.
          </p>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setActiveTab("bills")}
          className={cn(
            "flex-1 rounded-xl py-3 text-center sm:max-w-40",
            activeTab === "bills"
              ? "bg-indigo-500 font-medium text-white"
              : "bg-slate-800/50 text-slate-400 hover:bg-slate-800",
          )}
        >
          Bills
        </button>
        <button
          onClick={() => setActiveTab("issues")}
          className={cn(
            "flex-1 rounded-xl py-3 text-center sm:max-w-40",
            activeTab === "issues"
              ? "bg-indigo-500 font-medium text-white"
              : "bg-slate-800/50 text-slate-400 hover:bg-slate-800",
          )}
        >
          Issues
        </button>
      </div>

      {/* Search */}
      <div className="mb-4 flex items-center rounded-xl bg-slate-800/50 px-4 py-1">
        <Search size={20} color="#64748B" />
        <input
          className="flex-1 bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-500"
          placeholder={`Search ${activeTab}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.length > 0 ? (
          <button onClick={() => setSearch("")} aria-label="Clear search">
            <X size={18} color="#64748B" />
          </button>
        ) : null}
      </div>

      {/* Forecast List */}
      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Activity size={48} color="#475569" />
          <span className="mt-4 text-lg text-slate-400">No forecasts available</span>
        </div>
      ) : (
        <div className="md:columns-2 md:gap-4 [&>button]:break-inside-avoid">
          {filteredItems.map((item) => (
            <ForecastCard
              key={item.id}
              item={item}
              type={activeTab === "bills" ? "bill" : "issue"}
              onClick={() => handleForecastClick(item.id, activeTab === "bills" ? "bill" : "issue")}
            />
          ))}
        </div>
      )}

      {/* Forecast Detail Dialog */}
      <Dialog
        open={!!selectedForecast}
        onOpenChange={(open) => !open && setSelectedForecast(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Forecast Analysis</DialogTitle>
          </DialogHeader>

          {selectedForecast ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-700/30 p-4">
                <span className="mb-2 block font-medium text-slate-300">Current Sentiment</span>
                <span
                  className={cn(
                    "text-3xl font-bold",
                    selectedForecast.currentSentiment > 0 ? "text-emerald-400" : "text-red-400",
                  )}
                >
                  {selectedForecast.currentSentiment > 0 ? "+" : ""}
                  {(selectedForecast.currentSentiment * 100).toFixed(1)}%
                </span>
              </div>

              <div className="rounded-xl bg-slate-700/30 p-4">
                <span className="mb-3 block font-medium text-slate-300">30-Day Projection</span>
                <div className="flex h-32 items-end justify-between px-2">
                  {selectedForecast.predictions.map((pred, index) => {
                    const height = Math.abs(pred.predicted) * 100;
                    const isPositive = pred.predicted > 0;
                    return (
                      <div key={index} className="mx-0.5 flex flex-1 items-end self-stretch">
                        <div
                          className={cn(
                            "w-full rounded-t-sm",
                            isPositive ? "bg-emerald-500" : "bg-red-500",
                          )}
                          style={{
                            height: `${Math.max(height, 10)}%`,
                            opacity: 0.5 + pred.confidence * 0.5,
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between">
                  <span className="text-xs text-slate-500">Now</span>
                  <span className="text-xs text-slate-500">+30 days</span>
                </div>
              </div>

              <div>
                <span className="mb-3 block font-medium text-slate-300">Impact Factors</span>
                {selectedForecast.factors.map((factor, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between border-b border-slate-700/30 py-3"
                  >
                    <div className="flex flex-1 items-center">
                      {factor.direction === "positive" ? (
                        <CheckCircle size={16} color="#34D399" />
                      ) : (
                        <AlertTriangle size={16} color="#EF4444" />
                      )}
                      <span className="ml-2 text-white">{factor.factor}</span>
                    </div>
                    <span
                      className={
                        factor.direction === "positive" ? "text-emerald-400" : "text-red-400"
                      }
                    >
                      {factor.impact > 0 ? "+" : ""}
                      {(factor.impact * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                <div className="mb-2 flex items-center">
                  <Target size={16} color="#818CF8" />
                  <span className="ml-2 font-medium text-indigo-300">Recommendation</span>
                </div>
                <p className="text-slate-300">{selectedForecast.recommendation}</p>
              </div>

              <div className="rounded-xl bg-slate-700/30 p-4">
                <div className="mb-2 flex items-center">
                  <Clock size={14} color="#64748B" />
                  <span className="ml-2 text-xs text-slate-400">Last updated: Just now</span>
                </div>
                <p className="text-xs text-slate-500">
                  Forecasts are based on historical trends and current engagement patterns.
                  Actual outcomes may vary based on external events and policy changes.
                </p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </B2BShell>
  );
}
