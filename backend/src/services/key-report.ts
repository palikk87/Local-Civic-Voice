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
import { congressGovKeySource, env } from "../env";
import { emailConfiguration } from "./email";
import { sourceOf, type SecretSource } from "./platform-secrets";

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
  /**
   * Where the value this process is using came from: the database (set from the
   * admin console) or this host's environment.
   *
   * "It is definitely set" was true and useless three times on this project.
   * With two possible places to set a key, saying which one won is the
   * difference between a five-second answer and another source-code read.
   */
  source: SecretSource;
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
    source: sourceOf(name),
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
      env.DATA_GOV_API_KEY
        ? "Nothing right now — DATA_GOV_API_KEY is set and congress.gov accepts it, so bill " +
          "text is still being fetched with that."
        : "No legislative text, so no brief for any bill."
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
      "DATA_GOV_API_KEY",
      env.DATA_GOV_API_KEY,
      null,
      "api.data.gov is one gateway in front of several agencies, and this key opens all of " +
        "them. Today it is used as a stand-in for CONGRESS_API_KEY when that is not set — " +
        "congress.gov sits behind the same gateway and accepts it.",
      "Nothing, on its own. It is a second way to supply the congress.gov key, not a " +
        "requirement of its own. govinfo.gov and regulations.gov also accept it; neither is " +
        "wired up yet."
    ),
    // BOTH HALVES OF THE SIGN-UP BOT TEST, and they were the reason to write
    // this down. The panel drew its main list from this report and its "other"
    // list from stored names that are NOT built-in. These two are built-in, so
    // they were never "other" — and they were absent here, so they were nowhere.
    // The panel said "None added yet." about a key sitting in the database
    // guarding sign-up. Only the admin activity log knew.
    //
    // NO expectedPrefix ON EITHER. Live keys begin 0x, but Cloudflare's
    // documented testing keys begin 1x, 2x and 3x — so a prefix check would
    // report a documented test key as another service's key, which is the exact
    // wrong answer this file exists to stop giving.
    status(
      "TURNSTILE_SITE_KEY",
      env.TURNSTILE_SITE_KEY,
      null,
      "The public half of the sign-up bot test. Printed into the sign-up form so " +
        "Cloudflare knows which widget is being solved.",
      "No challenge is drawn, so nothing can be solved and nothing is checked. Sign-up " +
        "still works and reports that it checked nothing."
    ),
    status(
      "TURNSTILE_SECRET_KEY",
      env.TURNSTILE_SECRET_KEY,
      null,
      "The private half. The server sends each solved challenge to Cloudflare with this " +
        "and refuses the sign-up if Cloudflare rejects it.",
      "Nothing is verified. Constitution Article I §3 — only verified humans may vote — " +
        "rests on an email address alone, and inboxes are free and scriptable."
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
 * EVERY KEY THE PANEL MUST SHOW — the described ones, plus anything that is
 * actually stored, whether this file has ever heard of it or not.
 *
 * WHY THIS EXISTS, and it is the only rule that matters here: adding a key must
 * never require a developer. The list above is hand-written, so a key nobody
 * had thought to add to it was invisible — the panel said "None added yet."
 * about a key sitting in the database guarding sign-up. The panel's other list
 * only held names that are NOT built-in, so a built-in absent from the report
 * fell between the two and appeared in neither.
 *
 * So the list is no longer the authority. THE DATABASE IS. Anything stored
 * shows up, always, under whatever name it was stored as. The rows above only
 * add description — what a key powers and what breaks without it — for the ones
 * this codebase actually consumes. A key it has never heard of is shown plainly
 * and says so, which is honest rather than silent.
 */
export function fullKeyReport(storedNames: string[]): KeyStatus[] {
  const described = keyReport();
  const alreadyShown = new Set(described.map((key) => key.name));

  const extras = [...new Set(storedNames)]
    .filter((name) => !alreadyShown.has(name))
    .sort()
    .map((name) =>
      status(
        name,
        // Stored secrets are applied into the process, so this reads the value
        // actually in use — the same thing every consumer of it would read.
        process.env[name]?.trim() || undefined,
        // NO PREFIX EXPECTATION. This key belongs to a provider this codebase
        // does not know, so it has no idea what its keys look like, and
        // guessing would mean flagging a perfectly good key as the wrong one.
        null,
        "Added here. Nothing in this codebase reads it yet — it is stored and ready to be " +
          "wired in by name, with no redeploy.",
        "Nothing, yet.",
      ),
    );

  return [...described, ...extras];
}

/**
 * The problems worth saying out loud, in the words of somebody who has to fix
 * them. Ordered by how much of the platform stops working.
 */
export function keyWarnings(report: KeyStatus[] = keyReport()): string[] {
  const by = (name: string) => report.find((key) => key.name === name)!;
  const warnings: string[] = [];

  // THE SENDER, NOT THE KEY. This is first because it is the failure that
  // looks most like a working system: a valid key, an accepted request, a 200,
  // and no mail for anybody. It was the real cause of "email verification does
  // not send an email" on this deployment, while the key was perfect the whole
  // time and every diagnostic that only asked about the key said so.
  const mail = emailConfiguration();
  if (mail.configured) {
    if (mail.fromIsProviderTestSender) {
      warnings.push(
        `EMAIL_FROM is ${mail.from} — Resend's shared test sender. It needs no DNS, and ` +
          "it delivers ONLY to the address the Resend account was opened with. Every other " +
          "recipient gets nothing, and the send still succeeds, so the app believes the code " +
          "went out. Verify a domain in Resend and send from an address on it."
      );
    } else if (mail.fromDomain) {
      warnings.push(
        `Nothing sends unless ${mail.fromDomain} is a verified domain in this Resend ` +
          "account. Resend refuses mail from an unverified sender in a way that is " +
          "indistinguishable from a bad key. Send a test below to find out for certain."
      );
    }
  }

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

  // Read through the same fallback the code uses. This warned about a missing
  // CONGRESS_API_KEY while a perfectly good DATA_GOV_API_KEY was set and being
  // used for exactly that — which sends somebody looking for a key they already
  // have, the failure mode this whole file exists to end.
  if (!congressGovKeySource()) {
    warnings.push(
      "No congress.gov key. Set CONGRESS_API_KEY, or DATA_GOV_API_KEY — congress.gov is " +
        "behind the api.data.gov gateway and accepts a key issued there. Without one there " +
        "is no bill text, so no brief for any bill."
    );
  }

  // HALF A KEY PAIR IS THE DANGEROUS STATE, because it looks configured from
  // every direction. humanCheckConfigured() is both-or-neither, so one key set
  // and one missing enforces nothing — while the panel shows a key present, the
  // operator remembers pasting one, and the gate is wide open.
  const site = by("TURNSTILE_SITE_KEY").present;
  const secret = by("TURNSTILE_SECRET_KEY").present;
  if (site !== secret) {
    warnings.push(
      `Only half the sign-up bot test is set — ${site ? "TURNSTILE_SITE_KEY" : "TURNSTILE_SECRET_KEY"} ` +
        `is present and ${site ? "TURNSTILE_SECRET_KEY" : "TURNSTILE_SITE_KEY"} is missing. It takes ` +
        "both, so NOTHING is being checked: sign-up is open to bots while looking configured. " +
        "Paste the other half, or clear this one so the state reads as unconfigured."
    );
  } else if (!site) {
    warnings.push(
      "No sign-up bot test (TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY). Only a confirmed " +
        "email address stands between a script and a voting account, and the Pulse is only " +
        "worth reading if it counts citizens rather than accounts."
    );
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
      key.present
        ? `${key.name}=${key.fingerprint}${key.looksRight ? "" : "(?)"}` +
          (key.source === "database" ? "(db)" : "")
        : `${key.name}=—`
    )
    .join("  ");
}
