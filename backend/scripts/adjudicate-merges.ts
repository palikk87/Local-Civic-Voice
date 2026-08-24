/**
 * Work the duplicate queue automatically.
 *
 *   bun run adjudicate-merges                 # decide up to 25 pending pairs
 *   bun run adjudicate-merges --limit 100
 *   bun run adjudicate-merges --no-ai         # evidence only, no model
 *   bun run adjudicate-merges --dry-run       # say what it would do
 *
 * A pending candidate is two records for one law, each publishing its own vote
 * count and neither of them the number. This drains that queue on evidence:
 * identical official text merges outright, a model adjudicates the pairs the
 * government has already linked, and everything else is left alone.
 *
 * Every merge it makes is journalled and reversible —
 * GET /api/admin/reference-merges/journal shows what was decided and why, and
 * any of it can be undone.
 */

import { prisma } from "../src/prisma";
import { adjudicatePending } from "../src/services/reference-lineage";
import { adjudicate, recordFor } from "../src/services/merge-adjudicator";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? "") : null;
}

const limit = Number(flag("limit") ?? 25);
const allowAI = !process.argv.includes("--no-ai");
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (dryRun) {
    // Nothing is merged. Every pair is adjudicated and printed, which is how
    // you check the judgement before trusting it with live records.
    const pending = await prisma.referenceMergeCandidate.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    console.log(`${pending.length} pending pair(s). Nothing will be merged.\n`);

    for (const candidate of pending) {
      const [left, right] = await Promise.all([
        recordFor(candidate.leftId),
        recordFor(candidate.rightId),
      ]);
      if (!left || !right) continue;

      const verdict = await adjudicate(left, right, { allowAI });
      console.log(
        `${left.masterReferenceId} vs ${right.masterReferenceId}\n` +
          `  ${verdict.verdict.toUpperCase()} (${verdict.basis}, confidence ${verdict.confidence})\n` +
          `  ${verdict.reason}\n`,
      );
    }
    return;
  }

  const sweep = await adjudicatePending(limit, { allowAI });

  console.log(
    `\nConsidered ${sweep.considered}: ${sweep.merged} merged, ` +
      `${sweep.rejected} ruled different, ${sweep.leftPending} left for a person.`,
  );
  if (sweep.merged > 0) {
    console.log(
      "Every merge is reversible — see GET /api/admin/reference-merges/journal.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
