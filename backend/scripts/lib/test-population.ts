/**
 * A thousand citizens who do not exist on the platform.
 *
 * WHAT THIS IS FOR. Some things cannot be tested with three accounts: whether a
 * delegation chain still resolves at scale, whether a feed paginates, whether a
 * tally is right when a thousand voices land on one record. This builds a
 * standing population that can do all of that, and can be rebuilt identically
 * whenever it is needed.
 *
 * WHERE THEY LIVE, AND WHY IT MATTERS. In their own database, never the one the
 * public site is served from. That is not a convention, it is the whole design:
 * the platform publishes the Public Pulse as the aggregated will of real
 * people, and this project has already had to strip out one layer of invented
 * votes. A thousand synthetic citizens sitting in the live database would put
 * that layer straight back, and it would be invisible, because they would look
 * exactly like everybody else.
 *
 * So there is no flag, no filter, and no "exclude synthetic users" clause
 * anywhere in the server — those all fail the moment one query forgets. There
 * is instead a separate database, and code that refuses to run against
 * anything that has not been named as one. A query cannot forget a row that is
 * not there.
 *
 * They are recognisable anyway, deliberately: every id starts with `pop-` and
 * every address ends in `.invalid`, a domain reserved by RFC 2606 that can
 * never exist and can never receive mail. `check-no-population.ts` uses that to
 * assert a real database is clean of them.
 *
 * IDENTICAL EVERY TIME. Citizen 417 has the same id, address and password on
 * every rebuild, so a test can name a specific one and mean it, and a failure
 * can be reproduced rather than described.
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

export const POPULATION_SIZE = 1_000;

/** Every synthetic row carries this. Nothing else in the schema may. */
export const POPULATION_ID_PREFIX = "pop-";

/**
 * RFC 2606 reserves `.invalid` precisely so that it can never be registered.
 * These addresses cannot receive mail, cannot be recovered, and cannot be
 * mistaken for a person's.
 */
export const POPULATION_EMAIL_DOMAIN = "population.invalid";

/**
 * One password for the whole population.
 *
 * It is not a secret: it unlocks a thousand accounts that hold nothing, in a
 * database that serves nobody. Writing it here means a test can sign in as any
 * citizen without a shared fixture file to keep in step, and means nobody is
 * tempted to reuse a real credential for this.
 */
export const POPULATION_PASSWORD = "test-population-password-not-a-real-one";

export interface PopulationCitizen {
  id: string;
  index: number;
  name: string;
  email: string;
  username: string;
  password: string;
}

/** Citizen n, by number. 1-based, because "citizen 0" reads like a bug. */
export function citizen(index: number): PopulationCitizen {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error(`Citizen numbers start at 1; got ${index}`);
  }
  const padded = String(index).padStart(4, "0");
  return {
    id: `${POPULATION_ID_PREFIX}${padded}`,
    index,
    name: `Citizen ${padded}`,
    email: `citizen-${padded}@${POPULATION_EMAIL_DOMAIN}`,
    username: `citizen${padded}`,
    password: POPULATION_PASSWORD,
  };
}

/** The whole population, or the first `size` of it. */
export function population(size: number = POPULATION_SIZE): PopulationCitizen[] {
  return Array.from({ length: size }, (_, i) => citizen(i + 1));
}

/**
 * Refuse to touch anything that has not been named as a population database.
 *
 * Two independent conditions, because one is a typo away from being wrong:
 * the caller must pass a connection string explicitly — this never falls back
 * to DATABASE_URL, so pointing at production takes a deliberate act — and the
 * database's own name must say what it is.
 *
 * Returns the database name so the caller can print it. Nothing here writes to
 * a database without first saying which one out loud.
 */
export function assertPopulationDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "TEST_POPULATION_DATABASE_URL is not set.\n" +
        "This never falls back to DATABASE_URL: the population must not be built\n" +
        "in the database that serves the public. Point it at a database of its own.",
    );
  }

  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, "");
  } catch {
    throw new Error("TEST_POPULATION_DATABASE_URL is not a valid connection string.");
  }

  if (!name) {
    throw new Error("TEST_POPULATION_DATABASE_URL names no database.");
  }

  if (!/test|population/i.test(name)) {
    throw new Error(
      `Refusing to build the test population in a database called "${name}".\n` +
        `Its name must contain "test" or "population", so that a database holding\n` +
        `real people cannot be selected by accident.`,
    );
  }

  return name;
}

/**
 * Build (or repair) the population. Safe to run again — it upserts, so a
 * half-finished run or a schema that has moved on is fixed by repeating it.
 *
 * Written in batches rather than one transaction: a thousand upserts in a
 * single transaction holds locks long enough to matter even on a throwaway
 * database, and there is nothing to be atomic about — a partial population is
 * repaired by running it again, which is the same thing that fixes a whole one.
 */
export async function buildPopulation(
  prisma: PrismaClient,
  size: number = POPULATION_SIZE,
  onProgress?: (done: number, total: number) => void,
): Promise<PopulationCitizen[]> {
  const citizens = population(size);
  const passwordHash = await hashPassword(POPULATION_PASSWORD);
  const BATCH = 50;

  for (let start = 0; start < citizens.length; start += BATCH) {
    const batch = citizens.slice(start, start + BATCH);

    await Promise.all(
      batch.map(async (c) => {
        await prisma.user.upsert({
          where: { id: c.id },
          create: {
            id: c.id,
            name: c.name,
            email: c.email,
            username: c.username,
            displayUsername: c.username,
            emailVerified: true,
          },
          update: { name: c.name, email: c.email, username: c.username },
        });

        // The credential row is what makes them signable-in, which is what makes
        // them useful: a test can act as citizen 417 over real HTTP rather than
        // reaching around the server and writing rows itself.
        const accountId = `${c.id}-credential`;
        await prisma.account.upsert({
          where: { id: accountId },
          create: {
            id: accountId,
            accountId: c.email,
            providerId: "credential",
            userId: c.id,
            password: passwordHash,
          },
          update: { password: passwordHash },
        });
      }),
    );

    onProgress?.(Math.min(start + BATCH, citizens.length), citizens.length);
  }

  return citizens;
}

/**
 * Remove every trace of the population from a database.
 *
 * DELETING THE USERS IS NOT ENOUGH, and finding that out is the most useful
 * thing this population has done so far. Seven tables carry a `userId` that is
 * a plain string with no relation to User, so the database will not cascade
 * them — and the worst of the seven is GovernmentReferenceVote, which means a
 * deleted account's votes stay in the published tally for good.
 *
 * That is a real problem for real accounts and is written up for a decision;
 * it is not this function's to fix. What this function must do is leave
 * nothing behind, which it does by naming the orphans itself. Written to be
 * correct whether or not the schema later grows the foreign keys it wants —
 * deleting rows that are already gone is free.
 */
export async function removePopulation(prisma: PrismaClient): Promise<number> {
  const ids = (
    await prisma.user.findMany({
      where: { id: { startsWith: POPULATION_ID_PREFIX } },
      select: { id: true },
    })
  ).map((u) => u.id);

  if (ids.length === 0) return 0;

  const userId = { in: ids };
  await prisma.governmentReferenceVote.deleteMany({ where: { userId } });
  await prisma.postLike.deleteMany({ where: { userId } });
  await prisma.postSave.deleteMany({ where: { userId } });
  await prisma.postShare.deleteMany({ where: { userId } });
  await prisma.userInteraction.deleteMany({ where: { userId } });
  await prisma.userFeedProfile.deleteMany({ where: { userId } });
  await prisma.creatorMetrics.deleteMany({ where: { userId } });
  await prisma.media.deleteMany({ where: { userId } });

  // Everything else — posts, comments, delegations, sessions, accounts — is
  // related properly and goes with the user.
  const { count } = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return count;
}

/**
 * How many population rows a database holds. Zero is the only acceptable answer
 * for a database that serves real people.
 */
export async function countPopulation(prisma: PrismaClient): Promise<number> {
  return prisma.user.count({ where: { id: { startsWith: POPULATION_ID_PREFIX } } });
}
