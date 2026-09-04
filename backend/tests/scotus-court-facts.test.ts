/**
 * THE TWO IMPOSSIBLE DATES, CORRECTED BY THE COURT ITSELF.
 *
 * This platform published City of Austin v. Reagan National Advertising as
 * decided on 2002-07-10. Its docket is 20-1029, and a docket number begins with
 * the term the case was filed in — so a case filed in the 2020 term was shown
 * as having been decided eighteen years before it was filed. Fuld v. PLO,
 * docket 24-20, was shown as decided in 2013.
 *
 * Both came from CourtListener holding several clusters for one case and the
 * record taking whichever it was handed. The Court publishes one row per
 * decision, so there is nothing to pick wrongly. The Austin row here is the
 * real one, recorded from supremecourt.gov.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prisma, resetData, startServer, stopServer } from "./helpers/server";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const austin = fixture("scotus-slip-opinion-austin.html");
const term25 = fixture("scotus-slip-opinions-25.html");

let fillFactsFromTheCourt: typeof import("../src/services/scotus-court-facts").fillFactsFromTheCourt;

const realFetch = globalThis.fetch;

/** Serve the Court's real pages for the terms we hold fixtures for. */
function stubTheCourt({ everythingFails = false } = {}): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("supremecourt.gov/opinions/slipopinion/")) {
      if (everythingFails) return new Response("", { status: 503 });
      const term = url.slice(url.lastIndexOf("/") + 1);
      if (term === "21") return new Response(austin, { status: 200 });
      if (term === "25") return new Response(term25, { status: 200 });
      // Every other term redirects, exactly as the Court's site does for a term
      // it no longer publishes.
      return new Response("", { status: 302 });
    }

    // NOTHING ELSE MAY BE ASKED. This corrects from the Court and only the
    // Court; a request to CourtListener here would mean the wrong source crept
    // back in, and the test should say so rather than quietly pass.
    throw new Error(`the correction pass asked something other than the Court: ${url}`);
  }) as unknown as typeof fetch;
}

/** The bench on the day City of Austin came down. */
async function seatTheCourt(): Promise<void> {
  const sworn = new Date("2005-09-29T00:00:00.000Z");
  const justices = [
    { name: "John G. Roberts Jr.", isChief: true },
    { name: "Clarence Thomas", isChief: false },
    { name: "Samuel A. Alito Jr.", isChief: false },
    { name: "Sonia Sotomayor", isChief: false },
    { name: "Elena Kagan", isChief: false },
    { name: "Neil M. Gorsuch", isChief: false },
    { name: "Brett M. Kavanaugh", isChief: false },
    { name: "Amy Coney Barrett", isChief: false },
  ];
  for (const justice of justices) {
    await prisma.justice.create({
      data: { name: justice.name, startDate: sworn, endDate: null, isChief: justice.isChief },
    });
  }
}

async function storeRuling(input: {
  masterReferenceId: string;
  title: string;
  decidedDate: Date | null;
  sponsorName?: string | null;
  fullText?: string | null;
}): Promise<string> {
  const row = await prisma.governmentReference.create({
    data: {
      masterReferenceId: input.masterReferenceId,
      referenceType: "scotus_case",
      title: input.title,
      status: "decided",
      decidedDate: input.decidedDate,
      sponsorName: input.sponsorName ?? null,
      fullText: input.fullText ?? null,
      sourceUrl: "https://www.courtlistener.com/opinion/1/x/",
    },
  });
  return row.id;
}

beforeAll(async () => {
  await startServer();
  // Imported here rather than at the top: src/prisma builds its client at
  // import time, and it has to be built after startServer has set DATABASE_URL.
  ({ fillFactsFromTheCourt } = await import("../src/services/scotus-court-facts"));
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  await prisma.justice.deleteMany();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const NOW = new Date("2026-09-04T00:00:00.000Z");

describe("the Court corrects its own record", () => {
  test("an impossible date is replaced by the one the Court gives", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin v. Reagan National Advertising of Austin, LLC",
      decidedDate: new Date("2002-07-10T00:00:00.000Z"),
    });

    stubTheCourt();
    const result = await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.decidedDate!.toISOString().slice(0, 10)).toBe("2022-04-21");
    expect(result.corrected).toHaveLength(1);
    expect(result.corrected[0]!.changes.join(" ")).toContain("2002-07-10 -> 2022-04-21");
  });

  test("the author arrives with it, from the J. column", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2002-07-10T00:00:00.000Z"),
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    // "SS" against the bench that sat that day, not against a hardcoded table.
    expect(after!.sponsorName).toBe("Sonia Sotomayor");
  });

  test("a per curiam is recorded as one, not left looking like a gap", async () => {
    await seatTheCourt();
    // National Park Service v. National Trust — "PC" in the Court's own column.
    const id = await storeRuling({
      masterReferenceId: "26a203",
      title: "National Park Service v. National Trust for Historic Preservation",
      decidedDate: null,
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.sponsorName).toBe("Per Curiam");
    expect(after!.decidedDate!.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  test("everything on the Court's table is binding, published law", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2022-04-21T00:00:00.000Z"),
      sponsorName: "Sonia Sotomayor",
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.precedentialStatus).toBe("Published");
  });

  test("a record that already agrees is left alone", async () => {
    await seatTheCourt();
    await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2022-04-21T00:00:00.000Z"),
      sponsorName: "Sonia Sotomayor",
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);
    // Second pass: the status was written by the first, so there is nothing
    // left to change and this must be a no-op.
    const again = await fillFactsFromTheCourt(NOW);

    expect(again.corrected).toHaveLength(0);
  });

  /*
   * MARBURY IS NOT ON A SLIP OPINION TABLE AND NEVER WILL BE. The Court's
   * tables begin at October Term 2018. A ruling older than that is not a
   * failure and must not be counted as one, or every run would look broken.
   */
  test("a ruling older than the tables is counted, not corrected", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "5-137",
      title: "Marbury v. Madison",
      decidedDate: new Date("1803-02-24T00:00:00.000Z"),
    });

    stubTheCourt();
    const result = await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.decidedDate!.toISOString().slice(0, 10)).toBe("1803-02-24");
    expect(result.notListed).toBe(1);
    expect(result.corrected).toHaveLength(0);
  });

  /*
   * THE RULE THE PURGE LEARNED THE HARD WAY. A source that cannot be reached
   * and a source that says the record is fine must never land on the same
   * branch. If no term page can be read, nothing is corrected — a network
   * problem must not be able to rewrite the Supreme Court's history.
   */
  test("no page readable means nothing written", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2002-07-10T00:00:00.000Z"),
    });

    stubTheCourt({ everythingFails: true });
    const result = await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.decidedDate!.toISOString().slice(0, 10)).toBe("2002-07-10");
    expect(result.termsRead).toBe(0);
    expect(result.corrected).toHaveLength(0);
    expect(result.termsUnreadable.length).toBeGreaterThan(0);
  });

  test("initials nobody on that bench answers to name nobody", async () => {
    // No justices seated at all: "SS" cannot resolve, so the date is corrected
    // and the author is left honestly empty rather than guessed at.
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2002-07-10T00:00:00.000Z"),
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.decidedDate!.toISOString().slice(0, 10)).toBe("2022-04-21");
    expect(after!.sponsorName).toBeNull();
  });
});

/*
 * A RULING THE COURT'S TABLES CANNOT REACH STILL SAYS WHO WROTE IT.
 *
 * The slip opinion tables begin at October Term 2018. Rodriguez v. United
 * States was decided in April 2015 and is on none of them — but the opinion
 * this platform already holds opens with the Court's own sentence. The excerpt
 * below is verbatim from the stored text on production, missing space and all.
 */
describe("older rulings, read out of their own opinions", () => {
  const RODRIGUEZ = `
           APPEALS FOR THE EIGHTH CIRCUIT

                                 [April 21, 2015]


   JUSTICE GINSBURG delivered the opinion of the Court.
   In advancing its de minimis rule, the Eighth Circuit relied heavily
on Pennsylvania v. Mimms, 434 U. S. 106 (1977) (per curiam).
`;

  async function seat2015(): Promise<void> {
    const sworn = new Date("1993-08-10T00:00:00.000Z");
    for (const [name, isChief] of [
      ["John G. Roberts Jr.", true],
      ["Ruth Bader Ginsburg", false],
      ["Elena Kagan", false],
    ] as Array<[string, boolean]>) {
      await prisma.justice.create({ data: { name, startDate: sworn, endDate: null, isChief } });
    }
  }

  test("Rodriguez gets its author from the text, with no table to consult", async () => {
    await seat2015();
    const id = await storeRuling({
      masterReferenceId: "13-9972",
      title: "Rodriguez v. United States",
      decidedDate: new Date("2015-04-21T00:00:00.000Z"),
      fullText: RODRIGUEZ,
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    // NOT "Per Curiam", which is what a naive read of the citation above gives.
    expect(after!.sponsorName).toBe("Ruth Bader Ginsburg");
  });

  test("it still works when the Court's site is unreachable", async () => {
    // The text is on our own shelf. Nothing about reading it needs the network,
    // so a bad day at supremecourt.gov must not stop it.
    await seat2015();
    const id = await storeRuling({
      masterReferenceId: "13-9972",
      title: "Rodriguez v. United States",
      decidedDate: new Date("2015-04-21T00:00:00.000Z"),
      fullText: RODRIGUEZ,
    });

    stubTheCourt({ everythingFails: true });
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.sponsorName).toBe("Ruth Bader Ginsburg");
  });

  test("Marbury keeps its honest empty state", async () => {
    await seat2015();
    const id = await storeRuling({
      masterReferenceId: "cl-84759",
      title: "Marbury v. Madison",
      decidedDate: new Date("1803-02-24T00:00:00.000Z"),
      // The 1803 report, verbatim. Everyone knows Marshall wrote it; the
      // document does not say so.
      fullText: "## Opinion\n\nOpinion of\n \n the court.\n \n At the last term",
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    expect(after!.sponsorName).toBeNull();
  });

  test("an author the Court's table already gave is not overwritten by the text", async () => {
    await seatTheCourt();
    const id = await storeRuling({
      masterReferenceId: "20-1029",
      title: "City of Austin",
      decidedDate: new Date("2002-07-10T00:00:00.000Z"),
      fullText: "   JUSTICE KAGAN delivered the opinion of the Court.",
    });

    stubTheCourt();
    await fillFactsFromTheCourt(NOW);

    const after = await prisma.governmentReference.findUnique({ where: { id } });
    // The text pass runs first and would read KAGAN out of that line. Then the
    // Court's own J. column says SS, and the Court wins — which is the whole
    // ordering rule: our shelf answers where the Court cannot be asked, and
    // the Court answers wherever it can.
    expect(after!.sponsorName).toBe("Sonia Sotomayor");
  });
});

