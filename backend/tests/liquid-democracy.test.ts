/**
 * Liquid democracy, tested against the app's own founding documents.
 *
 * The platform publishes a Constitution and a Bill of Rights and marks these
 * clauses `enforcedInCode: true`. That claim is the thing under test here. Each
 * case below names the clause it is holding the code to, so a failure says
 * which promise broke rather than which function returned the wrong number.
 *
 *   Bill of Rights I  — "instantly revoke or reassign their delegation at any
 *                        time, for any reason, without delay or penalty"
 *                     — "Individual vote always overrides delegation"
 *                     — "Transparent delegation chains"
 *   Constitution II   — "Political power is never won; it is only borrowed."
 *   Constitution II§3 — vote directly "without losing their long-term delegation"
 *   Bill of Rights III— "know exactly how many direct votes and delegated
 *                        weights formed the Pulse"
 *
 * Nothing here is mocked. Real server, real HTTP, real Postgres, real tallies.
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

const DAY = 24 * 60 * 60 * 1000;

/** Mirrors MAX_DELEGATION_DEPTH in the service; the cap is part of the contract. */
const MAX_DEPTH = 8;

let seq = 0;

/** A masterReferenceId nothing else in the run will claim. */
let refCounter = 0;
function freshReferenceId(): string {
  refCounter += 1;
  return `hr-${1000 + refCounter}-119`;
}

/** A signed-up account, uniquely named per call. */
async function citizen(label: string) {
  seq += 1;
  return signUp({
    email: `${label}${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

/**
 * Make a user eligible to receive delegations the way the rules actually read:
 * old enough, enough votes, enough posts, active recently.
 *
 * The account age is the one thing a test cannot earn honestly — it takes two
 * weeks — so the creation date is backdated. Everything else is real rows of
 * the real kind the service counts.
 */
async function makeEligible(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });

  for (let i = 0; i < 3; i += 1) {
    await prisma.post.create({
      data: { authorId: userId, content: `Something worth saying, number ${i}.` },
    });
  }

  for (let i = 0; i < 20; i += 1) {
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: freshReferenceId(),
        referenceType: "bill",
        title: `Track record ${i}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: row.id, userId, position: "support" },
    });
  }
}

/** A reference to vote on. */
async function reference(category: string | null = "healthcare") {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: freshReferenceId(),
      referenceType: "bill",
      title: `A bill about ${category ?? "nothing in particular"}`,
      status: "proposed",
      category,
    },
  });
}

function delegate(cookie: string, toUserId: string, category?: string) {
  return fetch(`${BASE_URL}/api/delegations`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(category ? { toUserId, category } : { toUserId }),
  });
}

function revoke(cookie: string, delegationId: string) {
  return fetch(`${BASE_URL}/api/delegations/${delegationId}`, {
    method: "DELETE",
    headers: freshClientHeaders({ cookie }),
  });
}

function vote(cookie: string, referenceId: string, position: "support" | "oppose") {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify({ position }),
  });
}

/** The tally as the platform publishes it — the number every screen reads. */
async function publishedTally(referenceId: string) {
  const row = await prisma.governmentReference.findUniqueOrThrow({
    where: { id: referenceId },
    select: { supportVotes: true, opposeVotes: true },
  });
  return { support: row.supportVotes, oppose: row.opposeVotes };
}

describe("liquid democracy", () => {
  test("a delegate's vote carries the weight lent to them", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();

    expect((await delegate(follower.cookie, leader.userId)).status).toBe(201);
    expect((await vote(leader.cookie, bill.id, "support")).status).toBe(200);

    // The leader's own voice, plus the one lent to them.
    expect(await publishedTally(bill.id)).toEqual({ support: 2, oppose: 0 });
  });

  test("your own vote overrides your delegate, and keeps the delegation", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();
    await delegate(follower.cookie, leader.userId);

    await vote(leader.cookie, bill.id, "support");
    await vote(follower.cookie, bill.id, "oppose");

    // Constitution II§3: the delegate speaks for one, the follower for
    // themselves. The lent weight is not counted twice and not counted against.
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 1 });

    // "...without losing their long-term delegation."
    const mine = (await (
      await fetch(`${BASE_URL}/api/delegations/me`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { activeCount: number };
    expect(mine.activeCount).toBe(1);
  });

  test("revoking a delegation takes the weight back immediately", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();

    const created = (await (await delegate(follower.cookie, leader.userId)).json()) as {
      delegation: { id: string };
    };
    await vote(leader.cookie, bill.id, "support");
    expect(await publishedTally(bill.id)).toEqual({ support: 2, oppose: 0 });

    expect((await revoke(follower.cookie, created.delegation.id)).status).toBe(200);

    // Bill of Rights I: "instantly revoke ... without delay or penalty".
    // The published Pulse must stop counting the borrowed voice the moment it
    // is taken back — not the next time somebody else happens to vote.
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 0 });
  });

  test("granting a delegation adds the weight immediately", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();
    await vote(leader.cookie, bill.id, "support");
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 0 });

    await delegate(follower.cookie, leader.userId);

    // The other half of "instantly ... reassign". Lending your voice to
    // somebody who has already spoken has to count, or the delegation quietly
    // does nothing until unrelated traffic arrives.
    expect(await publishedTally(bill.id)).toEqual({ support: 2, oppose: 0 });
  });

  test("a category delegation only covers its own category", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const health = await reference("healthcare");
    const defense = await reference("defense");

    await delegate(follower.cookie, leader.userId, "healthcare");
    await vote(leader.cookie, health.id, "support");
    await vote(leader.cookie, defense.id, "support");

    expect(await publishedTally(health.id)).toEqual({ support: 2, oppose: 0 });
    expect(await publishedTally(defense.id)).toEqual({ support: 1, oppose: 0 });
  });

  test("a voice carried through a chain reaches whoever finally votes", async () => {
    const top = await citizen("top");
    const middle = await citizen("middle");
    const bottom = await citizen("bottom");
    await makeEligible(top.userId);
    await makeEligible(middle.userId);

    const bill = await reference();

    // bottom lends to middle; middle lends to top; only top votes.
    await delegate(bottom.cookie, middle.userId);
    await delegate(middle.cookie, top.userId);
    await vote(top.cookie, bill.id, "support");

    // Three citizens are represented and all three land on the same position.
    // The single-hop version dropped bottom silently and published 2.
    expect(await publishedTally(bill.id)).toEqual({ support: 3, oppose: 0 });
  });

  test("someone in the middle of a chain who votes keeps their own voice", async () => {
    const top = await citizen("top");
    const middle = await citizen("middle");
    const bottom = await citizen("bottom");
    await makeEligible(top.userId);
    await makeEligible(middle.userId);

    const bill = await reference();

    await delegate(bottom.cookie, middle.userId);
    await delegate(middle.cookie, top.userId);

    await vote(top.cookie, bill.id, "support");
    await vote(middle.cookie, bill.id, "oppose");

    // middle spoke, so middle's voice stops travelling to top — and bottom's
    // voice stops at middle, the person they actually chose.
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 2 });
  });

  test("a chain that never reaches a voter counts for nobody", async () => {
    const top = await citizen("top");
    const middle = await citizen("middle");
    const bottom = await citizen("bottom");
    const stranger = await citizen("stranger");
    await makeEligible(top.userId);
    await makeEligible(middle.userId);
    await makeEligible(stranger.userId);

    const bill = await reference();

    await delegate(bottom.cookie, middle.userId);
    await delegate(middle.cookie, top.userId);

    // Somebody unconnected votes. The chain leads nowhere near them.
    await vote(stranger.cookie, bill.id, "support");

    // No invented voices: silence is silence.
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 0 });
  });

  test("a ring of delegations terminates instead of counting forever", async () => {
    const a = await citizen("ringa");
    const b = await citizen("ringb");
    const cc = await citizen("ringc");
    const voter = await citizen("voter");
    await makeEligible(a.userId);
    await makeEligible(b.userId);
    await makeEligible(cc.userId);
    await makeEligible(voter.userId);

    const bill = await reference();

    // a -> b -> c -> a. The direct two-party case is refused at creation, but
    // nothing stops three people forming a ring, and a walker without a memory
    // would go round it until the process died.
    await delegate(a.cookie, b.userId);
    await delegate(b.cookie, cc.userId);
    expect((await delegate(cc.cookie, a.userId)).status).toBe(201);

    await vote(voter.cookie, bill.id, "support");

    // Nobody in the ring voted, so the ring contributes nothing — and the
    // request returns rather than hanging.
    expect(await publishedTally(bill.id)).toEqual({ support: 1, oppose: 0 });
  });

  test("a chain longer than the cap drops the far end rather than inventing it", async () => {
    const voter = await citizen("chainvoter");
    await makeEligible(voter.userId);

    const bill = await reference();

    // A line of citizens each lending to the one before, ending at the voter.
    // Everyone within the cap is carried; anyone beyond it is not counted at
    // all, which is the honest choice — the alternative is a number nobody can
    // trace back to a person.
    let previous = voter.userId;
    const links = MAX_DEPTH + 3;
    for (let i = 0; i < links; i += 1) {
      const link = await citizen(`link${i}`);
      await makeEligible(link.userId);
      const response = await delegate(link.cookie, previous);
      expect(response.status).toBe(201);
      previous = link.userId;
    }

    await vote(voter.cookie, bill.id, "support");

    const tally = await publishedTally(bill.id);
    expect(tally.oppose).toBe(0);
    // The voter plus everyone whose chain fits inside the cap.
    expect(tally.support).toBe(1 + MAX_DEPTH);
  });

  test("the Pulse can be broken down into direct votes and delegated weight", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();
    await delegate(follower.cookie, leader.userId);
    await vote(leader.cookie, bill.id, "support");

    // Bill of Rights III: "know exactly how many direct votes and delegated
    // weights formed the Pulse."
    const response = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote-details`, {
      headers: freshClientHeaders({ cookie: follower.cookie }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      support: { direct: number; delegated: number };
      oppose: { direct: number; delegated: number };
    };
    expect(body.support.direct).toBe(1);
    expect(body.support.delegated).toBe(1);
    expect(body.oppose.direct).toBe(0);
    expect(body.oppose.delegated).toBe(0);
  });

  test("a citizen can see where their voice actually ends up", async () => {
    const top = await citizen("top");
    const middle = await citizen("middle");
    const bottom = await citizen("bottom");
    await makeEligible(top.userId);
    await makeEligible(middle.userId);

    await delegate(bottom.cookie, middle.userId);
    await delegate(middle.cookie, top.userId);

    const mine = (await (
      await fetch(`${BASE_URL}/api/delegations/me`, {
        headers: freshClientHeaders({ cookie: bottom.cookie }),
      })
    ).json()) as { delegations: Array<{ chain: Array<{ id: string }> }> };

    // bottom chose middle. Their voice does not stop there, and the app
    // promises transparent chains, so the onward step has to be visible.
    expect(mine.delegations).toHaveLength(1);
    expect(mine.delegations[0]!.chain.map((link) => link.id)).toEqual([top.userId]);
  });

  test("a delegation that ends where you chose shows no onward chain", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    await delegate(follower.cookie, leader.userId);

    const mine = (await (
      await fetch(`${BASE_URL}/api/delegations/me`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { delegations: Array<{ chain: unknown[] }> };

    expect(mine.delegations[0]!.chain).toEqual([]);
  });

  test("you can see every time somebody spoke in your name", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const first = await reference();
    const second = await reference();
    await delegate(follower.cookie, leader.userId);

    await vote(leader.cookie, first.id, "support");
    await vote(leader.cookie, second.id, "oppose");

    const receipts = (await (
      await fetch(`${BASE_URL}/api/delegations/receipts?limit=100`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { results: Array<{ referenceId: string; position: string; castBy: { id: string } }> };

    // A voice you cannot audit is a voice you gave away rather than lent.
    //
    // Asserted by naming the records rather than counting them: the leader also
    // has the twenty votes that earned their eligibility, and those were cast
    // in this person's name too. That is not noise in the fixture — it is the
    // feature. Somebody who lends their voice inherits their delegate's whole
    // record from that moment, and a receipt that hid twenty of twenty-two
    // would be the exact omission this exists to fix.
    const mine = new Map(receipts.results.map((r) => [r.referenceId, r]));
    expect(mine.get(first.id)?.position).toBe("support");
    expect(mine.get(second.id)?.position).toBe("oppose");
    expect(receipts.results.every((r) => r.castBy.id === leader.userId)).toBe(true);
  });

  test("a record you voted on yourself is not on the receipt", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();
    await delegate(follower.cookie, leader.userId);
    await vote(leader.cookie, bill.id, "support");
    await vote(follower.cookie, bill.id, "oppose");

    // Nobody spoke for them here — they spoke for themselves.
    const receipts = (await (
      await fetch(`${BASE_URL}/api/delegations/receipts?limit=100`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { results: Array<{ referenceId: string }> };
    expect(receipts.results.some((r) => r.referenceId === bill.id)).toBe(false);
  });

  test("the receipt names who actually spoke, even down a chain", async () => {
    const top = await citizen("top");
    const middle = await citizen("middle");
    const bottom = await citizen("bottom");
    await makeEligible(top.userId);
    await makeEligible(middle.userId);

    const bill = await reference();
    await delegate(bottom.cookie, middle.userId);
    await delegate(middle.cookie, top.userId);
    await vote(top.cookie, bill.id, "support");

    const receipts = (await (
      await fetch(`${BASE_URL}/api/delegations/receipts?limit=100`, {
        headers: freshClientHeaders({ cookie: bottom.cookie }),
      })
    ).json()) as {
      results: Array<{ referenceId: string; castBy: { id: string }; lentTo: { id: string } | null }>;
      carriedOnward: number;
    };

    // THE CASE THAT MATTERS. bottom chose middle. top spoke. Being told "you
    // have one delegation" hides that entirely, and it is the one fact a person
    // would act on.
    const receipt = receipts.results.find((r) => r.referenceId === bill.id);
    expect(receipt?.castBy.id).toBe(top.userId);
    expect(receipt?.lentTo?.id).toBe(middle.userId);
    expect(receipts.carriedOnward).toBeGreaterThan(0);
  });

  test("a category delegation only shows what it actually carried", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const health = await reference("healthcare");
    const defense = await reference("defense");
    await delegate(follower.cookie, leader.userId, "healthcare");

    await vote(leader.cookie, health.id, "support");
    await vote(leader.cookie, defense.id, "support");

    const receipts = (await (
      await fetch(`${BASE_URL}/api/delegations/receipts`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { results: Array<{ referenceId: string }> };

    const seen = receipts.results.map((r) => r.referenceId);
    expect(seen).toContain(health.id);
    expect(seen).not.toContain(defense.id);
  });

  test("revoking stops the receipts, because it stops the lending", async () => {
    const leader = await citizen("leader");
    const follower = await citizen("follower");
    await makeEligible(leader.userId);

    const bill = await reference();
    const created = (await (await delegate(follower.cookie, leader.userId)).json()) as {
      delegation: { id: string };
    };
    await vote(leader.cookie, bill.id, "support");
    await revoke(follower.cookie, created.delegation.id);

    const receipts = (await (
      await fetch(`${BASE_URL}/api/delegations/receipts?limit=100`, {
        headers: freshClientHeaders({ cookie: follower.cookie }),
      })
    ).json()) as { results: unknown[] };
    expect(receipts.results).toHaveLength(0);
  });

  test("an ineligible account cannot be lent a voice", async () => {
    const newcomer = await citizen("newcomer");
    const follower = await citizen("follower");

    const response = await delegate(follower.cookie, newcomer.userId);
    expect(response.status).toBe(400);
  });

  test("you cannot delegate to yourself", async () => {
    const self = await citizen("self");
    await makeEligible(self.userId);
    expect((await delegate(self.cookie, self.userId)).status).toBe(400);
  });
});
