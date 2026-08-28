/**
 * ONLY VERIFIED HUMANS MAY VOTE — Constitution Article I §3.
 *
 * Two halves, and the second is the one that was actually broken.
 *
 * THE BOT TEST. A confirmed email address proves an inbox, not a person.
 * Turnstile is asked at sign-up, and — this is the part worth testing — when no
 * key is configured the platform SAYS SO by name rather than reporting success
 * while checking nothing.
 *
 * THE VOTE PATHS. Three routes accepted a vote from an account nobody had
 * confirmed was a person: an impeachment vote, an impeachment withdrawal, a
 * system-reset ballot and the older bill vote. Every one of them is the same
 * hole — the heaviest votes on the platform were the ones that never asked.
 *
 * Nothing here is mocked. Turnstile is not called: with no key configured the
 * service returns `unconfigured` without a network request, which is exactly
 * the state a test environment should be in and exactly the state this suite
 * needs to assert on.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import { checkHuman, humanCheckConfigured } from "../src/services/human-check";

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
async function citizen(verified: boolean) {
  seq += 1;
  const account = await signUp({
    email: `human-${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Human ${seq}`,
    verified,
  });
  return account;
}

let refSeq = 0;
async function reference() {
  refSeq += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `human-${refSeq}-119`,
      referenceType: "bill",
      title: `A record ${refSeq}`,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function api(cookie: string | null, path: string, method = "GET", body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: freshClientHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------

describe("[art1-sec3] the bot test is never silently off", () => {
  test("WITH NO KEY CONFIGURED IT SAYS SO, rather than reporting a check", async () => {
    expect(humanCheckConfigured()).toBe(false);

    const outcome = await checkHuman("anything-at-all", null);
    // The critical bit: `checked` is false. Nothing anywhere may read this as
    // a passed test.
    expect(outcome.ok).toBe(true);
    expect(outcome.checked).toBe(false);
    expect(outcome.state).toBe("unconfigured");
  });

  test("/health reports the state by name, so it is visible somewhere", async () => {
    const response = await fetch(`${BASE_URL}/health`, { headers: freshClientHeaders() });
    const body = (await response.json()) as {
      humanCheck: { provider: string; state: string; guards: string };
    };
    expect(body.humanCheck.provider).toBe("turnstile");
    expect(body.humanCheck.state).toBe("unconfigured");
    expect(body.humanCheck.guards).toBe("sign-up");
  });

  test("the sign-up form is told whether a challenge is required", async () => {
    const response = await fetch(`${BASE_URL}/api/auth-challenge`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { configured: boolean; siteKey: string | null };
    // "No challenge here" and "the challenge failed to load" are different
    // things, and the form needs to tell them apart.
    expect(body.configured).toBe(false);
    expect(body.siteKey).toBeNull();
  });

  test("sign-up still works with no key — a country is not locked out by a missing paste", async () => {
    const account = await citizen(false);
    expect(account.userId).toBeTruthy();
  });

  test("THE GATE IS ON THE SIGN-UP PATH, and a rename cannot quietly remove it", () => {
    // The check sits in front of Better Auth rather than inside it, precisely
    // so a version bump cannot drop it. That only holds while the path matches.
    const index = readFileSync(join(import.meta.dir, "../src/index.ts"), "utf8");
    expect(index).toContain('app.post("/api/auth/sign-up/email"');
    expect(index).toContain("checkHuman(c.req.header(\"cf-turnstile-response\")");
  });

  test("signing in is deliberately not gated — the point is to stop mass sign-up", () => {
    const index = readFileSync(join(import.meta.dir, "../src/index.ts"), "utf8");
    expect(index).not.toContain('app.post("/api/auth/sign-in/email"');
  });
});

describe("[art1-sec3] the votes that never asked", () => {
  test("AN UNVERIFIED ACCOUNT CANNOT VOTE IN AN IMPEACHMENT", async () => {
    const leader = await citizen(true);
    const elector = await citizen(false);

    await prisma.delegation.create({
      data: { fromUserId: elector.userId, toUserId: leader.userId },
    });
    const filer = await citizen(true);
    await prisma.delegation.create({
      data: { fromUserId: filer.userId, toUserId: leader.userId },
    });

    const filed = await api(filer.cookie, "/api/impeachments", "POST", {
      leaderId: leader.userId,
      grounds: "They voted against the position they published and asked us to lend them our votes for.",
      evidence: "Their posts of the third and the ninth, against the positions recorded on the same bills.",
    });
    expect(filed.status).toBe(201);
    const { impeachmentId } = (await filed.json()) as { impeachmentId: string };

    const voting = await api(elector.cookie, `/api/impeachments/${impeachmentId}/vote`, "POST", {
      proposedDays: 30,
    });
    expect(voting.status).toBe(403);
    expect(((await voting.json()) as { code: string }).code).toBe("email_verification_required");

    // And nothing moved.
    const cast = await prisma.impeachmentElector.count({
      where: { impeachmentId, votedAt: { not: null } },
    });
    expect(cast).toBe(0);
  });

  test("…nor withdraw one, which moves the same tally the other way", async () => {
    const leader = await citizen(true);
    const elector = await citizen(false);
    await prisma.delegation.create({
      data: { fromUserId: elector.userId, toUserId: leader.userId },
    });
    const filer = await citizen(true);
    await prisma.delegation.create({
      data: { fromUserId: filer.userId, toUserId: leader.userId },
    });

    const filed = await api(filer.cookie, "/api/impeachments", "POST", {
      leaderId: leader.userId,
      grounds: "They voted against the position they published and asked us to lend them our votes for.",
      evidence: "Their posts of the third and the ninth, against the positions recorded on the same bills.",
    });
    const { impeachmentId } = (await filed.json()) as { impeachmentId: string };

    const withdrawing = await api(
      elector.cookie,
      `/api/impeachments/${impeachmentId}/vote`,
      "DELETE",
    );
    expect(withdrawing.status).toBe(403);
  });

  test("AN UNVERIFIED ACCOUNT CANNOT VOTE IN A SYSTEM-WIDE RESET", async () => {
    const filer = await citizen(true);
    const opened = await api(filer.cookie, "/api/system-reset", "POST", {
      grounds: "The tallies on this platform no longer describe what anybody currently believes.",
      evidence: "Half the records carry positions taken on text that has since been amended twice.",
    });
    expect(opened.status).toBe(201);
    const { resetId } = (await opened.json()) as { resetId: string };

    const unverified = await citizen(false);
    const voting = await api(unverified.cookie, `/api/system-reset/${resetId}/vote`, "POST", {
      support: true,
    });
    expect(voting.status).toBe(403);
    expect(((await voting.json()) as { code: string }).code).toBe("email_verification_required");
  });

  test("AN UNVERIFIED ACCOUNT CANNOT VOTE ON A BILL — the old path around every other check", async () => {
    const unverified = await citizen(false);
    const bill = await prisma.bill.create({
      data: {
        title: "A bill somebody wants to vote on",
        summary: "Short enough to read.",
        status: "introduced",
        chamber: "house",
        category: "healthcare",
      },
    });

    const voting = await api(unverified.cookie, `/api/bills/${bill.id}/vote`, "POST", {
      position: "support",
    });
    expect(voting.status).toBe(403);
    expect(await prisma.vote.count({ where: { billId: bill.id } })).toBe(0);
  });

  test("a verified account votes normally — the gate is verification, not obstruction", async () => {
    const verified = await citizen(true);
    const bill = await prisma.bill.create({
      data: {
        title: "A bill a verified citizen votes on",
        summary: "Short enough to read.",
        status: "introduced",
        chamber: "house",
        category: "healthcare",
      },
    });

    const voting = await api(verified.cookie, `/api/bills/${bill.id}/vote`, "POST", {
      position: "support",
    });
    expect(voting.status).toBe(200);
    expect(await prisma.vote.count({ where: { billId: bill.id } })).toBe(1);
  });
});

describe("[art2-sec3] an anonymous vote does not make you findable", () => {
  test("SOMEBODY WHO VOTED ANONYMOUSLY IS NOT RETURNED AS A SIMILAR USER", async () => {
    const reader = await citizen(true);
    const openVoter = await citizen(true);
    const anonymous = await citizen(true);

    // All three take the same position on the same three records. Two of them
    // in public; one of them anonymously.
    for (let i = 0; i < 3; i += 1) {
      const ref = await reference();
      await prisma.governmentReferenceVote.createMany({
        data: [
          { governmentReferenceId: ref.id, userId: reader.userId, position: "support" },
          { governmentReferenceId: ref.id, userId: openVoter.userId, position: "support" },
          {
            governmentReferenceId: ref.id,
            userId: anonymous.userId,
            position: "support",
            isAnonymous: true,
          },
        ],
      });
    }

    const response = await api(reader.cookie, "/api/feed/similar-users");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { users?: Array<{ id: string }> };
    const ids = (body.users ?? []).map((u) => u.id);

    // The endpoint returns NAMES. Somebody who voted anonymously being handed
    // to a stranger as "similar" discloses both that they voted and, over a few
    // records, how.
    expect(ids).not.toContain(anonymous.userId);
    expect(ids).toContain(openVoter.userId);
  });
});
