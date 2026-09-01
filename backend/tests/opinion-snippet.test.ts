/**
 * A Supreme Court ruling says what it is about, not what a slip opinion is.
 *
 * WHY THIS EXISTS. Every one of the seventeen Supreme Court records on this
 * platform carried the same description, because CourtListener's snippet is the
 * opening characters of the opinion document and those characters are the
 * Reporter of Decisions' standard notice — identical on every ruling the Court
 * publishes. It was on their pages, in their share previews, and in the search
 * results Google had just started collecting.
 *
 * THE FIXTURES ARE THE REAL THING, taken from production rather than typed here,
 * so this tests the text the Court actually publishes and not a tidied-up idea
 * of it:
 *
 *   scotus-descriptions.json — the seventeen broken descriptions, as served.
 *                              The bug, recorded, so it cannot come back unseen.
 *   scotus-opinions.json     — the opening 9,000 characters of each opinion's
 *                              real text, which is where the summary lives.
 *                              Only the head is kept: the extractor never reads
 *                              past the caption, and the full documents run to
 *                              396,000 characters.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cleanOpinionSnippet,
  deriveOpinionDescription,
  isReporterNotice,
} from "../src/services/opinion-snippet";

const fixture = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"));

const SERVED: Array<{ slug: string; description: string | null }> =
  fixture("scotus-descriptions.json");
const OPINIONS: Array<{ slug: string; title: string; fullTextHead: string }> =
  fixture("scotus-opinions.json");

/** Anything that belongs to the printing of an opinion rather than to the case. */
const FURNITURE = [
  "Detroit Timber",
  "Slip Opinion",
  "Reporter of Decisions",
  "SUPREME COURT OF THE UNITED STATES",
  "CERTIORARI",
];

describe("the bug, as production served it", () => {
  test("EVERY SUPREME COURT PAGE SAID THE SAME THING", () => {
    const notices = SERVED.filter((row) => isReporterNotice(row.description));
    expect(notices.length).toBeGreaterThan(0);
    // Whatever the case, the first words are identical. That is the whole
    // problem: seventeen pages that read alike.
    expect(new Set(notices.map((row) => row.description!.slice(0, 60))).size).toBe(1);
  });

  test("the snippet is cut off INSIDE the notice, so there is nothing behind it", () => {
    const notice = SERVED.find((row) => isReporterNotice(row.description))!.description!;
    // CourtListener truncates at ~370 characters. The citation that closes the
    // notice is never reached — which is why cleaning the snippet cannot work
    // and the description has to come from the opinion text instead.
    expect(notice).toContain("See United States v. Detroit");
    expect(notice).not.toContain("Lumber Co.");
  });
});

describe("the summary, pulled out of the opinion", () => {
  test("EVERY ONE OF THE SEVENTEEN NOW SAYS SOMETHING", () => {
    for (const opinion of OPINIONS) {
      const derived = deriveOpinionDescription(opinion.fullTextHead);
      expect(derived, `no description derived for ${opinion.slug}`).toBeDefined();
      expect(derived!.length).toBeGreaterThan(120);
    }
  });

  test("…AND NO TWO OF THEM READ ALIKE", () => {
    const derived = OPINIONS.map((o) => deriveOpinionDescription(o.fullTextHead)!);
    expect(new Set(derived.map((d) => d.slice(0, 60))).size).toBe(derived.length);
  });

  test("none of them still carries the printer's furniture", () => {
    for (const opinion of OPINIONS) {
      const derived = deriveOpinionDescription(opinion.fullTextHead)!;
      for (const junk of FURNITURE) {
        expect(derived, `${opinion.slug} still carries "${junk}"`).not.toContain(junk);
      }
      // A description that starts mid-sentence means the caption was cut in the
      // wrong place. Every one of these should open on a capital or a quote.
      expect(derived, `${opinion.slug} starts mid-sentence`).toMatch(/^[“"A-Z]/);
    }
  });

  test("it reads like the case — three of them, by name", () => {
    const of = (slug: string) =>
      deriveOpinionDescription(OPINIONS.find((o) => o.slug === slug)!.fullTextHead)!;

    // A slip opinion with a syllabus: thirteen of the seventeen.
    expect(of("monsanto-v-durnell")).toContain("Roundup");
    // A per curiam, which has no syllabus at all.
    expect(of("trump-v-california")).toContain("Executive Order");
    // An 1803 opinion that simply starts, with no modern apparatus.
    expect(of("marbury-v-madison")).toContain("mandamus");
  });

  test("words broken across a column are put back together", () => {
    // The opinions are typeset PDFs: "glypho-\nsate" is one word split by the
    // page, not a hyphenated compound.
    const monsanto = deriveOpinionDescription(
      OPINIONS.find((o) => o.slug === "monsanto-v-durnell")!.fullTextHead,
    )!;
    expect(monsanto).toContain("glyphosate");
    expect(monsanto).not.toContain("glypho- sate");
  });

  test("the bound reporter's page numbers come out of the sentence", () => {
    // Marbury carries star pagination: "…why a mandamus *154 should not
    // issue…". That is the page number of the printed volume, dropped mid
    // sentence, and it reads as a typo to anybody who does not know the
    // convention.
    const marbury = deriveOpinionDescription(
      OPINIONS.find((o) => o.slug === "marbury-v-madison")!.fullTextHead,
    )!;
    expect(marbury).toContain("why a mandamus should not issue");
    expect(marbury).not.toContain("*154");
  });

  test("it ends on a sentence rather than mid-word", () => {
    for (const opinion of OPINIONS) {
      const derived = deriveOpinionDescription(opinion.fullTextHead)!;
      expect(derived.length).toBeLessThanOrEqual(500);
      expect(derived, `${opinion.slug} ends mid-word`).toMatch(/[.?!”"…]$/);
    }
  });

  test("a ruling with no decision date printed still finds its summary", () => {
    // The fourth shape, which none of the seventeen happen to be: a slip
    // opinion issued without argument, so the caption carries no "Decided"
    // line. The second "Syllabus" heading is then what sits above the summary —
    // the first one is over the notice, and stopping there would leave the
    // whole caption in the description.
    const noDate =
      "(Slip Opinion) OCTOBER TERM, 2025 1 Syllabus NOTE: Where it is feasible, a syllabus " +
      "(headnote) will be released. See United States v. Detroit Timber & Lumber Co., 200 U. S. " +
      "321, 337. SUPREME COURT OF THE UNITED STATES Syllabus ACME CO. v. ROE ON APPLICATION FOR " +
      "STAY No. 25A100 Syllabus The applicant asks the Court to stay a District Court order " +
      "requiring it to disclose the contents of a sealed report while its appeal is pending.";
    const derived = deriveOpinionDescription(noDate)!;
    expect(derived).toStartWith("The applicant asks the Court");
    expect(derived).not.toContain("ACME CO. v. ROE");
  });

  test("nothing in, nothing out", () => {
    expect(deriveOpinionDescription(null)).toBeUndefined();
    expect(deriveOpinionDescription("")).toBeUndefined();
    expect(deriveOpinionDescription("   ")).toBeUndefined();
    // Too little to be a summary of anything.
    expect(deriveOpinionDescription("The judgment is affirmed.")).toBeUndefined();
  });
});

describe("the guard on the ingest path", () => {
  test("EVERY SERVED DESCRIPTION IS REFUSED — none of them said anything", () => {
    // A ruling is created the moment CourtListener lists it, before its text is
    // fetched. Until then the snippet is all there is, and every one of these
    // seventeen is page furniture: the notice, a caption, or a restatement of
    // the case name. Storing nothing is the finished behaviour.
    for (const row of SERVED) {
      expect(cleanOpinionSnippet(row.description), `${row.slug} was kept`).toBeUndefined();
    }
  });

  test("a snippet that actually says something is kept, unchanged", () => {
    const real =
      "Petitioner sued under the Federal Tort Claims Act after federal agents raided the wrong " +
      "address and damaged his property. The Eleventh Circuit held the claims barred by the " +
      "discretionary-function exception.";
    expect(cleanOpinionSnippet(real)).toBe(real);
  });

  test("nothing in, nothing out", () => {
    expect(cleanOpinionSnippet(null)).toBeUndefined();
    expect(cleanOpinionSnippet("")).toBeUndefined();
    expect(cleanOpinionSnippet("   ")).toBeUndefined();
  });
});
