/**
 * "Somebody voted in your name."
 *
 * THE HALF OF LIQUID DEMOCRACY THAT IS ALWAYS MISSING. Delegation is sold as
 * convenience and then the lending is the last you ever hear of it: every
 * implementation of this idea shows a count of delegations made and never once
 * says what was done with them. A voice you are not told about is a voice you
 * gave away rather than lent.
 *
 * The notification is also the undo — a direct vote overrides a delegate — so
 * it has to arrive while the person can still act on it, and it has to be
 * exactly right about who it goes to. Telling somebody their voice was used
 * when it was not is worse than silence: it makes the receipts a story.
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
  const name = `${label} ${seq}`;
  // The name comes back with the account because the notification body names
  // whoever spoke, and "which of them was it" is the assertion that matters.
  return { ...(await signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name,
  })), name };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Delegation is EARNED here — a delegate needs an account with some age on it,
 * posts, and a voting record. These tests are about what happens after a
 * delegation exists, so the eligibility is granted directly rather than
 * simulated a vote at a time.
 */
async function makeEligible(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });

  for (let i = 0; i < 3; i += 1) {
    await prisma.post.create({
      data: { authorId: userId, content: `Something worth saying, number ${i}.` },
    });
  }

  for (let i = 0; i < 20; i += 1) {
    eligibilityCounter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${9000 + eligibilityCounter}-119`,
        referenceType: "bill",
        title: `Track record ${i}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: row.id, userId, position: "support" },
    });
  }
}

let eligibilityCounter = 0;
let refCounter = 0;
async function law(title: string, category = "healthcare") {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${8000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category,
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

async function delegate(cookie: string, toUserId: string, category?: string) {
  await makeEligible(toUserId);
  const response = await fetch(`${BASE_URL}/api/delegations`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(category ? { toUserId, category } : { toUserId }),
  });
  // A delegation that silently failed would make every assertion below pass
  // for the wrong reason.
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`delegation failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function notifications(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/notifications?limit=50`, {
    headers: freshClientHeaders({ cookie }),
  });
  const body = (await response.json()) as {
    notifications?: Array<{ type: string; title: string; body: string }>;
  };
  return body.notifications ?? [];
}

/** Fire-and-forget writes take a moment; poll rather than assume. */
async function waitForVoiceUsed(cookie: string, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await notifications(cookie)).filter((n) => n.type === "voice_used");
    if (found.length > 0) return found;
    await Bun.sleep(100);
  }
  return [];
}

/** The opposite claim: nothing arrives, given a moment to. */
async function noVoiceUsed(cookie: string) {
  await Bun.sleep(1_000);
  return (await notifications(cookie)).filter((n) => n.type === "voice_used").length === 0;
}

describe("being told when somebody votes in your name", () => {
  test("the person who lent their voice is told, in the delegate's words", async () => {
    const lender = await citizen("lender");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about insulin pricing");

    await delegate(lender.cookie, speaker.userId);
    await vote(speaker.cookie, bill.id, "oppose");

    const told = await waitForVoiceUsed(lender.cookie);
    expect(told).toHaveLength(1);
    expect(told[0]!.title).toBe("Your voice was used");
    expect(told[0]!.body).toContain("opposed");
    expect(told[0]!.body).toContain("A bill about insulin pricing");
    // The notification is the undo, and says so.
    expect(told[0]!.body).toContain("Vote yourself");
  });

  test("somebody who voted for themselves is not told their voice was borrowed", async () => {
    const lender = await citizen("lender");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about insulin");

    await delegate(lender.cookie, speaker.userId);
    // They speak first. A direct vote always wins, so nothing was cast for them.
    await vote(lender.cookie, bill.id, "support");
    await vote(speaker.cookie, bill.id, "oppose");

    expect(await noVoiceUsed(lender.cookie)).toBe(true);
  });

  test("the voice travels the chain, and everybody along it is told", async () => {
    const first = await citizen("first");
    const middle = await citizen("middle");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about railways");

    await delegate(first.cookie, middle.userId);
    await delegate(middle.cookie, speaker.userId);
    await vote(speaker.cookie, bill.id, "support");

    // The person two hops away never chose the speaker, which is precisely why
    // they need telling.
    expect(await waitForVoiceUsed(middle.cookie)).toHaveLength(1);
    expect(await waitForVoiceUsed(first.cookie)).toHaveLength(1);
  });

  test("a chain broken by a direct vote stops there", async () => {
    const first = await citizen("first");
    const middle = await citizen("middle");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about railways");

    await delegate(first.cookie, middle.userId);
    await delegate(middle.cookie, speaker.userId);

    // The middle person speaks for themselves, so the first person's voice
    // lands on THEM and never reaches the speaker.
    await vote(middle.cookie, bill.id, "support");
    await vote(speaker.cookie, bill.id, "oppose");

    // Nothing was cast in the middle person's name — they spoke for themselves.
    expect(await noVoiceUsed(middle.cookie)).toBe(true);

    // The first person WAS spoken for, but by the middle person and not by the
    // speaker: the chain ends where a direct vote is.
    const told = await waitForVoiceUsed(first.cookie);
    expect(told).toHaveLength(1);
    expect(told[0]!.body).toContain("backed");
    expect(told[0]!.body).toContain(middle.name);
    expect(told[0]!.body).not.toContain(speaker.name);
  });

  test("a scoped delegation is not used on a record it does not cover", async () => {
    const lender = await citizen("lender");
    const health = await citizen("health");
    const other = await citizen("other");
    const defence = await law("A bill about defence spending", "defense");

    await delegate(lender.cookie, health.userId, "healthcare");
    await delegate(lender.cookie, other.userId, "defense");

    // The healthcare delegate votes on a defence bill. The lender's voice went
    // to somebody else for this category, so they were not spoken for here.
    await vote(health.cookie, defence.id, "support");

    expect(await noVoiceUsed(lender.cookie)).toBe(true);

    // Negative control: the delegate who does cover this category triggers it.
    await vote(other.cookie, defence.id, "oppose");
    expect(await waitForVoiceUsed(lender.cookie)).toHaveLength(1);
  });

  test("a delegate going back and forth leaves one notification, not a pile", async () => {
    const lender = await citizen("lender");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about insulin");

    await delegate(lender.cookie, speaker.userId);

    await vote(speaker.cookie, bill.id, "support");
    expect(await waitForVoiceUsed(lender.cookie)).toHaveLength(1);

    await vote(speaker.cookie, bill.id, "oppose");

    // Where the voice sits NOW, not the history of it.
    const deadline = Date.now() + 6_000;
    let told = await notifications(lender.cookie);
    while (
      Date.now() < deadline &&
      !told.some((n) => n.type === "voice_used" && n.body.includes("opposed"))
    ) {
      await Bun.sleep(100);
      told = await notifications(lender.cookie);
    }

    const voiceUsed = told.filter((n) => n.type === "voice_used");
    expect(voiceUsed).toHaveLength(1);
    expect(voiceUsed[0]!.body).toContain("opposed");
  });

  test("withdrawing does not notify — that releases a voice, it does not spend one", async () => {
    const lender = await citizen("lender");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about insulin");

    await delegate(lender.cookie, speaker.userId);
    await vote(speaker.cookie, bill.id, "support");
    expect(await waitForVoiceUsed(lender.cookie)).toHaveLength(1);

    // Toggling the same position off withdraws it.
    await vote(speaker.cookie, bill.id, "support");

    // The standing notification is left alone; no second one arrives.
    await Bun.sleep(1_000);
    expect((await notifications(lender.cookie)).filter((n) => n.type === "voice_used")).toHaveLength(
      1,
    );
  });

  test("turning it off means not being told", async () => {
    const lender = await citizen("lender");
    const speaker = await citizen("speaker");
    const bill = await law("A bill about insulin");

    await delegate(lender.cookie, speaker.userId);

    const off = await fetch(`${BASE_URL}/api/notifications/preferences`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: lender.cookie }),
      body: JSON.stringify({ voiceUsed: false }),
    });
    expect(off.status).toBe(200);

    await vote(speaker.cookie, bill.id, "support");
    expect(await noVoiceUsed(lender.cookie)).toBe(true);
  });

  test("nobody delegated, nobody is told", async () => {
    const speaker = await citizen("speaker");
    const bystander = await citizen("bystander");
    const bill = await law("A bill about insulin");

    await vote(speaker.cookie, bill.id, "support");

    expect(await noVoiceUsed(bystander.cookie)).toBe(true);
    expect(await noVoiceUsed(speaker.cookie)).toBe(true);
  });

  test("the platform refuses to build a ring in the first place", async () => {
    const a = await citizen("ring-a");
    const b = await citizen("ring-b");

    await delegate(a.cookie, b.userId);

    await makeEligible(a.userId);
    const closing = await fetch(`${BASE_URL}/api/delegations`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: b.cookie }),
      body: JSON.stringify({ toUserId: a.userId }),
    });
    expect(closing.status).toBe(400);
  });

  test("a ring that exists anyway is walked once, not forever", async () => {
    const a = await citizen("ring-a");
    const b = await citizen("ring-b");
    const c = await citizen("ring-c");
    const bill = await law("A bill about insulin");

    // Written straight into the database on purpose. The API refuses to close
    // a ring, so the only way to prove the WALK is ring-safe — rather than
    // relying on the guard that stops one being made — is to build one behind
    // the guard's back. Data outlives the rule that rejected it.
    for (const [from, to] of [
      [a.userId, b.userId],
      [b.userId, c.userId],
      [c.userId, a.userId],
    ]) {
      await prisma.delegation.create({
        data: { fromUserId: from!, toUserId: to!, isActive: true },
      });
    }

    await vote(a.cookie, bill.id, "support");

    // C lent to A, who spoke: told. B lent to C, who did not speak, so B's
    // voice carries on to A: told. A spoke for themselves and is told nothing,
    // and the walk stops rather than going round again.
    expect(await waitForVoiceUsed(c.cookie)).toHaveLength(1);
    expect(await waitForVoiceUsed(b.cookie)).toHaveLength(1);
    expect(await noVoiceUsed(a.cookie)).toBe(true);
  });
});
