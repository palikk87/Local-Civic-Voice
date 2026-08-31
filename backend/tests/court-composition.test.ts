/**
 * WHO WAS ON THE COURT THAT DAY.
 *
 * A per curiam ruling has no author — it is the Supreme Court speaking as one
 * body — so the only way to say who is answerable for it is to name the bench
 * on the day it came down. Getting that wrong puts a justice on a ruling they
 * were never there for, which is worse than showing nobody.
 *
 * So this checks the answer against Courts whose membership is a matter of
 * public record, using the real page from supremecourt.gov recorded in
 * tests/fixtures/scotus-justices.html. No network: the parsing is the part
 * that can be wrong, and a test that needs the Court's website to be up is a
 * test that fails for reasons that have nothing to do with this code.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  courtOn,
  displayName,
  parseCourtDate,
  parseJusticeRoster,
  dissentersIn,
  isDissenter,
} from "../src/services/court-composition";

const html = readFileSync(
  new URL("./fixtures/scotus-justices.html", import.meta.url).pathname,
  "utf8",
);
const roster = parseJusticeRoster(html);

const on = (iso: string) => courtOn(new Date(`${iso}T00:00:00Z`), roster).map((j) => j.name);

describe("the Court's own table is read completely", () => {
  test("every justice who has ever served is found", () => {
    // 121 spans of service across 116 people — five were elevated from
    // Associate to Chief and appear once per office.
    expect(roster.length).toBeGreaterThanOrEqual(120);
  });

  test("NOT ONE DATE IS DROPPED", () => {
    // This is the assertion that matters. The table is not uniformly
    // punctuated — "December 10 1877" with no comma, "June 5,1916" with no
    // space, "(a) October 19, 1789" with a footnote, "September 26, 1986*"
    // where the asterisk marks a promotion. Parsing on an exact format drops
    // those people silently, and a dropped justice is a Court that is wrong.
    expect(roster.every((j) => j.startDate instanceof Date)).toBe(true);
    expect(roster.some((j) => j.startDate.getUTCFullYear() === 1789)).toBe(true);
  });

  test("the nine sitting justices have no end date", () => {
    const sitting = roster.filter((j) => j.endDate === null);
    expect(sitting).toHaveLength(9);
    // Null, not today's date — otherwise tomorrow's rulings would show a Court
    // that has already left the bench.
    expect(sitting.map((j) => j.name)).toContain("Ketanji Brown Jackson");
  });
});

describe("a name reads as a person's name", () => {
  test("the surname-first listing is turned around", () => {
    expect(displayName("Thomas, Clarence")).toBe("Clarence Thomas");
  });

  test("a suffix travels to the end rather than sitting in the middle", () => {
    // "John G., Jr. Roberts" is nobody.
    expect(displayName("Roberts, John G., Jr.")).toBe("John G. Roberts Jr.");
    expect(displayName("Alito, Samuel A., Jr.")).toBe("Samuel A. Alito Jr.");
  });
});

describe("the dates the Court's table actually contains", () => {
  test("a footnote marker does not defeat it", () => {
    expect(parseCourtDate("(a) October 19, 1789")?.toISOString()).toStartWith("1789-10-19");
  });

  test("neither does a missing comma, a missing space, or a promotion asterisk", () => {
    expect(parseCourtDate("December 10 1877")?.toISOString()).toStartWith("1877-12-10");
    expect(parseCourtDate("June 5,1916")?.toISOString()).toStartWith("1916-06-05");
    expect(parseCourtDate("September 26, 1986*")?.toISOString()).toStartWith("1986-09-26");
  });

  test("a justice still serving has no end date, not a guessed one", () => {
    expect(parseCourtDate("")).toBeNull();
  });
});

describe("the bench on a day we can check", () => {
  test("THE PENTAGON PAPERS COURT — the case this feature exists for", () => {
    // New York Times Co. v. United States, 30 June 1971. Itself a per curiam:
    // no author, nine people answerable.
    expect(on("1971-06-30")).toEqual([
      "Warren Earl Burger",
      "Hugo Lafayette Black",
      "William Orville Douglas",
      "John Marshall Harlan",
      "William J. Brennan Jr.",
      "Potter Stewart",
      "Byron Raymond White",
      "Thurgood Marshall",
      "Harry A. Blackmun",
    ]);
  });

  test("A VACANT SEAT IS EIGHT, NOT NINE", () => {
    // Scalia had died in February 2016 and Gorsuch was not confirmed until
    // April 2017. A hardcoded bench of nine would have invented a justice and
    // put a stranger's face on every ruling of that year.
    const bench = on("2016-06-01");
    expect(bench).toHaveLength(8);
    expect(bench).not.toContain("Antonin Scalia");
    expect(bench).toContain("John G. Roberts Jr.");
  });

  test("a Court from ninety years ago", () => {
    expect(on("1937-01-01")).toEqual([
      "Charles Evans Hughes",
      "Willis Van Devanter",
      "James Clark McReynolds",
      "Louis Dembitz Brandeis",
      "George Sutherland",
      "Pierce Butler",
      "Harlan Fiske Stone",
      "Owen Josephus Roberts",
      "Benjamin Nathan Cardozo",
    ]);
  });

  test("NOBODY IS LISTED TWICE, however many offices they held", () => {
    // Rehnquist, White, Stone and Hughes each appear twice in the Court's
    // table — once as Associate, once as Chief. Both spans are real service,
    // and on a day inside both a naive filter shows the same person twice.
    for (const day of ["1987-01-01", "1943-01-01", "1932-01-01", "2000-01-01"]) {
      const bench = on(day);
      expect(new Set(bench).size).toBe(bench.length);
      expect(bench.length).toBeLessThanOrEqual(9);
    }
  });

  test("a day before the Court existed has nobody on it", () => {
    expect(on("1700-01-01")).toEqual([]);
  });
});

describe("who dissented comes out of the majority", () => {
  test("a dissent's author and everyone who joined it are counted", () => {
    // CourtListener stores one decision as a cluster of sub-opinions, each
    // typed. Only the dissents matter here.
    expect(
      dissentersIn([
        { type: "010combined", author_str: "Per Curiam" },
        { type: "040dissent", author_str: "Black", joined_by_str: "Douglas, Brennan" },
      ]).sort(),
    ).toEqual(["Black", "Brennan", "Douglas"]);
  });

  test("A CONCURRENCE IS NOT A DISSENT", () => {
    // A justice who concurs agreed with the outcome. Counting them as a
    // dissenter would drop somebody out of a majority they were in.
    expect(dissentersIn([{ type: "030concurrence", author_str: "Stewart" }])).toEqual([]);
  });

  test("no separate opinions means nobody is subtracted", () => {
    expect(dissentersIn([{ type: "010combined", author_str: "Per Curiam" }])).toEqual([]);
    expect(dissentersIn([])).toEqual([]);
  });

  test("a surname is matched as a whole word, never as a substring", () => {
    // THE TRAP. "Marshall" appears inside "John Marshall Harlan". A substring
    // test would drop Harlan from a majority he was in, on a dissent written by
    // Thurgood Marshall — putting a false claim on the page about a real person.
    expect(isDissenter("Thurgood Marshall", ["Marshall"])).toBe(true);
    expect(isDissenter("John Marshall Harlan", ["Marshall"])).toBe(false);
  });

  test("a suffix does not hide the surname", () => {
    expect(isDissenter("William J. Brennan Jr.", ["Brennan"])).toBe(true);
    expect(isDissenter("John G. Roberts Jr.", ["Brennan"])).toBe(false);
  });

  test("an empty dissent list leaves the whole bench standing", () => {
    expect(isDissenter("Hugo Lafayette Black", [])).toBe(false);
  });
});
