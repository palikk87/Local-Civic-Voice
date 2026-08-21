/**
 * Blocking, muting, reporting, and liking a comment.
 *
 * The clients have offered Mute, Report and Block from a menu since before any
 * of them had an endpoint — wired to optional callbacks nobody passed. Pressing
 * them did nothing at all, silently, which is worse than not offering them:
 * somebody being harassed pressed Block and believed it had worked.
 *
 * A BLOCK IS ONLY AS GOOD AS ITS LEAST CAREFUL QUERY. Hiding somebody from the
 * feed while leaving them in search, in a comment thread, in a followers list,
 * or reachable by message is the same failure to the person who blocked them.
 * So most of what follows is one case per surface.
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
async function person(label: string) {
  seq += 1;
  const account = await signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
  return { ...account, name: `${label} ${seq}` };
}

function api(cookie: string) {
  const headers = () => freshClientHeaders({ "Content-Type": "application/json", cookie });
  return {
    get: (path: string) => fetch(`${BASE_URL}${path}`, { headers: headers() }),
    post: (path: string, body?: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    del: (path: string) => fetch(`${BASE_URL}${path}`, { method: "DELETE", headers: headers() }),
  };
}

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

let refCounter = 0;
async function law(): Promise<string> {
  refCounter += 1;
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${6000 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill people argue about",
      status: "proposed",
      category: "healthcare",
    },
  });
  return row.id;
}

async function postAs(cookie: string, content: string): Promise<string> {
  const r = await api(cookie).post("/api/posts", {
    content,
    governmentReferenceId: await law(),
  });
  if (!r.ok) throw new Error(`post failed: ${r.status} ${await r.text()}`);
  const body = await json<{ post: { id: string } }>(r);
  return body.post.id;
}

describe("blocking", () => {
  test("their posts leave every list you can see", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    const postId = await postAs(nuisance.cookie, "Something you would rather not read.");

    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    const feed = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/feed"),
    );
    const list = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/posts"),
    );
    const byAuthor = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get(`/api/posts?authorId=${nuisance.userId}`),
    );
    const single = await api(reader.cookie).get(`/api/posts/${postId}`);

    expect(feed.posts.some((p) => p.id === postId)).toBe(false);
    expect(list.posts.some((p) => p.id === postId)).toBe(false);
    // Typing their profile URL must not be a way around it.
    expect(byAuthor.posts).toHaveLength(0);
    expect(single.status).toBe(404);
  });

  test("it works in both directions, whoever pressed it", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    const theirPost = await postAs(reader.cookie, "The blocker's own post.");

    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    // The person who was blocked cannot see the blocker either.
    const single = await api(nuisance.cookie).get(`/api/posts/${theirPost}`);
    expect(single.status).toBe(404);
  });

  test("nobody is told they were blocked", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    const profile = await api(nuisance.cookie).get(`/api/users/${reader.userId}`);
    const body = await profile.text();

    // "Not found" is what an account that never existed looks like. Anything
    // that says "blocked" is an instruction to make a second account.
    expect(profile.status).toBe(404);
    expect(body.toLowerCase()).not.toContain("block");
  });

  test("existing follows are severed in both directions", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");

    await api(reader.cookie).post(`/api/users/${nuisance.userId}/follow`);
    await api(nuisance.cookie).post(`/api/users/${reader.userId}/follow`);
    expect(await prisma.follow.count()).toBe(2);

    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    // A block that leaves a follow in place is not a block: their posts would
    // still arrive through the following feed, and the blocker would still be
    // in a follower count they can read.
    expect(await prisma.follow.count()).toBe(0);
  });

  test("a delegation between them is withdrawn, and the tally moves at once", async () => {
    const leader = await person("leader");
    const follower = await person("follower");

    // Earn eligibility the way the rules read.
    await prisma.user.update({
      where: { id: leader.userId },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.post.create({ data: { authorId: leader.userId, content: `Saying ${i}.` } });
    }
    for (let i = 0; i < 20; i += 1) {
      const ref = await prisma.governmentReference.create({
        data: {
          masterReferenceId: `hr-${8000 + refCounter++}-119`,
          referenceType: "bill",
          title: "Track record",
          status: "proposed",
          category: "infrastructure",
        },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: ref.id, userId: leader.userId, position: "support" },
      });
    }

    const billId = await law();
    await api(follower.cookie).post("/api/delegations", { toUserId: leader.userId });
    await api(leader.cookie).post(`/api/government-references/${billId}/vote`, {
      position: "support",
    });

    const before = await prisma.governmentReference.findUniqueOrThrow({ where: { id: billId } });
    expect(before.supportVotes).toBe(2);

    await api(follower.cookie).post(`/api/safety/blocks/${leader.userId}`);

    // Nobody should be lending their political voice to somebody they have just
    // refused to deal with — and the published number has to say so at once.
    expect(await prisma.delegation.count()).toBe(0);
    const after = await prisma.governmentReference.findUniqueOrThrow({ where: { id: billId } });
    expect(after.supportVotes).toBe(1);
  });

  test("they cannot follow you, message you, or reply to you", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    const postId = await postAs(reader.cookie, "A post with a comment section.");

    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    expect((await api(nuisance.cookie).post(`/api/users/${reader.userId}/follow`)).status).toBe(404);
    expect(
      (await api(nuisance.cookie).post("/api/messages/conversations", {
        participantId: reader.userId,
      })).status,
    ).toBe(404);
    expect(
      (await api(nuisance.cookie).post(`/api/posts/${postId}/comments`, { content: "Hello again." }))
        .status,
    ).toBe(403);
  });

  test("a conversation from before the block accepts nothing more", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");

    const started = await json<{ conversation: { id: string } }>(
      await api(nuisance.cookie).post("/api/messages/conversations", {
        participantId: reader.userId,
      }),
    );

    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    const sent = await api(nuisance.cookie).post(
      `/api/messages/conversations/${started.conversation.id}`,
      { content: "Still here." },
    );
    expect(sent.status).toBe(403);
  });

  test("their comments disappear from threads you read", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    const postId = await postAs(reader.cookie, "Open floor.");

    await api(nuisance.cookie).post(`/api/posts/${postId}/comments`, { content: "Bait." });
    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    const comments = await json<{ comments: unknown[] }>(
      await api(reader.cookie).get(`/api/posts/${postId}/comments`),
    );
    expect(comments.comments).toHaveLength(0);
  });

  test("they are not searchable or suggested", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    const search = await json<{ results: Array<{ id: string }> }>(
      await api(reader.cookie).get(`/api/users/search?q=${encodeURIComponent(nuisance.name)}`),
    );
    const discover = await json<{ results: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/users/discover"),
    );

    expect(search.results.some((u) => u.id === nuisance.userId)).toBe(false);
    expect(discover.results.some((u) => u.id === nuisance.userId)).toBe(false);
  });

  test("unblocking restores contact but not the follows", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");
    await api(reader.cookie).post(`/api/users/${nuisance.userId}/follow`);
    await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`);

    expect((await api(reader.cookie).del(`/api/safety/blocks/${nuisance.userId}`)).status).toBe(200);
    expect((await api(nuisance.cookie).get(`/api/users/${reader.userId}`)).status).toBe(200);

    // Unblocking is not un-unfollowing. Getting them back is a decision.
    expect(await prisma.follow.count()).toBe(0);
  });

  test("blocking twice is fine, and you cannot block yourself", async () => {
    const reader = await person("reader");
    const nuisance = await person("nuisance");

    expect((await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`)).status).toBe(200);
    expect((await api(reader.cookie).post(`/api/safety/blocks/${nuisance.userId}`)).status).toBe(200);
    expect(await prisma.block.count()).toBe(1);

    expect((await api(reader.cookie).post(`/api/safety/blocks/${reader.userId}`)).status).toBe(400);
  });
});

describe("muting", () => {
  test("their posts leave your feed and everything else carries on", async () => {
    const reader = await person("reader");
    const loud = await person("loud");
    const postId = await postAs(loud.cookie, "The fortieth post today.");

    await api(reader.cookie).post(`/api/safety/mutes/${loud.userId}`);

    const feed = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/feed"),
    );
    expect(feed.posts.some((p) => p.id === postId)).toBe(false);

    // A mute is about attention, not contact: they can still reach you, and
    // they are never told.
    expect((await api(loud.cookie).get(`/api/users/${reader.userId}`)).status).toBe(200);
    expect(
      (await api(loud.cookie).post("/api/messages/conversations", { participantId: reader.userId }))
        .status,
    ).toBeLessThan(300);
  });

  test("unmuting brings them back", async () => {
    const reader = await person("reader");
    const loud = await person("loud");
    const postId = await postAs(loud.cookie, "Back again.");

    await api(reader.cookie).post(`/api/safety/mutes/${loud.userId}`);
    await api(reader.cookie).del(`/api/safety/mutes/${loud.userId}`);

    const feed = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/feed"),
    );
    expect(feed.posts.some((p) => p.id === postId)).toBe(true);
  });

  test("one person's mute does not hide the post from anybody else", async () => {
    const fussy = await person("fussy");
    const bystander = await person("bystander");
    const loud = await person("loud");
    const postId = await postAs(loud.cookie, "A post two people can see.");

    // The fussy one looks first and mutes.
    await api(fussy.cookie).get("/api/feed");
    await api(fussy.cookie).post(`/api/safety/mutes/${loud.userId}`);
    await api(fussy.cookie).get("/api/feed");

    // THE BYSTANDER MUTED NOBODY. The feed used to cache its base page under a
    // key with no user in it, so whatever the first caller got was served to
    // everyone for the next two minutes — which turned one person's mute into
    // everybody's. The cache is gone; this is here so it does not come back.
    const theirs = await json<{ posts: Array<{ id: string }> }>(
      await api(bystander.cookie).get("/api/feed"),
    );
    expect(theirs.posts.some((p) => p.id === postId)).toBe(true);
  });

  test("the list of who you have muted and blocked is yours to read", async () => {
    const reader = await person("reader");
    const one = await person("one");
    const two = await person("two");

    await api(reader.cookie).post(`/api/safety/mutes/${one.userId}`);
    await api(reader.cookie).post(`/api/safety/blocks/${two.userId}`);

    const mutes = await json<{ results: Array<{ user: { id: string } }> }>(
      await api(reader.cookie).get("/api/safety/mutes"),
    );
    const blocks = await json<{ results: Array<{ user: { id: string } }> }>(
      await api(reader.cookie).get("/api/safety/blocks"),
    );

    expect(mutes.results.map((m) => m.user.id)).toEqual([one.userId]);
    expect(blocks.results.map((b) => b.user.id)).toEqual([two.userId]);
  });
});

describe("reporting", () => {
  test("a report is filed and nothing is removed", async () => {
    const reader = await person("reader");
    const author = await person("author");
    const postId = await postAs(author.cookie, "Something contested.");

    const filed = await api(reader.cookie).post("/api/safety/reports", {
      postId,
      reason: "misinformation",
      detail: "The bill does not say this.",
    });
    expect(filed.status).toBe(201);

    // Reports are evidence, not an action. A platform that hides content the
    // moment somebody complains has handed anybody with a grudge a delete
    // button.
    expect((await api(reader.cookie).get(`/api/posts/${postId}`)).status).toBe(200);
    expect(await prisma.report.count({ where: { status: "open" } })).toBe(1);
  });

  test("reporting the same thing twice does not fill the queue", async () => {
    const reader = await person("reader");
    const author = await person("author");
    const postId = await postAs(author.cookie, "Something contested.");

    await api(reader.cookie).post("/api/safety/reports", { postId, reason: "spam" });
    const second = await api(reader.cookie).post("/api/safety/reports", { postId, reason: "spam" });

    expect(second.status).toBe(200);
    expect(await prisma.report.count()).toBe(1);
  });

  test("a report needs exactly one target and a real one", async () => {
    const reader = await person("reader");
    const author = await person("author");
    const postId = await postAs(author.cookie, "A post.");

    expect((await api(reader.cookie).post("/api/safety/reports", { reason: "spam" })).status).toBe(400);
    expect(
      (await api(reader.cookie).post("/api/safety/reports", {
        postId,
        userId: author.userId,
        reason: "spam",
      })).status,
    ).toBe(400);
    expect(
      (await api(reader.cookie).post("/api/safety/reports", {
        postId: "no-such-post",
        reason: "spam",
      })).status,
    ).toBe(404);
    expect(
      (await api(reader.cookie).post("/api/safety/reports", { postId, reason: "vibes" })).status,
    ).toBe(400);
  });

  test("you cannot report yourself", async () => {
    const reader = await person("reader");
    expect(
      (await api(reader.cookie).post("/api/safety/reports", {
        userId: reader.userId,
        reason: "spam",
      })).status,
    ).toBe(400);
  });
});

describe("comment likes", () => {
  test("the heart fills, counts, and can be taken back", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Open floor.");

    const made = await json<{ comment: { id: string } }>(
      await api(author.cookie).post(`/api/posts/${postId}/comments`, { content: "My view." }),
    );

    const liked = await json<{ isLiked: boolean; likesCount: number }>(
      await api(reader.cookie).post(`/api/posts/${postId}/comments/${made.comment.id}/like`),
    );
    expect(liked).toEqual({ isLiked: true, likesCount: 1 });

    const asRead = await json<{ comments: Array<{ isLiked: boolean; likesCount: number }> }>(
      await api(reader.cookie).get(`/api/posts/${postId}/comments`),
    );
    expect(asRead.comments[0]!.isLiked).toBe(true);
    expect(asRead.comments[0]!.likesCount).toBe(1);

    const unliked = await json<{ isLiked: boolean; likesCount: number }>(
      await api(reader.cookie).post(`/api/posts/${postId}/comments/${made.comment.id}/like`),
    );
    expect(unliked).toEqual({ isLiked: false, likesCount: 0 });
  });

  test("somebody else's like is not shown as yours", async () => {
    const author = await person("author");
    const one = await person("one");
    const two = await person("two");
    const postId = await postAs(author.cookie, "Open floor.");

    const made = await json<{ comment: { id: string } }>(
      await api(author.cookie).post(`/api/posts/${postId}/comments`, { content: "My view." }),
    );
    await api(one.cookie).post(`/api/posts/${postId}/comments/${made.comment.id}/like`);

    const asTwo = await json<{ comments: Array<{ isLiked: boolean; likesCount: number }> }>(
      await api(two.cookie).get(`/api/posts/${postId}/comments`),
    );
    expect(asTwo.comments[0]!.likesCount).toBe(1);
    expect(asTwo.comments[0]!.isLiked).toBe(false);
  });
});
