/**
 * THE SCORE IS THE SAME NUMBER ON EVERY DEVICE, BECAUSE IT IS COUNTED, NOT KEPT.
 *
 * Reported as a streak "showing 1 thing on my computer but something else on
 * my phone". Both were right: the score lived in the browser, so two devices
 * kept two tallies and clearing a cache erased a person's civic history.
 *
 * These tests are about the arithmetic and about what the score refuses to do.
 * The interesting cases are not "does ten votes make a hundred points" — it is
 * the daily cap, the streak surviving midnight, and the absence of any way to
 * read somebody else's.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, signUp, startServer, stopServer } from "./helpers/server";
import { civicScoreFor, POINTS, DAILY_CAP, levelFor, BADGES, LEVELS, MAX_SCORE } from "../src/services/civic-score";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

/** A post on a given day, which is the cheapest scoring action to fabricate. */
async function postOn(userId: string, day: string, count = 1): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await prisma.post.create({
      data: {
        authorId: userId,
        content: `post ${day} ${i}`,
        createdAt: new Date(`${day}T12:00:00.000Z`),
      },
    });
  }
}

const dayAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe("the score counts what is there", () => {
  test("a brand new account scores nothing, and says so plainly", async () => {
    const { userId } = await signUp({ email: "score-new@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    const score = await civicScoreFor(userId);

    expect(score.total).toBe(0);
    expect(score.counts).toEqual({ votes: 0, posts: 0, comments: 0 });
    expect(score.streak.current).toBe(0);
    // Not "1 to get started" or any other encouragement dressed as a number.
    expect(score.level).toBe("newcomer");
  });

  test("posts on different days each count", async () => {
    const { userId } = await signUp({ email: "score-posts@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    await postOn(userId, dayAgo(3));
    await postOn(userId, dayAgo(2));

    const score = await civicScoreFor(userId);
    expect(score.counts.posts).toBe(2);
    expect(score.total).toBe(POINTS.post * 2);
  });

  test("deleting a post takes its points with it", async () => {
    // THE PROPERTY A LEDGER WOULD NOT HAVE. Points that were written down when
    // the post was made would outlive the post; a count cannot.
    const { userId } = await signUp({ email: "score-delete@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    await postOn(userId, dayAgo(1));
    expect((await civicScoreFor(userId)).total).toBe(POINTS.post);

    await prisma.post.deleteMany({ where: { authorId: userId } });
    expect((await civicScoreFor(userId)).total).toBe(0);
  });
});

describe("a day has a ceiling", () => {
  test("a hundred posts in one day do not score a hundred posts", async () => {
    const { userId } = await signUp({ email: "score-cap@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    await postOn(userId, dayAgo(1), 100);

    const score = await civicScoreFor(userId);
    expect(score.counts.posts).toBe(100);
    // Somebody who posts a hundred times in one sitting has not been a hundred
    // times more civic than somebody who posted ten times.
    expect(score.total).toBe(DAILY_CAP);
  });

  test("the same activity spread across days is worth more", async () => {
    const { userId: burst } = await signUp({ email: "score-burst@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    const { userId: steady } = await signUp({ email: "score-steady@example.com", password: "Sc0re!pass123", name: "Score Tester" });

    await postOn(burst, dayAgo(1), 30);
    for (let day = 1; day <= 30; day += 1) await postOn(steady, dayAgo(day));

    // The point of the cap, stated as the comparison it exists to make.
    expect((await civicScoreFor(steady)).total).toBeGreaterThan(
      (await civicScoreFor(burst)).total,
    );
  });
});

describe("the streak", () => {
  test("counts unbroken days back from today", async () => {
    const { userId } = await signUp({ email: "score-streak@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    for (const day of [0, 1, 2]) await postOn(userId, dayAgo(day));

    const score = await civicScoreFor(userId);
    expect(score.streak.current).toBe(3);
    expect(score.streak.activeToday).toBe(true);
  });

  test("survives today being empty, and ends when a day is missed", async () => {
    // A streak that breaks the moment midnight passes is one nobody can keep.
    const { userId } = await signUp({ email: "score-midnight@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    for (const day of [1, 2]) await postOn(userId, dayAgo(day));

    const score = await civicScoreFor(userId);
    expect(score.streak.current).toBe(2);
    expect(score.streak.activeToday).toBe(false);
  });

  test("a gap ends it, and the longest run is still remembered", async () => {
    const { userId } = await signUp({ email: "score-gap@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    // Five days in a row, a week off, then two days.
    for (const day of [10, 11, 12, 13, 14]) await postOn(userId, dayAgo(day));
    for (const day of [0, 1]) await postOn(userId, dayAgo(day));

    const score = await civicScoreFor(userId);
    expect(score.streak.current).toBe(2);
    // Missing a fortnight does not erase having once turned up five days running.
    expect(score.streak.longest).toBe(5);
  });
});

describe("the level follows the number", () => {
  test("each band claims its own edges", () => {
    expect(levelFor(0).id).toBe("newcomer");
    expect(levelFor(249).id).toBe("newcomer");
    expect(levelFor(250).id).toBe("citizen");
    expect(levelFor(MAX_SCORE).id).toBe("leader");
  });

  test("the progress within a band is reported, not left to be guessed", async () => {
    const { userId } = await signUp({ email: "score-level@example.com", password: "Sc0re!pass123", name: "Score Tester" });
    for (let day = 1; day <= 4; day += 1) await postOn(userId, dayAgo(day), 4);

    const score = await civicScoreFor(userId);
    expect(score.total).toBe(POINTS.post * 16);
    expect(score.intoLevel + score.toNextLevel).toBe(score.levelSpan);
  });
});

describe("it is your score and nobody else's", () => {
  test("the endpoint refuses a stranger", async () => {
    const response = await fetch(`${BASE_URL}/api/me/civic-score`);
    expect(response.status).toBe(401);
  });

  test("there is no route that reads somebody else's", async () => {
    // A score other people can read is a score people compare, and comparing
    // people is the one thing this platform says it does not do. Asserted
    // against the source so adding one is a decision somebody has to make on
    // purpose, in front of this test.
    const source = await Bun.file(`${import.meta.dir}/../src/index.ts`).text();
    expect(source).not.toMatch(/civic-score.*:(id|userId)/);
    expect(source).toContain("/api/me/civic-score");
  });
});


describe("the ladder keeps going", () => {
  test("every band is harder to cross than the one before it", () => {
    // The old scale topped out in about twenty days and then had nothing left
    // to climb. Each band is wider than its predecessor now, so the effort to
    // leave one always exceeds the effort that got you into it.
    const widths = LEVELS.map((band) => band.max - band.min + 1);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
    }
  });

  test("the bands cover the whole range with no gap and no overlap", () => {
    // A score that falls between two bands has no level, and levelFor would
    // quietly answer "newcomer" to somebody who had earned far more.
    expect(LEVELS[0]!.min).toBe(0);
    expect(LEVELS[LEVELS.length - 1]!.max).toBe(MAX_SCORE);
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.min).toBe(LEVELS[i - 1]!.max + 1);
    }
  });

  test("every badge ladder rises, and no two badges share an id", () => {
    const ids = BADGES.map((badge) => badge.id);
    expect(new Set(ids).size).toBe(ids.length);

    const byKind = new Map<string, number[]>();
    for (const badge of BADGES) {
      byKind.set(badge.kind, [...(byKind.get(badge.kind) ?? []), badge.requirement]);
    }
    for (const [kind, requirements] of byKind) {
      const sorted = [...requirements].sort((a, b) => a - b);
      expect({ kind, requirements }).toEqual({ kind, requirements: sorted });
      expect(new Set(requirements).size).toBe(requirements.length);
    }
  });
});

describe("badges are earned from what happened", () => {
  test("a new account has every badge locked and none of them hidden", async () => {
    const { userId } = await signUp({
      email: "score-badges-new@example.com",
      password: "Sc0re!pass123",
      name: "Score Tester",
    });
    const score = await civicScoreFor(userId);

    expect(score.badges).toHaveLength(BADGES.length);
    expect(score.badges.every((badge) => !badge.earned)).toBe(true);
    // Locked badges still say what earns them, or the ladder is invisible.
    expect(score.badges.every((badge) => badge.description.length > 0)).toBe(true);
  });

  test("writing posts earns the writing ladder and nothing else", async () => {
    const { userId } = await signUp({
      email: "score-badges-posts@example.com",
      password: "Sc0re!pass123",
      name: "Score Tester",
    });
    for (let day = 1; day <= 12; day += 1) await postOn(userId, dayAgo(day));

    const score = await civicScoreFor(userId);
    const earned = score.badges.filter((badge) => badge.earned).map((badge) => badge.id);

    expect(earned).toContain("first_post");
    expect(earned).toContain("ten_posts");
    // Twelve posts is not fifty, and it is certainly not a vote.
    expect(earned).not.toContain("fifty_posts");
    expect(earned).not.toContain("first_vote");
  });

  test("progress never exceeds the requirement it is drawn against", async () => {
    // A bar that fills past its own end is how "3 of 1" reaches a screen.
    const { userId } = await signUp({
      email: "score-badges-progress@example.com",
      password: "Sc0re!pass123",
      name: "Score Tester",
    });
    for (let day = 1; day <= 5; day += 1) await postOn(userId, dayAgo(day), 3);

    const score = await civicScoreFor(userId);
    for (const badge of score.badges) {
      expect(badge.progress).toBeLessThanOrEqual(badge.requirement);
      expect(badge.earned).toBe(badge.progress >= badge.requirement);
    }
  });
});


describe("the endpoint actually serves it", () => {
  /**
   * The tests above call the function. This one goes over HTTP with a real
   * session, because "the function returns the right number" and "the app can
   * get the number" are different claims and only the second one is the
   * feature.
   */
  test("a signed-in reader gets their own counted score", async () => {
    const { cookie, userId } = await signUp({
      email: "score-http@example.com",
      password: "Sc0re!pass123",
      name: "Score Tester",
    });
    await postOn(userId, dayAgo(1), 2);
    await postOn(userId, dayAgo(0));

    const response = await fetch(`${BASE_URL}/api/me/civic-score`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      score: {
        total: number;
        levelTitle: string;
        counts: { posts: number };
        streak: { current: number };
        badges: Array<{ id: string; earned: boolean }>;
        levels: Array<{ id: string }>;
        activeDays: string[];
      };
    };

    expect(body.score.counts.posts).toBe(3);
    expect(body.score.total).toBe(POINTS.post * 3);
    expect(body.score.streak.current).toBe(2);
    expect(body.score.activeDays).toHaveLength(2);

    // The shape the page depends on is present and populated, not merely typed.
    expect(body.score.levels).toHaveLength(6);
    expect(body.score.badges.length).toBeGreaterThan(20);
    expect(body.score.badges.find((badge) => badge.id === "first_post")?.earned).toBe(true);
    expect(body.score.levelTitle.length).toBeGreaterThan(0);
  });

  test("two devices asking get the same answer", async () => {
    // The whole point of the change. Two independent requests, no shared
    // client state between them, same number.
    const { cookie, userId } = await signUp({
      email: "score-devices@example.com",
      password: "Sc0re!pass123",
      name: "Score Tester",
    });
    await postOn(userId, dayAgo(2), 4);

    const read = async () => {
      const response = await fetch(`${BASE_URL}/api/me/civic-score`, {
        headers: { Cookie: cookie },
      });
      return ((await response.json()) as { score: { total: number; streak: { longest: number } } }).score;
    };

    const phone = await read();
    const laptop = await read();
    expect(phone.total).toBe(laptop.total);
    expect(phone.streak.longest).toBe(laptop.streak.longest);
  });
});
