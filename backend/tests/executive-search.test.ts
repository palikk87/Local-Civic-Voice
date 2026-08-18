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
  test("joins the phrase family with OR, not AND", () => {
    // AND was the first version, on the reasoning that two phrases together
    // are narrower than either alone. Measured against the live API,
    // `"childhood vaccine" AND "immunization schedule"` returns ZERO: the two
    // rarely co-occur in one document, so the narrowest rung was an empty one
    // — and it led the ladder, spending a request to find nothing.
    const intent = {
      ...plainIntent("kids and vaccines", "executive"),
      phrases: ["childhood vaccine", "immunization schedule"],
      topic: "childhood vaccine policy",
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    expect(ladder[0]!.term).toBe('"childhood vaccine" OR "immunization schedule"');
    expect(ladder[0]!.term).not.toContain(" AND ");
    expect(ladder[0]!.weight).toBeGreaterThan(ladder[1]!.weight);
  });

  test("the broad topic rung is never trimmed off the end", () => {
    // THE SAFETY NET, and it is not optional. Interpretation can produce
    // phrases that read plausibly and appear in no document; when it does,
    // every precise rung returns nothing and this is the only thing between
    // the reader and an empty page. It used to be appended before the ladder
    // was cut to the request budget, so a long phrase list pushed it out.
    const intent = {
      ...plainIntent("kids and vaccines", "executive"),
      phrases: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
      topic: "childhood vaccine policy",
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    expect(ladder[ladder.length - 1]!.term).toBe("childhood vaccine policy");
    expect(ladder[ladder.length - 1]!.term).not.toContain('"');
  });

  test("never filters by agency", () => {
    // Measured: conditions[agencies][] with a name the model produces answers
    // HTTP 400, and the API's own slug answers 0 — presidential documents are
    // not attributed to agencies at all. Applied to every rung it turned a
    // working search into an empty one whenever the interpretation happened to
    // name a department.
    stub({ intent: { ...GOOD_INTENT, agencies: ["Department of Health and Human Services"] } });
    return searchExecutiveDocuments(QUESTION, 10).then(() => {
      for (const url of asked) {
        expect(new URL(url).searchParams.getAll("conditions[agencies][]")).toHaveLength(0);
      }
    });
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

/**
 * A search box cannot wait for a model that is still thinking.
 *
 * THE OUTAGE THIS PINS. There was no timeout on the model call — none, on any
 * path. Live judicial search returned 502 "Application failed to respond"
 * after 36 seconds while the server sat healthy, the queue empty, and the log
 * silent: nothing had failed, it was still waiting. The model had been handed
 * a twelve-thousand-token allowance to reason over what is a short JSON
 * extraction, and was using it.
 *
 * Two bounds now, both necessary. A ceiling on how long we wait, and a much
 * smaller allowance to think with on an interactive path. Underneath both sits
 * a real fallback: the reader's own words, searched plainly.
 */
describe("a slow model does not hang the search", () => {
  test("interpretation gives up and search still answers", async () => {
    asked = [];
    let intentAborted = false;

    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        // A model that never answers. Without a ceiling this is the 502.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            intentAborted = true;
            const timedOut = new Error("The operation timed out.");
            timedOut.name = "TimeoutError";
            reject(timedOut);
          });
        });
      }

      if (url.includes("federalregister.gov")) {
        asked.push(url);
        return Response.json(rawProse);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const output = await searchExecutiveDocuments(QUESTION, 10);

    // The request was cut off rather than waited on...
    expect(intentAborted).toBe(true);
    // ...and the reader still got a search, run on their own words.
    expect(output.intent.interpreted).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
    expect(output.results.length).toBeGreaterThan(0);
    // Longer than the 8s ceiling the code enforces, so this measures the
    // code's timeout rather than the runner's.
  }, 20_000);
});
