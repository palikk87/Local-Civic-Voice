/**
 * Changing your own account.
 *
 * The endpoint has existed since the beginning and nothing but the signup form
 * ever called it, so in practice an account was whatever it was on the day it
 * was made — permanently. On a platform that asks people to put their name to
 * public positions on legislation, not being able to correct that name is not
 * a missing nicety.
 *
 * The rule that matters most here is the one about the record: editing a
 * profile must not touch a single thing the person said in public. There is a
 * test for exactly that.
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

async function edit(cookie: string, changes: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/users/me`, {
    method: "PATCH",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(changes),
  });
  return { status: response.status, body: await response.json() };
}

async function publicProfile(userId: string) {
  const response = await fetch(`${BASE_URL}/api/users/${userId}`, {
    headers: freshClientHeaders({}),
  });
  return (await response.json()) as {
    displayName: string;
    username: string;
    bio: string | null;
    location: string | null;
    avatar: string;
  };
}

describe("editing your own account", () => {
  test("a name, bio and location can be changed and show up publicly", async () => {
    const person = await citizen("editor");

    const { status } = await edit(person.cookie, {
      name: "Dana Whitfield",
      bio: "Reads appropriations bills so you do not have to.",
      location: "Toledo, Ohio",
    });
    expect(status).toBe(200);

    const shown = await publicProfile(person.userId);
    expect(shown.displayName).toBe("Dana Whitfield");
    expect(shown.bio).toBe("Reads appropriations bills so you do not have to.");
    expect(shown.location).toBe("Toledo, Ohio");
  });

  test("a username can be changed and the old one becomes free", async () => {
    const first = await citizen("first");
    const second = await citizen("second");

    expect((await edit(first.cookie, { username: "appropriations" })).status).toBe(200);
    expect((await edit(first.cookie, { username: "budgetwatch" })).status).toBe(200);

    // Somebody else can now take the name the first person let go of.
    expect((await edit(second.cookie, { username: "appropriations" })).status).toBe(200);
  });

  test("a username somebody else holds is refused, and says so", async () => {
    const first = await citizen("first");
    const second = await citizen("second");

    expect((await edit(first.cookie, { username: "insulin" })).status).toBe(200);

    const clash = await edit(second.cookie, { username: "insulin" });
    expect(clash.status).toBe(409);
    expect(JSON.stringify(clash.body)).toContain("taken");
  });

  test("a username with characters the format forbids is refused", async () => {
    const person = await citizen("editor");

    for (const bad of ["Not Lowercase", "has spaces", "punctuation!", "Ünïcode"]) {
      const attempt = await edit(person.cookie, { username: bad });
      expect(attempt.status).toBe(400);
    }
  });

  test("editing a profile does not touch anything the person said in public", async () => {
    const person = await citizen("editor");
    const bill = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "hr-5150-119",
        referenceType: "bill",
        title: "A bill about insulin pricing",
        status: "proposed",
        category: "healthcare",
      },
    });

    await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ position: "support", reason: "The cap is the whole bill." }),
    });

    const post = await prisma.post.create({
      data: {
        authorId: person.userId,
        content: "Backed this because of the cap.",
        governmentReferenceId: bill.id,
      },
    });

    await edit(person.cookie, { name: "Somebody Else Entirely", bio: "New bio" });

    // The vote, the reason, and the words all stand exactly as they were.
    const vote = await prisma.governmentReferenceVote.findFirst({
      where: { userId: person.userId, governmentReferenceId: bill.id },
    });
    expect(vote?.position).toBe("support");

    const kept = await prisma.post.findUnique({ where: { id: post.id } });
    expect(kept?.content).toBe("Backed this because of the cap.");

    const events = await prisma.positionEvent.findMany({ where: { userId: person.userId } });
    expect(events.some((e) => e.reason === "The cap is the whole bill.")).toBe(true);
  });

  test("a bio past the limit is refused rather than silently cut", async () => {
    const person = await citizen("editor");
    const attempt = await edit(person.cookie, { bio: "x".repeat(501) });
    expect(attempt.status).toBe(400);
  });

  test("an image has to be a URL, not a path only one device can load", async () => {
    const person = await citizen("editor");

    expect((await edit(person.cookie, { image: "file:///var/tmp/IMG_0042.jpg" })).status).toBe(400);
    expect((await edit(person.cookie, { image: "/uploads/whatever.jpg" })).status).toBe(400);
    expect(
      (await edit(person.cookie, { image: "https://example.com/uploads/whatever.jpg" })).status,
    ).toBe(200);
  });

  test("a signed-out visitor cannot edit anybody", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me`, {
      method: "PATCH",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: "Somebody Else" }),
    });
    expect(response.status).toBe(401);
  });

  test("an empty change is accepted and changes nothing", async () => {
    const person = await citizen("editor");
    const before = await publicProfile(person.userId);

    expect((await edit(person.cookie, {})).status).toBe(200);

    const after = await publicProfile(person.userId);
    expect(after.displayName).toBe(before.displayName);
    expect(after.username).toBe(before.username);
  });
});
