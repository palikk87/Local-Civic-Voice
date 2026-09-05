/**
 * Give every executive order the address a person would actually type.
 *
 *   bun run scripts/reslug-executive-orders.ts            # show what would change
 *   bun run scripts/reslug-executive-orders.ts --apply    # do it
 *
 * WHY. Executive orders were addressed by their number — /reference/eo-14420.
 * Nobody has ever gone looking for "EO 14420"; they go looking for the order
 * about birth tourism, or vaccines, or ranchers. And an order now arrives here
 * the day it is signed, three to seven days before the Federal Register assigns
 * a number at all, so a number-based address either would not exist yet or
 * would be built on a guess. Built from the title it is right on day one and
 * never has to move again — which is exactly what makes correcting the number
 * later a non-event.
 *
 * WHAT ABOUT LINKS ALREADY SHARED. Khalid's call, and the reason this is a
 * script rather than a migration: the platform is in beta and barely used, so
 * the old addresses do not need to survive. If that changes, the fix is not
 * here — it is pointing the record route at services/reference-resolver.ts,
 * which already consults the name registry, where every id a record has ever
 * had is kept forever.
 *
 * SAFE TO RE-RUN. A record already at its preferred address is skipped, and a
 * title that produces an address somebody else holds is left alone rather than
 * fought over.
 */

import { prisma } from "../src/prisma";
import { preferredSlug } from "../src/services/reference-slug";

const apply = process.argv.includes("--apply");

async function main() {
  const orders = await prisma.governmentReference.findMany({
    where: { referenceType: "executive_order" },
    select: { id: true, masterReferenceId: true, title: true, slug: true, referenceType: true },
    orderBy: { masterReferenceId: "asc" },
  });

  console.log(`${orders.length} executive order(s) held.\n`);

  let changed = 0;
  let already = 0;
  let blocked = 0;
  let unnameable = 0;

  for (const order of orders) {
    const wanted = preferredSlug(order);
    if (!wanted) {
      unnameable++;
      console.warn(`  ?  ${order.masterReferenceId} — no address can be built from "${order.title}"`);
      continue;
    }
    if (order.slug === wanted) {
      already++;
      continue;
    }

    const holder = await prisma.governmentReference.findUnique({
      where: { slug: wanted },
      select: { id: true, masterReferenceId: true },
    });
    if (holder && holder.id !== order.id) {
      blocked++;
      console.warn(
        `  !  ${order.masterReferenceId} wants /${wanted}, which ${holder.masterReferenceId} holds — left alone`,
      );
      continue;
    }

    changed++;
    console.log(`  ${apply ? "->" : "  "} ${order.slug ?? "(none)"}  =>  ${wanted}`);
    if (apply) {
      await prisma.governmentReference.update({ where: { id: order.id }, data: { slug: wanted } });
    }
  }

  console.log(
    `\n${changed} to change, ${already} already right, ${blocked} blocked by a collision, ` +
      `${unnameable} with no usable title.`,
  );
  if (!apply && changed > 0) console.log("Nothing was written. Re-run with --apply.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
