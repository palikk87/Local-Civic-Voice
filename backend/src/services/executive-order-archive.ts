/**
 * Fetch every executive order there is, a batch at a time, and then stop.
 *
 * WHY THIS IS NOT A BUTTON, AND NOT A SCRIPT. The Federal Register publishes
 * about 1,556 executive orders going back to 1994; this platform held 62 of
 * them. Closing that gap by hand means somebody watching a terminal, and the
 * admin console's backfill button caps at 300 because it runs inside a request
 * that a proxy will cut off long before the corpus is done. Either way the
 * archive only fills while a person is paying attention, and stalls the moment
 * they stop.
 *
 * So it fills itself: a bounded batch on a schedule, resuming exactly where the
 * last one stopped, until there is nothing older left — and then it costs one
 * cheap request per sweep forever after, which is what keeps it honest if the
 * Federal Register ever adds something retroactively.
 *
 * WHERE IT RESUMES FROM IS DERIVED, NOT REMEMBERED. The anchor is the signing
 * date of the oldest order already held, read from the database at the start of
 * every run. There is no cursor, no bookmark, no "last completed page" column
 * to go stale — interrupt this halfway, redeploy, run it twice at once, and it
 * still resumes from what is actually stored. A bookmark would have been fewer
 * lines and one more thing that can lie.
 *
 * WHAT IT COSTS. One metadata page plus one full-text download per order, at
 * four requests a second, against a public server run for the public. A batch
 * of 100 is about a minute of that. The forward sync is untouched and still
 * handles orders signed from today onwards.
 */

import { prisma } from "../prisma";
import { FINISHED } from "./scheduled-work";
import { syncExecutiveOrdersDetailed } from "./government-sync";

/**
 * How many new orders one sweep takes.
 *
 * Larger than the nightly forward sync's 50 because this has a finish line and
 * the sooner it is reached the sooner the cost goes to nothing. Small enough
 * that a sweep is a minute of polite requests rather than an hour of them.
 */
const ARCHIVE_BATCH = 100;

/**
 * Pages one sweep may walk. With `signedBefore` anchored at the oldest order
 * held, everything returned should be new, so this is a guard against a
 * surprising answer rather than a normal limit.
 */
const ARCHIVE_MAX_PAGES = 4;

export interface ArchiveSweepResult {
  /** Orders written this sweep. */
  synced: number;
  /** True once the beginning of the archive has been reached. */
  complete: boolean;
  /** How many executive orders are stored now. */
  held: number;
  /** The date this sweep worked backwards from, or null on an empty database. */
  anchor: string | null;
}

/**
 * Take the next batch of older executive orders.
 *
 * Never throws: this runs on a schedule, and a bad night at the Federal
 * Register is a gap that waits for the next sweep, not a reason to take an API
 * down.
 */
/**
 * The date the next sweep works backwards from: the oldest order held.
 *
 * Exported so it can be tested without going near the Federal Register. This is
 * the only piece of state in the whole design, and it is not state at all — it
 * is a question asked of the database on every run. Everything that could go
 * wrong with resuming goes wrong here, so it is the part worth pinning.
 */
export async function archiveAnchor(): Promise<Date | null> {
  const oldest = await prisma.governmentReference.findFirst({
    where: {
      referenceType: "executive_order",
      mergedIntoId: null,
      signedDate: { not: null },
    },
    select: { signedDate: true },
    orderBy: { signedDate: "asc" },
  });
  return oldest?.signedDate ?? null;
}

export async function sweepExecutiveOrderArchive(
  options: { maxNew?: number } = {},
): Promise<ArchiveSweepResult> {
  const maxNew = options.maxNew ?? ARCHIVE_BATCH;

  const held = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", mergedIntoId: null },
  });

  const anchor = await archiveAnchor();

  // An empty database has no anchor to work back from. The forward sync fills
  // the newest end first; this picks up from there on a later sweep.
  if (!anchor) {
    return { synced: 0, complete: false, held, anchor: null };
  }

  const result = await syncExecutiveOrdersDetailed({
    signedBefore: anchor,
    maxNew,
    maxPages: ARCHIVE_MAX_PAGES,
    // Everything in this window should be new. A high ceiling stops the
    // boundary order — the one we anchored on, which we already hold — from
    // ending the walk before it starts.
    stopAfterKnown: 500,
    pauseMs: 250,
  });

  return {
    synced: result.synced,
    complete: result.exhausted,
    held: held + result.synced,
    anchor: anchor.toISOString().slice(0, 10),
  };
}

/**
 * Run a sweep and say what happened — but only when something happened.
 *
 * Once the archive is complete this is silent, which is the point: a scheduled
 * job that reports "nothing to do" every half hour teaches everyone to skim
 * past it, and the interesting line goes with it.
 */
export async function runExecutiveOrderArchiveSweep(): Promise<unknown> {
  try {
    const result = await sweepExecutiveOrderArchive();

    if (result.synced > 0) {
      console.log(
        `[EOArchive] Took ${result.synced} more executive order(s) from before ${result.anchor}. ` +
          `${result.held} held now.`,
      );
    }
    if (result.complete) {
      console.log(
        `[EOArchive] The archive is complete: ${result.held} executive orders, back to the ` +
          `beginning of what the Federal Register publishes. Future orders arrive with the ` +
          `daily sync.`,
      );
      /*
       * AND THIS IS WHERE IT STOPS, PERMANENTLY.
       *
       * This job has an end, unlike every other scheduled job here. The Federal
       * Register publishes a fixed corpus of past orders, and once the oldest
       * one is held there is nothing further back to fetch — not today, not
       * ever. Without this it would go on asking a government API the same
       * question every thirty minutes to be told the same thing.
       *
       * The two jobs that keep executive orders current are unaffected and
       * still run: WhiteHouseOrders reads the day's signings, and the nightly
       * Federal Register sync catches the handful the White House feed never
       * carries — three in the last sixteen months, including EO 14423.
       *
       * A restart starts it again, which is correct: it will do one sweep, find
       * the archive still complete, say so, and stop again.
       */
      return FINISHED;
    }
  } catch (error) {
    console.error("[EOArchive] sweep failed:", error);
  }

  return undefined;
}
