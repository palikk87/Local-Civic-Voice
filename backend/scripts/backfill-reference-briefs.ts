/**
 * One-off warm-up pass: pull the complete official text and write the Citizen's
 * Brief for every master reference that doesn't have one yet.
 *
 * Same pipeline the app uses at read time (services/reference-content.ts) — this
 * just runs it ahead of the reader so nobody is the unlucky first person to wait.
 * Safe to re-run: rows that already have a brief are skipped, and a row whose
 * official text isn't published anywhere lands on contentStatus "unavailable"
 * and stays there.
 *
 *   bun scripts/backfill-reference-briefs.ts [--limit N] [--concurrency N] [--force]
 */
import { prisma } from "../src/prisma";
import { processReferenceBrief } from "../src/services/reference-content";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const limit = Number.parseInt(flag("limit") ?? "0", 10) || undefined;
const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "2", 10) || 2);
const force = process.argv.includes("--force");

async function main() {
  const targets = await prisma.governmentReference.findMany({
    where: force ? {} : { citizenBriefJson: null },
    select: { id: true, masterReferenceId: true, referenceType: true },
    orderBy: { createdAt: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  console.log(`[Backfill] ${targets.length} reference(s) to process (concurrency ${concurrency})`);

  let done = 0;
  const tally = { ready: 0, unavailable: 0, other: 0, failed: 0 };
  const queue = [...targets];

  async function worker() {
    for (;;) {
      const target = queue.shift();
      if (!target) return;

      try {
        await processReferenceBrief(target.id, force);
        const after = await prisma.governmentReference.findUnique({
          where: { id: target.id },
          select: { contentStatus: true, citizenBriefJson: true, fullTextSource: true },
        });
        const status = after?.citizenBriefJson
          ? "ready"
          : after?.contentStatus === "unavailable"
            ? "unavailable"
            : "other";
        tally[status] += 1;
        console.log(
          `[Backfill] ${++done}/${targets.length} ${target.masterReferenceId} → ${status}` +
            (after?.fullTextSource ? ` (text: ${after.fullTextSource})` : "")
        );
      } catch (error) {
        tally.failed += 1;
        done += 1;
        console.error(
          `[Backfill] ${done}/${targets.length} ${target.masterReferenceId} → FAILED:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  console.log(
    `[Backfill] Finished — briefs written: ${tally.ready}, no official text: ${tally.unavailable}, ` +
      `still pending: ${tally.other}, errors: ${tally.failed}`
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("[Backfill] Fatal:", error);
  await prisma.$disconnect();
  process.exit(1);
});
