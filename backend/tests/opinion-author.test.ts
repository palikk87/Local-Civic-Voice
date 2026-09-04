/**
 * WHO WROTE IT, READ OUT OF THE OPINION THIS PLATFORM ALREADY HOLDS.
 *
 * Every excerpt below is VERBATIM from the stored text of a ruling on
 * production, including its line breaks and one missing space. Nothing here is
 * a plausible-looking imitation of how the Court writes, because the whole
 * value of this file is that the patterns match what the Court actually does.
 */
import { describe, expect, test } from "bun:test";

import { authorshipIn, justiceBySurname } from "../src/services/opinion-author";

/** Rodriguez v. United States, docket 13-9972, decided 2015-04-21. */
const RODRIGUEZ_SYLLABUS = `
  therefore remains open for consideration on remand. P. 9.
741 F. 3d 905, vacated and remanded.

  GINSBURG, J., delivered the opinion of the Court, in which ROBERTS,
C. J., and SCALIA, KENNEDY, BREYER, SOTOMAYOR, and KAGAN, JJ., joined.
`;

const RODRIGUEZ_OPINION = `
           APPEALS FOR THE EIGHTH CIRCUIT

                                 [April 21, 2015]


   JUSTICE GINSBURG delivered the opinion of the Court.
   In Illinois v. Caballes, 543 U. S. 405 (2005), this Court held
`;

/**
 * THE TRAP. Rodriguez cites three other cases that WERE per curiam. A search
 * for the phrase would file an opinion written by Justice Ginsburg as one the
 * Court issued unsigned.
 */
const RODRIGUEZ_CITATIONS = `
   In advancing its de minimis rule, the Eighth Circuit
relied heavily on our decision in Pennsylvania v. Mimms,
434 U. S. 106 (1977) (per curiam). See United States v.
$404,905.00 in United States Currency, 182 F. 3d 643.
`;

/** The same line as it survives further down the stored text — no space. */
const RODRIGUEZ_LEAD = `
Pennsylvania v. Mimms, 434 U. S. 106, 111 (1977) (per curiam).

## Lead

Justice GINSBURGdelivered the opinion of the Court.
 In Illinois v. Caballes
`;

/** Mullin v. Doe, docket 25-1083, decided 2026-06-25. */
const MULLIN_SYLLABUS = `
  tection claim. Pp. 20-24.
Reversed and remanded.

  ALITO, J., announced the judgment of the Court and delivered the
opinion of the Court with respect to Parts I and II.
`;

/** National Park Service v. National Trust, docket 26A203, per curiam. */
const NATIONAL_PARK_SERVICE = `
                        ON APPLICATION FOR STAY
                        [August 31, 2026]

   PER CURIAM.
   In October 2025 the National Park Service began
`;

/** Marbury v. Madison, as the 1803 report has it. */
const MARBURY = `## Opinion

Opinion of
 
 the court.
 
 At the last term on the affidavits then read and filed with the clerk,
`;

const BENCH_2015 = [
  { name: "John G. Roberts Jr.", isChief: true },
  { name: "Antonin Scalia", isChief: false },
  { name: "Anthony M. Kennedy", isChief: false },
  { name: "Clarence Thomas", isChief: false },
  { name: "Ruth Bader Ginsburg", isChief: false },
  { name: "Stephen G. Breyer", isChief: false },
  { name: "Samuel A. Alito Jr.", isChief: false },
  { name: "Sonia Sotomayor", isChief: false },
  { name: "Elena Kagan", isChief: false },
];

describe("what an opinion says about its own author", () => {
  test("the Reporter's syllabus line", () => {
    expect(authorshipIn(RODRIGUEZ_SYLLABUS)).toEqual({ kind: "justice", surname: "GINSBURG" });
  });

  test("the opinion's own opening line", () => {
    expect(authorshipIn(RODRIGUEZ_OPINION)).toEqual({ kind: "justice", surname: "GINSBURG" });
  });

  test("the same line with the space missing, exactly as it is stored", () => {
    expect(authorshipIn(RODRIGUEZ_LEAD)).toEqual({ kind: "justice", surname: "GINSBURG" });
  });

  test("announced the judgment counts as authorship too", () => {
    expect(authorshipIn(MULLIN_SYLLABUS)).toEqual({ kind: "justice", surname: "ALITO" });
  });

  test("PER CURIAM as a heading is the Court speaking as one body", () => {
    expect(authorshipIn(NATIONAL_PARK_SERVICE)).toEqual({ kind: "per_curiam" });
  });

  /*
   * THE ONE THAT MATTERS MOST. Rodriguez cites three per curiam decisions of
   * OTHER courts and other cases. Reading those as this opinion's authorship
   * would strip Justice Ginsburg's name off a ruling she wrote.
   */
  test("(per curiam) inside a citation is a fact about somebody else's case", () => {
    expect(authorshipIn(RODRIGUEZ_CITATIONS)).toEqual({ kind: "unknown" });
    // And in the full text, where both appear, the author still wins.
    expect(authorshipIn(RODRIGUEZ_LEAD)).toEqual({ kind: "justice", surname: "GINSBURG" });
  });

  /*
   * MARBURY STAYS EMPTY. Everyone knows Marshall wrote it. The 1803 report says
   * only "Opinion of the court", and this platform does not fill a gap with a
   * thing everybody knows.
   */
  test("an opinion that names nobody names nobody", () => {
    expect(authorshipIn(MARBURY)).toEqual({ kind: "unknown" });
    expect(authorshipIn("")).toEqual({ kind: "unknown" });
    expect(authorshipIn(null)).toEqual({ kind: "unknown" });
  });
});

describe("turning a surname into the justice who sat", () => {
  test("the surname resolves against that day's bench", () => {
    expect(justiceBySurname("GINSBURG", BENCH_2015)).toBe("Ruth Bader Ginsburg");
    expect(justiceBySurname("ALITO", BENCH_2015)).toBe("Samuel A. Alito Jr.");
    expect(justiceBySurname("ROBERTS", BENCH_2015)).toBe("John G. Roberts Jr.");
  });

  test("a justice who was not on that bench is nobody", () => {
    // Gorsuch was confirmed in 2017; a 2015 ruling cannot be his.
    expect(justiceBySurname("GORSUCH", BENCH_2015)).toBeNull();
  });

  /*
   * The Court has had two Harlans, two Marshalls and two Roberts. A wrong face
   * over a wrong name on a Supreme Court ruling is worse than an empty one.
   */
  test("a surname two justices share names neither", () => {
    const twoHarlans = [
      { name: "John Marshall Harlan", isChief: false },
      { name: "John Marshall Harlan II", isChief: false },
    ];
    expect(justiceBySurname("HARLAN", twoHarlans)).toBeNull();
  });

  test("THE CHIEF JUSTICE is whoever was Chief that day", () => {
    expect(justiceBySurname("THE CHIEF JUSTICE", BENCH_2015)).toBe("John G. Roberts Jr.");
    // And nobody, on a bench with no Chief recorded.
    expect(
      justiceBySurname("THE CHIEF JUSTICE", [{ name: "Elena Kagan", isChief: false }]),
    ).toBeNull();
  });
});
