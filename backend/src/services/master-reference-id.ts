/**
 * The one place a master reference id is built, parsed, or normalized.
 *
 * A master reference id is the permanent name of a piece of government
 * business. Everything on the platform — posts, votes, briefs, search results,
 * the B2B feed — points at a record through this string, so if two code paths
 * spell the same law differently they produce two records, two vote pools, and
 * two briefs for one law. That is not hypothetical: before this module existed,
 * the daily sync wrote `s-res-829-119` while search computed `sres-829-119`,
 * and the record was invisible to the search that was meant to find it.
 *
 * Three rules this module exists to keep:
 *
 *   1. Build and parse are inverses. `parse(build(x))` is `x`, for every bill
 *      type, every executive order, every docket. Enforced by test, not by
 *      hope — see tests/master-reference-id.test.ts.
 *   2. Parsing is tolerant, building is strict. A person types "H.R. 4836",
 *      congress.gov says "HR", the old normalizer left "hr-es-1443-119" in the
 *      database. All three have to arrive at one id. Only one spelling is ever
 *      written back.
 *   3. An id that cannot be understood is passed through cleaned, never
 *      mangled. Namespaced ids the library resolver mints for documents with no
 *      official number — `fr-2026-08928` for a Federal Register rule,
 *      `cl-9412` for a CourtListener opinion — must survive this module
 *      untouched.
 *
 * WHY THE OLD NORMALIZER MANGLED FOUR OF EIGHT BILL TYPES
 *
 * It matched the bill prefix with an alternation written shortest-first:
 *
 *     /^(h\.?r\.?|s\.?|h\.?j\.?res\.?|...|h\.?res\.?|s\.?res\.?)[\s-]*!/
 *
 * JavaScript alternation is leftmost-first, not longest-match, and nothing
 * after the group forced a backtrack. So `hres-1443-119` matched `h\.?r\.?`
 * against "hr" and became `hr-es-1443-119`; `sres`, `sjres` and `sconres` all
 * lost their first letter to the bare `s\.?` branch the same way. `hr`, `s`,
 * `hjres` and `hconres` happened to be reachable first and survived, which is
 * why the bug looked like it did not exist.
 *
 * This module does not match prefixes against an alternation at all. It splits
 * letters from digits and then asks whether the letters, with separators
 * removed, name a bill type. There is no ordering to get wrong.
 */

/** The eight measure types Congress uses, exactly as congress.gov spells them. */
export const BILL_TYPES = [
  "hr",
  "s",
  "hjres",
  "sjres",
  "hconres",
  "sconres",
  "hres",
  "sres",
] as const;

export type BillType = (typeof BILL_TYPES)[number];

const BILL_TYPE_SET: ReadonlySet<string> = new Set(BILL_TYPES);

export function isBillType(value: string): value is BillType {
  return BILL_TYPE_SET.has(value);
}

/** The three kinds of record the platform stores, matching `referenceType`. */
export const ReferenceKind = {
  BILL: "bill",
  EXECUTIVE_ORDER: "executive_order",
  SCOTUS_CASE: "scotus_case",
} as const;

export type ReferenceKindValue = (typeof ReferenceKind)[keyof typeof ReferenceKind];

/**
 * A master reference id taken apart.
 *
 * `congress` is nullable because a bill can be named without one — a user
 * typing "HR 4836" has not told us which Congress, and inventing 119 for them
 * would attach their post to a law they did not choose. Callers that know the
 * Congress supply it; callers that do not get a bill key they can complete or
 * reject, rather than a confident guess.
 */
export type ReferenceKey =
  | { kind: "bill"; billType: BillType; number: string; congress: number | null }
  | { kind: "executive_order"; eoNumber: string }
  | { kind: "scotus_case"; docket: string };

/**
 * Reduce raw input to letters, digits and single hyphens.
 *
 * Dots, spaces and underscores are all separators people actually type
 * ("H.R. 4836", "hr_4836"). En and em dashes arrive from copy-paste out of PDFs
 * and rendered web pages, where a hyphen is often typeset as one.
 */
function clean(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, "-") // dashes of every width → hyphen
    .replace(/[\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * The highest Congress number this parser will believe.
 *
 * A trailing number has to be told apart from a bill number, and the only thing
 * separating them is magnitude: the 119th Congress sits in 2025, so a value
 * past 200 is somewhere in the 2160s and is far likelier to be a second bill
 * number than a session of Congress. Deliberately generous — this is a sanity
 * bound, not a validity check, and hard-coding "119" here would silently break
 * the parser the moment Congress turns over.
 */
const MAX_PLAUSIBLE_CONGRESS = 200;

/**
 * Split a cleaned bill id into its letter run and its numbers.
 *
 * The letter run may contain hyphens, because ids written by the old normalizer
 * have them in the middle of a type: `hr-es-1443-119` is `hres` 1443 of the
 * 119th, and `s-res-829-119` is `sres` 829. Rejoining the letters is what lets
 * every one of those records be found again under its correct name.
 */
const BILL_SHAPE = /^([a-z][a-z-]*?)-?(\d{1,6})(?:-(\d{1,3}))?$/;

function parseBill(raw: string): ReferenceKey | null {
  const match = BILL_SHAPE.exec(clean(raw));
  if (!match?.[1] || !match[2]) return null;

  const billType = match[1].replace(/-/g, "");
  if (!isBillType(billType)) return null;

  const congress = match[3] ? Number(match[3]) : null;
  if (congress !== null && (congress < 1 || congress > MAX_PLAUSIBLE_CONGRESS)) return null;

  // Leading zeros are not part of a bill number ("hr-0082" and "hr-82" are one
  // bill), but a bill number is never zero either, so an all-zero run is not a
  // bill id at all.
  const number = match[2].replace(/^0+(?=\d)/, "");
  if (number === "0") return null;

  return { kind: "bill", billType, number, congress };
}

/** "eo", "e.o.", "executive order" — the three ways the prefix is written. */
const EO_SHAPE = /^(?:e-?o|executive-?order)-?(.+)$/;

function parseExecutiveOrder(raw: string): ReferenceKey | null {
  const match = EO_SHAPE.exec(clean(raw));
  if (!match?.[1]) return null;

  // Two kinds of tail. A numbered order carries its EO number ("14147"); an
  // order the Federal Register has published but not yet numbered carries its
  // document number ("2026-08928"). Both are kept as written — the document
  // number's hyphen is significant, and stripping non-digits the way the old
  // code did would have turned it into "202608928".
  const tail = match[1].replace(/^-+|-+$/g, "");
  if (!tail) return null;

  return { kind: "executive_order", eoNumber: tail };
}

/**
 * Docket numbers as the Court prints them: "22-451", "23A994", "22o141".
 *
 * Two prefixes get stripped. "No." is how a docket is cited in an opinion
 * caption and how people paste it. "scotus-" appeared on some rows and in the
 * display formatter, so it is accepted on the way in even though it is never
 * written on the way out.
 */
function parseScotusCase(raw: string): ReferenceKey | null {
  let docket = clean(raw);

  // Only strip "no" when a digit follows, so a docket is never confused with a
  // case name or a namespaced id that happens to start with those letters.
  docket = docket.replace(/^no-(?=\d)/, "");
  docket = docket.replace(/^scotus-(?=[\da-z])/, "");

  // A docket is a term number, a hyphen, and a sequence — optionally with a
  // letter for applications ("23A994") and original-jurisdiction cases
  // ("22O141"). Anything else is not a docket and is left for the caller to
  // pass through unchanged.
  if (!/^\d{1,3}-?[a-z]?\d{1,6}$/.test(docket)) return null;

  return { kind: "scotus_case", docket };
}

/**
 * Take a master reference id (or something a person typed) apart.
 *
 * Returns null when the input is not a name of that kind. Null is a real
 * answer, not a failure — `fr-2026-08928` is a legitimate id that is not an
 * executive order number, and the caller's job is to leave it alone.
 */
export function parseReferenceId(kind: ReferenceKindValue, raw: string): ReferenceKey | null {
  if (!raw?.trim()) return null;

  switch (kind) {
    case ReferenceKind.BILL:
      return parseBill(raw);
    case ReferenceKind.EXECUTIVE_ORDER:
      return parseExecutiveOrder(raw);
    case ReferenceKind.SCOTUS_CASE:
      return parseScotusCase(raw);
    default:
      return null;
  }
}

/** The one spelling of an id that is ever written to the database. */
export function buildReferenceId(key: ReferenceKey): string {
  switch (key.kind) {
    case "bill":
      return key.congress === null
        ? `${key.billType}-${key.number}`
        : `${key.billType}-${key.number}-${key.congress}`;
    case "executive_order":
      return `eo-${key.eoNumber}`;
    case "scotus_case":
      return key.docket;
  }
}

/**
 * Canonical form of an id, whatever shape it arrived in.
 *
 * Anything this module recognises comes back in its one true spelling.
 * Anything it does not comes back cleaned — lowercased, single-hyphenated —
 * and otherwise untouched, so ids minted outside this scheme keep working.
 */
export function canonicalReferenceId(kind: ReferenceKindValue, raw: string): string {
  const key = parseReferenceId(kind, raw);
  return key ? buildReferenceId(key) : clean(raw);
}

/**
 * Build a bill id from congress.gov's own fields.
 *
 * The API gives type, number and congress separately, which is the only place
 * they arrive already separated. Returns null rather than guessing when the
 * type is not one of the eight — a shape congress.gov has never returned, but
 * writing a record named after a typo is worse than writing none.
 */
export function billReferenceId(input: {
  type: string;
  number: string | number;
  congress: number;
}): string | null {
  const billType = input.type.toLowerCase().replace(/[^a-z]/g, "");
  if (!isBillType(billType)) return null;

  const number = String(input.number).replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!number || number === "0") return null;

  return buildReferenceId({ kind: "bill", billType, number, congress: input.congress });
}
