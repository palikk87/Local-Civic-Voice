/**
 * Prove a database holds none of the test citizens.
 *
 *   DATABASE_URL=… bun run scripts/check-no-population.ts
 *
 * Run this against production. The population is kept in its own database and
 * the seeding script refuses to write anywhere else, but "refuses to" is a
 * claim about code, and the claim worth having is about the data. This checks
 * the data.
 *
 * Exits non-zero if it finds any, and names them, because a synthetic citizen
 * in the live database is a fabricated vote waiting to be counted — the exact
 * thing the platform's own Bill of Rights forbids and the exact thing this
 * project has already had to remove once.
 *
 * Read-only. It deletes nothing: if this ever fires, a person should decide
 * what happened before anything is cleaned up.
 */
import { PrismaClient } from "@prisma/client";
import {
  POPULATION_EMAIL_DOMAIN,
  POPULATION_ID_PREFIX,
  countPopulation,
} from "./lib/test-population";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Name the database you want checked.");
  process.exit(1);
}

const databaseName = new URL(url).pathname.replace(/^\//, "") || "(unnamed)";
const prisma = new PrismaClient({ datasources: { db: { url } } });

const byId = await countPopulation(prisma);
const byEmail = await prisma.user.count({
  where: { email: { endsWith: `@${POPULATION_EMAIL_DOMAIN}` } },
});

if (byId === 0 && byEmail === 0) {
  console.log(`"${databaseName}" holds no test citizens. Every account in it is a real one.`);
  await prisma.$disconnect();
  process.exit(0);
}

console.error(`\n"${databaseName}" contains test citizens, and should not.`);
console.error(`  ${byId} with an id starting "${POPULATION_ID_PREFIX}"`);
console.error(`  ${byEmail} with an address at ${POPULATION_EMAIL_DOMAIN}`);

const sample = await prisma.user.findMany({
  where: {
    OR: [
      { id: { startsWith: POPULATION_ID_PREFIX } },
      { email: { endsWith: `@${POPULATION_EMAIL_DOMAIN}` } },
    ],
  },
  select: { id: true, email: true, createdAt: true },
  orderBy: { createdAt: "asc" },
  take: 5,
});
console.error("\nOldest few:");
for (const row of sample) {
  console.error(`  ${row.id}  ${row.email}  created ${row.createdAt.toISOString()}`);
}
console.error("\nNothing has been deleted. Work out how they arrived before removing them:");
console.error("their votes may already be inside a published tally.\n");

await prisma.$disconnect();
process.exit(1);
