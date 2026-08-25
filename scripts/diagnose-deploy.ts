/**
 * What the deployed service actually has, without printing any of it.
 *
 * WHY THIS EXISTS. "The key is definitely set" and "the feature does not work"
 * were both true at once, three times, with three different keys. Every attempt
 * to settle it from outside was guesswork, because nothing could see the
 * deployed environment: the token that can is a GitHub Actions secret, usable
 * only inside a workflow run.
 *
 * So the question gets asked from inside one. This reads the service's
 * variables through the Railway CLI and reports what is there — names,
 * lengths, and a four-character fingerprint of each value. It answers the two
 * questions that actually matter and could not be answered any other way:
 *
 *   Is the key on this service at all?
 *   Is it under the name the code reads, or under a different one?
 *
 * THIS REPOSITORY IS PUBLIC, SO ITS ACTIONS LOGS ARE PUBLIC. Railway's
 * variables are not registered GitHub secrets, so nothing masks them
 * automatically. Every value in this file is derived before it is printed and
 * the raw input is never echoed — no `cat`, no dump on error, no value in a
 * warning. The fingerprint is four hex characters of a SHA-256 digest: enough
 * to compare against what you pasted, worth nothing to anybody who reads it.
 *
 * EMAIL_FROM is printed in full on purpose. It is an address, not a secret, and
 * it is the single most common reason mail with a valid key still fails —
 * Resend refuses any message from a domain the account has not verified.
 */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

/** Every variable the API reads as a secret, and what it powers. */
const SECRETS: Array<{ name: string; powers: string; prefix?: string }> = [
  { name: "RESEND_API_KEY", powers: "sign-up, sign-in and password-reset codes", prefix: "re_" },
  { name: "CONGRESS_API_KEY", powers: "bill text and lineage" },
  { name: "COURTLISTENER_API_KEY", powers: "Supreme Court opinions" },
  { name: "GEMINI_API_KEY", powers: "writes the Citizen's Brief (tried first)" },
  { name: "OPENAI_API_KEY", powers: "writes the Citizen's Brief (fallback)", prefix: "sk-" },
  { name: "TAVILY_API_KEY", powers: "live web grounding for search", prefix: "tvly-" },
];

/** Not secret, and printing it is the point. */
const PLAIN = ["EMAIL_FROM", "BACKEND_URL", "APP_ORIGINS", "APP_SCHEMES", "MEDIA_STORAGE", "NODE_ENV"];

/** Never printed, only checked for presence. */
const REQUIRED = ["DATABASE_URL", "DIRECT_URL", "BETTER_AUTH_SECRET"];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 4);
}

const out: string[] = [];
const say = (line = "") => out.push(line);

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error("Pass the path to the railway variables JSON.");

  let vars: Record<string, string>;
  try {
    // Parsed, never echoed. A malformed file reports that it is malformed and
    // nothing else — printing what could not be parsed would print the values.
    vars = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    say("Could not read the service variables as JSON. Nothing printed, on purpose.");
    return;
  }

  const names = Object.keys(vars).sort();

  say("## What the deployed API actually has");
  say();
  say("Fingerprints are four hex characters of a SHA-256 digest of the value.");
  say("No key is printed here. Compare a fingerprint with one taken of what you");
  say("pasted to tell whether this service holds the same value.");
  say();

  say("### Keys the API reads");
  say();
  say("| Variable | Set | Length | Fingerprint | Powers |");
  say("|---|---|---|---|---|");
  for (const secret of SECRETS) {
    const raw = vars[secret.name];
    const value = raw?.trim();
    if (!value) {
      say(`| \`${secret.name}\` | **no** | — | — | ${secret.powers} |`);
      continue;
    }
    const shape =
      secret.prefix && !value.startsWith(secret.prefix)
        ? ` ⚠️ does not start with \`${secret.prefix}\``
        : "";
    // A value whose trimmed length differs from its raw length arrived with
    // whitespace on it, which is a 401 that reads as a wrong key.
    const padded = raw!.length !== value.length ? " ⚠️ has surrounding whitespace" : "";
    say(
      `| \`${secret.name}\` | yes | ${value.length} | \`${fingerprint(value)}\` | ` +
        `${secret.powers}${shape}${padded} |`
    );
  }
  say();

  say("### Settings (not secret)");
  say();
  for (const name of PLAIN) {
    const value = vars[name];
    say(`- \`${name}\` = ${value ? `\`${value}\`` : "**not set**"}`);
  }
  say();

  const missingRequired = REQUIRED.filter((name) => !vars[name]?.trim());
  if (missingRequired.length) {
    say(`⚠️ Missing and required: ${missingRequired.map((n) => `\`${n}\``).join(", ")}`);
    say();
  }

  say("### Every variable name on this service");
  say();
  say("Names only. This is how a key set under the wrong name becomes visible —");
  say("the API reads the exact names in the table above and nothing else.");
  say();
  say(names.map((name) => `\`${name}\``).join(" · ") || "_none_");
  say();

  // The verdict, in the order somebody would act on it.
  const problems: string[] = [];
  const resend = vars.RESEND_API_KEY?.trim();
  const from = vars.EMAIL_FROM?.trim();
  const fromDomain = from?.match(/@([^\s>]+)/)?.[1]?.toLowerCase();

  if (!resend) {
    problems.push(
      "`RESEND_API_KEY` is not on this service. Nobody who signs up can finish signing " +
        "up — the verification code has nowhere to go."
    );
  } else if (!resend.startsWith("re_")) {
    problems.push(
      "`RESEND_API_KEY` is set but does not start with `re_`, which Resend keys do. " +
        "That is usually another service's key in the right box."
    );
  } else if (fromDomain && fromDomain !== "resend.dev") {
    problems.push(
      `The key looks right, so the next thing that fails is the sender. \`EMAIL_FROM\` ` +
        `sends from \`${fromDomain}\`, and Resend refuses any message from a domain the ` +
        `account has not verified — a refusal indistinguishable from a bad key. Either ` +
        `verify \`${fromDomain}\` in Resend, or set \`EMAIL_FROM\` to ` +
        `\`onboarding@resend.dev\` while testing.`
    );
  } else if (fromDomain === "resend.dev") {
    problems.push(
      "`EMAIL_FROM` is Resend's shared test sender. It needs no DNS, but it delivers " +
        "ONLY to the address the Resend account was opened with — everybody else gets " +
        "nothing, and the send still reports success."
    );
  }

  if (!vars.GEMINI_API_KEY?.trim() && !vars.OPENAI_API_KEY?.trim()) {
    problems.push(
      "No model key (`GEMINI_API_KEY` or `OPENAI_API_KEY`). No Citizen's Brief can be " +
        "written for any law, on any branch."
    );
  }

  say("### What to do");
  say();
  if (problems.length === 0) {
    say("Nothing here is obviously wrong. Send a live test from the admin console");
    say("(Settings → API keys and email) — that is the only thing that proves delivery.");
  } else {
    for (const problem of problems) say(`- ${problem}`);
  }
}

try {
  main();
} catch (error) {
  // The message only. A stack could carry an argument, and an argument could
  // carry a value.
  say(`Diagnosis failed: ${error instanceof Error ? error.message : "unknown error"}`);
}

const report = out.join("\n");
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
