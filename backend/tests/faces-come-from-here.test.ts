/**
 * NO PAGE ON THIS PLATFORM ASKS SOMEBODY ELSE FOR A FACE.
 *
 * WHY THIS EXISTS. Khalid: "calling for the faces every time doesn't seem to be
 * working and leaves gaps." It was not working, and the reason was structural:
 * every screen was handed an address on congress.gov or Wikimedia and left to
 * fetch it itself, on every paint, from a host nobody here controls.
 *
 * Measured against all 244 people who have sponsored something on this
 * platform, bioguide.congress.gov — the source both apps used — has no
 * photograph for four of them, and answers Ron Johnson with 65,536 bytes that
 * are not an image. Five faces missing, invisibly, because an <img> that fails
 * is hidden by design and looks exactly like a feature nobody built.
 *
 * The fix was to stop naming outside hosts at all. This is the test that keeps
 * it that way: the next person to write `https://…congress.gov/photo/` into a
 * payload finds out here rather than from a reader.
 *
 * IT NEEDS NO NETWORK. With no CONGRESS_API_KEY the roster is the bundled
 * fallback list, which is exactly the point — those entries were written with
 * congress.gov addresses in them, and they must not reach anybody either.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, startServer, stopServer } from "./helpers/server";

/** Anywhere a face used to be fetched from, and must not be fetched from now. */
const SOMEBODY_ELSE = /congress\.gov|wikimedia\.org|wikipedia\.org|unitedstates/i;

const isOurs = (url: string | null): boolean =>
  url === null || /^https?:\/\/[^/]+\/api\/portraits\//.test(url) || url.startsWith("/api/portraits/");

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

describe("every face is served from us", () => {
  test("EVERY MEMBER OF CONGRESS POINTS AT OUR OWN ADDRESS", async () => {
    const response = await fetch(`${BASE_URL}/api/representatives`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as {
      data: { representatives: Array<{ id: string; name: string; photoUrl: string | null }> };
    };
    const roster = body.data.representatives;
    expect(roster.length).toBeGreaterThan(400);

    const elsewhere = roster.filter((member) => SOMEBODY_ELSE.test(member.photoUrl ?? ""));
    expect(
      elsewhere.map((member) => `${member.id} ${member.name} -> ${member.photoUrl}`),
    ).toEqual([]);
    for (const member of roster) {
      expect(isOurs(member.photoUrl), `${member.id} ${member.name}`).toBe(true);
    }
  });

  test("…AND SO DOES EVERY PRESIDENT, JUSTICE AND CABINET POST", async () => {
    const response = await fetch(`${BASE_URL}/api/government/officials`);
    expect(response.ok).toBe(true);
    type Face = { id: string; name: string; photoUrl: string | null };
    const body = (await response.json()) as {
      data: {
        executive: Face[];
        judicial: Face[];
        succession: Face[];
        congressionalLeadership: Face[];
      };
    };

    const everybody: Face[] = [
      ...body.data.executive,
      ...body.data.judicial,
      ...body.data.succession,
      ...body.data.congressionalLeadership,
    ];
    expect(everybody.length).toBeGreaterThan(30);

    const elsewhere = everybody.filter((official) => SOMEBODY_ELSE.test(official.photoUrl ?? ""));
    expect(
      elsewhere.map((official) => `${official.id} ${official.name} -> ${official.photoUrl}`),
    ).toEqual([]);
  });

  test("the roster still says where each photograph came from", async () => {
    // The URL is not deleted, it is demoted. It is the best hint the collector
    // has — for one sitting member it is the only place a photograph exists —
    // and a face on a public official should be traceable to a source.
    const body = (await (await fetch(`${BASE_URL}/api/representatives`)).json()) as {
      data: { representatives: Array<{ photoSource: string | null }> };
    };
    const sourced = body.data.representatives.filter((member) => member.photoSource);
    expect(sourced.length).toBeGreaterThan(400);
  });
});

describe("the portrait route", () => {
  test("A PRESIDENT WE HOLD IS ANSWERED FROM THE FOLDER, WITH NO NETWORK", async () => {
    // Q22686 is Donald Trump's Wikidata id — one of the 158 files downloaded
    // when that set was found to be closed and small.
    const response = await fetch(`${BASE_URL}/api/portraits/Q22686.jpg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    // Immutable: the id in the name is the person, so this answer cannot change.
    expect(response.headers.get("cache-control")).toContain("immutable");

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    // A real JPEG, by its signature — the check that caught congress.gov
    // sending 64KB of something else under an image/jpeg header.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
  });

  test("a name that is not an id is refused before anything is opened", async () => {
    for (const bad of [
      "..%2f..%2fetc%2fpasswd.jpg",
      "Q22686.txt",
      "a123456.jpg",
      "official-.jpg",
      "Q999999999.jpg",
    ]) {
      const response = await fetch(`${BASE_URL}/api/portraits/${bad}`);
      expect(response.status, bad).toBe(404);
    }
  });
});
