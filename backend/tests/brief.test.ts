/**
 * The citizen brief pipeline, end to end, including the model call.
 *
 * "One brief per version of the law" is the promise, and until now the half
 * that actually writes the brief was covered by reading the code — the excuse
 * being that reaching it needs a real model call. That is not an excuse: the
 * provider is reached through `fetch`, so the call can be answered here with a
 * canned response and every line above it runs for real.
 *
 * What runs for real: the source chain that pulls official text, the hash that
 * decides whether the text changed, the model classifier, the chunker, the
 * prompt builders, the JSON parser, the fact-check pass, the storage write, and
 * the version pin. What is faked: two HTTP responses, at the boundary where
 * this code stops and somebody else's service begins.
 *
 * That is the part that was never tested and the part that can silently rot:
 * pin the brief to the wrong version and every reader regenerates it forever,
 * quietly, at cost, with nothing failing.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";
import {
  EXTRACTION_FIXED_AT,
  ensureReferenceContent,
  hashText,
  processReferenceBrief,
  repairStoredExtractions,
} from "../src/services/reference-content";
import { briefState, releaseAbandonedWork, WORK_TIMEOUT_MS } from "../src/services/brief-state";
import { parseBrief } from "../src/services/citizen-brief";
import { mergeReferences } from "../src/services/deduplication-service";
import { safeInputChars } from "../src/services/ai-generate";

/**
 * A short bill, long enough to clear the 200-character floor the source chain
 * uses to tell real text from an error page.
 */
const OFFICIAL_TEXT = `
SECTION 1. SHORT TITLE.
This Act may be cited as the "Test Measure Act of 2025".

SEC. 2. FINDINGS.
Congress finds that the rail network requires modernization, that grade
crossings account for a substantial share of preventable fatalities, and that
existing authorities expire at the end of the fiscal year.

SEC. 3. AUTHORIZATION OF APPROPRIATIONS.
There are authorized to be appropriated $250,000,000 for each of fiscal years
2026 through 2030 to carry out this Act.
`.trim();

const AMENDED_TEXT = `${OFFICIAL_TEXT}

SEC. 4. SUNSET.
The authority under section 3 expires on September 30, 2030.`;

const BRIEF = {
  summary:
    "This law puts money into upgrading the rail network and making level crossings safer, " +
    "and sets out how much is available each year through 2030.",
  argumentFor:
    "The text funds safety work at crossings, which is where the law itself says preventable " +
    "deaths happen. It also replaces an authority that expires at the end of the fiscal year, " +
    "so without it the existing work stops.",
  argumentAgainst:
    "The text commits $250 million a year for five years without tying the money to any " +
    "measured result. It also leaves the choice of which crossings get work unspecified.",
};

/** Every model call this pipeline makes, in the order it makes them. */
let modelCalls: Array<{ model: string; kind: "write" | "factcheck" }> = [];

const realFetch = globalThis.fetch;

/**
 * Answer congress.gov and the model provider from memory.
 *
 * A stub at the network boundary rather than an injected client, deliberately:
 * everything above it is the real code path, including the parts most likely to
 * be wrong.
 */
function stubNetwork(options: { text: string }): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // The list of text versions congress.gov publishes for a bill.
    if (/api\.congress\.gov\/v3\/bill\/.*\/text/.test(url)) {
      return Response.json({
        textVersions: [
          { formats: [{ type: "Formatted Text", url: "https://www.congress.gov/test/BILLS.htm" }] },
        ],
      });
    }

    // The document itself.
    if (url.includes("congress.gov/test/BILLS.htm")) {
      return new Response(options.text, { status: 200 });
    }

    // The model. Which prompt it is answering is visible in the body: the
    // fact-check pass asks for `unsupported`, everything else asks for a brief.
    if (url.includes("api.openai.com") || url.includes("generativelanguage.googleapis.com")) {
      const body = JSON.parse((init?.body as string) ?? "{}") as {
        model?: string;
        messages?: Array<{ content?: string }>;
      };
      const prompt = body.messages?.map((m) => m.content ?? "").join("\n") ?? "";
      const isFactCheck = /unsupported/i.test(prompt);
      modelCalls.push({
        model: body.model ?? "unknown",
        kind: isFactCheck ? "factcheck" : "write",
      });

      const content = isFactCheck ? JSON.stringify({ unsupported: [] }) : JSON.stringify(BRIEF);
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
      masterReferenceId: `hr-${7700 + counter}-119`,
      referenceType: "bill",
      title: `Test Measure Act ${counter}`,
      status: "proposed",
      congress: 119,
      ...overrides,
    },
  });
  await prisma.referenceName.create({
    data: { name: row.masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
  });
  return row;
}

beforeAll(async () => {
  await startServer();
  // A key has to be present for the provider to be considered available. Its
  // value is never used — the request it would authenticate is answered here.
  process.env.OPENAI_API_KEY ??= "test-key-never-sent-anywhere";
  process.env.CONGRESS_API_KEY ??= "test-key-never-sent-anywhere";
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  modelCalls = [];
  stubNetwork({ text: OFFICIAL_TEXT });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("writing a brief", () => {
  test("a brief is generated, stored, and pinned to the version it describes", async () => {
    // The pin is the whole mechanism. Written wrong, the brief looks
    // permanently stale and every single reader pays to regenerate it — with
    // nothing failing and nothing in the logs to say so.
    const law = await record();

    await processReferenceBrief(law.id, false);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.citizenBriefJson).not.toBeNull();
    // Stored with the format stamp, so a brief written to an earlier definition
    // of what a Citizen's Brief IS is recognisable and simply rewritten.
    expect(JSON.parse(row.citizenBriefJson!)).toEqual({ format: 2, ...BRIEF });
    expect(row.contentStatus).toBe("ready");
    // Which model wrote it is recorded, and it is the one that was actually
    // called. The light lane asks for Gemini first; no Gemini key is set here,
    // so the provider chain falls through to OpenAI's default — real fallback
    // behaviour, not a special case for tests.
    expect(row.citizenBriefModel).toBe("gpt-5.4-mini");
    expect(modelCalls.map((c) => c.model)).toContain(row.citizenBriefModel!);
    expect(row.fullText).toContain("Test Measure Act of 2025");

    // Pinned to the version the record is on, so the next reader reuses it.
    expect(row.citizenBriefVersion).toBe(row.lawVersion);
    expect(row.citizenBriefVersion).toBe(1);

    // The model was actually called — a write pass and a fact-check pass.
    expect(modelCalls.filter((c) => c.kind === "write").length).toBeGreaterThan(0);
    expect(modelCalls.filter((c) => c.kind === "factcheck").length).toBeGreaterThan(0);
  });

  test("the second reader costs nothing", async () => {
    // "Loads instantly, no AI, no cost" — checked by counting the calls the
    // second read makes, which is the only way to see it from outside.
    const law = await record();
    await processReferenceBrief(law.id, false);

    const before = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    modelCalls = [];

    await ensureReferenceContent(law.id, { generateBriefInline: true });

    expect(modelCalls).toEqual([]);
    const after = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(after.citizenBriefAt?.toISOString()).toBe(before.citizenBriefAt?.toISOString());
    expect(after.citizenBriefVersion).toBe(1);
  });

  test("a first text pull is not a change, so nobody is told the law moved", async () => {
    // The record did not have the text before; that is not the law moving.
    // Badging every post on a record whose text was just fetched for the first
    // time would be a lie told at scale.
    const law = await record();
    await processReferenceBrief(law.id, false);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.lawChangedAt).toBeNull();
    expect(row.lawVersion).toBe(1);
  });

  test("amended text moves the law forward and buys exactly one new brief", async () => {
    // The promise, in the case that costs money: one regeneration per version,
    // not per reader.
    const law = await record();
    await processReferenceBrief(law.id, false);

    const first = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(first.lawVersion).toBe(1);

    // Congress amends it. Force a re-check, since the source is not due yet.
    stubNetwork({ text: AMENDED_TEXT });
    modelCalls = [];
    await processReferenceBrief(law.id, true);

    const second = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(second.fullText).toContain("SEC. 4. SUNSET.");
    expect(second.lawVersion).toBe(2);
    expect(second.lawChangedAt).not.toBeNull();
    // Rewritten, and pinned to the new version.
    expect(second.citizenBriefVersion).toBe(2);
    expect(modelCalls.filter((c) => c.kind === "write").length).toBeGreaterThan(0);

    // Everybody after that reads the stored copy.
    modelCalls = [];
    await ensureReferenceContent(law.id, { generateBriefInline: true });
    expect(modelCalls).toEqual([]);
  });

  test("everyone who shared the law is told when it is amended", async () => {
    // The other half of a law moving: their post is untouched, and they are
    // told. This is the path that fires from the text pull rather than from the
    // daily metadata sync.
    const law = await record();
    await processReferenceBrief(law.id, false);

    const { userId } = await (
      await import("./helpers/server")
    ).signUp({
      email: `brief-poster-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Brief Poster",
    });
    await prisma.post.create({
      data: {
        content: "my position on this bill",
        authorId: userId,
        governmentReferenceId: law.id,
      },
    });

    stubNetwork({ text: AMENDED_TEXT });
    await processReferenceBrief(law.id, true);

    const told = await prisma.notification.findMany({
      where: { userId, type: "law_updated" },
    });
    expect(told.length).toBe(1);
    expect(told[0]!.body).toContain("Your post is unchanged");
  });

  test("no official text means no brief, rather than a summary of the metadata", async () => {
    // Article III Section 3: every data point traces back to an official
    // source. A brief written from a title and a status is a confident-sounding
    // account of a law nobody read.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("congress.gov") || url.includes("govinfo") || url.includes("federalregister")) {
        return new Response("Not found", { status: 404 });
      }
      if (url.includes("api.openai.com")) {
        modelCalls.push({ model: "unexpected", kind: "write" });
        return Response.json({ choices: [{ message: { content: JSON.stringify(BRIEF) } }] });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const law = await record({ sourceUrl: null });
    await processReferenceBrief(law.id, false);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.citizenBriefJson).toBeNull();
    expect(row.contentStatus).toBe("unavailable");
    // And not a single model call was spent on it.
    expect(modelCalls).toEqual([]);
  });
});

/**
 * The load loop.
 *
 * A reader opened a law and watched a spinner that never stopped, and reloading
 * did not help. The cause was a status column that could enter a working state
 * and had no way to leave one: the job behind it died with the process running
 * it — a restart, a deploy, a crash — and nothing was left to write an outcome.
 * The row went on saying "being written", so the client went on polling.
 *
 * These pin the two halves of the fix. Work in flight now records when it
 * started, so it can be aged out; and nothing starts work except a person
 * asking for it.
 */
describe("a brief request always ends somewhere", () => {
  test("work abandoned mid-flight is offered back as a button, not a spinner", async () => {
    const law = await record();

    // Exactly the state a killed process leaves behind: claiming to be busy,
    // with nothing running.
    await prisma.governmentReference.update({
      where: { id: law.id },
      data: {
        contentStatus: "brief_pending",
        contentStartedAt: new Date(Date.now() - WORK_TIMEOUT_MS - 1000),
      },
    });

    const response = await fetch(`${BASE_URL}/api/government-references/${law.id}`);
    const body = (await response.json()) as { reference: { briefState: string } };

    // Not "working". That is the whole bug: the old code had no way to say
    // anything else once the row said it was busy.
    expect(body.reference.briefState).toBe("idle");
  });

  test("a row that predates the start-time column is treated as abandoned, not busy", async () => {
    // Rows already stuck in production have no start time at all, so there is
    // no evidence any work is happening. Trusting them would keep exactly the
    // readers this fixes stuck.
    const law = await record({ contentStatus: "fetching" });
    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });

    expect(row.contentStartedAt).toBeNull();
    expect(briefState(row)).toBe("idle");
  });

  test("work that genuinely just started still reads as working", async () => {
    // The timeout must not be so eager that two readers start the same brief.
    const law = await record({
      contentStatus: "brief_pending",
      contentStartedAt: new Date(),
    });
    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });

    expect(briefState(row)).toBe("working");
  });

  test("a restart releases every brief its predecessor was mid-way through", async () => {
    const stranded = await record({
      contentStatus: "brief_pending",
      contentStartedAt: new Date(Date.now() - WORK_TIMEOUT_MS - 1000),
    });
    const legacy = await record({ contentStatus: "fetching" });
    const running = await record({ contentStatus: "fetching", contentStartedAt: new Date() });

    const released = await releaseAbandonedWork();
    expect(released).toBe(2);

    for (const id of [stranded.id, legacy.id]) {
      const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id } });
      expect(row.contentStatus).toBeNull();
      expect(row.contentStartedAt).toBeNull();
    }

    // And work that is actually happening is left alone.
    const untouched = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: running.id },
    });
    expect(untouched.contentStatus).toBe("fetching");
  });
});

describe("the Get Citizen Brief button", () => {
  // The server runs in its own process, so the network stub in this file does
  // not reach it. Anything here that goes over HTTP is therefore written to
  // need no outbound call — which is also the honest test of "reuse", since a
  // request that reused nothing would have to reach a provider and fail.

  test("nothing is written until somebody asks", async () => {
    const law = await record();

    // Reading the law does not write a brief, and does not put the row into a
    // state the client would poll. Opening a law used to do both.
    const read = await fetch(`${BASE_URL}/api/government-references/${law.id}`);
    const body = (await read.json()) as { reference: { briefState: string } };

    expect(body.reference.briefState).toBe("idle");
    expect(modelCalls).toEqual([]);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.contentStatus).toBeNull();
    expect(row.citizenBriefJson).toBeNull();
  });

  test("resolving a document identifies it and starts nothing", async () => {
    // Resolve used to mark the row as working and kick off a brief, so merely
    // opening a search result began paying a model and armed the poll that
    // could never end.
    const law = await record();

    const response = await fetch(`${BASE_URL}/api/government-references/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branch: "legislative",
        title: law.title,
        masterReferenceId: law.masterReferenceId,
        congress: 119,
        billType: "hr",
        billNumber: law.masterReferenceId.split("-")[1],
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reference: { id: string; briefState: string; contentStatus: string | null };
    };
    expect(body.reference.briefState).toBe("idle");
    expect(body.reference.contentStatus).toBeNull();

    const row = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: body.reference.id },
    });
    expect(row.contentStatus).toBeNull();
    expect(row.citizenBriefJson).toBeNull();
  });

  test("a brief that already exists comes straight back, and is not rewritten", async () => {
    const law = await record();
    // Write it once, for real, through the whole pipeline.
    await processReferenceBrief(law.id, false);

    const stored = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(stored.citizenBriefJson).not.toBeNull();

    const response = await fetch(`${BASE_URL}/api/government-references/${law.id}/brief`, {
      method: "POST",
    });
    const body = (await response.json()) as {
      state: string;
      brief: { summary: string };
      lawVersion: number;
      briefVersion: number;
    };

    expect(response.status).toBe(200);
    expect(body.state).toBe("ready");
    expect(body.brief.summary).toBe(BRIEF.summary);
    expect(body.briefVersion).toBe(body.lawVersion);

    // Not rewritten: same brief, same timestamp. Once per version of the law,
    // however many people press the button. (The server process has no stubbed
    // provider, so a rewrite here could not have succeeded at all — which is
    // the point: it never tried.)
    const after = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(after.citizenBriefAt?.getTime()).toBe(stored.citizenBriefAt?.getTime());
    expect(after.citizenBriefJson).toBe(stored.citizenBriefJson);
    expect(after.contentStatus).toBe("ready");
    expect(after.contentStartedAt).toBeNull();
  });

  test("no official text answers unavailable, and leaves nothing claiming to be busy", async () => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("congress.gov") || url.includes("govinfo") || url.includes("federalregister")) {
        return new Response("Not found", { status: 404 });
      }
      if (url.includes("api.openai.com")) {
        modelCalls.push({ model: "unexpected", kind: "write" });
        return Response.json({ choices: [{ message: { content: JSON.stringify(BRIEF) } }] });
      }
      return realFetch(input, init);
    }) as typeof fetch;

    const law = await record({ sourceUrl: null });
    await processReferenceBrief(law.id, false);

    expect(modelCalls).toEqual([]);

    // Settled, not busy. A row left claiming to be busy here is the load loop.
    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.contentStatus).toBe("unavailable");
    expect(row.contentStartedAt).toBeNull();
    expect(briefState(row)).toBe("unavailable");
  });

  test("an old id for a merged law gets the survivor's brief, not a second one", async () => {
    // ONE LAW, ONE BRIEF is the reason two filings get merged at all. Anything
    // still holding the loser's id — a shared link, a post attached before the
    // merge, a cached query — has to land on the survivor. Refusing it would
    // send the reader off to write a second brief for a law that already has
    // one, which is exactly the duplication the merge removed.
    const survivor = await record();
    const absorbed = await record();

    // The survivor is the one that has been read and summarized.
    await processReferenceBrief(survivor.id, false);
    const callsAfterWriting = modelCalls.length;
    expect(callsAfterWriting).toBeGreaterThan(0);

    await mergeReferences(absorbed.id, survivor.id);

    // Ask using the id that no longer owns anything.
    const response = await fetch(`${BASE_URL}/api/government-references/${absorbed.id}/brief`, {
      method: "POST",
    });
    const body = (await response.json()) as {
      state: string;
      brief: { summary: string };
      referenceId: string;
      masterReferenceId: string;
    };

    expect(response.status).toBe(200);
    expect(body.state).toBe("ready");
    expect(body.brief.summary).toBe(BRIEF.summary);

    // It says which record answered, so a client holding the old link can
    // follow along instead of guessing.
    expect(body.referenceId).toBe(survivor.id);
    expect(body.masterReferenceId).toBe(survivor.masterReferenceId);

    // And nothing was written a second time.
    expect(modelCalls.length).toBe(callsAfterWriting);
    const stale = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: absorbed.id },
    });
    expect(stale.citizenBriefJson).toBeNull();
  });

  test("force rewrites a brief that is already current", async () => {
    const law = await record();
    await processReferenceBrief(law.id, false);
    const afterFirst = modelCalls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await ensureReferenceContent(law.id, { force: true, generateBriefInline: true });

    // The reuse rule has one deliberate exception, and this is it.
    expect(modelCalls.length).toBeGreaterThan(afterFirst);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.contentStatus).toBe("ready");
    expect(row.contentStartedAt).toBeNull();
    expect(briefState(row)).toBe("ready");
  });
});

/**
 * A law too long to read in one go.
 *
 * The rule: read EVERY section first, then write once from all of it. A brief
 * written from the first section that fit is a confident account of a document
 * nobody finished, and a reader has no way to tell — so if any section cannot
 * be read, there is no brief at all.
 */
describe("a law too long for one pass", () => {
  /**
   * Long enough to force sectioning, sized from the real budget rather than a
   * magic number — so this keeps testing the multi-section path if the model or
   * its context window changes.
   */
  const BUDGET = safeInputChars("gpt-5.4-mini");
  const PARAGRAPH =
    "The Secretary shall carry out the activity described in this section using amounts made " +
    "available under section 3, subject to the limitations in this Act, and shall report " +
    "annually on the results of that activity to the appropriate committees of Congress.\n\n";
  const LONG_TEXT = PARAGRAPH.repeat(Math.ceil((BUDGET * 2.2) / PARAGRAPH.length));

  /** Every prompt the model was sent, so the ORDER of the passes is checkable. */
  let prompts: string[] = [];

  const isRead = (prompt: string) => /section \d+ of \d+ of one law/i.test(prompt);
  const isWrite = (prompt: string) => /Return exactly this JSON/i.test(prompt) && !isRead(prompt);

  /**
   * `failSection` fails EVERY attempt at that section, including the retry on
   * the other provider. Failing one call only proves the fallback works, which
   * is a different test.
   */
  function stubLongLaw(options: { failSection?: number } = {}): void {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

      if (url.includes("api.congress.gov") && url.includes("/text")) {
        return Response.json({
          textVersions: [{ formats: [{ type: "Formatted Text", url: "https://congress.gov/full" }] }],
        });
      }
      if (url.includes("congress.gov/full")) {
        return new Response(LONG_TEXT, { headers: { "content-type": "text/plain" } });
      }

      if (url.includes("api.openai.com") || url.includes("generativelanguage.googleapis.com")) {
        const body = JSON.parse((init?.body as string) ?? "{}") as {
          messages?: Array<{ content?: string }>;
        };
        const prompt = body.messages?.map((m) => m.content ?? "").join("\n") ?? "";
        prompts.push(prompt);

        const reading = /section (\d+) of \d+ of one law/i.exec(prompt);
        if (reading) {
          const section = Number(reading[1]);
          if (options.failSection === section) {
            return new Response("upstream unavailable", { status: 503 });
          }
          return Response.json({
            choices: [
              { message: { content: JSON.stringify({ notes: `notes for section ${section}` }) } },
            ],
          });
        }

        if (/unsupported/i.test(prompt)) {
          return Response.json({
            choices: [{ message: { content: JSON.stringify({ unsupported: [] }) } }],
          });
        }

        return Response.json({ choices: [{ message: { content: JSON.stringify(BRIEF) } }] });
      }

      return realFetch(input, init);
    }) as typeof fetch;
  }

  beforeEach(() => {
    prompts = [];
  });

  test("every section is read before a single word is written", async () => {
    stubLongLaw();
    const law = await record();
    await processReferenceBrief(law.id, false);

    const reads = prompts.filter(isRead);
    const sectionsRead = new Set(
      reads.map((p) => /section (\d+) of (\d+) of one law/i.exec(p)![1])
    );

    // It genuinely had to be split.
    expect(sectionsRead.size).toBeGreaterThan(1);

    // THE RULE: the first write comes after the last read. Not interleaved, not
    // a draft revised as it goes — read it all, then write.
    const lastRead = prompts.findLastIndex(isRead);
    const firstWrite = prompts.findIndex(isWrite);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(lastRead);

    // And the write saw every section's notes, not just the last one.
    const writePrompt = prompts[firstWrite]!;
    for (const section of sectionsRead) {
      expect(writePrompt).toContain(`notes for section ${section}`);
    }

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(JSON.parse(row.citizenBriefJson!)).toEqual({ format: 2, ...BRIEF });
  });

  test("a section that cannot be read means no brief at all", async () => {
    // Not a brief about the parts that happened to load. The whole point of
    // reading first is that a partial read is not a smaller brief, it is a
    // wrong one — and the reader cannot tell.
    stubLongLaw({ failSection: 2 });
    const law = await record();
    await processReferenceBrief(law.id, false);

    expect(prompts.filter(isWrite).length).toBe(0);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.citizenBriefJson).toBeNull();
    expect(row.contentStatus).toBe("unavailable");
    expect(row.contentStartedAt).toBeNull();
  });
});

/**
 * The button has to work on a record that was briefed before.
 *
 * THE DEFECT. Two places asked "does this record already have a usable brief",
 * and they answered differently. `briefState()` — what the client is told —
 * PARSED the stored JSON, so a brief written to an earlier definition read as
 * no brief. The content pipeline only checked the column was non-null, so the
 * same record read as already current: it settled the row as ready and returned
 * without fetching text or writing anything.
 *
 * The reader pressed Get Citizen Brief and nothing happened. Pressed it again,
 * nothing happened. For every record that had ever been briefed — which, after
 * the brief was redefined, was all of them.
 */
describe("a record briefed under the old definition", () => {
  /** The shape briefs used to be stored in: three panels, no format stamp. */
  const OLD_SHAPE = JSON.stringify({
    theGoal: "What it does.",
    theWallet: "What it costs.",
    theDebate: "Both sides.",
  });

  test("is rewritten rather than reported as already current", async () => {
    // The production shape of this record: text already stored, checked
    // recently, and a brief from before the definition changed. No re-fetch is
    // due, so nothing else can mask the decision — which is exactly why the
    // bug was invisible on a fresh record and total on a real one.
    const law = await record({
      citizenBrief: "Goal / Wallet / Debate, from the old shape.",
      citizenBriefJson: OLD_SHAPE,
      // Matching versions are what made the old check say "nothing to do".
      citizenBriefVersion: 1,
      lawVersion: 1,
      fullText: OFFICIAL_TEXT,
      fullTextHash: hashText(OFFICIAL_TEXT),
      sourceCheckedAt: new Date(),
    });

    // Exactly what pressing the button does.
    await processReferenceBrief(law.id, false);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });

    // A brief the card can actually render, in the current shape.
    const rewritten = parseBrief(row.citizenBriefJson);
    expect(rewritten).not.toBeNull();
    expect(rewritten!.summary).toBe(BRIEF.summary);
    expect(rewritten!.argumentFor).toBe(BRIEF.argumentFor);
    expect(rewritten!.argumentAgainst).toBe(BRIEF.argumentAgainst);

    // And the record is settled, so the reader is not left pressing a button
    // that quietly does nothing.
    expect(briefState(row)).toBe("ready");
    expect(row.contentStartedAt).toBeNull();
  });

  test("the pipeline and the client agree about what counts as a brief", async () => {
    // The two answers disagreeing IS the bug. Neither may be able to see a
    // brief the other cannot.
    const law = await record({
      citizenBriefJson: OLD_SHAPE,
      citizenBriefVersion: 1,
      lawVersion: 1,
      fullText: OFFICIAL_TEXT,
      fullTextHash: hashText(OFFICIAL_TEXT),
      sourceCheckedAt: new Date(),
    });
    const before = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });

    expect(parseBrief(before.citizenBriefJson)).toBeNull();
    expect(briefState(before)).not.toBe("ready");
  });
});

/**
 * Fixing our own retrieval is not the government amending anything.
 *
 * THE HAZARD THIS CLOSES. When a retrieval bug is repaired, every affected
 * record pulls text that differs from what is stored — and by every ordinary
 * measure that reads as the law changing. It is not. The Federal Register did
 * not reissue an order because we stopped storing the page header above it, and
 * Congress did not re-pass a bill because we stopped serving the introduced
 * draft of it.
 *
 * Left alone, shipping the fix would increment lawVersion on every record,
 * badge every post that shared one as "updated since this was posted", and
 * notify everyone who shared it: a false statement about the government,
 * delivered to every user at once, caused by us fixing our own defect.
 */
describe("re-extracting text after a retrieval fix", () => {
  /**
   * A record already holding text and a brief written for it.
   *
   * `fullTextAt` is after EXTRACTION_FIXED_AT, so this text was produced by the
   * current extractors. That matters: text stored BEFORE the fix is protected
   * from being reported as a change of law, and a fixture without a date would
   * quietly land in that protected set and stop testing anything.
   */
  async function settled(fullTextAt = new Date(EXTRACTION_FIXED_AT.getTime() + 86_400_000)) {
    const row = await record({
      fullText: OFFICIAL_TEXT,
      fullTextHash: hashText(OFFICIAL_TEXT),
      fullTextSource: "congress.gov/text",
      sourceCheckedAt: new Date(),
      fullTextAt,
      citizenBriefJson: JSON.stringify({ format: 2, ...BRIEF }),
      citizenBriefVersion: 1,
      lawVersion: 1,
      contentStatus: "ready",
    });
    return row;
  }

  test("replaces the text without saying the law moved", async () => {
    const row = await settled();
    // The better extraction returns different bytes for the same law.
    stubNetwork({ text: AMENDED_TEXT });

    await ensureReferenceContent(row.id, { reextract: true, generateBriefInline: true });

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: {
        fullText: true,
        lawVersion: true,
        lawChangedAt: true,
        citizenBriefJson: true,
        citizenBriefVersion: true,
      },
    });

    // The text is the new one.
    expect(after.fullText).toBe(AMENDED_TEXT);

    // And nothing anywhere says the law changed.
    expect(after.lawVersion).toBe(1);
    expect(after.lawChangedAt).toBeNull();
    expect(await prisma.notification.count({ where: { type: "law_update" } })).toBe(0);

    // The brief was rewritten, because the one on the record described the old
    // extraction — and it is pinned to the version the law is still on.
    expect(parseBrief(after.citizenBriefJson)).not.toBeNull();
    expect(after.citizenBriefVersion).toBe(1);
  });

  test("an ordinary re-pull of the same change DOES say the law moved", async () => {
    // The negative control, in the suite rather than in my shell: without the
    // flag this is a version bump. That difference is the whole feature.
    const row = await settled();
    stubNetwork({ text: AMENDED_TEXT });

    await ensureReferenceContent(row.id, { force: true, generateBriefInline: true });

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: { lawVersion: true, lawChangedAt: true, citizenBriefVersion: true },
    });

    expect(after.lawVersion).toBe(2);
    expect(after.lawChangedAt).not.toBeNull();
    expect(after.citizenBriefVersion).toBe(2);
  });

  test("a record whose text was already right is left completely alone", async () => {
    const row = await settled();
    // Same text back: nothing about this record was broken.
    stubNetwork({ text: OFFICIAL_TEXT });

    await ensureReferenceContent(row.id, { reextract: true, generateBriefInline: true });

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: { lawVersion: true, citizenBriefVersion: true, citizenBriefJson: true },
    });

    expect(after.lawVersion).toBe(1);
    expect(after.citizenBriefVersion).toBe(1);
    // Not rewritten, so not paid for again.
    expect(modelCalls).toHaveLength(0);
  });
});

/**
 * The repair runs itself, once, on the deploy that carries the fix.
 *
 * A fix that only lands if somebody remembers to press a button afterwards is a
 * fix that sits unapplied — the same failure mode as a finished change sitting
 * on a branch nothing deploys.
 */
describe("repairing records stored by the old extractor", () => {
  const BEFORE = new Date(EXTRACTION_FIXED_AT.getTime() - 86_400_000);
  const AFTER = new Date(EXTRACTION_FIXED_AT.getTime() + 86_400_000);

  async function stored(fullTextAt: Date | null) {
    return record({
      fullText: OFFICIAL_TEXT,
      fullTextHash: hashText(OFFICIAL_TEXT),
      fullTextSource: "congress.gov/text",
      sourceCheckedAt: new Date(),
      citizenBriefJson: JSON.stringify({ format: 2, ...BRIEF }),
      citizenBriefVersion: 1,
      lawVersion: 1,
      contentStatus: "ready",
      fullTextAt,
    });
  }

  test("queues only the records whose text predates the fix", async () => {
    const old1 = await stored(BEFORE);
    const never = await stored(null);
    await stored(AFTER);

    const queued = await repairStoredExtractions();
    expect(queued).toBe(2);

    // Named rather than counted, so a coincidence cannot pass this.
    const eligible = await prisma.governmentReference.findMany({
      where: { OR: [{ fullTextAt: null }, { fullTextAt: { lt: EXTRACTION_FIXED_AT } }] },
      select: { id: true },
    });
    expect(eligible.map((r) => r.id).sort()).toEqual([old1.id, never.id].sort());
  });

  test("a repaired record is not queued again on the next boot", async () => {
    // Even when the text comes back identical — nothing was wrong with this
    // one, but it HAS now been confirmed against the current extractor, and
    // without recording that it would be re-pulled on every single restart.
    const row = await stored(BEFORE);
    stubNetwork({ text: OFFICIAL_TEXT });

    await ensureReferenceContent(row.id, { reextract: true, generateBriefInline: true });

    expect(await repairStoredExtractions()).toBe(0);
    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: { fullTextAt: true },
    });
    expect(after.fullTextAt!.getTime()).toBeGreaterThan(EXTRACTION_FIXED_AT.getTime());
  });

  test("a reader who arrives mid-repair cannot trigger a false law-change", async () => {
    // THE DOOR THE REPAIR PASS DOES NOT COVER. Between the deploy and the
    // repair reaching this record, opening it runs an ordinary recheck: pulls
    // the corrected text, sees it differs, and — without this — tells everyone
    // who shared it that the law changed.
    const row = await stored(BEFORE);
    stubNetwork({ text: AMENDED_TEXT });

    await ensureReferenceContent(row.id, { force: true, generateBriefInline: true });

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: { fullText: true, lawVersion: true, lawChangedAt: true },
    });

    expect(after.fullText).toBe(AMENDED_TEXT);
    expect(after.lawVersion).toBe(1);
    expect(after.lawChangedAt).toBeNull();
    expect(await prisma.notification.count({ where: { type: "law_update" } })).toBe(0);
  });

  test("and a record already on the current extractor still reports real changes", async () => {
    // The protection is scoped to text the old extractor produced. It is not a
    // permanent amnesty on saying the law moved — which would be a far worse
    // bug than the one it prevents.
    const row = await stored(AFTER);
    stubNetwork({ text: AMENDED_TEXT });

    await ensureReferenceContent(row.id, { force: true, generateBriefInline: true });

    const after = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: row.id },
      select: { lawVersion: true, lawChangedAt: true },
    });
    expect(after.lawVersion).toBe(2);
    expect(after.lawChangedAt).not.toBeNull();
  });
});
