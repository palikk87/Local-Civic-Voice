/**
 * The platform against its own Constitution and Bill of Rights.
 *
 * Every clause these cover is marked `enforcedInCode: true` in
 * packages/civic-core. That marking was aspirational in three places, and this
 * file is the difference between claiming compliance and being able to show it.
 *
 *   Article II (BoR)  — no engagement-based amplification; only the verifiable
 *                       weight of Liquid Democracy decides prominence;
 *                       transparent ranking factors.
 *   Article IV (BoR)  — an anonymous voting option that actually exists.
 *   Article I (Const) — the Pulse counts every verified citizen, including the
 *                       ones who voted anonymously.
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
  const name = `${label} ${seq}`;
  return {
    ...(await signUp({
      email: `${label}${seq}@example.com`,
      password: "test-password-not-a-real-one",
      name,
    })),
    name,
  };
}

let refCounter = 0;
async function law(title: string) {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${1100 + refCounter}-119`,
      referenceType: "bill",
      title,
      status: "proposed",
      category: "healthcare",
    },
  });
}

function vote(
  cookie: string,
  referenceId: string,
  position: string,
  extra: Record<string, unknown> = {},
) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ position, ...extra }),
  });
}

async function post(authorId: string, referenceId: string, content: string) {
  return prisma.post.create({
    data: { authorId, content, governmentReferenceId: referenceId },
  });
}

async function feed(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/feed?type=for_you&limit=30`, {
    headers: freshClientHeaders({ cookie }),
  });
  const body = (await response.json()) as {
    posts?: { id: string; feedReason: string }[];
  };
  return body.posts ?? [];
}

describe("Bill of Rights II — prominence comes from the Pulse, not from reactions", () => {
  test("a heavily-voted law outranks a heavily-liked post about a law nobody voted on", async () => {
    const reader = await citizen("reader");
    const author = await citizen("author");

    const contested = await law("A bill four hundred people have voted on");
    const ignored = await law("A bill nobody has voted on");

    // The published Liquid Democracy tally — the thing Article II says should
    // decide prominence.
    await prisma.governmentReference.update({
      where: { id: contested.id },
      data: { supportVotes: 220, opposeVotes: 180 },
    });

    const aboutContested = await post(author.userId, contested.id, "About the contested one.");
    const aboutIgnored = await post(author.userId, ignored.id, "About the ignored one.");

    // And a pile of reactions on the ignored one, which used to be enough.
    const likers = await Promise.all(
      Array.from({ length: 12 }, (_, i) => citizen(`liker${i}`)),
    );
    for (const liker of likers) {
      await prisma.postLike.create({
        data: { postId: aboutIgnored.id, userId: liker.userId },
      });
    }

    const posts = await feed(reader.cookie);
    const contestedAt = posts.findIndex((p) => p.id === aboutContested.id);
    const ignoredAt = posts.findIndex((p) => p.id === aboutIgnored.id);

    expect(contestedAt).toBeGreaterThanOrEqual(0);
    expect(ignoredAt).toBeGreaterThanOrEqual(0);
    expect(contestedAt).toBeLessThan(ignoredAt);
  });

  test("the ranking factors are published, and the forbidden ones are named", async () => {
    // Constitution Article III, Section 1: the logic must be publicly
    // auditable. Signed out, because an audit you need an account to run is
    // not a public audit.
    const response = await fetch(`${BASE_URL}/api/feed/ranking`, {
      headers: freshClientHeaders({}),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      factors: { name: string; basis: string; maximum: number | null }[];
      forbidden: string[];
      engagementCap: number;
    };

    expect(body.factors.length).toBeGreaterThan(0);
    expect(body.forbidden.join(" ")).toContain("velocity");
    expect(body.forbidden.join(" ")).toContain("Paid promotion");

    // Reactions are capped below the civic weight, so they cannot decide.
    const civic = body.factors.find((f) => f.basis === "liquid-democracy");
    const engagement = body.factors.find((f) => f.basis === "engagement");
    expect(civic?.maximum ?? 0).toBeGreaterThan(engagement?.maximum ?? 0);
    expect(body.engagementCap).toBe(engagement?.maximum ?? 0);
  });

  test("no multiplier rewards how FAST a post collected reactions", async () => {
    // The mechanic Article II names. Asserted against the source rather than
    // against behaviour, because the failure mode is somebody adding it back.
    const source = await Bun.file(
      new URL("../src/services/feed-algorithm.ts", import.meta.url).pathname,
    ).text();

    expect(source).not.toContain("engagementVelocity");
    expect(source).not.toContain("score *= 2");
    expect(source).not.toContain("score *= 1.5");
  });
});

describe("Bill of Rights IV — the anonymous voting option exists", () => {
  test("an anonymous vote still counts in the Pulse", async () => {
    const person = await citizen("anon");
    const bill = await law("A bill about insulin");

    const response = await vote(person.cookie, bill.id, "support", { anonymous: true });
    expect(response.status).toBe(200);

    // Article I: the Pulse is the aggregate of verified citizens. Anonymity
    // withholds the NAME, never the voice.
    const record = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: bill.id },
    });
    expect(record.supportVotes).toBe(1);
  });

  test("a stranger cannot see who took an anonymous position", async () => {
    const person = await citizen("anon");
    const stranger = await citizen("stranger");
    const bill = await law("A bill about insulin");

    await vote(person.cookie, bill.id, "support", { anonymous: true });

    const seen = await fetch(`${BASE_URL}/api/users/${person.userId}/positions`, {
      headers: freshClientHeaders({ cookie: stranger.cookie }),
    });
    const body = (await seen.json()) as {
      results: { reference: { id: string } }[];
      summary: { total: number };
    };

    expect(body.results.map((r) => r.reference.id)).not.toContain(bill.id);
    // The summary has to agree with the list — a count of one above an empty
    // list tells the stranger there is a hidden position and roughly what it is.
    expect(body.summary.total).toBe(0);
  });

  test("a citizen still sees their own anonymous positions", async () => {
    const person = await citizen("anon");
    const bill = await law("A bill about insulin");

    await vote(person.cookie, bill.id, "support", { anonymous: true });

    // Article IV shields somebody from other people, not from themselves.
    const deadline = Date.now() + 5_000;
    let mine: { results: { reference: { id: string }; isAnonymous: boolean }[] } = { results: [] };
    while (Date.now() < deadline && mine.results.length === 0) {
      const response = await fetch(`${BASE_URL}/api/users/${person.userId}/positions`, {
        headers: freshClientHeaders({ cookie: person.cookie }),
      });
      mine = (await response.json()) as typeof mine;
      if (mine.results.length === 0) await Bun.sleep(100);
    }

    expect(mine.results.map((r) => r.reference.id)).toContain(bill.id);
    expect(mine.results[0]!.isAnonymous).toBe(true);
  });

  test("an anonymous crossing is counted but never named", async () => {
    const mover = await citizen("mover");
    const bill = await law("A bill about insulin");

    await vote(mover.cookie, bill.id, "support", { anonymous: true });
    await vote(mover.cookie, bill.id, "oppose", { anonymous: true });

    const deadline = Date.now() + 6_000;
    let moved = { total: 0, results: [] as { user: { id: string } }[] };
    while (Date.now() < deadline && moved.total === 0) {
      const response = await fetch(
        `${BASE_URL}/api/government-references/${bill.id}/turning-points`,
        { headers: freshClientHeaders({}) },
      );
      moved = (await response.json()) as typeof moved;
      if (moved.total === 0) await Bun.sleep(100);
    }

    // Counted: anonymity must not quietly change the published picture of how
    // opinion moved on a bill.
    expect(moved.total).toBe(1);
    // Named: never.
    expect(moved.results).toHaveLength(0);
  });

  test("an anonymous position is not used to introduce somebody to a stranger", async () => {
    const reader = await citizen("reader");
    const quiet = await citizen("quiet");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await vote(reader.cookie, bill.id, "support");
      await vote(quiet.cookie, bill.id, "support", { anonymous: true });
    }

    // Common ground would otherwise name their side on three specific bills.
    const ground = await fetch(`${BASE_URL}/api/users/${quiet.userId}/common-ground`, {
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    expect(((await ground.json()) as { shared: number }).shared).toBe(0);

    // And onboarding would introduce them as a close match.
    const neighbours = await fetch(`${BASE_URL}/api/onboarding/neighbours`, {
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    const body = (await neighbours.json()) as { agree: { id: string }[]; disagree: { id: string }[] };
    expect(body.agree.map((p) => p.id)).not.toContain(quiet.userId);
    expect(body.disagree.map((p) => p.id)).not.toContain(quiet.userId);
  });

  test("the standing preference makes every later vote anonymous", async () => {
    const person = await citizen("standing");
    const stranger = await citizen("stranger");
    const first = await law("A bill voted before the switch");
    const second = await law("A bill voted after the switch");

    await vote(person.cookie, first.id, "support");

    const on = await fetch(`${BASE_URL}/api/notifications/preferences`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ voteAnonymously: true }),
    });
    expect(on.status).toBe(200);

    await vote(person.cookie, second.id, "support");

    // The right has to work from every surface that can cast a vote, not only
    // the ones that grew a toggle.
    const rows = await prisma.governmentReferenceVote.findMany({
      where: { userId: person.userId },
      select: { governmentReferenceId: true, isAnonymous: true },
    });
    const byRef = new Map(rows.map((r) => [r.governmentReferenceId, r.isAnonymous]));
    expect(byRef.get(first.id)).toBe(false);
    expect(byRef.get(second.id)).toBe(true);

    // And the earlier one is still attributable, because it was cast openly.
    const seen = await fetch(`${BASE_URL}/api/users/${person.userId}/positions`, {
      headers: freshClientHeaders({ cookie: stranger.cookie }),
    });
    const body = (await seen.json()) as { results: { reference: { id: string } }[] };
    const visible = body.results.map((r) => r.reference.id);
    expect(visible).toContain(first.id);
    expect(visible).not.toContain(second.id);
  });

  test("a single vote can override the standing preference in either direction", async () => {
    const person = await citizen("override");
    const bill = await law("A bill about insulin");

    await fetch(`${BASE_URL}/api/notifications/preferences`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ voteAnonymously: true }),
    });

    // Anonymous by default, but this one they want their name on.
    await vote(person.cookie, bill.id, "support", { anonymous: false });

    const row = await prisma.governmentReferenceVote.findFirstOrThrow({
      where: { userId: person.userId, governmentReferenceId: bill.id },
    });
    expect(row.isAnonymous).toBe(false);
  });

  test("a named vote is still named — anonymity is opt-in, not the default", async () => {
    const reader = await citizen("reader");
    const named = await citizen("named");

    const bills = await Promise.all([
      law("A bill about insulin"),
      law("A bill about railways"),
      law("A bill about the border"),
    ]);

    for (const bill of bills) {
      await vote(reader.cookie, bill.id, "support");
      await vote(named.cookie, bill.id, "support");
    }

    const ground = await fetch(`${BASE_URL}/api/users/${named.userId}/common-ground`, {
      headers: freshClientHeaders({ cookie: reader.cookie }),
    });
    expect(((await ground.json()) as { shared: number }).shared).toBe(3);
  });
});

describe("Bill of Rights II — the other side is the reader's choice", () => {
  test("turning it off removes the reserved slots", async () => {
    const reader = await citizen("reader");
    const opponent = await citizen("opponent");

    const bill = await law("A bill about insulin");
    await vote(reader.cookie, bill.id, "support");
    await vote(opponent.cookie, bill.id, "oppose");

    const theirs = await post(opponent.userId, bill.id, "Here is why the cap is wrong.");

    // Negative control: it is there while the switch is on.
    const before = await feed(reader.cookie);
    expect(before.find((p) => p.id === theirs.id)?.feedReason).toContain("other way");

    const off = await fetch(`${BASE_URL}/api/notifications/preferences`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: reader.cookie }),
      body: JSON.stringify({ showOtherSide: false }),
    });
    expect(off.status).toBe(200);

    const after = await feed(reader.cookie);
    expect(after.find((p) => p.id === theirs.id)?.feedReason ?? "").not.toContain("other way");
  });
});
