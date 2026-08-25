/**
 * States, counted from the people in them.
 *
 * WHAT THIS SCREEN USED TO SHOW. All 51 states, always, each carrying the one
 * national sentiment figure multiplied by its share of the 435 House seats — so
 * every state displayed the identical score, and the vote counts were a
 * division sum rather than a count. It looked like national coverage on an
 * empty database.
 *
 * It now shows states somebody has actually declared, and says how many people
 * that is. A state with too few voices to aggregate says so.
 */
import { useEffect, useState } from "react";
import { Building2, ChevronRight, Loader2, MapPin, Users } from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import {
  useB2BStore,
  type Coverage,
  type DistrictRow,
  type PlaceResult,
  type StateRow,
} from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

/** One rendering of the union, used everywhere a Pulse appears. */
function Pulse({ pulse, className }: { pulse: PlaceResult; className?: string }) {
  if (!pulse.enough) {
    return (
      <span className={cn("text-sm text-slate-400", className)}>
        {pulse.voices === 0
          ? "No votes yet"
          : `${pulse.voices} ${pulse.voices === 1 ? "voice" : "voices"} — too few to report`}
      </span>
    );
  }

  const leaning = pulse.score > 0;
  return (
    <span
      className={cn(
        "text-sm font-semibold",
        pulse.score === 0 ? "text-slate-300" : leaning ? "text-emerald-400" : "text-red-400",
        className,
      )}
    >
      {leaning ? "+" : ""}
      {(pulse.score * 100).toFixed(0)}%{" "}
      <span className="font-normal text-slate-400">
        ({pulse.support} for, {pulse.oppose} against)
      </span>
    </span>
  );
}

/**
 * The honesty header.
 *
 * A map drawn from forty people out of twelve thousand looks exactly like a map
 * drawn from everybody, and no amount of shading conveys the difference. So it
 * is said in words, above the data, every time.
 */
function CoverageNote({ coverage }: { coverage: Coverage | null }) {
  if (!coverage) return null;

  return (
    <div className="mb-5 rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
      <div className="flex items-center">
        <Users size={16} color="#818CF8" />
        <span className="ml-2 font-medium text-white">What this is drawn from</span>
      </div>
      <p className="mt-2 text-sm text-slate-300">
        {coverage.placed.toLocaleString()} of {coverage.participants.toLocaleString()} members have
        told us their district, across {coverage.districtsRepresented} of them.{" "}
        {coverage.districtsReportable} have enough voices to report.
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Nothing here is estimated from national totals. Districts with too few voters are withheld
        rather than filled in.
      </p>
    </div>
  );
}

export default function B2BStates() {
  const states = useB2BStore((s) => s.states);
  const coverage = useB2BStore((s) => s.coverage);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const fetchStates = useB2BStore((s) => s.fetchStates);
  const fetchStateDetails = useB2BStore((s) => s.fetchStateDetails);

  const [loading, setLoading] = useState(true);
  const [openState, setOpenState] = useState<string | null>(null);
  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [loadingDistricts, setLoadingDistricts] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchStates().finally(() => setLoading(false));
  }, [isAuthenticated, fetchStates]);

  const open = async (state: StateRow) => {
    if (openState === state.stateCode) {
      setOpenState(null);
      return;
    }
    setOpenState(state.stateCode);
    setLoadingDistricts(true);
    const detail = await fetchStateDetails(state.stateCode);
    setDistricts(detail?.districts ?? []);
    setLoadingDistricts(false);
  };

  if (loading) {
    return (
      <B2BShell title="States">
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" color="#818CF8" />
        </div>
      </B2BShell>
    );
  }

  return (
    <B2BShell title="States">
      <CoverageNote coverage={coverage} />

      {states.length === 0 ? (
        /*
          The honest empty state. Previously this screen could not be empty —
          it always had 51 rows — which is precisely why nobody noticed there
          was no data behind them.
        */
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-8 text-center">
          <MapPin size={28} color="#64748B" className="mx-auto" />
          <p className="mt-3 font-medium text-white">No state has voices in it yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Members choose their district themselves, and it is optional. As they do, states appear
            here with real counts. Nothing is estimated in the meantime.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {states.map((state) => (
            <div
              key={state.stateCode}
              className="rounded-2xl border border-slate-700/50 bg-slate-800/30"
            >
              <button
                type="button"
                onClick={() => void open(state)}
                aria-label={`Districts in ${state.stateName}`}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20">
                    <Building2 size={18} color="#818CF8" />
                  </div>
                  <div className="ml-3">
                    <span className="block font-semibold text-white">{state.stateName}</span>
                    <span className="text-xs text-slate-400">
                      {state.residents.toLocaleString()}{" "}
                      {state.residents === 1 ? "member" : "members"} across{" "}
                      {state.districtsRepresented}{" "}
                      {state.districtsRepresented === 1 ? "district" : "districts"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Pulse pulse={state.pulse} />
                  <ChevronRight
                    size={18}
                    color="#64748B"
                    className={cn("transition-transform", openState === state.stateCode && "rotate-90")}
                  />
                </div>
              </button>

              {openState === state.stateCode ? (
                <div className="border-t border-slate-700/50 p-4">
                  {loadingDistricts ? (
                    <Loader2 className="h-5 w-5 animate-spin" color="#818CF8" />
                  ) : districts.length === 0 ? (
                    <p className="text-sm text-slate-400">No districts declared here yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {districts.map((d) => (
                        <li
                          key={d.districtId}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-900/40 px-3 py-2"
                        >
                          <div>
                            <span className="font-medium text-white">{d.districtId}</span>
                            {/* A real name from the congress.gov roster. This was
                                the literal string "Representative". */}
                            {d.representative ? (
                              <span className="ml-2 text-sm text-slate-400">
                                {d.representative.name} ({d.representative.party})
                              </span>
                            ) : (
                              <span className="ml-2 text-sm text-slate-500">seat vacant</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-slate-500">
                              {d.residents} {d.residents === 1 ? "member" : "members"}
                            </span>
                            <Pulse pulse={d.pulse} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </B2BShell>
  );
}
