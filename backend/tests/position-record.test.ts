/**
 * A citizen's record: where they stood, when, and on which version of the law.
 *
 * The platform could not answer this about its own users. One vote row per
 * person per record, overwritten on a change of mind — the right shape for a
 * tally and the wrong shape for a person. The Pulse knew everything and the
 * citizen knew nothing about themselves.
 *
 * For a platform whose entire claim is that a public position should be
 * traceable to an official source, having no traceable record of the public's
 * own positions was the gap sitting closest to the premise.
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
async function law(title = "A bill about insulin pricing") {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${4000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function vote(cookie: string, referenceId: string, position: string, reason?: string) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(reason ? { position, reason } : { position }),
  });
}

async function record(cookie: string, userId: string) {
  const response = await fetch(`${BASE_URL}/api/users/${userId}/positions`, {
    headers: freshClientHeaders({ cookie }),
  });
  return (await response.json()) as {
    results: Array<{
      position: string;
      reason: string | null;
      isChange: boolean;
      lawVersion: number;
      lawMovedSince: boolean;
      reference: { id: string };
    }>;
    summary: {
      total: number;
      support: number;
      oppose: number;
      changesOfMind: number;
      standingOnOldText: number;
    };
  };
}

/** The history is written after the response, so give it a moment to land. */
async function settled(cookie: string, userId: string, expected: number) {
  const deadline = Date.now() + 5_000;
  let latest = await record(cookie, userId);
  while (latest.results.length < expected && Date.now() < deadline) {
    await Bun.sleep(100);
    latest = await record(cookie, userId);
  }
  return latest;
}

describe("a citizen's record", () => {
  test("every position taken is kept, in order", async () => {
    const person = await citizen("person");
    const first = await law("A bill about insulin");
    const second = await law("A bill about railways");

    await vote(person.cookie, first.id, "support");
    await vote(person.cookie, second.id, "oppose");

    const mine = await settled(person.cookie, person.userId, 2);
    expect(mine.results.map((r) => r.reference.id)).toEqual([second.id, first.id]);
    expect(mine.summary).toMatchObject({ total: 2, support: 1, oppose: 1 });
  });

  test("changing your mind adds a position rather than erasing one", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "oppose", "I read the amendment.");

    const mine = await settled(person.cookie, person.userId, 2);

    // The vote row holds one position. The record holds both, because a person
    // having changed their mind is a fact about them, not an embarrassment to
    // be overwritten.
    expect(await prisma.governmentReferenceVote.count({ where: { userId: person.userId } })).toBe(1);
    expect(mine.results).toHaveLength(2);
    expect(mine.results[0]).toMatchObject({
      position: "oppose",
      isChange: true,
      reason: "I read the amendment.",
    });
    expect(mine.results[1]).toMatchObject({ position: "support", isChange: false });
    expect(mine.summary.changesOfMind).toBe(1);
  });

  test("voting the same way twice is not a change of mind", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    // Same position again — the endpoint treats it as withdrawing, then the
    // person puts it back. Neither is a change of what they think.
    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support");

    const mine = await settled(person.cookie, person.userId, 3);
    const changes = mine.results.filter((r) => r.isChange && r.position !== "withdrawn");
    expect(changes).toHaveLength(0);
  });

  test("withdrawing is recorded as its own act", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support");

    const mine = await settled(person.cookie, person.userId, 2);
    expect(mine.results[0]!.position).toBe("withdrawn");
    expect(mine.summary.support).toBe(1);
  });

  test("a reason is kept when given and never demanded", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    const mine = await settled(person.cookie, person.userId, 1);

    // A reason people are forced to give is a reason people invent.
    expect(mine.results[0]!.reason).toBeNull();
  });

  test("the record knows which version of the law it was about", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 1);

    // The government amends the bill.
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawVersion: 2, lawChangedAt: new Date() },
    });

    const mine = await record(person.cookie, person.userId);
    expect(mine.results[0]!.lawVersion).toBe(1);
    expect(mine.results[0]!.lawMovedSince).toBe(true);
    expect(mine.summary.standingOnOldText).toBe(1);
  });

  test("somebody else's record is public, and a blocked person's is not", async () => {
    const person = await citizen("person");
    const reader = await citizen("reader");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 1);

    // Public: this platform asks for public positions on public business.
    const asReader = await record(reader.cookie, person.userId);
    expect(asReader.results).toHaveLength(1);

    await fetch(`${BASE_URL}/api/safety/blocks/${person.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    const afterBlock = await fetch(`${BASE_URL}/api/users/${person.userId}/positions`, {
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    expect(afterBlock.status).toBe(404);
  });
});

describe("standing on old text", () => {
  test("you are asked about positions the law has moved out from under", async () => {
    const person = await citizen("person");
    const moved = await law("A bill that was amended");
    const stable = await law("A bill that was not");

    await vote(person.cookie, moved.id, "support");
    await vote(person.cookie, stable.id, "support");
    await settled(person.cookie, person.userId, 2);

    await prisma.governmentReference.update({
      where: { id: moved.id },
      data: { lawVersion: 3, lawChangedAt: new Date() },
    });

    const review = (await (
      await fetch(`${BASE_URL}/api/users/me/positions/review`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as {
      results: Array<{ reference: { id: string }; takenOnVersion: number; nowAtVersion: number }>;
      count: number;
    };

    expect(review.count).toBe(1);
    expect(review.results[0]!.reference.id).toBe(moved.id);
    expect(review.results[0]).toMatchObject({ takenOnVersion: 1, nowAtVersion: 3 });
  });

  test("nothing is withdrawn on your behalf", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 1);

    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawVersion: 2, lawChangedAt: new Date() },
    });

    // Silence is not a change of mind. A platform that decides what your
    // silence meant has taken the position for you.
    const stillCounted = await prisma.governmentReferenceVote.findFirst({
      where: { userId: person.userId, governmentReferenceId: bill.id },
    });
    expect(stillCounted?.position).toBe("support");
  });

  test("re-affirming the position clears the prompt", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 1);

    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawVersion: 2, lawChangedAt: new Date() },
    });

    // Withdraw and re-cast on the new text: the person has now taken a position
    // on what the bill actually says.
    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 3);

    const review = (await (
      await fetch(`${BASE_URL}/api/users/me/positions/review`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as { count: number };
    expect(review.count).toBe(0);
  });
});

describe("where you stand", () => {
  async function crowd(size: number, referenceId: string, position: string) {
    for (let i = 0; i < size; i += 1) {
      const person = await citizen("crowd");
      await vote(person.cookie, referenceId, position);
    }
  }

  test("it counts agreement and disagreement honestly", async () => {
    const person = await citizen("person");
    const popular = await law("A bill most people back");
    const lonely = await law("A bill almost nobody backs");

    await vote(person.cookie, popular.id, "support");
    await crowd(4, popular.id, "support");

    await vote(person.cookie, lonely.id, "support");
    await crowd(4, lonely.id, "oppose");

    const mine = (await (
      await fetch(`${BASE_URL}/api/users/me/standing`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as {
      measured: number;
      withMajority: number;
      inMinority: number;
      mostAlone: Array<{ reference: { id: string }; agreementPct: number }>;
    };

    expect(mine).toMatchObject({ measured: 2, withMajority: 1, inMinority: 1 });
    expect(mine.mostAlone[0]!.reference.id).toBe(lonely.id);
    expect(mine.mostAlone[0]!.agreementPct).toBe(20);
  });

  test("a record two people voted on proves nothing and is left out", async () => {
    const person = await citizen("person");
    const other = await citizen("other");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(other.cookie, bill.id, "oppose");

    // Telling somebody they are in a minority of two is noise dressed as
    // insight.
    const mine = (await (
      await fetch(`${BASE_URL}/api/users/me/standing`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as { measured: number };
    expect(mine.measured).toBe(0);
  });

  test("a delegated landslide does not decide what the majority thinks", async () => {
    const person = await citizen("person");
    const leader = await citizen("leader");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(leader.cookie, bill.id, "oppose");
    await crowd(2, bill.id, "support");

    // Give the opposing voice a large delegated weight. The published tally
    // moves; the mirror does not, because one well-followed delegate should not
    // decide what "most people think" looks like to one citizen.
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { opposeVotes: 900 },
    });

    const mine = (await (
      await fetch(`${BASE_URL}/api/users/me/standing`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as { withMajority: number; inMinority: number };

    expect(mine).toMatchObject({ withMajority: 1, inMinority: 0 });
  });

  test("somebody who has taken no position is not told where they stand", async () => {
    const person = await citizen("person");

    const mine = (await (
      await fetch(`${BASE_URL}/api/users/me/standing`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      })
    ).json()) as { measured: number; mostAlone: unknown[] };

    expect(mine.measured).toBe(0);
    expect(mine.mostAlone).toHaveLength(0);
  });
});
