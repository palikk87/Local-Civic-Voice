/**
 * Executive search sends what was typed, and shows what came back.
 *
 * There was an interpretation layer here and removing it was the fix. The
 * reasoning behind building it was sound and the measurement behind it was too
 * narrow: one full-sentence query returns junk from a keyword search, so a
 * rewriting layer was built — and then applied to every query, including the
 * many that were already fine.
 *
 * MEASURED AGAINST THE LIVE FEDERAL REGISTER, raw, no rewriting:
 *
 *   "tariffs"                 355 hits, first "Ending Certain Tariff Actions"
 *   "childhood vaccines"        9 hits, first "Delivering Gold Standard
 *                                       Childhood Vaccine Recommendations"
 *   "artificial intelligence"  66 hits, first "Promoting Advanced Artificial
 *                                       Intelligence Innovation and Security"
 *   "student loans"            92 hits, first "Restoring Public Service Loan
 *                                       Forgiveness"
 *
 * Every one is the document a person meant, found by typing what they would
 * naturally type. A rewrite could only move those results — and did far worse
 * than that: when the phrase it invented did not occur verbatim, the search
 * returned nothing at all.
 *
 * The fixture is the real recorded response for "childhood vaccines".
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { searchExecutiveDocuments } from "../src/services/executive-search";
import plainTerms from "./fixtures/fr-search-plain-terms.json";

const realFetch = globalThis.fetch;
let asked: string[] = [];

function stub(status = 200): void {
  asked = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    if (status !== 200) return new Response("upstream error", { status });
    return Response.json(plainTerms);
  }) as typeof fetch;
}

/** The query as the Federal Register receives it. */
function sentQuery(url: string): string {
  return new URL(url).searchParams.get("conditions[term]") ?? "";
}

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("executive search", () => {
  test("sends the reader's exact words, unchanged", async () => {
    stub();
    await searchExecutiveDocuments("childhood vaccines", 10);

    expect(asked).toHaveLength(1);
    expect(sentQuery(asked[0]!)).toBe("childhood vaccines");
  });

  test("adds no quotes, no phrases, no invented terms", async () => {
    // The interpretation layer quoted phrases of its own choosing. A phrase
    // that occurs in no document returns nothing, which is how this search
    // spent a day answering every query with an empty list.
    stub();
    await searchExecutiveDocuments("border security", 10);

    const sent = sentQuery(asked[0]!);
    expect(sent).toBe("border security");
    expect(sent).not.toContain('"');
    expect(sent).not.toContain(" OR ");
    expect(sent).not.toContain(" AND ");
  });

  test("asks one question, not a ladder of them", async () => {
    // One request per search. The ladder existed to rescue a rewrite that had
    // missed; with nothing rewritten there is nothing to rescue.
    stub();
    await searchExecutiveDocuments("tariffs", 10);
    expect(asked).toHaveLength(1);
  });

  test("never filters by agency", async () => {
    // Measured: conditions[agencies][] with a department name answers HTTP 400,
    // and with the API's own slug answers 0 — presidential documents are not
    // attributed to agencies at all.
    stub();
    await searchExecutiveDocuments("childhood vaccines", 10);
    expect(new URL(asked[0]!).searchParams.getAll("conditions[agencies][]")).toHaveLength(0);
  });

  test("returns executive orders only, not every presidential document", async () => {
    // PRESDOCU alone also returns proclamations, memoranda and notices, and the
    // difference is not academic. Measured live: "border security" gives 292
    // presidential documents whose second entry is the proclamation "90th
    // Anniversary of the Social Security Act", against 86 executive orders
    // whose second entry is EO 14167 on the military's role at the border.
    stub();
    await searchExecutiveDocuments("childhood vaccines", 10);

    const params = new URL(asked[0]!).searchParams;
    expect(params.getAll("conditions[type][]")).toContain("PRESDOCU");
    expect(params.getAll("conditions[presidential_document_type][]")).toContain("executive_order");
  });

  test("every result carries the number a record is named after", async () => {
    // A record is named eo-14420. A proclamation has no number to be named by
    // and could never become one, so a result without a number is a dead end
    // for everything downstream of the search.
    stub();
    const output = await searchExecutiveDocuments("childhood vaccines", 10);

    expect(output.results.length).toBeGreaterThan(0);
    for (const doc of output.results) {
      expect(doc.executive_order_number).toMatch(/^\d+$/);
    }
  });

  test("shows the source's own ranking, in the source's own order", async () => {
    // Nothing here reorders what comes back. The Federal Register searched the
    // FULL TEXT of every document; this code sees titles and abstracts only, so
    // any ranking it applied would be a worse opinion formed from less
    // information.
    stub();
    const output = await searchExecutiveDocuments("childhood vaccines", 10);

    expect(output.results.map((r) => r.title)).toEqual(
      plainTerms.results.map((r) => r.title),
    );
    expect(output.results[0]!.title).toContain("Delivering Gold Standard Childhood Vaccine");
    expect(output.count).toBe(plainTerms.count);
  });

  test("reports the real total, not the page size", async () => {
    stub();
    const output = await searchExecutiveDocuments("childhood vaccines", 2);
    expect(output.count).toBe(2);
  });

  test("an upstream failure is an empty result, not a crash", async () => {
    stub(503);
    const output = await searchExecutiveDocuments("tariffs", 10);
    expect(output.results).toEqual([]);
    expect(output.count).toBe(0);
  });

  test("pages with the offset the client asked for", async () => {
    stub();
    await searchExecutiveDocuments("tariffs", 10, 20);
    expect(new URL(asked[0]!).searchParams.get("page")).toBe("3");
  });
});
