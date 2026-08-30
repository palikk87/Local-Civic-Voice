/**
 * THE PULSE IS WHAT IS MOVING NOW, AND IT RANKS RECORDS RATHER THAN PEOPLE.
 *
 * Asked for in these words: "the pulse section should only address government
 * business that has had the most recent activity between votes and
 * shares/posts".
 *
 * WHY NOT /trending. That endpoint ranks by all-time totals, so the biggest
 * records of the year sit at the top of it forever whatever happened this week.
 * A pulse that never changes is not a pulse. The distinction is the whole
 * feature, so it is the first thing tested.
 *
 * AND THE LEADERBOARD IS GONE. The panel used to carry a second list ranking
 * citizens by how active they were. It was dropped on instruction, and it would
 * have contradicted the platform's own rule that it never ranks anybody.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, signUp, startServer, stopServer } from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

async function makeLaw(id: string, title: string): Promise<string> {
  const record = await prisma.governmentReference.create({
    data: {
      masterReferenceId: id,
      referenceType: "bill",
      title,
      category: "economy",
      status: "active",
    },
  });
  return record.id;
}

async function voteOn(referenceId: string, userId: string, daysAgo: number): Promise<void> {
  await prisma.governmentReferenceVote.create({
    data: {
      governmentReferenceId: referenceId,
      userId,
      position: "support",
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    },
  });
}

const pulse = async (query = "?days=7&limit=5") => {
  const response = await fetch(`${BASE_URL}/api/government-references/pulse${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as {
    days: number;
    records: Array<{ id: string; title: string; recentVotes: number; recentPosts: number; activity: number }>;
  };
};

describe("the pulse is recent, not all time", () => {
  test("a record touched this week outranks one that was busy months ago", async () => {
    const quiet = await makeLaw("bill-quiet", "Busy Last Year");
    const busy = await makeLaw("bill-busy", "Busy This Week");

    // Ten votes long ago, two this week. All-time ordering would put the first
    // on top; this must not.
    for (let i = 0; i < 10; i += 1) {
      const { userId } = await signUp({
        email: `pulse-old-${i}@example.com`,
        password: "Pu1se!pass123",
        name: "Pulse Tester",
      });
      await voteOn(quiet, userId, 40);
    }
    for (let i = 0; i < 2; i += 1) {
      const { userId } = await signUp({
        email: `pulse-new-${i}@example.com`,
        password: "Pu1se!pass123",
        name: "Pulse Tester",
      });
      await voteOn(busy, userId, 1);
    }

    const body = await pulse();
    expect(body.records[0]?.title).toBe("Busy This Week");
    // And the old one is absent entirely: nothing happened to it in the window.
    expect(body.records.map((r) => r.title)).not.toContain("Busy Last Year");
  });

  test("nothing moving means an empty list, not a filler list", async () => {
    const law = await makeLaw("bill-stale", "Nobody Has Touched This");
    const { userId } = await signUp({
      email: "pulse-stale@example.com",
      password: "Pu1se!pass123",
      name: "Pulse Tester",
    });
    await voteOn(law, userId, 30);

    const body = await pulse();
    // The record exists and has a vote. It is still not news.
    expect(body.records).toEqual([]);
  });

  test("votes and posts both count, and are reported separately", async () => {
    const law = await makeLaw("bill-both", "Voted And Written About");
    const { userId, cookie } = await signUp({
      email: "pulse-both@example.com",
      password: "Pu1se!pass123",
      name: "Pulse Tester",
    });
    await voteOn(law, userId, 1);
    await prisma.post.create({
      data: { authorId: userId, content: "a position", governmentReferenceId: law },
    });
    expect(cookie.length).toBeGreaterThan(0);

    const body = await pulse();
    expect(body.records[0]?.recentVotes).toBe(1);
    expect(body.records[0]?.recentPosts).toBe(1);
    expect(body.records[0]?.activity).toBe(2);
  });

  test("the window is honoured", async () => {
    const law = await makeLaw("bill-window", "Three Weeks Ago");
    const { userId } = await signUp({
      email: "pulse-window@example.com",
      password: "Pu1se!pass123",
      name: "Pulse Tester",
    });
    await voteOn(law, userId, 20);

    expect((await pulse("?days=7")).records).toEqual([]);
    expect((await pulse("?days=30")).records).toHaveLength(1);
  });
});

describe("it never ranks people", () => {
  test("no row names a person", async () => {
    const law = await makeLaw("bill-anon", "A Law");
    const { userId } = await signUp({
      email: "pulse-anon@example.com",
      password: "Pu1se!pass123",
      name: "Pulse Tester",
    });
    await voteOn(law, userId, 1);

    const body = await pulse();
    // Not "no leaderboard section in the UI" — no user identity in the payload
    // at all, so one cannot be built from this without a deliberate change.
    expect(JSON.stringify(body)).not.toContain(userId);
    expect(JSON.stringify(body)).not.toContain("Pulse Tester");
  });

  test("the drawer no longer renders a leaderboard", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/../../apps/web/src/components/mobile/GlobalPulseDrawer.tsx`,
    ).text();
    expect(source).not.toContain("Most Engagement Driven");
    expect(source).not.toContain("LeaderCard");
    expect(source).not.toContain("engagementLeaders");
  });
});
