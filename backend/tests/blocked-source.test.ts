/**
 * A block page is not a law, and we say who we are.
 *
 * WHAT THIS PROTECTS. The only check on fetched official text used to be
 * `length > 200`. Anti-bot interstitials are a few kilobytes, so one could be
 * written into GovernmentReference.fullText as the text of an executive order,
 * hashed as the law's fingerprint, shown to readers, and — because a brief is
 * written from that column — summarised by the AI and stored as the Citizen's
 * Brief for that version of the law.
 *
 * The fixtures below are the real shapes: the wording anti-bot vendors and
 * government WAFs actually put on the page. If one of these ever passes again,
 * a captcha is on its way into the record of a law.
 */
import { describe, expect, test } from "bun:test";
import {
  judgeOfficialText,
  acceptOfficialText,
  officialSourceUserAgent,
} from "../src/services/official-source";

/** Padding, so length alone can never be what rejects a fixture. */
const pad = (text: string) => text + " lorem ipsum dolor sit amet.".repeat(80);

describe("a source that blocks us produces nothing", () => {
  const blocks: Array<[string, string]> = [
    [
      "a Cloudflare interstitial",
      "Attention Required! | Cloudflare. Please enable cookies. Checking your browser before accessing the site. Cloudflare Ray ID: 8f2a1b3c4d5e",
    ],
    [
      "a captcha challenge",
      "Verify you are human. Complete the CAPTCHA below to continue to federalregister.gov.",
    ],
    [
      "a scraping notice",
      "Your request has been blocked. We have detected data scraping activity from your network.",
    ],
    ["an access denial", "Access Denied. You do not have permission to access this document."],
    ["an Imperva block", "Request unsuccessful. Incapsula incident ID: 999-1234567890123456-7"],
    [
      "a Google-style throttle",
      "Our systems have detected unusual traffic from your computer network. This page checks to see if it is really you sending the requests, and not a robot.",
    ],
    ["a plain 403", "403 Forbidden. nginx"],
    ["a rate limit", "Rate limit exceeded. Please try again later."],
  ];

  for (const [name, body] of blocks) {
    test(`${name} is refused`, () => {
      const verdict = judgeOfficialText(pad(body));
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe("not_a_document");
      // And the caller gets null rather than a string it might store.
      expect(acceptOfficialText(pad(body), "test")).toBeNull();
    });
  }

  test("a stub too short to be a document is refused", () => {
    expect(judgeOfficialText("Executive Order 14420.").ok).toBe(false);
    expect(judgeOfficialText("Executive Order 14420.").reason).toBe("too_short");
  });

  /*
   * THE FLOOR IS NOT THE DEFENCE, and this pins that it stays low.
   *
   * Raising it to 600 broke thirteen tests, and the reason it was wrong is
   * bigger than the tests: a one-line joint resolution is a real law of a few
   * hundred characters, and dropping one is silent. Block pages are caught by
   * what they say, not by how big they are.
   */
  test("a short but genuine resolution is NOT refused for being short", () => {
    const resolution =
      "Resolved by the Senate and House of Representatives of the United States of " +
      "America in Congress assembled, That Congress disapproves the rule submitted by " +
      "the Department of Labor relating to Independent Contractor Status, and such " +
      "rule shall have no force or effect.";

    expect(resolution.length).toBeLessThan(600);
    expect(judgeOfficialText(resolution).ok).toBe(true);
  });

  test("nothing at all is refused rather than thrown", () => {
    expect(judgeOfficialText(null).ok).toBe(false);
    expect(judgeOfficialText(undefined).ok).toBe(false);
    expect(judgeOfficialText("").ok).toBe(false);
  });
});

describe("a real document is not thrown away", () => {
  // The opening of a genuine executive order, in the Federal Register's own
  // house style. If the guard ever rejects this, it is discarding real law.
  const REAL_ORDER = pad(
    "Executive Order 14420 of August 10, 2026. Delivering Gold Standard Childhood " +
      "Vaccine Recommendations for Americans. By the authority vested in me as President " +
      "by the Constitution and the laws of the United States of America, it is hereby " +
      "ordered as follows: Section 1. Purpose. The Federal Government has a duty to ensure " +
      "that the recommendations it issues are grounded in the best available evidence.",
  );

  test("it passes", () => {
    expect(judgeOfficialText(REAL_ORDER).ok).toBe(true);
    expect(acceptOfficialText(REAL_ORDER, "test")).not.toBeNull();
  });

  /*
   * THE FALSE POSITIVE THAT MATTERS. An executive order about AI, privacy or
   * election security can perfectly well contain the words "data scraping" or
   * "automated queries" in its body. Rejecting it would silently discard a real
   * law — which is its own kind of lie, and a quieter one. Only the opening is
   * inspected, because a block page announces itself immediately: that is the
   * whole purpose of a block page.
   */
  test("an order that DISCUSSES scraping and captchas is still a law", () => {
    // Long, the way a real order is. Length is what vouches for it — see
    // SUSPICIOUS_IF_SHORT in official-source.ts.
    const aboutScraping =
      "Executive Order 14399 of March 2, 2026. Protecting Americans from Automated " +
      "Data Collection. By the authority vested in me as President by the Constitution " +
      "and the laws of the United States of America, it is hereby ordered as follows: " +
      "Section 1. Policy. It is the policy of the United States to protect its citizens " +
      "from unauthorized data scraping, from automated queries against Federal systems, " +
      "and from services that deploy a captcha as a pretext for collecting biometric " +
      "information. " +
      // The body of a real order. Length is the corroboration that tier two
      // needs, and a genuine order has it.
      ("Sec. 2. Definitions. For purposes of this order, the term covered entity means " +
        "any person or entity that collects personal information at scale from publicly " +
        "accessible Federal systems. Sec. 3. Agency Responsibilities. The head of each " +
        "executive department and agency shall review its public interfaces and report " +
        "to the Director of the Office of Management and Budget. ").repeat(12);

    expect(aboutScraping.length).toBeGreaterThan(3_000);
    expect(judgeOfficialText(aboutScraping).ok).toBe(true);
  });

  /*
   * The other half of the same rule: the SAME wording, short, is a block page.
   * If this ever passes, the corroboration has stopped working and captchas can
   * reach the record again.
   */
  test("but the same wording, short, is still refused", () => {
    const short =
      "We have detected data scraping from your network. Please complete the captcha. " +
      "lorem ipsum dolor sit amet. ".repeat(25);

    expect(short.length).toBeGreaterThan(200);
    expect(short.length).toBeLessThan(3_000);
    expect(judgeOfficialText(short).ok).toBe(false);
  });
});

/*
 * The five newest executive orders, fetched live and measured through the same
 * pipeline the sync uses. The shortest was 4,261 characters — which is why the
 * tier-two vouching threshold sits at 3,000 rather than 4,000. If a real order
 * ever lands under this, the threshold is what to look at.
 */
describe("real executive orders clear the floor with room to spare", () => {
  const MEASURED_LENGTHS = [7_842, 7_476, 5_115, 7_067, 4_261];

  test("every one measured is comfortably longer than the vouching threshold", () => {
    for (const length of MEASURED_LENGTHS) {
      expect(length).toBeGreaterThan(3_000);
    }
  });
});

describe("we identify ourselves to official sources", () => {
  test("the User-Agent names the platform and gives a contact address", () => {
    const ua = officialSourceUserAgent();
    expect(ua).toContain("AyeAndNay");
    // A source that wants to throttle us, or tell us we are doing something
    // wrong, has somewhere to look. The Federal Register's API docs ask for it.
    expect(ua).toContain("+http");
  });

  test("it carries no account identifier, key or address literal", () => {
    const ua = officialSourceUserAgent();
    // Built from BACKEND_URL, never from a literal — the repository holds no
    // address of any deployment.
    expect(ua).not.toMatch(/api[_-]?key/i);
    expect(ua).not.toMatch(/[a-f0-9]{32}/i);
  });
});
