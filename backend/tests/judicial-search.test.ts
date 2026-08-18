/**
 * The judicial branch translates a citizen's question into a court's language.
 *
 * EVERY NUMBER BELOW IS RECORDED FROM THE LIVE COURTLISTENER API, asking the
 * same person's question three ways:
 *
 *   q = can the government make you get a vaccine        (what it did)
 *     → 1,098 hits led by "Make The Road New York v. Kristi Noem"
 *
 *   q = "compulsory vaccination", all federal courts
 *     → 290 hits led by district-court disputes
 *
 *   q = "compulsory vaccination", Supreme Court
 *     → 12 hits including Jacobson v. Massachusetts (1905) — the case that
 *       actually decides the question that was asked
 *
 * Both halves matter, and the second was learned by getting it wrong. The
 * phrase alone is not enough; a citizen asking what the law IS is asking about
 * the court that settles it, so the Supreme Court is asked first and the rest
 * of the federal courts after. Rank order, not scope: nothing is removed.
 *
 * TWO REQUESTS PER SEARCH, because CourtListener allows five a minute per
 * account — a ceiling one reader can hit by searching twice.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { buildLadder, searchJudicialOpinions } from "../src/services/judicial-search";
import { plainIntent } from "../src/services/search-intent";

import rawProse from "./fixtures/cl-search-raw-prose.json";
import phraseAllCourts from "./fixtures/cl-search-phrase.json";
import phraseScotus from "./fixtures/cl-search-phrase-scotus.json";

const realFetch = globalThis.fetch;
const QUESTION = "can the government make you get a vaccine";

const GOOD_INTENT = {
  topic: "compulsory vaccination",
  phrases: ["compulsory vaccination"],
  terms: ["vaccination", "mandate", "police power"],
  caseNames: [],
  bills: [],
  agencies: [],
  presidentialOnly: false,
  from: null,
  to: null,
};

let asked: string[] = [];

interface StubOptions {
  intent: Record<string, unknown> | null;
  /** Answer the first N CourtListener calls with a throttle. */
  throttleFirst?: number;
  /** Answer a caseName rung with nothing, as if the case does not exist. */
  emptyCaseName?: boolean;
}

function stub({ intent, throttleFirst = 0, emptyCaseName = false }: StubOptions): void {
  asked = [];
  let throttled = 0;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
      if (!intent) return new Response("upstream unavailable", { status: 503 });
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }],
      });
    }

    if (url.includes("courtlistener.com")) {
      if (throttled < throttleFirst) {
        throttled++;
        return new Response(
          JSON.stringify({
            detail: "Request was throttled. Rate limit exceeded: 5/min. Expected available in 1 second.",
          }),
          { status: 429 },
        );
      }
      asked.push(url);
      const params = new URL(url).searchParams;
      const q = params.get("q") ?? "";
      if (q.startsWith("caseName:")) {
        return Response.json(emptyCaseName ? { count: 0, results: [] } : phraseScotus);
      }
      if (!q.includes('"')) return Response.json(rawProse);
      return Response.json(params.get("court") === "scotus" ? phraseScotus : phraseAllCourts);
    }

    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

beforeAll(() => {
  process.env.GEMINI_API_KEY ??= "test-key-never-sent-anywhere";
  process.env.COURTLISTENER_API_KEY ??= "test-token-never-sent-anywhere";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("judicial search", () => {
  test("asks the Supreme Court first, in the words a ruling uses", async () => {
    stub({ intent: GOOD_INTENT });
    await searchJudicialOpinions(QUESTION, 10);

    const first = new URL(asked[0] ?? "");
    expect(first.searchParams.get("q")).toBe('"compulsory vaccination"');
    expect(first.searchParams.get("court")).toBe("scotus");
    // Never the sentence the reader typed.
    expect(first.searchParams.get("q")).not.toContain("make you get");
  });

  test("Jacobson v. Massachusetts reaches the reader", async () => {
    // The whole point, in one assertion. The old search returned
    // "Make The Road New York v. Kristi Noem" for this question.
    stub({ intent: GOOD_INTENT });
    const output = await searchJudicialOpinions(QUESTION, 10);

    const names = output.results.map((r) => r.case_name);
    expect(names).toContain("Jacobson v. Massachusetts");
    expect(names).not.toContain("Make The Road New York v. Kristi Noem");
  });

  test("a landmark outranks a fresher case that matched less well", async () => {
    // Prominence orders; it does not admit. A 1905 opinion can be the
    // controlling law on a question asked today, so courts are ranked by how
    // often they are cited rather than by how recent they are — ranking a
    // court's work by freshness buries exactly what a citizen is looking for.
    stub({ intent: GOOD_INTENT });
    const output = await searchJudicialOpinions(QUESTION, 10);

    const jacobson = output.results.findIndex((r) => r.case_name === "Jacobson v. Massachusetts");
    expect(jacobson).toBeGreaterThanOrEqual(0);
    expect(jacobson).toBeLessThan(5);
  });

  test("spends at most two requests, because five a minute is the ceiling", async () => {
    stub({ intent: GOOD_INTENT });
    await searchJudicialOpinions(QUESTION, 10);
    expect(asked.length).toBeLessThanOrEqual(2);
  });

  test("waits out a throttle instead of reporting an empty court", async () => {
    // A 429 is not "no cases about this". Treating it as one is how a
    // published opinion two seconds away becomes a question with no answer.
    stub({ intent: GOOD_INTENT, throttleFirst: 1 });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results.map((r) => r.case_name)).toContain("Jacobson v. Massachusetts");
  });

  test("a case the model named but CourtListener does not have is dropped silently", async () => {
    // THE LINE. A model asked about vaccine law will name cases with total
    // confidence, and some of them do not exist. A case name is a LEAD: it is
    // asked of CourtListener, and if nothing comes back the reader is never
    // told about it. On a civics platform an invented precedent is worse than
    // an empty page.
    stub({
      intent: { ...GOOD_INTENT, caseNames: ["Wilkerson v. Board of Public Health"] },
      emptyCaseName: true,
    });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.results.map((r) => r.case_name)).not.toContain(
      "Wilkerson v. Board of Public Health",
    );
    // And every result that IS shown came back from the API.
    const real = new Set(
      [...phraseScotus.results, ...phraseAllCourts.results, ...rawProse.results].map(
        (r) => r.caseName,
      ),
    );
    for (const result of output.results) expect(real.has(result.case_name)).toBe(true);
  });

  test("still searches when the model is unavailable", async () => {
    stub({ intent: null });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.intent.interpreted).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe("the judicial ladder", () => {
  test("a named case leads, and is searched across every court", () => {
    const intent = {
      ...plainIntent("the vaccine case", "judicial"),
      caseNames: ["Jacobson v. Massachusetts"],
      phrases: ["compulsory vaccination"],
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    expect(ladder[0]!.q).toBe('caseName:("Jacobson v. Massachusetts")');
    // Not scoped: the case a reader names may well be a lower court's.
    expect(ladder[0]!.court).toBeUndefined();
  });

  test("the Supreme Court rung outranks the all-courts rung for the same phrase", () => {
    const intent = {
      ...plainIntent("vaccine mandates", "judicial"),
      phrases: ["compulsory vaccination"],
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    const scotus = ladder.find((r) => r.court === "scotus");
    const all = ladder.find((r) => r.court === undefined && r.q.includes('"'));
    expect(scotus).toBeDefined();
    expect(all).toBeDefined();
    expect(scotus!.weight).toBeGreaterThan(all!.weight);
  });
});
