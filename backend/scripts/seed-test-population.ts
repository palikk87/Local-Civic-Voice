/**
 * Build the thousand test citizens, in a database of their own.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run scripts/seed-test-population.ts
 *
 *   …/civicvoice_population 250      # a smaller population
 *
 * The database must already exist and have the schema applied
 * (`prisma migrate deploy` against the same URL). This script only fills it.
 *
 * It will refuse to run against a database whose name does not say it is for
 * testing, and it never reads DATABASE_URL — reaching the live database has to
 * be a deliberate act, and this offers no way to do it by accident. See
 * lib/test-population.ts for why that matters more here than it usually would.
 */
import { PrismaClient } from "@prisma/client";
import {
  POPULATION_SIZE,
  POPULATION_PASSWORD,
  assertPopulationDatabase,
  buildPopulation,
  citizen,
  countPopulation,
} from "./lib/test-population";

const url = process.env.TEST_POPULATION_DATABASE_URL;
const size = Number(process.argv[2] ?? POPULATION_SIZE);

if (!Number.isInteger(size) || size < 1 || size > 100_000) {
  console.error(`Population size must be a whole number between 1 and 100000; got "${process.argv[2]}"`);
  process.exit(1);
}

let databaseName: string;
try {
  databaseName = assertPopulationDatabase(url);
} catch (error) {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

console.log(`Building ${size} test citizens in database "${databaseName}".`);
console.log("They exist only here. Nothing served to the public reads this database.\n");

const started = Date.now();
await buildPopulation(prisma, size, (done, total) => {
  if (done % 250 === 0 || done === total) {
    console.log(`  ${done}/${total}`);
  }
});

const total = await countPopulation(prisma);
const first = citizen(1);
const last = citizen(size);

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. ${total} citizens present.`);
console.log(`  ${first.email}  …  ${last.email}`);
console.log(`  password for all of them: ${POPULATION_PASSWORD}`);
console.log(`\nTo use them, point a backend at this database:`);
console.log(`  DATABASE_URL='${url}' bun run start`);

await prisma.$disconnect();
