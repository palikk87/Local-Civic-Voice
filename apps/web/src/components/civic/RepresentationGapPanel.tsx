import { useQuery } from "@tanstack/react-query";
import { Scale, Users, Landmark } from "lucide-react";
import { api } from "@/lib/api";

/**
 * "The people here said 73% oppose. The House passed it 218-210."
 *
 * WHY THIS REPLACES THE OLD BLOCK. The gap section was gated on
 * `bill.officialVotes`, a field the client computed for itself, and it rendered
 * nothing at all when that was absent. So on every record Congress has not
 * voted on yet — which is most of them, and every newly introduced bill — the
 * single most compelling thing this platform can show simply was not on the
 * page, with nothing to say it existed. Reported as "the vote gap section is
 * missing as a whole", and fairly.
 *
 * It also computed the official half client-side. The real one comes from
 * /api/government-references/:id/representation-gap, which compares the
 * published tally here against a roll call parsed from senate.gov or
 * clerk.house.gov and stored with the URL it came from.
 *
 * EVERY STATE SAYS WHICH STATE IT IS. The endpoint returns a reason rather than
 * a bare null, so "Congress has not voted yet" and "not enough people here have
 * voted yet" are different sentences instead of the same blank space.
 */

interface GapResponse {
  gap: {
    publicSupportPct: number;
    publicSupport: number;
    publicOppose: number;
    publicTotal: number;
    officialSupportPct: number;
    officialYea: number;
    officialNay: number;
    chamber: string;
    question: string;
    result: string;
    votedAt: string;
    sourceUrl: string;
    gapPct: number;
    opposite: boolean;
  } | null;
  reason: "unknown_record" | "not_enough_voices" | "no_official_vote" | "no_recorded_split" | null;
  publicTotal?: number;
  needed?: number;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Scale size={18} className="text-amber-500" />
        <span className="font-semibold text-white">The Gap</span>
      </div>
      {children}
    </div>
  );
}

/**
 * `ready` is the page's load order, not a feature flag.
 *
 * This panel sits far below the fold on a law page, and the page used to ask
 * for it in the same breath as the record itself — so the thing a reader came
 * for queued behind panels they had not scrolled to. The page now opens its
 * requests top to bottom and passes `ready` when this one's turn arrives.
 *
 * Defaults to true, so every other caller behaves exactly as it did. Nothing is
 * ever skipped: a false here delays a request by a frame or two, it does not
 * cancel it.
 */
interface RepresentationGapPanelProps {
  referenceId?: string;
  /** False until this panel's turn in the page's load order. */
  ready?: boolean;
}

export function RepresentationGapPanel({ referenceId, ready = true }: RepresentationGapPanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["representation-gap", referenceId],
    queryFn: () => api.get<GapResponse>(`/api/government-references/${referenceId}/representation-gap`),
    enabled: !!referenceId && ready,
  });

  // No record to ask about yet — the page is still resolving which law this is.
  if (!referenceId) return null;

  if (isLoading) {
    return (
      <Shell>
        <p className="text-sm text-slate-400">Comparing…</p>
      </Shell>
    );
  }

  if (!data) return null;

  if (!data.gap) {
    const message =
      data.reason === "not_enough_voices"
        ? `Once ${data.needed ?? 10} people here have voted, this will compare them with the chamber. ${data.publicTotal ?? 0} so far.`
        : data.reason === "no_official_vote"
          ? "Congress has not voted on this yet. The moment there is a roll call, it appears here beside the public tally."
          : data.reason === "no_recorded_split"
            ? "The chamber passed this without a recorded split — a voice vote or unanimous consent — so there are no official numbers to compare against."
            : "No record to compare yet.";

    return (
      <Shell>
        <p className="text-sm text-slate-400">{message}</p>
      </Shell>
    );
  }

  const gap = data.gap;

  return (
    <Shell>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Users size={13} /> The people here
          </div>
          <p className="text-2xl font-semibold text-white">{gap.publicSupportPct}%</p>
          <p className="text-xs text-slate-400">
            for, of {gap.publicTotal.toLocaleString()} votes
          </p>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs text-slate-400">
            <Landmark size={13} /> The {gap.chamber}
          </div>
          <p className="text-2xl font-semibold text-white">{gap.officialSupportPct}%</p>
          <p className="text-xs text-slate-400">
            {gap.officialYea}–{gap.officialNay} · {gap.result}
          </p>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-700/50 pt-3">
        <p className="text-sm text-slate-200">
          {gap.opposite ? (
            <>
              {/* The case worth a headline: a majority here wanted one thing and
                  the chamber did the other. */}
              <span className="font-semibold text-amber-400">
                A majority here and the chamber landed on opposite sides.
              </span>{" "}
            </>
          ) : null}
          {gap.gapPct} percentage points apart.
        </p>
        <a
          href={gap.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs text-amber-500 hover:underline"
        >
          {gap.question} · official roll call
        </a>
      </div>
    </Shell>
  );
}
