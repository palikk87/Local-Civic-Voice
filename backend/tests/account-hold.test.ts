/**
 * AN ACCOUNT MAY NOT BE CLOSED OUT FROM UNDER A LIVE PROCEEDING.
 *
 * THE RULE, in the owner's words: "Deleting accounts works routinely, but if
 * someone has an open article or report going then their profile is still
 * visible to the public. Their account is effectively suspended, but other
 * users can take a look at their profile while the proceedings are still live.
 * When proceedings close out then the profile disappears."
 *
 * And the limit on it, also his: "the deletion cannot be undone just because
 * the proceedings are ongoing. The limbo profile is for the benefit of others,
 * not themselves. They chose to delete and that's a real lasting choice."
 *
 * CONSTITUTION ARTICLE V §3 is why the platform may do this at all: "No
 * Proceeding under this Article may be halted, delayed or reversed by any
 * Officer, at any level of authority." Somebody who could delete their way out
 * of an impeachment halts it by walking away, and an administrator who could
 * delete them halts it from the console — which is the case the clause names.
 * So both doors are held by the same rule, and both are tested here.
 *
 * WHAT IS NOT HELD. Sitting on a jury is not being a party to one. A juror's
 * name is not on the case and nobody is looking at their profile to judge it;
 * account-deletion.ts already recuses the seat and draws a replacement, and
 * that stays the behaviour. Asserted below, because "held" quietly spreading to
 * cover jurors would trap people who did nothing but answer a summons.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  freshClientHeaders,
  prisma,
  resetData,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import {
  closeAccount,
  proceedingsHolding,
  sweepClosedAccounts,
} from "../src/services/account-closure";

const PASSWORD = "test-password-not-a-real-one";
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
async function citizen(label = "person") {
  seq += 1;
  return signUp({
    email: `${label}-hold-${seq}@example.com`,
    password: PASSWORD,
    name: `${label} ${seq}`,
  });
}

async function openImpeachmentAgainst(leaderId: string, filerId: string) {
  return prisma.impeachment.create({
    data: {
      leaderId,
      filedById: filerId,
      grounds: "A reason somebody gave.",
      evidence: "What was pointed at.",
      status: "open",
      expiresAt: new Date(Date.now() + 7 * DAY),
    },
  });
}

beforeAll(async () => {
  await startServer();
});

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await stopServer();
});

// ---------------------------------------------------------------------------

describe("the ordinary case is unchanged", () => {
  test("somebody with nothing open is erased on the spot", async () => {
    const person = await citizen("ordinary");

    const outcome = await closeAccount(person.userId);

    expect(outcome.ok).toBe(true);
    expect(outcome.deleted).toBe(true);
    expect(outcome.held).toEqual([]);
    expect(await prisma.user.findUnique({ where: { id: person.userId } })).toBeNull();
  });
});

describe("a party to a live proceeding is HELD, not erased", () => {
  test("the accused in an open impeachment", async () => {
    const leader = await citizen("accused");
    const filer = await citizen("filer");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    const outcome = await closeAccount(leader.userId);

    expect(outcome.deleted).toBe(false);
    expect(outcome.held.length).toBe(1);
    expect(outcome.held[0]?.role).toBe("subject");

    // STILL THERE, which is the whole point.
    const still = await prisma.user.findUnique({
      where: { id: leader.userId },
      select: { deletionRequestedAt: true },
    });
    expect(still).not.toBeNull();
    expect(still?.deletionRequestedAt).not.toBeNull();
  });

  test("the person who brought it", async () => {
    const leader = await citizen("leader");
    const filer = await citizen("bringer");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    const outcome = await closeAccount(filer.userId);

    expect(outcome.deleted).toBe(false);
    expect(outcome.held[0]?.role).toBe("filed");
  });

  test("somebody a report was filed about", async () => {
    const subject = await citizen("reported");
    const reporter = await citizen("reporter");
    await prisma.report.create({
      data: {
        reporterId: reporter.userId,
        reportedUserId: subject.userId,
        reason: "harassment",
        status: "open",
      },
    });

    const outcome = await closeAccount(subject.userId);
    expect(outcome.deleted).toBe(false);
    expect(outcome.held[0]?.kind).toBe("report");
    expect(outcome.held[0]?.role).toBe("subject");
  });

  test("AND THE HOLD IS NOT A WAY BACK IN — every session is destroyed", async () => {
    /*
     * The owner: "they chose to delete and that's a real lasting choice." The
     * record staying up must not read as the account staying usable.
     */
    const leader = await citizen("stillsigned");
    const filer = await citizen("filer2");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    expect(await prisma.session.count({ where: { userId: leader.userId } })).toBeGreaterThan(0);

    await closeAccount(leader.userId);

    expect(await prisma.session.count({ where: { userId: leader.userId } })).toBe(0);
  });

  test("AND ASKING AGAIN DOES NOT MOVE THE DATE", async () => {
    // A second confirmation is not a new decision and must not restart a clock.
    const leader = await citizen("twice");
    const filer = await citizen("filer3");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    await closeAccount(leader.userId);
    const first = (
      await prisma.user.findUniqueOrThrow({
        where: { id: leader.userId },
        select: { deletionRequestedAt: true },
      })
    ).deletionRequestedAt;

    await closeAccount(leader.userId);
    const second = (
      await prisma.user.findUniqueOrThrow({
        where: { id: leader.userId },
        select: { deletionRequestedAt: true },
      })
    ).deletionRequestedAt;

    expect(second?.toISOString()).toBe(first?.toISOString());
  });
});

describe("what does NOT hold an account", () => {
  test("a concluded impeachment lets them go straight away", async () => {
    const leader = await citizen("cleared");
    const filer = await citizen("filer4");
    const proceeding = await openImpeachmentAgainst(leader.userId, filer.userId);
    await prisma.impeachment.update({
      where: { id: proceeding.id },
      data: { status: "failed", decidedAt: new Date() },
    });

    expect(await proceedingsHolding(leader.userId)).toEqual([]);

    const outcome = await closeAccount(leader.userId);
    expect(outcome.deleted).toBe(true);
  });

  test("a settled report lets them go straight away", async () => {
    const subject = await citizen("settled");
    const reporter = await citizen("reporter2");
    await prisma.report.create({
      data: {
        reporterId: reporter.userId,
        reportedUserId: subject.userId,
        reason: "harassment",
        status: "dismissed",
      },
    });

    expect(await proceedingsHolding(subject.userId)).toEqual([]);
  });
});

describe("the hold ends when the proceeding does", () => {
  test("THE SWEEP ERASES THEM, and not a moment before", async () => {
    const leader = await citizen("waiting");
    const filer = await citizen("filer5");
    const proceeding = await openImpeachmentAgainst(leader.userId, filer.userId);

    await closeAccount(leader.userId);

    // While it is open, the sweep leaves them exactly where they are.
    const first = await sweepClosedAccounts();
    expect(first.deleted).toBe(0);
    expect(first.stillHeld).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: leader.userId } })).not.toBeNull();

    // The proceeding is decided.
    await prisma.impeachment.update({
      where: { id: proceeding.id },
      data: { status: "failed", decidedAt: new Date() },
    });

    const second = await sweepClosedAccounts();
    expect(second.deleted).toBe(1);
    expect(second.failed).toEqual([]);

    // AND NOW THEY ARE REALLY GONE.
    expect(await prisma.user.findUnique({ where: { id: leader.userId } })).toBeNull();
  });

  test("the last one is what matters, not the first", async () => {
    // Two proceedings, closed one at a time. Nothing may be erased while any
    // one of them is still live.
    const leader = await citizen("twoheld");
    const filer = await citizen("filer6");
    const reporter = await citizen("reporter3");

    const impeachment = await openImpeachmentAgainst(leader.userId, filer.userId);
    const report = await prisma.report.create({
      data: {
        reporterId: reporter.userId,
        reportedUserId: leader.userId,
        reason: "harassment",
        status: "open",
      },
    });

    const outcome = await closeAccount(leader.userId);
    expect(outcome.held.length).toBe(2);

    await prisma.impeachment.update({
      where: { id: impeachment.id },
      data: { status: "failed", decidedAt: new Date() },
    });
    expect((await sweepClosedAccounts()).deleted).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: leader.userId } })).not.toBeNull();

    await prisma.report.update({
      where: { id: report.id },
      data: { status: "actioned", reviewedAt: new Date() },
    });
    expect((await sweepClosedAccounts()).deleted).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: leader.userId } })).toBeNull();
  });
});

describe("the closed account cannot act", () => {
  /**
   * THE SAME REQUEST, TWICE, so a rejection means what it says.
   *
   * The first version of this test posted a body the route rejected as
   * malformed. It came back 400 and the assertion read that as "the account
   * cannot act" — a test that would have passed just as happily if the hold did
   * nothing at all. Proving a block requires proving the identical request
   * WORKS for somebody who is not blocked.
   */
  // Editing your own bio: a write that needs no fixture, belongs to nobody else,
  // and has an outcome that can be read straight back out of the row.
  //
  // The first draft of this used POST /api/posts, which requires an attached
  // law — so it came back 400 for everybody, and without the control below that
  // 400 would have been recorded as proof of a block that was never tested.
  async function editBioAs(cookie: string, bio: string) {
    return fetch(`${BASE_URL}/api/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie, ...freshClientHeaders() },
      body: JSON.stringify({ bio }),
    });
  }

  test("the control: this exact request works for an ordinary account", async () => {
    const ordinary = await citizen("control");
    const response = await editBioAs(ordinary.cookie, "A bio somebody wrote.");
    expect(response.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: ordinary.userId },
      select: { bio: true },
    });
    expect(row.bio).toBe("A bio somebody wrote.");
  });

  test("A WRITE IS REFUSED, and nothing is written", async () => {
    /*
     * On the server, not in the screens. A rule the client enforces is bypassed
     * by a second tab — the same reasoning as middleware/sequestration.ts.
     */
    const leader = await citizen("frozen");
    const filer = await citizen("filer7");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    // Their own cookie, captured before the closing kills the session.
    const cookie = leader.cookie;
    await closeAccount(leader.userId);

    const write = await editBioAs(cookie, "Editing my way back in.");

    // 401 once the session is gone, 410 if a session somehow survives and
    // reaches the middleware. Both mean the account is unusable. 200 — which
    // the control above proves is what a working account gets — must never
    // happen here.
    expect(write.status).not.toBe(200);
    expect([401, 410]).toContain(write.status);

    // And nothing landed. The record is frozen where they left it, which is
    // what "read only" has to mean to be worth saying.
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: leader.userId },
      select: { bio: true },
    });
    expect(row.bio).not.toBe("Editing my way back in.");
  });

  test("THE PROFILE STAYS READABLE, and says it is closed", async () => {
    const leader = await citizen("readable");
    const filer = await citizen("filer8");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    await closeAccount(leader.userId);

    const response = await fetch(`${BASE_URL}/api/users/${leader.userId}`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);

    const profile = (await response.json()) as Record<string, unknown>;
    expect(profile.id).toBe(leader.userId);
    // The thing that stops a visitor reading a frozen page as a live one.
    expect(profile.closingAt).not.toBeNull();
  });
});

describe("an administrator is held by the same rule", () => {
  test("ARTICLE V §3 — no Officer may delete the accused out of a live case", async () => {
    /*
     * "No Proceeding under this Article may be halted, delayed or reversed by
     * any Officer, at any level of authority." A console delete mid-impeachment
     * is precisely that, so the admin door goes through closeAccount too.
     */
    const leader = await citizen("adminheld");
    const filer = await citizen("filer9");
    await openImpeachmentAgainst(leader.userId, filer.userId);

    const outcome = await closeAccount(leader.userId);

    expect(outcome.deleted).toBe(false);
    expect(await prisma.user.findUnique({ where: { id: leader.userId } })).not.toBeNull();
  });
});
