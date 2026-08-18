/**
 * The executive branch pulls its own text, its own way.
 *
 * The Federal Register asks for no key and throttles nobody. Its difficulty is
 * a different one: it publishes the same order at three URLs and only one of
 * them is the order.
 *
 * MEASURED against document 2026-16730 (Executive Order 14420) before this was
 * written. Both fixtures below are the real bytes that came back:
 *
 *   raw_text_url   11,224 bytes, and despite the .txt it is HTML — an
 *                  <html><head><title>Federal Register, Volume 91 Issue 156
 *                  </title> wrapper around a <pre>, opening with gazette
 *                  furniture ([[Page 53171]], "Vol. 91", "No. 156",
 *                  "Part XXX", printer's rules) before reaching the order
 *   body_html_url  12,006 bytes beginning "Executive Order 14420 of August 10,
 *                  2026", the title, then "By the authority vested in me as
 *                  President…". The order, and nothing else
 *
 * The pipeline preferred raw text and stripped no markup at sync time, so the
 * stored "full text" of an executive order began with a magazine cover page —
 * and the brief for it was written from that.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import {
  fetchExecutiveOrderText,
  stripFederalRegisterFurniture,
} from "../src/services/reference-content";

const BODY_HTML = await Bun.file(
  new URL("./fixtures/federalregister-eo-14420.body.html", import.meta.url),
).text();
const RAW_TEXT = await Bun.file(
  new URL("./fixtures/federalregister-eo-14420.raw.txt", import.meta.url),
).text();

const realFetch = globalThis.fetch;

const DOC = "2026-16730";
const BODY_URL = `https://www.federalregister.gov/documents/full_text/html/2026/08/14/${DOC}.html`;
const RAW_URL = `https://www.federalregister.gov/documents/full_text/text/2026/08/14/${DOC}.txt`;

function eoRow(sourceUrl: string | null, masterReferenceId = "eo-14420") {
  return {
    id: "ref_test",
    masterReferenceId,
    referenceType: "executive_order",
    sourceUrl,
    congress: null,
    fullText: null,
    fullTextHash: null,
    fullTextUrl: null,
    citizenBriefJson: null,
    sourceCheckedAt: null,
    lawVersion: 1,
    citizenBriefVersion: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Serve each URL from a map, and record the order they were asked for in. */
function stub(routes: Record<string, { status?: number; body: string }>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    const route = routes[key]!;
    return new Response(route.body, { status: route.status ?? 200 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return asked;
}

const deadline = () => Date.now() + 20_000;

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("executive orders", () => {
  test("takes the document body, not the page of the gazette it was printed on", async () => {
    const asked = stub({
      [`https://www.federalregister.gov/api/v1/documents/${DOC}.json`]: {
        body: JSON.stringify({ body_html_url: BODY_URL, raw_text_url: RAW_URL }),
      },
      [BODY_URL]: { body: BODY_HTML },
      [RAW_URL]: { body: RAW_TEXT },
    });

    const result = await fetchExecutiveOrderText(
      eoRow(`https://www.federalregister.gov/documents/2026/08/14/${DOC}/some-title`),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.url).toBe(BODY_URL);
    expect(result!.text).toContain("By the authority vested in me as President");

    // Nothing from the Federal Register's own front matter.
    expect(result!.text).not.toContain("Federal Register, Volume 91");
    expect(result!.text).not.toContain("[[Page");

    // And the raw-text URL was never even requested, because the better one
    // answered first.
    expect(asked).not.toContain(RAW_URL);
  });

  test("stores readable prose, never markup", async () => {
    stub({
      [`https://www.federalregister.gov/api/v1/documents/${DOC}.json`]: {
        body: JSON.stringify({ body_html_url: BODY_URL }),
      },
      [BODY_URL]: { body: BODY_HTML },
    });

    const result = await fetchExecutiveOrderText(
      eoRow(`https://www.federalregister.gov/documents/2026/08/14/${DOC}/some-title`),
      deadline(),
    );

    expect(result!.text).not.toContain("<p");
    expect(result!.text).not.toContain("</h1>");
    expect(result!.text).not.toContain("data-page=");
  });

  test("falls back to raw text and takes the gazette apart", async () => {
    // When body_html is missing, the raw file is what there is — so the
    // furniture has to come off rather than be stored as the law.
    stub({
      [`https://www.federalregister.gov/api/v1/documents/${DOC}.json`]: {
        body: JSON.stringify({ raw_text_url: RAW_URL }),
      },
      [RAW_URL]: { body: RAW_TEXT },
    });

    const result = await fetchExecutiveOrderText(
      eoRow(`https://www.federalregister.gov/documents/2026/08/14/${DOC}/some-title`),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.text).toContain("Executive Order 14420 of August 10, 2026");
    expect(result!.text).not.toContain("[[Page");
    expect(result!.text).not.toContain("Federal Register, Volume 91 Issue 156");
    // The volume/issue cover block is gone with it.
    expect(result!.text.slice(0, 200)).not.toContain("Part XXX");
  });

  test("finds the order by number when the stored URL leads nowhere", async () => {
    const asked = stub({
      [`https://www.federalregister.gov/api/v1/documents/${DOC}.json`]: {
        status: 404,
        body: "{}",
      },
      "https://www.federalregister.gov/api/v1/documents.json": {
        body: JSON.stringify({
          results: [
            { executive_order_number: "14399", body_html_url: "https://example.invalid/wrong.html" },
            { executive_order_number: "14420", body_html_url: BODY_URL },
          ],
        }),
      },
      [BODY_URL]: { body: BODY_HTML },
    });

    const result = await fetchExecutiveOrderText(
      eoRow(`https://www.federalregister.gov/documents/2026/08/14/${DOC}/some-title`),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.source).toBe("federalregister/search");
    // The search is a term search, so the number is checked rather than
    // trusted: the wrong order was returned first and was not taken.
    expect(asked).not.toContain("https://example.invalid/wrong.html");
  });

  test("searches by term, because the number filter is an HTTP 400", async () => {
    // conditions[executive_order_number] reads like the right filter and the
    // Federal Register answers it with 400. conditions[term] is the one that
    // works. Pinned so nobody 'corrects' it back.
    const asked = stub({
      [`https://www.federalregister.gov/api/v1/documents/${DOC}.json`]: { status: 404, body: "{}" },
      "https://www.federalregister.gov/api/v1/documents.json": {
        body: JSON.stringify({ results: [] }),
      },
      "https://www.federalregister.gov/documents/": { status: 404, body: "" },
    });

    await fetchExecutiveOrderText(
      eoRow(`https://www.federalregister.gov/documents/2026/08/14/${DOC}/some-title`),
      deadline(),
    );

    const search = asked.find((u) => u.includes("/api/v1/documents.json"));
    expect(search).toBeDefined();
    expect(search).toContain("conditions[term]=14420");
    expect(search).not.toContain("conditions[executive_order_number]");
  });
});

describe("stripFederalRegisterFurniture", () => {
  test("leaves text alone when there is no heading to cut on", () => {
    // Cutting on a guess is worse than leaving a header in place.
    const plain = "By the authority vested in me as President, it is hereby ordered: ".repeat(6);
    expect(stripFederalRegisterFurniture(plain)).toContain("By the authority vested in me");
  });

  test("removes page markers that break sentences in half", () => {
    const broken = "The Secretary shall, within [[Page 53174]] 90 days, submit a report.";
    expect(stripFederalRegisterFurniture(broken)).toBe(
      "The Secretary shall, within 90 days, submit a report.",
    );
  });

  test("cuts on the order's own number, not on a citation to another one", () => {
    // Measured on document 2026-16730: the real heading sits at character 778
    // and a citation to Executive Order 14407 at 1,982. Cutting at the first
    // heading-shaped string threw away the enacting sentence.
    const gazette =
      "[[Page 53171]] Vol. 91 No. 156 Part XXX The President\n" +
      "Executive Order 14420 of August 10, 2026\n" +
      "By the authority vested in me as President, it is hereby ordered:\n" +
      "Section 1. Executive Order 14407 of May 29, 2026 committed the Government to " +
      "a policy this order now extends. ".repeat(3);

    const cleaned = stripFederalRegisterFurniture(gazette, "14420");
    expect(cleaned.startsWith("Executive Order 14420 of August 10, 2026")).toBe(true);
    expect(cleaned).toContain("By the authority vested in me as President");
    expect(cleaned).not.toContain("Part XXX");
  });
});
