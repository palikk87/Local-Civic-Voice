/**
 * NOTHING SPENDS MONEY UNLESS SOMEBODY ASKED.
 *
 * WHY THIS EXISTS, in the owner's words: "make sure there are no credit leaks
 * anywhere. anything that just spending it in the background with out us
 * knowing."
 *
 * There was one. The self-heal sweep runs every six hours and queues up to
 * twenty-five records missing their official text. The job that picked those up
 * then wrote a Citizen's Brief for every one of them — two or three model calls
 * each, up to a hundred briefs a day, paid for, for laws nobody had opened,
 * with nothing on any screen saying it was happening.
 *
 * THE LINE THIS DRAWS. Fetching official text is free: congress.gov,
 * courtlistener, the federal register. Writing a brief is not. Background work
 * may do as much of the free half as it likes; the paid half waits for a person.
 *
 * That is also the model the platform already runs on — a brief is written once
 * and then reused by everyone forever — so spend follows real readers rather
 * than the size of the database.
 */

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-value-not-used-anywhere-else";

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "..", "src");
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });

describe("no paid work happens without somebody asking", () => {
  test("the scheduled sweep repairs text but does not write briefs", () => {
    // The processor the sweep feeds must not turn the brief writer on by
    // default. If it does, every record the sweep touches costs money.
    const processors = read("services", "job-processors.ts");
    const reextract = processors.slice(
      processors.indexOf("async function processReextractReferenceText"),
      processors.indexOf("async function processReextractReferenceText") + 600,
    );

    expect(reextract).toContain("generateBriefInline: data.writeBrief === true");
    // The literal `true` is what it was, and what must never come back.
    expect(reextract).not.toContain("generateBriefInline: true");
  });

  test("the sweep itself never asks for a brief", () => {
    // content-self-heal enqueues text repair. If it ever starts passing
    // writeBrief, the sweep is buying briefs again by another route.
    const sweep = read("services", "content-self-heal.ts");
    expect(sweep).not.toContain("writeBrief");
    expect(sweep).not.toContain("GENERATE_REFERENCE_BRIEF");
  });

  test("every model call is reachable from a request or a person's decision", () => {
    // A census, so a new caller has to be looked at rather than appearing
    // silently. generateAI is the only door to a paid provider.
    const callers = walk(SRC)
      .filter((file) => !file.endsWith("ai-generate.ts"))
      .filter((file) => /\bgenerateAI\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(SRC + "/", ""))
      .sort();

    // citizen-brief   — a reader opened a law, or an admin asked for a rebuild
    // search-intent   — a person typed a search
    // merge-adjudicator — an admin reviews duplicate laws
    // routes/ai.ts    — the app's own AI endpoint, behind a session
    //
    // If this list grows, the new caller needs the same question asked of it:
    // can it run when nobody is watching?
    expect(callers).toEqual([
      "routes/ai.ts",
      "services/citizen-brief.ts",
      "services/merge-adjudicator.ts",
      "services/search-intent.ts",
    ]);
  });

  test("no scheduled job calls a paid provider directly", () => {
    // The scheduled work itself — sync, lineage, roll calls, archives,
    // provenance, merges — talks to government sources, which are free.
    const scheduled = read("index.ts");
    const jobs = scheduled.slice(scheduled.indexOf("schedule({"));
    expect(jobs).not.toContain("generateAI");
    expect(jobs).not.toContain("composeBrief");
  });
});
