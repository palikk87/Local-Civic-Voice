/**
 * Getting a law in front of somebody who has not seen it.
 *
 * Reposting, message notifications, searching what people said, and opening a
 * hashtag. Every one of these existed as a fragment before it existed as a
 * feature: `notifyRepost` was written and called from nowhere, hashtags were
 * collected and ranked into a trending list that could not be pressed, and
 * search found people but never a sentence anybody had written.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { extractHashtags } from "../src/services/hashtags";
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
  };
}

async function json<T>(r: Response): Promise<T> {
  return (await r.json()) as T;
}

let refCounter = 0;
async function law(title = "A bill about insulin pricing"): Promise<string> {
  refCounter += 1;
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${7000 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
  return row.id;
}

async function postAs(cookie: string, content: string, referenceId?: string): Promise<string> {
  const r = await api(cookie).post("/api/posts", {
    content,
    governmentReferenceId: referenceId ?? (await law()),
  });
  if (!r.ok) throw new Error(`post failed: ${r.status} ${await r.text()}`);
  return (await json<{ post: { id: string } }>(r)).post.id;
}

async function waitForNotification(cookie: string, type: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await json<{ notifications: Array<{ type: string }> }>(
      await api(cookie).get("/api/notifications?limit=50"),
    );
    if ((body.notifications ?? []).some((n) => n.type === type)) return true;
    await Bun.sleep(100);
  }
  return false;
}

describe("reposting", () => {
  test("passing a post on puts it in your own timeline, carrying the law", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const referenceId = await law();
    const postId = await postAs(author.cookie, "This bill caps insulin at $35.", referenceId);

    const done = await api(reader.cookie).post(`/api/posts/${postId}/repost`);
    expect(done.status).toBe(201);

    const mine = await json<{ posts: Array<{ repostOf: { id: string } | null; governmentReferenceId: string | null }> }>(
      await api(reader.cookie).get(`/api/posts?authorId=${reader.userId}`),
    );
    expect(mine.posts).toHaveLength(1);
    expect(mine.posts[0]!.repostOf?.id).toBe(postId);
    // A repost is about the law the original is about. It cannot be about
    // another one — that would be a new post.
    expect(mine.posts[0]!.governmentReferenceId).toBe(referenceId);
  });

  test("the original author is told", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Worth passing on.");

    await api(reader.cookie).post(`/api/posts/${postId}/repost`);
    expect(await waitForNotification(author.cookie, "repost")).toBe(true);
  });

  test("a quote keeps your words above theirs", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "The original point.");

    await api(reader.cookie).post(`/api/posts/${postId}/repost`, {
      content: "This is the part everyone is missing.",
    });

    const mine = await json<{ posts: Array<{ content: string; repostOf: { content: string } | null }> }>(
      await api(reader.cookie).get(`/api/posts?authorId=${reader.userId}`),
    );
    expect(mine.posts[0]!.content).toBe("This is the part everyone is missing.");
    expect(mine.posts[0]!.repostOf?.content).toBe("The original point.");
  });

  test("pressing it again takes the plain repost back", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Worth passing on.");

    const first = await json<{ reposted: boolean; repostsCount: number }>(
      await api(reader.cookie).post(`/api/posts/${postId}/repost`),
    );
    const second = await json<{ reposted: boolean; repostsCount: number }>(
      await api(reader.cookie).post(`/api/posts/${postId}/repost`),
    );

    expect(first).toMatchObject({ reposted: true, repostsCount: 1 });
    expect(second).toMatchObject({ reposted: false, repostsCount: 0 });
  });

  test("several quotes are allowed, because they say different things", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "The original point.");

    await api(reader.cookie).post(`/api/posts/${postId}/repost`, { content: "One thought." });
    await api(reader.cookie).post(`/api/posts/${postId}/repost`, { content: "And another." });

    expect(await prisma.post.count({ where: { repostOfId: postId } })).toBe(2);
  });

  test("reposting a repost points at the original, so no chain forms", async () => {
    const author = await person("author");
    const first = await person("first");
    const second = await person("second");
    const postId = await postAs(author.cookie, "The original.");

    const one = await json<{ repostId: string }>(
      await api(first.cookie).post(`/api/posts/${postId}/repost`),
    );
    await api(second.cookie).post(`/api/posts/${one.repostId}/repost`);

    // Both point at the original, so its count is the number of people who
    // passed it on rather than the depth of a game of telephone.
    const reposts = await prisma.post.findMany({
      where: { repostOfId: postId },
      select: { authorId: true },
    });
    expect(reposts).toHaveLength(2);
    expect(await prisma.post.count({ where: { repostOfId: one.repostId } })).toBe(0);
  });

  test("the button knows you have already pressed it", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Worth passing on.");

    await api(reader.cookie).post(`/api/posts/${postId}/repost`);

    const feed = await json<{ posts: Array<{ id: string; isRepostedByMe: boolean; repostsCount: number }> }>(
      await api(reader.cookie).get("/api/posts"),
    );
    const original = feed.posts.find((p) => p.id === postId)!;
    expect(original.isRepostedByMe).toBe(true);
    expect(original.repostsCount).toBe(1);
  });

  test("you cannot repost somebody you have blocked", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "Not for you.");

    await api(reader.cookie).post(`/api/safety/blocks/${author.userId}`);
    expect((await api(reader.cookie).post(`/api/posts/${postId}/repost`)).status).toBe(404);
  });
});

describe("message notifications", () => {
  test("a message tells the person it was sent to", async () => {
    const one = await person("one");
    const two = await person("two");

    const started = await json<{ conversation: { id: string } }>(
      await api(one.cookie).post("/api/messages/conversations", { participantId: two.userId }),
    );
    await api(one.cookie).post(`/api/messages/conversations/${started.conversation.id}`, {
      content: "Did you see what passed today?",
    });

    // A message that notifies nobody is only ever seen if the recipient happens
    // to open the inbox.
    expect(await waitForNotification(two.cookie, "message")).toBe(true);
    // And never the sender.
    const senders = await json<{ notifications: Array<{ type: string }> }>(
      await api(one.cookie).get("/api/notifications?limit=50"),
    );
    expect(senders.notifications.some((n) => n.type === "message")).toBe(false);
  });

  test("turning message notifications off stops them", async () => {
    const one = await person("one");
    const two = await person("two");

    await fetch(`${BASE_URL}/api/notifications/preferences`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: two.cookie }),
      body: JSON.stringify({ messages: false }),
    });

    const started = await json<{ conversation: { id: string } }>(
      await api(one.cookie).post("/api/messages/conversations", { participantId: two.userId }),
    );
    await api(one.cookie).post(`/api/messages/conversations/${started.conversation.id}`, {
      content: "Anyone there?",
    });

    await Bun.sleep(700);
    const theirs = await json<{ notifications: Array<{ type: string }> }>(
      await api(two.cookie).get("/api/notifications?limit=50"),
    );
    expect(theirs.notifications.some((n) => n.type === "message")).toBe(false);
  });
});

describe("finding what was said", () => {
  test("search finds a post by its own words", async () => {
    const author = await person("author");
    const seeker = await person("seeker");
    await postAs(author.cookie, "The insulin cap is the part that matters here.");

    const found = await json<{ results: Array<{ content: string }> }>(
      await api(seeker.cookie).get("/api/posts/search?q=insulin"),
    );
    expect(found.results.some((p) => p.content.includes("insulin cap"))).toBe(true);
  });

  test("search finds a post by the law it is attached to", async () => {
    const author = await person("author");
    const seeker = await person("seeker");
    const referenceId = await law("A bill about railway safety");
    await postAs(author.cookie, "Nothing in these words matches the query.", referenceId);

    // People search for what a law DOES. The post may never use the word.
    const found = await json<{ results: Array<{ id: string }> }>(
      await api(seeker.cookie).get("/api/posts/search?q=railway"),
    );
    expect(found.results).toHaveLength(1);
  });

  test("a blocked person's posts are not searchable", async () => {
    const author = await person("author");
    const seeker = await person("seeker");
    await postAs(author.cookie, "The insulin cap again.");
    await api(seeker.cookie).post(`/api/safety/blocks/${author.userId}`);

    const found = await json<{ results: unknown[] }>(
      await api(seeker.cookie).get("/api/posts/search?q=insulin"),
    );
    expect(found.results).toHaveLength(0);
  });

  test("a hashtag leads somewhere", async () => {
    const author = await person("author");
    const reader = await person("reader");
    const postId = await postAs(author.cookie, "This matters. #insulin");

    const tagged = await json<{ tag: string; results: Array<{ id: string }> }>(
      await api(reader.cookie).get("/api/posts/hashtag/insulin"),
    );
    expect(tagged.tag).toBe("insulin");
    expect(tagged.results.some((p) => p.id === postId)).toBe(true);
  });

  test("a tag nobody has used is empty rather than broken", async () => {
    const reader = await person("reader");
    const empty = await api(reader.cookie).get("/api/posts/hashtag/nobodyhasusedthis");
    expect(empty.status).toBe(200);
    expect((await json<{ results: unknown[] }>(empty)).results).toHaveLength(0);
  });
});

describe("what counts as a hashtag", () => {
  test("case does not make two subjects out of one", () => {
    expect(extractHashtags("#Insulin and #insulin and #INSULIN")).toEqual(["insulin"]);
  });

  test("a number is not a topic", () => {
    // "ranked #1 in the country" is not somebody filing a post under a subject.
    expect(extractHashtags("We are ranked #1 in the country")).toEqual([]);
    expect(extractHashtags("#hr3194 is the one")).toEqual(["hr3194"]);
  });

  test("punctuation ends a tag", () => {
    expect(extractHashtags("Read #insulin, then #railway.")).toEqual(["insulin", "railway"]);
  });

  test("a bare hash is nothing", () => {
    expect(extractHashtags("# and ## and #")).toEqual([]);
  });
});
