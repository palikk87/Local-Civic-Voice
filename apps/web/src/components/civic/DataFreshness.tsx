/**
 * How current is the government you are looking at?
 *
 * WHY THIS EXISTS. A visitor had no way to tell whether this section showed
 * today's Congress or a snapshot from whenever the last sync happened to run.
 * After a deploy pause or a spent API key those two look identical, and a
 * platform whose entire claim is that its records are the real ones owes a
 * reader the date on them.
 *
 * Every figure comes from the database. The cadence is read from the API, which
 * reports the intervals the schedulers actually run at rather than a sentence
 * that can drift away from the code.
 */
import { useQuery } from "@tanstack/react-query";
import { Clock, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

interface Freshness {
  syncedAt: string | null;
  newestAction: { date: string | null; referenceId: string; title: string } | null;
  counts: Record<string, number>;
  cadence: { recordsHours: number; rollCallsHours: number; provenanceHours: number };
  awaitingProvenance: number;
}

/** "3 hours ago", "yesterday" — plain words, because a raw timestamp is not an answer. */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "in the last hour";
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function DataFreshness() {
  const { data } = useQuery<Freshness>({
    queryKey: ["government", "freshness"],
    queryFn: () => api.get<Freshness>("/api/government-references/freshness"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  /*
   * A payload that is not the shape this expects renders NOTHING.
   *
   * This used to read `Object.values(data.counts)` the moment `data` was
   * truthy, and `Object.values(undefined)` throws — so a response missing one
   * key took down the whole Government page through the error boundary. A
   * strip that says how fresh the records are is the least important thing on
   * that page; it must never be the reason the page is blank. Saying nothing
   * is also the honest answer here: with no counts there is no freshness to
   * report, and a zero would assert we hold no records at all.
   */
  if (!data || !data.counts || !data.cadence) return null;

  const synced = ago(data.syncedAt);
  const total = Object.values(data.counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="mb-4 rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
          {/*
            Null is a real answer and it is said plainly. "Never" is alarming in
            exactly the way it should be — it means the sync has not run.
          */}
          {synced ? `Records checked ${synced}` : "Records have not been checked yet"}
        </span>
        <span className="text-muted-foreground">
          {total.toLocaleString()} held — checked every {data.cadence.recordsHours}h, roll calls
          every {data.cadence.rollCallsHours}h
        </span>
      </div>

      {data.newestAction?.date ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Most recent action we hold: {new Date(data.newestAction.date).toLocaleDateString()} —{" "}
          {data.newestAction.title}
        </p>
      ) : null}

      {data.awaitingProvenance > 0 ? (
        /* Said out loud rather than hidden: those records show no date and no
           sponsor, and a reader should know that is a gap being filled rather
           than a fact about the law. */
        <p className="mt-1 text-xs text-muted-foreground">
          {data.awaitingProvenance.toLocaleString()} still waiting on a sponsor and introduction
          date from congress.gov — those fields stay blank until they arrive.
        </p>
      ) : null}
    </div>
  );
}
