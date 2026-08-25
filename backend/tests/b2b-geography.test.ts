/**
 * A place is reported from the people in it, or not reported at all.
 *
 * WHAT THIS REPLACES. The geography endpoints had no geographic data. They took
 * the one national sentiment figure and multiplied it by each state's share of
 * the 435 House seats. Every state returned the same score; every policy
 * category inside a state returned that same score again; the representative
 * was the literal string "Representative"; and the party was Math.random(),
 * re-rolled per request.
 *
 * These tests seed real people in real districts and check the arithmetic
 * independently — the ratios are deliberately nothing like a seat-count split,
 * so an apportioning implementation cannot pass them by luck.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { B2B_TEST, BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import { MIN_COHORT } from "../src/services/jurisdiction";

beforeAll(async () => { await startServer(); });
afterAll(async () => { await stopServer(); });
beforeEach(async () => { await resetData(); });

type Json = Record<string, any>;
const asJson = (r: Response) => r.json() as Promise<Json>;

async function token(): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: B2B_TEST.demoUsername, password: B2B_TEST.demoPassword }),
  });
  return (await asJson(r)).token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;
/** N people in one district, voting a given way on a bill. */
async function seedDistrict(
  districtId: string,
  billId: string,
  support: number,
  oppose: number,
  category = "healthcare",
) {
  await prisma.governmentReference.upsert({
    where: { id: billId },
    update: {},
    create: { id: billId, masterReferenceId: billId, referenceType: "bill",
              title: `Bill ${billId}`, status: "proposed", category },
  });
  for (let i = 0; i < support + oppose; i++) {
    seq += 1;
    const u = await prisma.user.create({
      data: {
        id: `geo-${seq}`, name: `Voter ${seq}`, email: `geo${seq}@e.test`, emailVerified: true,
        stateCode: districtId.slice(0, 2), districtId, jurisdictionSetAt: new Date(),
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReference: { connect: { id: billId } }, userId: u.id,
              position: i < support ? "support" : "oppose" },
    });
  }
}

describe("districts are counted, never apportioned", () => {
  test("two districts with different opinions report different numbers", async () => {
    // 6 vs 6 voices, opposite leanings. Apportionment by seat count cannot
    // produce this: it would give both the same score.
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    await seedDistrict("TX-2", "geo-bill", 1, 5);

    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts?limit=50`, { headers: auth(await token()) }),
    );

    const ca = body.results.find((r: Json) => r.districtId === "CA-12");
    const tx = body.results.find((r: Json) => r.districtId === "TX-2");

    expect(ca.pulse).toMatchObject({ enough: true, support: 6, oppose: 0, score: 1 });
    expect(tx.pulse).toMatchObject({ enough: true, support: 1, oppose: 5 });
    expect(tx.pulse.score).toBeLessThan(0);
    expect(ca.pulse.score).not.toBe(tx.pulse.score);
  });

  test("a district nobody lives in is absent, not zero", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);

    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts?limit=500`, { headers: auth(await token()) }),
    );

    // The old build returned all 435 every time, fully coloured, from nothing.
    expect(body.results.length).toBe(1);
    expect(body.results[0].districtId).toBe("CA-12");
  });

  test("the representative is a real person from the roster", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts`, { headers: auth(await token()) }),
    );

    const rep = body.results[0].representative;
    expect(rep.name).not.toBe("Representative");
    expect(rep.name.length).toBeGreaterThan(3);
    expect(typeof rep.party).toBe("string");
  });

  test("party does not change between two identical calls", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    const t = await token();
    const one = await asJson(await fetch(`${BASE_URL}/api/b2b/geo/districts`, { headers: auth(t) }));
    const two = await asJson(await fetch(`${BASE_URL}/api/b2b/geo/districts`, { headers: auth(t) }));
    expect(one.results[0].representative.party).toBe(two.results[0].representative.party);
  });
});

describe("the privacy floor", () => {
  test("a district under the floor reports its silence, never a number", async () => {
    // Article IV: personal identity is shielded from third parties. "CA-12 is
    // 100% opposed" over one voter is that person's ballot with an address on it.
    await seedDistrict("CA-12", "geo-bill", MIN_COHORT - 1, 0);

    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts`, { headers: auth(await token()) }),
    );
    const ca = body.results.find((r: Json) => r.districtId === "CA-12");

    expect(ca.pulse.enough).toBe(false);
    expect(ca.pulse.reason).toBe("not_enough_voices");
    expect(ca.pulse.voices).toBe(MIN_COHORT - 1);
    // The numbers themselves must not be present at all — not zeroed, absent.
    expect(ca.pulse.support).toBeUndefined();
    expect(ca.pulse.oppose).toBeUndefined();
    expect(ca.pulse.score).toBeUndefined();
  });

  test("one more voice crosses the floor and the numbers appear", async () => {
    await seedDistrict("CA-12", "geo-bill", MIN_COHORT, 0);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts`, { headers: auth(await token()) }),
    );
    const ca = body.results.find((r: Json) => r.districtId === "CA-12");
    expect(ca.pulse.enough).toBe(true);
    expect(ca.pulse.support).toBe(MIN_COHORT);
  });

  test("the heatmap shades only what clears the floor, and says what it withheld", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    await seedDistrict("TX-2", "geo-bill", 2, 0);

    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, { headers: auth(await token()) }),
    );

    expect(body.districts.map((d: Json) => d.districtId)).toEqual(["CA-12"]);
    expect(body.suppressed.map((d: Json) => d.districtId)).toEqual(["TX-2"]);
    // Grey and "we will not say" are different claims.
    expect(body.suppressed[0].voices).toBe(2);
    expect(body.floor).toBe(MIN_COHORT);
    expect(JSON.stringify(body.suppressed[0])).not.toContain("score");
  });

  test("no geographic response ever names a person", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    const t = await token();
    for (const p of ["/api/b2b/geo/districts", "/api/b2b/geo/states", "/api/b2b/geo/states/CA", "/api/b2b/geo/heatmap"]) {
      const text = await (await fetch(`${BASE_URL}${p}`, { headers: auth(t) })).text();
      expect(text).not.toContain("geo1@e.test");
      expect(text).not.toContain("geo-1");
      expect(text).not.toContain("userId");
    }
  });
});

describe("coverage is stated, not implied", () => {
  test("every geographic response says how much of the map it is drawn from", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);
    await seedDistrict("TX-2", "geo-bill", 2, 0);

    const t = await token();
    for (const p of ["/api/b2b/geo/districts", "/api/b2b/geo/states", "/api/b2b/geo/heatmap"]) {
      const body = await asJson(await fetch(`${BASE_URL}${p}`, { headers: auth(t) }));
      expect(body.coverage.placed).toBe(8);
      expect(body.coverage.districtsRepresented).toBe(2);
      // Only CA-12 clears MIN_COHORT.
      expect(body.coverage.districtsReportable).toBe(1);
    }
  });

  test("an empty platform returns an empty map, not a full one", async () => {
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, { headers: auth(await token()) }),
    );
    expect(body.districts).toEqual([]);
    expect(body.suppressed).toEqual([]);
    expect(body.coverage.placed).toBe(0);
  });

  test("reports/summary counts districts, not the rows of a table in our source", async () => {
    await seedDistrict("CA-12", "geo-bill", 6, 0);

    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/reports/summary`, { headers: auth(await token()) }),
    );

    // Was Object.keys(stateInfo).length — 51, on an empty database.
    expect(body.executiveSummary.districtsRepresented).toBe(1);
    expect(body.executiveSummary.districtsReportable).toBe(1);
    expect(body.executiveSummary.activeDistricts).toBeUndefined();
    expect(body.executiveSummary.activeStates).toBeUndefined();
  });
});

describe("categories are real policy areas", () => {
  test("two categories in one district report different numbers", async () => {
    // The old build gave every category the same score, because it was the same
    // score. Same district, opposite opinions on two subjects.
    await seedDistrict("CA-12", "geo-health", 6, 0, "healthcare");
    await seedDistrict("CA-12", "geo-immig", 0, 6, "immigration");

    const t = await token();
    const health = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts?category=healthcare`, { headers: auth(t) }));
    const immig = await asJson(
      await fetch(`${BASE_URL}/api/b2b/geo/districts?category=immigration`, { headers: auth(t) }));

    expect(health.results[0].pulse.score).toBe(1);
    expect(immig.results[0].pulse.score).toBe(-1);
  });
});
