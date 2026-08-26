/**
 * Catch the executive orders up, deliberately, with somebody watching.
 *
 *   bun run scripts/backfill-executive-orders.ts                    # 100, a taste
 *   bun run scripts/backfill-executive-orders.ts --max-new 300      # this administration
 *   bun run scripts/backfill-executive-orders.ts --max-new 2000     # everything
 *
 * WHY A SCRIPT AND NOT THE NIGHTLY JOB. The Federal Register publishes 1,556
 * executive orders. The nightly sync now pages until it recognises what it is
 * reading, but it takes at most 50 new ones per run — because doing the whole
 * corpus in one night means 1,556 full-text downloads against a public server,
 * and 1,556 new rows in a database this project shares with another. Catching
 * up over a fortnight of ordinary nights costs nobody anything. Catching up in
 * one go is a decision, so it is a command somebody types.
 *
 * SAFE TO RE-RUN. Everything is upserted by masterReferenceId, so a second pass
 * refreshes rather than duplicates, and orders that already have their text are
 * skipped without a download. Votes, posts and briefs on existing rows are
 * never touched — see upsertReference.
 *
 * Polite by default: 100 per page with a pause between pages, and it stops on
 * its own once it has seen enough consecutive orders it already holds.
 */

import { syncExecutiveOrders } from "../src/services/government-sync";
import { prisma } from "../src/prisma";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const maxNew = Number(flag("max-new") ?? 100);
  const pauseMs = Number(flag("pause") ?? 400);

  if (!Number.isFinite(maxNew) || maxNew < 1) {
    console.error("--max-new must be a positive number.");
    process.exitCode = 1;
    return;
  }

  const before = await prisma.governmentReference.count({
    where: { referenceType: "executive_order" },
  });
  const withText = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", fullText: { not: null } },
  });

  console.log(
    `Before: ${before} executive orders stored, ${withText} of them with official text.`,
  );
  console.log(`Taking up to ${maxNew} new ones, ${pauseMs}ms between pages.\n`);

  const synced = await syncExecutiveOrders({
    maxNew,
    // Walk far enough to be worth running. The nightly default stops early on
    // purpose; a backfill is being watched, so it can keep going.
    stopAfterKnown: 200,
    maxPages: 20,
    pauseMs,
  });

  const after = await prisma.governmentReference.count({
    where: { referenceType: "executive_order" },
  });
  const afterText = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", fullText: { not: null } },
  });

  console.log(`\nTouched ${synced} record${synced === 1 ? "" : "s"}.`);
  console.log(
    `After: ${after} executive orders stored (+${after - before}), ` +
      `${afterText} with official text (+${afterText - withText}).`,
  );
  if (afterText < after) {
    console.log(
      `\n${after - afterText} still have no text. That is honest rather than broken: ` +
        `either the source has not given it to us yet, or it answered with a block ` +
        `page and we refused to store it. Check the log above for REFUSED lines.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
