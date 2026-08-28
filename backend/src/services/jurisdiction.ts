/**
 * WHERE A VOICE BELONGS, AND WHAT MAY BE SAID ABOUT A PLACE.
 *
 * This file exists because the B2B dashboard used to answer geographic
 * questions it had no data for. It took the one national sentiment figure,
 * multiplied it by each state's share of the 435 House seats, and served that
 * as "California." Every state got the same sentiment score, every issue
 * category within a state got the same score, the representative's name was the
 * literal string "Representative", and the party was a coin flip re-rolled on
 * every request — refreshing the page changed California's delegation.
 *
 * Three clauses of the platform's own founding documents bear on that, and all
 * three are marked enforcedInCode:
 *
 *   Constitution, Article III §3 (Nothing Invented) — "Every Record the
 *   platform carries shall trace back to a real act of government and to the
 *   source that issued it ... and shall not invent, embellish or estimate it."
 *   Invented districts, invented representatives and invented parties are that
 *   drift, exactly.
 *
 *   Amendment IV — "The platform shall collect only what it needs to function.
 *   It shall demand no proof of a Citizen's identity or nationality." A
 *   jurisdiction is offered by the person it describes and is never required;
 *   nothing here checks anybody's citizenship, and the Amendment no longer
 *   claims otherwise.
 *
 *   Constitution, Article I §1 — "The Public Pulse shall be the only official
 *   output of this platform." Aggregate is the product. An individual never
 *   is.
 *
 * So: districts and representatives come from congress.gov and nowhere else, a
 * person's district comes from that person and nowhere else, and a place with
 * too few voices to aggregate reports that it has too few voices rather than
 * reporting a number.
 */

import { prisma } from "../prisma";
import { getMembers } from "./congress-members";

// ---------------------------------------------------------------------------
// The privacy floor
// ---------------------------------------------------------------------------

/**
 * The fewest people whose positions may be combined into a published figure.
 *
 * WHY A FLOOR AT ALL. "CA-12 is 100% opposed" said of a district where one
 * person has voted is not a statistic; it is that person's ballot, published,
 * with their address attached. Article IV forbids handing personal identity to
 * third parties, and a cell of one is personal identity wearing a percentage
 * sign. A cell of two is barely better: either member can subtract their own
 * vote and read the other's.
 *
 * FIVE, and the number is a judgement rather than a derivation. It is small
 * enough that a district with any real activity clears it, and large enough
 * that no client can single anybody out by watching a cell change. It is
 * deliberately not configurable by environment variable: a privacy floor that
 * can be lowered from a deploy console is a privacy floor that will be, at
 * 2am, by somebody who needs a demo to look busier.
 */
export const MIN_COHORT = 5;

/** What a place reports when it cannot report numbers. */
export type Suppressed = {
  enough: false;
  /** How many people HAVE spoken. Safe to publish: it identifies nobody. */
  voices: number;
  reason: "not_enough_voices";
  floor: number;
};

export type Aggregate = {
  enough: true;
  voices: number;
  support: number;
  oppose: number;
  /** -1 to 1. Only ever computed over at least MIN_COHORT people. */
  score: number;
};

export type PlaceResult = Aggregate | Suppressed;

/**
 * Apply the floor. The ONLY way a geographic figure becomes publishable.
 *
 * Every caller goes through here rather than checking the count themselves,
 * because "did I remember the threshold on this endpoint" is a question that
 * eventually gets answered no. tests/jurisdiction.test.ts reads this file's
 * callers and fails on one that builds a result by hand.
 */
export function aggregate(support: number, oppose: number): PlaceResult {
  const voices = support + oppose;
  if (voices < MIN_COHORT) {
    return { enough: false, voices, reason: "not_enough_voices", floor: MIN_COHORT };
  }
  return {
    enough: true,
    voices,
    support,
    oppose,
    score: parseFloat(((support - oppose) / voices).toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// The real map
// ---------------------------------------------------------------------------

export interface DistrictOption {
  /** "CA-12", or "AK-AL" for a state with a single at-large seat. */
  districtId: string;
  stateCode: string;
  stateName: string;
  /** null for an at-large seat. */
  district: number | null;
  /** The sitting member, from congress.gov. Null if the seat is vacant. */
  representative: {
    name: string;
    party: string;
    photoUrl: string | null;
  } | null;
}

/** "CA" + 12 -> "CA-12"; "AK" + null -> "AK-AL". One spelling, everywhere. */
export function districtIdOf(stateCode: string, district: number | null): string {
  const state = stateCode.toUpperCase();
  // congress.gov reports an at-large seat as district 0 in some responses and
  // null in others. Both mean the same seat and must not become two ids.
  if (district === null || district === 0) return `${state}-AL`;
  return `${state}-${district}`;
}

/**
 * Every House district there actually is, with who holds it.
 *
 * Built from the congress.gov roster the rest of the app already uses — the
 * same source that fills the Delegates screen and the Representation Gap. There
 * is no second list of districts in this codebase, deliberately: a hardcoded
 * table of states was what produced the fiction this file replaces, and it went
 * stale the moment a seat changed hands.
 *
 * Senators are excluded. They have no district, and a two-per-state seat is not
 * a place somebody lives in.
 */
export async function listDistricts(): Promise<{
  districts: DistrictOption[];
  source: "congress.gov" | "fallback";
  congress: number;
}> {
  const roster = await getMembers();

  const districts = roster.members
    .filter((m) => m.chamber === "house")
    .map((m) => ({
      districtId: districtIdOf(m.state, m.district),
      stateCode: m.state.toUpperCase(),
      stateName: m.stateName,
      district: m.district === 0 ? null : m.district,
      representative: {
        name: m.name,
        party: m.partyName,
        photoUrl: m.photoUrl,
      },
    }))
    .sort((a, b) =>
      a.stateCode === b.stateCode
        ? (a.district ?? 0) - (b.district ?? 0)
        : a.stateCode.localeCompare(b.stateCode),
    );

  return { districts, source: roster.source, congress: roster.congress };
}

/**
 * Is this a district that exists?
 *
 * Checked against the live roster rather than a regex, so "CA-99" is refused
 * even though it is well-formed. A district nobody represents is a district
 * nobody lives in, and storing one would put a row in the database that no
 * aggregate could ever honestly place.
 */
export async function isRealDistrict(districtId: string): Promise<boolean> {
  const { districts } = await listDistricts();
  return districts.some((d) => d.districtId === districtId.toUpperCase());
}

/** The two-letter states that actually appear in the roster. */
export async function listStates(): Promise<{ stateCode: string; stateName: string }[]> {
  const { districts } = await listDistricts();
  const seen = new Map<string, string>();
  for (const d of districts) seen.set(d.stateCode, d.stateName);
  return [...seen.entries()]
    .map(([stateCode, stateName]) => ({ stateCode, stateName }))
    .sort((a, b) => a.stateName.localeCompare(b.stateName));
}

// ---------------------------------------------------------------------------
// How many people have actually said where they are
// ---------------------------------------------------------------------------

export interface Coverage {
  /** Accounts somebody can sign in with. */
  participants: number;
  /** Of those, how many have declared a district. */
  placed: number;
  /** Districts with at least one declared resident. */
  districtsRepresented: number;
  /** Districts clearing MIN_COHORT, i.e. districts that can be reported at all. */
  districtsReportable: number;
}

/**
 * The honesty header for every geographic response.
 *
 * A client reading a map deserves to know it is drawn from 40 people out of
 * 12,000, and no amount of shading conveys that. This is what lets a map say so
 * instead of implying national coverage it does not have.
 */
export async function coverage(): Promise<Coverage> {
  const [participants, placed, byDistrict] = await Promise.all([
    prisma.user.count({ where: { accounts: { some: { providerId: "credential" } } } }),
    prisma.user.count({ where: { districtId: { not: null } } }),
    prisma.user.groupBy({
      by: ["districtId"],
      where: { districtId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  return {
    participants,
    placed,
    districtsRepresented: byDistrict.length,
    districtsReportable: byDistrict.filter((d) => d._count._all >= MIN_COHORT).length,
  };
}

// ---------------------------------------------------------------------------
// The Pulse, by place
// ---------------------------------------------------------------------------

/**
 * ONLY REFERENCE VOTES ARE PLACEABLE.
 *
 * The legacy Vote table carries no link to anybody's jurisdiction and has taken
 * no new rows in months. Those votes still count nationally — they are real
 * positions real people took, and getPlatformCounts includes them — but they
 * cannot honestly be put on a map, so they are left off one. A geographic total
 * that quietly swept in unplaceable votes would be the apportionment bug again
 * in a smaller costume.
 *
 * A VOTE IS PLACED WHERE ITS VOTER SAYS THEY ARE, AT READ TIME. Somebody who
 * moves and updates their district moves their whole history with them, which
 * is right: the question a client is asking is "what does this district think",
 * and a person who no longer lives there is not part of the answer.
 */

/** support/oppose per place, counted. Places with no votes simply do not appear. */
export type PlaceCounts = Map<string, { support: number; oppose: number }>;

function foldRows(rows: { place: string | null; position: string; count: bigint }[]): PlaceCounts {
  const out: PlaceCounts = new Map();
  for (const row of rows) {
    if (!row.place) continue;
    const entry = out.get(row.place) ?? { support: 0, oppose: 0 };
    if (row.position === "support") entry.support += Number(row.count);
    else if (row.position === "oppose") entry.oppose += Number(row.count);
    out.set(row.place, entry);
  }
  return out;
}

/**
 * Votes grouped by the voter's district.
 *
 * `category` narrows to one policy area — that is what makes a real
 * per-category breakdown possible. The old one gave every category in every
 * state the same number, because it was the same number.
 */
export async function pulseByDistrict(category?: string): Promise<PlaceCounts> {
  const rows = category
    ? await prisma.$queryRaw<{ place: string | null; position: string; count: bigint }[]>`
        SELECT u."districtId" AS place, v."position", COUNT(*)::bigint AS count
        FROM "GovernmentReferenceVote" v
        JOIN "User" u ON u."id" = v."userId"
        JOIN "GovernmentReference" r ON r."id" = v."governmentReferenceId"
        WHERE u."districtId" IS NOT NULL AND r."category" = ${category}
        GROUP BY u."districtId", v."position"
      `
    : await prisma.$queryRaw<{ place: string | null; position: string; count: bigint }[]>`
        SELECT u."districtId" AS place, v."position", COUNT(*)::bigint AS count
        FROM "GovernmentReferenceVote" v
        JOIN "User" u ON u."id" = v."userId"
        WHERE u."districtId" IS NOT NULL
        GROUP BY u."districtId", v."position"
      `;
  return foldRows(rows);
}

/** The same, by state. A state's voices are its districts' voices summed. */
export async function pulseByState(category?: string): Promise<PlaceCounts> {
  const rows = category
    ? await prisma.$queryRaw<{ place: string | null; position: string; count: bigint }[]>`
        SELECT u."stateCode" AS place, v."position", COUNT(*)::bigint AS count
        FROM "GovernmentReferenceVote" v
        JOIN "User" u ON u."id" = v."userId"
        JOIN "GovernmentReference" r ON r."id" = v."governmentReferenceId"
        WHERE u."stateCode" IS NOT NULL AND r."category" = ${category}
        GROUP BY u."stateCode", v."position"
      `
    : await prisma.$queryRaw<{ place: string | null; position: string; count: bigint }[]>`
        SELECT u."stateCode" AS place, v."position", COUNT(*)::bigint AS count
        FROM "GovernmentReferenceVote" v
        JOIN "User" u ON u."id" = v."userId"
        WHERE u."stateCode" IS NOT NULL
        GROUP BY u."stateCode", v."position"
      `;
  return foldRows(rows);
}

/** People who have declared each district, whether or not they have voted. */
export async function residentsByDistrict(): Promise<Map<string, number>> {
  const rows = await prisma.user.groupBy({
    by: ["districtId"],
    where: { districtId: { not: null } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.districtId as string, r._count._all]));
}

/** The policy areas that actually exist on stored records. Never a fixed list. */
export async function realCategories(): Promise<string[]> {
  const rows = await prisma.governmentReference.findMany({
    where: { category: { not: null }, mergedIntoId: null },
    select: { category: true },
    distinct: ["category"],
  });
  return rows
    .map((r) => r.category)
    .filter((c): c is string => Boolean(c))
    .sort();
}

export interface PlaceReport {
  districtId: string;
  stateCode: string;
  stateName: string;
  district: number | null;
  representative: DistrictOption["representative"];
  /** People here who have declared this district. */
  residents: number;
  /** The Pulse here, or why it cannot be shown. */
  pulse: PlaceResult;
}

/**
 * Every district we can say anything about, with the floor already applied.
 *
 * Districts nobody has claimed are omitted rather than returned at zero. An
 * empty map is the honest picture of a platform whose members have not said
 * where they are; a fully-coloured one built from zeros is the picture that got
 * us here.
 */
export async function districtReports(category?: string): Promise<PlaceReport[]> {
  const [{ districts }, votes, residents] = await Promise.all([
    listDistricts(),
    pulseByDistrict(category),
    residentsByDistrict(),
  ]);

  const byId = new Map(districts.map((d) => [d.districtId, d]));
  const places = new Set<string>([...votes.keys(), ...residents.keys()]);

  const reports: PlaceReport[] = [];
  for (const districtId of places) {
    const known = byId.get(districtId);
    // A stored district that is not in the current roster — a seat that was
    // redistricted away since somebody set it. Skipped rather than reported
    // under a name that no longer exists.
    if (!known) continue;

    const counts = votes.get(districtId) ?? { support: 0, oppose: 0 };
    reports.push({
      districtId,
      stateCode: known.stateCode,
      stateName: known.stateName,
      district: known.district,
      representative: known.representative,
      residents: residents.get(districtId) ?? 0,
      pulse: aggregate(counts.support, counts.oppose),
    });
  }

  return reports.sort((a, b) => b.residents - a.residents || a.districtId.localeCompare(b.districtId));
}
