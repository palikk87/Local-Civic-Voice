/**
 * Recompute every reference's placeholder seed tally from the (fixed)
 * deterministic formula, then rebuild the public tally as real weighted
 * votes + seed. Overwrites any previous seed values, so it also repairs
 * rows written by the old formula. Safe to re-run.
 *
 * Remove seeds later with POST /api/admin/references/clear-seed-votes.
 */
import { prisma } from "../src/prisma";
import { seedTallyFor } from "../src/services/deduplication-service";
import { applyWeightedTally } from "../src/services/delegation-service";

const refs = await prisma.governmentReference.findMany({
  where: { mergedIntoId: null },
  select: { id: true, masterReferenceId: true },
});

for (const ref of refs) {
  const seed = seedTallyFor(ref.masterReferenceId);
  await prisma.governmentReference.update({
    where: { id: ref.id },
    data: { seedSupport: seed.seedSupport, seedOppose: seed.seedOppose },
  });
  await applyWeightedTally(ref.id);
}

console.log(`Re-seeded ${refs.length} references; all tallies recomputed.`);
await prisma.$disconnect();
