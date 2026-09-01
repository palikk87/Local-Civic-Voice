/**
 * A person changes their own words, and only their own words.
 *
 * WHY THIS EXISTS. Reported through the app's own bug reporter: "The edit post
 * button doesn't go anywhere ... It should allow you to edit your post and its
 * content. Not the original law posted but the content that the poster added
 * to it."
 *
 * It went nowhere because there was nothing to go to — PATCH /api/posts/:id did
 * not exist. The menu item called an undefined handler, closed the sheet, and
 * that was the whole feature.
 *
 * The distinction in that report is the design: a post is somebody's words
 * ABOUT a record, and the record is what everybody replying, voting and passing
 * it on is responding to. The words are the author's to change. The law is not.
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
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

function api(cookie?: string) {
  const headers = () =>
    freshClientHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    });
  return {
    post: (path: string, body?: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    patch: (path: string, body: unknown) =>
      fetch(`${BASE_URL}${path}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(body),
      }),
  };
}

let refCounter = 0;
async function law() {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${7000 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill somebody wrote about",
      status: "proposed",
      category: "healthcare",
    },
  });
}

async function postBy(cookie: string, body: Record<string, unknown>) {
  const response = await api(cookie).post("/api/posts", body);
  expect(response.status).toBe(201);
  const { post } = (await response.json()) as { post: { id: string } };
  return post.id;
}

describe("editing your own post", () => {
  test("the author changes their words, and the post says it was edited", async () => {
    const author = await person("author");
    // Every post on this platform is about a record — the composer requires
    // one — so every case here attaches a law, the way a real post does.
    const reference = await law();
    const id = await postBy(author.cookie, {
      content: "I said the wrong thing",
      governmentReferenceId: reference.id,
    });

    const before = await prisma.post.findUnique({ where: { id } });
    expect(before?.editedAt).toBeNull();

    const response = await api(author.cookie).patch(`/api/posts/${id}`, {
      content: "I said what I meant this time",
    });
    expect(response.status).toBe(200);

    const after = await prisma.post.findUnique({ where: { id } });
    expect(after?.content).toBe("I said what I meant this time");
    // Not a silent rewrite: people reply to and pass on posts here, so a post
    // whose words moved carries the fact on its face.
    expect(after?.editedAt).not.toBeNull();
  });

  test("THE LAW UNDER THE POST CANNOT BE CHANGED BY EDITING IT", async () => {
    const author = await person("author");
    const original = await law();
    const other = await law();

    const id = await postBy(author.cookie, {
      content: "Here is why this matters",
      governmentReferenceId: original.id,
    });

    // Ask it to swap the record as well as the words. The words are the
    // author's; the record is what everybody else responded to.
    const response = await api(author.cookie).patch(`/api/posts/${id}`, {
      content: "Different words",
      governmentReferenceId: other.id,
      referenceId: other.id,
    });
    expect(response.status).toBe(200);

    const after = await prisma.post.findUnique({ where: { id } });
    expect(after?.content).toBe("Different words");
    expect(after?.governmentReferenceId).toBe(original.id);
  });

  test("somebody else's post is not theirs to edit", async () => {
    const author = await person("author");
    const stranger = await person("stranger");
    const reference = await law();
    const id = await postBy(author.cookie, {
      content: "My own words",
      governmentReferenceId: reference.id,
    });

    const response = await api(stranger.cookie).patch(`/api/posts/${id}`, {
      content: "Words I am putting in your mouth",
    });
    expect(response.status).toBe(403);

    const after = await prisma.post.findUnique({ where: { id } });
    expect(after?.content).toBe("My own words");
    expect(after?.editedAt).toBeNull();
  });

  test("a signed-out visitor cannot edit anything", async () => {
    const author = await person("author");
    const reference = await law();
    const id = await postBy(author.cookie, {
      content: "My own words",
      governmentReferenceId: reference.id,
    });

    const response = await api().patch(`/api/posts/${id}`, { content: "Anonymous rewrite" });
    expect(response.status).toBe(401);

    const after = await prisma.post.findUnique({ where: { id } });
    expect(after?.content).toBe("My own words");
  });

  test("emptying a post that is only words is refused", async () => {
    // The composer will not make one of these — every post it creates carries a
    // law — but rows from older builds have no reference, and an edit must not
    // be the way a post becomes nothing at all. Written straight to the table,
    // because the API cannot produce this shape.
    const author = await person("author");
    const post = await prisma.post.create({
      data: { content: "The only thing this post is", authorId: author.userId },
    });

    const response = await api(author.cookie).patch(`/api/posts/${post.id}`, { content: "   " });
    expect(response.status).toBe(400);

    const after = await prisma.post.findUnique({ where: { id: post.id } });
    expect(after?.content).toBe("The only thing this post is");
    expect(after?.editedAt).toBeNull();
  });

  test("but emptying the words on a post carrying a law is allowed", async () => {
    // The same rule the composer applies: a law on its own IS a post, so
    // removing your commentary from one leaves something that still stands.
    const author = await person("author");
    const reference = await law();
    const id = await postBy(author.cookie, {
      content: "Something I would rather not have said",
      governmentReferenceId: reference.id,
    });

    const response = await api(author.cookie).patch(`/api/posts/${id}`, { content: "" });
    expect(response.status).toBe(200);

    const after = await prisma.post.findUnique({ where: { id } });
    expect(after?.content).toBe("");
    expect(after?.governmentReferenceId).toBe(reference.id);
  });

  test("a post that does not exist is a 404, not a crash", async () => {
    const author = await person("author");
    const response = await api(author.cookie).patch("/api/posts/no-such-post", {
      content: "Into the void",
    });
    expect(response.status).toBe(404);
  });
});
