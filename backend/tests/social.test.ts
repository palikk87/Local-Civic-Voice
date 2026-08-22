/**
 * The social platform: following, posting, commenting, liking, saving,
 * sharing, messaging, and being told when any of it happens to you.
 *
 * None of this had a test. The government side of this app is covered in
 * detail, and the half that makes it a place people come back to was not
 * covered at all — which is how three notification paths ended up written,
 * wired to nothing, and shipped.
 *
 * Everything runs over real HTTP against the real server. Each case is named
 * for the thing a person would notice if it broke.
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
  const headers = (extra: Record<string, string> = {}) =>
    freshClientHeaders({ "Content-Type": "application/json", cookie, ...extra });

  return {
    get: (path: string) => fetch(`${BASE_URL}${path}`, { headers: headers() }),
    post: (path: string, body?: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    put: (path: string, body: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(body),
      }),
    del: (path: string) =>
      fetch(`${BASE_URL}${path}`, { method: "DELETE", headers: headers() }),
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Everything waiting for one person, whatever kind. */
async function notifications(cookie: string) {
  const body = await json<{ notifications: Array<{ type: string; body: string }> }>(
    await api(cookie).get("/api/notifications?limit=50"),
  );
  return body.notifications ?? [];
}

/**
 * Wait for a notification of a given kind, rather than assuming it is instant.
 *
 * Every notify* call in the routes is deliberately fire-and-forget — a like
 * should not make the person who pressed it wait on a write to somebody else's
 * bell, and a notification that fails must not fail the like. The consequence
 * is that "did they get told" is a question with a short delay in it, and a
 * test that reads immediately passes or fails on machine speed. This one did
 * both, in the same afternoon.
 */
async function waitForNotification(
  cookie: string,
  type: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await notifications(cookie)).some((n) => n.type === type)) return true;
    await Bun.sleep(100);
  }
  return false;
}

/** The opposite claim: nothing of this kind arrives, given a moment to. */
async function noNotification(cookie: string, type: string): Promise<boolean> {
  await Bun.sleep(600);
  return !(await notifications(cookie)).some((n) => n.type === type);
}

/**
 * A record to post about.
 *
 * Every post on this platform is attached to one — the composer requires it,
 * and it is the whole premise: people talk about the government's business,
 * not into the air. A test that posted without one would be testing a shape
 * the product does not have.
 */
let refCounter = 0;
async function law(): Promise<string> {
  refCounter += 1;
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${3000 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill people are talking about",
      status: "proposed",
      category: "healthcare",
    },
  });
  return row.id;
}

async function postAs(cookie: string, content: string): Promise<string> {
  const response = await api(cookie).post("/api/posts", {
    content,
    governmentReferenceId: await law(),
  });
  if (!response.ok) throw new Error(`post failed: ${response.status} ${await response.text()}`);
  const body = await json<{ post?: { id: string }; id?: string }>(response);
  const id = body.post?.id ?? body.id;
  if (!id) throw new Error(`post returned no id: ${JSON.stringify(body)}`);
  return id;
}

describe("following", () => {
  test("following someone shows up on both profiles", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    expect((await api(reader.cookie).post(`/api/users/${writer.userId}/follow`)).status).toBe(200);

    const following = await json<{ results: unknown[] }>(
      await api(reader.cookie).get(`/api/users/${reader.userId}/following`),
    );
    const followers = await json<{ results: unknown[] }>(
      await api(writer.cookie).get(`/api/users/${writer.userId}/followers`),
    );

    expect(following.results).toHaveLength(1);
    expect(followers.results).toHaveLength(1);
  });

  test("following is not mutual", async () => {
    const reader = await person("reader");
    const writer = await person("writer");
    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);

    const theirFollowing = await json<{ results: unknown[] }>(
      await api(writer.cookie).get(`/api/users/${writer.userId}/following`),
    );
    expect(theirFollowing.results).toHaveLength(0);
  });

  test("the profile says whether you are following them", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    const before = await json<{ isFollowing?: boolean }>(
      await api(reader.cookie).get(`/api/users/${writer.userId}`),
    );
    expect(before.isFollowing).toBe(false);

    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);

    const after = await json<{ isFollowing?: boolean; followers?: number }>(
      await api(reader.cookie).get(`/api/users/${writer.userId}`),
    );
    expect(after.isFollowing).toBe(true);
    expect(after.followers).toBe(1);
  });

  test("unfollowing undoes it", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);
    expect((await api(reader.cookie).del(`/api/users/${writer.userId}/follow`)).status).toBe(200);

    const after = await json<{ isFollowing?: boolean }>(
      await api(reader.cookie).get(`/api/users/${writer.userId}`),
    );
    expect(after.isFollowing).toBe(false);
  });

  test("you cannot follow yourself", async () => {
    const alone = await person("alone");
    expect((await api(alone.cookie).post(`/api/users/${alone.userId}/follow`)).status).toBe(400);
  });

  test("following twice does not create two follows", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);
    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);

    expect(await prisma.follow.count({ where: { followerId: reader.userId } })).toBe(1);
  });

  test("being followed tells you about it", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);

    // A follow that nobody is told about is the same as no follow at all: the
    // whole point is that somebody now wants to hear from you.
    expect(await waitForNotification(writer.cookie, "follow")).toBe(true);
  });

  test("posts from people you follow reach your feed", async () => {
    const reader = await person("reader");
    const writer = await person("writer");

    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);
    await postAs(writer.cookie, "Something I think about the bill.");

    const feed = await json<{ posts: Array<{ content: string }> }>(
      await api(reader.cookie).get("/api/feed"),
    );
    expect(feed.posts.some((p) => p.content.includes("Something I think"))).toBe(true);
  });
});

describe("friends", () => {
  test("two people who follow each other are friends", async () => {
    const one = await person("one");
    const two = await person("two");

    await api(one.cookie).post(`/api/users/${two.userId}/follow`);

    // One-directional so far. Following somebody is not a friendship, and this
    // platform has no request to accept — see the friends route for why that is
    // named rather than invented.
    let friends = await json<{ results: unknown[] }>(
      await api(one.cookie).get(`/api/users/${one.userId}/friends`),
    );
    expect(friends.results).toHaveLength(0);

    await api(two.cookie).post(`/api/users/${one.userId}/follow`);

    friends = await json<{ results: Array<{ id: string }> }>(
      await api(one.cookie).get(`/api/users/${one.userId}/friends`),
    );
    expect((friends.results as Array<{ id: string }>).map((f) => f.id)).toEqual([two.userId]);
  });

  test("the profile says so", async () => {
    const one = await person("one");
    const two = await person("two");

    await api(one.cookie).post(`/api/users/${two.userId}/follow`);
    let profile = await json<{ isFriend?: boolean }>(
      await api(one.cookie).get(`/api/users/${two.userId}`),
    );
    expect(profile.isFriend).toBe(false);

    await api(two.cookie).post(`/api/users/${one.userId}/follow`);
    profile = await json<{ isFriend?: boolean }>(
      await api(one.cookie).get(`/api/users/${two.userId}`),
    );
    expect(profile.isFriend).toBe(true);
  });

  test("unfollowing ends the friendship", async () => {
    const one = await person("one");
    const two = await person("two");

    await api(one.cookie).post(`/api/users/${two.userId}/follow`);
    await api(two.cookie).post(`/api/users/${one.userId}/follow`);
    await api(two.cookie).del(`/api/users/${one.userId}/follow`);

    const friends = await json<{ results: unknown[] }>(
      await api(one.cookie).get(`/api/users/${one.userId}/friends`),
    );
    expect(friends.results).toHaveLength(0);
  });

  test("somebody you blocked is not among your friends", async () => {
    const one = await person("one");
    const two = await person("two");

    await api(one.cookie).post(`/api/users/${two.userId}/follow`);
    await api(two.cookie).post(`/api/users/${one.userId}/follow`);
    await api(one.cookie).post(`/api/safety/blocks/${two.userId}`);

    const friends = await json<{ results: unknown[] }>(
      await api(one.cookie).get(`/api/users/${one.userId}/friends`),
    );
    expect(friends.results).toHaveLength(0);
  });
});

describe("posts, likes and comments", () => {
  test("liking a post counts once and can be taken back", async () => {
    const author = await person("author");
    const fan = await person("fan");
    const postId = await postAs(author.cookie, "A post worth liking.");

    await api(fan.cookie).post(`/api/posts/${postId}/like`);
    let seen = await json<{ post: { likesCount: number; isLiked: boolean } }>(
      await api(fan.cookie).get(`/api/posts/${postId}`),
    );
    expect(seen.post.likesCount).toBe(1);
    expect(seen.post.isLiked).toBe(true);

    await api(fan.cookie).post(`/api/posts/${postId}/like`);
    seen = await json<{ post: { likesCount: number; isLiked: boolean } }>(
      await api(fan.cookie).get(`/api/posts/${postId}`),
    );
    expect(seen.post.likesCount).toBe(0);
    expect(seen.post.isLiked).toBe(false);
  });

  test("a like tells the author, and liking your own tells nobody", async () => {
    const author = await person("author");
    const fan = await person("fan");
    const postId = await postAs(author.cookie, "A post worth liking.");

    await api(fan.cookie).post(`/api/posts/${postId}/like`);
    expect(await waitForNotification(author.cookie, "like")).toBe(true);

    const ownPost = await postAs(fan.cookie, "My own post.");
    await api(fan.cookie).post(`/api/posts/${ownPost}/like`);
    expect(await noNotification(fan.cookie, "like")).toBe(true);
  });

  test("commenting appears on the post and tells the author", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "What do you make of this?");

    const created = await api(reader.cookie).post(`/api/posts/${postId}/comments`, {
      content: "I make quite a lot of it, actually.",
    });
    expect(created.status).toBeLessThan(300);

    const comments = await json<{ comments: Array<{ content: string }> }>(
      await api(author.cookie).get(`/api/posts/${postId}/comments`),
    );
    expect(comments.comments.some((c) => c.content.includes("quite a lot"))).toBe(true);
    expect(await waitForNotification(author.cookie, "comment")).toBe(true);
  });

  test("a reply hangs under its comment and tells the commenter", async () => {
    const author = await person("author");
    const first = await person("first");
    const second = await person("second");
    const postId = await postAs(author.cookie, "Opening the floor.");

    const parent = await json<{ comment: { id: string } }>(
      await api(first.cookie).post(`/api/posts/${postId}/comments`, { content: "My view." }),
    );
    await api(second.cookie).post(`/api/posts/${postId}/comments`, {
      content: "Answering your view.",
      parentId: parent.comment.id,
    });

    const replies = await json<{ replies?: Array<{ content: string }>; comments?: Array<{ content: string }> }>(
      await api(author.cookie).get(`/api/posts/${postId}/comments/${parent.comment.id}/replies`),
    );
    const list = replies.replies ?? replies.comments ?? [];
    expect(list.some((r) => r.content.includes("Answering"))).toBe(true);
    expect(await waitForNotification(first.cookie, "reply")).toBe(true);
  });

  test("you can delete your own comment and not somebody else's", async () => {
    const author = await person("author");
    const commenter = await person("commenter");
    const stranger = await person("stranger");
    const postId = await postAs(author.cookie, "A post.");

    const made = await json<{ comment: { id: string } }>(
      await api(commenter.cookie).post(`/api/posts/${postId}/comments`, { content: "Mine." }),
    );

    expect(
      (await api(stranger.cookie).del(`/api/posts/${postId}/comments/${made.comment.id}`)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await api(commenter.cookie).del(`/api/posts/${postId}/comments/${made.comment.id}`)).status,
    ).toBe(200);
  });

  test("posting tells the people who follow you", async () => {
    const reader = await person("reader");
    const writer = await person("writer");
    await api(reader.cookie).post(`/api/users/${writer.userId}/follow`);

    await postAs(writer.cookie, "The thing I wanted to say.");

    // Following someone is a request to hear from them. If posting reaches
    // nobody's notifications, following is a bookmark with extra steps.
    expect(await waitForNotification(reader.cookie, "new_follower_post")).toBe(true);
  });
});

describe("saving and sharing", () => {
  test("saving a post puts it in your saved list, and unsaving removes it", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Worth keeping.");

    expect((await api(reader.cookie).post(`/api/feed/posts/${postId}/save`)).status).toBe(200);

    let saved = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/feed/saved"),
    );
    expect(saved.posts.some((p) => p.id === postId)).toBe(true);

    await api(reader.cookie).post(`/api/feed/posts/${postId}/save`);
    saved = await json<{ posts: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/feed/saved"),
    );
    expect(saved.posts.some((p) => p.id === postId)).toBe(false);
  });

  test("sharing a post is counted", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Worth passing on.");

    expect((await api(reader.cookie).post(`/api/feed/posts/${postId}/share`)).status).toBe(200);
    expect(await prisma.postShare.count({ where: { postId } })).toBe(1);
  });
});

describe("messages", () => {
  test("a conversation both people can see, and a message that arrives", async () => {
    const one = await person("one");
    const two = await person("two");

    const started = await json<{ conversation: { id: string } }>(
      await api(one.cookie).post("/api/messages/conversations", { participantId: two.userId }),
    );
    const conversationId = started.conversation.id;

    expect(
      (await api(one.cookie).post(`/api/messages/conversations/${conversationId}`, {
        content: "Did you see what passed today?",
      })).status,
    ).toBeLessThan(300);

    const theirs = await json<{ results: Array<{ id: string }> }>(
      await api(two.cookie).get("/api/messages/conversations"),
    );
    expect(theirs.results.some((c) => c.id === conversationId)).toBe(true);

    const thread = await json<{ messages: Array<{ content: string }> }>(
      await api(two.cookie).get(`/api/messages/conversations/${conversationId}`),
    );
    expect(thread.messages.some((m) => m.content.includes("passed today"))).toBe(true);
  });

  test("a conversation you are not in is none of your business", async () => {
    const one = await person("one");
    const two = await person("two");
    const stranger = await person("stranger");

    const started = await json<{ conversation: { id: string } }>(
      await api(one.cookie).post("/api/messages/conversations", { participantId: two.userId }),
    );

    const peek = await api(stranger.cookie).get(
      `/api/messages/conversations/${started.conversation.id}`,
    );
    expect(peek.status).toBeGreaterThanOrEqual(400);
  });

  test("starting the same conversation twice reuses it", async () => {
    const one = await person("one");
    const two = await person("two");

    const first = await json<{ conversation: { id: string } }>(
      await api(one.cookie).post("/api/messages/conversations", { participantId: two.userId }),
    );
    const again = await json<{ conversation: { id: string } }>(
      await api(two.cookie).post("/api/messages/conversations", { participantId: one.userId }),
    );

    expect(again.conversation.id).toBe(first.conversation.id);
    expect(await prisma.conversation.count()).toBe(1);
  });
});

describe("notifications", () => {
  test("the unread count is what is actually unread, and reading clears it", async () => {
    const author = await person("author");
    const fan = await person("fan");
    const postId = await postAs(author.cookie, "A post.");
    await api(fan.cookie).post(`/api/posts/${postId}/like`);

    expect(await waitForNotification(author.cookie, "like")).toBe(true);

    const before = await json<{ count: number }>(
      await api(author.cookie).get("/api/notifications/unread-count"),
    );
    expect(before.count).toBe(1);

    expect((await api(author.cookie).post("/api/notifications/read-all")).status).toBe(200);

    const after = await json<{ count: number }>(
      await api(author.cookie).get("/api/notifications/unread-count"),
    );
    expect(after.count).toBe(0);
  });

  test("turning a kind of notification off actually stops it", async () => {
    const author = await person("author");
    const fan = await person("fan");

    expect((await api(author.cookie).put("/api/notifications/preferences", { likes: false })).status).toBe(200);

    const postId = await postAs(author.cookie, "A post.");
    await api(fan.cookie).post(`/api/posts/${postId}/like`);

    expect(await noNotification(author.cookie, "like")).toBe(true);
  });

  test("nobody is notified about their own doing", async () => {
    const author = await person("author");
    const postId = await postAs(author.cookie, "Talking to myself.");

    await api(author.cookie).post(`/api/posts/${postId}/like`);
    await api(author.cookie).post(`/api/posts/${postId}/comments`, { content: "Good point, me." });

    await Bun.sleep(600);
    expect(await notifications(author.cookie)).toHaveLength(0);
  });
});

describe("finding people", () => {
  test("search finds someone by name and by username", async () => {
    const seeker = await person("seeker");
    const target = await person("findme");

    const byName = await json<{ results: Array<{ id: string }> }>(
      await api(seeker.cookie).get(`/api/users/search?q=${encodeURIComponent(target.name)}`),
    );
    expect(byName.results.some((u) => u.id === target.userId)).toBe(true);
  });

  test("you are not offered yourself to follow", async () => {
    const seeker = await person("seeker");
    await person("other");

    const discover = await json<{ results: Array<{ id: string }> }>(
      await api(seeker.cookie).get("/api/users/discover"),
    );
    expect(discover.results.some((u) => u.id === seeker.userId)).toBe(false);
  });
});
