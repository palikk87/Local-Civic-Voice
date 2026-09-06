import { isPerCuriam } from "./reference-attribution";
/**
 * HOW COMPLETE IS OUR RECORD OF THIS LAW — and we publish the misses.
 *
 * THE BADGE THIS REPLACES was arithmetic over constants. 40 of its points came
 * from one hardcoded source, the rest were invented weights, and the ceiling
 * was 80 against a top bar of 90 — so the best badge was unreachable for every
 * law on every screen, and the feed's card mapper dropped the only two fields
 * that moved the number at all. Every post read "? Unverified" in red, forever.
 *
 * Worse, it was measuring the wrong thing. It called a law "unverified" for
 * being old. A 1964 statute is not less verified than last week's bill, and
 * nothing on this platform is unverified in the first place — every record
 * comes from congress.gov, the Federal Register or CourtListener.
 *
 * WHAT IT MEASURES NOW, in Khalid's words: "the idea is always to be on the top
 * badge. but if we fall short we rate ourself publicly and people can see
 * that." So the badge stops grading the law and starts grading OUR RECORD of
 * it. Each line is a fact we either hold or do not. Nothing is weighted,
 * nothing is inferred, and a miss is shown rather than hidden.
 *
 * THE CHECKLIST IS THE FEATURE, NOT THE BADGE. A bare "Unconfirmed" makes
 * somebody wary without telling them why, which is worse than saying nothing.
 * The same chip opened up — source linked, text held, checked two days ago,
 * brief not written yet — turns that into understanding. So every check
 * carries its own detail line, and the clients render the list.
 *
 * NOTHING HERE STARTS ANY WORK. A Citizen's Brief is still written only because
 * a reader asked for one; this file reads whether that has happened and never
 * causes it. No model call is triggered by a badge, ever.
 */

/** One line of the checklist: a fact we hold, or do not. */
export interface CompletenessCheck {
  /** Stable key, so clients and tests do not match on prose. */
  id: string;
  /** What the reader sees. */
  label: string;
  met: boolean;
  /**
   * The real value behind the tick — "from congress.gov, checked 2 days ago".
   * Null when there is nothing to say, which is what a miss usually looks like.
   */
  detail: string | null;
}

export type CompletenessLevel = "verified" | "confirmed" | "unconfirmed" | "unverified";

export interface RecordCompleteness {
  level: CompletenessLevel;
  label: string;
  /** How many of the applicable checks we hold. */
  met: number;
  /** How many apply to this record. A ruling has no floor vote to hold. */
  applicable: number;
  checks: CompletenessCheck[];
}

/**
 * The four badges, and what each one costs.
 *
 * KEYED TO HOW MANY CHECKS ARE OUTSTANDING, not to a score. There is no
 * weighting to argue with and no threshold anybody has to justify: a record
 * either has the thing or it does not, and the badge counts.
 *
 * THE NAMES ARE HEAVY ON PURPOSE — Khalid: "things like verified and unverified
 * pack a heavier weight". They stay TRUE by construction. Six checks always
 * apply and four of those are about sourcing, so a record can only fall to
 * "Unverified" by missing three or more, which means it must be missing core
 * sourcing. A record holding its official source and text but with no brief and
 * no portrait lands on "Unconfirmed". The bottom rung can never sit on a record
 * we have actually verified against a government source.
 */
export const COMPLETENESS_LEVELS: Array<{
  level: CompletenessLevel;
  label: string;
  /** Outstanding checks at or below this many. */
  outstanding: number;
  requirement: string;
}> = [
  { level: "verified", label: "Verified", outstanding: 0, requirement: "Everything we should hold, we hold" },
  { level: "confirmed", label: "Confirmed", outstanding: 1, requirement: "One thing still outstanding" },
  { level: "unconfirmed", label: "Unconfirmed", outstanding: 2, requirement: "Two things still outstanding" },
  { level: "unverified", label: "Unverified", outstanding: Number.POSITIVE_INFINITY, requirement: "Three or more outstanding, including part of the sourcing" },
];

/** How recently the source must have been re-read for that check to count. */
const RECHECK_WINDOW_DAYS = 30;

/** The columns this reads. Nothing else is touched. */
export interface CompletableReference {
  referenceType: string;
  status: string;
  sourceUrl: string | null;
  fullText: string | null;
  fullTextSource: string | null;
  sourceCheckedAt: Date | null;
  introducedDate: Date | null;
  signedDate: Date | null;
  decidedDate: Date | null;
  sponsorName: string | null;
  sponsorBioguideId: string | null;
  sponsorPhotoUrl: string | null;
  citizenBriefJson: string | null;
  citizenBriefVersion: number | null;
  lawVersion: number;
  /**
   * "Published", "Unpublished", "Errata" — the Court's own vocabulary for
   * whether a ruling is binding law. Null means we have not established it,
   * which is not the same as the source answering "Unknown".
   */
  precedentialStatus?: string | null;
  /** True when a recorded chamber vote is stored for this law. */
  hasRollCall?: boolean;
}

function daysSince(when: Date | null, now: Date): number | null {
  if (!when) return null;
  return Math.floor((now.getTime() - when.getTime()) / 86_400_000);
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * A bill that reached a floor vote should have the roll call stored.
 *
 * APPLICABILITY IS THE WHOLE POINT of this being separate. Most bills die in
 * committee and never get a recorded vote, and an executive order or a court
 * ruling never has one at all. Marking those down for a fact that cannot exist
 * would be the same mistake as calling an old statute unverified.
 */
function rollCallApplies(ref: CompletableReference): boolean {
  if (ref.referenceType !== "bill") return false;
  return ["passed", "enacted", "signed", "vetoed"].includes(ref.status.toLowerCase());
}

/** The date the source gives for this kind of record. */
function sourceDate(ref: CompletableReference): { date: Date | null; label: string } {
  if (ref.referenceType === "executive_order") return { date: ref.signedDate, label: "Signed" };
  if (ref.referenceType === "scotus_case") return { date: ref.decidedDate, label: "Decided" };
  return { date: ref.introducedDate, label: "Introduced" };
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
};

/**
 * The checklist and the badge for one record.
 *
 * Pure and synchronous on purpose: it is called once per row in a feed page, so
 * it may not reach the database. Everything it needs is selected alongside the
 * row by the caller.
 */
export function recordCompleteness(
  ref: CompletableReference,
  now: Date = new Date(),
): RecordCompleteness {
  const checks: CompletenessCheck[] = [];

  // ---- 1. The official source, linked, so a reader can go and check us.
  checks.push({
    id: "source",
    label: "Official source linked",
    met: Boolean(ref.sourceUrl),
    detail: ref.sourceUrl ? new URL(ref.sourceUrl).hostname.replace(/^www\./, "") : null,
  });

  // ---- 2. The law's own words, not somebody's summary of them.
  const hasText = Boolean(ref.fullText && ref.fullTextSource);
  checks.push({
    id: "text",
    label: "Official text held",
    met: hasText,
    detail: hasText ? `from ${ref.fullTextSource}` : null,
  });

  // ---- 3. Still the same words the source is publishing.
  const checkedDays = daysSince(ref.sourceCheckedAt, now);
  checks.push({
    id: "rechecked",
    label: `Checked against the source in the last ${RECHECK_WINDOW_DAYS} days`,
    met: checkedDays !== null && checkedDays <= RECHECK_WINDOW_DAYS,
    detail: checkedDays === null ? null : `checked ${ago(checkedDays)}`,
  });

  // ---- 4. Real dates from the source. These used to be our row's createdAt,
  //         so a statute from 2007 read "Introduced today".
  const { date, label } = sourceDate(ref);
  checks.push({
    id: "dates",
    label: "Real dates from the source",
    met: Boolean(date),
    detail: date ? `${label} ${date.toLocaleDateString("en-US", DATE_FORMAT)}` : null,
  });

  // ---- 5. Who decided it, with something to identify them by.
  //
  // A name alone is not enough to put a face on the card, and the face is what
  // makes a law read as somebody's decision rather than a filing.
  //
  // UNLESS THE COURT CHOSE NOT TO SIGN IT. A per curiam ruling is issued by the
  // Court as a body with no individual name on it, on purpose. There is no
  // author to hold, so a record that says "per curiam" is COMPLETE, and marking
  // it down asks it forever for something that does not exist — the same
  // mistake rollCallApplies exists to avoid, and the same one precedentialStatus
  // is careful about: their answer is not our gap.
  //
  // A ruling with NO author recorded is still a failure. That is our gap, and
  // the two are told apart by name rather than by the shared perCuriam display
  // flag, which unattributedCourt() also sets for a ruling whose author we
  // simply never read.
  if (!isPerCuriam(ref.sponsorName)) {
    const named = Boolean(ref.sponsorName?.trim());
    const identifiable = named && Boolean(ref.sponsorPhotoUrl || ref.sponsorBioguideId);
    checks.push({
      id: "attribution",
      label: "Who is behind it, named",
      met: identifiable,
      detail: named ? ref.sponsorName : null,
    });
  }

  // ---- 6. A brief, if a reader has asked for one.
  //
  // NOT SOMETHING WE START. The brief is written when somebody presses the
  // button; this only reads whether that has happened, and the badge ticks up
  // on its own when it does.
  const hasBrief = Boolean(ref.citizenBriefJson);
  checks.push({
    id: "brief",
    label: "Citizen's Brief written",
    met: hasBrief,
    detail: hasBrief ? "written" : "nobody has asked for one yet",
  });

  // ---- 7. And if the law moved afterwards, does the brief still describe it?
  //         Only askable once there is a brief AND the law has a later version.
  if (hasBrief && ref.lawVersion > 1) {
    const current = ref.citizenBriefVersion === ref.lawVersion;
    checks.push({
      id: "brief_current",
      label: "Brief matches the current version of the law",
      met: current,
      detail: current
        ? `version ${ref.lawVersion}`
        : `brief describes version ${ref.citizenBriefVersion ?? "?"}, the law is on ${ref.lawVersion}`,
    });
  }

  /*
   * ---- 8. WHETHER A RULING IS BINDING LAW, AND ONLY FOR A RULING.
   *
   * Khalid: "id also like to display our Precedential Status as part of what we
   * show people which will be built into part of their badge of verified or
   * lesser badges."
   *
   * APPLICABLE ONLY TO A COURT CASE, which is why it belongs here rather than
   * in the six above. A bill has no precedential status and an executive order
   * has none; marking them down for a fact that cannot exist is the same
   * mistake as calling a 1964 statute unverified. This is exactly how the roll
   * call below already works — the badge counts what APPLIES to this record,
   * so a ruling is scored out of seven and a bill out of six, and neither is
   * held to the other's standard.
   *
   * The value is not judged, only held. "Unpublished" is a fact about the
   * ruling; "we never found out" is a fact about us, and only the second is a
   * miss.
   */
  if (ref.referenceType === "scotus_case") {
    const status = ref.precedentialStatus?.trim();
    checks.push({
      id: "precedential_status",
      label: "Precedential status recorded",
      met: Boolean(status),
      detail: status ?? null,
    });
  }

  // ---- 9. How the chamber actually voted, where there was a vote to record.
  if (rollCallApplies(ref)) {
    checks.push({
      id: "roll_call",
      label: "Recorded chamber vote held",
      met: Boolean(ref.hasRollCall),
      detail: ref.hasRollCall ? "roll call stored" : null,
    });
  }

  const applicable = checks.length;
  const met = checks.filter((check) => check.met).length;
  const outstanding = applicable - met;
  const band =
    COMPLETENESS_LEVELS.find((entry) => outstanding <= entry.outstanding) ??
    COMPLETENESS_LEVELS[COMPLETENESS_LEVELS.length - 1]!;

  return { level: band.level, label: band.label, met, applicable, checks };
}
