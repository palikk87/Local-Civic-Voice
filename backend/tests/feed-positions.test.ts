/**
 * The feed reads what people actually voted on, and always carries the other
 * side.
 *
 * TWO PROBLEMS, ONE CAUSE. The ranker computed a reader's category preference
 * and their "similar users" from `Vote` — the legacy Bill table — while every
 * client on the platform votes through /api/government-references/:id/vote,
 * which writes `GovernmentReferenceVote`. So the personalisation that was
 * supposed to make this feed about legislation read an empty table, and what
 * was left was engagement and recency: the same feed as everywhere else.
 *
 * And the thing this platform can do that no feed can — put somebody in front
 * of the people who took the opposite position on a record they both voted on,
 * as a matter of record rather than a guess — was not being done at all.
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
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

let refCounter = 0;
async function law(title: string, category = "healthcare") {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${3000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category,
    },
  });
}

function position(userId: string, referenceId: string, pos: "support" | "oppose") {
  return prisma.governmentReferenceVote.create({
    data: { governmentReferenceId: referenceId, userId, position: pos },
  });
}

async function post(authorId: string, referenceId: string, content: string) {
  return prisma.post.create({
    data: { authorId, content, governmentReferenceId: referenceId },
  });
}

interface FeedPost {
  id: string;
  authorId: string;
  governmentReferenceId: string | null;
  feedReason: string;
}

async function feed(cookie: string, type = "for_you") {
  const response = await fetch(`${BASE_URL}/api/feed?type=${type}&limit=30`, {
    headers: freshClientHeaders({ cookie }),
  });
  const body = (await response.json()) as { posts?: FeedPost[] };
  return body.posts ?? [];
}

/** "People like you", computed from shared positions. */
async function similar(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/feed/similar-users`, {
    headers: freshClientHeaders({ cookie }),
  });
  const body = (await response.json()) as { users?: { id: string }[] };
  return body.users ?? [];
}

describe("the feed reads the votes people actually cast", () => {
  test("somebody who has only ever voted through the reference endpoints still has similar users", async () => {
    const reader = await citizen("reader");
    const twin = await citizen("twin");
    const stranger = await citizen("stranger");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await position(reader.userId, bill.id, "support");
      await position(twin.userId, bill.id, "support");
      await position(stranger.userId, bill.id, "oppose");
    }

    // This was empty for every account on the platform: the query read the
    // legacy Vote table, which nothing has written to since the reference
    // endpoints took over.
    const found = await similar(reader.cookie);
    expect(found.map((u) => u.id)).toContain(twin.userId);
  });

  test("a post about a record you took a position on outranks one you never touched", async () => {
    const reader = await citizen("reader");
    const author = await citizen("author");

    const mine = await law("A bill I voted on");
    const other = await law("A bill I have never seen");

    await position(reader.userId, mine.id, "support");

    const relevant = await post(author.userId, mine.id, "About the bill you voted on.");
    const irrelevant = await post(author.userId, other.id, "About something else entirely.");

    // Asserted on ORDER rather than on a score, because order is what the
    // reader actually experiences and the score is not in the response.
    const posts = await feed(reader.cookie);
    const relevantAt = posts.findIndex((p) => p.id === relevant.id);
    const irrelevantAt = posts.findIndex((p) => p.id === irrelevant.id);

    expect(relevantAt).toBeGreaterThanOrEqual(0);
    expect(irrelevantAt).toBeGreaterThanOrEqual(0);
    expect(relevantAt).toBeLessThan(irrelevantAt);
  });
});

describe("the other side is not left to chance", () => {
  test("somebody who voted the opposite way is carried into the feed and labelled", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");

    const bill = await law("A bill about insulin");
    await position(reader.userId, bill.id, "support");
    await position(opponent.userId, bill.id, "oppose");

    const theirs = await post(opponent.userId, bill.id, "Here is why the cap is wrong.");

    const posts = await feed(reader.cookie);
    const found = posts.find((p) => p.id === theirs.id);

    expect(found).toBeDefined();
    // Labelled, not smuggled in. A feed that quietly rearranges what somebody
    // sees is the thing this is meant to be an alternative to.
    expect(found?.feedReason).toContain("other way");
  });

  test("agreeing is not penalised — the other side is a floor, not a tax", async () => {
    const reader = await citizen("reader");
    const ally = await citizen("ally");

    const bill = await law("A bill about insulin");
    await position(reader.userId, bill.id, "support");
    await position(ally.userId, bill.id, "support");

    const theirs = await post(ally.userId, bill.id, "Agreed, and here is why.");

    const posts = await feed(reader.cookie);
    const found = posts.find((p) => p.id === theirs.id);

    expect(found).toBeDefined();
    expect(found?.feedReason).not.toContain("other way");
  });

  test("a blocked opponent is not carried in by the other-side rule", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");

    const bill = await law("A bill about insulin");
    await position(reader.userId, bill.id, "support");
    await position(opponent.userId, bill.id, "oppose");

    const theirs = await post(opponent.userId, bill.id, "Here is why the cap is wrong.");

    // Negative control: present before the block.
    expect((await feed(reader.cookie)).map((p) => p.id)).toContain(theirs.id);

    const blocked = await fetch(`${BASE_URL}/api/safety/blocks/${opponent.userId}`, {
      method: "POST",
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    expect(blocked.status).toBe(200);

    expect((await feed(reader.cookie)).map((p) => p.id)).not.toContain(theirs.id);
  });

  test("a reader with no positions gets a feed rather than an error", async () => {
    const reader = await citizen("reader");
    const author = await citizen("author");
    const bill = await law("A bill about insulin");
    const theirs = await post(author.userId, bill.id, "Something about a bill.");

    const posts = await feed(reader.cookie);
    expect(posts.map((p) => p.id)).toContain(theirs.id);
  });
});
