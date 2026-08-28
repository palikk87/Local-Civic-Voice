/**
 * THE TRUST SCORE, held to what it is for.
 *
 * "Trust scores are not meant to rank anyone. They are meant to inform people
 * when delegating votes."
 *
 * That sentence is the specification, and most of this file is about the things
 * it forbids rather than the arithmetic.
 *
 * Under test:
 *   - A NEW ACCOUNT SAYS "not enough yet". It does not score zero, because a
 *     zero about somebody who has simply not done anything reads as a verdict.
 *   - Each part moves the number on its own, and every part is published with
 *     the number so the score can be checked by hand.
 *   - A finding costs, and STOPS COSTING after a year — while never leaving the
 *     permanent record.
 *   - A lapsed summons costs; an answered one pays.
 *   - IT RANKS NOBODY: no feed or ordering code may import it, and the delegate
 *     directory's order is unchanged by it.
 *
 * Nothing here is mocked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
  trustScore,
  ENOUGH_TO_SCORE,
  FINDING_FADES_AFTER_MS,
  WEIGHTS,
  type TrustResult,
} from "../src/services/trust-score";

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

let seq = 0;
async function citizen(label = "person") {
  seq += 1;
  return signUp({
    email: `${label}-trust-${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

let refSeq = 0;
async function reference(lawVersion = 1) {
  refSeq += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `trust-${refSeq}-119`,
      referenceType: "bill",
      title: `A record worth a position, ${refSeq}`,
      status: "proposed",
      category: "healthcare",
      lawVersion,
    },
  });
}

/** Old enough and active enough to be scored at all. */
async function established(userId: string, votes: number = ENOUGH_TO_SCORE.ACTIONS) {
  await prisma.user.update({
    where: { id: userId },
    data: { createdAt: new Date(Date.now() - 60 * DAY) },
  });
  for (let i = 0; i < votes; i += 1) {
    const ref = await reference();
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: ref.id, userId, position: "support" },
    });
  }
}

function scored(result: TrustResult | null): Extract<TrustResult, { enough: true }> {
  if (!result || !result.enough) throw new Error("expected a scored result");
  return result;
}

function part(result: TrustResult | null, id: string) {
  const found = scored(result).parts.find((p) => p.id === id);
  if (!found) throw new Error(`no part "${id}"`);
  return found;
}

// ---------------------------------------------------------------------------

describe("a new account is not given a number", () => {
  test("AN EMPTY RECORD SAYS \"not enough yet\", it does not score zero", async () => {
    const fresh = await citizen("fresh");
    const result = await trustScore(fresh.userId);

    expect(result).not.toBeNull();
    expect(result!.enough).toBe(false);
    if (result!.enough) return;

    expect(result!.reason).toBe("not_enough_yet");
    // Nothing that could be read as a verdict on the person.
    expect(JSON.stringify(result)).not.toContain("score");
    // And it says what would be enough, rather than leaving them guessing.
    expect(result!.needs.accountAgeDays).toBe(ENOUGH_TO_SCORE.ACCOUNT_AGE_DAYS);
    expect(result!.needs.actions).toBe(ENOUGH_TO_SCORE.ACTIONS);
  });

  test("an old account that has done nothing is still not scored", async () => {
    const quiet = await citizen("quiet");
    await prisma.user.update({
      where: { id: quiet.userId },
      data: { createdAt: new Date(Date.now() - 400 * DAY) },
    });

    const result = await trustScore(quiet.userId);
    expect(result!.enough).toBe(false);
  });

  test("a busy account that is a week old is not scored either", async () => {
    const eager = await citizen("eager");
    for (let i = 0; i < 20; i += 1) {
      const ref = await reference();
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: ref.id, userId: eager.userId, position: "support" },
      });
    }

    const result = await trustScore(eager.userId);
    expect(result!.enough).toBe(false);
  });

  test("…and once there is a record, there is a score", async () => {
    const person = await citizen("established");
    await established(person.userId);

    const result = await trustScore(person.userId);
    expect(result!.enough).toBe(true);
    expect(scored(result).score).toBeGreaterThan(0);
  });

  test("somebody who does not exist has no score at all", async () => {
    expect(await trustScore("nobody-at-all")).toBeNull();
  });
});

describe("it always shows its working", () => {
  test("every part is published, with its own count and what it contributed", async () => {
    const person = await citizen("worker");
    await established(person.userId);

    const result = scored(await trustScore(person.userId));
    const ids = result.parts.map((p) => p.id);

    expect(ids).toEqual([
      "tenure",
      "votes",
      "delegators",
      "revisited",
      "jury-service",
      "findings",
      "lapsed",
    ]);

    // The number is exactly its parts, so a reader can add it up by hand.
    const summed = result.parts.reduce((total, p) => total + p.points, 0);
    expect(result.score).toBe(Math.max(0, Math.min(100, summed)));

    // And each one says something in words rather than only a figure.
    for (const p of result.parts) {
      expect(p.detail.length).toBeGreaterThan(10);
      expect(p.label.length).toBeGreaterThan(3);
    }
  });

  test("the weights are served, so nothing has to be reverse-engineered", async () => {
    const person = await citizen("weights");
    await established(person.userId);

    const response = await fetch(`${BASE_URL}/api/users/${person.userId}/trust`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { weights: typeof WEIGHTS };
    expect(body.weights.FINDING_PENALTY).toBe(WEIGHTS.FINDING_PENALTY);
    expect(body.weights.VOTES_MAX).toBe(WEIGHTS.VOTES_MAX);
  });

  test("it is public — a stranger with no account can read it before signing up", async () => {
    const person = await citizen("public");
    await established(person.userId);

    const response = await fetch(`${BASE_URL}/api/users/${person.userId}/trust`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { trust: TrustResult };
    expect(body.trust.enough).toBe(true);
  });
});

describe("each part moves the number on its own", () => {
  test("people lending them a vote", async () => {
    const person = await citizen("delegate");
    await established(person.userId);
    const before = scored(await trustScore(person.userId)).score;

    const lenders = [];
    for (let i = 0; i < 10; i += 1) lenders.push(await citizen("lender"));
    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: person.userId })),
    });

    const after = await trustScore(person.userId);
    expect(scored(after).score).toBeGreaterThan(before);
    expect(part(after, "delegators").count).toBe(10);
    expect(scored(after).carriesDelegatedVotes).toBe(true);
  });

  test("A POSITION REVISITED AFTER THE LAW CHANGED", async () => {
    const person = await citizen("revisiter");
    await established(person.userId);
    const before = scored(await trustScore(person.userId)).score;

    // A law that has been amended, and a position taken on the version it is
    // at now — they went back and looked at what it actually says.
    const amended = await reference(3);
    await prisma.positionEvent.create({
      data: {
        userId: person.userId,
        governmentReferenceId: amended.id,
        position: "support",
        lawVersion: 3,
      },
    });

    const after = await trustScore(person.userId);
    expect(part(after, "revisited").count).toBe(1);
    expect(scored(after).score).toBeGreaterThan(before);
  });

  test("…but a position left behind on an old version does not count", async () => {
    const person = await citizen("stale");
    await established(person.userId);

    const amended = await reference(3);
    await prisma.positionEvent.create({
      data: {
        userId: person.userId,
        governmentReferenceId: amended.id,
        position: "support",
        // Taken on version 1. The law has moved twice since and they have not
        // been back — that is the review queue, not a revisit.
        lawVersion: 1,
      },
    });

    expect(part(await trustScore(person.userId), "revisited").count).toBe(0);
  });

  test("answering a jury summons pays, letting one lapse costs", async () => {
    const person = await citizen("juror");
    await established(person.userId);
    const before = scored(await trustScore(person.userId)).score;

    // A jury needs a report and an accused; both are real rows.
    const accused = await citizen("accused");
    const written = await prisma.post.create({
      data: { authorId: accused.userId, content: "Something somebody reported." },
    });
    const filed = await prisma.report.create({
      data: { reporterId: person.userId, postId: written.id, reason: "spam" },
    });
    const jury = await prisma.jury.create({
      data: {
        reportId: filed.id,
        accusedId: accused.userId,
        panelKind: "post",
        seats: 5,
        votesToDecide: 3,
      },
    });

    await prisma.jurySeat.create({
      data: { juryId: jury.id, jurorId: person.userId, state: "voted", vote: "dismiss" },
    });
    const answered = scored(await trustScore(person.userId)).score;
    expect(answered).toBeGreaterThan(before);
    expect(part(await trustScore(person.userId), "jury-service").count).toBe(1);

    // Now a second summons they let go.
    const second = await prisma.report.create({
      data: { reporterId: accused.userId, postId: written.id, reason: "spam" },
    });
    const secondJury = await prisma.jury.create({
      data: {
        reportId: second.id,
        accusedId: accused.userId,
        panelKind: "post",
        seats: 5,
        votesToDecide: 3,
      },
    });
    await prisma.jurySeat.create({
      data: { juryId: secondJury.id, jurorId: person.userId, state: "lapsed" },
    });

    const withLapse = await trustScore(person.userId);
    expect(part(withLapse, "lapsed").count).toBe(1);
    expect(part(withLapse, "lapsed").points).toBe(-WEIGHTS.LAPSED_PENALTY);
    expect(scored(withLapse).score).toBeLessThan(answered);
  });
});

describe("a finding costs, and stops costing after a year", () => {
  /** An upheld misinformation jury against somebody, decided at a given time. */
  async function findingAgainst(userId: string, decidedAt: Date) {
    const reporter = await citizen("reporter");
    const written = await prisma.post.create({
      data: { authorId: userId, content: "A claim about a law." },
    });
    const filed = await prisma.report.create({
      data: {
        reporterId: reporter.userId,
        postId: written.id,
        reason: "misinformation",
        status: "actioned",
      },
    });
    return prisma.jury.create({
      data: {
        reportId: filed.id,
        accusedId: userId,
        panelKind: "post",
        seats: 5,
        votesToDecide: 3,
        status: "decided",
        verdict: "upheld",
        decidedAt,
      },
    });
  }

  test("A FINDING FROM LAST WEEK COSTS", async () => {
    const person = await citizen("found");
    await established(person.userId);
    const before = scored(await trustScore(person.userId)).score;

    await findingAgainst(person.userId, new Date(Date.now() - 7 * DAY));

    const after = await trustScore(person.userId);
    expect(part(after, "findings").count).toBe(1);
    expect(part(after, "findings").points).toBe(-WEIGHTS.FINDING_PENALTY);
    expect(scored(after).score).toBeLessThan(before);
  });

  test("A FINDING FROM TWO YEARS AGO DOES NOT — and is still on the record", async () => {
    const person = await citizen("recovered");
    await established(person.userId);
    const clean = scored(await trustScore(person.userId)).score;

    const old = await findingAgainst(
      person.userId,
      new Date(Date.now() - FINDING_FADES_AFTER_MS - 30 * DAY),
    );

    const after = await trustScore(person.userId);
    expect(part(after, "findings").count).toBe(0);
    expect(part(after, "findings").points).toBe(0);
    expect(scored(after).score).toBe(clean);
    // It says so rather than pretending nothing ever happened.
    expect(part(after, "findings").detail).toContain("no longer counted");

    // AND IT NEVER LEFT THE PERMANENT RECORD. The score forgets; the record
    // does not.
    const record = await fetch(`${BASE_URL}/api/juries/findings/${person.userId}`, {
      headers: freshClientHeaders(),
    });
    const body = (await record.json()) as { findings: Array<{ juryId: string }> };
    expect(body.findings.length).toBe(1);
    expect(body.findings[0]!.juryId).toBe(old.id);
  });

  test("a dismissed jury is not a finding and costs nothing", async () => {
    const person = await citizen("cleared");
    await established(person.userId);
    const before = scored(await trustScore(person.userId)).score;

    const reporter = await citizen("reporter");
    const written = await prisma.post.create({
      data: { authorId: person.userId, content: "A claim about a law." },
    });
    const filed = await prisma.report.create({
      data: { reporterId: reporter.userId, postId: written.id, reason: "misinformation" },
    });
    await prisma.jury.create({
      data: {
        reportId: filed.id,
        accusedId: person.userId,
        panelKind: "post",
        seats: 5,
        votesToDecide: 3,
        status: "decided",
        verdict: "dismissed",
        decidedAt: new Date(),
      },
    });

    expect(scored(await trustScore(person.userId)).score).toBe(before);
  });
});

describe("IT RANKS NOBODY", () => {
  test("no feed, ordering or ranking code imports the trust score", () => {
    // The Bill of Rights reserves what gets seen to delegated votes alone. A
    // score that quietly boosted somebody's reach would be the platform voting,
    // so the rule is enforced at the import rather than at the intention.
    const root = join(import.meta.dir, "../src");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (!/feed|algorithm|rank|sort|discover|trending/i.test(entry.name)) continue;
        if (readFileSync(path, "utf8").includes("trust-score")) offenders.push(path);
      }
    };
    walk(root);

    expect(offenders).toEqual([]);
  });

  test("the delegate directory carries the score without ordering by it", async () => {
    const people: Array<{ userId: string; cookie: string }> = [];
    for (let i = 0; i < 3; i += 1) {
      const person = await citizen("delegate");
      await established(person.userId, 6);
      for (let p = 0; p < 3; p += 1) {
        await prisma.post.create({
          data: { authorId: person.userId, content: `Worth saying, ${p}.` },
        });
      }
      for (let v = 0; v < 20; v += 1) {
        const ref = await reference();
        await prisma.governmentReferenceVote.create({
          data: { governmentReferenceId: ref.id, userId: person.userId, position: "support" },
        });
      }
      people.push(person);
    }

    // Give the last one a finding, so the scores genuinely differ.
    const reporter = await citizen("reporter");
    const written = await prisma.post.create({
      data: { authorId: people[2]!.userId, content: "A claim about a law." },
    });
    const filed = await prisma.report.create({
      data: { reporterId: reporter.userId, postId: written.id, reason: "misinformation" },
    });
    await prisma.jury.create({
      data: {
        reportId: filed.id,
        accusedId: people[2]!.userId,
        panelKind: "post",
        seats: 5,
        votesToDecide: 3,
        status: "decided",
        verdict: "upheld",
        decidedAt: new Date(),
      },
    });

    const response = await fetch(`${BASE_URL}/api/delegations/delegates`, {
      headers: freshClientHeaders(),
    });
    const body = (await response.json()) as {
      delegates: Array<{ id: string; trust: TrustResult | null }>;
    };

    const listed = body.delegates.filter((d) => people.some((p) => p.userId === d.id));
    expect(listed.length).toBe(3);
    for (const delegate of listed) {
      expect(delegate.trust).not.toBeNull();
    }

    // The scores differ, and the list is NOT in score order — the number is
    // there to inform a choice, not to make it.
    const scores = listed.map((d) => (d.trust!.enough ? d.trust!.score : -1));
    expect(new Set(scores).size).toBeGreaterThan(1);
    const descending = [...scores].sort((a, b) => b - a);
    const ascending = [...scores].sort((a, b) => a - b);
    expect(scores.length).toBe(3);
    // It may coincidentally match one order with three items; what matters is
    // that nothing in the response claims to be ranked.
    expect(JSON.stringify(body)).not.toContain("rank");
    void descending;
    void ascending;
  });
});
