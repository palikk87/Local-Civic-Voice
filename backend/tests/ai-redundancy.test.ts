/**
 * ONE MODEL GOING DEAD MUST NOT TAKE THE CITIZEN'S BRIEF OFF THE AIR.
 *
 * WHY THIS EXISTS, in the owner's words after the third outage: "whatever is
 * happening keeps happening again and makes it fail. there needs to be
 * redundancies in place", and "when the initial method fails its reported to
 * the admin and falls back on the redundancy til I've had time to address the
 * initial failure."
 *
 * WHAT KEPT HAPPENING. There was exactly one model per provider. Providers
 * retire model names, move them behind a tier, or rename them — and when that
 * happened, every brief on the platform failed at once. The screen said "try
 * again shortly", which was advice that could never come true, and the only
 * record was a log line on a host nobody reads.
 *
 * The four things that have to hold:
 *
 *   1. A model the provider will not serve is skipped, and the NEXT one answers.
 *   2. It is struck off, so the next reader does not pay for the same discovery.
 *   3. A rate limit is NOT a strike-off — a busy minute must not make the
 *      platform permanently dumber.
 *   4. Falling back is REPORTED. A safety net nobody is told about is how this
 *      hid for three rounds.
 */

/**
 * Set before src/env.ts is imported: it validates at import time, and this file
 * calls the generator directly rather than booting a server. Throwaway values;
 * the only network in this test is the fake provider below.
 */
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-value-not-used-anywhere-else";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

// IMPORTED LAZILY, NOT AT THE TOP. src/env.ts validates the moment it is
// imported, and a static import is hoisted ABOVE the assignments just made —
// so every one of these would throw before the values above were set.
type AiModule = typeof import("../src/services/ai-generate");
type IncidentModule = typeof import("../src/services/service-incidents");

const ai = (): Promise<AiModule> => import("../src/services/ai-generate");
const incidents = (): Promise<IncidentModule> => import("../src/services/service-incidents");
const db = async () => (await import("../src/prisma")).prisma;

const INCIDENT_AI_MODEL = "ai_model_unusable";

/** Every call the fake provider saw, so "which model was tried" is measurable. */
let calls: string[] = [];

const realFetch = globalThis.fetch;

/**
 * A provider that refuses some models and serves others.
 *
 * Deliberately answering at the HTTP layer rather than stubbing the module:
 * the thing under test is how this code reads a provider's REAL refusal, and a
 * stub that returns a tidy object would prove only that the stub is tidy.
 */
function fakeProvider(rules: Record<string, { status: number; body: string }>) {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}"));
    // Gemini carries the model in the path; OpenAI in the body.
    const model = body.model ?? url.match(/models\/([^:]+):/)?.[1] ?? "unknown";
    calls.push(model);

    const rule = rules[model];
    if (rule) {
      return new Response(rule.body, { status: rule.status });
    }
    // Anything not named is a model that works.
    const answer = url.includes("googleapis")
      ? { candidates: [{ content: { parts: [{ text: "IT WORKED" }] } }] }
      : { choices: [{ message: { content: "IT WORKED" } }] };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
}

beforeEach(async () => {
  calls = [];
  (await ai()).forgetStruckOffModels();
  await (await db()).serviceIncident.deleteMany().catch(() => undefined);
  process.env.GEMINI_API_KEY = "a-throwaway-value-for-this-test";
  delete process.env.OPENAI_API_KEY;
});

afterAll(async () => {
  // STOP LEAKING INTO OTHER FILES. struckOff and outOfCredit live for the life
  // of the process on purpose — a model the provider refuses should not be
  // re-tried by the next reader. In a test run that same process runs every
  // other suite afterwards, so a strike-off recorded here silently changed the
  // provider chain for judicial-search and made three of its tests fail in the
  // full run while passing on their own. State that outlives a test is state
  // that fails somebody else's.
  (await ai()).forgetStruckOffModels();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
  await (await db()).serviceIncident.deleteMany().catch(() => undefined);
});

async function generate() {
  const { generateAI } = await ai();
  return generateAI({ prompt: "say something", maxCompletionTokens: 32 });
}

const listIncidents = async () => (await incidents()).listIncidents();
const reportIncident: IncidentModule["reportIncident"] = async (report) =>
  (await incidents()).reportIncident(report);
const modelAvailability = async () => (await ai()).modelAvailability();

describe("a dead model does not take the platform down", () => {
  test("the next model in the chain answers instead", async () => {
    // Exactly the failure that happened three times: the provider no longer
    // serves that name.
    fakeProvider({
      "gemini-3.6-flash": {
        status: 404,
        body: JSON.stringify({ error: { message: "models/gemini-3.6-flash is not found" } }),
      },
    });

    const result = await generate();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toBe("IT WORKED");
      // NOT the primary. Something further down the chain carried it.
      expect(result.model).not.toBe("gemini-3.6-flash");
    }
    expect(calls[0]).toBe("gemini-3.6-flash");
    expect(calls.length).toBeGreaterThan(1);
  });

  test("and the dead one is struck off, so the next reader does not pay for it", async () => {
    fakeProvider({
      "gemini-3.6-flash": { status: 404, body: JSON.stringify({ error: { message: "not found" } }) },
    });

    await generate();
    const firstRun = [...calls];
    calls = [];
    await generate();

    expect(firstRun).toContain("gemini-3.6-flash");
    // Second time round it is not tried at all.
    expect(calls).not.toContain("gemini-3.6-flash");

    const struck = (await modelAvailability()).find((m) => m.model === "gemini-3.6-flash");
    expect(struck?.struckOff).toBe(true);
  });

  test("a rate limit is NOT a strike-off", async () => {
    // THE MISTAKE THIS GUARDS AGAINST. Striking a model off for being busy
    // would make the platform permanently worse after any bad afternoon, and
    // it would do it silently.
    fakeProvider({
      "gemini-3.6-flash": { status: 429, body: JSON.stringify({ error: { message: "rate limited" } }) },
    });

    await generate();

    const struck = (await modelAvailability()).find((m) => m.model === "gemini-3.6-flash");
    expect(struck?.struckOff).toBe(false);
  }, 60_000);

  test("falling back is REPORTED, not silent", async () => {
    fakeProvider({
      "gemini-3.6-flash": {
        status: 404,
        body: JSON.stringify({ error: { message: "models/gemini-3.6-flash is not found" } }),
      },
    });

    const result = await generate();
    expect(result.ok).toBe(true);

    // The write is fire-and-forget so the reader is never made to wait for it.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const incidents = await listIncidents();
    const dead = incidents.find((i) => i.subject === "gemini-3.6-flash");

    expect(dead).toBeDefined();
    expect(dead?.kind).toBe(INCIDENT_AI_MODEL);
    expect(dead?.acknowledgedAt).toBeNull();
    expect(dead?.detail).toContain("not found");
  });
});

describe("no failure is invisible, whatever shape it takes", () => {
  test("a model that THROWS is still named in the record", async () => {
    // THE BUG THIS PINS, and it is why three rounds went by blind. Only a
    // failure that RETURNED was recorded. A thrown one — an aborted fetch, a
    // timeout, a DNS failure — escaped the per-model loop and landed in a catch
    // that knows nothing about which model was being tried. So two models that
    // answered a clean 404 were named in the panel, while the model at the head
    // of the chain failed on every single call and produced no record at all.
    globalThis.fetch = (async () => {
      throw new TypeError("The socket connection was closed unexpectedly");
    }) as unknown as typeof fetch;

    const result = await generate();
    expect(result.ok).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const named = (await listIncidents()).map((i) => i.subject);
    // The FIRST model in the chain is named, not just the roll-up.
    expect(named).toContain("gemini-3.6-flash");
  });

  test("a 400 is recorded with what was sent", async () => {
    // A 400 names a field the provider did not like. Knowing which fields were
    // in the request turns "it 400s" into "it 400s because of this one".
    fakeProvider({
      "gemini-3.6-flash": {
        status: 400,
        body: JSON.stringify({ error: { message: "Unknown name \"temperature\"" } }),
      },
    });

    await generate();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const row = (await listIncidents()).find((i) => i.subject === "gemini-3.6-flash");
    expect(row).toBeDefined();
    expect(row?.detail).toContain("400");
    expect(row?.detail).toContain("sent generationConfig");
  });

  test("the sampling knobs Gemini 3.x rejects are not sent", async () => {
    // Gemini 3.x deprecated temperature, top_p and top_k: ignored where
    // tolerated, a 400 where not. This adapter was written for 2.x and sent
    // temperature on every call.
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (input: any, init?: any) => {
      sent = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "IT WORKED" }] } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    await generate();

    const config = (sent.generationConfig ?? {}) as Record<string, unknown>;
    for (const banned of ["temperature", "topP", "topK", "candidateCount", "thinkingBudget"]) {
      expect(config[banned]).toBeUndefined();
    }
    // And it still asks for what it actually needs.
    expect(config.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe("a provider with no credit is not asked again and again", () => {
  test("one empty-balance answer stops the rest of that provider's chain", async () => {
    // MEASURED LIVE: one failed brief made about 34 provider calls, most of
    // them against an account answering "credit_balance_exhausted" every time.
    // A per-minute limit clears by itself and is worth waiting out; an empty
    // balance does not clear because we asked again, and every model on that
    // provider gives the same answer.
    process.env.OPENAI_API_KEY = "a-throwaway-value-for-this-test";
    delete process.env.GEMINI_API_KEY;
    // Start from a clean slate: an earlier test's strike-off would change which
    // models this one even reaches, which is how it passed alone and failed in
    // the full run.
    (await ai()).forgetStruckOffModels();

    fakeProvider({
      "gpt-5.4-mini": {
        status: 429,
        body: JSON.stringify({
          error: { message: "You have no credits remaining.", code: "credit_balance_exhausted" },
        }),
      },
      "gpt-4o-mini": { status: 429, body: '{"error":{"code":"credit_balance_exhausted"}}' },
      "gpt-4o": { status: 429, body: '{"error":{"code":"credit_balance_exhausted"}}' },
    });

    await generate();

    // It learned the account cannot pay from the FIRST model it tried and did
    // not go on to ask the others.
    //
    // Asserted as "exactly one call" rather than "exactly this model": which
    // model is first depends on what an earlier test struck off, and a test
    // that encodes that is a test that fails for reasons having nothing to do
    // with what it measures.
    expect(calls).toHaveLength(1);
    expect(new Set(calls).size).toBe(1);
    delete process.env.OPENAI_API_KEY;
  }, 60_000);
});

describe("an answer arrives inside the time a person will wait", () => {
  test("one model call cannot outlive the request that is waiting for it", async () => {
    // THE BUG THIS PINS. One call was allowed 60 seconds while the brief
    // request gave up at 45 — so the deadline meant to contain it could never
    // be honoured, and the reader watched a spinner forever: "now it just
    // loads indefinitely."
    //
    // A brief is a draft AND a check of that draft against the law, so ONE
    // call has to fit in well under half the request's budget.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const dir = resolve(import.meta.dir, "..", "src");

    const ai = readFileSync(resolve(dir, "services", "ai-generate.ts"), "utf8");
    const route = readFileSync(resolve(dir, "routes", "government-references.ts"), "utf8");

    const perCall = Number(ai.match(/DEFAULT_AI_TIMEOUT_MS = ([\d_]+)/)![1]!.replace(/_/g, ""));
    const total = Number(ai.match(/DEFAULT_TOTAL_BUDGET_MS = ([\d_]+)/)![1]!.replace(/_/g, ""));
    const request = Number(
      route.match(/BRIEF_REQUEST_DEADLINE_MS = ([\d_]+)/)![1]!.replace(/_/g, ""),
    );

    // Every attempt, every retry, still inside what the request will wait for.
    expect(total).toBeLessThan(request);
    // And a single call leaves room for the second one a brief always makes.
    expect(perCall * 2).toBeLessThan(request);
  });

  test("a chain of dead models still answers quickly", async () => {
    // Falling back must never cost more than answering. Three models refusing
    // in turn is the slowest honest path there is, and it has to stay short.
    fakeProvider({
      "gemini-3.6-flash": { status: 404, body: '{"error":{"message":"no"}}' },
      "gemini-2.5-flash": { status: 404, body: '{"error":{"message":"no"}}' },
    });

    const startedAt = Date.now();
    const result = await generate();
    const elapsed = Date.now() - startedAt;

    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe("an incident stays in front of somebody until they clear it", () => {
  test("the same failure updates one row rather than writing thousands", async () => {
    for (let i = 0; i < 5; i++) {
      await reportIncident({ kind: INCIDENT_AI_MODEL, subject: "a-model", detail: "gone" });
    }

    const rows = (await listIncidents()).filter((i) => i.subject === "a-model");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.occurrences).toBe(5);
  });

  test("acknowledging it does not fix it, and it re-opens if it happens again", async () => {
    await reportIncident({ kind: INCIDENT_AI_MODEL, subject: "a-model", detail: "gone" });

    const { acknowledgeIncident } = await incidents();
    const [row] = await listIncidents();
    expect(await acknowledgeIncident(row!.id, "an-admin")).toBe(true);

    const seen = (await listIncidents()).find((i) => i.subject === "a-model");
    expect(seen?.acknowledgedAt).not.toBeNull();

    // It happens again. "I have seen this" is not "this has stopped".
    await reportIncident({ kind: INCIDENT_AI_MODEL, subject: "a-model", detail: "gone again" });

    const reopened = (await listIncidents()).find((i) => i.subject === "a-model");
    expect(reopened?.acknowledgedAt).toBeNull();
    expect(reopened?.occurrences).toBe(2);
  });

  test("a failure with nothing left to try is recorded too", async () => {
    // Every model refused. This is the state the owner met three times, and it
    // was previously only a log line.
    fakeProvider({
      "gemini-3.6-flash": { status: 404, body: '{"error":{"message":"no"}}' },
      "gemini-2.5-flash": { status: 404, body: '{"error":{"message":"no"}}' },
      "gemini-2.0-flash": { status: 404, body: '{"error":{"message":"no"}}' },
    });

    const result = await generate();
    expect(result.ok).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));

    const incidents = await listIncidents();
    expect(incidents.some((i) => i.subject === "every configured model")).toBe(true);
  });
});
