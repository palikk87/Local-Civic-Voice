/**
 * A projection stands on observed movement, and an export delivers bytes.
 *
 * WHAT BOTH REPLACE. The forecast was a seeded random walk reporting
 * `confidence: 0.8` and `modelVersion: "v2.3.1"` with no model behind either.
 * The Reports screen listed three invented files and promised an email that no
 * job existed to send.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { B2B_TEST, BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import { MIN_HISTORY_DAYS } from "../src/services/forecast";

beforeAll(async () => { await startServer(); });
afterAll(async () => { await stopServer(); });
beforeEach(async () => { await resetData(); });

type Json = Record<string, any>;
const asJson = (r: Response) => r.json() as Promise<Json>;

/** The admin B2B account is the enterprise tier; forecasting requires it. */
async function enterpriseToken(): Promise<string> {
  const r = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: B2B_TEST.adminUsername, password: B2B_TEST.adminPassword }),
  });
  return (await asJson(r)).token as string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let seq = 0;

/**
 * A bill with `days` days of recorded position history.
 *
 * `shape` decides which way opinion actually moves, and it is worth being
 * precise about why, because getting it wrong the first time is what proved the
 * fit works: an alternating 3-support-to-1-oppose pattern LOOKS like it climbs,
 * and does not. pulseOverTime reports the standing total each day, so that
 * pattern opens at 1.0 with a single supporter and converges down toward 0.5.
 * The fit reported a negative slope, the test expected positive, and the code
 * was right.
 *
 * "rising" therefore does it honestly: opposition first, then support, so the
 * running score genuinely climbs from -1 upward.
 */
async function billWithHistory(id: string, days: number, shape: "rising" | "falling" = "rising") {
  await prisma.governmentReference.create({
    data: { id, masterReferenceId: id, referenceType: "bill", title: `Bill ${id}`,
            status: "proposed", category: "healthcare" },
  });

  for (let day = 0; day < days; day++) {
    seq += 1;
    const u = await prisma.user.create({
      data: { id: `f-${seq}`, name: `F${seq}`, email: `f${seq}@e.test`, emailVerified: true },
    });

    // rising:  the first third oppose, the rest support -> score climbs.
    // falling: the mirror image.
    const early = day < Math.max(1, Math.floor(days / 3));
    const position =
      shape === "rising" ? (early ? "oppose" : "support") : early ? "support" : "oppose";

    await prisma.positionEvent.create({
      data: {
        userId: u.id,
        governmentReferenceId: id,
        position,
        lawVersion: 1,
        isChange: false,
        createdAt: new Date(Date.now() - (days - day) * 24 * 60 * 60 * 1000),
      },
    });
  }
}

describe("the forecast rests on observed movement", () => {
  test("history is returned, and it is the real day-by-day Pulse", async () => {
    await billWithHistory("fc-1", 10);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-1`, { headers: auth(await enterpriseToken()) }),
    );

    expect(body.history.length).toBe(10);
    expect(body.basis.days).toBe(10);
    expect(body.basis.voices).toBe(10);
    expect(body.basis.firstDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("no projection where there is not enough history to fit one", async () => {
    await billWithHistory("fc-2", MIN_HISTORY_DAYS - 1);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-2`, { headers: auth(await enterpriseToken()) }),
    );

    // The old build always drew thirty days of line, from anything at all.
    expect(body.projection).toBeNull();
    expect(body.noProjection.reason).toBe("not_enough_history");
    expect(body.noProjection.daysNeeded).toBe(MIN_HISTORY_DAYS);
    // The measured part is still there. Absence of a line is not absence of data.
    expect(body.history.length).toBe(MIN_HISTORY_DAYS - 1);
  });

  test("the line follows the data, in whichever direction the data goes", async () => {
    // BOTH directions, because a line that is always positive would pass a
    // one-sided test while measuring nothing. The old walk's direction came
    // from a hash of the bill id and had no relationship to the votes at all.
    await billWithHistory("fc-3-up", 20, "rising");
    await billWithHistory("fc-3-down", 20, "falling");
    const t = await enterpriseToken();

    const up = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-3-up`, { headers: auth(t) }));
    const down = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-3-down`, { headers: auth(t) }));

    expect(up.projection.method).toBe("least-squares over observed daily scores");
    expect(up.projection.slopePerDay).toBeGreaterThan(0);
    expect(down.projection.slopePerDay).toBeLessThan(0);
    expect(up.projection.points.length).toBe(30);
  });

  test("bounds widen with distance instead of sitting flat", async () => {
    await billWithHistory("fc-4", 20);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-4`, { headers: auth(await enterpriseToken()) }),
    );

    const points: Json[] = body.projection.points;
    const width = (p: Json) => p.upperBound - p.lowerBound;

    /*
     * MEASURED ONLY WHERE THE CLAMP IS NOT ACTIVE, and that is not a dodge.
     * A score cannot exceed 1, so once a rising line reaches the ceiling the
     * upper bound stops moving and the printed width narrows. That is correct —
     * there is genuinely less room above — but it hides the widening this test
     * is about. So the comparison runs over the points that are still free.
     */
    const free = points.filter((p) => p.upperBound < 1 && p.lowerBound > -1);
    expect(free.length).toBeGreaterThan(1);
    // Was a flat ±0.15 for all thirty days, regardless of the data.
    expect(width(free[free.length - 1]!)).toBeGreaterThan(width(free[0]!));
  });

  test("no bound ever leaves the range a score can occupy", async () => {
    await billWithHistory("fc-4b", 20);
    const body = await asJson(
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-4b`, { headers: auth(await enterpriseToken()) }),
    );
    for (const p of body.projection.points as Json[]) {
      expect(p.predicted).toBeGreaterThanOrEqual(-1);
      expect(p.predicted).toBeLessThanOrEqual(1);
      expect(p.lowerBound).toBeGreaterThanOrEqual(-1);
      expect(p.upperBound).toBeLessThanOrEqual(1);
    }
  });

  test("no invented certainty and no model that does not exist", async () => {
    await billWithHistory("fc-5", 20);
    const text = await (
      await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-5`, { headers: auth(await enterpriseToken()) })
    ).text();

    expect(text).not.toContain("modelVersion");
    expect(text).not.toContain("v2.3.1");
    expect(text).not.toContain('"confidence"');
    expect(text).not.toContain("keyFactors");
  });

  test("the same bill twice gives the same answer", async () => {
    await billWithHistory("fc-6", 20);
    const t = await enterpriseToken();
    const a = await asJson(await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-6`, { headers: auth(t) }));
    const b = await asJson(await fetch(`${BASE_URL}/api/b2b/forecast/bills/fc-6`, { headers: auth(t) }));
    expect(a.projection.points).toEqual(b.projection.points);
  });
});

describe("reports deliver a file", () => {
  test("the export is a real CSV with real counts", async () => {
    await prisma.governmentReference.create({
      data: { id: "rep-1", masterReferenceId: "rep-1", referenceType: "bill",
              title: 'A bill with a "quoted", comma-laden title', status: "proposed",
              category: "healthcare", supportVotes: 7, opposeVotes: 3 },
    });

    const res = await fetch(`${BASE_URL}/api/b2b/reports/export.csv`, {
      headers: auth(await enterpriseToken()),
    });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("attachment");

    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("record_id,title,category,support,oppose,total_votes,score");
    expect(lines[1]).toContain('"rep-1"');
    expect(lines[1]).toContain('"7"');
    expect(lines[1]).toContain('"3"');
    // Commas and quotes inside a title must not break the file.
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('""quoted""');
  });

  test("the district export withholds under the floor but still lists the row", async () => {
    await prisma.governmentReference.create({
      data: { id: "rep-2", masterReferenceId: "rep-2", referenceType: "bill",
              title: "Bill", status: "proposed", category: "healthcare" },
    });
    for (let i = 0; i < 2; i++) {
      const u = await prisma.user.create({
        data: { id: `rc-${i}`, name: `RC${i}`, email: `rc${i}@e.test`, emailVerified: true,
                stateCode: "CA", districtId: "CA-12", jurisdictionSetAt: new Date() },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReference: { connect: { id: "rep-2" } }, userId: u.id, position: "support" },
      });
    }

    const text = await (
      await fetch(`${BASE_URL}/api/b2b/reports/coverage.csv`, { headers: auth(await enterpriseToken()) })
    ).text();

    const row = text.trim().split("\n").find((l) => l.includes("CA-12"));
    expect(row).toBeDefined();
    // The count is safe to publish; the opinion is not.
    expect(row).toContain('"2"');
    expect(row).toContain("below");
    // A client reconciling row counts can see something was withheld rather
    // than silently receiving a shorter file.
    expect(row!.split(",").filter((cell) => cell === '""').length).toBeGreaterThan(0);
  });

  test("nothing in the export promises an email nobody sends", async () => {
    const summary = await (
      await fetch(`${BASE_URL}/api/b2b/reports/summary`, { headers: auth(await enterpriseToken()) })
    ).text();
    expect(summary.toLowerCase()).not.toContain("will be sent");
    expect(summary.toLowerCase()).not.toContain("being generated");
  });
});
