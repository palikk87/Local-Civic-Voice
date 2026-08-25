/**
 * Where opinion is concentrated — from voters, not from seat counts.
 *
 * WHAT THIS SCREEN USED TO SHOW. All 435 districts, always, every one of them
 * shaded. The colour came from the single national sentiment figure; the
 * intensity came from that state's share of the 435 seats; and the party stripe
 * came from Math.random(), re-rolled on every request, so the same district
 * changed colour when you pressed refresh.
 *
 * Now: only districts where enough people have voted to say anything without
 * identifying them. The rest are listed as withheld, with their voice count,
 * because grey and "we will not say" are different claims and only one is true.
 */
import { useEffect, useMemo, useState } from "react";
import { EyeOff, Info, Loader2, MapPin, Users } from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type HeatmapPoint } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const PARTIES = [
  { key: undefined, label: "All parties" },
  { key: "D" as const, label: "Democrat" },
  { key: "R" as const, label: "Republican" },
  { key: "I" as const, label: "Independent" },
];

/** Green for support, red for opposition, weighted by how many voices back it. */
function shadeFor(point: HeatmapPoint, max: number): string {
  const sentiment = point.sentiment ?? 0;
  // Intensity is share of the busiest district, floored so a real district is
  // never invisible.
  const weight = max > 0 ? Math.max(0.25, point.value / max) : 0.25;
  const alpha = (0.15 + weight * 0.55).toFixed(2);
  if (sentiment > 0.05) return `rgba(52, 211, 153, ${alpha})`;
  if (sentiment < -0.05) return `rgba(239, 68, 68, ${alpha})`;
  return `rgba(148, 163, 184, ${alpha})`;
}

export default function B2BHeatmap() {
  const heatmapData = useB2BStore((s) => s.heatmapData);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const fetchHeatmapData = useB2BStore((s) => s.fetchHeatmapData);

  const [party, setParty] = useState<"D" | "R" | "I" | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HeatmapPoint | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    void fetchHeatmapData({ party }).finally(() => setLoading(false));
  }, [isAuthenticated, party, fetchHeatmapData]);

  const points = useMemo(() => heatmapData?.districts ?? [], [heatmapData]);
  const suppressed = heatmapData?.suppressed ?? [];
  const max = heatmapData?.range.max ?? 0;
  const coverage = heatmapData?.coverage;

  if (loading) {
    return (
      <B2BShell title="Heatmap">
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" color="#818CF8" />
        </div>
      </B2BShell>
    );
  }

  return (
    <B2BShell title="Heatmap">
      {coverage ? (
        <div className="mb-5 rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="flex items-center">
            <Users size={16} color="#818CF8" />
            <span className="ml-2 font-medium text-white">What this is drawn from</span>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            {coverage.placed.toLocaleString()} of {coverage.participants.toLocaleString()} members
            have told us their district. {coverage.districtsReportable} of{" "}
            {coverage.districtsRepresented} have enough voices to report.
          </p>
          {heatmapData?.derivation ? (
            <p className="mt-1 text-xs text-slate-500">{heatmapData.derivation}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {PARTIES.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => setParty(option.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              party === option.key
                ? "bg-indigo-500 text-white"
                : "bg-slate-800/60 text-slate-400 hover:text-white",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {points.length === 0 ? (
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8 text-center">
          <MapPin size={28} color="#64748B" className="mx-auto" />
          <p className="mt-3 font-medium text-white">Nothing can be shown yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            No district has reached {heatmapData?.floor ?? 5} voters. Districts appear here as
            members declare where they are and vote — never before.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {points.map((point) => (
            <button
              key={point.districtId}
              type="button"
              onClick={() => setSelected(point)}
              style={{ backgroundColor: shadeFor(point, max) }}
              className="rounded-xl border border-slate-700/50 p-3 text-left transition-transform hover:scale-[1.02]"
            >
              <span className="block font-semibold text-white">{point.districtId}</span>
              <span className="block text-xs text-slate-300">
                {point.representative?.name ?? "seat vacant"}
              </span>
              <span className="mt-1 block text-sm font-medium text-white">
                {point.sentiment !== null
                  ? `${point.sentiment > 0 ? "+" : ""}${(point.sentiment * 100).toFixed(0)}%`
                  : "—"}
              </span>
              <span className="text-xs text-slate-300">
                {point.value} {point.value === 1 ? "voice" : "voices"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div className="mt-5 rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="flex items-start justify-between">
            <div>
              <span className="block text-lg font-bold text-white">{selected.districtId}</span>
              <span className="text-sm text-slate-400">
                {selected.representative
                  ? `${selected.representative.name} — ${selected.representative.party}`
                  : "Seat vacant"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-slate-400 underline"
            >
              Close
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            {selected.value} {selected.value === 1 ? "member" : "members"} here have voted, leaning{" "}
            {selected.sentiment !== null && selected.sentiment > 0 ? "for" : "against"} on balance.
          </p>
        </div>
      ) : null}

      {suppressed.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-700/50 bg-slate-800/20 p-4">
          <div className="flex items-center">
            <EyeOff size={16} color="#94A3B8" />
            <span className="ml-2 font-medium text-white">
              {suppressed.length} {suppressed.length === 1 ? "district" : "districts"} withheld
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            Fewer than {heatmapData?.floor ?? 5} people have voted in each. Publishing a percentage
            over that few would identify them, so the count is shown and the opinion is not.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suppressed.map((d) => (
              <span
                key={d.districtId}
                className="rounded-lg bg-slate-900/60 px-2.5 py-1 text-xs text-slate-300"
              >
                {d.districtId} — {d.voices} {d.voices === 1 ? "voice" : "voices"}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-start rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
        <Info size={16} color="#818CF8" className="mt-0.5 shrink-0" />
        <p className="ml-2 text-sm text-slate-300">
          Every figure is counted from members who chose to say which district they are in. Nothing
          is estimated, apportioned by seat count, or inferred from a device.
        </p>
      </div>
    </B2BShell>
  );
}
