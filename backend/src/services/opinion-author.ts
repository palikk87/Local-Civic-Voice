/**
 * WHO WROTE THIS, READ OUT OF THE OPINION ITSELF.
 *
 * WHY THIS EXISTS WHEN THE COURT PUBLISHES A TABLE OF AUTHORS. Because the
 * table only goes back to October Term 2018. Rodriguez v. United States was
 * decided in 2015 and Marbury in 1803; neither is on a slip opinion page and
 * neither ever will be. The opinion text we already hold is the only source
 * left, and it is the Court's own words.
 *
 * THE COURT'S CONVENTIONS, TAKEN FROM THE REAL STORED TEXT rather than guessed
 * at. Every line below appears verbatim in a ruling this platform holds:
 *
 *   GINSBURG, J., delivered the opinion of the Court, in which ROBERTS, ...
 *   JUSTICE GINSBURG delivered the opinion of the Court.
 *   ALITO, J., announced the judgment of the Court and ...
 *   JUSTICE ALITO announced the judgment of the Court and
 *   PER CURIAM.
 *
 * THE TRAP, AND IT IS A REAL ONE. "(per curiam)" appears inside Rodriguez —
 * three times — in CITATIONS TO OTHER CASES:
 *
 *   Pennsylvania v. Mimms, 434 U. S. 106, 111 (1977) (per curiam).
 *
 * A search for the phrase would therefore file Rodriguez, written by Justice
 * Ginsburg, as an unsigned opinion of the Court. So per curiam is recognised
 * ONLY as a heading on a line of its own, in the capitals the Court sets it in
 * — which is how the actual per curiam rulings here print it, checked against
 * National Park Service v. National Trust.
 *
 * A SURNAME IS NOT A PERSON until the bench says so. The text gives
 * "GINSBURG"; who that was depends on the day, and matching it against the
 * justices who sat is what turns it into a name. An ambiguous surname — two
 * Harlans, two Marshalls — resolves to NOBODY, because attributing a ruling to
 * the wrong justice is worse than attributing it to none.
 *
 * MARBURY STAYS EMPTY, AND THAT IS THE RIGHT ANSWER. Its stored text is the
 * 1803 report, which says only "Opinion of the court." Everyone knows Marshall
 * wrote it; the document does not say so, and this platform does not fill gaps
 * with things everyone knows.
 */

/** What the opinion says about its own authorship. */
export type OpinionAuthorship =
  | { kind: "justice"; surname: string }
  | { kind: "per_curiam" }
  | { kind: "unknown" };

/**
 * The syllabus form, which is how the Reporter of Decisions writes it:
 *
 *   GINSBURG, J., delivered the opinion of the Court, in which ...
 *   ALITO, J., announced the judgment of the Court and ...
 *   ROBERTS, C. J., delivered the opinion of the Court ...
 *
 * The surname is set in capitals, so this is deliberately case-SENSITIVE: it
 * is the capitals that distinguish an authorship line from ordinary prose.
 */
const SYLLABUS =
  /\b([A-Z][A-Z'’.‐-―-]{2,}),\s*(?:C\.\s*)?J\.,?\s*(?:delivered the opinion|announced the judgment)/;

/**
 * The opinion's own first line:
 *
 *   JUSTICE GINSBURG delivered the opinion of the Court.
 *   Justice GINSBURGdelivered the opinion of the Court.   <- real, no space
 *   CHIEF JUSTICE ROBERTS delivered ...
 *
 * The missing space is not a typo here — it is in the stored text, left by the
 * extraction that produced it, and a pattern that required the space would
 * miss the copy of the line that survives in the "## Lead" section.
 */
const OPINION_HEAD =
  /(?:CHIEF\s+)?JUSTICE\s+([A-Z][A-Za-z'’.‐-―-]{2,}?)\s*(?:delivered the opinion|announced the judgment)/i;

/**
 * "THE CHIEF JUSTICE delivered the opinion of the Court" — the Court's way of
 * referring to the Chief without a name, which only the bench can resolve.
 */
const THE_CHIEF = /\bTHE\s+CHIEF\s+JUSTICE\s+(?:delivered the opinion|announced the judgment)/i;

/**
 * PER CURIAM ONLY AS A HEADING. Never from prose, and never from a citation:
 * "(per curiam)" inside a parenthetical is a fact about a DIFFERENT case.
 */
const PER_CURIAM_HEADING = /^[ \t]*PER CURIAM[.:]?[ \t]*$/m;

/** A justice's surname, for matching against a bench. */
function surnameOf(name: string): string {
  const SUFFIX = /^(jr|sr|i{1,3}|iv|v)\.?$/i;
  const parts = name
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((part) => part && !SUFFIX.test(part));
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/** What the text says about who wrote it. Never guesses. */
export function authorshipIn(text: string | null | undefined): OpinionAuthorship {
  const opinion = text?.trim();
  if (!opinion) return { kind: "unknown" };

  const syllabus = SYLLABUS.exec(opinion);
  if (syllabus?.[1]) return { kind: "justice", surname: syllabus[1] };

  const head = OPINION_HEAD.exec(opinion);
  if (head?.[1]) return { kind: "justice", surname: head[1] };

  // Before the Chief-by-title form, because "THE CHIEF JUSTICE" names nobody
  // and a named justice elsewhere in the same opinion is the better answer.
  if (THE_CHIEF.test(opinion)) return { kind: "justice", surname: "THE CHIEF JUSTICE" };

  if (PER_CURIAM_HEADING.test(opinion)) return { kind: "per_curiam" };

  return { kind: "unknown" };
}

/**
 * The justice on this bench that the opinion is naming.
 *
 * Null when the surname fits nobody who sat, or when it fits more than one —
 * the Court has had two Harlans, two Marshalls and two Roberts, and a wrong
 * face over a wrong name on a Supreme Court ruling is worse than an empty one.
 */
export function justiceBySurname(
  surname: string,
  bench: Array<{ name: string; isChief?: boolean }>,
): string | null {
  if (surname === "THE CHIEF JUSTICE") {
    const chiefs = bench.filter((justice) => justice.isChief);
    return chiefs.length === 1 ? chiefs[0]!.name : null;
  }

  const wanted = surname.trim().toLowerCase().replace(/[.,]/g, "");
  const matches = bench.filter((justice) => surnameOf(justice.name) === wanted);
  return matches.length === 1 ? matches[0]!.name : null;
}
