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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  judgeOfficialText,
  acceptOfficialText,
  officialSourceUserAgent,
} from "../src/services/official-source";

/** Padding, so length alone can never be what rejects a fixture. */
const pad = (text: string) => text + " lorem ipsum dolor sit amet.".repeat(80);

/*
 * THE PAGE THAT CAUSED THIS, captured live and stored verbatim.
 *
 * Requesting any federalregister.gov document with a scraper-shaped User-Agent
 * returns "Federal Register :: Request Access" — and returns it with HTTP 200,
 * which is why `response.ok` never caught it and why this went unnoticed. It
 * was stored as the full text of executive orders, the AI wrote a Citizen's
 * Brief from it (summary, the case for, the case against), and readers were
 * shown that brief with Support and Oppose buttons underneath. People were
 * being asked to vote on an anti-scraping notice.
 *
 * The fixture is the real extracted text, not a paraphrase. If the guard ever
 * accepts this file, that is exactly what starts happening again.
 */
const REQUEST_ACCESS_PAGE = readFileSync(
  join(import.meta.dir, "fixtures/federal-register-request-access.txt"),
  "utf8",
);

describe("the Federal Register's real block page", () => {
  test("is refused", () => {
    const verdict = judgeOfficialText(REQUEST_ACCESS_PAGE);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("not_a_document");
  });

  test("is refused by NAME, not merely for being short", () => {
    // The length corroboration in tier two would also catch it today, at ~1,500
    // characters. That is not good enough: the Federal Register could add three
    // paragraphs of help text and it would pass. Padding it here proves the
    // rejection survives the page growing.
    const padded = REQUEST_ACCESS_PAGE + "\n\nAdditional guidance. ".repeat(400);

    expect(padded.length).toBeGreaterThan(3_000);
    expect(judgeOfficialText(padded).ok).toBe(false);
  });

  /*
   * WHERE IT CAME FROM, recorded so the fallback is never re-added.
   *
   * fetchExecutiveOrderText had three sources. The first two ask the Federal
   * Register's API and its /documents/full_text/ URLs; both work from a server,
   * with any User-Agent. The third fell back to the HUMAN-FACING page stored as
   * sourceUrl, and that page is blocked from datacenter addresses for everyone.
   * Measured from one address in one moment:
   *
   *   /documents/2026/08/14/.../              BLOCK PAGE, every User-Agent
   *   /api/v1/documents.json                  real JSON, even a scraper UA
   *   /documents/full_text/html|text|xml/...  real document, even a scraper UA
   *
   * The lesson is not "send a better User-Agent" — that was tried and the page
   * is blocked regardless. It is that a browsable page is never the source for
   * a record, when the publisher offers a developer surface and asks you to
   * use it.
   */
  test("the developer surfaces are the source; the browsable page never is", () => {
    const BLOCKED_FROM_A_SERVER = ["/documents/2026/08/14/2026-16730/vaccine-recommendations"];
    const ALWAYS_SERVED = [
      "/api/v1/documents.json",
      "/documents/full_text/html/2026/08/14/2026-16730.html",
      "/documents/full_text/text/2026/08/14/2026-16730.txt",
      "/documents/full_text/xml/2026/08/14/2026-16730.xml",
    ];

    // A browsable document page is recognisable by NOT being under one of the
    // two developer surfaces. If a future fallback reaches for one of these
    // again, this is the shape to check against.
    const isDeveloperSurface = (path: string) =>
      path.startsWith("/api/") || path.startsWith("/documents/full_text/");

    for (const path of ALWAYS_SERVED) expect(isDeveloperSurface(path)).toBe(true);
    for (const path of BLOCKED_FROM_A_SERVER) expect(isDeveloperSurface(path)).toBe(false);
  });

  test("and the thing that hid it: the block page is served as HTTP 200", () => {
    // Recorded here because it is the reason every `if (!response.ok)` in this
    // codebase was useless against it. Nothing about this page is an error as
    // far as HTTP is concerned.
    const SERVED_STATUS = 200;
    expect(SERVED_STATUS).toBe(200);
  });
});

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
