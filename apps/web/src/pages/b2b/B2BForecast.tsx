/**
 * What a record's support has actually done, and where that points.
 *
 * WHAT THIS SCREEN USED TO SHOW. A hardcoded list of sample bills that were not
 * in the database; a "demo forecast fallback" built from a seeded PRNG whenever
 * the API returned nothing; invented drivers — "Media Coverage", "Opposition
 * Campaign", "Economic Conditions" — with invented impact percentages; and a
 * written recommendation ("consider timing public statements to align with peak
 * engagement periods") generated for every record regardless of its data.
 *
 * None of it was measured. All of it read as analysis.
 *
 * The history below is the Pulse day by day, reconstructed from the positions
 * people actually took. The projection is a least-squares fit over that history
 * and appears only where there is enough of it. There is no recommendation,
 * because nothing here knows anything about a client's strategy, and there are
 * no drivers, because nothing measures them.
 */
import { useEffect, useMemo, useState } from "react";
import { Activity, Info, Loader2, Search, TrendingDown, TrendingUp } from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type TrajectoryData } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

/** A sparkline over whatever range the data actually covers. */
function Trace({ data }: { data: TrajectoryData }) {
  const observed = data.history.map((d) => {
    const total = d.support + d.oppose;
    return total > 0 ? (d.support - d.oppose) / total : 0;
  });
  const projected = data.projection?.points.map((p) => p.predicted) ?? [];
  const all = [...observed, ...projected];
  if (all.length < 2) return null;

  const width = 100;
  const height = 40;
  const toPoints = (values: number[], offset: number) =>
    values
      .map((v, i) => {
        const x = ((i + offset) / (all.length - 1)) * width;
        // score runs -1..1; y is inverted for SVG.
        const y = height - ((v + 1) / 2) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" preserveAspectRatio="none">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#334155" strokeWidth="0.5" />
      <polyline
        points={toPoints(observed, 0)}
        fill="none"
        stroke="#818CF8"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {projected.length > 0 ? (
        <polyline
          points={toPoints(projected, observed.length)}
          fill="none"
          stroke="#34D399"
          strokeWidth="1.5"
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

export default function B2BForecast() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<TrajectoryData | null>(null);
  const [loadingOne, setLoadingOne] = useState(false);
  const [loading, setLoading] = useState(true);

  const session = useB2BStore((s) => s.session);
  const issues = useB2BStore((s) => s.issues);
  const fetchIssues = useB2BStore((s) => s.fetchIssues);
  const fetchForecast = useB2BStore((s) => s.fetchForecast);

  const isEnterprise = session?.tier === "enterprise";

  useEffect(() => {
    void fetchIssues().finally(() => setLoading(false));
  }, [fetchIssues]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return issues.slice(0, 30);
    return issues
      .filter((i) => i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [issues, search]);

  const open = async (id: string) => {
    if (!isEnterprise) return;
    setSelectedId(id);
    setLoadingOne(true);
    // No fallback. When there is nothing to show, the screen says so — the
    // seeded demo forecast that used to fill this gap was the whole problem.
    setData(await fetchForecast("bill", id));
    setLoadingOne(false);
  };

  return (
    <B2BShell title="Trajectory">
      <div className="-mt-4 mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Measured history, and where it points</p>
        {!isEnterprise ? (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs text-amber-400">
            Enterprise
          </span>
        ) : null}
      </div>

      {!isEnterprise ? (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <span className="font-medium text-amber-400">Enterprise plan</span>
          <p className="mt-1 text-sm text-slate-300">
            Trajectories are available on the Enterprise plan.
          </p>
        </div>
      ) : null}

      <div className="relative mb-4">
        <Search size={16} color="#64748B" className="absolute left-3 top-3" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search records"
          aria-label="Search records"
          className="w-full rounded-xl border border-slate-700 bg-slate-900/60 py-2.5 pl-9 pr-3 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin" color="#818CF8" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8 text-center">
          <p className="font-medium text-white">No records yet.</p>
          <p className="mt-1 text-sm text-slate-400">
            This list is the records the platform actually holds. It was a fixed list of samples.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => void open(issue.id)}
              disabled={!isEnterprise}
              className={cn(
                "flex w-full items-center justify-between rounded-xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors",
                isEnterprise ? "hover:bg-slate-800/60" : "opacity-60",
                selectedId === issue.id && "border-indigo-500",
              )}
            >
              <div className="min-w-0">
                <span className="block truncate font-medium text-white">{issue.name}</span>
                <span className="text-xs text-slate-400">
                  {issue.category ?? "uncategorised"} — {issue.sentiment.total} votes
                </span>
              </div>
              <Activity size={16} color="#818CF8" />
            </button>
          ))}
        </div>
      )}

      {selectedId ? (
        <div className="mt-5 rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5">
          {loadingOne ? (
            <Loader2 className="h-6 w-6 animate-spin" color="#818CF8" />
          ) : !data ? (
            <p className="text-sm text-slate-400">Nothing recorded for this one yet.</p>
          ) : (
            <>
              <Trace data={data} />

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <span className="block text-xs text-slate-400">Now</span>
                  <span className="text-lg font-bold text-white">
                    {data.currentSentiment > 0 ? "+" : ""}
                    {(data.currentSentiment * 100).toFixed(0)}%
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Observed</span>
                  <span className="text-lg font-bold text-white">
                    {data.basis.days} {data.basis.days === 1 ? "day" : "days"}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-slate-400">Voices</span>
                  <span className="text-lg font-bold text-white">{data.basis.voices}</span>
                </div>
              </div>

              {data.projection ? (
                <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <div className="flex items-center">
                    {data.projection.slopePerDay >= 0 ? (
                      <TrendingUp size={16} color="#34D399" />
                    ) : (
                      <TrendingDown size={16} color="#EF4444" />
                    )}
                    <span className="ml-2 font-medium text-white">
                      {data.projection.slopePerDay >= 0 ? "Rising" : "Falling"} by{" "}
                      {Math.abs(data.projection.slopePerDay * 100).toFixed(2)} points a day
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Fitted by {data.projection.method} over {data.basis.days} days. The shaded range
                    widens with distance because a line fitted to scattered readings says less about
                    day 30 than about day 1.
                  </p>
                </div>
              ) : (
                /* Was: thirty days of line drawn from anything at all. */
                <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <span className="font-medium text-white">No projection yet</span>
                  <p className="mt-1 text-sm text-slate-400">
                    {data.noProjection?.daysObserved ?? 0} days of history recorded;{" "}
                    {data.noProjection?.daysNeeded ?? 7} are needed before a line means anything.
                    The measured history above is real.
                  </p>
                </div>
              )}

              {data.basis.lawChangedOn.length > 0 ? (
                <div className="mt-3 flex items-start rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-3">
                  <Info size={15} color="#818CF8" className="mt-0.5 shrink-0" />
                  <p className="ml-2 text-sm text-slate-300">
                    The text of this law changed on {data.basis.lawChangedOn.join(", ")}. Movement
                    around those dates may be about the change rather than a shift of opinion.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </B2BShell>
  );
}
