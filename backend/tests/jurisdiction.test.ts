/**
 * Where a voice belongs, and what may be said about a place.
 *
 * THE THREE CLAUSES THIS ENFORCES, all marked enforcedInCode in the platform's
 * own founding documents:
 *
 *   Bill of Rights IV — collect the minimum necessary to verify jurisdiction,
 *   and shield personal identity from third parties.
 *   Bill of Rights I — the vote originates in the individual, so nothing may be
 *   conditional on handing over an address.
 *   Constitution III §3 — every data point links to an official source, so the
 *   Digital Government cannot drift into fiction.
 *
 * The old geography failed all three at once: invented districts, invented
 * representatives, a party re-rolled on every request, and one national number
 * copied into 51 states.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, freshClientHeaders, signUp, startServer, stopServer } from "./helpers/server";

beforeAll(async () => { await startServer(); });
afterAll(async () => { await stopServer(); });
beforeEach(async () => { await resetData(); });

type Json = Record<string, any>;
const asJson = (r: Response) => r.json() as Promise<Json>;

async function person() {
  return signUp({
    email: `j${Math.random().toString(36).slice(2, 9)}@example.com`,
    password: "test-password-not-a-real-one",
    name: "Jurisdiction Tester",
  });
}

describe("the district list is the real one", () => {
  test("it comes from the congress roster, not a table in our own source", async () => {
    const body = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));

    // 435 seats, plus non-voting delegates the roster may include. A hardcoded
    // 51-row state table — which is what the old geography used — cannot
    // produce this shape at all.
    expect(body.districts.length).toBeGreaterThan(100);
    expect(["congress.gov", "fallback"]).toContain(body.source);

    const first = body.districts[0];
    expect(first.districtId).toMatch(/^[A-Z]{2}-(\d+|AL)$/);
    expect(typeof first.stateName).toBe("string");

    // The thing that was a literal string "Representative" and a coin-flip party.
    const withRep = body.districts.find((d: Json) => d.representative);
    expect(withRep.representative.name).not.toBe("Representative");
    expect(withRep.representative.name.length).toBeGreaterThan(3);
  });

  test("the same call twice returns the same map", async () => {
    // Party used to be Math.random() per request, so California's delegation
    // changed on refresh. A map that reshuffles is not a map.
    const a = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));
    const b = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));

    const shape = (x: Json) =>
      x.districts.slice(0, 40).map((d: Json) => `${d.districtId}:${d.representative?.party}`).join("|");

    expect(shape(a)).toBe(shape(b));
  });
});

describe("declaring a jurisdiction", () => {
  test("a real district is accepted and read back with its representative", async () => {
    const me = await person();
    const list = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));
    const target = list.districts[0].districtId;

    const put = await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: me.cookie }),
      body: JSON.stringify({ districtId: target }),
    });
    expect(put.status).toBe(200);

    const mine = await asJson(
      await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
        headers: freshClientHeaders({ cookie: me.cookie }),
      }),
    );
    expect(mine.districtId).toBe(target);
    expect(mine.stateCode).toBe(target.slice(0, 2));
    expect(mine.district.representative.name).not.toBe("Representative");
  });

  test("a district that does not exist is refused, not stored", async () => {
    const me = await person();
    const put = await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: me.cookie }),
      // Well-formed. Nobody represents it.
      body: JSON.stringify({ districtId: "CA-99" }),
    });
    expect(put.status).toBe(400);

    const row = await prisma.user.findUnique({ where: { id: me.userId } });
    expect(row?.districtId).toBeNull();
  });

  test("it is withdrawable in one call, and the votes stay", async () => {
    // Article IV is a right, not a setting. Taking it back must be as easy as
    // giving it, and must not cost the person anything they already did.
    const me = await person();
    const list = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));

    await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
      method: "PUT",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: me.cookie }),
      body: JSON.stringify({ districtId: list.districts[0].districtId }),
    });

    await prisma.governmentReference.create({
      data: { id: "j-bill", masterReferenceId: "j-bill", referenceType: "bill",
              title: "A bill", status: "proposed" },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReference: { connect: { id: "j-bill" } }, userId: me.userId, position: "support" },
    });

    const gone = await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie: me.cookie }),
    });
    expect(gone.status).toBe(200);

    const row = await prisma.user.findUnique({ where: { id: me.userId } });
    expect(row?.districtId).toBeNull();
    expect(row?.stateCode).toBeNull();

    // Their voice is untouched. Withdrawing a district is not withdrawing a vote.
    expect(await prisma.governmentReferenceVote.count({ where: { userId: me.userId } })).toBe(1);
  });

  test("nobody has one until they say so", async () => {
    const me = await person();
    const mine = await asJson(
      await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
        headers: freshClientHeaders({ cookie: me.cookie }),
      }),
    );
    // Null, not a guessed default, not an IP lookup.
    expect(mine.districtId).toBeNull();
    expect(mine.stateCode).toBeNull();
    expect(mine.setAt).toBeNull();
  });

  test("the screen is told why it is being asked and what the limit is", async () => {
    const me = await person();
    const mine = await asJson(
      await fetch(`${BASE_URL}/api/users/me/jurisdiction`, {
        headers: freshClientHeaders({ cookie: me.cookie }),
      }),
    );
    // A person handing over their district is owed the reason in words, on the
    // screen, not in a privacy policy nobody opens.
    for (const key of ["why", "collected", "shared", "optional"]) {
      expect(typeof mine.explanation[key]).toBe("string");
      expect(mine.explanation[key].length).toBeGreaterThan(20);
    }
  });
});

describe("voting never requires it", () => {
  test("somebody who has declined can still vote, and is still counted", async () => {
    // Article I: the power of the vote originates in the individual. A ballot
    // conditional on an address is the lock-in that article forbids.
    const me = await person();
    await prisma.governmentReference.create({
      data: { id: "j-bill-2", masterReferenceId: "j-bill-2", referenceType: "bill",
              title: "Another bill", status: "proposed" },
    });

    const vote = await fetch(`${BASE_URL}/api/government-references/j-bill-2/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: me.cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect(vote.status).toBeLessThan(300);

    const row = await prisma.user.findUnique({ where: { id: me.userId } });
    expect(row?.districtId).toBeNull();
    expect(await prisma.governmentReferenceVote.count({ where: { userId: me.userId } })).toBe(1);
  });
});
