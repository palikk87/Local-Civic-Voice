/**
 * ARTICLE V — THE SYSTEM-WIDE RESET, HELD TO ITS OWN RULES.
 *
 * The page this replaces had a hardcoded reset vote on it: "12,450 for, 45,230
 * against, 94,000 eligible", none of which had ever existed. The bar here is
 * that every rule the platform states about a reset is demonstrably true of a
 * real server, real Postgres, real HTTP.
 *
 * The rules under test:
 *   - A majority of the platform must turn out, AND two thirds of those must
 *     agree. Either bar alone is not enough.
 *   - Only accounts that existed when the vote opened may vote.
 *   - One reset at a time, platform-wide.
 *   - It does NOT run when the vote closes. It runs 48 hours later, after
 *     everybody has been told what is about to be lost.
 *   - Executing ends every delegation and deletes every vote — and leaves
 *     PositionEvent completely untouched.
 *   - A citizen can put back their OWN positions, and only their own.
 *   - The whole thing is reversible from a journal written inside the same
 *     transaction that did the damage.
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
import {
  decideExpiredResets,
  executeSystemReset,
  resetPasses,
  restoreMyPositions,
  sweepDueResets,
  undoSystemReset,
  RESET_APPROVAL_THRESHOLD,
  RESET_DISCLOSURE,
  RESET_PARTICIPATION_FLOOR,
} from "../src/services/system-reset";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  // SystemReset has no foreign key to User — a proceeding affecting every
  // account must not vanish with its filer — so TRUNCATE ... CASCADE on User
  // does not reach it. Cleared explicitly.
  await prisma.systemReset.deleteMany({});
});

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
async function body(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}

let seq = 0;
let refCounter = 0;

function freshReferenceId(): string {
  refCounter += 1;
  return `sr-${9000 + refCounter}-119`;
}

async function citizen(label: string) {
  seq += 1;
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-population-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

async function reference(title = "A bill") {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: freshReferenceId(),
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

const GROUNDS =
  "The delegation graph has collapsed into a handful of accounts carrying almost every " +
  "vote on the platform, and no ordinary remedy reaches it.";
const EVIDENCE =
  "The published delegate list shows four accounts holding a majority of active delegations " +
  "between them, across every category, for the last two months.";

function fileReset(cookie: string, grounds = GROUNDS, evidence = EVIDENCE) {
  return fetch(`${BASE_URL}/api/system-reset`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ grounds, evidence }),
  });
}

function ballot(cookie: string, resetId: string, support: boolean) {
  return fetch(`${BASE_URL}/api/system-reset/${resetId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ support }),
  });
}

function castVote(cookie: string, referenceId: string, position: "support" | "oppose") {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ position }),
  });
}

/** Close the vote and run the 48-hour clock down, without waiting two weeks. */
async function windTheClockForward(resetId: string) {
  await prisma.systemReset.update({
    where: { id: resetId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await decideExpiredResets();
  await prisma.systemReset.updateMany({
    where: { id: resetId, status: "scheduled" },
    data: { executeAfter: new Date(Date.now() - 1000) },
  });
}

describe("system reset: the two bars", () => {
  test("the thresholds are the ones the Constitution states", async () => {
    const source = await Bun.file(
      new URL("../../packages/civic-core/src/constitution.ts", import.meta.url).pathname
    ).text();
    expect(Number(source.match(/SYSTEM_RESET_THRESHOLD = ([0-9.]+)/)?.[1])).toBe(
      RESET_APPROVAL_THRESHOLD
    );
    expect(source).toContain("if (participation < 0.5) return false;");
    expect(RESET_PARTICIPATION_FLOOR).toBe(0.5);
  });

  test("approval without turnout is not enough", () => {
    // Everybody who voted agreed, but only a fifth of the platform turned up.
    expect(resetPasses({ support: 20, oppose: 0, eligibleCount: 100 })).toBe(false);
  });

  test("turnout without approval is not enough", () => {
    expect(resetPasses({ support: 40, oppose: 40, eligibleCount: 100 })).toBe(false);
  });

  test("both bars together pass it", () => {
    expect(resetPasses({ support: 40, oppose: 20, eligibleCount: 100 })).toBe(true);
  });

  test("nobody voting does not pass a reset", () => {
    expect(resetPasses({ support: 0, oppose: 0, eligibleCount: 100 })).toBe(false);
  });
});

describe("system reset: bringing one", () => {
  test("a verified account can file, and every account is told", async () => {
    const filer = await citizen("filer");
    const other = await citizen("other");

    const response = await fileReset(filer.cookie);
    expect(response.status).toBe(201);

    const filed = await body(response);
    expect(filed.eligibleCount).toBeGreaterThanOrEqual(2);

    // Everybody, including the person who brought it.
    const told = await prisma.notification.count({ where: { type: "system_reset_opened" } });
    expect(told).toBeGreaterThanOrEqual(2);
    expect(
      await prisma.notification.count({
        where: { type: "system_reset_opened", userId: other.userId },
      })
    ).toBe(1);
  });

  test("a second reset is refused while one is standing", async () => {
    const first = await citizen("first");
    const second = await citizen("second");
    expect((await fileReset(first.cookie)).status).toBe(201);

    const response = await fileReset(second.cookie);
    expect(response.status).toBe(409);
    expect((await body(response)).code).toBe("already_open");
    expect(await prisma.systemReset.count()).toBe(1);
  });

  test("articles that say nothing are refused", async () => {
    const filer = await citizen("filer");
    expect((await fileReset(filer.cookie, "no", "reason")).status).toBe(400);
    expect(await prisma.systemReset.count()).toBe(0);
  });
});

describe("system reset: who may vote", () => {
  test("AN ACCOUNT CREATED AFTER THE FILING HAS NO BALLOT", async () => {
    // The same anti-malice rule as impeachment's frozen electorate. Two weeks
    // is long enough to register a great many accounts, and a reset decided by
    // accounts created to decide it is not the platform deciding.
    const filer = await citizen("filer");
    const filed = await body(await fileReset(filer.cookie));

    const latecomer = await citizen("latecomer");
    const response = await ballot(latecomer.cookie, filed.resetId, true);
    expect(response.status).toBe(403);
    expect((await body(response)).code).toBe("not_eligible");
  });

  test("one account, one ballot", async () => {
    const filer = await citizen("filer");
    const voter = await citizen("voter");
    const filed = await body(await fileReset(filer.cookie));

    expect((await ballot(voter.cookie, filed.resetId, true)).status).toBe(200);
    const again = await ballot(voter.cookie, filed.resetId, false);
    expect(again.status).toBe(400);
    expect((await body(again)).code).toBe("already_voted");
  });

  test("a ballot can be withdrawn while the window is open", async () => {
    const filer = await citizen("filer");
    const voter = await citizen("voter");
    const filed = await body(await fileReset(filer.cookie));

    await ballot(voter.cookie, filed.resetId, true);
    const withdrawn = await fetch(`${BASE_URL}/api/system-reset/${filed.resetId}/vote`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie: voter.cookie }),
    });
    expect(withdrawn.status).toBe(200);
    expect((await body(withdrawn)).support).toBe(0);
  });

  test("a banned account cannot vote on the reset either", async () => {
    const filer = await citizen("filer");
    const banned = await citizen("banned");
    const filed = await body(await fileReset(filer.cookie));

    await prisma.user.update({
      where: { id: banned.userId },
      data: { banned: true, banReason: "test", bannedAt: new Date() },
    });

    const response = await ballot(banned.cookie, filed.resetId, true);
    expect(response.status).toBe(403);
  });
});

describe("system reset: full disclosure", () => {
  test("what a reset costs is in the response before anybody can vote", async () => {
    const response = await fetch(`${BASE_URL}/api/system-reset`);
    const payload = await body(response);

    expect(payload.disclosure.lost.length).toBeGreaterThan(0);
    expect(payload.disclosure.kept.length).toBeGreaterThan(0);
    expect(payload.disclosure.afterwards.length).toBeGreaterThan(0);

    // The two things that must be said, said.
    expect(payload.disclosure.lost.join(" ")).toContain("delegation");
    expect(payload.disclosure.kept.join(" ")).toContain("record");
  });

  test("the disclosure is there even when nothing is open", async () => {
    const payload = await body(await fetch(`${BASE_URL}/api/system-reset`));
    expect(payload.proceeding).toBeNull();
    expect(payload.disclosure).toEqual(RESET_DISCLOSURE);
  });

  test("the 48-hour notice says the same thing the voting screen said", async () => {
    const filer = await citizen("filer");
    const yes = await citizen("yes");
    const filed = await body(await fileReset(filer.cookie));

    await ballot(filer.cookie, filed.resetId, true);
    await ballot(yes.cookie, filed.resetId, true);

    await prisma.systemReset.update({
      where: { id: filed.resetId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await decideExpiredResets();

    const notice = await prisma.notification.findFirst({
      where: { type: "system_reset_scheduled" },
    });
    expect(notice).not.toBeNull();
    for (const line of RESET_DISCLOSURE.lost) expect(notice!.body).toContain(line);
    for (const line of RESET_DISCLOSURE.kept) expect(notice!.body).toContain(line);
  });
});

describe("system reset: the 48 hours", () => {
  test("[art5-sec2] IT DOES NOT RUN WHEN THE VOTE CLOSES", async () => {
    // Nobody loses their delegations to a vote that closed while they slept.
    const filer = await citizen("filer");
    const yes = await citizen("yes");
    const filed = await body(await fileReset(filer.cookie));
    await ballot(filer.cookie, filed.resetId, true);
    await ballot(yes.cookie, filed.resetId, true);

    await prisma.systemReset.update({
      where: { id: filed.resetId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await sweepDueResets();

    const row = await prisma.systemReset.findUniqueOrThrow({ where: { id: filed.resetId } });
    expect(row.status).toBe("scheduled");
    expect(row.executedAt).toBeNull();

    // And the clock it set is 48 hours, not a moment sooner.
    const gap = row.executeAfter!.getTime() - row.decidedAt!.getTime();
    expect(Math.round(gap / HOUR)).toBe(48);
  });

  test("executing before the notice period has elapsed does nothing", async () => {
    const filer = await citizen("filer");
    const yes = await citizen("yes");
    const filed = await body(await fileReset(filer.cookie));
    await ballot(filer.cookie, filed.resetId, true);
    await ballot(yes.cookie, filed.resetId, true);

    await prisma.systemReset.update({
      where: { id: filed.resetId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await decideExpiredResets();

    expect(await executeSystemReset(filed.resetId)).toBeNull();
    expect(
      (await prisma.systemReset.findUniqueOrThrow({ where: { id: filed.resetId } })).status
    ).toBe("scheduled");
  });

  test("a vote that did not pass fails, and nothing is destroyed", async () => {
    const filer = await citizen("filer");
    const no1 = await citizen("no");
    const no2 = await citizen("no");
    const filed = await body(await fileReset(filer.cookie));

    await ballot(filer.cookie, filed.resetId, true);
    await ballot(no1.cookie, filed.resetId, false);
    await ballot(no2.cookie, filed.resetId, false);

    await windTheClockForward(filed.resetId);
    await sweepDueResets();

    const row = await prisma.systemReset.findUniqueOrThrow({ where: { id: filed.resetId } });
    expect(row.status).toBe("failed");
    expect(row.executedAt).toBeNull();
    expect(await prisma.notification.count({ where: { type: "system_reset_settled" } })).toBeGreaterThan(0);
  });
});

describe("system reset: what executing it does", () => {
  /**
   * A platform with something to lose: two delegators, one delegate, votes on
   * the record and a personal history behind them.
   */
  async function platformWithHistory() {
    const leader = await citizen("leader");
    const followerA = await citizen("followerA");
    const followerB = await citizen("followerB");

    await prisma.user.update({
      where: { id: leader.userId },
      data: { createdAt: new Date(Date.now() - 30 * DAY) },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.post.create({
        data: { authorId: leader.userId, content: `Worth saying ${i}.` },
      });
    }
    for (let i = 0; i < 20; i += 1) {
      const row = await reference(`Track record ${i}`);
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: row.id, userId: leader.userId, position: "support" },
      });
    }

    for (const follower of [followerA, followerB]) {
      const response = await fetch(`${BASE_URL}/api/delegations`, {
        method: "POST",
        headers: freshClientHeaders({
          "Content-Type": "application/json",
          cookie: follower.cookie,
        }),
        body: JSON.stringify({ toUserId: leader.userId }),
      });
      expect(response.status).toBe(201);
    }

    const bill = await reference("The bill everybody voted on");
    expect((await castVote(followerA.cookie, bill.id, "support")).status).toBe(200);
    expect((await castVote(leader.cookie, bill.id, "oppose")).status).toBe(200);

    return { leader, followerA, followerB, bill };
  }

  /** Run a reset all the way through, from filing to executed. */
  async function runAReset(filerCookie: string, voters: { cookie: string }[]) {
    const filed = await body(await fileReset(filerCookie));
    for (const voter of voters) await ballot(voter.cookie, filed.resetId, true);
    await windTheClockForward(filed.resetId);
    const report = await executeSystemReset(filed.resetId);
    return { resetId: filed.resetId as string, report };
  }

  test("every delegation ends and every tally returns to zero", async () => {
    const { leader, followerA, followerB, bill } = await platformWithHistory();

    const before = await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } });
    // The leader's own vote plus the one delegation that did not vote directly.
    expect(before.opposeVotes).toBe(2);
    expect(before.supportVotes).toBe(1);

    const { report } = await runAReset(leader.cookie, [leader, followerA, followerB]);

    expect(report).not.toBeNull();
    expect(report!.delegationsEnded).toBe(2);
    expect(await prisma.delegation.count({ where: { isActive: true } })).toBe(0);
    expect(await prisma.governmentReferenceVote.count()).toBe(0);

    const after = await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } });
    expect({ support: after.supportVotes, oppose: after.opposeVotes }).toEqual({
      support: 0,
      oppose: 0,
    });
  });

  /**
   * WAIT FOR THE SETUP'S OWN WRITES TO LAND BEFORE COUNTING.
   *
   * castVote returns as soon as the vote is recorded; the PositionEvent that
   * goes with it is written fire-and-forget afterwards — tests/helpers/server.ts
   * has the note on why several writes here deliberately outlive their request.
   * So a count taken the instant setup returns can be one short, and the
   * missing row then arrives DURING the reset, where it looks exactly like the
   * reset having created one.
   *
   * That is precisely what happened in CI, on a run where nothing about this
   * behaviour had changed: `before` read 1, the count after read 2, and
   * positionEventsTouched was 0 — the reset had touched nothing at all. The
   * test only fails on a loaded machine, which is the worst kind of red build:
   * it looks like a regression and it is a stopwatch.
   *
   * Two identical reads in a row means the writes have stopped arriving.
   */
  async function positionEventsSettled(): Promise<number> {
    let previous = -1;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const now = await prisma.positionEvent.count();
      if (now > 0 && now === previous) return now;
      previous = now;
      await Bun.sleep(50);
    }
    return previous;
  }

  test("POSITIONEVENT IS NOT TOUCHED — every citizen keeps their own record", async () => {
    const { leader, followerA, followerB } = await platformWithHistory();

    const before = await positionEventsSettled();
    expect(before).toBeGreaterThan(0);

    const { report } = await runAReset(leader.cookie, [leader, followerA, followerB]);
    expect(report!.positionEventsTouched).toBe(0);
    expect(await prisma.positionEvent.count()).toBe(before);
  });

  test("nothing social is destroyed — accounts, posts and follows all stand", async () => {
    const { leader, followerA, followerB } = await platformWithHistory();
    await prisma.follow.create({
      data: { followerId: followerA.userId, followingId: leader.userId },
    });

    const users = await prisma.user.count();
    const posts = await prisma.post.count();

    await runAReset(leader.cookie, [leader, followerA, followerB]);

    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.post.count()).toBe(posts);
    expect(await prisma.follow.count()).toBe(1);
  });

  test("running it twice does nothing the second time", async () => {
    const { leader, followerA, followerB } = await platformWithHistory();
    const { resetId } = await runAReset(leader.cookie, [leader, followerA, followerB]);
    expect(await executeSystemReset(resetId)).toBeNull();
  });

  test("delegating again after a reset works — the bar was never on the person", async () => {
    const { leader, followerA, followerB } = await platformWithHistory();
    await runAReset(leader.cookie, [leader, followerA, followerB]);

    const response = await fetch(`${BASE_URL}/api/delegations`, {
      method: "POST",
      headers: freshClientHeaders({
        "Content-Type": "application/json",
        cookie: followerA.cookie,
      }),
      body: JSON.stringify({ toUserId: leader.userId }),
    });
    // The delegate's earned eligibility is measured on votes that a reset just
    // deleted, so this may honestly be refused — but never with a 500, and
    // never with the reset given as the reason.
    expect([201, 400]).toContain(response.status);
    if (response.status === 400) {
      expect(JSON.stringify(await body(response))).not.toContain("reset");
    }
  });
});

describe("system reset: putting your own voice back", () => {
  async function twoCitizensWithVotes() {
    const alice = await citizen("alice");
    const bob = await citizen("bob");
    const one = await reference("Bill one");
    const two = await reference("Bill two");

    await castVote(alice.cookie, one.id, "support");
    await castVote(alice.cookie, two.id, "oppose");
    await castVote(bob.cookie, one.id, "oppose");

    const filed = await body(await fileReset(alice.cookie));
    await ballot(alice.cookie, filed.resetId, true);
    await ballot(bob.cookie, filed.resetId, true);
    await windTheClockForward(filed.resetId);
    await executeSystemReset(filed.resetId);

    return { alice, bob, one, two };
  }

  test("you get back exactly your own positions, and nobody else's", async () => {
    const { alice, bob } = await twoCitizensWithVotes();

    const restored = await restoreMyPositions(alice.userId);
    expect(restored.restored).toBe(2);

    const mine = await prisma.governmentReferenceVote.findMany({
      select: { userId: true },
    });
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((row) => row.userId))).toEqual(new Set([alice.userId]));

    // Bob's vote did not come back on Alice's action.
    expect(
      await prisma.governmentReferenceVote.count({ where: { userId: bob.userId } })
    ).toBe(0);
  });

  test("restoring twice does not double anything", async () => {
    const { alice } = await twoCitizensWithVotes();
    await restoreMyPositions(alice.userId);
    const second = await restoreMyPositions(alice.userId);

    expect(second.restored).toBe(0);
    expect(await prisma.governmentReferenceVote.count({ where: { userId: alice.userId } })).toBe(2);
  });

  test("a position you have cast again since the reset is left alone", async () => {
    const { alice, one } = await twoCitizensWithVotes();

    // She changed her mind after the reset. The newer act is the truer one.
    await castVote(alice.cookie, one.id, "oppose");

    const restored = await restoreMyPositions(alice.userId);
    expect(restored.skipped).toBe(1);
    expect(restored.restored).toBe(1);

    const current = await prisma.governmentReferenceVote.findFirstOrThrow({
      where: { userId: alice.userId, governmentReferenceId: one.id },
    });
    expect(current.position).toBe("oppose");
  });

  test("the tallies come back with the positions", async () => {
    const { alice, one } = await twoCitizensWithVotes();
    await restoreMyPositions(alice.userId);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: one.id } });
    expect(row.supportVotes).toBe(1);
  });

  test("the endpoint says how much there is to put back, honestly", async () => {
    const { alice } = await twoCitizensWithVotes();

    const response = await fetch(`${BASE_URL}/api/system-reset/my-restorable`, {
      headers: freshClientHeaders({ cookie: alice.cookie }),
    });
    const payload = await body(response);
    expect(payload.available).toBe(2);
    expect(payload.restored).toBe(0);
    expect(payload.reset.id).toBeTruthy();
  });

  test("with no reset ever run, it says nothing rather than zero", async () => {
    const alone = await citizen("alone");
    const payload = await body(
      await fetch(`${BASE_URL}/api/system-reset/my-restorable`, {
        headers: freshClientHeaders({ cookie: alone.cookie }),
      })
    );
    expect(payload.reset).toBeNull();
    expect(payload.available).toBe(0);
  });
});

describe("system reset: it can be put back", () => {
  async function anExecutedReset() {
    const leader = await citizen("leader");
    const follower = await citizen("follower");

    await prisma.user.update({
      where: { id: leader.userId },
      data: { createdAt: new Date(Date.now() - 30 * DAY) },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.post.create({ data: { authorId: leader.userId, content: `Post ${i}.` } });
    }
    for (let i = 0; i < 20; i += 1) {
      const row = await reference(`Record ${i}`);
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: row.id, userId: leader.userId, position: "support" },
      });
    }

    const delegated = await fetch(`${BASE_URL}/api/delegations`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: follower.cookie }),
      body: JSON.stringify({ toUserId: leader.userId }),
    });
    expect(delegated.status).toBe(201);

    const bill = await reference("The one that matters");
    await castVote(leader.cookie, bill.id, "support");

    const votesBefore = await prisma.governmentReferenceVote.count();
    const delegationsBefore = await prisma.delegation.count({ where: { isActive: true } });

    const filed = await body(await fileReset(leader.cookie));
    await ballot(leader.cookie, filed.resetId, true);
    await ballot(follower.cookie, filed.resetId, true);
    await windTheClockForward(filed.resetId);
    await executeSystemReset(filed.resetId);

    return { resetId: filed.resetId as string, bill, votesBefore, delegationsBefore };
  }

  test("undo restores every delegation and every vote, by id", async () => {
    const { resetId, votesBefore, delegationsBefore } = await anExecutedReset();

    expect(await prisma.governmentReferenceVote.count()).toBe(0);

    const report = await undoSystemReset(resetId, "owner");
    expect(report.delegationsRestored).toBe(delegationsBefore);
    expect(report.votesRestored).toBe(votesBefore);

    expect(await prisma.governmentReferenceVote.count()).toBe(votesBefore);
    expect(await prisma.delegation.count({ where: { isActive: true } })).toBe(delegationsBefore);
  });

  test("undo RECOMPUTES the tallies rather than trusting a stored number", async () => {
    const { resetId, bill } = await anExecutedReset();
    await undoSystemReset(resetId, "owner");

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } });
    // The leader's own vote plus the delegation that came back with it.
    expect(row.supportVotes).toBe(2);
  });

  test("undo refuses to replay", async () => {
    const { resetId } = await anExecutedReset();
    await undoSystemReset(resetId, "owner");
    await expect(undoSystemReset(resetId, "owner")).rejects.toThrow(/already been put back/);
  });

  test("a reset that has not run cannot be undone", async () => {
    const filer = await citizen("filer");
    const filed = await body(await fileReset(filer.cookie));
    await expect(undoSystemReset(filed.resetId, "owner")).rejects.toThrow(/not been executed/);
  });

  test("undo is recorded with a name against it", async () => {
    const { resetId } = await anExecutedReset();
    await undoSystemReset(resetId, "the.owner");

    const row = await prisma.systemReset.findUniqueOrThrow({ where: { id: resetId } });
    expect(row.revertedBy).toBe("the.owner");
    expect(row.revertedAt).not.toBeNull();
  });
});

describe("system reset: nobody can stop it", () => {
  test("[art5-sec3] no route stops, pauses or overturns a proceeding that has not run", async () => {
    // The only thing allowed to touch a SystemReset row outside the service is
    // the owner's undo of one that has ALREADY executed, and that lives in
    // admin.ts guarded by its own capability. Nothing may cancel one in flight.
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const routesDir = join(import.meta.dir, "..", "src", "routes");

    const offenders: string[] = [];
    for (const file of readdirSync(routesDir).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(routesDir, file), "utf8");
      if (/prisma\.systemReset\.(update|updateMany|delete|deleteMany)/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
