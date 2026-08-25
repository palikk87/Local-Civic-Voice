/**
 * The other side, and how opinion moved.
 *
 * Two things that work here and cannot work anywhere else, for the same reason:
 * every post is attached to a government record, and every citizen's position
 * on that record is known.
 *
 * So "show me the other side" needs no model and no curator — it is the people
 * who voted the opposite way on this exact bill and then wrote about it. And
 * "when did opinion turn" is answerable at all only because positions are kept
 * as events rather than as a current state.
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
  const account = await signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
  return { ...account, name: `${label} ${seq}` };
}

let refCounter = 0;
async function law() {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${2000 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill people disagree about",
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

async function post(cookie: string, content: string, referenceId: string) {
  const r = await fetch(`${BASE_URL}/api/posts`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ content, governmentReferenceId: referenceId }),
  });
  if (!r.ok) throw new Error(`post failed: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { post: { id: string } }).post.id;
}

async function otherSide(cookie: string, referenceId: string) {
  const r = await fetch(`${BASE_URL}/api/government-references/${referenceId}/other-side`, {
    headers: freshClientHeaders({ cookie }),
  });
  return (await r.json()) as {
    yourPosition: string | null;
    otherPosition: string | null;
    results: Array<{ id: string; author: { id: string } }>;
    reason: string | null;
  };
}

describe("the other side", () => {
  test("shows what people who voted the opposite way wrote", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");
    const ally = await citizen("ally");
    const bill = await law();

    await vote(reader.cookie, bill.id, "support");
    await vote(opponent.cookie, bill.id, "oppose");
    await vote(ally.cookie, bill.id, "support");

    const theirs = await post(opponent.cookie, "Here is why this bill is a mistake.", bill.id);
    await post(ally.cookie, "Here is why it is not.", bill.id);

    const seen = await otherSide(reader.cookie, bill.id);

    // No model, no guess, no ranking by heat: these are the people who landed
    // on the opposite side of this exact bill.
    expect(seen.yourPosition).toBe("support");
    expect(seen.otherPosition).toBe("oppose");
    expect(seen.results.map((p) => p.id)).toEqual([theirs]);
  });

  test("somebody who has not taken a position is not shown a side", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");
    const bill = await law();

    await vote(opponent.cookie, bill.id, "oppose");
    await post(opponent.cookie, "A view.", bill.id);

    const seen = await otherSide(reader.cookie, bill.id);

    // Without a position of their own there is no "other" side — and picking
    // one for them is the thing every other platform does.
    expect(seen.yourPosition).toBeNull();
    expect(seen.results).toHaveLength(0);
    expect(seen.reason).toBe("take-a-position-first");
  });

  test("it says so plainly when the other side has written nothing", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");
    const bill = await law();

    await vote(reader.cookie, bill.id, "support");
    await vote(opponent.cookie, bill.id, "oppose");

    const seen = await otherSide(reader.cookie, bill.id);
    expect(seen.results).toHaveLength(0);
    expect(seen.reason).toBe("nobody-wrote");
  });

  test("a blocked person is not the other side", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");
    const bill = await law();

    await vote(reader.cookie, bill.id, "support");
    await vote(opponent.cookie, bill.id, "oppose");
    await post(opponent.cookie, "A view they will not see.", bill.id);

    await fetch(`${BASE_URL}/api/safety/blocks/${opponent.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });

    const seen = await otherSide(reader.cookie, bill.id);
    expect(seen.results).toHaveLength(0);
  });

  test("the most discussed argument comes first, not the most liked", async () => {
    const reader = await citizen("reader");
    const one = await citizen("one");
    const two = await citizen("two");
    const bill = await law();

    await vote(reader.cookie, bill.id, "support");
    await vote(one.cookie, bill.id, "oppose");
    await vote(two.cookie, bill.id, "oppose");

    const quiet = await post(one.cookie, "A point nobody replied to.", bill.id);
    const discussed = await post(two.cookie, "A point people argued with.", bill.id);

    await fetch(`${BASE_URL}/api/posts/${discussed}/comments`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: reader.cookie }),
      body: JSON.stringify({ content: "I disagree, and here is why." }),
    });
    // Likes on the other one, to prove they are not what orders this.
    await fetch(`${BASE_URL}/api/posts/${quiet}/like`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: one.cookie }),
    });

    const seen = await otherSide(reader.cookie, bill.id);
    expect(seen.results[0]!.id).toBe(discussed);
  });
});

/**
 * Read the pulse history once every voice cast so far has reached it.
 *
 * WHY A POLL AND NOT A PLAIN READ. Voting writes two things: the vote row,
 * which the response waits for, and a PositionEvent, which it does not —
 * routes/government-references.ts calls `void recordPosition(...)` on purpose,
 * so that a vote can never fail because its history did. That is the right
 * trade for the product: the tally is what the person came to do, the ledger is
 * the memory of it.
 *
 * The consequence is that pulse-history is eventually consistent, and a test
 * that reads it the microsecond after voting is asserting on a race. It passed
 * on this machine every time and failed in CI, whose runner is slower and
 * contended — "expected 2, received 1", one vote's event still in flight.
 *
 * So the test waits for the projection to catch up, which is what any real
 * reader does by virtue of arriving later. DO NOT "fix" this by awaiting
 * recordPosition in the route: that would put a vote's success back at the
 * mercy of its bookkeeping, which is the exact failure the `void` prevents.
 */
async function pulseHistory(
  cookie: string,
  referenceId: string,
  expected: { voices: number },
): Promise<{ points: { support: number; oppose: number; lawChanged: boolean }[] }> {
  const deadline = Date.now() + 5000;
  let latest: { points: { support: number; oppose: number; lawChanged: boolean }[] } = {
    points: [],
  };

  while (Date.now() < deadline) {
    latest = (await (
      await fetch(`${BASE_URL}/api/government-references/${referenceId}/pulse-history`, {
        headers: freshClientHeaders({ cookie }),
      })
    ).json()) as typeof latest;

    const last = latest.points[latest.points.length - 1];
    // Counted rather than "any point exists": a withdrawal settles at zero, and
    // waiting for a non-empty response would return before it landed.
    if (last && last.support + last.oppose === expected.voices) return latest;
    await Bun.sleep(50);
  }

  // Returned rather than thrown, so the assertion that follows reports what was
  // actually there — a timeout message would hide the numbers.
  return latest;
}

describe("how opinion moved", () => {
  test("the pulse can be read back over time, not just today", async () => {
    const first = await citizen("first");
    const second = await citizen("second");
    const bill = await law();

    await vote(first.cookie, bill.id, "support");
    await vote(second.cookie, bill.id, "oppose");

    const history = await pulseHistory(first.cookie, bill.id, { voices: 2 });

    // The vote table can only ever say what the Pulse is now.
    expect(history.points.length).toBeGreaterThan(0);
    const last = history.points[history.points.length - 1]!;
    expect(last).toMatchObject({ support: 1, oppose: 1 });
  });

  test("a position held and never revisited still counts later", async () => {
    const person = await citizen("person");
    const other = await citizen("other");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(other.cookie, bill.id, "support");

    const history = await pulseHistory(person.cookie, bill.id, { voices: 2 });

    // Somebody who backed a bill and moved on is still backing it.
    expect(history.points[history.points.length - 1]!.support).toBe(2);
  });

  test("withdrawing takes a voice back out of the history", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await vote(person.cookie, bill.id, "support");

    // Voting the same way twice withdraws it, so the settled state is nobody.
    const history = await pulseHistory(person.cookie, bill.id, { voices: 0 });

    expect(history.points[history.points.length - 1]!).toMatchObject({ support: 0, oppose: 0 });
  });

  test("the day the law changed is marked", async () => {
    const person = await citizen("person");
    const bill = await law();

    await vote(person.cookie, bill.id, "support");
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawVersion: 2, lawChangedAt: new Date() },
    });

    const history = await pulseHistory(person.cookie, bill.id, { voices: 1 });

    // On this platform the amendment is usually the answer to "what turned it".
    expect(history.points.some((p) => p.lawChanged)).toBe(true);
  });
});
