/**
 * How Congress actually voted, from the chambers themselves.
 *
 * THE MISSING HALF OF THE REPRESENTATION GAP. This platform could say "73% of
 * the citizens here oppose this" and had nothing to hold it against: nothing
 * stored a roll call, `officialVotes` on the bill card was set by nothing, and
 * the PulseGap component had never once rendered for a real record. The single
 * most compelling sentence the product can say — "the people here said 73%
 * oppose; the House passed it 218-210" — could not be said at all.
 *
 * IT WAS NEVER BLOCKED ON AN API KEY. This was written up as needing a
 * congress.gov key that this environment does not have. It does not need one.
 * Both chambers publish every roll call themselves, as XML, unauthenticated:
 *
 *   senate.gov      /legislative/LIS/roll_call_votes/vote{congress}{session}/
 *                   vote_{congress}_{session}_{roll}.xml
 *   clerk.house.gov /evs/{year}/roll{roll}.xml
 *
 * Both carry member-level detail — name, party, state and how each one voted —
 * with the official member ids (LIS for the Senate, Bioguide for the House),
 * which is what makes "how did MY representative vote" answerable later.
 *
 * NOTHING HERE IS INVENTED. Every parser returns null rather than a guess when
 * a document is not the shape it expects, and every stored row carries the URL
 * it came from so any number the platform publishes is traceable to an
 * official page.
 */

import { canonicalReferenceId, ReferenceKind } from "./master-reference-id";

export interface MemberVote {
  memberId: string;
  lastName: string;
  firstName: string | null;
  party: string;
  state: string;
  district: string | null;
  voteCast: string;
}

export interface ParsedRollCall {
  chamber: "house" | "senate";
  congress: number;
  session: number;
  rollNumber: number;
  year: number | null;
  legisNumber: string | null;
  /** The canonical record id, when the measure could be recognised. */
  masterReferenceId: string | null;
  question: string;
  result: string;
  description: string | null;
  votedAt: Date;
  yea: number;
  nay: number;
  present: number;
  notVoting: number;
  sourceUrl: string;
  members: MemberVote[];
}

/** One tag's text content. Deliberately not a full XML parser. */
function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? match[1]!.trim() : null;
}

function intTag(xml: string, name: string): number | null {
  const raw = tag(xml, name);
  if (raw === null) return null;
  const value = Number.parseInt(raw.replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(value) ? value : null;
}

/** XML entities the chambers actually emit. */
function decode(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "H R 4058", "S.J.Res. 82", "H.RES. 12" — every spelling the two chambers
 * use — into the one id this platform stores.
 *
 * Returns null for anything that is not a measure: the Senate votes on
 * nominations ("PN373") and motions constantly, and those have no bill record
 * to attach a gap to.
 */
export function referenceIdFromLegisNumber(
  legisNumber: string | null | undefined,
  congress: number,
): string | null {
  if (!legisNumber) return null;

  const cleaned = legisNumber.replace(/\./g, " ").replace(/\s+/g, " ").trim();
  // "H R 4058" / "S J Res 82" / "H Res 12" — letters then a number.
  const match = /^([A-Za-z][A-Za-z\s]*?)\s*(\d+)$/.exec(cleaned);
  if (!match) return null;

  const type = match[1]!.replace(/\s+/g, "").toLowerCase();
  const number = match[2]!;
  if (!/^(hr|s|hjres|sjres|hconres|sconres|hres|sres)$/.test(type)) return null;

  return canonicalReferenceId(ReferenceKind.BILL, `${type}-${number}-${congress}`);
}

/**
 * Where the chambers serve their own documents.
 *
 * Overridable so the fetch path can be exercised against a local server that
 * replays the recorded XML. Without that, the only way to run this code would
 * be to reach senate.gov from wherever the tests happen to be, and a network
 * call in a test suite is a flake waiting to happen. Unset in production,
 * where it points at the chambers themselves.
 */
export const SENATE_ORIGIN = process.env.SENATE_ORIGIN || "https://www.senate.gov";
export const HOUSE_ORIGIN = process.env.HOUSE_ORIGIN || "https://clerk.house.gov";

export function senateRollCallUrl(
  congress: number,
  session: number,
  roll: number,
  origin = SENATE_ORIGIN,
): string {
  const padded = String(roll).padStart(5, "0");
  return `${origin}/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${padded}.xml`;
}

export function houseRollCallUrl(year: number, roll: number, origin = HOUSE_ORIGIN): string {
  return `${origin}/evs/${year}/roll${String(roll).padStart(3, "0")}.xml`;
}

export function senateMenuUrl(congress: number, session: number, origin = SENATE_ORIGIN): string {
  return `${origin}/legislative/LIS/roll_call_lists/vote_menu_${congress}_${session}.xml`;
}

/**
 * Senate roll call XML.
 *
 * The date arrives as "December 18, 2025,  12:19 PM" — two spaces and all —
 * which Date can read once the stray comma is removed.
 */
export function parseSenateRollCall(xml: string, sourceUrl: string): ParsedRollCall | null {
  const congress = intTag(xml, "congress");
  const session = intTag(xml, "session");
  const rollNumber = intTag(xml, "vote_number");
  if (congress === null || session === null || rollNumber === null) return null;

  const counts = tag(xml, "count") ?? xml;
  const yea = intTag(counts, "yeas");
  const nay = intTag(counts, "nays");
  if (yea === null || nay === null) return null;

  const rawDate = tag(xml, "vote_date");
  const votedAt = rawDate ? new Date(rawDate.replace(/,\s*(\d{1,2}:)/, " $1")) : null;
  if (!votedAt || Number.isNaN(votedAt.getTime())) return null;

  const members: MemberVote[] = [];
  for (const block of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
    const body = block[1]!;
    const memberId = tag(body, "lis_member_id");
    const lastName = tag(body, "last_name");
    const voteCast = tag(body, "vote_cast");
    if (!memberId || !lastName || !voteCast) continue;

    members.push({
      memberId,
      lastName: decode(lastName),
      firstName: tag(body, "first_name") ? decode(tag(body, "first_name")!) : null,
      party: tag(body, "party") ?? "",
      state: tag(body, "state") ?? "",
      // The Senate has no districts.
      district: null,
      voteCast: decode(voteCast),
    });
  }

  const legisNumber = tag(xml, "vote_title") ?? tag(xml, "document_name");

  return {
    chamber: "senate",
    congress,
    session,
    rollNumber,
    year: intTag(xml, "congress_year"),
    legisNumber: legisNumber ? decode(legisNumber) : null,
    masterReferenceId: referenceIdFromLegisNumber(
      legisNumber ? decode(legisNumber) : null,
      congress,
    ),
    question: decode(tag(xml, "question") ?? tag(xml, "vote_question_text") ?? "Unknown question"),
    result: decode(tag(xml, "vote_result_text") ?? tag(xml, "vote_result") ?? "Unknown result"),
    description: tag(xml, "vote_document_text")
      ? decode(tag(xml, "vote_document_text")!)
      : null,
    votedAt,
    yea,
    nay,
    present: intTag(counts, "present") ?? 0,
    notVoting: intTag(counts, "absent") ?? 0,
    sourceUrl,
    members,
  };
}

/**
 * House clerk roll call XML.
 *
 * The House numbers rolls per CALENDAR YEAR rather than per session, so the
 * year is part of the identity and the session is derived from it: the first
 * year of a Congress is session 1, the second is session 2.
 */
export function parseHouseRollCall(xml: string, sourceUrl: string): ParsedRollCall | null {
  const congress = intTag(xml, "congress");
  const rollNumber = intTag(xml, "rollcall-num");
  if (congress === null || rollNumber === null) return null;

  const totals = /<vote-totals>([\s\S]*?)<\/vote-totals>/.exec(xml)?.[1] ?? "";
  const totalsBlock = /<totals-by-vote>([\s\S]*?)<\/totals-by-vote>/.exec(totals)?.[1] ?? totals;

  const yea = intTag(totalsBlock, "yea-total") ?? intTag(totalsBlock, "aye-total");
  const nay = intTag(totalsBlock, "nay-total") ?? intTag(totalsBlock, "no-total");
  if (yea === null || nay === null) return null;

  const actionDate = tag(xml, "action-date");
  const actionTime = /<action-time[^>]*>([\s\S]*?)<\/action-time>/.exec(xml)?.[1]?.trim();
  const votedAt = actionDate
    ? new Date(`${actionDate.replace(/-/g, " ")} ${actionTime ?? ""}`.trim())
    : null;
  if (!votedAt || Number.isNaN(votedAt.getTime())) return null;

  const year = votedAt.getUTCFullYear();
  // 119th Congress runs 2025-2026: an odd first year, so session 1 is the odd
  // year. Derived rather than parsed, because the clerk prints "1st"/"2nd".
  const session = year % 2 === 1 ? 1 : 2;

  const members: MemberVote[] = [];
  for (const block of xml.matchAll(/<recorded-vote>([\s\S]*?)<\/recorded-vote>/g)) {
    const body = block[1]!;
    const legislator = /<legislator([^>]*)>([\s\S]*?)<\/legislator>/.exec(body);
    if (!legislator) continue;

    const attrs = legislator[1]!;
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? null;

    const memberId = attr("name-id");
    const voteCast = tag(body, "vote");
    if (!memberId || !voteCast) continue;

    members.push({
      memberId,
      lastName: decode(attr("unaccented-name") ?? attr("sort-field") ?? legislator[2]!),
      firstName: null,
      party: attr("party") ?? "",
      state: attr("state") ?? "",
      // The clerk does not print the district in this document; the member id
      // is the stable key, and inventing a district here would be fiction.
      district: null,
      voteCast: decode(voteCast),
    });
  }

  const legisNumber = tag(xml, "legis-num");

  return {
    chamber: "house",
    congress,
    session,
    rollNumber,
    year,
    legisNumber: legisNumber ? decode(legisNumber) : null,
    masterReferenceId: referenceIdFromLegisNumber(
      legisNumber ? decode(legisNumber) : null,
      congress,
    ),
    question: decode(tag(xml, "vote-question") ?? "Unknown question"),
    result: decode(tag(xml, "vote-result") ?? "Unknown result"),
    description: tag(xml, "vote-desc") ? decode(tag(xml, "vote-desc")!) : null,
    votedAt,
    yea,
    nay,
    present: intTag(totalsBlock, "present-total") ?? 0,
    notVoting: intTag(totalsBlock, "not-voting-total") ?? 0,
    sourceUrl,
    members,
  };
}

export interface SenateMenuEntry {
  rollNumber: number;
  issue: string;
  question: string;
  result: string;
  masterReferenceId: string | null;
}

/**
 * The Senate's own index of a session's roll calls, so a sync knows what
 * exists without probing numbers one at a time.
 */
export function parseSenateMenu(xml: string, congress: number): SenateMenuEntry[] {
  const entries: SenateMenuEntry[] = [];

  for (const block of xml.matchAll(/<vote>([\s\S]*?)<\/vote>/g)) {
    const body = block[1]!;
    const rollNumber = intTag(body, "vote_number");
    if (rollNumber === null) continue;

    const issue = decode(tag(body, "issue") ?? "");
    entries.push({
      rollNumber,
      issue,
      question: decode(tag(body, "question") ?? ""),
      result: decode(tag(body, "result") ?? ""),
      masterReferenceId: referenceIdFromLegisNumber(issue, congress),
    });
  }

  return entries;
}

/**
 * Store one parsed roll call, linking it to the record it belongs to.
 *
 * Idempotent on (chamber, congress, session, rollNumber): a re-sync updates
 * the tallies rather than duplicating them, because the chambers do correct
 * their own records after the fact — the Senate document carries a
 * `modify_date` for exactly that reason.
 */
export async function storeRollCall(
  parsed: ParsedRollCall,
  db: typeof import("../prisma").prisma,
): Promise<{ id: string; linked: boolean }> {
  // Resolve the record by its canonical id, and by any name it has ever had,
  // so a roll call still lands on a bill that has since been renumbered or
  // merged into another.
  let governmentReferenceId: string | null = null;
  if (parsed.masterReferenceId) {
    const reference = await db.governmentReference.findFirst({
      where: { masterReferenceId: parsed.masterReferenceId },
      select: { id: true, mergedIntoId: true },
    });
    // A vote on a card that was merged away belongs to the surviving record —
    // the same rule a citizen's vote follows.
    governmentReferenceId = reference?.mergedIntoId ?? reference?.id ?? null;
  }

  const data = {
    chamber: parsed.chamber,
    congress: parsed.congress,
    session: parsed.session,
    rollNumber: parsed.rollNumber,
    year: parsed.year,
    legisNumber: parsed.legisNumber,
    masterReferenceId: parsed.masterReferenceId,
    governmentReferenceId,
    question: parsed.question,
    result: parsed.result,
    description: parsed.description,
    votedAt: parsed.votedAt,
    yea: parsed.yea,
    nay: parsed.nay,
    present: parsed.present,
    notVoting: parsed.notVoting,
    sourceUrl: parsed.sourceUrl,
  };

  const rollCall = await db.rollCall.upsert({
    where: {
      chamber_congress_session_rollNumber: {
        chamber: parsed.chamber,
        congress: parsed.congress,
        session: parsed.session,
        rollNumber: parsed.rollNumber,
      },
    },
    create: data,
    update: data,
    select: { id: true },
  });

  if (parsed.members.length > 0) {
    // Replaced wholesale rather than merged: a corrected roll call can change
    // how somebody is recorded, and a stale row would leave a member on record
    // with a vote the chamber no longer says they cast.
    await db.rollCallMemberVote.deleteMany({ where: { rollCallId: rollCall.id } });
    await db.rollCallMemberVote.createMany({
      data: parsed.members.map((member) => ({ ...member, rollCallId: rollCall.id })),
      skipDuplicates: true,
    });
  }

  return { id: rollCall.id, linked: governmentReferenceId !== null };
}

/** Fetch and parse one Senate roll call. Null when the chamber does not serve it. */
export async function fetchSenateRollCall(
  congress: number,
  session: number,
  roll: number,
  origin = SENATE_ORIGIN,
): Promise<ParsedRollCall | null> {
  const url = senateRollCallUrl(congress, session, roll, origin);
  const response = await fetch(url, {
    headers: { "User-Agent": "CivicVoice/1.0 (civic transparency; contact via app)" },
  });
  if (!response.ok) return null;
  return parseSenateRollCall(await response.text(), url);
}

/** Fetch and parse one House roll call. Null when the clerk does not serve it. */
export async function fetchHouseRollCall(
  year: number,
  roll: number,
  origin = HOUSE_ORIGIN,
): Promise<ParsedRollCall | null> {
  const url = houseRollCallUrl(year, roll, origin);
  const response = await fetch(url, {
    headers: { "User-Agent": "CivicVoice/1.0 (civic transparency; contact via app)" },
  });
  if (!response.ok) return null;
  return parseHouseRollCall(await response.text(), url);
}

/** The Senate's index of a session's roll calls. */
export async function fetchSenateMenu(
  congress: number,
  session: number,
  origin = SENATE_ORIGIN,
): Promise<SenateMenuEntry[]> {
  const url = senateMenuUrl(congress, session, origin);
  const response = await fetch(url, {
    headers: { "User-Agent": "CivicVoice/1.0 (civic transparency; contact via app)" },
  });
  if (!response.ok) return [];
  return parseSenateMenu(await response.text(), congress);
}
