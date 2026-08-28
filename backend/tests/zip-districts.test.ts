/**
 * "ALMOST NO ONE KNOWS WHAT THEIR DISTRICT OR REPS ARE."
 *
 * That was the report, and it was right: the picker asked for a state, a
 * district number, or a representative's name — three things somebody who came
 * here to find out their district does not have. A ZIP code is the thing people
 * know, so a ZIP code is what they now type.
 *
 * FOUR THINGS HAVE TO HOLD, and each one is a way this could quietly do harm:
 *
 *   1. The mapping is read, not invented. It comes off the Census file, and the
 *      excerpt below is that file — real rows, recorded from census.gov, the
 *      same rule the rest of this suite follows for outside sources.
 *   2. Nothing is offered that the live congress.gov roster does not confirm.
 *      A missing state in STATE_BY_FIPS would silently drop every district in
 *      it, so the table is checked against the roster rather than eyeballed.
 *   3. A ZIP that spans several districts offers all of them, largest share
 *      first. Seventeen in every hundred do. Picking one for somebody is how
 *      you put a person in the wrong district and never hear about it.
 *   4. The ZIP is never stored. Bill of Rights IV: the minimum necessary, and
 *      the screen has always promised "no address, no ZIP kept".
 *
 * And the failure that matters most: when the lookup cannot be reached it says
 * so. "No districts found" would tell somebody their home is in no district at
 * all — the exact kind of invented answer Article III §3 forbids.
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
import {
  parseRelationshipFile,
  STATE_BY_FIPS,
  BOUNDARY_VINTAGE,
  CENSUS_SOURCE,
} from "../src/services/zip-districts";
import { ZIP_TO_DISTRICTS } from "../src/data/zip-districts";

const EXCERPT = readFileSync(
  join(import.meta.dir, "fixtures", "census", "cd118-zcta520-excerpt.txt"),
  "utf8",
);

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

type Json = Record<string, any>;
const asJson = (r: Response) => r.json() as Promise<Json>;

// ---------------------------------------------------------------------------
// 1. The file is read, not guessed at
// ---------------------------------------------------------------------------

describe("reading the Census relationship file", () => {
  const map = parseRelationshipFile(EXCERPT);

  test("a ZIP in one district gets that district", () => {
    // Real rows: 10001 is entirely inside New York's 12th, 02134 inside
    // Massachusetts' 7th, 72201 inside Arkansas' 2nd.
    expect(map.get("10001")?.map((o) => o.districtId)).toEqual(["NY-12"]);
    expect(map.get("02134")?.map((o) => o.districtId)).toEqual(["MA-7"]);
    expect(map.get("72201")?.map((o) => o.districtId)).toEqual(["AR-2"]);
  });

  test("a ZIP across four districts offers all four, biggest share first", () => {
    // 90002 is the worst case in the real file. The land area of each overlap
    // is what orders them, so the district holding most of the ZIP is the first
    // thing somebody sees — and they can still see the other three.
    expect(map.get("90002")?.map((o) => o.districtId)).toEqual([
      "CA-43",
      "CA-42",
      "CA-37",
      "CA-44",
    ]);

    const areas = map.get("90002")!.map((o) => o.landArea);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
  });

  test("a state with one seat is spelled -AL, not -0", () => {
    // The file writes an at-large seat as district 00. Two spellings of the
    // same seat would be two districts, and one of them would match nothing.
    expect(map.get("83001")?.map((o) => o.districtId)).toEqual(["WY-AL"]);
    expect(map.get("99501")?.map((o) => o.districtId)).toEqual(["AK-AL"]);
  });

  test("the district's own total rows carry no ZIP and are skipped", () => {
    // The first two data rows of the excerpt are exactly those: a district with
    // an empty ZCTA column. Counting them would put a district under a ZIP of
    // "" and inflate every total built on this map.
    expect(map.size).toBe(6);
    expect(map.has("")).toBe(false);
    for (const zip of map.keys()) expect(zip).toMatch(/^\d{5}$/);
  });

  test("a truncated or garbled file yields nothing rather than something wrong", () => {
    expect(parseRelationshipFile("").size).toBe(0);
    expect(parseRelationshipFile("not|a|census|file\n").size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. The bundled map is that file, and nothing else
// ---------------------------------------------------------------------------

describe("the bundled map", () => {
  test("it says the same thing the Census file says", () => {
    // THE GUARD ON A GENERATED FILE. src/data/zip-districts.ts is written by a
    // script, which means nobody reads it and a hand-edit would never be
    // noticed. This parses the recorded Census rows and demands the bundled
    // table agree with them, ZIP for ZIP and in the same order.
    for (const [zip, overlaps] of parseRelationshipFile(EXCERPT)) {
      expect(ZIP_TO_DISTRICTS[zip]).toEqual(overlaps.map((o) => o.districtId));
    }
  });

  test("it is the whole country, not a slice of it", () => {
    // A truncated map does not throw; it quietly tells a third of the country
    // their home is in no district. About thirty-four thousand ZCTAs exist.
    const zips = Object.keys(ZIP_TO_DISTRICTS);
    expect(zips.length).toBeGreaterThan(30_000);
    for (const zip of zips.slice(0, 500)) expect(zip).toMatch(/^\d{5}$/);
  });

  test("every district in it is well formed", () => {
    const shape = /^[A-Z]{2}-(\d+|AL)$/;
    for (const ids of Object.values(ZIP_TO_DISTRICTS).slice(0, 2_000)) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(id).toMatch(shape);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The one hand-written table, checked against the live roster
// ---------------------------------------------------------------------------

describe("the state table cannot silently lose a state", () => {
  test("every state congress.gov seats has a FIPS code here", async () => {
    // THE FAILURE THIS CATCHES. STATE_BY_FIPS is the only table in this feature
    // that is typed rather than fetched. A missing entry does not throw — the
    // parser skips the row — so every ZIP in that state would answer "no
    // district" forever, and nothing would say why.
    const body = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));
    const seated = new Set<string>(body.districts.map((d: Json) => d.stateCode));
    expect(seated.size).toBeGreaterThan(50);

    const known = new Set(Object.values(STATE_BY_FIPS));
    const missing = [...seated].filter((code) => !known.has(code));
    expect(missing).toEqual([]);
  });

  test("no two FIPS codes claim the same state", () => {
    const codes = Object.values(STATE_BY_FIPS);
    expect(new Set(codes).size).toBe(codes.length);
    for (const fips of Object.keys(STATE_BY_FIPS)) expect(fips).toMatch(/^\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// 4. The route
// ---------------------------------------------------------------------------

describe("GET /api/users/jurisdiction/by-zip/:zip", () => {
  test("a real ZIP answers with districts that actually exist", async () => {
    const response = await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/10001`);
    expect(response.status).toBe(200);
    const body = await asJson(response);

    expect(Array.isArray(body.districts)).toBe(true);
    expect(body.districts.length).toBeGreaterThan(0);

    // EVERY ANSWER IS ONE THE ROSTER CONFIRMS. The Census file is a Congress
    // behind; a seat that has since gone must be dropped, not offered.
    const real = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/districts`));
    const realIds = new Set(real.districts.map((d: Json) => d.districtId));
    for (const district of body.districts) {
      expect(realIds.has(district.districtId)).toBe(true);
      expect(district.representative?.name?.length).toBeGreaterThan(3);
    }

    // WHERE THE ANSWER CAME FROM, on the answer itself. These boundaries are
    // the 118th Congress's and a few states have redrawn since, which is why
    // this suggests and never sets — so the screen has to be able to say so.
    expect(body.vintage).toBe(BOUNDARY_VINTAGE);
    expect(body.source).toBe(CENSUS_SOURCE);
  });

  test("a ZIP in more than one district says so", async () => {
    const body = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/90002`));
    expect(body.districts.length).toBeGreaterThan(1);
    expect(body.spansSeveral).toBe(true);
  });

  test("a ZIP that is in no district returns an empty list, not an invented one", async () => {
    const body = await asJson(await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/00000`));
    expect(body.districts).toEqual([]);
    expect(body.spansSeveral).toBe(false);
  });

  test("anything that is not five digits is refused before any lookup", async () => {
    for (const bad of ["1234", "123456", "abcde", "9021a"]) {
      const response = await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/${bad}`);
      expect(response.status).toBe(400);
    }
  });

  test("it is public, like the district list beside it", async () => {
    // A fact about the map of the United States. It says nothing about anybody
    // here, so making people sign in to read it would be a lock with no door.
    const response = await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/10001`);
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 5. [bor-art4] The ZIP is not kept
// ---------------------------------------------------------------------------

describe("[bor-art4] the ZIP is used and dropped", () => {
  test("looking one up writes nothing about anybody", async () => {
    const headers = await freshClientHeaders();
    const me = await signUp({
      email: `zip${Math.random().toString(36).slice(2, 9)}@example.com`,
      password: "test-password-not-a-real-one",
      name: "ZIP Tester",
    });

    await fetch(`${BASE_URL}/api/users/jurisdiction/by-zip/90002`, {
      headers: { ...headers, cookie: me.cookie },
    });

    // The lookup is a GET and the only thing that is ever saved is the district
    // somebody then chooses. Their jurisdiction is still unset.
    const row = await prisma.user.findUnique({
      where: { id: me.userId },
      select: { districtId: true, stateCode: true },
    });
    expect(row?.districtId).toBeNull();
    expect(row?.stateCode).toBeNull();
  });

  test("the ZIP appears in no column of the source it could have leaked into", async () => {
    // THE THING BEING GUARDED. There is no zip column, no zip field, and no
    // migration adding one — this reads the schema so that adding one has to be
    // a deliberate act somebody sees in a diff, not a convenience that slips in.
    const schema = readFileSync(join(import.meta.dir, "..", "prisma", "schema.prisma"), "utf8");
    expect(/\n\s*zip\w*\s+String/i.test(schema)).toBe(false);
    expect(/\n\s*postalCode\s+String/i.test(schema)).toBe(false);
  });
});
