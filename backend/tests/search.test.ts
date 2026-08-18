/**
 * The Library search returns what you asked for, and nothing else.
 *
 * THE DEFECT THIS PINS. Ranking used one number and a floor of 10. A bill could
 * clear that floor without matching the query at all: current Congress +25,
 * updated in the last 60 days +20, arriving from the recently-updated pool +10,
 * a leadership bill number +15. Seventy points of pure prominence against a bar
 * of ten, so every search returned the same freshly-touched headline bills
 * whatever was typed. It read as a canned list because it was one.
 *
 * Relevance and prominence are separate numbers now. Prominence orders results;
 * it cannot create them.
 *
 * Everything above the network runs for real: keyword extraction, the source
 * merge, the scorer, the filter, the ranking. Only congress.gov, GovInfo and
 * the model are answered from memory, at the boundary where this code stops.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
// Imported first, for its side effect: it sets DATABASE_URL before anything
// constructs a Prisma client. The search reads the local reference table as one
// of its sources, so it needs a database even though this test is about ranking.
import "./helpers/server";
import { searchCongressBills } from "../src/services/congress-search";

const realFetch = globalThis.fetch;
const API_KEY = "test-key-never-sent-anywhere";

/** Today, so freshness bonuses actually apply — that is the point of the test. */
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * A bill that is everything the old scorer loved and nothing the reader asked
 * for: current Congress, updated today, a leadership number.
 */
const PROMINENT_BUT_IRRELEVANT = {
  congress: 119,
  type: "HR",
  number: "1",
  title: "Lower Energy Costs Act",
  originChamber: "House",
  latestAction: { actionDate: TODAY, text: "Passed House." },
  updateDate: TODAY,
};

/** An actual match for the query used below. */
const RELEVANT = {
  congress: 119,
  type: "HR",
  number: "4836",
  title: "Veterans Healthcare Improvement Act",
  originChamber: "House",
  latestAction: { actionDate: TODAY, text: "Referred to committee." },
  updateDate: TODAY,
};

interface StubOptions {
  /** What the recently-updated pool returns. */
  pool?: unknown[];
  /** What GovInfo full-text/title search returns (package ids). */
  govinfo?: string[];
}

function stubNetwork(options: StubOptions = {}): void {
  const pool = options.pool ?? [PROMINENT_BUT_IRRELEVANT, RELEVANT];

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // The recently-updated pool: congress.gov's bill list for this Congress.
    if (url.includes("api.congress.gov/v3/bill/119?")) {
      return Response.json({ bills: pool });
    }

    // Individual bill lookups (hydration, explicit refs).
    const detail = /api\.congress\.gov\/v3\/bill\/(\d+)\/([a-z]+)\/(\d+)/.exec(url);
    if (detail) {
      const match = [...pool, PROMINENT_BUT_IRRELEVANT, RELEVANT].find(
        (b) =>
          String((b as { number: string }).number) === detail[3] &&
          (b as { type: string }).type.toLowerCase() === detail[2],
      );
      return Response.json({ bill: match ?? {} });
    }

    // GovInfo full-text search — nothing, unless a test says otherwise.
    if (url.includes("govinfo.gov")) {
      return Response.json({ results: options.govinfo ?? [], count: (options.govinfo ?? []).length });
    }

    // The interpreter and the web-grounding step. Answering with no expansions
    // keeps the test about ranking rather than about the model.
    if (url.includes("api.openai.com") || url.includes("generativelanguage.googleapis.com")) {
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ expandedTerms: [], knownBills: [], correctedQuery: null }),
            },
          },
        ],
      });
    }

    return realFetch(input, init);
  }) as typeof fetch;
}

beforeAll(() => {
  process.env.OPENAI_API_KEY ??= API_KEY;
});

beforeEach(() => stubNetwork());
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("a search result has to have matched the search", () => {
  test("the recently-updated pool cannot introduce a bill on freshness alone", async () => {
    // HR 1 is everything the ranker used to reward: current Congress, updated
    // today, a leadership bill number, passed a chamber. It matches nothing
    // about "healthcare".
    //
    // HONEST NOTE ON WHAT THIS PROVES. It passes under the old scoring too,
    // because `recentPool` already refuses to emit a bill whose title does not
    // match the keywords — so this particular bill never reached the ranker to
    // be rescued by its prominence. The hole was real but latent: the filter
    // was a total of 10 against as much as 70 points of pure prominence, so the
    // day any source stopped pre-filtering, irrelevant bills would have ranked.
    // This pins the outcome at the boundary that actually enforces it today,
    // and the invariant below pins the ranker itself.
    const output = await searchCongressBills(API_KEY, "healthcare", 20, 0);
    const ids = output.results.map((r) => r.masterReferenceId);

    expect(ids).not.toContain("hr-1-119");
    expect(ids).toContain("hr-4836-119");
  });

  test("every returned result carries positive relevance", async () => {
    const output = await searchCongressBills(API_KEY, "healthcare", 20, 0);

    expect(output.results.length).toBeGreaterThan(0);
    for (const result of output.results) {
      // THE INVARIANT: nothing reaches a reader without having matched what
      // they asked for. Freshness, legislative progress and a headline bill
      // number order results; they cannot create one. Before the score was
      // split in two, they could.
      expect(result.relevance).toBeGreaterThan(0);
    }
  });

  test("a query nothing matches returns nothing, rather than the recent pool", async () => {
    // The honest answer to "no bill is about this" is no results. Handing back
    // whatever happened to be updated this week is worse than empty, because
    // the reader cannot tell the difference.
    const output = await searchCongressBills(API_KEY, "zzzzqqq", 20, 0);
    expect(output.results).toEqual([]);
    expect(output.totalMatched).toBe(0);
  });

  test("prominence still orders the results it is allowed to order", async () => {
    // Two genuine matches, one further along and more recently touched. Both
    // relevant, so both appear — and the more prominent one leads.
    const olderMatch = {
      ...RELEVANT,
      number: "9001",
      title: "Veterans Healthcare Improvement Act of 2019",
      congress: 116,
      updateDate: "2019-06-01",
      latestAction: { actionDate: "2019-06-01", text: "Referred to committee." },
    };
    stubNetwork({ pool: [olderMatch, RELEVANT] });

    const output = await searchCongressBills(API_KEY, "healthcare", 20, 0);
    const ids = output.results.map((r) => r.masterReferenceId);

    expect(ids[0]).toBe("hr-4836-119");
    expect(ids).toContain("hr-9001-116");
  });
});
