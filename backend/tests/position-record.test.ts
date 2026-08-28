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

/** Who moved on this law, which way, and what they said about it. */
async function turning(referenceId: string, cookie?: string, limit?: number) {
  const response = await fetch(
    `${BASE_URL}/api/government-references/${referenceId}/turning-points${
      limit ? `?limit=${limit}` : ""
    }`,
    { headers: freshClientHeaders(cookie ? { cookie } : {}) },
  );
  return (await response.json()) as {
    results: Array<{
      user: { id: string; displayName: string };
      from: string;
      to: string;
      reason: string | null;
      lawVersion: number;
      afterTextChanged: boolean;
    }>;
    toSupport: number;
    toOppose: number;
    total: number;
    people: number;
    afterTextChanged: number;
  };
}

/** The crossings are written after the vote responds, so wait for them. */
async function crossingsSettled(referenceId: string, expected: number, cookie?: string) {
  const deadline = Date.now() + 5_000;
  let latest = await turning(referenceId, cookie);
  while (latest.total < expected && Date.now() < deadline) {
    await Bun.sleep(100);
    latest = await turning(referenceId, cookie);
  }
  return latest;
}

describe("who changed their mind", () => {
  test("a crossing is reported with the side left and the side taken", async () => {
    const mover = await citizen("mover");
    const bill = await law("A bill about insulin pricing");

    await vote(mover.cookie, bill.id, "support");
    await vote(mover.cookie, bill.id, "oppose", "The pricing cap was stripped out");

    const moved = await crossingsSettled(bill.id, 1);
    expect(moved.total).toBe(1);
    expect(moved.people).toBe(1);
    expect(moved.toOppose).toBe(1);
    expect(moved.toSupport).toBe(0);
    expect(moved.results[0]).toMatchObject({
      from: "support",
      to: "oppose",
      reason: "The pricing cap was stripped out",
    });
    expect(moved.results[0]!.user.id).toBe(mover.userId);
  });

  test("a first position is not a change of mind", async () => {
    const person = await citizen("firsttimer");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 1);

    expect((await turning(bill.id)).total).toBe(0);
  });

  test("voting the same way twice is not a change of mind", async () => {
    const person = await citizen("steady");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 2);

    expect((await turning(bill.id)).total).toBe(0);
  });

  test("moving after the government amended the text is marked as such", async () => {
    const mover = await citizen("reader");
    const bill = await law();

    await vote(mover.cookie, bill.id, "support");
    await settled(mover.cookie, mover.userId, 1);

    // The government changes the bill under them.
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawVersion: 2, lawChangedAt: new Date() },
    });

    await vote(mover.cookie, bill.id, "oppose", "Read the amended text");

    const moved = await crossingsSettled(bill.id, 1);
    expect(moved.afterTextChanged).toBe(1);
    expect(moved.results[0]).toMatchObject({ afterTextChanged: true, lawVersion: 2 });
  });

  test("moving while the text stood still is not blamed on the text", async () => {
    const mover = await citizen("persuaded");
    const bill = await law();

    await vote(mover.cookie, bill.id, "support");
    await vote(mover.cookie, bill.id, "oppose");

    const moved = await crossingsSettled(bill.id, 1);
    expect(moved.afterTextChanged).toBe(0);
    expect(moved.results[0]!.afterTextChanged).toBe(false);
  });

  test("counts cover every crossing even when the page is short", async () => {
    const bill = await law();
    const movers = [
      await citizen("crowd-a"),
      await citizen("crowd-b"),
      await citizen("crowd-c"),
    ];

    for (const person of movers) {
      await vote(person.cookie, bill.id, "support");
      await vote(person.cookie, bill.id, "oppose");
    }

    const moved = await crossingsSettled(bill.id, 3);
    const short = await turning(bill.id, undefined, 1);

    expect(short.results).toHaveLength(1);
    expect(short.total).toBe(3);
    expect(short.people).toBe(3);
    expect(short.toOppose).toBe(3);
    expect(moved.total).toBe(3);
  });

  test("somebody who moved twice is one person, two crossings", async () => {
    const wobbler = await citizen("wobbler");
    const bill = await law();

    await vote(wobbler.cookie, bill.id, "support");
    await vote(wobbler.cookie, bill.id, "oppose");
    await vote(wobbler.cookie, bill.id, "support");

    const moved = await crossingsSettled(bill.id, 2);
    expect(moved.total).toBe(2);
    expect(moved.people).toBe(1);
    expect(moved.toSupport).toBe(1);
    expect(moved.toOppose).toBe(1);
  });

  test("withdrawing and coming back is not a change of mind", async () => {
    const person = await citizen("returner");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support"); // Toggles the vote off.
    await vote(person.cookie, bill.id, "support");
    await settled(person.cookie, person.userId, 3);

    expect((await turning(bill.id)).total).toBe(0);
  });

  test("a blocked person's change of mind is not shown to the person who blocked them", async () => {
    const reader = await citizen("reader");
    const blocked = await citizen("blocked");
    const bill = await law();

    await vote(blocked.cookie, bill.id, "support");
    await vote(blocked.cookie, bill.id, "oppose");
    await crossingsSettled(bill.id, 1);

    // Negative control: visible before the block, so the assertion below is
    // about the block rather than about the crossing never being recorded.
    const before = await turning(bill.id, reader.cookie);
    expect(before.total).toBe(1);

    const blockResponse = await fetch(`${BASE_URL}/api/safety/blocks/${blocked.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    expect(blockResponse.status).toBe(200);

    const after = await turning(bill.id, reader.cookie);
    expect(after.total).toBe(0);
    expect(after.results).toHaveLength(0);
  });

  test("a law nobody has moved on says so rather than failing", async () => {
    const bill = await law();
    const quiet = await turning(bill.id);

    expect(quiet).toMatchObject({ total: 0, people: 0, afterTextChanged: 0 });
    expect(quiet.results).toEqual([]);
  });

  test("a made-up law is a 404, not an empty answer", async () => {
    const response = await fetch(
      `${BASE_URL}/api/government-references/does-not-exist/turning-points`,
      { headers: freshClientHeaders({}) },
    );
    expect(response.status).toBe(404);
  });
});

/**
 * THE ANONYMITY RULE HAD NO TEST, ON ANY LAYER.
 *
 * `positionHistory` and `positionSummary` both carry
 * `...(isOwner ? {} : { isAnonymous: false })`, and nothing anywhere proved
 * either of them. A rule that is enforced and unproven is a rule waiting to be
 * refactored away by somebody who does not know it is there — and the thing
 * being protected here is a person's vote.
 *
 * A bug report asked whether the record page broke the anonymity the platform
 * promises. It did not. This is what makes that answer keep being true.
 *
 * Note the second half: the COUNTS have to hide it too. A record showing
 * "3 positions" and listing two is an invitation to work out the third.
 */
describe("[bor-art4] an anonymous position is nobody else's business", () => {
  test("A STRANGER SEES NEITHER THE POSITION NOR ITS TRACE IN THE COUNTS", async () => {
    const subject = await citizen("subject");
    const stranger = await citizen("stranger");

    const inTheOpen = await law("A law they backed with their name on it");
    const quietly = await law("A law they backed without their name");

    await vote(subject.cookie, inTheOpen.id, "support");

    // The anonymous one goes in the way a citizen's own setting would send it.
    await fetch(`${BASE_URL}/api/government-references/${quietly.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: subject.cookie }),
      body: JSON.stringify({ position: "support", anonymous: true }),
    });

    const theirs = await settled(subject.cookie, subject.userId, 2);
    expect(theirs.summary.total).toBe(2);
    expect(theirs.results.map((r) => r.reference.id).sort()).toEqual(
      [inTheOpen.id, quietly.id].sort(),
    );

    const seen = await record(stranger.cookie, subject.userId);
    expect(seen.results.map((r) => r.reference.id)).toEqual([inTheOpen.id]);

    // The count agrees with the list. Two numbers that disagree is the leak.
    expect(seen.summary.total).toBe(1);
    expect(seen.summary.support).toBe(1);
  });

  test("nor does a reader with no account at all", async () => {
    const subject = await citizen("quiet");
    const quietly = await law("Backed without a name, read by nobody");

    await fetch(`${BASE_URL}/api/government-references/${quietly.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: subject.cookie }),
      body: JSON.stringify({ position: "support", anonymous: true }),
    });
    await settled(subject.cookie, subject.userId, 1);

    const response = await fetch(`${BASE_URL}/api/users/${subject.userId}/positions`, {
      headers: freshClientHeaders({}),
    });
    const seen = (await response.json()) as {
      results: unknown[];
      summary: { total: number };
    };

    expect(seen.results).toEqual([]);
    expect(seen.summary.total).toBe(0);
  });
});
