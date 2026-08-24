/**
 * Pull recorded votes from the House and Senate and store them.
 *
 *   bun run scripts/sync-roll-calls.ts              # current congress, this session
 *   bun run scripts/sync-roll-calls.ts --congress 119 --session 1 --limit 200
 *   bun run scripts/sync-roll-calls.ts --house-year 2025 --limit 400
 *
 * NO API KEY. Both chambers publish every roll call themselves as XML:
 * senate.gov for the Senate, clerk.house.gov for the House. This was written
 * up as blocked on a congress.gov key and never needed one.
 *
 * SAFE TO RE-RUN. Every roll call is upserted on
 * (chamber, congress, session, rollNumber), so a second pass corrects the
 * tallies the chambers have revised rather than duplicating anything.
 *
 * Polite by default: one request at a time with a short pause. These are
 * public servers run for the public, and hammering them is both rude and the
 * fastest way to get this platform blocked.
 */

import { prisma } from "../src/prisma";
import {
  fetchHouseRollCall,
  fetchSenateMenu,
  fetchSenateRollCall,
  storeRollCall,
} from "../src/services/roll-call";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

const PAUSE_MS = Number(flag("pause") ?? 250);
const LIMIT = Number(flag("limit") ?? 100);

/** The Congress sitting in a given year: the 119th convened in 2025. */
function congressForYear(year: number): number {
  return Math.floor((year - 2025) / 2) + 119;
}

async function pause() {
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
}

async function syncSenate(congress: number, session: number, limit: number) {
  const menu = await fetchSenateMenu(congress, session);
  if (menu.length === 0) {
    console.log(`[Senate] no index for congress ${congress} session ${session}`);
    return;
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
      await pause();
      continue;
    }

    const result = await storeRollCall(parsed, prisma);
    stored += 1;
    if (result.linked) linked += 1;
    await pause();
  }

  console.log(`[Senate] stored ${stored}, linked to a record ${linked}`);
}

async function syncHouse(year: number, limit: number) {
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
      await pause();
      continue;
    }

    misses = 0;
    const result = await storeRollCall(parsed, prisma);
    stored += 1;
    if (result.linked) linked += 1;
    await pause();
  }

  console.log(`[House] stored ${stored}, linked to a record ${linked}`);
}

async function main() {
  const now = new Date();
  const year = Number(flag("house-year") ?? now.getUTCFullYear());
  const congress = Number(flag("congress") ?? congressForYear(year));
  const session = Number(flag("session") ?? (year % 2 === 1 ? 1 : 2));

  const only = flag("chamber");

  if (only !== "house") await syncSenate(congress, session, LIMIT);
  if (only !== "senate") await syncHouse(year, LIMIT);

  const total = await prisma.rollCall.count();
  const attached = await prisma.rollCall.count({ where: { governmentReferenceId: { not: null } } });
  console.log(`\n${total} roll calls stored, ${attached} attached to a record on this platform.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
