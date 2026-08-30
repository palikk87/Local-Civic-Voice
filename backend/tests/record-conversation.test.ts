/**
 * THE CONVERSATION UNDER A LAW.
 *
 * WHAT WAS WRONG. The record page printed "0 comments" and "0 shares" in a
 * quiet row and then did nothing with either number. The posts existed — this
 * endpoint has returned them since it was written — but the page never asked
 * for them, so the count was a signpost to a place with no road to it. Somebody
 * reading a law could see that eleven people had written about it and had no
 * way to read a word of what they wrote.
 *
 * WHY IT STAYED BROKEN. The payload could not satisfy the app's own Post type.
 * It carried no referenceType, no referenceId, no referenceTitle, no
 * repostsCount, and — the one that actually blocks the feature — no isLiked and
 * no isRepostedByMe. A like button cannot render without knowing whether you
 * have already liked the thing. So the card could not be built from this
 * response, and the section was quietly left out.
 *
 * WHAT THESE TESTS PIN. Two properties, and the second is the one that will
 * break first:
 *
 *   1. The endpoint returns everything a post card needs to be interactive.
 *   2. isLiked and isRepostedByMe are about the READER, not the post. Two
 *      people asking for the same conversation get different answers, and a
 *      signed-out reader gets false rather than somebody else's answer.
 *
 * The second is a leak if it is ever got wrong: a shared cache or a forgotten
 * viewer filter would show one citizen another citizen's likes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, signUp, startServer, stopServer } from "./helpers/server";

interface ConversationPost {
  id: string;
  content: string;
  author: { id: string; displayName: string; username: string };
  referenceType: string | null;
  referenceId: string | null;
  referenceTitle: string | null;
  commentsCount: number;
  likesCount: number;
  repostsCount: number;
  isLiked: boolean;
  isRepostedByMe: boolean;
  createdAt: string;
}

let referenceId = "";
let postId = "";
let liker = { cookie: "", userId: "" };
let bystander = { cookie: "", userId: "" };

const TITLE = "Veterans Healthcare Improvement Act";

async function conversation(cookie?: string): Promise<ConversationPost[]> {
  const response = await fetch(`${BASE_URL}/api/government-references/${referenceId}/posts`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { posts: ConversationPost[] };
  return body.posts;
}

beforeAll(async () => {
  await startServer();
  await resetData();

  const reference = await prisma.governmentReference.create({
    data: {
      masterReferenceId: "hr-4836-119",
      referenceType: "bill",
      title: TITLE,
      status: "committee",
      category: "healthcare",
      congress: 119,
    },
  });
  referenceId = reference.id;

  const author = await signUp({
    email: "author@record-conversation.test",
    password: "correct-horse-battery-staple",
    name: "Dana Whitfield",
  });
  liker = await signUp({
    email: "liker@record-conversation.test",
    password: "correct-horse-battery-staple",
    name: "Sam Okafor",
  });
  bystander = await signUp({
    email: "bystander@record-conversation.test",
    password: "correct-horse-battery-staple",
    name: "Riya Nandal",
  });

  const created = await fetch(`${BASE_URL}/api/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: author.cookie },
    body: JSON.stringify({
      content: "This one changes what my VA clinic can bill for.",
      governmentReferenceId: referenceId,
    }),
  });
  expect(created.status).toBe(201);
  postId = ((await created.json()) as { post: { id: string } }).post.id;

  // One person likes it. Nobody else does.
  const liked = await fetch(`${BASE_URL}/api/posts/${postId}/like`, {
    method: "POST",
    headers: { Cookie: liker.cookie },
  });
  expect([200, 201]).toContain(liked.status);
});

afterAll(async () => {
  await stopServer();
});

describe("a law's conversation is readable from the law", () => {
  test("the post shows up under the record it is about", async () => {
    const posts = await conversation(bystander.cookie);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.id).toBe(postId);
    expect(posts[0]!.content).toContain("VA clinic");
  });

  test("and it carries the law it is about, so a card can say so", async () => {
    const [post] = await conversation(bystander.cookie);
    expect(post!.referenceType).toBe("bill");
    expect(post!.referenceId).toBe(referenceId);
    expect(post!.referenceTitle).toBe(TITLE);
  });

  test("and every count a post card renders", async () => {
    const [post] = await conversation(bystander.cookie);
    expect(post!.likesCount).toBe(1);
    expect(post!.commentsCount).toBe(0);
    expect(post!.repostsCount).toBe(0);
  });
});

describe("liked and reposted are about the reader, not the post", () => {
  test("THE PERSON WHO LIKED IT SEES THAT THEY LIKED IT", async () => {
    const [post] = await conversation(liker.cookie);
    expect(post!.isLiked).toBe(true);
  });

  test("SOMEBODY ELSE DOES NOT SEE THEMSELVES AS HAVING LIKED IT", async () => {
    // The leak this guards: one citizen shown another citizen's likes as their
    // own. The count is public; who is behind it is not.
    const [post] = await conversation(bystander.cookie);
    expect(post!.isLiked).toBe(false);
    expect(post!.likesCount).toBe(1);
  });

  test("a signed-out reader gets false rather than somebody else's answer", async () => {
    const [post] = await conversation();
    expect(post!.isLiked).toBe(false);
    expect(post!.isRepostedByMe).toBe(false);
    // Still able to read the conversation. Reading a law and what people said
    // about it does not require an account.
    expect(post!.likesCount).toBe(1);
  });

  test("nobody has reposted it, and nobody is told they have", async () => {
    for (const cookie of [liker.cookie, bystander.cookie]) {
      const [post] = await conversation(cookie);
      expect(post!.isRepostedByMe).toBe(false);
      expect(post!.repostsCount).toBe(0);
    }
  });
});

describe("a law nobody has written about", () => {
  test("answers with an empty conversation rather than an error", async () => {
    // The honest empty state has to come from the server too. A 404 here would
    // put an error card under every law that has not been discussed yet, which
    // is most of them.
    const quiet = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "hr-10152-119",
        referenceType: "bill",
        title: "Open-Source AI Leadership Act",
        status: "committee",
        category: "technology",
        congress: 119,
      },
    });

    const response = await fetch(`${BASE_URL}/api/government-references/${quiet.id}/posts`);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { posts: unknown[] }).posts).toEqual([]);
  });
});
