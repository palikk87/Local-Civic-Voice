/**
 * A LAW IS NOT WRITTEN OFF BECAUSE ONE MODEL CALL FAILED.
 *
 * WHAT WAS WRONG. `generateAndStoreBrief` recorded every kind of failure the
 * same way: `markSettled(id, "unavailable")`. But "unavailable" is read by
 * `briefState` as a fact about the law — "no official source has the text, so
 * there is nothing to write from" — and it is permanent. Abandoned "working"
 * rows are aged back to idle after five minutes; "unavailable" never is. So a
 * single unreachable model, a single empty completion, or a single fact-check
 * that did not run took the Citizen's Brief away from that law for good, and
 * the reader was shown "no brief possible" with no button to ask again.
 *
 * HOW BADLY. Measured against the live library on 2026-08-30, by reading the
 * public API: 60 records sampled, 57 of them reporting `briefState:
 * "unavailable"` while holding the full text of the law on the same row —
 * 4,320 characters on the shortest, 113,624 on the longest. Three had briefs.
 * The flagship feature was dark on 95% of the catalogue, and every one of those
 * 57 could have been written from text the platform already had.
 *
 * THE RULE THIS FIXES IN PLACE. Exactly one outcome is a verdict on the law:
 * there is no text to write from. Everything else is a verdict on one attempt,
 * and an attempt that failed leaves the record idle so the next reader — or the
 * background queue — can try again.
 *
 * These tests are deliberately about the STATE LEFT BEHIND rather than about
 * whether a brief was produced. The bug was never that a brief failed; briefs
 * fail, models are flaky, that is ordinary. The bug was that failing once was
 * recorded as impossible forever.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma, resetData, startServer, stopServer } from "./helpers/server";
import { ensureReferenceContent } from "../src/services/reference-content";
import { briefState, releaseRetryableUnavailable } from "../src/services/brief-state";

const OFFICIAL_TEXT = `
SECTION 1. SHORT TITLE.
This Act may be cited as the "Resilience Test Act of 2026".

SEC. 2. FINDINGS.
Congress finds that a summary of a law must be written from the law, that a
service which cannot reach its writer today may reach it tomorrow, and that a
record holding the text of a statute should never tell a reader that no text
exists.

SEC. 3. AUTHORIZATION.
There are authorized to be appropriated such sums as may be necessary to carry
out this Act for each of fiscal years 2026 through 2030.
`.trim();

/**
 * A brief in the shape the parser accepts.
 *
 * Kept identical in structure to brief.test.ts's fixture on purpose: a brief
 * that does not parse is stored as no brief at all, so an invented shape here
 * would make the "a later attempt succeeds" test fail for a reason that has
 * nothing to do with what it is testing. It did, the first time this ran.
 */
const BRIEF = {
  summary:
    "This law authorises spending through 2030 and says what it is for, in the words the " +
    "law itself uses.",
  argumentFor:
    "The text funds the work it describes and replaces an authority that would otherwise " +
    "lapse at the end of the fiscal year.",
  argumentAgainst:
    "The text commits money for five years without tying it to any measured result, and " +
    "does not say who decides where it goes.",
};

const realFetch = globalThis.fetch;

/**
 * Answer congress.gov normally and make the model fail.
 *
 * `kind` picks WHICH failure, because the whole point of the fix is that
 * different failures are not the same thing. "down" is the provider being
 * unreachable; "empty" is a 200 with nothing usable in it. Neither says
 * anything about whether the law has text.
 */
function stubNetwork(kind: "down" | "empty" | "works"): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (/api\.congress\.gov\/v3\/bill\/.*\/text/.test(url)) {
      return Response.json({
        textVersions: [
          { formats: [{ type: "Formatted Text", url: "https://www.congress.gov/test/BILLS.htm" }] },
        ],
      });
    }
    if (url.includes("congress.gov/test/BILLS.htm")) {
      return new Response(OFFICIAL_TEXT, { status: 200 });
    }

    if (url.includes("api.openai.com") || url.includes("generativelanguage.googleapis.com")) {
      if (kind === "down") return new Response("upstream is unavailable", { status: 503 });
      if (kind === "empty") return Response.json({ choices: [{ message: { content: "" } }] });
      const body = JSON.parse((init?.body as string) ?? "{}") as { messages?: { content?: string }[] };
      const prompt = body.messages?.map((m) => m.content ?? "").join("\n") ?? "";
      const content = /unsupported/i.test(prompt)
        ? JSON.stringify({ unsupported: [] })
        : JSON.stringify(BRIEF);
      return Response.json({ choices: [{ message: { content } }] });
    }

    return realFetch(input, init);
  }) as typeof fetch;
}

let counter = 0;
async function record(overrides: Record<string, unknown> = {}) {
  counter += 1;
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${8800 + counter}-119`,
      referenceType: "bill",
      title: `Resilience Test Act ${counter}`,
      status: "proposed",
      congress: 119,
      ...overrides,
    },
  });
  await prisma.referenceName.create({
    data: {
      name: row.masterReferenceId,
      referenceId: row.id,
      isCurrent: true,
      learnedFrom: "created",
    },
  });
  return row;
}

const reread = (id: string) =>
  prisma.governmentReference.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await startServer();
  process.env.OPENAI_API_KEY ??= "test-key-never-sent-anywhere";
  process.env.CONGRESS_API_KEY ??= "test-key-never-sent-anywhere";
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("a failed attempt leaves the law askable again", () => {
  test("an unreachable model does not mark the law unavailable", async () => {
    stubNetwork("down");
    const law = await record();

    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);

    const after = await reread(law.id);

    // The text arrived. Only the writing failed. Saying "there is nothing to
    // write from" would be false about a row that is holding the law.
    expect(after.fullText?.length ?? 0).toBeGreaterThan(200);
    expect(after.contentStatus).not.toBe("unavailable");
    expect(briefState(after)).not.toBe("unavailable");
  });

  test("a model that answers with nothing does not mark the law unavailable", async () => {
    stubNetwork("empty");
    const law = await record();

    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);

    const after = await reread(law.id);
    expect(after.fullText?.length ?? 0).toBeGreaterThan(200);
    expect(after.contentStatus).not.toBe("unavailable");
  });

  test("the reader is offered the button again rather than a dead end", async () => {
    stubNetwork("down");
    const law = await record();

    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);

    // "idle" is the state that renders the button. This is the assertion that
    // matters to a person: not that an internal column changed, but that the
    // screen offers them a way forward.
    const after = await reread(law.id);
    expect(briefState(after)).toBe("idle");
  });

  test("a later attempt succeeds where the first one failed", async () => {
    stubNetwork("down");
    const law = await record();
    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);
    expect(briefState(await reread(law.id))).toBe("idle");

    // The model comes back. Nothing else changes. This is the whole value of
    // the fix: under the old behaviour this record was finished for good.
    stubNetwork("works");
    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);

    const after = await reread(law.id);
    expect(after.citizenBriefJson).not.toBeNull();
    expect(briefState(after)).toBe("ready");
  });
});

describe("no text really is unavailable", () => {
  test("a law nobody publishes stays unavailable, and should", async () => {
    // No source answers, so there is genuinely nothing to write from. This is
    // the one case where the permanent verdict is the honest one, and the fix
    // must not have loosened it.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("congress.gov") || url.includes("federalregister.gov")) {
        return new Response("not found", { status: 404 });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const law = await record();
    await ensureReferenceContent(law.id, { generateBriefInline: true }).catch(() => undefined);

    const after = await reread(law.id);
    expect(after.fullText ?? "").toBe("");
    expect(briefState(after)).toBe("unavailable");
  });
});

describe("releasing the laws that were already written off", () => {
  test("a record holding its text is offered again", async () => {
    const law = await record({ fullText: OFFICIAL_TEXT, contentStatus: "unavailable" });
    expect(briefState(await reread(law.id))).toBe("unavailable");

    const released = await releaseRetryableUnavailable();

    expect(released).toBeGreaterThanOrEqual(1);
    expect(briefState(await reread(law.id))).toBe("idle");
  });

  test("a record with no text is left alone", async () => {
    const law = await record({ fullText: null, contentStatus: "unavailable" });

    await releaseRetryableUnavailable();

    // Still unavailable, because for this one it is true.
    expect(briefState(await reread(law.id))).toBe("unavailable");
  });

  test("an empty string is not text", async () => {
    const law = await record({ fullText: "", contentStatus: "unavailable" });

    await releaseRetryableUnavailable();

    expect(briefState(await reread(law.id))).toBe("unavailable");
  });

  test("running it twice changes nothing the second time", async () => {
    await record({ fullText: OFFICIAL_TEXT, contentStatus: "unavailable" });

    const first = await releaseRetryableUnavailable();
    const second = await releaseRetryableUnavailable();

    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });

  test("a record with a brief already is not disturbed", async () => {
    const law = await record({
      fullText: OFFICIAL_TEXT,
      contentStatus: "ready",
      citizenBriefJson: JSON.stringify({
        whatItDoes: "Something.",
        whoItAffects: "Someone.",
        whatChanges: "Something else.",
        arguments: { for: [], against: [] },
      }),
      citizenBriefVersion: 1,
    });

    await releaseRetryableUnavailable();

    const after = await reread(law.id);
    expect(after.contentStatus).toBe("ready");
    expect(after.citizenBriefJson).not.toBeNull();
  });
});
