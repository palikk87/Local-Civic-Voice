/**
 * THE COURT'S OWN LIST OF WHAT IT HAS DECIDED.
 *
 * supremecourt.gov publishes one table per term at /opinions/slipopinion/<term>
 * and it is the only source here that is not somebody's copy of the Court:
 *
 *   R-  Date      Docket   Name                                       J.   Citation
 *   22  4/21/22   20-1029  City of Austin v. Reagan National Adv…     SS   596 U.S. 61
 *   ..  6/20/25   24-20    Fuld v. Palestine Liberation Organiz…      R    606 U.S. 1
 *
 * WHY IT IS WORTH HAVING WHEN COURTLISTENER ALREADY ANSWERS. Two rulings on
 * this platform carried dates that are not merely wrong, they are impossible —
 * a docket number begins with the term it was filed in, so 20-1029 cannot have
 * been decided in 2002 and 24-20 cannot have been decided in 2013. Both came
 * from picking the wrong one of several CourtListener clusters for the same
 * case. The Court publishes one row per decision and there is nothing to pick.
 *
 * Measured against the live tables, both are answered outright:
 *
 *   20-1029  we said 2002-07-10   the Court says 4/21/22, by SS, 596 U.S. 61
 *   24-20    we said 2013-03-27   the Court says 6/20/25, by R,  606 U.S. 1
 *
 * AND IT CARRIES THE AUTHOR, which is the other hole. Six rulings render as
 * "Decided by The Supreme Court" — indistinguishable from a genuine per curiam.
 * The J. column tells those two apart: "PC" means the Court issued it unsigned,
 * and anything else is a justice who can be named and given a face.
 *
 * WHAT IT CANNOT DO, said plainly so nobody reaches for it expecting otherwise:
 *
 *   NO SEARCH. There is no query endpoint and no RSS. A term is the smallest
 *   thing that can be asked for. CourtListener stays the only way to FIND a
 *   case; this is how its facts are settled once found.
 *
 *   ONLY BACK TO OCTOBER TERM 2017. Measured: /slipopinion/17 through /25
 *   answer 200, and 16 and earlier redirect away. Marbury is not here and never
 *   will be, so older rulings keep whatever CourtListener gave them.
 *
 * A PARSE THAT FINDS NOTHING IS AN ERROR, NOT AN EMPTY TERM. This is HTML with
 * no API behind it. If the page is redesigned and this reads zero rows, the
 * honest conclusion is "we can no longer read this page", not "the Supreme
 * Court has stopped deciding cases" — and a caller that cannot tell those apart
 * will quietly stop correcting anything. fetchSlipOpinions returns null for
 * both a failed request AND a page that parsed to nothing.
 */
import { officialSourceHeaders } from "./official-source";

/** One decided case, exactly as the Court's own table lists it. */
export interface SlipOpinion {
  /** The R- column: where this sits in the term's sequence of decisions. */
  sequence: number;
  /** The date the Court says it was decided. */
  decidedDate: Date;
  /** The docket number, which is also our masterReferenceId for a ruling. */
  docket: string;
  caseName: string;
  /**
   * The J. column verbatim: "SS", "R", "KJ" — or "PC" for per curiam.
   *
   * Kept as the Court prints it rather than resolved here, because turning
   * initials into a person needs the bench that sat on the decided date, and
   * this file does not touch the database. See justiceFromInitials.
   */
  authorInitials: string;
  /**
   * "596 U.S. 61" once the volume is bound, "609/2" while it is still a
   * preliminary print, null when the column is empty.
   */
  citation: string | null;
  /**
   * The Court's own PDF of the opinion, absolute.
   *
   * THE BEST SOURCE LINK THERE IS for a ruling — the document the Court
   * published, on the Court's own server, rather than a third party's copy of
   * it. A record created from this table gets this as its sourceUrl.
   */
  pdfUrl: string | null;
}

/** The Court's slip opinion table for one October Term. */
export function slipOpinionUrl(term: number): string {
  return `https://www.supremecourt.gov/opinions/slipopinion/${term}`;
}

/**
 * The earliest term the Court still publishes a real slip opinion table for.
 *
 * MEASURED, AND THE FIRST MEASUREMENT WAS WRONG. Asking for terms 13 through 26
 * one at a time: 16 and below answer 302, 26 answers 302 (it has not begun),
 * and 17 through 25 all answer 200 — which is what this was first set from.
 *
 * But 17 answers 200 WITH THE CURRENT TERM'S TABLE. Its seventy rows are dated
 * 8/31/26, 8/24/26, 6/30/26 — October Term 2025, byte for byte the same list
 * /slipopinion/25 returns. A caller trusting the status code would have read
 * this year's decisions, believed they were from 2017, and "corrected" nine
 * years of records to the wrong dates.
 *
 * Term 18 is the earliest that answers with its own decisions: 73 rows, every
 * one of them inside October Term 2018. That is why fetchSlipOpinions checks
 * the CONTENT rather than the status, and why this constant is 18.
 */
export const EARLIEST_SLIP_TERM = 18;

/**
 * Which October Term a date falls in.
 *
 * The Court's year begins on the first Monday in October and runs until the
 * next one, so a ruling handed down in August 2026 belongs to October Term
 * 2025 — which is exactly the case for the two most recent rulings this
 * platform holds, and getting it wrong would look for them on a page that does
 * not list them.
 */
export function termOf(when: Date): number {
  const year = when.getUTCFullYear();
  const term = when.getUTCMonth() >= 9 ? year : year - 1;
  return term % 100;
}

/**
 * THE COURT APPENDS ITS OWN HOUSEKEEPING TO A CASE NAME.
 *
 * Six of the 462 rows across terms 18 to 25 carry a revision note glued onto
 * the end of the name:
 *
 *   Trump v. Barbara Revisions : 7/01/26
 *   Trump v. Slaughter Revisions : 7/07/26
 *   United States v. Hemani Revisions : 6/29/26
 *
 * A record created from one of those rows would be titled "Trump v. Slaughter
 * Revisions : 7/07/26" on every card and every share.
 *
 * NOTED HERE BECAUSE THE COMMIT THAT ADDED THIS FILE SAID THE OPPOSITE — that
 * CourtListener carried re-posting noise "the Court's list does not". It does.
 * The Court is still the better source, for the reason that has not changed:
 * one row per decision, and every row a Supreme Court case by construction.
 */
function withoutRevisionNote(caseName: string): string {
  return caseName.replace(/\s*revisions?\s*:?\s*[\d/]*\s*$/i, "").trim();
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&quot;|&#8220;|&#8221;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "4/21/22" as a date.
 *
 * UTC midnight, like every other date on a record here, so a ruling does not
 * appear to have been decided a day earlier west of Greenwich. Two-digit years
 * are this century: the Court has published these tables only since 2017.
 */
export function parseSlipDate(raw: string): Date | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim());
  if (!match) return null;
  const [, month, day, year] = match;
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const when = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  return Number.isNaN(when.getTime()) ? null : when;
}

/**
 * Every decision in one term's table.
 *
 * Pure, so it is tested against the real page recorded in
 * tests/fixtures/scotus-slip-opinions-25.html rather than an imitation of it.
 * The parsing is the part that can break, and a test that needs
 * supremecourt.gov to be up fails for reasons that have nothing to do with
 * this code — the same rule court-composition.ts already follows.
 */
export function parseSlipOpinions(html: string): SlipOpinion[] {
  const found: SlipOpinion[] = [];

  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? []) {
    const rawCells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    const cells = rawCells.map(stripTags);
    if (cells.length < 6) continue;

    const [sequence = "", date = "", docket = "", caseName = "", initials = "", citation = ""] =
      cells;

    // The R- column is a plain number on every data row and never on the
    // header or on the search widget the page opens with.
    if (!/^\d+$/.test(sequence)) continue;

    const decidedDate = parseSlipDate(date);
    if (!decidedDate || !docket.trim() || !caseName.trim()) continue;

    // The case name is a link to the Court's own PDF of the opinion.
    const href = /href=['"]([^'"]+)['"]/i.exec(rawCells[3] ?? "")?.[1];

    found.push({
      sequence: Number(sequence),
      decidedDate,
      docket: docket.trim(),
      caseName: withoutRevisionNote(caseName),
      authorInitials: initials.trim().toUpperCase(),
      citation: citation.trim() || null,
      pdfUrl: href ? new URL(href, "https://www.supremecourt.gov").href : null,
    });
  }

  return found;
}

/**
 * One term's decisions, from the Court. Null when we could not read them.
 *
 * NULL COVERS BOTH FAILURES ON PURPOSE — the request not answering, and the
 * page answering with something this cannot parse. A caller must not be able
 * to mistake either for "the Court decided nothing this term", because that is
 * the shape of mistake that makes a correction pass silently stop correcting.
 */
export async function fetchSlipOpinions(term: number): Promise<SlipOpinion[] | null> {
  try {
    const response = await fetch(slipOpinionUrl(term), {
      headers: officialSourceHeaders(),
      // Not `redirect: "manual"` — a term the Court no longer publishes
      // redirects to the current one, and following that would silently return
      // the wrong term's decisions under this term's name.
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200) return null;

    const parsed = parseSlipOpinions(await response.text());
    // The Court decides 58-65 cases a year and publishes them as it goes, so a
    // term page with nothing on it means the page changed, not that the term
    // was empty. Only the term that has just begun is legitimately thin, and
    // this is called for terms that are over or well under way.
    if (parsed.length === 0) return null;

    /*
     * IS THIS ACTUALLY THE TERM WE ASKED FOR?
     *
     * /slipopinion/17 answers 200 and serves October Term 2025's table —
     * seventy rows dated 2026, identical to /slipopinion/25. A status code
     * cannot tell you that. The dates can: every row of a genuine term page
     * falls inside that term, checked across terms 18 through 25 and true for
     * all 462 of their rows.
     *
     * So a page whose decisions belong to some other term is not this term's
     * page, whatever it answered with, and reading it would date nine years of
     * records to the wrong year.
     */
    const belong = parsed.filter((opinion) => termOf(opinion.decidedDate) === term).length;
    if (belong !== parsed.length) {
      console.warn(
        `[SlipOpinions] term ${term} answered with ${parsed.length - belong} of ` +
          `${parsed.length} decisions from another term — this is not term ${term}'s page`,
      );
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** The Court's own shorthand for "the Court issued this unsigned". */
export const PER_CURIAM_INITIALS = "PC";

const NAME_SUFFIX = /^(jr|sr|i{1,3}|iv|v)\.?$/i;

/**
 * The initials the Court might print for a person's name.
 *
 * Two forms, because the Court uses both: "SS" for Sonia Sotomayor and a bare
 * "R" for the Chief. Measured across one full term's table — PC, AB, NG, BK,
 * R, EK, A, T, SS, KJ — which is first-and-last for six of them and last-only
 * for three.
 */
export function initialsFor(name: string): string[] {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part && !NAME_SUFFIX.test(part));
  if (parts.length === 0) return [];

  const first = parts[0]![0]!.toUpperCase();
  const last = parts[parts.length - 1]![0]!.toUpperCase();
  return parts.length === 1 ? [last] : [`${first}${last}`, last];
}

/**
 * Which justice on this bench the Court meant by those initials.
 *
 * NEVER GUESSES, AND THAT IS THE POINT. A bare "K" would fit both Kagan and
 * Kavanaugh, so it resolves to nobody and the record keeps its honest empty
 * state rather than attributing a ruling to the wrong justice. The Court does
 * not in fact print a bare K for either of them — it prints EK and BK — but a
 * rule that only works while the bench happens to have no collisions is a rule
 * that fails the first time somebody is confirmed.
 *
 * Returns null for per curiam too: nobody wrote it, which is a different fact
 * from nobody being identifiable, and the caller has to handle it as such.
 */
export function justiceFromInitials(initials: string, bench: string[]): string | null {
  const wanted = initials.trim().toUpperCase().replace(/[.\s]/g, "");
  if (!wanted || wanted === PER_CURIAM_INITIALS) return null;

  const matches = bench.filter((name) => initialsFor(name).includes(wanted));
  return matches.length === 1 ? matches[0]! : null;
}
