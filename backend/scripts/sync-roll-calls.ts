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

import { syncRollCalls } from "../src/services/roll-call-sync";
import { prisma } from "../src/prisma";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/**
 * Flags in, service out.
 *
 * The sync logic used to live here and nowhere else, which is why it never ran:
 * an ingest that only a person can start is an ingest nobody starts. It moved to
 * src/services/roll-call-sync.ts so the server can schedule it too, and this
 * stays as the way to run one by hand — a backfill, a single chamber, a
 * different year.
 */
async function main() {
  const only = flag("chamber");
  const year = flag("house-year");
  const congress = flag("congress");
  const session = flag("session");
  const limit = flag("limit");
  const pause = flag("pause");

  await syncRollCalls({
    chamber: only === "house" || only === "senate" ? only : undefined,
    year: year ? Number(year) : undefined,
    congress: congress ? Number(congress) : undefined,
    session: session ? Number(session) : undefined,
    limit: limit ? Number(limit) : undefined,
    pauseMs: pause ? Number(pause) : undefined,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
