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

describe("a data.gov key is a congress.gov key", () => {
  /**
   * MEASURED BEFORE IT WAS WRITTEN. api.data.gov is a shared gateway, and the
   * public DEMO_KEY answers 200 from api.congress.gov — so somebody holding a
   * data.gov key already holds a congress.gov key. Before this, the server told
   * them to go and get one, which is the exact failure this file exists to end.
   */
  test("CONGRESS_API_KEY wins, DATA_GOV_API_KEY stands in, and the report says which", async () => {
    const { congressGovKey, congressGovKeySource } = await import("../src/env");
    const { keyReport, keyWarnings } = await import("../src/services/key-report");

    const savedCongress = process.env.CONGRESS_API_KEY;
    const savedDataGov = process.env.DATA_GOV_API_KEY;

    delete process.env.CONGRESS_API_KEY;
    delete process.env.DATA_GOV_API_KEY;
    expect(congressGovKey()).toBeUndefined();
    expect(congressGovKeySource()).toBeNull();
    // And it says so, naming both ways to fix it.
    const missing = keyWarnings(keyReport()).join(" ");
    expect(missing).toContain("No congress.gov key");
    expect(missing).toContain("DATA_GOV_API_KEY");

    process.env.DATA_GOV_API_KEY = "data-gov-only";
    expect(congressGovKey()).toBe("data-gov-only");
    expect(congressGovKeySource()).toBe("DATA_GOV_API_KEY");
    // No longer nagging for a key that is already in hand.
    expect(keyWarnings(keyReport()).join(" ")).not.toContain("No congress.gov key");

    process.env.CONGRESS_API_KEY = "congress-specific";
    expect(congressGovKey()).toBe("congress-specific");
    expect(congressGovKeySource()).toBe("CONGRESS_API_KEY");

    if (savedCongress === undefined) delete process.env.CONGRESS_API_KEY;
    else process.env.CONGRESS_API_KEY = savedCongress;
    if (savedDataGov === undefined) delete process.env.DATA_GOV_API_KEY;
    else process.env.DATA_GOV_API_KEY = savedDataGov;
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

  test("the report covers every secret the admin panel can store", async () => {
    // THE HOLE THIS CLOSES, and it is the reason the Turnstile keys were
    // invisible for a day. declaredKeys() above matches names ending API_KEY —
    // which is structural, and neither TURNSTILE_SITE_KEY nor
    // TURNSTILE_SECRET_KEY ends that way. So the check above passed while two
    // storable secrets were reported nowhere.
    //
    // The admin key panel draws its main list from keyReport() and its "other
    // keys" list from stored names that are NOT built-in. A built-in name
    // missing from the report therefore falls between the two lists: the panel
    // said "None added yet." about a key sitting in the database guarding
    // sign-up. Only the activity log knew it existed.
    //
    // STORABLE_SECRETS is the right list to check against, because it is
    // exactly the set the panel will accept and store.
    const { keyReport } = await import("../src/services/key-report");
    const { STORABLE_SECRETS } = await import("../src/services/platform-secrets");
    const reported = keyReport().map((key) => key.name);

    const unreported = STORABLE_SECRETS.filter((name) => !reported.includes(name));
    expect(unreported).toEqual([]);
  });

  test("a half-configured bot test is called out, because it looks configured", async () => {
    // humanCheckConfigured() is both-or-neither. One key set and one missing
    // enforces NOTHING while the panel shows a key present and the operator
    // remembers pasting one — the most dangerous of the three states, and the
    // only one nothing was saying out loud.
    const { keyWarnings } = await import("../src/services/key-report");

    const site = process.env.TURNSTILE_SITE_KEY;
    const secret = process.env.TURNSTILE_SECRET_KEY;
    try {
      process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      delete process.env.TURNSTILE_SECRET_KEY;
      expect(keyWarnings().join(" ")).toContain("Only half the sign-up bot test is set");

      delete process.env.TURNSTILE_SITE_KEY;
      process.env.TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
      expect(keyWarnings().join(" ")).toContain("Only half the sign-up bot test is set");

      // Both present: no complaint about halves.
      process.env.TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
      expect(keyWarnings().join(" ")).not.toContain("Only half the sign-up bot test is set");
    } finally {
      if (site === undefined) delete process.env.TURNSTILE_SITE_KEY;
      else process.env.TURNSTILE_SITE_KEY = site;
      if (secret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
      else process.env.TURNSTILE_SECRET_KEY = secret;
    }
  });

  test("a documented Cloudflare testing key is not reported as another service's key", async () => {
    // Live Turnstile keys begin 0x; Cloudflare's documented testing keys begin
    // 1x, 2x and 3x. An expectedPrefix of "0x" would flag a documented test key
    // as "a different service's key in the right box" — which is precisely the
    // wrong answer this whole report exists to stop giving. So: no prefix.
    const { keyReport } = await import("../src/services/key-report");

    const site = process.env.TURNSTILE_SITE_KEY;
    try {
      process.env.TURNSTILE_SITE_KEY = "3x00000000000000000000FF";
      const row = keyReport().find((key) => key.name === "TURNSTILE_SITE_KEY")!;
      expect(row.present).toBe(true);
      expect(row.looksRight).toBe(true);
    } finally {
      if (site === undefined) delete process.env.TURNSTILE_SITE_KEY;
      else process.env.TURNSTILE_SITE_KEY = site;
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
