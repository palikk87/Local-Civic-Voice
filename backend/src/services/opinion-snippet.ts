/**
 * WHAT A SUPREME COURT CASE IS ABOUT, IN THE COURT'S OWN WORDS.
 *
 * THE BUG THIS EXISTS FOR. All seventeen Supreme Court records on this platform
 * carried one identical description, beginning:
 *
 *   "(Slip Opinion) OCTOBER TERM, 2025  1  Syllabus  NOTE: Where it is
 *    feasible, a syllabus (headnote) will be released… See United States v.
 *    Detroit"
 *
 * That is the Reporter of Decisions' standard notice, printed unchanged on the
 * front of every slip opinion the Court publishes. It arrived as CourtListener's
 * `snippet` — the opening characters of the opinion document — and was stored as
 * the description. So it was on every ruling's page, in every share preview, and
 * in every search result: seventeen pages that read exactly alike.
 *
 * WHY THE SNIPPET CANNOT BE SALVAGED. CourtListener truncates the snippet at
 * roughly 370 characters, and that cut lands INSIDE the notice — it ends "See
 * United States v. Detroit", before the citation that closes it. Ten of the
 * seventeen were the notice and nothing else. There is no summary behind it to
 * recover, so stripping the notice off the snippet leaves an empty field.
 *
 * WHERE THE SUMMARY ACTUALLY IS. `fullText` — the whole opinion, already stored,
 * on every one of them. Behind the notice sits the syllabus: the Court's own
 * summary of its own case, written by the Reporter for exactly this purpose.
 * This file finds it.
 *
 * WHEN NOTHING IS FOUND, NOTHING IS STORED. A description that looks like a
 * summary but is really page furniture is worse than an empty field, because a
 * reader cannot tell the two apart.
 */

/**
 * The notice's last sentence, and the anchor everything else is measured from.
 * The citation has been the same since 1906.
 */
const REPORTER_NOTICE_END =
  /Detroit\s+Timber\s*&?\s*(?:amp;)?\s*Lumber\s+Co\.,?\s*\d+\s*U\.?\s*S\.?\s*\d+,?\s*\d+\.?/i;

/**
 * The line that closes a syllabus caption. Everything above it is the case name
 * in capitals, the court below, and the docket number; everything after it is
 * the summary. The asterisk is the footnote marker on consolidated cases.
 */
const DECISION_DATE = /Decided\s+[A-Z][a-z]+\.?\s+\d{1,2},\s*\d{4}\s*\*?/g;

/** How far past the notice the caption can reasonably run. */
const CAPTION_WINDOW = 3000;

/** The Court speaking as one body: the opinion itself starts right after. */
const PER_CURIAM = /\bPER\s+CURIAM\.\s/;

/** Headings and bylines that name the document rather than describe the case. */
const DOCUMENT_FURNITURE = [
  /^(?:##\s+\S+\s+)+/,
  // Deliberately case-sensitive: this is the heading in capitals. Matching it
  // case-insensitively also loosens the lookahead, which swallowed the "Opinion"
  // of "Opinion of the court." and left a page reading "of the court. At the
  // last term…" on Marbury.
  /^(?:MEMORANDUM\s+)?OPINION(?:\s+AND\s+ORDER)?\s+(?=[A-Z])/,
  /^[A-Z][A-Z.\s]{3,40},\s+United\s+States\s+(?:Magistrate\s+|District\s+|Circuit\s+)?Judge\.\s*/,
  /^Opinion\s+of\s+the\s+court\.?\s*/i,
  /^Syllabus\s+/,
];

/** Shorter than this and the extraction went wrong, whatever it produced. */
const TOO_SHORT_TO_MEAN_ANYTHING = 120;

/** What a description is allowed to cost a reader. */
const MAX_DESCRIPTION = 500;

/**
 * One opinion, as one line of prose.
 *
 * Court documents are typeset PDFs, so the extracted text arrives with column
 * breaks as newlines and words split across lines with a hyphen — "glypho-
 * sate", "Anti- terrorism". Both are artefacts of the page, not the words.
 */
function flatten(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/(\p{Ll})-\s(\p{L})/gu, "$1$2")
    // Star pagination — "…why a mandamus *154 should not issue…" is the printed
    // page number of the bound reporter, dropped into the middle of a sentence.
    .replace(/ \*\d{1,4} /g, " ")
    .trim();
}

/** Take the furniture off the front, repeatedly, until nothing more comes off. */
function stripFurniture(text: string): string {
  let current = text.trim();
  let previous: string;
  do {
    previous = current;
    for (const pattern of DOCUMENT_FURNITURE) current = current.replace(pattern, "").trim();
  } while (current !== previous);
  return current;
}

/**
 * End on a sentence, not mid-word.
 *
 * A description cut at exactly 500 characters reads as broken. Backing up to the
 * last full stop costs a line and buys a sentence that finishes.
 */
function trimToSentence(text: string): string {
  if (text.length <= MAX_DESCRIPTION) return text;
  const cut = text.slice(0, MAX_DESCRIPTION);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (stop > MAX_DESCRIPTION / 2) return cut.slice(0, stop + 1);
  return `${cut.replace(/\s+\S*$/, "")}…`;
}

/**
 * THE SUMMARY, PULLED OUT OF THE OPINION.
 *
 * Three shapes, tried in order, because the Court publishes three:
 *
 *   1. A slip opinion with a syllabus — the Reporter's notice, then the caption,
 *      then the summary. Thirteen of the seventeen. The decision date closes the
 *      caption, so the summary is whatever follows the last one.
 *   2. A per curiam — no syllabus at all; the Court's reasoning begins directly
 *      after "PER CURIAM." Two of the seventeen.
 *   3. Anything older or from another court, where the opinion simply starts.
 *      Two of the seventeen, including Marbury.
 */
export function deriveOpinionDescription(fullText: string | null | undefined): string | undefined {
  if (!fullText) return undefined;

  const text = stripFurniture(flatten(fullText));
  let body: string;

  const noticeEnd = text.search(REPORTER_NOTICE_END);
  if (noticeEnd >= 0) {
    let rest = text.slice(noticeEnd).replace(REPORTER_NOTICE_END, "");

    // The caption between the notice and the summary. Its last line is the
    // decision date; take everything after it.
    const caption = rest.slice(0, CAPTION_WINDOW);
    let lastDate: RegExpExecArray | null = null;
    let match: RegExpExecArray | null;
    DECISION_DATE.lastIndex = 0;
    while ((match = DECISION_DATE.exec(caption)) !== null) lastDate = match;

    // No date printed — an order, or a ruling issued without argument. The
    // word "Syllabus" is then the last thing above the summary, and it is the
    // LAST one that matters: it appears once over the notice and again over the
    // summary, so stopping at the first leaves the whole caption in place.
    if (lastDate) {
      rest = rest.slice(lastDate.index + lastDate[0].length);
    } else {
      const heading = rest.slice(0, CAPTION_WINDOW).lastIndexOf("Syllabus");
      if (heading >= 0) rest = rest.slice(heading + "Syllabus".length);
    }

    body = rest;
  } else {
    const perCuriam = text.search(PER_CURIAM);
    body = perCuriam >= 0 ? text.slice(perCuriam).replace(PER_CURIAM, "") : text;
  }

  body = stripFurniture(body);
  if (body.length < TOO_SHORT_TO_MEAN_ANYTHING) return undefined;
  return trimToSentence(body);
}

/** True when a stored description is the Reporter's notice rather than a summary. */
export function isReporterNotice(description: string | null | undefined): boolean {
  if (!description) return false;
  return /^\(?\s*slip\s+opinion/i.test(description.trim());
}

/**
 * The guard on the ingest path.
 *
 * A ruling is created the moment CourtListener lists it, which can be before its
 * text has been fetched. Until then the snippet is all there is — so it is kept
 * when it says something, and refused when it is the notice. The description
 * then fills itself in when the text arrives; see services/reference-content.ts.
 */
export function cleanOpinionSnippet(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const text = flatten(raw);
  if (!text) return undefined;
  if (isReporterNotice(text)) return undefined;
  if (REPORTER_NOTICE_END.test(text.slice(0, 600))) return undefined;
  // A caption is not a summary either: "Cite as: 609 U. S. ____ (2026) 1 Per
  // Curiam SUPREME COURT OF THE UNITED STATES ___ No. 26A124 ___".
  if (/^Cite\s+as:/i.test(text)) return undefined;
  // Nor is the record's own filing card. Five rulings were stored with
  // "City of Austin v. Reagan National Advertising of Austin, LLC. Court:
  // Supreme Court of the United States. Docket: 20-1029" as their description —
  // the title, the one court every ruling here comes from, and a number. It
  // reads like a summary and tells a reader nothing they cannot see above it.
  if (/\bCourt:\s.*\bDocket:/s.test(text)) return undefined;
  if (text.length < TOO_SHORT_TO_MEAN_ANYTHING) return undefined;
  return trimToSentence(text);
}

/**
 * The rulings already stored, brought up to the rule that governs new ones.
 *
 * Same function, applied to what came before. Only rulings whose description is
 * the notice — or which have none — are touched, so a description somebody put
 * there deliberately is never overwritten.
 *
 * Idempotent: after one pass nothing matches, so this can run at every boot.
 */
export async function backfillOpinionDescriptions(): Promise<number> {
  const { prisma } = await import("../prisma");

  const rows = await prisma.governmentReference.findMany({
    where: { referenceType: "scotus_case", mergedIntoId: null, fullText: { not: null } },
    select: { id: true, fullText: true, description: true },
  });

  let repaired = 0;
  for (const row of rows) {
    // ONE RULE, NOT A LIST OF KNOWN BAD SHAPES. A description survives if it
    // would survive on the way in — same guard, same answer. Whatever furniture
    // turns up next is refused without this function learning about it.
    if (cleanOpinionSnippet(row.description)) continue;

    const derived = deriveOpinionDescription(row.fullText);
    if (!derived || derived === row.description) continue;

    await prisma.governmentReference.update({
      where: { id: row.id },
      data: { description: derived },
    });
    repaired += 1;
  }
  return repaired;
}
