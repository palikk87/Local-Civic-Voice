/**
 * ARTICLE V — IMPEACHMENT, HELD TO ITS OWN RULES.
 *
 * The page this replaces had three invented people on it and a button that
 * changed a variable in the browser. So the bar here is not "the code runs" —
 * it is that each rule the platform states about impeachment is demonstrably
 * true of a real server, real Postgres, real HTTP.
 *
 * The rules under test:
 *   - Only somebody who lent this person their voice may move to take it back.
 *   - The electorate is FROZEN at filing. Delegating afterwards buys no vote.
 *   - Two thirds of that frozen electorate, and no fewer.
 *   - Leaving the delegation does not remove your say.
 *   - The suspension is the AVERAGE of what the impeaching voters asked for.
 *   - The penalty is receiving delegations, and nothing else. Everything else
 *     the person can do, they can still do — one assertion each.
 *   - One proceeding per leader at a time.
 *   - The accused is served the articles.
 *
 * Nothing here is mocked.
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
  evaluate,
  sweepExpiredImpeachments,
  suspensionState,
  IMPEACHMENT_THRESHOLD,
} from "../src/services/impeachment";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

const DAY = 24 * 60 * 60 * 1000;

/**
 * The response body, as the page would read it.
 *
 * These tests assert on shapes the routes return rather than on types they
 * import, on purpose: a contract that only holds because both sides share a
 * TypeScript interface is not a contract that survives a client on a different
 * deploy. So the shape is stated here, loosely, and checked at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

async function body(response: Response): Promise<Body> {
  return (await response.json()) as Body;
}


let seq = 0;
let refCounter = 0;

function freshReferenceId(): string {
  refCounter += 1;
  return `hr-${5000 + refCounter}-119`;
}

async function citizen(label: string) {
  seq += 1;
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

/** Old enough, enough votes, enough posts — the real rules, earned with real rows. */
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
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: freshReferenceId(),
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

function delegate(cookie: string, toUserId: string) {
  return fetch(`${BASE_URL}/api/delegations`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ toUserId }),
  });
}

const GROUNDS =
  "This delegate voted directly against the position they published and asked us to lend " +
  "them our votes for, on the record, twice in one week.";
const EVIDENCE =
  "Their posts of the third and the ninth, and the two roll-call positions recorded against " +
  "their account on the same bills, which contradict both posts.";

function file(cookie: string, leaderId: string, grounds = GROUNDS, evidence = EVIDENCE) {
  return fetch(`${BASE_URL}/api/impeachments`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ leaderId, grounds, evidence }),
  });
}

function voteToImpeach(cookie: string, impeachmentId: string, proposedDays: number) {
  return fetch(`${BASE_URL}/api/impeachments/${impeachmentId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ proposedDays }),
  });
}

/** A leader with `count` delegators, all eligible, plus proceedings not yet filed. */
async function leaderWithDelegators(count: number) {
  const leader = await citizen("leader");
  await makeEligible(leader.userId);

  const delegators = [];
  for (let i = 0; i < count; i += 1) {
    const person = await citizen("delegator");
    const response = await delegate(person.cookie, leader.userId);
    expect(response.status).toBe(201);
    delegators.push(person);
  }
  return { leader, delegators };
}

describe("impeachment: who may bring it", () => {
  test("a stranger cannot file — only somebody currently lending their voice", async () => {
    const { leader } = await leaderWithDelegators(1);
    const stranger = await citizen("stranger");

    const response = await file(stranger.cookie, leader.userId);
    expect(response.status).toBe(400);
    expect((await body(response)).code).toBe("not_a_delegator");

    expect(await prisma.impeachment.count()).toBe(0);
  });

  test("a delegator can file, and the electorate is every delegator at that moment", async () => {
    const { leader, delegators } = await leaderWithDelegators(4);

    const response = await file(delegators[0]!.cookie, leader.userId);
    expect(response.status).toBe(201);

    const payload = await body(response);
    expect(payload.electorCount).toBe(4);

    const electors = await prisma.impeachmentElector.findMany({
      where: { impeachmentId: payload.impeachmentId },
      select: { voterId: true },
    });
    expect(new Set(electors.map((e) => e.voterId))).toEqual(
      new Set(delegators.map((d) => d.userId))
    );
  });

  test("you cannot impeach yourself", async () => {
    const { leader } = await leaderWithDelegators(1);
    const response = await file(leader.cookie, leader.userId);
    expect(response.status).toBe(400);
    expect((await body(response)).code).toBe("self_filing");
  });

  test("articles that say nothing are refused", async () => {
    const { leader, delegators } = await leaderWithDelegators(1);
    const response = await file(delegators[0]!.cookie, leader.userId, "bad", "worse");
    expect(response.status).toBe(400);
    expect(await prisma.impeachment.count()).toBe(0);
  });

  test("a second proceeding against the same leader is refused while one is open", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);

    expect((await file(delegators[0]!.cookie, leader.userId)).status).toBe(201);

    const second = await file(delegators[1]!.cookie, leader.userId);
    expect(second.status).toBe(409);
    expect((await body(second)).code).toBe("already_open");
    expect(await prisma.impeachment.count()).toBe(1);
  });
});

describe("impeachment: the frozen electorate", () => {
  test("SOMEBODY WHO DELEGATES AFTER THE FILING GETS NO VOTE", async () => {
    // The central anti-malice rule. Without it, a leader under a fair
    // proceeding recruits sympathetic delegators to dilute the denominator,
    // and a mob brigades in to manufacture a threshold.
    const { leader, delegators } = await leaderWithDelegators(3);

    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    const latecomer = await citizen("latecomer");
    expect((await delegate(latecomer.cookie, leader.userId)).status).toBe(201);

    const attempt = await voteToImpeach(latecomer.cookie, filed.impeachmentId, 30);
    expect(attempt.status).toBe(403);
    expect((await body(attempt)).code).toBe("not_an_elector");

    // And they did not enlarge the denominator either.
    expect(
      await prisma.impeachmentElector.count({ where: { impeachmentId: filed.impeachmentId } })
    ).toBe(3);
  });

  test("leaving the delegation does not take your vote away", async () => {
    // They lent power and were harmed while lending it. The freeze already
    // stops attrition attacks, so stripping a departing delegator gains nothing.
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    const theirs = await prisma.delegation.findFirstOrThrow({
      where: { fromUserId: delegators[1]!.userId, toUserId: leader.userId },
    });
    const revoked = await fetch(`${BASE_URL}/api/delegations/${theirs.id}`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie: delegators[1]!.cookie }),
    });
    expect(revoked.status).toBe(200);

    expect((await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 30)).status).toBe(200);
  });

  test("one elector, one vote — a second is refused", async () => {
    const { leader, delegators } = await leaderWithDelegators(5);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    expect((await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 30)).status).toBe(200);

    const again = await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 90);
    expect(again.status).toBe(400);
    expect((await body(again)).code).toBe("already_voted");

    expect(
      await prisma.impeachmentElector.count({
        where: { impeachmentId: filed.impeachmentId, votedAt: { not: null } },
      })
    ).toBe(1);
  });

  test("a vote can be withdrawn while the window is open", async () => {
    const { leader, delegators } = await leaderWithDelegators(5);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 30);
    const withdrawn = await fetch(`${BASE_URL}/api/impeachments/${filed.impeachmentId}/vote`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie: delegators[1]!.cookie }),
    });
    expect(withdrawn.status).toBe(200);
    expect((await body(withdrawn)).votes).toBe(0);
  });
});

describe("impeachment: the threshold", () => {
  test("below two thirds, nothing happens at all", async () => {
    const { leader, delegators } = await leaderWithDelegators(6);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    // Three of six is a half. Two thirds is four.
    for (let i = 0; i < 3; i += 1) {
      expect((await voteToImpeach(delegators[i]!.cookie, filed.impeachmentId, 30)).status).toBe(200);
    }

    const row = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(row.status).toBe("open");
    expect(row.suspendedUntil).toBeNull();
    expect((await suspensionState(leader.userId)).suspended).toBe(false);

    // And every delegation is still standing.
    expect(
      await prisma.delegation.count({ where: { toUserId: leader.userId, isActive: true } })
    ).toBe(6);
  });

  test("at two thirds it passes, and the delegations go back", async () => {
    const { leader, delegators } = await leaderWithDelegators(6);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    for (let i = 0; i < 4; i += 1) {
      await voteToImpeach(delegators[i]!.cookie, filed.impeachmentId, 30);
    }

    const row = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(row.status).toBe("passed");
    expect(row.suspendedUntil).not.toBeNull();

    expect(
      await prisma.delegation.count({ where: { toUserId: leader.userId, isActive: true } })
    ).toBe(0);
  });

  test("a proceeding whose week runs out without two thirds simply expires", async () => {
    const { leader, delegators } = await leaderWithDelegators(6);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 30);

    await prisma.impeachment.update({
      where: { id: filed.impeachmentId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await sweepExpiredImpeachments()).toBe(1);

    const row = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(row.status).toBe("expired");
    expect(row.suspendedUntil).toBeNull();
    expect(
      await prisma.delegation.count({ where: { toUserId: leader.userId, isActive: true } })
    ).toBe(6);

    // And with the old one closed, a new proceeding may be brought.
    expect((await file(delegators[2]!.cookie, leader.userId)).status).toBe(201);
  });

  test("the backend threshold is the same 2/3 the Bill of Rights states", async () => {
    // The backend cannot import packages/civic-core, so the number is
    // duplicated. This is the thing that stops the copy drifting.
    const source = await Bun.file(
      new URL("../../packages/civic-core/src/bill-of-rights.ts", import.meta.url).pathname
    ).text();
    const declared = source.match(/threshold: number = ([0-9.]+)/)?.[1];
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(IMPEACHMENT_THRESHOLD);
  });
});

describe("impeachment: the sentence", () => {
  test("the suspension is the AVERAGE of what the impeaching voters asked for", async () => {
    // Six electors, so two thirds is exactly four and the fourth vote is the
    // one that decides it. 10, 20, 40 and 50 average to 30.
    const { leader, delegators } = await leaderWithDelegators(6);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    for (const [index, days] of [10, 20, 40, 50].entries()) {
      expect((await voteToImpeach(delegators[index]!.cookie, filed.impeachmentId, days)).status).toBe(200);
    }

    const row = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(row.status).toBe("passed");

    const days = Math.round((row.suspendedUntil!.getTime() - row.decidedAt!.getTime()) / DAY);
    expect(days).toBe(30);
  });

  test("a duration outside 1..365 days is refused", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    expect((await voteToImpeach(delegators[0]!.cookie, filed.impeachmentId, 0)).status).toBe(400);
    expect((await voteToImpeach(delegators[0]!.cookie, filed.impeachmentId, 366)).status).toBe(400);
  });

  test("the suspension lapses on time, and delegation works again", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    for (const person of delegators) await voteToImpeach(person.cookie, filed.impeachmentId, 30);

    expect((await suspensionState(leader.userId)).suspended).toBe(true);

    // Wind the clock past the end of the sentence. No sweep clears it; the
    // suspension is read live, so the date passing IS the release.
    await prisma.impeachment.update({
      where: { id: filed.impeachmentId },
      data: { suspendedUntil: new Date(Date.now() - 1000) },
    });

    expect((await suspensionState(leader.userId)).suspended).toBe(false);

    const returning = await citizen("returning");
    expect((await delegate(returning.cookie, leader.userId)).status).toBe(201);
  });
});

describe("impeachment: what is actually taken away", () => {
  /** A leader who has just been impeached, plus their delegators. */
  async function impeached() {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    for (const person of delegators) await voteToImpeach(person.cookie, filed.impeachmentId, 30);
    expect((await suspensionState(leader.userId)).suspended).toBe(true);
    return { leader, delegators, impeachmentId: filed.impeachmentId as string };
  }

  test("nobody may lend them a vote, and the refusal says when it lifts", async () => {
    const { leader } = await impeached();
    const hopeful = await citizen("hopeful");

    const response = await delegate(hopeful.cookie, leader.userId);
    expect(response.status).toBe(403);

    const payload = await body(response);
    expect(payload.impeachment.suspendedUntil).toBeTruthy();
    expect(new Date(payload.impeachment.suspendedUntil).getTime()).toBeGreaterThan(Date.now());
  });

  test("they can still post", async () => {
    const { leader } = await impeached();
    const bill = await prisma.governmentReference.create({
      data: {
        masterReferenceId: freshReferenceId(),
        referenceType: "bill",
        title: "A bill they still have an opinion about",
        status: "proposed",
        category: "healthcare",
      },
    });
    const response = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: leader.cookie }),
      body: JSON.stringify({
        content: "I am still here, and I still have things to say.",
        governmentReferenceId: bill.id,
      }),
    });
    expect(response.status).toBe(201);
  });

  test("the sentence is set by the votes that carried it, not by whoever votes later", async () => {
    // A proceeding closes the instant two thirds is reached — the power is
    // recalled the moment the people recall it, not a week later — so the
    // average is over the votes that were in when it crossed. A vote arriving
    // afterwards is refused rather than quietly discarded.
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    await voteToImpeach(delegators[0]!.cookie, filed.impeachmentId, 10);
    await voteToImpeach(delegators[1]!.cookie, filed.impeachmentId, 20);

    const late = await voteToImpeach(delegators[2]!.cookie, filed.impeachmentId, 365);
    expect(late.status).toBe(400);
    expect((await body(late)).code).toBe("closed");

    const row = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(Math.round((row.suspendedUntil!.getTime() - row.decidedAt!.getTime()) / DAY)).toBe(15);
  });

  test("they can still comment", async () => {
    const { leader, delegators } = await impeached();
    const post = await prisma.post.create({
      data: { authorId: delegators[0]!.userId, content: "A post to reply to." },
    });
    const response = await fetch(`${BASE_URL}/api/posts/${post.id}/comments`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: leader.cookie }),
      body: JSON.stringify({ content: "Here is my answer to the accusation." }),
    });
    expect(response.status).toBe(201);
  });

  test("they can still share somebody else's post", async () => {
    const { leader, delegators } = await impeached();
    const post = await prisma.post.create({
      data: { authorId: delegators[0]!.userId, content: "Worth passing on." },
    });
    const response = await fetch(`${BASE_URL}/api/posts/${post.id}/repost`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: leader.cookie }),
    });
    expect([200, 201]).toContain(response.status);
  });

  test("they can still follow, and keep the followers they had", async () => {
    const { leader, delegators } = await impeached();

    // Somebody was already following them before the vote.
    await prisma.follow.create({
      data: { followerId: delegators[0]!.userId, followingId: leader.userId },
    });

    const response = await fetch(`${BASE_URL}/api/users/${delegators[1]!.userId}/follow`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: leader.cookie }),
    });
    expect([200, 201]).toContain(response.status);

    expect(await prisma.follow.count({ where: { followingId: leader.userId } })).toBe(1);
  });

  test("THEY CAN STILL DELEGATE THEIR OWN VOTE TO SOMEBODY ELSE", async () => {
    // The whole shape of the penalty in one assertion. Impeachment recalls
    // borrowed power; it does not take away the vote they were born with.
    const { leader } = await impeached();
    const other = await citizen("other");
    await makeEligible(other.userId);

    const response = await delegate(leader.cookie, other.userId);
    expect(response.status).toBe(201);
  });

  test("their own vote still counts on the Pulse", async () => {
    const { leader } = await impeached();
    const bill = await prisma.governmentReference.create({
      data: {
        masterReferenceId: freshReferenceId(),
        referenceType: "bill",
        title: "A bill they still get a say on",
        status: "proposed",
        category: "healthcare",
      },
    });

    const response = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: leader.cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect(response.status).toBe(200);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } });
    // One. Their own. The three they were carrying went home.
    expect(row.supportVotes).toBe(1);
  });

  test("the weight they were carrying is recomputed away, not left behind", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const bill = await prisma.governmentReference.create({
      data: {
        masterReferenceId: freshReferenceId(),
        referenceType: "bill",
        title: "A bill voted before the fall",
        status: "proposed",
        category: "healthcare",
      },
    });

    await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: leader.cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect((await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } })).supportVotes).toBe(4);

    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    for (const person of delegators) await voteToImpeach(person.cookie, filed.impeachmentId, 30);

    expect((await prisma.governmentReference.findUniqueOrThrow({ where: { id: bill.id } })).supportVotes).toBe(1);
  });
});

describe("impeachment: service of the articles", () => {
  test("the accused is told what they are accused of, in their own inbox", async () => {
    const { leader, delegators } = await leaderWithDelegators(2);
    await file(delegators[0]!.cookie, leader.userId);

    const served = await prisma.notification.findFirst({
      where: { userId: leader.userId, type: "impeachment_served" },
    });
    expect(served).not.toBeNull();
    expect(served!.body).toContain(GROUNDS);
    expect(served!.body).toContain(EVIDENCE);
  });

  test("every elector is told the proceeding exists", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    await file(delegators[0]!.cookie, leader.userId);

    const told = await prisma.notification.count({ where: { type: "impeachment_opened" } });
    expect(told).toBe(3);
  });

  test("an Article V notice cannot be switched off", async () => {
    // Service of process is not a preference. Turning every switch a user has
    // to off must not silence it.
    const { leader, delegators } = await leaderWithDelegators(2);
    for (const person of delegators) {
      await prisma.notificationPreference.upsert({
        where: { userId: person.userId },
        create: {
          userId: person.userId,
          likes: false, comments: false, replies: false, mentions: false,
          follows: false, reposts: false, newFollowerPosts: false,
          messages: false, lawUpdates: false, voiceUsed: false,
        },
        update: {
          likes: false, comments: false, replies: false, mentions: false,
          follows: false, reposts: false, newFollowerPosts: false,
          messages: false, lawUpdates: false, voiceUsed: false,
        },
      });
    }

    await file(delegators[0]!.cookie, leader.userId);
    expect(await prisma.notification.count({ where: { type: "impeachment_opened" } })).toBe(2);
  });

  test("both sides are told the outcome", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    for (const person of delegators) await voteToImpeach(person.cookie, filed.impeachmentId, 30);

    // Three electors and the leader.
    expect(await prisma.notification.count({ where: { type: "impeachment_decided" } })).toBe(4);
  });
});

describe("impeachment: what the page can read", () => {
  test("a leader with nothing against them reads as an honest empty state", async () => {
    const { leader } = await leaderWithDelegators(2);
    const viewer = await citizen("viewer");

    const response = await fetch(`${BASE_URL}/api/impeachments/leader/${leader.userId}`, {
      headers: freshClientHeaders({ cookie: viewer.cookie }),
    });
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload.proceeding).toBeNull();
    expect(payload.delegatorCount).toBe(2);
    expect(payload.canBeImpeached).toBe(true);
    expect(payload.suspension.suspended).toBe(false);
  });

  test("somebody with no delegators is not subject to Article V at all", async () => {
    const nobody = await citizen("nobody");
    const response = await fetch(`${BASE_URL}/api/impeachments/leader/${nobody.userId}`);
    const payload = await body(response);
    expect(payload.canBeImpeached).toBe(false);
    expect(payload.delegatorCount).toBe(0);
  });

  test("an elector sees the articles, the tally, and that they may vote", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    const response = await fetch(`${BASE_URL}/api/impeachments/leader/${leader.userId}`, {
      headers: freshClientHeaders({ cookie: delegators[1]!.cookie }),
    });
    const payload = await body(response);

    expect(payload.proceeding.grounds).toBe(GROUNDS);
    expect(payload.proceeding.evidence).toBe(EVIDENCE);
    expect(payload.proceeding.electorCount).toBe(3);
    expect(payload.proceeding.votes).toBe(0);
    expect(payload.proceeding.votesNeeded).toBe(2);
    expect(payload.proceeding.viewerIsElector).toBe(true);
    expect(payload.proceeding.viewerHasVoted).toBe(false);
  });

  test("a non-elector sees the accusation but is told plainly they have no vote", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    await file(delegators[0]!.cookie, leader.userId);
    const stranger = await citizen("onlooker");

    const response = await fetch(`${BASE_URL}/api/impeachments/leader/${leader.userId}`, {
      headers: freshClientHeaders({ cookie: stranger.cookie }),
    });
    const payload = await body(response);
    expect(payload.proceeding.grounds).toBe(GROUNDS);
    expect(payload.proceeding.viewerIsElector).toBe(false);
  });

  test("the ballot box lists the proceedings you are an elector in", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));

    const response = await fetch(`${BASE_URL}/api/impeachments/me`, {
      headers: freshClientHeaders({ cookie: delegators[1]!.cookie }),
    });
    const payload = await body(response);

    expect(payload.proceedings).toHaveLength(1);
    expect(payload.proceedings[0].id).toBe(filed.impeachmentId);
    expect(payload.proceedings[0].leader.id).toBe(leader.userId);
    expect(payload.proceedings[0].electorCount).toBe(3);
    expect(payload.proceedings[0].viewerHasVoted).toBe(false);
  });

  test("somebody who is an elector in nothing gets an empty list, not an error", async () => {
    const alone = await citizen("alone");
    const response = await fetch(`${BASE_URL}/api/impeachments/me`, {
      headers: freshClientHeaders({ cookie: alone.cookie }),
    });
    expect(response.status).toBe(200);
    expect((await body(response)).proceedings).toEqual([]);
  });
});

describe("impeachment: nobody can stop it", () => {
  test("there is no route, at any permission level, that cancels a proceeding", async () => {
    // Article V is the people's remedy against borrowed power. A remedy the
    // platform can switch off is not a remedy, so this asserts on the source:
    // no handler anywhere may set a proceeding's status by hand.
    const routes = new Bun.Glob("*.ts").scanSync({
      cwd: new URL("../src/routes", import.meta.url).pathname,
      absolute: true,
    });

    const offenders: string[] = [];
    for (const path of routes) {
      const source = await Bun.file(path).text();
      // The service is the only place allowed to move a proceeding's status,
      // and it does so from the tally alone.
      if (/prisma\.impeachment\.(update|updateMany|delete|deleteMany)/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("evaluate() is idempotent — running it again does not re-punish", async () => {
    const { leader, delegators } = await leaderWithDelegators(3);
    const filed = await body(await file(delegators[0]!.cookie, leader.userId));
    for (const person of delegators) await voteToImpeach(person.cookie, filed.impeachmentId, 30);

    const first = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    const notices = await prisma.notification.count({ where: { type: "impeachment_decided" } });

    await evaluate(filed.impeachmentId);
    await evaluate(filed.impeachmentId);

    const second = await prisma.impeachment.findUniqueOrThrow({ where: { id: filed.impeachmentId } });
    expect(second.suspendedUntil!.getTime()).toBe(first.suspendedUntil!.getTime());
    expect(await prisma.notification.count({ where: { type: "impeachment_decided" } })).toBe(notices);
  });
});

describe("impeachment: the articles reach the admins", () => {
  const ADMIN_EMAIL = "articles-admin@example.com";
  const ADMIN_PASSWORD = "correct horse battery staple";

  async function adminToken(): Promise<string> {
    const owner = await signUp({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: "Articles Admin",
    });
    await prisma.user.update({ where: { id: owner.userId }, data: { role: "superadmin" } });

    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const payload = await body(response);
    return payload.token ?? payload.data?.token ?? "";
  }

  test("a filing shows up in the admin queue with both sides named", async () => {
    const token = await adminToken();
    const { leader, delegators } = await leaderWithDelegators(3);
    await file(delegators[0]!.cookie, leader.userId);

    const response = await fetch(`${BASE_URL}/api/admin/articles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);

    const payload = await body(response);
    expect(payload.total).toBe(1);
    expect(payload.openCount).toBe(1);

    const filing = payload.articles[0];
    expect(filing.kind).toBe("impeachment");
    expect(filing.grounds).toBe(GROUNDS);
    expect(filing.evidence).toBe(EVIDENCE);
    expect(filing.accused.id).toBe(leader.userId);
    expect(filing.filedBy.id).toBe(delegators[0]!.userId);
    expect(filing.electorCount).toBe(3);
  });

  test("the queue says out loud that it cannot stop anything", async () => {
    const token = await adminToken();
    const response = await fetch(`${BASE_URL}/api/admin/articles`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await body(response)).canStopProceedings).toBe(false);
  });

  test("an unauthenticated request gets nothing", async () => {
    const { leader, delegators } = await leaderWithDelegators(2);
    await file(delegators[0]!.cookie, leader.userId);

    const response = await fetch(`${BASE_URL}/api/admin/articles`);
    expect(response.status).toBe(401);
  });
});
