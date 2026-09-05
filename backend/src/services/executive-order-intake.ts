/**
 * Writing a day's executive orders into the database, once.
 *
 * WHAT THIS IS FOR. The White House publishes an order the day it is signed;
 * the Federal Register publishes it three to seven days later. Everything on
 * this platform used to arrive by the second route, so for those days a reader
 * looking for an order they had just heard about found nothing at all. This is
 * the first route.
 *
 * WHERE THE CROSS-REFERENCE HAPPENS, which is the question this file exists to
 * answer. Before anything is written, every order the feed returned is checked
 * against what we already hold — because by the time a day is read we may have
 * the order already, from either direction:
 *
 *   - the Register's nightly sync got there first, if the day being read is an
 *     old one (a backfill, a catch-up after an outage);
 *   - a previous run of this same pass already took that day;
 *   - a reader's search pulled the order in the moment they looked for it.
 *
 * A duplicate is not a cosmetic problem here. Two records for one order means
 * two vote counts, and neither of them is the number this platform exists to
 * report.
 *
 * THE MATCH IS TITLE PLUS SIGNING DATE, and it has to be, because we have no
 * number to match on — that is the whole premise. Measured across 90 real
 * orders: 85 matched the Register on a normalised title exactly, one needed the
 * closeness fallback, and two orders signed on the same day about neighbouring
 * subjects score 0.00 against each other. See orderTitleKey in
 * white-house-orders.ts for what "normalised" repairs and why.
 */
import { prisma } from "../prisma";
import { categorize, upsertReference } from "./government-sync";
import {
  type WhiteHouseOrder,
  fetchOrdersSignedOn,
  orderTitleKey,
  provisionalOrderId,
  signedOn,
  titleCloseness,
} from "./white-house-orders";

/**
 * How close two titles must be to count as the same order when they are not
 * character-identical.
 *
 * Set from measurement, not taste. The one real rewording in 90 orders scored
 * 0.94 ("Closure of Executive Departments" became "Closing of"); the worst
 * same-day pair of genuinely different orders scored 0.00. There is nothing
 * between 0.00 and 0.94 in the measured set, so this sits well clear of both.
 */
export const SAME_ORDER_CLOSENESS = 0.85;

/**
 * How far back a signing date may have been, relative to the day we read.
 *
 * The White House is occasionally late — twice in 82 measured orders, by one
 * day and by four — and never early. So a record we already hold may be dated
 * up to a few days before the day this pass is reading, and looking only at an
 * exact date would create a second copy of it.
 */
const SIGNING_WINDOW_DAYS = 10;

export interface IntakeReport {
  /** Did the feed answer at all? False means try again; it does not mean a quiet day. */
  reached: boolean;
  /** Orders the feed returned for that day. */
  found: number;
  /** Records created. */
  created: number;
  /** Orders we already held, from either source. */
  alreadyHeld: number;
  /** The master reference ids created, in the order they were minted. */
  ids: string[];
}

function daysBefore(day: string, days: number): Date {
  const when = new Date(`${day}T00:00:00.000Z`);
  when.setUTCDate(when.getUTCDate() - days);
  return when;
}

/**
 * Executive orders we hold that could be this day's, by date alone.
 *
 * Read once per day processed rather than once per order: a heavy day is 26
 * orders, and 26 queries to answer one question is a query the database should
 * only be asked once.
 */
async function candidatesAround(day: string) {
  return prisma.governmentReference.findMany({
    where: {
      referenceType: "executive_order",
      // A record still waiting to be merged away is not a record this should
      // create a third copy alongside.
      mergedIntoId: null,
      signedDate: {
        gte: daysBefore(day, SIGNING_WINDOW_DAYS),
        lte: new Date(`${day}T23:59:59.999Z`),
      },
    },
    select: { id: true, masterReferenceId: true, title: true, sourceUrl: true },
  });
}

type Candidate = Awaited<ReturnType<typeof candidatesAround>>[number];

/**
 * Do we already have this order? Pure, so the rule can be tested on its own.
 *
 * The URL is checked first and separately. It is the strongest signal available
 * — the same post, at the same address — and it does not depend on any judgement
 * about titles.
 */
export function alreadyHeld(order: WhiteHouseOrder, candidates: Candidate[]): Candidate | null {
  const sameUrl = candidates.find((held) => held.sourceUrl && held.sourceUrl === order.url);
  if (sameUrl) return sameUrl;

  const key = orderTitleKey(order.title);
  const sameTitle = candidates.find((held) => orderTitleKey(held.title) === key);
  if (sameTitle) return sameTitle;

  let best: Candidate | null = null;
  let bestScore = 0;
  for (const held of candidates) {
    const score = titleCloseness(held.title, order.title);
    if (score > bestScore) {
      best = held;
      bestScore = score;
    }
  }
  return bestScore >= SAME_ORDER_CLOSENESS ? best : null;
}

/**
 * Read one day and write what is new.
 *
 * `day` is YYYY-MM-DD in Eastern, because that is the day the White House
 * itself means. Defaults to today.
 */
export async function intakeOrdersSignedOn(day?: string): Promise<IntakeReport> {
  const target = day ?? signedOn(new Date());
  const empty: IntakeReport = { reached: false, found: 0, created: 0, alreadyHeld: 0, ids: [] };

  const orders = await fetchOrdersSignedOn(target);
  if (orders === null) {
    console.warn(`[WhiteHouse] could not read the feed for ${target} — nothing written, will try again`);
    return empty;
  }

  const report: IntakeReport = { ...empty, reached: true, found: orders.length, ids: [] };
  if (orders.length === 0) return report;

  const candidates = await candidatesAround(target);
  // Names minted during this run are not in `candidates` — that snapshot was
  // taken before the first write — so a day with two orders would give both the
  // same id without this.
  const claimedHere = new Set<string>();
  const heldNames = new Set(candidates.map((held) => held.masterReferenceId));

  for (const order of orders) {
    const existing = alreadyHeld(order, candidates);
    if (existing) {
      report.alreadyHeld++;
      console.log(
        `[WhiteHouse] "${order.title}" is already ${existing.masterReferenceId} — left alone`,
      );
      continue;
    }

    const masterReferenceId = provisionalOrderId(
      target,
      (id) => claimedHere.has(id) || heldNames.has(id),
    );
    claimedHere.add(masterReferenceId);

    await upsertReference({
      masterReferenceId,
      referenceType: "executive_order",
      title: order.title,
      status: "active",
      category: categorize(order.title),
      sourceUrl: order.url,
      fullText: order.fullText,
      signedDate: new Date(`${order.signedOn}T00:00:00.000Z`),
      // Every President since Hoover has signed these; the feed does not name
      // one, and inventing a name for a face is worse than showing no face.
      numberStatus: "pending",
    });

    report.created++;
    report.ids.push(masterReferenceId);
    console.log(`[WhiteHouse] ${masterReferenceId} — "${order.title}" (signed ${order.signedOn})`);
  }

  return report;
}
