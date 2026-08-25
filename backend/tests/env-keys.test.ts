/**
 * Every API key has one name, one reader, and one place it is written down.
 *
 * WHY THIS EXISTS. Three separate times on this project, a key was set and the
 * thing it powers did not work, and each time the answer took source-code
 * reading to find. That is not bad luck with keys. It was three distinct
 * defects in how this codebase took them in:
 *
 *   1. HALF THE KEYS BYPASSED THE SCHEMA. RESEND_API_KEY went through env.ts;
 *      CONGRESS_API_KEY, COURTLISTENER_API_KEY, TAVILY_API_KEY, GEMINI_API_KEY
 *      and OPENAI_API_KEY were read straight off process.env in seven files. So
 *      nothing trimmed a pasted newline and nothing checked the spelling — a
 *      typo'd variable name was simply an absent key, forever, silently.
 *
 *   2. TWO KEYS WERE NAMED NOWHERE AT ALL. GEMINI_API_KEY and OPENAI_API_KEY
 *      were in no schema and, worse, in no .env.example — the file that is
 *      supposed to be the complete list of what to set. Following the
 *      documentation exactly produced a deployment that could not write a
 *      single Citizen's Brief and said nothing about why. That is not a key
 *      that could not be found. That is a key nobody was told existed.
 *
 *   3. NOTHING REPORTED WHAT WAS PRESENT. There was no way, short of reading
 *      the source, to ask the running server which keys it had.
 *
 * These tests pin all three shut. They read the source rather than the running
 * config, so they fail the day a new key arrives by the old route — not months
 * later when somebody is certain they set it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Set before src/env.ts is ever imported, because it validates at import time
 * and this file imports the key report directly rather than booting a server.
 * Throwaway values: nothing here connects to anything.
 */
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-only-secret-value-not-used-anywhere-else";
/** A key-shaped value, so the fingerprint test has something to fingerprint. */
process.env.TAVILY_API_KEY = "tvly-a-real-looking-secret-value";

const ROOT = process.cwd();
const REPO = resolve(ROOT, "..");

/** The one file allowed to read a key out of the environment. */
const SCHEMA = "src/env.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

function code(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function backendFiles(): string[] {
  return [...walk("src"), ...walk("scripts")]
    .map((f) => relative(".", f))
    .filter((f) => f !== SCHEMA);
}

/** Every *_API_KEY name the schema declares. */
function declaredKeys(): string[] {
  const src = code(SCHEMA);
  return [...src.matchAll(/^\s*([A-Z0-9_]*API_KEY)\s*:/gm)].map((m) => m[1]!);
}

describe("every key comes in through one door", () => {
  test("nothing outside the schema reads a key from process.env", () => {
    const offenders = backendFiles().filter((file) =>
      // B2B_*_API_KEY excluded: those are not the API's keys. They are input to
      // scripts/seed-b2b.ts, which reads them once, writes a hash, and fails
      // loudly naming each one it lacks. The server never reads them at all.
      /process\.env\.(?!B2B_)[A-Z0-9_]*API_KEY/.test(code(file)),
    );

    // If this fails: add the key to src/env.ts using secret(), and read it as
    // env.THE_KEY. That is what trims the newline somebody pasted and what
    // makes a misspelled variable name a boot error instead of a silent absence.
    //
    // The B2B_* variables are not here on purpose: the API does not read them,
    // scripts/seed-b2b.ts does, and it fails loudly naming each one it lacks.
    expect(offenders).toEqual([]);
  });

  test("the schema declares every key the platform uses", () => {
    const keys = declaredKeys();
    for (const expected of [
      "RESEND_API_KEY",
      "CONGRESS_API_KEY",
      "COURTLISTENER_API_KEY",
      "TAVILY_API_KEY",
      // The two that existed nowhere. Every Citizen's Brief depends on one.
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  test("every key is trimmed, so a pasted newline is not a mystery 401", () => {
    const src = code(SCHEMA);
    for (const key of declaredKeys()) {
      // secret() is the shared rule: trim, and treat an empty string as absent.
      expect(src).toContain(`${key}: secret()`);
      // And it is on the live-read list, so the value is never a snapshot of
      // whenever this module happened to be imported.
      expect(src).toContain(`"${key}",`);
    }
  });

  test("a key is read when it is used, not when the module was imported", async () => {
    const { env } = await import("../src/env");

    const before = env.CONGRESS_API_KEY;
    process.env.CONGRESS_API_KEY = "  a-value-set-after-import  ";
    // Trimmed on the way out, and current — an import-order landmine here is
    // exactly what makes "the key is set and it still does not work" true.
    expect(env.CONGRESS_API_KEY).toBe("a-value-set-after-import");

    process.env.CONGRESS_API_KEY = "   ";
    // Whitespace only is absent, not a key made of spaces.
    expect(env.CONGRESS_API_KEY).toBeUndefined();

    if (before === undefined) delete process.env.CONGRESS_API_KEY;
    else process.env.CONGRESS_API_KEY = before;
  });
});

describe("every key is written down where somebody setting this up will see it", () => {
  test(".env.example names every key the schema declares", () => {
    const example = readFileSync(join(REPO, ".env.example"), "utf8");

    const missing = declaredKeys().filter((key) => !example.includes(`${key}=`));

    // THE ONE THAT ACTUALLY HAPPENED. GEMINI_API_KEY and OPENAI_API_KEY were
    // absent here while the brief pipeline required one of them, so a
    // by-the-book deployment could not write a brief and nothing said why.
    expect(missing).toEqual([]);
  });

  test("the deployment guide names them too", () => {
    const guide = readFileSync(join(REPO, "DEPLOYMENT.md"), "utf8");
    const missing = declaredKeys().filter((key) => !guide.includes(key));
    expect(missing).toEqual([]);
  });
});

describe("the server can say which keys it holds", () => {
  test("the report covers every declared key", async () => {
    const { keyReport } = await import("../src/services/key-report");
    const reported = keyReport().map((key) => key.name);
    for (const key of declaredKeys()) {
      expect(reported).toContain(key);
    }
  });

  test("it never returns a key, only a fingerprint of one", async () => {
    const { keyReport } = await import("../src/services/key-report");
    const report = keyReport();

    const tavily = report.find((key) => key.name === "TAVILY_API_KEY")!;
    expect(tavily.present).toBe(true);

    // The whole report, serialised, must not contain the secret anywhere —
    // not in a field somebody added later without thinking about it.
    expect(JSON.stringify(report)).not.toContain("a-real-looking-secret-value");

    for (const key of report) {
      if (key.present) {
        // Four hex characters. Enough to compare against what was pasted,
        // useless to anybody who learns it.
        expect(key.fingerprint).toMatch(/^[0-9a-f]{4}$/);
      } else {
        expect(key.fingerprint).toBeNull();
      }
    }
  });
});
