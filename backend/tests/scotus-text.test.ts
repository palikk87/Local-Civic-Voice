/**
 * The judicial branch pulls its own text, its own way.
 *
 * Three branches, three APIs, three sets of rules — a single shared protocol
 * fit none of them, and trying to make one work is how all three ended up
 * reporting "no official text is published" for documents that are published.
 * This pins the judicial one.
 *
 * WHAT WAS MEASURED against the live CourtListener API before this was written,
 * because every line below exists to handle something it actually does:
 *
 *   /api/rest/v4/search/            200 with no token
 *   /api/rest/v4/opinions/…         401 with no token
 *   the public opinion web page     202 and a ~2KB bot check, no ruling in it
 *   any of them, 6th call a minute  429 "Rate limit exceeded: 5/min.
 *                                        Expected available in 2 seconds."
 *
 * The fixture is a real recorded response for cluster 9986254 (Loper Bright
 * Enterprises v. Raimondo), with the 247,737-character opinion truncated.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { fetchScotusText } from "../src/services/reference-content";
import clusterFixture from "./fixtures/courtlistener-cluster-9986254.json";

const realFetch = globalThis.fetch;
const KEY = "test-token-never-sent-anywhere";

/** Only the two fields the judicial fetcher reads. */
function scotusRow(sourceUrl: string | null, masterReferenceId = "scotus-22-451") {
  return {
    id: "ref_test",
    masterReferenceId,
    referenceType: "scotus_case",
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

interface Call {
  url: string;
  auth: string | undefined;
}

/** Answer requests from a script, and record exactly what was asked for. */
function stub(script: Array<{ status: number; body: unknown }>): Call[] {
  const calls: Call[] = [];
  let index = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("Authorization") ?? undefined });
    const step = script[Math.min(index, script.length - 1)];
    index++;
    const body = typeof step!.body === "string" ? step!.body : JSON.stringify(step!.body);
    return new Response(body, {
      status: step!.status,
      headers: { "Content-Type": "application/json" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
  return calls;
}

const deadline = () => Date.now() + 20_000;

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.COURTLISTENER_API_KEY;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("Supreme Court opinions", () => {
  test("goes straight to the cluster already named in the stored URL", async () => {
    process.env.COURTLISTENER_API_KEY = KEY;
    const calls = stub([{ status: 200, body: clusterFixture }]);

    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/9986254/loper-bright-enterprises-v-raimondo/"),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.text).toContain("OCTOBER TERM, 2023");
    expect(result!.source).toBe("courtlistener/cluster");

    // ONE request. The cluster id is in the URL we stored at sync time, so
    // finding the case again by searching for its docket number is work we do
    // not need to do — and at five requests a minute, work we cannot afford.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://www.courtlistener.com/api/rest/v4/opinions/?cluster=9986254");
    expect(calls[0]!.auth).toBe(`Token ${KEY}`);
  });

  test("reads an opinion that has no plain text but does have markup", async () => {
    // Older opinions carry nothing in plain_text and live in one of the markup
    // columns instead. Reading only plain_text and html_with_citations — which
    // is what this did — drops those cases silently: no error, no text, and a
    // reader told the ruling was never published.
    process.env.COURTLISTENER_API_KEY = KEY;
    stub([
      {
        status: 200,
        body: {
          results: [
            {
              id: 1,
              type: "020lead",
              plain_text: "",
              html_with_citations: "",
              html: "",
              html_lawbox: `<p>${"The judgment of the Court of Appeals is reversed. ".repeat(12)}</p>`,
            },
          ],
        },
      },
    ]);

    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/111111/some-case/"),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.text).toContain("The judgment of the Court of Appeals is reversed.");
    expect(result!.text).not.toContain("<p>");
  });

  test("labels and joins every opinion in the decision, in the court's order", async () => {
    // A ruling is the majority AND the concurrences AND the dissents. The
    // dissent is the strongest statement of the case against, written by
    // justices who heard the argument; dropping it and then asking a model for
    // "the argument against" is an invitation to invent one.
    process.env.COURTLISTENER_API_KEY = KEY;
    stub([
      {
        status: 200,
        body: {
          results: [
            { id: 2, type: "040dissent", ordering_key: 2, plain_text: "I respectfully dissent. ".repeat(20) },
            { id: 1, type: "020lead", ordering_key: 1, plain_text: "Held: the statute is valid. ".repeat(20) },
          ],
        },
      },
    ]);

    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/222222/some-case/"),
      deadline(),
    );

    expect(result).not.toBeNull();
    expect(result!.text).toContain("## Lead");
    expect(result!.text).toContain("## Dissent");
    expect(result!.text.indexOf("## Lead")).toBeLessThan(result!.text.indexOf("## Dissent"));
  });

  test("waits out the throttle the API asks for instead of reporting no text", async () => {
    // 5 requests a minute. Treating the 429 as a dead endpoint is how a
    // published Supreme Court opinion, sitting in the API two seconds away,
    // reached the reader as "not published anywhere we can read".
    process.env.COURTLISTENER_API_KEY = KEY;
    const calls = stub([
      { status: 429, body: { detail: "Request was throttled. Rate limit exceeded: 5/min. Expected available in 1 second." } },
      { status: 200, body: clusterFixture },
    ]);

    const started = Date.now();
    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/9986254/loper-bright/"),
      Date.now() + 30_000,
    );

    expect(result).not.toBeNull();
    expect(result!.text).toContain("OCTOBER TERM, 2023");
    expect(calls).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_000);
  });

  test("never accepts the public web page as an opinion", async () => {
    // courtlistener.com answers 202 with a bot check. It is HTML, it is over
    // any length floor once padded, and it is not a ruling — so there is no
    // page fallback at all. A placeholder stored as law is worse than nothing.
    process.env.COURTLISTENER_API_KEY = KEY;
    const calls = stub([
      { status: 401, body: { detail: "Invalid token." } },
      { status: 200, body: { results: [] } },
    ]);

    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/9986254/loper-bright/"),
      deadline(),
    );

    expect(result).toBeNull();
    for (const call of calls) {
      expect(call.url).toContain("/api/rest/v4/");
    }
  });

  test("says the key is the problem, and asks nothing without one", async () => {
    const calls = stub([{ status: 200, body: clusterFixture }]);

    const result = await fetchScotusText(
      scotusRow("https://www.courtlistener.com/opinion/9986254/loper-bright/"),
      deadline(),
    );

    // There is no unauthenticated path to a Supreme Court opinion here, so a
    // missing key is a configuration failure to report, not a source to retry.
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("falls back to the docket search only when the stored URL names no cluster", async () => {
    process.env.COURTLISTENER_API_KEY = KEY;
    const calls = stub([
      { status: 200, body: { results: [{ cluster_id: 9986254 }] } },
      { status: 200, body: clusterFixture },
    ]);

    const result = await fetchScotusText(scotusRow("https://www.supremecourt.gov/22-451"), deadline());

    expect(result).not.toBeNull();
    expect(result!.source).toBe("courtlistener/docket-search");
    expect(calls[0]!.url).toContain("docket_number=22-451");
    expect(calls[1]!.url).toContain("cluster=9986254");
  });
});
