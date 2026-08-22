/**
 * The first five minutes: start from where you stand, not from who is popular.
 *
 * Every social platform opens by asking a new arrival to pick five accounts to
 * follow, ranked by size. That one screen does most of the damage everybody
 * complains about later: it sorts a person into a camp before they have said
 * anything, and the feed it produces is a prediction about who they are rather
 * than a record of what they think.
 *
 * This opens the other way round — positions first, people second, chosen by
 * whether they actually agreed and shown in both directions.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

let seq = 0;
async function citizen(label: string) {
  seq += 1;
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

let refCounter = 0;
async function law(title: string) {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${2000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

/**
 * Votes written straight into the table.
 *
 * These stand in for the rest of the platform having been here first, which is
 * the only state in which onboarding means anything. Going through the HTTP
 * endpoint would need a signed-in session per voter and would be testing the
 * vote route rather than this one.
 */
async function roomVotes(
  referenceId: string,
  counts: { support: number; oppose: number },
) {
  for (let i = 0; i < counts.support + counts.oppose; i += 1) {
    const voter = await citizen("room");
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: referenceId,
        userId: voter.userId,
        position: i < counts.support ? "support" : "oppose",
      },
    });
  }
}

interface StarterRecord {
  id: string;
  title: string;
  support: number;
  oppose: number;
  contested: number;
}

async function starters(cookie?: string) {
  const response = await fetch(`${BASE_URL}/api/onboarding/records`, {
    headers: freshClientHeaders(cookie ? { cookie } : {}),
  });
  const body = (await response.json()) as { results: StarterRecord[] };
  return { status: response.status, results: body.results ?? [] };
}

interface Neighbour {
  id: string;
  name: string;
  shared: number;
  agreed: number;
  agreementPct: number | null;
}

async function neighbours(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/onboarding/neighbours`, {
    headers: freshClientHeaders({ cookie }),
  });
  const body = (await response.json()) as {
    positions: number;
    needed: number;
    agree: Neighbour[];
    disagree: Neighbour[];
  };
  return { status: response.status, ...body };
}

function vote(cookie: string, referenceId: string, position: string) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ position }),
  });
}

describe("what a newcomer is asked first", () => {
  test("the split record outranks the lopsided one", async () => {
    const split = await law("A bill the room cannot agree on");
    const settled = await law("A bill almost everybody backs");

    await roomVotes(split.id, { support: 5, oppose: 5 });
    await roomVotes(settled.id, { support: 20, oppose: 1 });

    const { results } = await starters();
    expect(results[0]?.id).toBe(split.id);
    expect(results[0]?.contested).toBeGreaterThan(results[1]?.contested ?? 1);
  });

  test("a record nobody has voted on is not put in front of a newcomer", async () => {
    const untouched = await law("A bill nobody has looked at");
    const busy = await law("A bill people argue about");
    await roomVotes(busy.id, { support: 4, oppose: 4 });

    const { results } = await starters();
    expect(results.map((r) => r.id)).not.toContain(untouched.id);
  });

  test("a record they have already voted on is not asked about again", async () => {
    const newcomer = await citizen("newcomer");
    const first = await law("A bill about insulin");
    const second = await law("A bill about railways");
    await roomVotes(first.id, { support: 4, oppose: 4 });
    await roomVotes(second.id, { support: 4, oppose: 4 });

    // Visible before they take a position on it.
    expect((await starters(newcomer.cookie)).results.map((r) => r.id)).toContain(first.id);

    await vote(newcomer.cookie, first.id, "support");

    const after = await starters(newcomer.cookie);
    expect(after.results.map((r) => r.id)).not.toContain(first.id);
    expect(after.results.map((r) => r.id)).toContain(second.id);
  });

  test("an empty platform says so rather than inventing something to ask", async () => {
    const { status, results } = await starters();
    expect(status).toBe(200);
    expect(results).toEqual([]);
  });

  test("a signed-out visitor can see the question", async () => {
    const bill = await law("A bill people argue about");
    await roomVotes(bill.id, { support: 4, oppose: 4 });

    const { status, results } = await starters();
    expect(status).toBe(200);
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("and then the people", () => {
  test("nobody is offered until there are enough positions to mean anything", async () => {
    const newcomer = await citizen("newcomer");
    const bill = await law("A bill about insulin");
    await roomVotes(bill.id, { support: 4, oppose: 4 });

    await vote(newcomer.cookie, bill.id, "support");

    const result = await neighbours(newcomer.cookie);
    // Two shared votes is a coincidence, and introducing somebody as a match
    // off a coincidence is confident nonsense.
    expect(result.positions).toBe(1);
    expect(result.needed).toBe(2);
    expect(result.agree).toEqual([]);
    expect(result.disagree).toEqual([]);
  });

  test("the person who agreed most and the person who agreed least both come back", async () => {
    const newcomer = await citizen("newcomer");
    const ally = await citizen("ally");
    const opponent = await citizen("opponent");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
      law("A bill about schools"),
    ]);

    for (const bill of bills) {
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: newcomer.userId, position: "support" },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: ally.userId, position: "support" },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: opponent.userId, position: "oppose" },
      });
    }

    const result = await neighbours(newcomer.cookie);
    expect(result.agree.map((p) => p.id)).toContain(ally.userId);
    expect(result.disagree.map((p) => p.id)).toContain(opponent.userId);

    // BOTH LISTS, ALWAYS. Offering only the agreements would build the echo
    // chamber on the very first screen.
    expect(result.agree.length).toBeGreaterThan(0);
    expect(result.disagree.length).toBeGreaterThan(0);
  });

  test("nobody appears in both lists at once", async () => {
    const newcomer = await citizen("newcomer");
    const only = await citizen("only");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: newcomer.userId, position: "support" },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: only.userId, position: "support" },
      });
    }

    const result = await neighbours(newcomer.cookie);
    const inBoth = result.agree
      .map((p) => p.id)
      .filter((id) => result.disagree.some((other) => other.id === id));
    expect(inBoth).toEqual([]);
  });

  test("somebody already followed is not offered again", async () => {
    const newcomer = await citizen("newcomer");
    const ally = await citizen("ally");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: newcomer.userId, position: "support" },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: ally.userId, position: "support" },
      });
    }

    // Negative control: offered before the follow.
    expect((await neighbours(newcomer.cookie)).agree.map((p) => p.id)).toContain(ally.userId);

    await fetch(`${BASE_URL}/api/users/${ally.userId}/follow`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: newcomer.cookie }),
    });

    const after = await neighbours(newcomer.cookie);
    expect(after.agree.map((p) => p.id)).not.toContain(ally.userId);
    expect(after.disagree.map((p) => p.id)).not.toContain(ally.userId);
  });

  test("a blocked person is never offered", async () => {
    const newcomer = await citizen("newcomer");
    const blocked = await citizen("blocked");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: newcomer.userId, position: "support" },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: bill.id, userId: blocked.userId, position: "support" },
      });
    }

    expect((await neighbours(newcomer.cookie)).agree.map((p) => p.id)).toContain(blocked.userId);

    const blockResponse = await fetch(`${BASE_URL}/api/safety/blocks/${blocked.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: newcomer.cookie }),
    });
    expect(blockResponse.status).toBe(200);

    const after = await neighbours(newcomer.cookie);
    expect(after.agree.map((p) => p.id)).not.toContain(blocked.userId);
    expect(after.disagree.map((p) => p.id)).not.toContain(blocked.userId);
  });

  test("a signed-out visitor is asked to sign in rather than shown strangers", async () => {
    const response = await fetch(`${BASE_URL}/api/onboarding/neighbours`, {
      headers: freshClientHeaders({}),
    });
    expect(response.status).toBe(401);
  });
});
