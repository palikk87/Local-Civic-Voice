/**
 * Only verified human beings may contribute to the Pulse.
 *
 * Constitution Article I, Section 3, marked `enforcedInCode: true` while
 * nothing enforced it — `emailVerified` sat on the User table, set by nothing
 * and read by nothing. Bill of Rights Article III lists "Anti-bot
 * verification" as a principle and gives the reason: no bot-driven influence
 * shall obscure the true will of the people.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. It proves an account that has not
 * entered its emailed code cannot move a tally, lend a voice, or put words on
 * the public record. It does not prove the person is real — a disposable inbox
 * defeats it. This is a speed bump on the cheapest attack, and the tests are
 * named for what they actually check.
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
async function citizen(label: string, verified = true) {
  seq += 1;
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
    verified,
  });
}

let refCounter = 0;
async function law(title = "A bill about insulin pricing") {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${5200 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function withCookie(cookie: string, extra: Record<string, string> = {}) {
  return freshClientHeaders({ "Content-Type": "application/json", cookie, ...extra });
}

describe("an unverified account cannot contribute to the Pulse", () => {
  test("it cannot vote, and the tally does not move", async () => {
    const unverified = await citizen("unverified", false);
    const bill = await law();

    const response = await fetch(
      `${BASE_URL}/api/government-references/${bill.id}/vote`,
      {
        method: "POST",
        headers: withCookie(unverified.cookie),
        body: JSON.stringify({ position: "support" }),
      },
    );

    expect(response.status).toBe(403);
    // A stable code, so a client can offer "send another code" rather than a
    // dead end.
    expect(((await response.json()) as { code: string }).code).toBe(
      "email_verification_required",
    );

    const record = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: bill.id },
    });
    expect(record.supportVotes).toBe(0);
    expect(
      await prisma.governmentReferenceVote.count({ where: { userId: unverified.userId } }),
    ).toBe(0);
  });

  test("it cannot lend its voice to a delegate", async () => {
    const unverified = await citizen("unverified", false);
    const delegate = await citizen("delegate");

    const response = await fetch(`${BASE_URL}/api/delegations`, {
      method: "POST",
      headers: withCookie(unverified.cookie),
      body: JSON.stringify({ toUserId: delegate.userId }),
    });

    // A delegation moves published tallies the moment the delegate votes, so
    // it is contributing to the Pulse just as surely as voting is.
    expect(response.status).toBe(403);
    expect(await prisma.delegation.count({ where: { fromUserId: unverified.userId } })).toBe(0);
  });

  test("it cannot post, comment, or repost", async () => {
    const unverified = await citizen("unverified", false);
    const author = await citizen("author");
    const bill = await law();

    const theirPost = await prisma.post.create({
      data: { authorId: author.userId, content: "A real post.", governmentReferenceId: bill.id },
    });

    const posted = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: withCookie(unverified.cookie),
      body: JSON.stringify({ content: "Let me in.", governmentReferenceId: bill.id }),
    });
    expect(posted.status).toBe(403);

    const commented = await fetch(`${BASE_URL}/api/posts/${theirPost.id}/comments`, {
      method: "POST",
      headers: withCookie(unverified.cookie),
      body: JSON.stringify({ content: "Let me in." }),
    });
    expect(commented.status).toBe(403);

    const reposted = await fetch(`${BASE_URL}/api/posts/${theirPost.id}/repost`, {
      method: "POST",
      headers: withCookie(unverified.cookie),
      body: JSON.stringify({}),
    });
    expect(reposted.status).toBe(403);

    expect(await prisma.post.count({ where: { authorId: unverified.userId } })).toBe(0);
    expect(await prisma.comment.count({ where: { authorId: unverified.userId } })).toBe(0);
  });
});

describe("what stays open to somebody who has not finished signing up", () => {
  test("they can still read the government's business", async () => {
    const unverified = await citizen("unverified", false);
    const bill = await law("A bill they should be able to read");

    // A platform that hides the government's business behind a verification
    // wall has misunderstood which part is the public good.
    const record = await fetch(`${BASE_URL}/api/government-references/${bill.id}`, {
      headers: freshClientHeaders({ cookie: unverified.cookie }),
    });
    expect(record.status).toBe(200);

    const feed = await fetch(`${BASE_URL}/api/feed?limit=5`, {
      headers: freshClientHeaders({ cookie: unverified.cookie }),
    });
    expect(feed.status).toBe(200);

    const ranking = await fetch(`${BASE_URL}/api/feed/ranking`, {
      headers: freshClientHeaders({ cookie: unverified.cookie }),
    });
    expect(ranking.status).toBe(200);
  });
});

describe("verifying opens the gate", () => {
  test("the same account votes once its email is confirmed", async () => {
    const person = await citizen("later", false);
    const bill = await law();

    const before = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ position: "support" }),
    });
    expect(before.status).toBe(403);

    // What entering the emailed code does.
    await prisma.user.update({ where: { id: person.userId }, data: { emailVerified: true } });

    // The SAME session, deliberately: a session minted before verification
    // must not keep somebody locked out until it expires, which is a miserable
    // way to be told the code worked.
    const after = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: withCookie(person.cookie),
      body: JSON.stringify({ position: "support" }),
    });
    expect(after.status).toBe(200);

    const record = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: bill.id },
    });
    expect(record.supportVotes).toBe(1);
  });

  test("a verified account is what the rest of this suite gets", async () => {
    // The harness marks accounts verified so four hundred tests can be about
    // what they were written for. If that default ever silently stops
    // applying, this fails rather than every other file at once.
    const person = await citizen("default");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: person.userId } });
    expect(row.emailVerified).toBe(true);
  });
});
