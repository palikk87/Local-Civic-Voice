/**
 * The legislative branch pulls its own text, its own way.
 *
 * congress.gov needs a key, gives clean text, and asks one question the other
 * two branches never do: WHICH text? A bill is not one document. HR 1 of the
 * 119th Congress has six, and they say materially different things. Serving the
 * wrong one is not a formatting problem — it is briefing a citizen on a draft
 * that was amended before it passed.
 *
 * THE DEFECT THIS PINS. The chain reversed the version list and commented
 * "Newest version last in the API response". congress.gov returns them NEWEST
 * FIRST, measured:
 *
 *   HR 22 (119th)   2025-04-10  Engrossed in House
 *                   2025-01-03  Introduced in House
 *
 * So the reverse walked to the oldest and handed back the introduced text of
 * every bill on the platform.
 *
 * And the fix is not "stop reversing". The recorded HR 1 response below —
 * real, unedited — lists "Enrolled Bill" FIRST with a null date and
 * "Public Law" LAST. No ordering rule finds the enacted text in that. The
 * version is chosen by what the version IS.
 */

import { afterAll, afterEach, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { fetchBillText, stripGpoHeader } from "../src/services/reference-content";
import hr1TextVersions from "./fixtures/congress-hr1-119-textversions.json";

const BILL_HTML = await Bun.file(
  new URL("./fixtures/congress-hr22-119-eh.htm", import.meta.url),
).text();

const realFetch = globalThis.fetch;
const KEY = "test-key-never-sent-anywhere";

function billRow(masterReferenceId = "hr-1-119", sourceUrl: string | null = null) {
  return {
    id: "ref_test",
    masterReferenceId,
    referenceType: "bill",
    sourceUrl,
    congress: 119,
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

/** Serve by URL prefix; record what was asked for, in order. */
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
  delete process.env.CONGRESS_API_KEY;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** The URL of the version the fetcher chose, out of what it was offered. */
function chosen(asked: string[]): string | undefined {
  return asked.find((u) => u.startsWith("https://www.congress.gov/119/"));
}

describe("bills", () => {
  test("takes the enacted text of HR 1, which the API lists last", async () => {
    process.env.CONGRESS_API_KEY = KEY;
    const asked = stub({
      "https://api.congress.gov/v3/bill/119/hr/1/text": {
        body: JSON.stringify(hr1TextVersions),
      },
      "https://www.congress.gov/119/": { body: BILL_HTML },
    });

    const result = await fetchBillText(billRow("hr-1-119"), deadline());

    expect(result).not.toBeNull();
    expect(result!.source).toBe("congress.gov/text");

    // "Public Law" is the sixth and final entry in the real response, and
    // "Enrolled Bill" is the first with a null date. Neither the list order nor
    // its reverse lands here.
    const publicLaw = hr1TextVersions.textVersions.find((v) =>
      (v.type ?? "").toLowerCase().includes("public law"),
    );
    const expected = publicLaw?.formats?.find((f) =>
      (f.type ?? "").toLowerCase().includes("formatted text"),
    )?.url;
    expect(expected).toBeDefined();
    expect(chosen(asked)).toBe(expected!);
  });

  test("prefers the passed text over the introduced text", async () => {
    // The exact HR 22 case: two versions, engrossed newer than introduced, the
    // API listing the newer one first. Reversing took the draft.
    process.env.CONGRESS_API_KEY = KEY;
    const asked = stub({
      "https://api.congress.gov/v3/bill/119/hr/22/text": {
        body: JSON.stringify({
          textVersions: [
            {
              date: "2025-04-10T04:00:00Z",
              type: "Engrossed in House",
              formats: [{ type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr22/eh.htm" }],
            },
            {
              date: "2025-01-03T05:00:00Z",
              type: "Introduced in House",
              formats: [{ type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr22/ih.htm" }],
            },
          ],
        }),
      },
      "https://www.congress.gov/119/": { body: BILL_HTML },
    });

    await fetchBillText(billRow("hr-22-119"), deadline());
    expect(chosen(asked)).toBe("https://www.congress.gov/119/bills/hr22/eh.htm");
  });

  test("never downloads a PDF as if it were text", async () => {
    // A PDF arrives as bytes nothing here can read. Accepting one stores a
    // binary blob where the law belongs.
    process.env.CONGRESS_API_KEY = KEY;
    const asked = stub({
      "https://api.congress.gov/v3/bill/119/hr/9/text": {
        body: JSON.stringify({
          textVersions: [
            { date: "2025-01-01", type: "Introduced in House", formats: [{ type: "PDF", url: "https://www.congress.gov/119/bills/hr9/ih.pdf" }] },
          ],
        }),
      },
      "https://api.congress.gov/v3/bill/119/hr/9/summaries": { body: JSON.stringify({ summaries: [] }) },
    });

    const result = await fetchBillText(billRow("hr-9-119"), deadline());
    expect(result).toBeNull();
    expect(asked).not.toContain("https://www.congress.gov/119/bills/hr9/ih.pdf");
  });

  test("strips the Government Publishing Office stamp off the top", async () => {
    process.env.CONGRESS_API_KEY = KEY;
    stub({
      "https://api.congress.gov/v3/bill/119/hr/22/text": {
        body: JSON.stringify({
          textVersions: [
            { date: "2025-04-10", type: "Engrossed in House", formats: [{ type: "Formatted Text", url: "https://www.congress.gov/119/bills/hr22/eh.htm" }] },
          ],
        }),
      },
      "https://www.congress.gov/119/": { body: BILL_HTML },
    });

    const result = await fetchBillText(billRow("hr-22-119"), deadline());

    expect(result).not.toBeNull();
    expect(result!.text).not.toContain("From the U.S. Government Publishing Office");
    expect(result!.text).not.toContain("[Congressional Bills 119th Congress]");
    // The law itself is intact.
    expect(result!.text).toContain("Be it enacted by the Senate and House of Representatives");
    expect(result!.text).toContain("SAVE Act");
  });

  test("takes the newest summary by date, not by list position", async () => {
    // Only used when no version of the text is published — the ordinary state
    // of a bill in its first days. The same positional assumption that broke
    // textVersions is not repeated here.
    process.env.CONGRESS_API_KEY = KEY;
    const body = "This bill requires the Secretary to submit an annual report to Congress. ".repeat(6);
    stub({
      "https://api.congress.gov/v3/bill/119/hr/5/text": { body: JSON.stringify({ textVersions: [] }) },
      "https://api.congress.gov/v3/bill/119/hr/5/summaries": {
        body: JSON.stringify({
          summaries: [
            { actionDate: "2025-06-01", actionDesc: "Passed House", text: `<p>NEWER. ${body}</p>` },
            { actionDate: "2025-01-01", actionDesc: "Introduced in House", text: `<p>OLDER. ${body}</p>` },
          ],
        }),
      },
    });

    const result = await fetchBillText(billRow("hr-5-119"), deadline());

    expect(result).not.toBeNull();
    expect(result!.source).toBe("congress.gov/summaries");
    expect(result!.text.startsWith("NEWER.")).toBe(true);
  });

  test("asks congress.gov for nothing without a key", async () => {
    const asked = stub({ "https://api.congress.gov": { body: "{}" } });
    const result = await fetchBillText(billRow("hr-1-119"), deadline());

    expect(result).toBeNull();
    expect(asked.filter((u) => u.startsWith("https://api.congress.gov"))).toHaveLength(0);
  });
});

describe("stripGpoHeader", () => {
  test("removes the provenance block and the blank run under it", () => {
    const stamped =
      "[Congressional Bills 119th Congress]\n" +
      "[From the U.S. Government Publishing Office]\n" +
      "[H.R. 22 Engrossed in House (EH)]\n" +
      "<DOC>\n\n\n\n" +
      "119th CONGRESS\n  1st Session\n  H. R. 22";

    expect(stripGpoHeader(stamped)).toBe("119th CONGRESS\n  1st Session\n  H. R. 22");
  });

  test("leaves a bill that carries no stamp alone", () => {
    const plain = "SECTION 1. SHORT TITLE.\n\n    This Act may be cited as the ``SAVE Act''.";
    expect(stripGpoHeader(plain)).toBe(plain);
  });
});
