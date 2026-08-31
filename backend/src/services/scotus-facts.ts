import { prisma } from "../prisma";
import { env } from "../env";

import { fetchCourtListener } from "./courtlistener";

/**
 * A RULING FILLS ITS OWN MISSING FACTS, ONCE, WHEN SOMEBODY OPENS IT.
 *
 * Khalid's rule, and the reason there is no scheduled sweep here: "on a fresh
 * load of that law card, the system populates all criterias bc they were not
 * available… the system saves it to the MRID then when the second user opens
 * that same card, the information is pulled from the MRID rather than have to
 * go search API's."
 *
 * WHAT WAS BROKEN. A Supreme Court card names either the justice who wrote the
 * majority or, failing that, the bench that sat the day it was decided. Both
 * need something the record does not always carry: the author needs a name, the
 * bench needs a DATE. Two of the thirteen rulings we hold have neither, so the
 * card showed "Decided by The Supreme Court" and nothing under it — true, but
 * useless, and it reads as a bug.
 *
 * Both facts are on the CourtListener cluster the record already links to.
 *
 * NOBODY WAITS FOR THIS. The reader who triggers it sees the card as it is now;
 * the answer is on the row for the next reader. A record is asked about once per
 * process and the work queues behind a single worker, so fifty people opening
 * the same uncached card produce one request, not fifty.
 *
 * NOTHING IS WRITTEN THAT WAS NOT RETURNED. A failed lookup leaves the row
 * exactly as it was — an empty field is honest, an invented date is not.
 */

/** Asked about once per process. Resets on restart, so a bad day is not final. */
const attempted = new Set<string>();
const queue: Array<{ id: string; opinionId: string }> = [];
let draining = false;

/** The opinion id CourtListener filed this under, from the URL we stored. */
export function opinionIdFrom(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  const match = /courtlistener\.com\/opinion\/(\d+)\//.exec(sourceUrl);
  return match?.[1] ?? null;
}

interface Cluster {
  date_filed?: string | null;
  case_name?: string | null;
  sub_opinions?: string[];
}

interface ClusterPage {
  results?: Cluster[];
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift()!;
      try {
        const apiKey = env.COURTLISTENER_API_KEY;
        if (!apiKey) {
          console.warn("[ScotusFacts] COURTLISTENER_API_KEY not set — cannot fill");
          queue.length = 0;
          return;
        }

        const page = await fetchCourtListener<ClusterPage>(
          `https://www.courtlistener.com/api/rest/v4/clusters/?sub_opinions=${job.opinionId}`,
          { deadlineAt: Date.now() + 20_000, apiKey, label: "scotus-facts" },
        );
        const filed = page?.results?.[0]?.date_filed;
        if (!filed) continue;

        const decidedDate = new Date(`${filed}T00:00:00.000Z`);
        if (Number.isNaN(decidedDate.getTime())) continue;

        // Only ever fills a hole. A date already on the row is not overwritten.
        const written = await prisma.governmentReference.updateMany({
          where: { id: job.id, decidedDate: null },
          data: { decidedDate },
        });
        if (written.count > 0) {
          console.log(`[ScotusFacts] ${job.id}: decided ${filed}`);
        }
      } catch (error) {
        console.warn(`[ScotusFacts] ${job.id} failed:`, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } finally {
    draining = false;
  }
}

/**
 * A ruling is being opened — make sure it knows when it was decided, for the
 * next reader. Returns immediately and never throws.
 */
export function ensureScotusFacts(ref: {
  id: string;
  referenceType: string | null;
  decidedDate: Date | null;
  sourceUrl?: string | null;
}): void {
  if (ref.referenceType !== "scotus_case" || ref.decidedDate) return;

  const opinionId = opinionIdFrom(ref.sourceUrl);
  if (!opinionId || attempted.has(ref.id)) return;
  attempted.add(ref.id);

  queue.push({ id: ref.id, opinionId });
  void drain();
}

/** Test seam: forget what has been attempted, so a case can run twice. */
export function resetScotusFactAttempts(): void {
  attempted.clear();
  queue.length = 0;
}
