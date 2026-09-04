/**
 * THE COURT'S OWN TABLE, READ THE WAY THIS PLATFORM READS IT.
 *
 * Both fixtures are real pages recorded from supremecourt.gov on 2026-09-04,
 * not imitations: the whole October Term 2025 table, and the single row for
 * City of Austin from October Term 2021. The parsing is the part that can be
 * wrong, and a test that needs supremecourt.gov to be up fails for reasons that
 * have nothing to do with this code.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EARLIEST_SLIP_TERM,
  fetchSlipOpinions,
  initialsFor,
  justiceFromInitials,
  parseSlipDate,
  parseSlipOpinions,
  slipOpinionUrl,
  termOf,
} from "../src/services/scotus-slip-opinions";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const term25 = fixture("scotus-slip-opinions-25.html");
const austin = fixture("scotus-slip-opinion-austin.html");

/** The bench that sat for all of October Term 2025, as the Court lists it. */
const BENCH = [
  "John G. Roberts, Jr.",
  "Clarence Thomas",
  "Samuel A. Alito, Jr.",
  "Sonia Sotomayor",
  "Elena Kagan",
  "Neil M. Gorsuch",
  "Brett M. Kavanaugh",
  "Amy Coney Barrett",
  "Ketanji Brown Jackson",
];

describe("reading the Court's slip opinion table", () => {
  test("every decided case in the term is found", () => {
    const opinions = parseSlipOpinions(term25);
    // The Court decides 58-65 a year; this term's page listed 70 rows when it
    // was recorded. An exact number pins the parse against silent drift.
    expect(opinions).toHaveLength(70);
  });

  test("the newest decision is read whole", () => {
    const [newest] = parseSlipOpinions(term25);

    expect(newest!.sequence).toBe(70);
    expect(newest!.docket).toBe("26A203");
    expect(newest!.caseName).toContain("National Park Service");
    expect(newest!.decidedDate.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(newest!.authorInitials).toBe("PC");
  });

  test("nothing but a decided case gets through", () => {
    // The page opens with a search widget whose markup is also a table row.
    // Every row this returns must carry a real docket and a real date.
    for (const opinion of parseSlipOpinions(term25)) {
      expect(opinion.docket).toMatch(/^\d{2}[A-Z]?[-\d]/);
      expect(Number.isNaN(opinion.decidedDate.getTime())).toBe(false);
      expect(opinion.caseName.length).toBeGreaterThan(3);
    }
  });

  test("the sequence runs from the newest decision down to the first", () => {
    const sequences = parseSlipOpinions(term25).map((o) => o.sequence);
    expect(sequences[0]).toBe(70);
    expect(sequences[sequences.length - 1]).toBe(1);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  /*
   * THE CASE THIS WHOLE FILE EXISTS FOR.
   *
   * We stored City of Austin as decided 2002-07-10. Its docket is 20-1029, and
   * a docket number begins with the term it was filed in — so a 2020-term case
   * cannot have been decided in 2002. The Court's own row settles it, and
   * carries the author we never had.
   */
  test("City of Austin's real date and author come straight off the Court's row", () => {
    const [ruling] = parseSlipOpinions(austin);

    expect(ruling!.docket).toBe("20-1029");
    expect(ruling!.decidedDate.toISOString().slice(0, 10)).toBe("2022-04-21");
    expect(ruling!.authorInitials).toBe("SS");
    expect(ruling!.citation).toBe("596 U.S. 61");
    expect(ruling!.caseName).toBe("City of Austin v. Reagan National Advertising of Austin, LLC");
    // The Court's own PDF, which is a better source link than anybody's copy.
    expect(ruling!.pdfUrl).toBe(
      "https://www.supremecourt.gov/opinions/21pdf/596us1r22_4315.pdf",
    );
  });

  /*
   * THE COURT GLUES ITS OWN HOUSEKEEPING ONTO A CASE NAME. Six of the 462 rows
   * across terms 18 to 25 do this, and a record built from one would be
   * titled "Trump v. Slaughter Revisions : 7/07/26" on every card it appears
   * on. Both of these are real rows from the recorded page.
   */
  test("a revision note is not part of the case's name", () => {
    const names = parseSlipOpinions(term25).map((o) => o.caseName);

    expect(names).toContain("Trump v. Slaughter");
    expect(names).toContain("Trump v. Barbara");
    for (const name of names) {
      expect(name).not.toMatch(/revisions?/i);
    }
  });

  test("a page this cannot read parses to nothing, so a caller can refuse it", () => {
    expect(parseSlipOpinions("<html><body><p>Not a table</p></body></html>")).toHaveLength(0);
    expect(parseSlipOpinions("")).toHaveLength(0);
  });
});

describe("dates and terms", () => {
  test("the Court's date format, at UTC midnight", () => {
    expect(parseSlipDate("4/21/22")!.toISOString()).toBe("2022-04-21T00:00:00.000Z");
    expect(parseSlipDate("12/9/25")!.toISOString()).toBe("2025-12-09T00:00:00.000Z");
  });

  test("anything that is not a date is not a date", () => {
    expect(parseSlipDate("")).toBeNull();
    expect(parseSlipDate("Date")).toBeNull();
    expect(parseSlipDate("2022-04-21")).toBeNull();
  });

  /*
   * A ruling handed down in August 2026 belongs to October Term 2025. Both of
   * the most recent rulings this platform holds are exactly that, and looking
   * for them under term 26 would find a page that does not list them.
   */
  test("the Court's year begins in October, not in January", () => {
    expect(termOf(new Date("2026-08-31T00:00:00Z"))).toBe(25);
    expect(termOf(new Date("2026-09-30T00:00:00Z"))).toBe(25);
    expect(termOf(new Date("2026-10-01T00:00:00Z"))).toBe(26);
    expect(termOf(new Date("2022-04-21T00:00:00Z"))).toBe(21);
  });

  test("the term page address, and how far back they really go", () => {
    expect(slipOpinionUrl(25)).toBe("https://www.supremecourt.gov/opinions/slipopinion/25");

    /*
     * 18, NOT 17, AND THE DIFFERENCE IS A TRAP.
     *
     * /slipopinion/17 answers HTTP 200 — and serves October Term 2025's table.
     * Its seventy rows are dated 8/31/26, 8/24/26, 6/30/26: this year's
     * decisions, offered under 2017's address. Trusting the status code there
     * would have dated nine years of records to the wrong year.
     *
     * Term 18 is the earliest that answers with its OWN decisions. Older
     * rulings — Marbury among them — keep whatever CourtListener gave them.
     */
    expect(EARLIEST_SLIP_TERM).toBe(18);
  });
});

describe("turning the Court's initials into a justice", () => {
  test("every set of initials in a full term resolves to exactly one person", () => {
    // PC, AB, NG, BK, R, EK, A, T, SS, KJ — the whole J. column for the term.
    const used = new Set(parseSlipOpinions(term25).map((o) => o.authorInitials));

    for (const initials of used) {
      if (initials === "PC") continue;
      expect(justiceFromInitials(initials, BENCH)).not.toBeNull();
    }
  });

  test("both forms the Court uses, first-and-last and last-only", () => {
    expect(justiceFromInitials("SS", BENCH)).toBe("Sonia Sotomayor");
    expect(justiceFromInitials("KJ", BENCH)).toBe("Ketanji Brown Jackson");
    expect(justiceFromInitials("AB", BENCH)).toBe("Amy Coney Barrett");
    // The Chief, and the two senior Associates, get a single letter.
    expect(justiceFromInitials("R", BENCH)).toBe("John G. Roberts, Jr.");
    expect(justiceFromInitials("T", BENCH)).toBe("Clarence Thomas");
    expect(justiceFromInitials("A", BENCH)).toBe("Samuel A. Alito, Jr.");
  });

  test("per curiam is nobody, and says so", () => {
    expect(justiceFromInitials("PC", BENCH)).toBeNull();
  });

  /*
   * THE RULE THAT MATTERS MORE THAN ANY OF THE ABOVE. A bare "K" fits both
   * Kagan and Kavanaugh. Attributing a Supreme Court ruling to the wrong
   * justice is worse than attributing it to nobody, so an ambiguous match is
   * no match. The Court does not currently print a bare K for either of them —
   * but a rule that only holds while the bench happens to have no collisions
   * is a rule that fails the first time somebody is confirmed.
   */
  test("initials that fit two justices name neither", () => {
    expect(justiceFromInitials("K", BENCH)).toBeNull();
  });

  test("initials that fit nobody on that bench name nobody", () => {
    expect(justiceFromInitials("ZZ", BENCH)).toBeNull();
    expect(justiceFromInitials("", BENCH)).toBeNull();
    // Ginsburg did not sit on this bench, so RBG resolves to no one here.
    expect(justiceFromInitials("RG", BENCH)).toBeNull();
  });

  test("a suffix is not part of a name", () => {
    expect(initialsFor("John G. Roberts, Jr.")).toContain("R");
    expect(initialsFor("Samuel A. Alito, Jr.")).toContain("A");
  });
});

/*
 * THE TRAP THAT A STATUS CODE CANNOT SEE.
 *
 * /slipopinion/17 answers HTTP 200 and serves October Term 2025's table —
 * seventy rows dated 2026, byte for byte what /slipopinion/25 returns. A fetch
 * that trusted the status would have read this year's decisions, believed they
 * were 2017's, and rewritten nine years of records to the wrong dates.
 */
describe("a page that answers 200 with somebody else's term", () => {
  const realFetch = globalThis.fetch;

  function serve(body: string, status = 200): void {
    globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch;
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("term 17 served the 2025 table, and is refused", async () => {
    serve(term25);
    expect(await fetchSlipOpinions(17)).toBeNull();
  });

  test("the same page under its own number is accepted", async () => {
    serve(term25);
    const opinions = await fetchSlipOpinions(25);
    expect(opinions).not.toBeNull();
    expect(opinions).toHaveLength(70);
  });

  test("a redirect is not a term", async () => {
    serve("", 302);
    expect(await fetchSlipOpinions(16)).toBeNull();
  });

  test("a page this cannot read is null, never an empty term", async () => {
    // The difference matters: null means "we could not find out", and a caller
    // must not read that as "the Court decided nothing".
    serve("<html><body>Redesigned</body></html>");
    expect(await fetchSlipOpinions(25)).toBeNull();
  });
});
