/**
 * The thousand test citizens: that they are real accounts, that they scale, and
 * that they stay out of the database that serves the public.
 *
 * These run against the throwaway test database, building the population on
 * demand rather than assuming somebody seeded it. That keeps the suite
 * self-contained, and it exercises the same builder the CLI uses, so a break in
 * one is a break in both.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  startServer,
  stopServer,
} from "./helpers/server";
import {
  POPULATION_EMAIL_DOMAIN,
  POPULATION_ID_PREFIX,
  assertPopulationDatabase,
  buildPopulation,
  citizen,
  countPopulation,
  population,
  removePopulation,
} from "../scripts/lib/test-population";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

/** Sign in as one of them, the ordinary way, over HTTP. */
async function signIn(index: number): Promise<string> {
  const c = citizen(index);
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email: c.email, password: c.password }),
  });
  if (!response.ok) {
    throw new Error(`sign-in failed for ${c.email}: ${response.status} ${await response.text()}`);
  }
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("sign-in returned no session cookie");
  return cookie.split(";")[0]!;
}

let refCounter = 0;
async function reference(category: string | null = "healthcare") {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${5000 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill the population has opinions about",
      status: "proposed",
      category,
    },
  });
}

describe("the test population", () => {
  test("they are ordinary accounts that can sign in and vote", async () => {
    await buildPopulation(prisma, 5);
    const bill = await reference();

    // Nothing special is done for them anywhere in the server. If this passes,
    // they are exercising exactly the paths a real person exercises.
    const cookie = await signIn(3);
    const response = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ position: "support" }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { votes: { support: number } }).votes.support).toBe(1);
  });

  test("rebuilding is idempotent — citizen 417 is always citizen 417", async () => {
    await buildPopulation(prisma, 20);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: citizen(17).id } });

    await buildPopulation(prisma, 20);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: citizen(17).id } });

    expect(await countPopulation(prisma)).toBe(20);
    expect(after.id).toBe(before.id);
    expect(after.email).toBe(before.email);
    expect(after.createdAt).toEqual(before.createdAt);
  });

  test("every one of the thousand is recognisable as synthetic", async () => {
    const everyone = population(1_000);
    expect(everyone).toHaveLength(1_000);
    expect(everyone.every((c) => c.id.startsWith(POPULATION_ID_PREFIX))).toBe(true);
    expect(everyone.every((c) => c.email.endsWith(`@${POPULATION_EMAIL_DOMAIN}`))).toBe(true);
    expect(new Set(everyone.map((c) => c.id)).size).toBe(1_000);
    expect(new Set(everyone.map((c) => c.email)).size).toBe(1_000);
  });

  test("a thousand voices on one record produce a thousand votes", async () => {
    const everyone = await buildPopulation(prisma, 1_000);
    const bill = await reference();

    // Written straight to the database on purpose: the question here is whether
    // the tally is right and quick at this size, not whether the vote endpoint
    // works — the test above covers that over real HTTP.
    await prisma.governmentReferenceVote.createMany({
      data: everyone.map((c, i) => ({
        governmentReferenceId: bill.id,
        userId: c.id,
        position: i % 3 === 0 ? "oppose" : "support",
      })),
    });

    const { applyWeightedTally } = await import("../src/services/delegation-service");
    const started = Date.now();
    const tally = await applyWeightedTally(bill.id);
    const elapsed = Date.now() - started;

    expect(tally.support + tally.oppose).toBe(1_000);
    expect(tally.oppose).toBe(334);
    expect(tally.support).toBe(666);

    // Not a benchmark, a tripwire. The tally reads the delegation graph, and a
    // change that makes it quadratic would blow through this long before it
    // reached anybody's browser.
    expect(elapsed).toBeLessThan(5_000);
  });

  test("nine hundred delegators behind one delegate all get counted", async () => {
    const everyone = await buildPopulation(prisma, 1_000);
    const bill = await reference();
    const leader = everyone[0]!;

    await prisma.delegation.createMany({
      data: everyone.slice(1, 901).map((c) => ({
        fromUserId: c.id,
        toUserId: leader.id,
        category: null,
      })),
    });

    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: bill.id, userId: leader.id, position: "support" },
    });

    const { applyWeightedTally } = await import("../src/services/delegation-service");
    const started = Date.now();
    const tally = await applyWeightedTally(bill.id);
    const elapsed = Date.now() - started;

    // The leader plus everybody who lent them a voice.
    expect(tally).toEqual({ support: 901, oppose: 0 });
    expect(elapsed).toBeLessThan(5_000);
  });

  test("a chain a hundred deep still terminates, and drops what is past the cap", async () => {
    const everyone = await buildPopulation(prisma, 120);
    const bill = await reference();

    // A single line: 119 lends to 118, 118 to 117, … 2 lends to 1. Only 1 votes.
    await prisma.delegation.createMany({
      data: everyone.slice(1).map((c, i) => ({
        fromUserId: c.id,
        toUserId: everyone[i]!.id,
        category: null,
      })),
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: bill.id, userId: everyone[0]!.id, position: "support" },
    });

    const { applyWeightedTally, MAX_DELEGATION_DEPTH } = await import(
      "../src/services/delegation-service"
    );
    const tally = await applyWeightedTally(bill.id);

    // The voter, plus everyone within the cap. The other hundred-odd are not
    // counted rather than guessed at.
    expect(tally).toEqual({ support: 1 + MAX_DELEGATION_DEPTH, oppose: 0 });
  });

  test("removing them leaves nothing behind", async () => {
    const everyone = await buildPopulation(prisma, 50);
    const bill = await reference();

    await prisma.governmentReferenceVote.createMany({
      data: everyone.map((c) => ({
        governmentReferenceId: bill.id,
        userId: c.id,
        position: "support",
      })),
    });
    await prisma.post.create({
      data: { authorId: everyone[0]!.id, content: "A synthetic opinion." },
    });

    await prisma.postLike.create({
      data: { postId: (await prisma.post.findFirstOrThrow()).id, userId: everyone[1]!.id },
    });

    const removed = await removePopulation(prisma);

    expect(removed).toBe(50);
    expect(await countPopulation(prisma)).toBe(0);
    expect(await prisma.post.count()).toBe(0);
    expect(
      await prisma.account.count({ where: { userId: { startsWith: POPULATION_ID_PREFIX } } }),
    ).toBe(0);

    // The rows the database will NOT cascade, because their userId is a plain
    // string with no relation to User. Deleting the accounts alone left fifty
    // votes sitting in a published tally, which is exactly what would happen to
    // a real person who deleted their account.
    expect(await prisma.governmentReferenceVote.count()).toBe(0);
    expect(await prisma.postLike.count()).toBe(0);
  });

  test("the server has no way to create them", async () => {
    // The population is kept out of the live database by keeping it in a
    // different one, and by nothing in the running server knowing how to make
    // one. That second half is a property of the source tree, so it is checked
    // against the source tree: if an import ever appears, this fails before the
    // code that could seed a thousand fake voters into production ships.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    }

    const offenders = walk("src")
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => /test-population/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  test("the builder refuses any database not named for testing", () => {
    // The reason the population can be trusted to stay out of the live database
    // is this function, so it is checked directly rather than believed.
    expect(() => assertPopulationDatabase(undefined)).toThrow(/not set/);
    expect(() => assertPopulationDatabase("postgresql://u:p@host:5432/railway")).toThrow(
      /Refusing/,
    );
    expect(() => assertPopulationDatabase("postgresql://u:p@host:5432/civicvoice")).toThrow(
      /Refusing/,
    );
    expect(() => assertPopulationDatabase("postgresql://u:p@host:5432/production")).toThrow(
      /Refusing/,
    );
    expect(assertPopulationDatabase("postgresql://u:p@host:5432/civicvoice_test")).toBe(
      "civicvoice_test",
    );
    expect(assertPopulationDatabase("postgresql://u:p@host:5432/civicvoice_population")).toBe(
      "civicvoice_population",
    );
  });
});
