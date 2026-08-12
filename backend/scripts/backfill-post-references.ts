/**
 * One-off backfill: link existing posts to their canonical GovernmentReference.
 *
 * Posts created before the reference link was wired up stored the selected
 * GovernmentReference.id in the legacy free-text `referenceId` column while
 * `governmentReferenceId` — the column pulse queries join on — stayed NULL.
 *
 * This copies the value across, but only where it is provably safe.
 *
 *   bun scripts/backfill-post-references.ts          # dry run, writes nothing
 *   bun scripts/backfill-post-references.ts --apply  # perform the update
 */

import { prisma } from "../src/prisma";
import { resolveReferenceId } from "../src/services/reference-resolver";

const apply = process.argv.includes("--apply");

type Plan = {
  postId: string;
  legacyReferenceId: string;
  legacyType: string | null;
  targetId: string;
  masterReferenceId: string;
  referenceType: string;
  merged: boolean;
};

type Skip = { postId: string; reason: string };

async function main() {
  const posts = await prisma.post.findMany({
    where: { governmentReferenceId: null },
    select: { id: true, referenceId: true, referenceType: true, referenceTitle: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`${apply ? "APPLY" : "DRY RUN"} — ${posts.length} post(s) with no canonical reference\n`);

  if (posts.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const plans: Plan[] = [];
  const skips: Skip[] = [];

  for (const post of posts) {
    if (!post.referenceId) {
      skips.push({ postId: post.id, reason: "no legacy referenceId to migrate" });
      continue;
    }

    const resolved = await resolveReferenceId(post.referenceId);

    if (!resolved.ok) {
      skips.push({
        postId: post.id,
        reason: `legacy referenceId "${post.referenceId}" ${
          resolved.reason === "not_found" ? "is not a GovernmentReference id" : "has a corrupt merge chain"
        }`,
      });
      continue;
    }

    // The legacy type must agree with the stored row, otherwise the legacy value
    // may be pointing at something other than what the author actually selected.
    if (post.referenceType && post.referenceType !== resolved.reference.referenceType) {
      skips.push({
        postId: post.id,
        reason: `legacy type "${post.referenceType}" does not match reference type "${resolved.reference.referenceType}"`,
      });
      continue;
    }

    plans.push({
      postId: post.id,
      legacyReferenceId: post.referenceId,
      legacyType: post.referenceType,
      targetId: resolved.reference.id,
      masterReferenceId: resolved.reference.masterReferenceId,
      referenceType: resolved.reference.referenceType,
      merged: resolved.reference.id !== post.referenceId,
    });
  }

  console.log("Proposed mapping:");
  for (const plan of plans) {
    console.log(
      `  ${plan.postId}  ->  ${plan.masterReferenceId} (${plan.referenceType})${
        plan.merged ? "  [followed merge to active row]" : ""
      }`
    );
  }

  if (skips.length > 0) {
    console.log("\nUnmatched:");
    for (const skip of skips) {
      console.log(`  ${skip.postId}  ${skip.reason}`);
    }
    console.log(
      `\nABORTED — ${skips.length} of ${posts.length} post(s) could not be resolved. ` +
        `Resolve these by hand before running the backfill.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nAll ${plans.length} post(s) resolved cleanly.`);

  if (!apply) {
    console.log("Dry run — no changes written. Re-run with --apply to perform the update.");
    return;
  }

  await prisma.$transaction(
    plans.map((plan) =>
      prisma.post.update({
        where: { id: plan.postId },
        // Guard against a concurrent write having already linked this post.
        data: { governmentReferenceId: plan.targetId },
      })
    )
  );

  const remaining = await prisma.post.count({
    where: { governmentReferenceId: null, referenceId: { not: null } },
  });

  console.log(`Updated ${plans.length} post(s).`);
  console.log(
    remaining === 0
      ? "Verified: no post with a legacy reference remains unlinked."
      : `WARNING: ${remaining} post(s) with a legacy reference are still unlinked.`
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
