/**
 * Every number this dashboard shows was counted.
 *
 * WHY THIS TEST EXISTS. The B2B overview shipped four kinds of invented figure,
 * all of them rendered to businesses paying for measurements:
 *
 *   - a per-branch breakdown that was the national total times 0.4, 0.35, 0.25
 *   - a monthly change that was the weekly change times four
 *   - "Active Users", fed by the length of a hardcoded 51-entry table of states
 *   - post and comment counts that were the vote total times 0.1 and 0.3
 *
 * None of them would have failed a test that only checked the endpoint answers
 * 200, which is what existed. So these assert against votes this file casts
 * itself: the arithmetic is done here, independently, and compared.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { B2B_TEST, BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

type Json = Record<string, any>;

async function token(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: B2B_TEST.demoUsername, password: B2B_TEST.demoPassword }),
  });
  return ((await res.json()) as Json).token as string;
}

async function overview(): Promise<Json> {
  const res = await fetch(`${BASE_URL}/api/b2b/sentiment/overview`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Json;
}

/** A reference of the given branch, with votes on it. */
async function seedVotes(
  referenceType: string,
  id: string,
  support: number,
  oppose: number,
): Promise<void> {
  await prisma.governmentReference.create({
    data: {
      id,
      // Its own master. The merge system points a record at the surviving one;
      // an unmerged record points at itself.
      masterReferenceId: id,
      referenceType,
      title: `Test ${id}`,
      status: "proposed",
      supportVotes: support,
      opposeVotes: oppose,
    },
  });

  for (let i = 0; i < support + oppose; i += 1) {
    const user = await prisma.user.create({
      data: {
        id: `${id}-voter-${i}`,
        name: `Voter ${i}`,
        email: `${id}-voter-${i}@example.test`,
        emailVerified: true,
      },
    });
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReference: { connect: { id } },
        userId: user.id,
        position: i < support ? "support" : "oppose",
      },
    });
  }
}

describe("the per-branch breakdown is counted, not apportioned", () => {
  test("each branch reports its own votes", async () => {
    // Deliberately NOT in the 40/35/25 ratio the old code assumed. If anything
    // is still apportioning from the national total, these numbers cannot come
    // out right by accident.
    await seedVotes("bill", "test-bill-1", 7, 3);
    await seedVotes("executive_order", "test-eo-1", 1, 5);
    await seedVotes("scotus_case", "test-scotus-1", 4, 0);

    const body = await overview();

    expect(body.byBranch.legislative).toEqual({ support: 7, oppose: 3 });
    expect(body.byBranch.executive).toEqual({ support: 1, oppose: 5 });
    expect(body.byBranch.judicial).toEqual({ support: 4, oppose: 0 });

    // And the three add up to the national total, which apportioning also did —
    // so this alone would not have caught it. The ratios above are what does.
    const total = 7 + 3 + 1 + 5 + 4 + 0;
    expect(body.overview.totalEngagements).toBe(total);
  });

  test("a branch nobody has voted in reports zero, not a share of the total", async () => {
    await seedVotes("bill", "test-bill-2", 10, 2);

    const body = await overview();

    expect(body.byBranch.legislative).toEqual({ support: 10, oppose: 2 });
    // The old code would have shown 4 and 1 here, and 3 and 1 for judicial:
    // 35% and 25% of a number that came entirely from bills.
    expect(body.byBranch.executive).toEqual({ support: 0, oppose: 0 });
    expect(body.byBranch.judicial).toEqual({ support: 0, oppose: 0 });
  });
});

describe("counts are counts", () => {
  test("posts and comments are the real rows, not a fraction of the votes", async () => {
    await seedVotes("bill", "test-bill-3", 20, 0);

    const author = await prisma.user.findFirst({ where: { id: "test-bill-3-voter-0" } });
    const post = await prisma.post.create({
      data: { author: { connect: { id: author!.id } }, content: "One post." },
    });
    await prisma.comment.create({
      data: {
        post: { connect: { id: post.id } },
        author: { connect: { id: author!.id } },
        content: "One comment.",
      },
    });

    const body = await overview();

    // Was Math.round(total * 0.1) = 2 and Math.round(total * 0.3) = 6.
    expect(body.engagement.totalPosts).toBe(1);
    expect(body.engagement.totalComments).toBe(1);
  });

  test("nothing in the response is the number of US states", async () => {
    // The dashboard's "Active Users: 51" was Object.keys(stateInfo).length —
    // the rows in a hardcoded table in the route file. It never touched a vote,
    // so it read 51 on an empty database.
    const body = await overview();

    expect(body.activeDistricts).toBeUndefined();
    expect(body.activeStates).toBeUndefined();
    expect(body.engagement.participants).toBe(0);
  });
});

describe("a change nobody can measure is reported as unknown", () => {
  test("weekly and monthly change are null on a database with no history", async () => {
    await seedVotes("bill", "test-bill-4", 5, 5);

    const body = await overview();

    // Not 0. "We measured it and it did not move" and "there is no earlier
    // period" are different statements, and only the second one is true here.
    expect(body.trends.weeklyChange).toBeNull();
    expect(body.trends.monthlyChange).toBeNull();
  });

  test("monthly change is its own measurement, not the weekly one times four", async () => {
    // Two votes last month, six this month: a real +200% over thirty days. The
    // old code would have reported the weekly figure multiplied by four, and
    // every vote here is older than a week, so the weekly figure is 0.
    const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    await seedVotes("bill", "test-bill-5", 8, 0);
    const votes = await prisma.governmentReferenceVote.findMany({
      where: { governmentReferenceId: "test-bill-5" },
      orderBy: { id: "asc" },
    });

    // Two in the 30–60 day window, six in the 8–30 day window.
    for (const [index, vote] of votes.entries()) {
      await prisma.governmentReferenceVote.update({
        where: { id: vote.id },
        data: { createdAt: index < 2 ? daysAgo(45) : daysAgo(20) },
      });
    }

    const body = await overview();

    expect(body.trends.monthlyChange).toBe(200);
    // Nothing happened in the last seven days, and the week before it was also
    // empty — so there is nothing to compare, which is null rather than 0.
    expect(body.trends.weeklyChange).toBeNull();
  });
});

describe("a sentiment figure carries no invented certainty", () => {
  test("no endpoint returns a hardcoded confidence or a level dressed as a trend", async () => {
    await seedVotes("bill", "test-bill-6", 15, 1);

    const t = await token();
    for (const path of [
      "/api/b2b/issues",
      "/api/b2b/sentiment/issues",
      "/api/b2b/sentiment/bills/test-bill-6",
      "/api/b2b/issues/test-bill-6",
    ]) {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const text = await res.text();

      // 0.85 and 0.5 were the two values confidence could ever take, and 0.85
      // was rendered to the customer as "85%".
      expect(text).not.toContain('"confidence"');
      // The level-as-direction label. A bill steady at 88% support was
      // permanently "rising".
      expect(text).not.toContain('"trend"');
      // The literal zero drawn as "no change".
      expect(text).not.toContain('"changePercent":0');
    }
  });
});
