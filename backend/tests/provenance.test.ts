/**
 * A date is a fact about the legislation, not about our database.
 *
 * WHAT THIS REPLACES. reference-mappers.ts set both introducedDate and
 * lastActionDate to `ref.createdAt` — the moment OUR row was written — because
 * GovernmentReference had neither column. A statute from 2007 therefore
 * displayed as introduced today, and every record on the platform looked like
 * it dated from whenever we happened to sync it. The sponsor was worse: every
 * bill was "Sponsored by U.S. House of Representatives / Independent - US" with
 * a blank avatar, because there was nowhere to put a real one.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import { parseBillId } from "../src/services/bill-provenance";

beforeAll(async () => { await startServer(); });
afterAll(async () => { await stopServer(); });
beforeEach(async () => { await resetData(); });

type Json = Record<string, any>;
const asJson = (r: Response) => r.json() as Promise<Json>;

describe("the bill id parses back to what congress.gov wants", () => {
  test("every bill type round-trips", () => {
    expect(parseBillId("hr-3194-119")).toEqual({ type: "hr", number: "3194", congress: "119" });
    expect(parseBillId("s-1779-119")).toEqual({ type: "s", number: "1779", congress: "119" });
    // Hyphenated types are spelled without the hyphen by the API.
    expect(parseBillId("s-res-829-119")).toEqual({ type: "sres", number: "829", congress: "119" });
    expect(parseBillId("h-j-res-12-119")).toBeNull();
    // Not a bill at all.
    expect(parseBillId("eo-14420")).toBeNull();
    expect(parseBillId("scotus-2024-abc")).toBeNull();
  });
});

describe("what a record says when we have not asked yet", () => {
  test("a stored bill with no provenance reports null, never a stand-in", async () => {
    await prisma.governmentReference.create({
      data: { id: "prov-1", masterReferenceId: "hr-1-119", referenceType: "bill",
              title: "A bill", status: "proposed" },
    });

    // The detail route nests under `reference`. Reading the top level would
    // make every assertion below pass on undefined, which is how a test ends up
    // proving nothing — it did exactly that on the first run here.
    const { reference } = await asJson(
      await fetch(`${BASE_URL}/api/government-references/prov-1`),
    );

    // The field has to BE there and be null, not be missing.
    expect(reference).toHaveProperty("introducedDate");
    expect(reference).toHaveProperty("sponsor");

    // Was ref.createdAt for both, so this read as introduced today.
    expect(reference.introducedDate).toBeNull();
    expect(reference.lastActionDate).toBeNull();
    // Was "U.S. House of Representatives", party I, state US.
    expect(reference.sponsor).toBeNull();
  });

  test("a stored date is served as itself, not as when we saw it", async () => {
    const introduced = new Date("2007-03-14T00:00:00Z");
    await prisma.governmentReference.create({
      data: {
        id: "prov-2", masterReferenceId: "hr-2-110", referenceType: "bill",
        title: "An old bill", status: "proposed",
        introducedDate: introduced,
        lastActionDate: new Date("2008-01-09T00:00:00Z"),
        lastActionText: "Referred to the Committee on Energy and Commerce.",
        sponsorBioguideId: "B001314", sponsorName: "Aaron Bean",
        sponsorParty: "R", sponsorState: "FL",
      },
    });

    const { reference } = await asJson(
      await fetch(`${BASE_URL}/api/government-references/prov-2`),
    );

    expect(reference.introducedDate.slice(0, 10)).toBe("2007-03-14");
    expect(reference.lastActionDate.slice(0, 10)).toBe("2008-01-09");
    expect(reference.sponsor).toMatchObject({
      bioguideId: "B001314",
      name: "Aaron Bean",
      party: "R",
      state: "FL",
    });
    // The whole point: our row was created today and the law was not.
    expect(reference.introducedDate.slice(0, 4)).toBe("2007");
  });
});

describe("freshness is answerable", () => {
  test("it reports what it holds and the cadence the code actually runs at", async () => {
    await prisma.governmentReference.create({
      data: { id: "fresh-1", masterReferenceId: "hr-9-119", referenceType: "bill",
              title: "A bill", status: "proposed",
              lastActionDate: new Date("2026-08-01T00:00:00Z"),
              sourceCheckedAt: new Date("2026-08-20T00:00:00Z") },
    });

    const body = await asJson(await fetch(`${BASE_URL}/api/government-references/freshness`));

    expect(body.syncedAt?.slice(0, 10)).toBe("2026-08-20");
    expect(body.newestAction.referenceId).toBe("hr-9-119");
    expect(body.counts.bill).toBe(1);
    // Numbers, from the intervals — not a sentence in a README that can drift.
    expect(body.cadence.recordsHours).toBe(24);
    expect(body.cadence.rollCallsHours).toBe(12);
    // This bill has no introducedDate, so it is counted as still waiting.
    expect(body.awaitingProvenance).toBe(1);
  });

  test("an unsynced platform says so rather than implying freshness", async () => {
    const body = await asJson(await fetch(`${BASE_URL}/api/government-references/freshness`));
    expect(body.syncedAt).toBeNull();
    expect(body.newestAction).toBeNull();
  });

  test("the route resolves as a route and not as an id", async () => {
    // /freshness is a static suffix on a router that also has "/:id". Hono
    // matches in registration order, so this proves the ordering is right.
    const res = await fetch(`${BASE_URL}/api/government-references/freshness`);
    expect(res.status).toBe(200);
    expect((await asJson(res)).cadence).toBeDefined();
  });
});

/**
 * A LAW FOUND IN THE LIBRARY ARRIVES WITH ITS SPONSOR ALREADY ON IT.
 *
 * WHY THIS EXISTS, measured on a real one. H.R. 5183 was found in the Library,
 * pulled in, given its official text and its Citizen's Brief, and shared to a
 * timeline — all inside four minutes. The page that produced carried no name and
 * no face, because the Library creates a record from a SEARCH RESULT and a
 * search result does not name the member behind the bill. That was filled by the
 * Provenance sweep, which runs every four hours.
 *
 * The moment somebody finds a law is the moment they share it. So the four-hour
 * window was the whole of that law's first impression, on every screen it
 * reached.
 */
describe("a law pulled in from the Library", () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.CONGRESS_API_KEY;

  beforeEach(() => {
    // congress.gov is not called without a key, so without one this would pass
    // for the wrong reason — proving only that we never asked. Not a credential:
    // every request in these tests is answered by the stub below.
    process.env.CONGRESS_API_KEY = "test-key-not-a-credential";
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.CONGRESS_API_KEY;
    else process.env.CONGRESS_API_KEY = realKey;
  });

  test("COMES OUT WITH THE SPONSOR AND THE DATES, NOT FOUR HOURS LATER", async () => {
    const { resolveLibraryDocument } = await import("../src/services/library-resolve");

    // congress.gov's real answer shape for the detail call, which is the one
    // call this makes and the same one the sweep makes.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.congress.gov") && url.includes("/bill/119/hr/9411")) {
        return new Response(
          JSON.stringify({
            bill: {
              introducedDate: "2025-08-14",
              latestAction: { actionDate: "2025-09-02", text: "Referred to the Committee." },
              sponsors: [
                { bioguideId: "S000510", firstName: "Adam", lastName: "Smith", party: "D", state: "WA" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const result = await resolveLibraryDocument({
      branch: "legislative",
      title: "A bill to prove the sponsor arrives with the law",
      masterReferenceId: "hr-9411-119",
      congress: 119,
      billType: "hr",
      billNumber: "9411",
      chamber: "House",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);

    // The record as it stands the instant the Library hands it back — before any
    // sweep has run, and before the reader has had time to share it.
    const stored = await prisma.governmentReference.findUnique({ where: { id: result.id } });
    expect(stored?.sponsorName).toBe("Adam Smith");
    expect(stored?.sponsorBioguideId).toBe("S000510");
    expect(stored?.sponsorParty).toBe("D");
    expect(stored?.sponsorState).toBe("WA");
    expect(stored?.introducedDate?.toISOString().slice(0, 10)).toBe("2025-08-14");
    expect(stored?.lastActionText).toBe("Referred to the Committee.");
  });

  test("a source that will not answer leaves the law whole, and empty", async () => {
    const { resolveLibraryDocument } = await import("../src/services/library-resolve");

    // congress.gov down. The law must still arrive — with nothing invented in
    // place of the sponsor, and nothing thrown.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("api.congress.gov")) return new Response("no", { status: 503 });
      return realFetch(input, init);
    }) as typeof fetch;

    const result = await resolveLibraryDocument({
      branch: "legislative",
      title: "A bill nobody could tell us about",
      masterReferenceId: "hr-9412-119",
      congress: 119,
      billType: "hr",
      billNumber: "9412",
      chamber: "House",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = await prisma.governmentReference.findUnique({ where: { id: result.id } });
    expect(stored?.title).toBe("A bill nobody could tell us about");
    // Null, not a stand-in. The sweep will try again on its own schedule.
    expect(stored?.sponsorName).toBeNull();
    expect(stored?.sponsorBioguideId).toBeNull();
  });
});
