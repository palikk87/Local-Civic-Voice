/**
 * Where two citizens actually agree, and where they do not.
 *
 * Every platform that has tried to tell you about another person has done it
 * by inferring — clicks, follows, a model's guess — and the output is a
 * similarity number that sorts people into groups. This infers nothing: both
 * people took public positions on the same government records, so the overlap
 * is a matter of record rather than a prediction.
 *
 * The test that matters most here is the one asserting disagreements come back
 * too. A version of this that returned only common ground would introduce
 * somebody to the parts of a stranger they already like and hide the rest.
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
      masterReferenceId: `hr-${7000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function vote(cookie: string, referenceId: string, position: string) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ position }),
  });
}

interface SharedPosition {
  reference: { id: string; title: string };
  yourPosition: string;
  theirPosition: string;
}

async function ground(cookie: string, otherId: string) {
  const response = await fetch(`${BASE_URL}/api/users/${otherId}/common-ground`, {
    headers: freshClientHeaders({ cookie }),
  });
  return {
    status: response.status,
    body: (await response.json()) as {
      shared: number;
      agreed: number;
      disagreed: number;
      agreements: SharedPosition[];
      disagreements: SharedPosition[];
    },
  };
}

describe("common ground between two citizens", () => {
  test("a record they both backed is common ground", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const insulin = await law("A bill about insulin pricing");

    await vote(me.cookie, insulin.id, "support");
    await vote(them.cookie, insulin.id, "support");

    const { body } = await ground(me.cookie, them.userId);
    expect(body).toMatchObject({ shared: 1, agreed: 1, disagreed: 0 });
    expect(body.agreements[0]!.reference.id).toBe(insulin.id);
    expect(body.disagreements).toEqual([]);
  });

  test("the disagreements come back too, not just the agreements", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const insulin = await law("A bill about insulin pricing");
    const border = await law("A bill about the border");

    await vote(me.cookie, insulin.id, "support");
    await vote(them.cookie, insulin.id, "support");
    await vote(me.cookie, border.id, "support");
    await vote(them.cookie, border.id, "oppose");

    const { body } = await ground(me.cookie, them.userId);
    expect(body).toMatchObject({ shared: 2, agreed: 1, disagreed: 1 });
    expect(body.agreements[0]!.reference.id).toBe(insulin.id);
    expect(body.disagreements[0]!.reference.id).toBe(border.id);
    expect(body.disagreements[0]).toMatchObject({
      yourPosition: "support",
      theirPosition: "oppose",
    });
  });

  test("a record only one of them touched is not shared", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const mineOnly = await law("A bill only I voted on");
    const theirsOnly = await law("A bill only they voted on");

    await vote(me.cookie, mineOnly.id, "support");
    await vote(them.cookie, theirsOnly.id, "support");

    const { body } = await ground(me.cookie, them.userId);
    expect(body).toMatchObject({ shared: 0, agreed: 0, disagreed: 0 });
  });

  test("a withdrawn position is not a position", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const bill = await law("A bill about railways");

    await vote(me.cookie, bill.id, "support");
    await vote(them.cookie, bill.id, "support");
    await vote(them.cookie, bill.id, "support"); // Toggles their vote off.

    const { body } = await ground(me.cookie, them.userId);
    expect(body.shared).toBe(0);
  });

  test("changing your mind moves the record from agreement to disagreement", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const bill = await law("A bill about insulin");

    await vote(me.cookie, bill.id, "support");
    await vote(them.cookie, bill.id, "support");
    expect((await ground(me.cookie, them.userId)).body.agreed).toBe(1);

    await vote(them.cookie, bill.id, "oppose");

    const { body } = await ground(me.cookie, them.userId);
    expect(body).toMatchObject({ shared: 1, agreed: 0, disagreed: 1 });
  });

  test("somebody else's delegated weight is not counted as their agreement", async () => {
    const me = await citizen("me");
    const delegate = await citizen("delegate");
    const quiet = await citizen("quiet");
    const bill = await law("A bill about insulin");

    // The quiet citizen lends their voice to the delegate, who then backs the
    // bill. The delegated weight lands in the tally; it is not the quiet
    // citizen agreeing with anybody.
    await fetch(`${BASE_URL}/api/delegations`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: quiet.cookie }),
      body: JSON.stringify({ toUserId: delegate.userId }),
    });

    await vote(me.cookie, bill.id, "support");
    await vote(delegate.cookie, bill.id, "support");

    expect((await ground(me.cookie, delegate.userId)).body.agreed).toBe(1);
    expect((await ground(me.cookie, quiet.userId)).body.shared).toBe(0);
  });

  test("your own profile is not common ground with yourself", async () => {
    const me = await citizen("me");
    const bill = await law("A bill about insulin");
    await vote(me.cookie, bill.id, "support");

    const { body } = await ground(me.cookie, me.userId);
    expect(body).toMatchObject({ shared: 0, agreed: 0, disagreed: 0 });
  });

  test("a blocked person is a 404, never a revealed block", async () => {
    const me = await citizen("me");
    const them = await citizen("them");
    const bill = await law("A bill about insulin");

    await vote(me.cookie, bill.id, "support");
    await vote(them.cookie, bill.id, "support");

    // Negative control: reachable before the block.
    expect((await ground(me.cookie, them.userId)).status).toBe(200);

    const blocked = await fetch(`${BASE_URL}/api/safety/blocks/${them.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: me.cookie }),
    });
    expect(blocked.status).toBe(200);

    const after = await ground(me.cookie, them.userId);
    expect(after.status).toBe(404);
  });

  test("a signed-out reader is asked to sign in rather than shown a stranger's overlap", async () => {
    const them = await citizen("them");
    const response = await fetch(`${BASE_URL}/api/users/${them.userId}/common-ground`, {
      headers: freshClientHeaders({}),
    });
    expect(response.status).toBe(401);
  });

  test("a made-up user is a 404", async () => {
    const me = await citizen("me");
    const response = await fetch(`${BASE_URL}/api/users/does-not-exist/common-ground`, {
      headers: freshClientHeaders({ cookie: me.cookie }),
    });
    expect(response.status).toBe(404);
  });

  test("nobody has voted on anything and it says so rather than failing", async () => {
    const me = await citizen("me");
    const them = await citizen("them");

    const { status, body } = await ground(me.cookie, them.userId);
    expect(status).toBe(200);
    expect(body).toMatchObject({ shared: 0, agreed: 0, disagreed: 0 });
    expect(body.agreements).toEqual([]);
  });
});
