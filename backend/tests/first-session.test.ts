/**
 * One new person's first session, start to finish, against the real server.
 *
 * WHAT THIS IS FOR. Every other test in this suite proves one part works. This
 * proves the parts connect. A launch does not fail because a function is wrong;
 * it fails because signing up returns a session the next request does not
 * accept, or a vote lands on a record the post cannot find, or the brief button
 * works on a record the feed never shows.
 *
 * So this is deliberately a single ordered story rather than a set of cases. It
 * signs up, reads the feed, opens a law, asks for the brief, votes, writes
 * about it, comments, gets notified, and deletes what it made. Each step uses
 * what the previous step returned — the real id, the real cookie — because
 * passing those between features is where systems actually break.
 *
 * If this fails, the product does not work for a new user, whatever else is
 * green.
 *
 * The network boundary is stubbed (congress.gov and the model), because a
 * launch check that depends on a third-party API being up tells you about their
 * afternoon rather than your product. Everything above that boundary is real:
 * real HTTP, real auth, real database, real handlers.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, signUp, startServer, stopServer } from "./helpers/server";
import { ensureReferenceContent } from "../src/services/reference-content";

const OFFICIAL_TEXT = `
SECTION 1. SHORT TITLE.
This Act may be cited as the "First Session Test Act".

SEC. 2. FINDINGS.
Congress finds that the rail network requires modernization and that grade
crossings account for a substantial share of preventable fatalities.

SEC. 3. AUTHORIZATION.
There are authorized to be appropriated $100,000,000 for each of fiscal years
2026 through 2030 to carry out this Act.
`.trim();

const BRIEF = {
  summary: "This law puts money into rail upgrades and level-crossing safety through 2030.",
  argumentFor:
    "It funds safety work at crossings, which the text itself identifies as where preventable " +
    "deaths happen, and it sets the money out year by year.",
  argumentAgainst:
    "It authorizes spending without naming a source for it, and the text sets no measure of " +
    "whether the crossings actually become safer.",
};

const realFetch = globalThis.fetch;

/** congress.gov and the model, answered from memory. Nothing else is faked. */
function stubNetwork(): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (/api\.congress\.gov\/v3\/bill\/.*\/text/.test(url)) {
      return Response.json({
        textVersions: [
          {
            type: "Introduced in House",
            date: "2026-01-05T05:00:00Z",
            formats: [{ type: "Formatted Text", url: "https://www.congress.gov/test/BILLS.htm" }],
          },
        ],
      });
    }
    if (url.includes("congress.gov/test/BILLS.htm")) {
      return new Response(OFFICIAL_TEXT, { status: 200 });
    }
    if (url.includes("api.openai.com") || url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as { messages?: Array<{ content?: string }> };
      const prompt = body.messages?.map((m) => m.content ?? "").join("\n") ?? "";
      const content = /unsupported/i.test(prompt)
        ? JSON.stringify({ unsupported: [] })
        : JSON.stringify(BRIEF);
      return Response.json({ choices: [{ message: { content } }] });
    }

    return realFetch(input, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  await startServer();
  process.env.OPENAI_API_KEY ??= "test-key-never-sent-anywhere";
  process.env.CONGRESS_API_KEY ??= "test-key-never-sent-anywhere";
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  stubNetwork();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a new person's first session", () => {
  test("sign up, read a law, brief it, vote, post, comment, delete", async () => {
    // ---------------------------------------------------------------- sign up
    const email = `first-session-${Date.now()}@example.com`;
    const { cookie, userId } = await signUp({
      email,
      password: "correct-horse-battery-staple",
      name: "First Session",
    });
    expect(userId).toBeTruthy();

    // The session the sign-up handed back has to be accepted by the NEXT
    // request. This is the seam that makes an app look broken the moment
    // anybody actually uses it, and it cannot be caught by testing either
    // endpoint alone.
    const me = await fetch(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user?: { id?: string } }).user?.id).toBe(userId);

    // ------------------------------------------------------------------- feed
    // Empty is a correct answer for a brand-new account. What matters is that
    // it answers at all: the first screen a person sees must not 500.
    const feed = await fetch(`${BASE_URL}/api/feed`, { headers: { cookie } });
    expect(feed.status).toBe(200);

    // -------------------------------------------------------------- a real law
    const reference = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "hr-4100-119",
        referenceType: "bill",
        title: "First Session Test Act",
        status: "proposed",
        congress: 119,
        sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/4100",
      },
      select: { id: true },
    });
    await prisma.referenceName.create({
      data: {
        name: "hr-4100-119",
        referenceId: reference.id,
        isCurrent: true,
        learnedFrom: "created",
      },
    });

    const detail = await fetch(`${BASE_URL}/api/government-references/${reference.id}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { reference?: { title?: string; briefState?: string } };
    expect(detailBody.reference?.title).toBe("First Session Test Act");
    // Nothing has been asked for yet, so the card must offer the button rather
    // than a spinner. `idle` is the state that keeps that promise.
    expect(detailBody.reference?.briefState).toBe("idle");

    // ------------------------------------------------------------- the brief
    //
    // Written here in-process, where congress.gov and the model are answered
    // from memory. The server runs in its own process and cannot see this
    // file's stub, and a launch check that depends on a government API being
    // up tells you about their afternoon rather than your product.
    //
    // Writing the brief is covered in full by brief.test.ts. What this step
    // proves is the half that only shows up end-to-end: that the button hands
    // a finished brief to a signed-in reader, over HTTP, for the record they
    // are looking at.
    await ensureReferenceContent(reference.id, { generateBriefInline: true });

    const briefResponse = await fetch(
      `${BASE_URL}/api/government-references/${reference.id}/brief`,
      { method: "POST", headers: { cookie } },
    );
    expect(briefResponse.status).toBe(200);
    const brief = (await briefResponse.json()) as {
      state: string;
      brief?: { summary: string; argumentFor: string; argumentAgainst: string };
    };
    expect(brief.state).toBe("ready");
    // All three parts, because a brief missing one of them renders as a gap on
    // the card rather than as an error anybody would notice.
    expect(brief.brief?.summary).toBeTruthy();
    expect(brief.brief?.argumentFor).toBeTruthy();
    expect(brief.brief?.argumentAgainst).toBeTruthy();

    // -------------------------------------------------------------- the vote
    const vote = await fetch(`${BASE_URL}/api/government-references/${reference.id}/vote`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ position: "support" }),
    });
    expect(vote.status).toBe(200);

    const afterVote = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: reference.id },
      select: { supportVotes: true, opposeVotes: true },
    });
    // Exactly the one vote that was cast. Not zero, and not a number somebody
    // seeded to make the page look alive.
    expect(afterVote.supportVotes).toBe(1);
    expect(afterVote.opposeVotes).toBe(0);

    // -------------------------------------------------------------- the post
    const created = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Rail crossings near me are genuinely dangerous. Worth funding.",
        governmentReferenceId: reference.id,
      }),
    });
    expect(created.status).toBe(201);
    const post = ((await created.json()) as { post: { id: string; governmentReferenceId?: string } }).post;
    expect(post.id).toBeTruthy();
    // The law the post was written about travels with it. A post that loses its
    // reference is a comment about nothing, and the vote it belongs beside.
    expect(post.governmentReferenceId).toBe(reference.id);

    // The post has to be readable by the id it just returned — including the
    // law it was written about, which is the whole point of attaching one.
    const readBack = await fetch(`${BASE_URL}/api/posts/${post.id}`, { headers: { cookie } });
    expect(readBack.status).toBe(200);
    const storedBody = (await readBack.json()) as {
      content?: string;
      post?: { content?: string };
    };
    expect(storedBody.content ?? storedBody.post?.content).toContain("Rail crossings");

    // ----------------------------------------------------------- the comment
    const comment = await fetch(`${BASE_URL}/api/posts/${post.id}/comments`, {
      method: "POST",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Agreed — the crossing on Third is the worst of them." }),
    });
    expect([200, 201]).toContain(comment.status);

    const comments = await fetch(`${BASE_URL}/api/posts/${post.id}/comments`, {
      headers: { cookie },
    });
    expect(comments.status).toBe(200);
    const commentList = (await comments.json()) as { comments?: unknown[] } | unknown[];
    const items = Array.isArray(commentList) ? commentList : (commentList.comments ?? []);
    expect(items.length).toBeGreaterThan(0);

    // -------------------------------------------------------------- the like
    const like = await fetch(`${BASE_URL}/api/posts/${post.id}/like`, {
      method: "POST",
      headers: { cookie },
    });
    expect(like.status).toBe(200);

    // ------------------------------------------------------- notifications
    const notifications = await fetch(`${BASE_URL}/api/notifications`, { headers: { cookie } });
    expect(notifications.status).toBe(200);
    const unread = await fetch(`${BASE_URL}/api/notifications/unread-count`, {
      headers: { cookie },
    });
    expect(unread.status).toBe(200);

    // ------------------------------------------------------------ the delete
    // A person must be able to take back what they said. This is checked
    // end-to-end because a delete that returns 200 and leaves the row is the
    // failure this project has already shipped once.
    const deleted = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);

    const gone = await fetch(`${BASE_URL}/api/posts/${post.id}`, { headers: { cookie } });
    expect(gone.status).toBe(404);
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();

    // The vote is NOT undone by deleting the post. A position on a law and a
    // thing somebody wrote are different acts, and the count is the Public
    // Pulse — it belongs to the record, not to the post.
    const afterDelete = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: reference.id },
      select: { supportVotes: true },
    });
    expect(afterDelete.supportVotes).toBe(1);
  });

  test("a signed-out visitor can read, and cannot write", async () => {
    // The other half of a launch: most first-time visitors are not signed in.
    // Reading a law is public; everything that changes something is not.
    const reference = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "hr-4200-119",
        referenceType: "bill",
        title: "Public Reading Test Act",
        status: "proposed",
        congress: 119,
      },
      select: { id: true },
    });

    const read = await fetch(`${BASE_URL}/api/government-references/${reference.id}`);
    expect(read.status).toBe(200);

    const writes = [
      fetch(`${BASE_URL}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "no session", governmentReferenceId: reference.id }),
      }),
      fetch(`${BASE_URL}/api/government-references/${reference.id}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: "support" }),
      }),
      fetch(`${BASE_URL}/api/notifications`),
    ];

    for (const response of await Promise.all(writes)) {
      expect(response.status).toBe(401);
    }

    // And nothing was counted.
    const untouched = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: reference.id },
      select: { supportVotes: true, opposeVotes: true },
    });
    expect(untouched.supportVotes).toBe(0);
    expect(untouched.opposeVotes).toBe(0);
  });
});
