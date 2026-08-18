/**
 * The executive branch understands the question before it asks it.
 *
 * EVERY NUMBER BELOW IS RECORDED FROM THE LIVE FEDERAL REGISTER. The two
 * fixtures are the same API answering the same person's question two different
 * ways:
 *
 *   conditions[term] = laws about protecting kids from vaccines   (what it did)
 *     → 3 hits, the first being "National Child's Day, 2023"
 *
 *   conditions[term] = "childhood vaccine"                        (what it does)
 *     → 2 hits, both the actual executive order
 *
 * The search engine was never broken. It was asked whether the words "laws",
 * "about", "protecting", "kids" and "from" appear in a document, and it
 * answered honestly. Nobody writes an executive order using the word "kids".
 *
 * The model runs for real in these tests — its HTTP call is answered from
 * memory, but the prompt is built, the JSON is parsed, and every guard on what
 * it returns executes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { searchExecutiveDocuments } from "../src/services/executive-search";
import { buildLadder } from "../src/services/executive-search";
import { plainIntent } from "../src/services/search-intent";

import rawProse from "./fixtures/fr-search-raw-prose.json";
import phraseHits from "./fixtures/fr-search-phrase.json";

const realFetch = globalThis.fetch;
const QUESTION = "laws about protecting kids from vaccines";

/** What a good interpretation of the question looks like. */
const GOOD_INTENT = {
  topic: "childhood vaccine policy",
  phrases: ["childhood vaccine"],
  terms: ["vaccine", "children", "immunization"],
  presidentialOnly: true,
  agencies: [],
  bills: [],
  caseNames: [],
  from: null,
  to: null,
};

/**
 * The query as the Federal Register receives it.
 *
 * URLSearchParams form-encodes a space as "+", which Rails decodes back to a
 * space — verified against the live API: the plus-encoded and percent-encoded
 * forms of the same phrase return byte-identical results. Decoding it here
 * keeps the assertions about the QUERY rather than about the encoding.
 */
function sentQuery(url: string): string {
  return decodeURIComponent(new URL(url).searchParams.get("conditions[term]") ?? "");
}

interface StubOptions {
  /** What the model returns. `null` = the model is unavailable. */
  intent: Record<string, unknown> | null;
}

let asked: string[] = [];

function stub({ intent }: StubOptions): void {
  asked = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
      if (!intent) return new Response("upstream unavailable", { status: 503 });
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }],
      });
    }

    if (url.includes("federalregister.gov")) {
      asked.push(url);
      // Answer with the fixture whose query this actually is.
      const quoted = /conditions%5Bterm%5D=%22|conditions\[term\]="/.test(url);
      return Response.json(quoted ? phraseHits : rawProse);
    }

    // Grounding provider — not configured in tests.
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

beforeAll(() => {
  process.env.GEMINI_API_KEY ??= "test-key-never-sent-anywhere";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("executive search", () => {
  test("asks for the phrase an order would actually use", async () => {
    stub({ intent: GOOD_INTENT });
    const output = await searchExecutiveDocuments(QUESTION, 10);

    expect(output.intent.interpreted).toBe(true);
    expect(output.intent.phrases).toContain("childhood vaccine");

    // The reader's own words are never what gets quoted at the source.
    const first = sentQuery(asked[0] ?? "");
    expect(first).toBe('"childhood vaccine"');
    expect(first).not.toContain("protecting kids");
  });

  test("the real executive order comes first, where a page header used to", async () => {
    stub({ intent: GOOD_INTENT });
    const output = await searchExecutiveDocuments(QUESTION, 10);

    const titles = output.results.map((r) => r.title);

    // The order the reader was actually asking about is first.
    expect(titles[0]).toContain("Childhood Vaccine");

    // "National Child's Day, 2023" is what the old search put first. It is
    // still in the list, and that is correct — the ladder widens to the plain
    // topic after the phrase, so a document that matched loosely is not thrown
    // away. What changed is that precision now outranks it.
    const noise = titles.indexOf("National Child's Day, 2023");
    expect(noise).toBeGreaterThan(0);
    expect(noise).toBeGreaterThan(titles.findIndex((t) => t.includes("Childhood Vaccine")));
  });

  test("restricts to presidential documents", async () => {
    stub({ intent: GOOD_INTENT });
    await searchExecutiveDocuments(QUESTION, 10);
    expect(new URL(asked[0] ?? "").searchParams.getAll("conditions[type][]")).toContain("PRESDOCU");
  });

  test("still searches when the model is unavailable, and says it did not interpret", async () => {
    // Fails open. Search is interactive: a model outage must degrade the
    // results, never break the box. And the degraded state is reported rather
    // than disguised as an interpretation that happened.
    stub({ intent: null });
    const output = await searchExecutiveDocuments(QUESTION, 10);

    expect(output.intent.interpreted).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
    // Nothing was quoted, because nothing was understood — the only words we
    // know are real are the ones the reader typed.
    expect(sentQuery(asked[0] ?? "")).not.toContain('"');
  });

  test("shows only documents the Federal Register returned", async () => {
    // THE LINE. A model asked for "the top 10 orders about X" will write ten
    // plausible titles and some will not exist. On a civics platform an
    // invented law is worse than an empty page. So the model shapes the
    // question; every document shown came back from the government.
    stub({
      intent: {
        ...GOOD_INTENT,
        // A model that tried to answer instead of interpreting.
        phrases: ["childhood vaccine"],
        agencies: [],
      },
    });
    const output = await searchExecutiveDocuments(QUESTION, 10);

    const returnedTitles = new Set(
      [...phraseHits.results, ...rawProse.results].map((r) => r.title),
    );
    for (const result of output.results) {
      expect(returnedTitles.has(result.title)).toBe(true);
    }
  });
});

describe("the query ladder", () => {
  test("quotes phrases, most precise rung first", () => {
    const intent = {
      ...plainIntent("kids and vaccines", "executive"),
      phrases: ["childhood vaccine", "immunization schedule"],
      topic: "childhood vaccine policy",
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    // Both phrases together is narrower than either alone, so it leads.
    expect(ladder[0]!.term).toBe('"childhood vaccine" AND "immunization schedule"');
    expect(ladder[0]!.weight).toBeGreaterThan(ladder[1]!.weight);
    // And every rung above the plain topic is quoted.
    expect(ladder[1]!.term.startsWith('"')).toBe(true);
  });

  test("never sends an empty query", () => {
    // Interpretation can produce nothing usable. The reader's own words are
    // still a real search, and returning nothing at all is not.
    const bare = { ...plainIntent("", "executive"), topic: "", phrases: [] };
    bare.raw = "the thing about the thing";
    const ladder = buildLadder(bare);

    expect(ladder).toHaveLength(1);
    expect(ladder[0]!.term).toBe("the thing about the thing");
  });
});
