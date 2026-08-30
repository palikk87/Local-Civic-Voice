/**
 * LEAVING DOES NOT UNDO WHAT ALREADY HAPPENED — AND DOES NOT LEAVE A GAP.
 *
 * THE RULE, in the owner's words: "any account deletion removes all trace of
 * the user, but does not undo the results of their votes. So if they were on a
 * jury or voted to impeach or a system reset took effect that their vote was a
 * part of, it does not undo those actions once those proceedings are complete.
 * If they delete their account mid proceedings then their vote is removed — in
 * the case of a jury their vote is removed and a new juror is randomly
 * selected."
 *
 * Two halves, and both matter for different reasons.
 *
 * A FINISHED PROCEEDING keeps its result. Somebody leaving cannot retroactively
 * change a verdict other people took part in. That works because every
 * concluded proceeding writes its outcome onto its own row — Jury.verdict,
 * Impeachment.status, SystemReset.status — and none of them is recomputed from
 * the ballots afterwards. Asserted here rather than assumed, because the whole
 * rule rests on it.
 *
 * A RUNNING JURY gets a new juror. Without that, a five-seat panel needing
 * three votes silently becomes a four-seat panel needing three, and one
 * person's departure raises the bar for everyone still sitting. The
 * replacement uses the same random draw a recusal does, so a departure and a
 * step-aside look identical to the case.
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
import { deleteAccount } from "../src/services/account-deletion";

const PASSWORD = "test-password-not-a-real-one";
const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
async function citizen(label = "person") {
  seq += 1;
  return signUp({
    email: `${label}-deletion-${seq}@example.com`,
    password: PASSWORD,
    name: `${label} ${seq}`,
  });
}

let refSeq = 0;
/** The same bar the jury draw uses. Age is backdated; the rest is real rows. */
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
    refSeq += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `deletion-${refSeq}-119`,
        referenceType: "bill",
        title: `Track record ${refSeq}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: row.id, userId, position: "support" },
    });
  }
}

async function pool(size: number) {
  const people = [];
  for (let i = 0; i < size; i += 1) {
    const person = await citizen("pool");
    await makeEligible(person.userId);
    people.push(person);
  }
  return people;
}

async function fileReport(cookie: string, postId: string) {
  const response = await fetch(`${BASE_URL}/api/safety/reports`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({
      postId,
      reason: "misinformation",
      detail: "This misstates what the bill actually says.",
    }),
  });
  return (await response.json()) as Record<string, unknown>;
}

/** A drawn jury, and the people actually sitting on it. */
async function empanelled() {
  const author = await citizen("author");
  const reporter = await citizen("reporter");
  await pool(9);
  const written = await prisma.post.create({
    data: { authorId: author.userId, content: "A post somebody took exception to." },
  });
  const filed = await fileReport(reporter.cookie, written.id);
  const juryId = filed.juryId as string;

  const seats = await prisma.jurySeat.findMany({
    where: { juryId },
    select: { id: true, jurorId: true, state: true },
  });
  return { juryId, seats };
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

describe("leaving a jury that is still sitting", () => {
  test("A REPLACEMENT JUROR IS DRAWN, so the panel does not shrink", async () => {
    const { juryId, seats } = await empanelled();
    expect(seats.length).toBeGreaterThan(0);

    const leaving = seats[0]!;
    const before = await prisma.jurySeat.count({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
    });

    await deleteAccount(leaving.jurorId);

    const after = await prisma.jurySeat.count({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
    });

    // The bar for a verdict is an absolute number of votes, so a panel that
    // quietly loses a seat makes every remaining juror's vote count for more
    // than the case was drawn to need.
    expect(after).toBe(before);
  });

  test("and the replacement records which seat it replaced", async () => {
    const { juryId, seats } = await empanelled();
    const leaving = seats[0]!;

    await deleteAccount(leaving.jurorId);

    const replacement = await prisma.jurySeat.findFirst({
      where: { juryId, replacesSeatId: leaving.id },
    });
    // A redraw nobody can trace is a redraw nobody can check.
    expect(replacement).not.toBeNull();
  });

  test("and it is not the person who left", async () => {
    const { juryId, seats } = await empanelled();
    const leaving = seats[0]!;

    await deleteAccount(leaving.jurorId);

    const still = await prisma.jurySeat.count({
      where: { juryId, jurorId: leaving.jurorId },
    });
    expect(still).toBe(0);
  });
});

describe("leaving after a jury has finished", () => {
  test("THE VERDICT STANDS", async () => {
    const { juryId, seats } = await empanelled();

    // Decide it the way settle() does: the outcome is written onto the jury.
    await prisma.jury.update({
      where: { id: juryId },
      data: { status: "decided", verdict: "upheld", decidedAt: new Date() },
    });

    await deleteAccount(seats[0]!.jurorId);

    const jury = await prisma.jury.findUnique({ where: { id: juryId } });
    expect(jury?.status).toBe("decided");
    expect(jury?.verdict).toBe("upheld");
  });

  test("and no replacement is drawn for a case that is over", async () => {
    const { juryId, seats } = await empanelled();
    await prisma.jury.update({
      where: { id: juryId },
      data: { status: "decided", verdict: "dismissed", decidedAt: new Date() },
    });

    const before = await prisma.jurySeat.count({ where: { juryId } });
    await deleteAccount(seats[0]!.jurorId);
    const after = await prisma.jurySeat.count({ where: { juryId } });

    // One seat leaves with the account and nothing is drawn to replace it.
    // Summoning somebody to a case that has already been decided would be
    // asking a person to do work that cannot matter.
    expect(after).toBe(before - 1);
  });
});

describe("leaving mid impeachment", () => {
  test("THE BALLOT IS PULLED FROM AN OPEN PROCEEDING", async () => {
    const leader = await citizen("leader");
    const filer = await citizen("filer");
    const voter = await citizen("voter");

    // THREE PEOPLE, NOT TWO, AND THE THIRD IS THE POINT. The first version had
    // the voter file it as well, and deleting them took the whole proceeding
    // with them — Impeachment.filedById cascades from User. That masked what
    // this test is for and revealed something else worth knowing: if the person
    // who FILED an impeachment leaves, the proceeding disappears even though
    // other people have voted in it. Not changed here, because it is a
    // different decision from the one that was made, and it is written up.
    const impeachment = await prisma.impeachment.create({
      data: {
        leaderId: leader.userId,
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "open",
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });
    await prisma.impeachmentElector.create({
      data: { impeachmentId: impeachment.id, voterId: voter.userId, votedAt: new Date() },
    });

    await deleteAccount(voter.userId);

    const left = await prisma.impeachmentElector.count({
      where: { impeachmentId: impeachment.id },
    });
    expect(left).toBe(0);

    // The proceeding itself is untouched — it is somebody else's, and it goes
    // on with one fewer voter and a threshold that recalculates honestly.
    const still = await prisma.impeachment.findUnique({ where: { id: impeachment.id } });
    expect(still?.status).toBe("open");
  });
});

describe("the person who FILED a proceeding leaves", () => {
  /**
   * THE DECISION, in the owner's words: "proceedings may survive but everyone
   * that's got a right to vote in the proceedings is notified that the filer
   * has deleted their profile."
   *
   * It used to cascade. Closing the filer's account deleted the articles, the
   * evidence and every elector's vote in them — one person walking away
   * erasing other people's participation in a constitutional act they had
   * nothing to do with.
   */
  async function openImpeachment() {
    const leader = await citizen("leader");
    const filer = await citizen("filer");
    const elector = await citizen("elector");

    const impeachment = await prisma.impeachment.create({
      data: {
        leaderId: leader.userId,
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "open",
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });

    // Two electors: one who has voted, one who has not. The second is the
    // person this notice matters most to — they still have the decision in
    // front of them.
    await prisma.impeachmentElector.create({
      data: { impeachmentId: impeachment.id, voterId: elector.userId, votedAt: new Date() },
    });
    const undecided = await citizen("undecided");
    await prisma.impeachmentElector.create({
      data: { impeachmentId: impeachment.id, voterId: undecided.userId },
    });

    return { impeachment, filer, elector, undecided };
  }

  test("THE PROCEEDING SURVIVES THEM", async () => {
    const { impeachment, filer } = await openImpeachment();

    await deleteAccount(filer.userId);

    const still = await prisma.impeachment.findUnique({ where: { id: impeachment.id } });
    expect(still).not.toBeNull();
    expect(still?.status).toBe("open");
    // The articles are unchanged. Only the person who brought them is gone.
    expect(still?.grounds).toBe("A reason somebody gave.");
    expect(still?.evidence).toBe("What was pointed at.");
  });

  test("with the filer's name off it", async () => {
    const { impeachment, filer } = await openImpeachment();
    await deleteAccount(filer.userId);

    const still = await prisma.impeachment.findUnique({ where: { id: impeachment.id } });
    expect(still?.filedById).toBeNull();
  });

  test("AND EVERY ELECTOR'S VOTE SURVIVES TOO", async () => {
    // The thing the cascade destroyed. Other people's participation is not the
    // filer's to take with them.
    const { impeachment, filer } = await openImpeachment();
    await deleteAccount(filer.userId);

    const electors = await prisma.impeachmentElector.count({
      where: { impeachmentId: impeachment.id },
    });
    expect(electors).toBe(2);
  });

  test("AND EVERYONE ENTITLED TO VOTE IS TOLD", async () => {
    const { filer, elector, undecided } = await openImpeachment();
    await deleteAccount(filer.userId);

    for (const person of [elector, undecided]) {
      const told = await prisma.notification.count({
        where: { userId: person.userId, type: "filer_left" },
      });
      expect(told).toBe(1);
    }
  });

  test("AND IT NAMES THEM, because the filing was public", async () => {
    /*
     * Article V's own rule, from routes/impeachments.ts: "THE ARTICLES ARE
     * PUBLIC. A charge brought in secret, decided by a private electorate, is
     * exactly the concentration of power Article V exists to break. The vote is
     * restricted; the accusation is not."
     *
     * The electors could already see who filed. Withholding the name in the
     * notice would protect nothing and would only make it harder to place
     * against the articles they have been reading. The owner's rule: "if it's
     * publicly viewable then name them in the notification."
     */
    const { filer } = await openImpeachment();

    // Sign-up takes an email and a name; a username is set afterwards. This
    // gives the filer the public handle a real one would have, because the
    // handle is the whole point of this test.
    await prisma.user.update({
      where: { id: filer.userId },
      data: { username: "publicfiler", displayUsername: "publicfiler" },
    });
    const handle = "@publicfiler";

    await deleteAccount(filer.userId);

    const notices = await prisma.notification.findMany({ where: { type: "filer_left" } });
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(`${notice.title} ${notice.body}`).toContain(handle);
    }
  });

  test("AND WHEN THEY HAD NO PUBLIC HANDLE, IT INVENTS NONE", async () => {
    /*
     * publicHandle() never returns null — with no username it builds
     * "citizen-<last six of the id>". That is a derived identifier rather than
     * a name anybody knows them by, and writing it into a notification that
     * outlives the account would leave a fragment of a deleted person's id
     * standing in the database forever.
     *
     * A real handle was already public. A generated stand-in never was.
     */
    const { filer } = await openImpeachment();
    const id = filer.userId;
    expect(
      (await prisma.user.findUnique({ where: { id }, select: { username: true } }))?.username,
    ).toBeFalsy();

    await deleteAccount(id);

    const notices = await prisma.notification.findMany({ where: { type: "filer_left" } });
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      const text = `${notice.title} ${notice.body}`;
      expect(text).toContain("The person who filed");
      expect(text).not.toContain("citizen-");
      // Not one character of the departed id, either.
      expect(text).not.toContain(id.slice(-6));
    }
  });

  test("and it says DELETED THEIR PROFILE, not a softer word", async () => {
    // "Left" and "closed their account" are softer words for a different
    // thing. Deleting a profile here is irreversible and total, and an elector
    // deciding what to make of it needs the accurate verb.
    const { filer } = await openImpeachment();
    await deleteAccount(filer.userId);

    const notices = await prisma.notification.findMany({ where: { type: "filer_left" } });
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(`${notice.title} ${notice.body}`.toLowerCase()).toContain("deleted their profile");
    }
  });

  test("and it says the articles and the vote are unchanged", async () => {
    // The notice exists to inform, not to unsettle. Somebody told the filer is
    // gone will wonder whether their own vote still counts, and the answer is
    // on the same screen rather than a question they have to go and ask.
    const { filer } = await openImpeachment();
    await deleteAccount(filer.userId);

    const notice = await prisma.notification.findFirst({ where: { type: "filer_left" } });
    expect(notice?.body.toLowerCase()).toContain("unchanged");
    expect(notice?.body.toLowerCase()).toContain("stand");
  });

  test("a proceeding that is already over sends nobody a notice", async () => {
    // Telling people the origin of a decided case has changed is noise about
    // something they can no longer act on.
    const leader = await citizen("leader");
    const filer = await citizen("filer");
    const elector = await citizen("elector");

    const impeachment = await prisma.impeachment.create({
      data: {
        leaderId: leader.userId,
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "expired",
        expiresAt: new Date(Date.now() - DAY),
        decidedAt: new Date(Date.now() - DAY),
      },
    });
    await prisma.impeachmentElector.create({
      data: { impeachmentId: impeachment.id, voterId: elector.userId },
    });

    await deleteAccount(filer.userId);

    const told = await prisma.notification.count({
      where: { userId: elector.userId, type: "filer_left" },
    });
    expect(told).toBe(0);

    // And it still stands, with the name off it.
    const still = await prisma.impeachment.findUnique({ where: { id: impeachment.id } });
    expect(still?.status).toBe("expired");
    expect(still?.filedById).toBeNull();
  });
});

describe("the person who FILED A SYSTEM RESET leaves mid vote", () => {
  /**
   * The same rule as an impeachment, applied to the other Article V
   * proceeding: "proceedings may survive but everyone that's got a right to
   * vote in the proceedings is notified that the filer has deleted their
   * profile."
   *
   * A reset has no elector roster — every account is entitled to vote — so
   * "everyone with a right to vote" cannot be listed. The notice goes to
   * everybody who has actually cast a ballot: the people with something at
   * stake in this vote, and the only ones the system can name.
   */
  async function openReset() {
    const filer = await citizen("resetfiler");
    const backer = await citizen("resetbacker");
    const objector = await citizen("resetobjector");

    const reset = await prisma.systemReset.create({
      data: {
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "voting",
        eligibleCount: 3,
        expiresAt: new Date(Date.now() + 7 * DAY),
      },
    });

    // One for, one against. The notice is not a recruiting message — it goes
    // to both sides, because both are voting on the same articles.
    for (const [person, support] of [
      [filer, true],
      [backer, true],
      [objector, false],
    ] as const) {
      await prisma.systemResetBallot.create({
        data: { resetId: reset.id, voterId: person.userId, support },
      });
    }

    return { reset, filer, backer, objector };
  }

  test("THE RESET SURVIVES THEM, articles and all", async () => {
    const { reset, filer } = await openReset();

    await deleteAccount(filer.userId);

    const still = await prisma.systemReset.findUnique({ where: { id: reset.id } });
    expect(still).not.toBeNull();
    expect(still?.status).toBe("voting");
    expect(still?.grounds).toBe("A reason somebody gave.");
    expect(still?.evidence).toBe("What was pointed at.");
  });

  test("with the filer's name off it", async () => {
    // The column had no foreign key, which kept the reset safe and also meant
    // nothing ever cleared it. A departed account's id used to sit here for
    // good — a trace of somebody who asked for every trace to go.
    const { reset, filer } = await openReset();
    await deleteAccount(filer.userId);

    const still = await prisma.systemReset.findUnique({ where: { id: reset.id } });
    expect(still?.filedById).toBeNull();
  });

  test("AND EVERY OTHER BALLOT SURVIVES", async () => {
    const { reset, filer } = await openReset();
    await deleteAccount(filer.userId);

    // Three were cast. The filer's comes out; the other two are not theirs to
    // take.
    const ballots = await prisma.systemResetBallot.findMany({
      where: { resetId: reset.id },
      select: { voterId: true },
    });
    expect(ballots.length).toBe(2);
    expect(ballots.some((ballot) => ballot.voterId === filer.userId)).toBe(false);
  });

  test("AND EVERYONE WITH A BALLOT IN IT IS TOLD", async () => {
    const { filer, backer, objector } = await openReset();
    await deleteAccount(filer.userId);

    for (const person of [backer, objector]) {
      const told = await prisma.notification.count({
        where: { userId: person.userId, type: "filer_left" },
      });
      expect(told).toBe(1);
    }
  });

  test("AND THE NOTICE SAYS THEY DELETED THEIR PROFILE, not that they left", async () => {
    /*
     * The owner's correction, in their words: "Not just they left that they
     * deleted their profile." Somebody stepping back from a proceeding and
     * somebody erasing their account are different facts, and the people still
     * voting are entitled to the second one.
     */
    const { filer, backer } = await openReset();
    await prisma.user.update({
      where: { id: filer.userId },
      data: { username: "resetfiler" },
    });

    await deleteAccount(filer.userId);

    const notice = await prisma.notification.findFirst({
      where: { userId: backer.userId, type: "filer_left" },
    });
    expect(notice?.title).toBe("@resetfiler deleted their profile");
    // The articles of a reset are shown to every voter before they vote, so
    // the filing is public and the notice names them. Same rule as Article V
    // impeachment: the vote is restricted, the accusation is not.
    expect(notice?.title).toContain("resetfiler");
  });

  test("AND NOBODY IS TOLD ABOUT A RESET THAT IS ALREADY DECIDED", async () => {
    // Nothing left to decide, so there is no decision to inform. The outcome
    // stands either way.
    const filer = await citizen("donefiler");
    const backer = await citizen("donebacker");

    const reset = await prisma.systemReset.create({
      data: {
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "executed",
        eligibleCount: 2,
        expiresAt: new Date(Date.now() - DAY),
        decidedAt: new Date(Date.now() - DAY),
        executedAt: new Date(Date.now() - DAY),
      },
    });
    await prisma.systemResetBallot.create({
      data: { resetId: reset.id, voterId: backer.userId, support: true },
    });

    await deleteAccount(filer.userId);

    const told = await prisma.notification.count({
      where: { userId: backer.userId, type: "filer_left" },
    });
    expect(told).toBe(0);

    // But the name still comes off the concluded reset.
    const still = await prisma.systemReset.findUnique({ where: { id: reset.id } });
    expect(still?.filedById).toBeNull();
    expect(still?.status).toBe("executed");
  });
});

describe("leaving after a system reset has run", () => {
  test("THE RESET IS NOT UNDONE", async () => {
    const filer = await citizen("filer");

    const reset = await prisma.systemReset.create({
      data: {
        filedById: filer.userId,
        grounds: "A reason somebody gave.",
        evidence: "What was pointed at.",
        status: "executed",
        // How many people were entitled to vote when it was filed. Frozen, so
        // somebody leaving afterwards cannot change the threshold a concluded
        // reset was measured against — which is the rule under test.
        eligibleCount: 3,
        expiresAt: new Date(Date.now() - DAY),
        decidedAt: new Date(Date.now() - DAY),
        executedAt: new Date(Date.now() - DAY),
      },
    });
    await prisma.systemResetBallot.create({
      data: { resetId: reset.id, voterId: filer.userId, support: true },
    });

    await deleteAccount(filer.userId);

    const still = await prisma.systemReset.findUnique({ where: { id: reset.id } });
    expect(still?.status).toBe("executed");
    expect(still?.executedAt).not.toBeNull();

    // Their name comes off it. The reset having happened is a fact about the
    // platform; who voted for it is a fact about them.
    const ballots = await prisma.systemResetBallot.count({ where: { voterId: filer.userId } });
    expect(ballots).toBe(0);
  });
});
