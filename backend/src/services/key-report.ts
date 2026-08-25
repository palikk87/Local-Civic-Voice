/**
 * Which keys this running server actually holds, and what breaks without each.
 *
 * WHY THIS EXISTS. "The key is definitely set" and "the feature does not work"
 * kept being true at the same time, more than once, with different keys — and
 * every time, the only way to find out which of the two was wrong involved
 * reading source code. That is a defect in this codebase, not in whoever set
 * the key. A server that consumes a secret and cannot say whether it has one is
 * asking to be debugged by guesswork.
 *
 * Three things were actually wrong, and this file is the answer to all three:
 *
 *   1. Half the keys were read straight off process.env, so nothing trimmed a
 *      pasted newline and nothing validated the name. env.ts now owns all of
 *      them, and tests/env-keys.test.ts fails if a reader goes around it.
 *
 *   2. GEMINI_API_KEY and OPENAI_API_KEY appeared in NO documentation and no
 *      schema, while every Citizen's Brief depended on one of them. Following
 *      .env.example to the letter produced a deployment that could not write a
 *      single brief and said nothing about why.
 *
 *   3. Nothing anywhere reported what was present. Now one endpoint does.
 *
 * NO KEY IS EVER RETURNED. The fingerprint is four hex characters of a SHA-256
 * digest — enough to compare what the server holds against what you pasted,
 * and worth nothing to anyone who learns it.
 */

import { createHash } from "node:crypto";
import { env } from "../env";

export interface KeyStatus {
  /** The environment variable name, spelled exactly as it must be set. */
  name: string;
  present: boolean;
  /** First four hex characters of SHA-256(key). Null when absent. */
  fingerprint: string | null;
  /** Character count. A key half-pasted is a real and invisible failure. */
  length: number | null;
  /**
   * Whether the value starts the way this provider's keys start. False here is
   * usually a different service's key in the right box, which produces a 401
   * that reads as "my key is wrong" rather than "my key is for something else".
   */
  looksRight: boolean;
  /** What this key is for. */
  powers: string;
  /** What a user sees when it is missing. Written from their side, not ours. */
  withoutIt: string;
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 4);
}

function status(
  name: string,
  value: string | undefined,
  expectedPrefix: string | null,
  powers: string,
  withoutIt: string
): KeyStatus {
  return {
    name,
    present: !!value,
    fingerprint: value ? fingerprint(value) : null,
    length: value ? value.length : null,
    // An absent key is not "wrong-looking"; it is absent, and `present` says so.
    looksRight: !value || !expectedPrefix ? !!value : value.startsWith(expectedPrefix),
    powers,
    withoutIt,
  };
}

export function keyReport(): KeyStatus[] {
  return [
    status(
      "RESEND_API_KEY",
      env.RESEND_API_KEY,
      "re_",
      "Every one-time code: sign-up verification, sign-in, password reset.",
      "Nobody who signs up can finish signing up — the code has nowhere to go. Reading still works."
    ),
    status(
      "CONGRESS_API_KEY",
      env.CONGRESS_API_KEY,
      null,
      "Bill text and bill lineage from congress.gov.",
      "No legislative text, so no brief for any bill."
    ),
    status(
      "COURTLISTENER_API_KEY",
      env.COURTLISTENER_API_KEY,
      null,
      "Supreme Court opinions from CourtListener.",
      "No judicial text — the opinion endpoint answers 401 without a token."
    ),
    status(
      "GEMINI_API_KEY",
      env.GEMINI_API_KEY,
      null,
      "Writes the Citizen's Brief. Tried first, because it is the cheaper of the two.",
      "Falls through to OpenAI. With neither, no brief can be written for any law."
    ),
    status(
      "OPENAI_API_KEY",
      env.OPENAI_API_KEY,
      "sk-",
      "Writes the Citizen's Brief when Gemini is absent or failing.",
      "Falls back to Gemini. With neither, no brief can be written for any law."
    ),
    status(
      "TAVILY_API_KEY",
      env.TAVILY_API_KEY,
      "tvly-",
      "Live web grounding for search.",
      "Search runs on the model's training data alone — fine for settled law, weak on this week's news."
    ),
  ];
}

/**
 * The problems worth saying out loud, in the words of somebody who has to fix
 * them. Ordered by how much of the platform stops working.
 */
export function keyWarnings(report: KeyStatus[] = keyReport()): string[] {
  const by = (name: string) => report.find((key) => key.name === name)!;
  const warnings: string[] = [];

  for (const key of report) {
    if (key.present && !key.looksRight) {
      warnings.push(
        `${key.name} is set but does not look like this provider's key. That is usually a ` +
          `different service's key in the right box, and it fails as a 401 that reads like a bad key.`
      );
    }
  }

  if (!by("RESEND_API_KEY").present) {
    warnings.push(
      "RESEND_API_KEY is missing. Nobody can finish signing up: the verification gate " +
        "holds every new account until it enters a code that is never sent."
    );
  }

  if (!by("GEMINI_API_KEY").present && !by("OPENAI_API_KEY").present) {
    warnings.push(
      "No model key (GEMINI_API_KEY or OPENAI_API_KEY). No Citizen's Brief can be " +
        "written for any law, on any branch."
    );
  }

  if (!by("CONGRESS_API_KEY").present) {
    warnings.push("CONGRESS_API_KEY is missing. No bill text, so no brief for any bill.");
  }

  if (!by("COURTLISTENER_API_KEY").present) {
    warnings.push(
      "COURTLISTENER_API_KEY is missing. No Supreme Court opinion text — that endpoint " +
        "answers 401 without a token."
    );
  }

  return warnings;
}

/** One line per key, for the boot log. Never prints a key. */
export function keySummary(report: KeyStatus[] = keyReport()): string {
  return report
    .map((key) =>
      key.present ? `${key.name}=${key.fingerprint}${key.looksRight ? "" : "(?)"}` : `${key.name}=—`
    )
    .join("  ");
}
