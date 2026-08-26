/**
 * How this platform talks to a government source, and what it refuses to
 * believe when one answers.
 *
 * TWO PROBLEMS, ONE FILE.
 *
 * FIRST: nothing identified itself. Every request to congress.gov,
 * federalregister.gov, govinfo.gov and courtlistener.com went out with
 * whatever User-Agent the runtime happened to have — from a datacenter IP, on
 * a schedule. That is indistinguishable from a scraper, and it gets treated
 * like one: the Federal Register's own API documentation asks callers to
 * identify themselves, and the usual consequence of not doing so is an
 * anti-bot interstitial instead of the document. It works from a laptop and
 * fails from a server, which is exactly the shape of "it works locally".
 *
 * SECOND, and much worse: when a source DID answer with an interstitial, we
 * stored it as the law. The only check on fetched official text was
 * `length > 200`, and a "checking your browser" page is a few kilobytes. So a
 * captcha could be written into GovernmentReference.fullText, hashed as the
 * law's fingerprint, shown to readers as the text of an executive order, and —
 * because a brief is written from whatever is in that column — summarised by
 * the AI and stored as the Citizen's Brief for that version of the law.
 *
 * A source that will not give us the document must produce NOTHING. An empty
 * state reading "we do not have the text yet" is honest. A captcha page
 * presented as an executive order is not a degraded experience; it is a false
 * record, on a platform whose entire claim is that its records are the real
 * ones.
 */

/**
 * Who is calling, and where to complain.
 *
 * Built from BACKEND_URL rather than a literal: no address of this deployment
 * is hardcoded anywhere in this repository, and that rule does not get an
 * exception for a header. A source that wants to rate-limit us, or tell us we
 * are doing something wrong, can now find us.
 *
 * Reads process.env directly rather than importing ../env ON PURPOSE. This
 * module is the guard that decides whether a fetched page is a law, and it is
 * used by the sync, by the reader-facing content pipeline, and by a maintenance
 * script — importing the validated env would make all three, and every test of
 * this logic, require a database URL to answer a question about a string. The
 * server still validates BACKEND_URL properly at boot, in env.ts.
 */
export function officialSourceUserAgent(): string {
  const contact = process.env.BACKEND_URL || "http://localhost:3000";
  return `AyeAndNay/1.0 (civic reference sync; +${contact})`;
}

/** Headers for any call to an official source. Merge, do not replace. */
export function officialSourceHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { "User-Agent": officialSourceUserAgent(), ...extra };
}

/**
 * Signatures of a page that is not a law — in two tiers, and the split matters.
 *
 * Matched against the EXTRACTED TEXT, lowercased, so markup differences between
 * vendors do not matter: what block pages have in common is the sentence they
 * show a human.
 *
 * TIER ONE is wording no statute, order or opinion would ever open with. These
 * reject on sight, at any length.
 */
const NEVER_A_DOCUMENT = [
  /*
   * The Federal Register's own block page, captured live and word for word.
   * Titled "Federal Register :: Request Access", it serves HTTP 200 — so
   * `response.ok` is true and nothing upstream of this ever caught it — and
   * runs to about 1,500 characters of visible text. It is the page that was
   * being stored as the text of executive orders, summarised by the AI, and
   * put in front of readers with Support and Oppose buttons under it.
   *
   * Tier one rather than tier two on purpose. The length corroboration below
   * does catch it today, but only because the page is short; the Federal
   * Register could add three more paragraphs of help text tomorrow and it
   * would sail through. These phrases are what the page IS.
   */
  "request has been flagged as potentially automated",
  "aggressive automated scraping",
  "captcha (bot test)",
  "request a wider ip range",
  "federal register :: request access",
  "programmatic access to these sites is limited",

  "attention required! | cloudflare",
  "cloudflare ray id",
  "ddos protection by",
  "incapsula incident id",
  "checking your browser",
  "enable javascript and cookies to continue",
  "please enable cookies",
  "are you a robot",
  "are you a human",
  "verify you are human",
  "unusual traffic from your computer network",
  "your request has been blocked",
  "request unsuccessful",
  "access denied",
  "403 forbidden",
  "404 not found",
  "rate limit exceeded",
  "service temporarily unavailable",
];

/**
 * TIER TWO is wording a REAL DOCUMENT COULD CONTAIN.
 *
 * This tier exists because of a test that failed while this was being written.
 * An executive order about AI, privacy or election security can perfectly well
 * say "data scraping" or "captcha" in its first paragraph — an order titled
 * "Protecting Americans from Automated Data Collection" would say little else —
 * and rejecting it would silently discard a genuine law. That is its own kind
 * of lie, and a quieter one than storing a block page, because nobody ever sees
 * the thing that was thrown away.
 *
 * So these only convict with corroboration: the text must ALSO be short. A
 * block page has a headline and a sentence; the real executive orders measured
 * against the live Federal Register run seven to twelve thousand characters
 * once the gazette furniture is stripped. A long document that mentions
 * scraping is a law about scraping.
 */
const SUSPICIOUS_IF_SHORT = [
  "captcha",
  "recaptcha",
  "data scraping",
  "web scraping",
  "automated queries",
  "bot detection",
];

/**
 * The shortest thing that could honestly be an official document.
 *
 * DELIBERATELY LEFT AT 200, which is where it already was.
 *
 * The first version of this file raised it to 600 on the reasoning that a
 * block page is bigger than that, so a higher floor would catch one. The test
 * suite rejected that immediately — thirteen failures — and it was right to.
 * Length is the wrong instrument here twice over:
 *
 *   - it does not work. Every interstitial worth worrying about is several
 *     kilobytes; no floor low enough to be safe is high enough to catch one.
 *     Tier one below is what actually catches them.
 *   - it is not safe. A one-line joint resolution — "That Congress disapproves
 *     the rule submitted by..." — is a real law and can run to a few hundred
 *     characters. Discarding one is SILENT, and a platform that quietly drops
 *     short laws is worse than one that occasionally shows a block page,
 *     because nobody can see what is missing.
 *
 * So this floor keeps doing the only job it was ever good at: rejecting an
 * empty or stub response. The block pages are caught by what they SAY.
 */
const MIN_DOCUMENT_CHARS = 200;

/**
 * Above this, length alone vouches for a document against the tier-two words.
 *
 * MEASURED, not guessed. The five newest executive orders, fetched live and put
 * through the same htmlToText/sanitise pipeline the sync uses:
 *
 *   EO 14420  7,842 chars   EO 14419  7,476   EO 14418  5,115
 *   EO 14417  7,067 chars   EO 14416  4,261
 *
 * The smallest real one is 4,261, so a threshold of 4,000 leaves almost no
 * margin: a slightly shorter order that happened to open with the word
 * "captcha" would be discarded. 3,000 keeps the corroboration meaningful — a
 * block page's visible text is a headline and a sentence — while leaving room
 * under the shortest thing actually observed.
 *
 * The asymmetry is deliberate. Storing a captcha as law is loud and now caught
 * by tier one and by the length floor; discarding a real law is SILENT, and
 * nobody ever sees what was thrown away.
 */
const LONG_ENOUGH_TO_VOUCH_FOR_ITSELF = 3_000;

export interface TextVerdict {
  ok: boolean;
  /** Why it was rejected. Logged, never shown to a reader. */
  reason?: "too_short" | "not_a_document";
  /** The phrase that gave it away, for the log. */
  matched?: string;
}

/**
 * Is this the document, or is it the door?
 *
 * Runs on the extracted, sanitised text — after htmlToText, before storage.
 */
export function judgeOfficialText(text: string | null | undefined): TextVerdict {
  if (!text) return { ok: false, reason: "too_short" };

  const trimmed = text.trim();
  if (trimmed.length < MIN_DOCUMENT_CHARS) return { ok: false, reason: "too_short" };

  // Only the opening is inspected. A block page says what it is immediately,
  // because that is its entire purpose; a law spends its opening on authority
  // and definitions.
  const opening = trimmed.slice(0, 1_500).toLowerCase();

  for (const phrase of NEVER_A_DOCUMENT) {
    if (opening.includes(phrase)) {
      return { ok: false, reason: "not_a_document", matched: phrase };
    }
  }

  // Tier two needs corroboration from length. See SUSPICIOUS_IF_SHORT.
  if (trimmed.length < LONG_ENOUGH_TO_VOUCH_FOR_ITSELF) {
    for (const phrase of SUSPICIOUS_IF_SHORT) {
      if (opening.includes(phrase)) {
        return { ok: false, reason: "not_a_document", matched: phrase };
      }
    }
  }

  return { ok: true };
}

/**
 * The verdict, as a boolean, with the rejection logged.
 *
 * `label` names the caller so a log line says which pipeline threw the text
 * away and for which record.
 */
export function acceptOfficialText(
  text: string | null | undefined,
  label: string,
): string | null {
  const verdict = judgeOfficialText(text);
  if (verdict.ok) return text!.trim();

  if (verdict.reason === "not_a_document") {
    console.error(
      `[${label}] REFUSED a source response that is not a document ` +
        `(matched "${verdict.matched}"). The source is most likely blocking us. ` +
        `Nothing was stored — the record keeps its honest empty state.`,
    );
  }
  return null;
}
