/**
 * THE COURT SETTLES THE FACTS ABOUT ITS OWN RULINGS.
 *
 * WHAT WAS WRONG, and it was not subtle. Two rulings carried dates that are
 * impossible on the face of our own data — a docket number begins with the term
 * the case was filed in:
 *
 *   20-1029  filed in the 2020 term   we said decided 2002-07-10
 *   24-20    filed in the 2024 term   we said decided 2013-03-27
 *
 * And six carried no author at all, rendering as "Decided by The Supreme
 * Court" — the same words a genuine per curiam gets, so a reader could not tell
 * a ruling the Court deliberately issued unsigned from one whose author we
 * simply never found.
 *
 * Neither self-healed. services/scotus-facts.ts only ever fills an EMPTY date
 * ("Only ever fills a hole. A date already on the row is not overwritten"), and
 * nothing anywhere backfilled an author.
 *
 * WHY THE WRONG DATES HAPPENED. CourtListener holds several clusters for one
 * case — a slip opinion, a preliminary print, a bound volume — and the record
 * took whichever one it was handed. The Court publishes ONE ROW PER DECISION.
 * There is nothing to pick, so there is nothing to pick wrongly.
 *
 * THIS IS THE ONE PLACE THAT OVERWRITES, and only because of who is speaking.
 * Everywhere else on this platform a stored value is left alone once it is set;
 * here the Supreme Court is telling us the date of its own decision, and
 * keeping our version of it over theirs would be absurd. Every change is
 * logged with both values so the correction is legible afterwards.
 *
 * IT CANNOT REACH EVERY RULING, and says so rather than pretending. The Court's
 * tables begin at October Term 2018. Marbury is not on one and never will be;
 * rulings older than that keep whatever CourtListener gave them and are counted
 * as "not listed" rather than as failures.
 *
 * NOTHING IS WRITTEN ON A FAILURE TO READ. If no term page can be read, this
 * corrects nothing and says so loudly. A network problem must never be able to
 * rewrite the Court's history — the same rule the SCOTUS purge learned the hard
 * way when a 401 was read as "this record is fine".
 */
import { prisma } from "../prisma";

import {
  EARLIEST_SLIP_TERM,
  PER_CURIAM_INITIALS,
  fetchSlipOpinions,
  justiceFromInitials,
  termOf,
  type SlipOpinion,
} from "./scotus-slip-opinions";

/** What the Court's own list says a ruling of its is: binding, published law. */
const PUBLISHED = "Published";

/** How the platform records an opinion the Court issued without a name on it. */
const PER_CURIAM = "Per Curiam";

/** One record the Court disagreed with, and what changed. */
export interface CourtCorrection {
  masterReferenceId: string;
  title: string;
  /** Human-readable, one per field, carrying the old value and the new. */
  changes: string[];
}

export interface CourtFactsResult {
  /** Term pages successfully read. */
  termsRead: number;
  /** Terms whose page could not be read — a gap, not an empty term. */
  termsUnreadable: number[];
  /** Stored rulings examined. */
  checked: number;
  /** Rulings the Court's tables do not list: older than October Term 2018. */
  notListed: number;
  corrected: CourtCorrection[];
}

/**
 * A docket as it is stored here.
 *
 * masterReferenceId for a ruling IS its docket number, lowercased by
 * services/master-reference-id — so "26A203" is stored as "26a203" and the
 * Court's own spelling has to be brought to the same shape before they can be
 * compared. Doing this by eye is how a whole term silently fails to match.
 */
function docketKey(docket: string): string {
  return docket.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Every decision the Court lists, from October Term 2018 to the current one.
 *
 * ONE PASS OVER ALL TERMS, rather than guessing which term a case belongs to.
 * A docket's own prefix is the term it was FILED in, which is not always the
 * term it was decided in — 26A203 was decided in October Term 2025 — and an
 * index built from every page cannot get that wrong.
 *
 * At most nine requests to supremecourt.gov, which publishes static HTML and
 * does not rate-limit the way CourtListener does.
 */
async function readEveryTerm(
  now: Date,
): Promise<{ index: Map<string, SlipOpinion>; read: number; unreadable: number[] }> {
  const index = new Map<string, SlipOpinion>();
  const unreadable: number[] = [];
  let read = 0;

  for (let term = EARLIEST_SLIP_TERM; term <= termOf(now); term += 1) {
    const opinions = await fetchSlipOpinions(term);
    if (!opinions) {
      unreadable.push(term);
      continue;
    }
    read += 1;
    for (const opinion of opinions) {
      // First writer wins. A docket appears once per term, and if two terms
      // ever listed the same one the earlier is the decision and the later
      // would be a reprint.
      if (!index.has(docketKey(opinion.docket))) index.set(docketKey(opinion.docket), opinion);
    }
  }

  return { index, read, unreadable };
}

/** The justices sitting on the day a ruling came down, by name. */
async function benchNamesOn(when: Date): Promise<string[]> {
  const rows = await prisma.justice.findMany({
    where: {
      startDate: { lte: when },
      OR: [{ endDate: null }, { endDate: { gte: when } }],
    },
    select: { name: true },
  });
  return [...new Set(rows.map((row) => row.name))];
}

const ISO_DAY = (when: Date): string => when.toISOString().slice(0, 10);

/**
 * Bring every stored ruling into line with the Court's own table.
 *
 * Idempotent: a record that already agrees with the Court is not written to, so
 * after the first pass this changes nothing and costs one read per term.
 */
export async function fillFactsFromTheCourt(now: Date = new Date()): Promise<CourtFactsResult> {
  const { index, read, unreadable } = await readEveryTerm(now);

  const rulings = await prisma.governmentReference.findMany({
    where: { referenceType: "scotus_case", mergedIntoId: null },
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
      decidedDate: true,
      sponsorName: true,
      precedentialStatus: true,
    },
  });

  const result: CourtFactsResult = {
    termsRead: read,
    termsUnreadable: unreadable,
    checked: rulings.length,
    notListed: 0,
    corrected: [],
  };

  // NOT ONE PAGE COULD BE READ. Correct nothing. An index that is empty because
  // supremecourt.gov was unreachable looks exactly like an index that is empty
  // because the Court has decided nothing, and only one of those is ever true.
  if (read === 0) {
    console.error(
      `[CourtFacts] could not read a single term page (${unreadable.join(", ")}) — ` +
        `nothing corrected. This is a failure to reach the Court, not a finding about it.`,
    );
    return result;
  }

  for (const ruling of rulings) {
    const listed = index.get(docketKey(ruling.masterReferenceId));
    if (!listed) {
      result.notListed += 1;
      continue;
    }

    const changes: string[] = [];
    const data: {
      decidedDate?: Date;
      sponsorName?: string;
      sponsorPhotoUrl?: null;
      precedentialStatus?: string;
    } = {};

    // ---- The date. The Court is the authority on when it decided something.
    if (!ruling.decidedDate || ISO_DAY(ruling.decidedDate) !== ISO_DAY(listed.decidedDate)) {
      changes.push(
        `decided ${ruling.decidedDate ? ISO_DAY(ruling.decidedDate) : "unknown"} -> ${ISO_DAY(listed.decidedDate)}`,
      );
      data.decidedDate = listed.decidedDate;
    }

    // ---- Who wrote it, or that the Court deliberately put no name on it.
    //
    // The bench is read for the date the COURT gives, not the one we hold — on
    // the two records this exists for, ours is out by years and would produce
    // the wrong nine justices to match initials against.
    const author =
      listed.authorInitials === PER_CURIAM_INITIALS
        ? PER_CURIAM
        : justiceFromInitials(listed.authorInitials, await benchNamesOn(listed.decidedDate));

    if (author && author !== ruling.sponsorName) {
      changes.push(`author ${ruling.sponsorName ?? "unknown"} -> ${author}`);
      data.sponsorName = author;
      // A new person needs a new face. Clearing it lets ensurePortraitFor pick
      // one up the first time somebody opens the ruling, rather than leaving
      // the previous author's photograph above the new author's name.
      data.sponsorPhotoUrl = null;
    }

    // ---- Binding law. Everything the Court puts on this table is published.
    if (ruling.precedentialStatus !== PUBLISHED) {
      changes.push(`status ${ruling.precedentialStatus ?? "unrecorded"} -> ${PUBLISHED}`);
      data.precedentialStatus = PUBLISHED;
    }

    if (changes.length === 0) continue;

    await prisma.governmentReference.update({ where: { id: ruling.id }, data });
    result.corrected.push({
      masterReferenceId: ruling.masterReferenceId,
      title: ruling.title,
      changes,
    });
    console.log(`[CourtFacts] ${ruling.masterReferenceId}: ${changes.join("; ")}`);
  }

  console.log(
    `[CourtFacts] ${result.termsRead} term(s) read, ${result.checked} ruling(s) checked, ` +
      `${result.corrected.length} corrected, ${result.notListed} not on any table` +
      (unreadable.length ? ` — could not read term(s) ${unreadable.join(", ")}` : ""),
  );
  return result;
}
