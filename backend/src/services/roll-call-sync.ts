/**
 * Pulling the chamber's published roll calls in, on a schedule.
 *
 * WHY THIS IS A SERVICE AND NOT A SCRIPT. It was a script, and only a script,
 * which meant the only way it ever ran was somebody typing the command. Nobody
 * did. So `officialVotes` was empty on every record, and because every gap
 * panel on both clients checks that field before rendering, the Representation
 * Gap — the thing this platform exists to show — was invisible everywhere and
 * looked like a missing feature rather than a missing cron.
 *
 * An ingest whose only copy lives in scripts/ can never be scheduled. This is
 * that logic, callable from the server's own interval and from the script,
 * which now just parses flags and calls in here.
 *
 * COURTESY TO THE SOURCES. senate.gov and clerk.house.gov publish these as
 * plain XML with no key and no quota, which is a kindness that a tight loop
 * would repay by getting this platform blocked. Every request is spaced.
 */

import { prisma } from "../prisma";
import {
  fetchHouseRollCall,
  fetchSenateMenu,
  fetchSenateRollCall,
  storeRollCall,
} from "./roll-call";

export interface RollCallSyncOptions {
  /** Milliseconds between requests. */
  pauseMs?: number;
  /** Ceiling on how many roll calls to pull per chamber, per run. */
  limit?: number;
  /** "senate", "house", or both when absent. */
  chamber?: "senate" | "house";
  year?: number;
  congress?: number;
  session?: number;
}

export interface RollCallSyncResult {
  senate: { stored: number; linked: number };
  house: { stored: number; linked: number };
}

/** The Congress sitting in a given year: the 119th convened in 2025. */
export function congressForYear(year: number): number {
  return Math.floor((year - 2025) / 2) + 119;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function syncSenate(
  congress: number,
  session: number,
  limit: number,
  pauseMs: number,
): Promise<{ stored: number; linked: number }> {
  const menu = await fetchSenateMenu(congress, session);
  if (menu.length === 0) {
    console.log(`[Senate] no index for congress ${congress} session ${session}`);
    return { stored: 0, linked: 0 };
  }

  // Only the votes that are ON A MEASURE. The Senate spends most of its roll
  // calls on nominations and procedural motions, which have no bill record to
  // attach a gap to — fetching them would be hundreds of requests for rows
  // nothing can ever use.
  const measures = menu.filter((entry) => entry.masterReferenceId !== null).slice(0, limit);
  console.log(
    `[Senate] ${menu.length} roll calls in the index, ${measures.length} on measures — fetching those`,
  );

  let stored = 0;
  let linked = 0;
  for (const entry of measures) {
    const parsed = await fetchSenateRollCall(congress, session, entry.rollNumber);
    if (!parsed) {
      console.warn(`[Senate] roll ${entry.rollNumber} could not be read`);
      await wait(pauseMs);
      continue;
    }

    const result = await storeRollCall(parsed, prisma);
    stored += 1;
    if (result.linked) linked += 1;
    await wait(pauseMs);
  }

  console.log(`[Senate] stored ${stored}, linked to a record ${linked}`);
  return { stored, linked };
}

async function syncHouse(
  year: number,
  limit: number,
  pauseMs: number,
): Promise<{ stored: number; linked: number }> {
  console.log(`[House] walking ${year} roll calls until the clerk stops serving them`);

  let stored = 0;
  let linked = 0;
  let misses = 0;

  for (let roll = 1; roll <= limit; roll += 1) {
    const parsed = await fetchHouseRollCall(year, roll);
    if (!parsed) {
      misses += 1;
      // The clerk numbers rolls contiguously, so a run of misses means the end
      // of the year rather than a gap in the middle.
      if (misses >= 5) break;
      await wait(pauseMs);
      continue;
    }

    misses = 0;
    const result = await storeRollCall(parsed, prisma);
    stored += 1;
    if (result.linked) linked += 1;
    await wait(pauseMs);
  }

  console.log(`[House] stored ${stored}, linked to a record ${linked}`);
  return { stored, linked };
}

export async function syncRollCalls(
  options: RollCallSyncOptions = {},
): Promise<RollCallSyncResult> {
  const now = new Date();
  const year = options.year ?? now.getUTCFullYear();
  const congress = options.congress ?? congressForYear(year);
  const session = options.session ?? (year % 2 === 1 ? 1 : 2);
  const limit = options.limit ?? 100;
  const pauseMs = options.pauseMs ?? 250;

  const empty = { stored: 0, linked: 0 };
  const senate =
    options.chamber === "house" ? empty : await syncSenate(congress, session, limit, pauseMs);
  const house = options.chamber === "senate" ? empty : await syncHouse(year, limit, pauseMs);

  const total = await prisma.rollCall.count();
  const attached = await prisma.rollCall.count({
    where: { governmentReferenceId: { not: null } },
  });
  console.log(
    `[RollCall] ${total} roll calls stored, ${attached} attached to a record on this platform.`,
  );

  return { senate, house };
}
