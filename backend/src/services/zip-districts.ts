/**
 * WHICH DISTRICT IS THIS ZIP CODE IN?
 *
 * WHY THIS EXISTS. The district picker asked people to search by state,
 * district number, or their representative's name — and, reported plainly,
 * "almost no one knows what their district or reps are". Asking somebody to
 * name their congressional district in order to be counted in it is asking
 * them to already know the answer to the question they came here with.
 *
 * A ZIP CODE IS THE THING PEOPLE KNOW. So they type that, and it offers the
 * districts it falls in for them to pick from.
 *
 * THE ZIP IS NEVER STORED. It is a lookup key held for the length of one
 * request. What gets saved is the district they choose, exactly as before —
 * the profile screen has always said "no address, no ZIP kept, no location
 * from your device", and that stays true.
 *
 * WHERE THE MAPPING COMES FROM, and why it is not invented. The Census Bureau
 * publishes the official relationship between ZIP Code Tabulation Areas and
 * congressional districts, as a file, free, with no key and no account:
 *
 *   www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/
 *     tab20_cd11820_zcta520_natl.txt
 *
 * IT IS BUNDLED, NOT FETCHED. That file is nine megabytes and changes only
 * when districts are redrawn, so it is read once by scripts/build-zip-districts
 * and committed as src/data/zip-districts.ts — the same shape the congress.gov
 * roster's bundled fallback already uses. A lookup that depended on a live
 * download would fail on the first flaky morning and, worse, would have to
 * choose between telling somebody "we cannot check" and telling them "you are
 * in no district".
 *
 * NOTHING HERE IS TRUSTED ON ITS OWN. Every district this returns is checked
 * against the live congress.gov roster the rest of the platform runs on, so a
 * mapping to a seat that no longer exists is dropped rather than offered, and
 * the representative's name beside it is today's.
 *
 * A ZIP IS NOT A DISTRICT, and pretending otherwise is the failure mode. 90002
 * lies across four of them. The file gives the land area of each overlap, so
 * the answer is ordered by how much of the ZIP each district actually covers,
 * and the person chooses — which is also what makes a wrong guess impossible:
 * they can see their representative's name against each one.
 *
 * THE VINTAGE IS STATED, NOT HIDDEN. This file is drawn on the district
 * boundaries of the 118th Congress. A handful of states have redrawn theirs
 * since. That is why this suggests and never sets, and why the screen says
 * where the answer came from.
 */

import { getMembers } from "./congress-members";
import { districtIdOf, type DistrictOption } from "./jurisdiction";
import { ZIP_TO_DISTRICTS } from "../data/zip-districts";

/** The file the bundled map was built from. The generator script reads this. */
export const CENSUS_SOURCE =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11820_zcta520_natl.txt";

/** The vintage of the boundaries in that file, for the screen to say out loud. */
export const BOUNDARY_VINTAGE = "118th Congress district boundaries, 2020 Census";

/**
 * State FIPS to postal code.
 *
 * The one table here that is not fetched. It is the federal standard and it
 * does not move — but it is also the only place a typo could invent a district,
 * so nothing reaches a caller without being matched against the live roster
 * first, and a test asserts every code here is one congress.gov knows.
 */
const STATE_BY_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "60": "AS", "66": "GU", "69": "MP",
  "72": "PR", "78": "VI",
};

export { STATE_BY_FIPS };

/** One overlap: a district, and how much of the ZIP's land it covers. */
interface Overlap {
  districtId: string;
  landArea: number;
}

export type ZipMap = Map<string, Overlap[]>;

/**
 * Turn the Census file into ZIP -> districts.
 *
 * Pipe-delimited, with a header. Two columns matter: GEOID_CD118_20, which is
 * the state FIPS and the district number run together, and GEOID_ZCTA5_20,
 * which is the ZIP. AREALAND_PART is the size of the overlap and is what the
 * ordering is built on.
 *
 * Rows with no ZCTA are the district's own totals and are skipped. District
 * "00" is an at-large seat, which districtIdOf already spells as "-AL".
 *
 * Exported because the generator script and the tests are the only two callers
 * — at runtime the result of this is already sitting in src/data.
 */
export function parseRelationshipFile(text: string): ZipMap {
  const map: ZipMap = new Map();

  for (const line of text.split("\n")) {
    const cells = line.split("|");
    if (cells.length < 17) continue;

    const cdGeoid = cells[1]?.trim() ?? "";
    const zip = cells[8]?.trim() ?? "";
    if (!/^\d{4}$/.test(cdGeoid) || !/^\d{5}$/.test(zip)) continue;

    const stateCode = STATE_BY_FIPS[cdGeoid.slice(0, 2)];
    if (!stateCode) continue;

    const districtNumber = Number(cdGeoid.slice(2));
    const landArea = Number(cells[15] ?? 0);

    const districtId = districtIdOf(stateCode, districtNumber);
    const existing = map.get(zip);
    if (existing) existing.push({ districtId, landArea: Number.isFinite(landArea) ? landArea : 0 });
    else map.set(zip, [{ districtId, landArea: Number.isFinite(landArea) ? landArea : 0 }]);
  }

  // Biggest share of the ZIP first, so the likeliest answer is the first one.
  for (const overlaps of map.values()) overlaps.sort((a, b) => b.landArea - a.landArea);

  return map;
}

export interface ZipLookup {
  /** The districts this ZIP falls in, most of it first. Empty is a real answer. */
  districts: DistrictOption[];
  /** True when the ZIP straddles more than one, so the screen can say so. */
  spansSeveral: boolean;
  source: string;
  vintage: string;
}

/**
 * Which districts is this ZIP in?
 *
 * Throws if the congress.gov roster cannot be reached at all, which the caller
 * turns into "we cannot look that up right now, search by state instead". That
 * is deliberate: answering "no districts found" when the check could not run
 * would tell somebody their home is in no district at all.
 */
export async function districtsForZip(zip: string): Promise<ZipLookup> {
  const clean = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) {
    return { districts: [], spansSeveral: false, source: CENSUS_SOURCE, vintage: BOUNDARY_VINTAGE };
  }

  const roster = await getMembers();
  const candidates = ZIP_TO_DISTRICTS[clean] ?? [];

  // EVERY ANSWER IS CHECKED AGAINST THE LIVE ROSTER. The bundled map is one
  // Congress behind; a district that has since gone is dropped rather than
  // offered, and the representative's name comes from the roster so somebody
  // can see at a glance whether it is theirs.
  const byId = new Map<string, DistrictOption>();
  for (const member of roster.members) {
    if (member.chamber !== "house") continue;
    byId.set(districtIdOf(member.state, member.district), {
      districtId: districtIdOf(member.state, member.district),
      stateCode: member.state.toUpperCase(),
      stateName: member.stateName,
      district: member.district === 0 ? null : member.district,
      representative: {
        name: member.name,
        party: member.partyName,
        photoUrl: member.photoUrl,
      },
    });
  }

  const districts = candidates
    .map((districtId) => byId.get(districtId))
    .filter((d): d is DistrictOption => Boolean(d));

  return {
    districts,
    spansSeveral: districts.length > 1,
    source: CENSUS_SOURCE,
    vintage: BOUNDARY_VINTAGE,
  };
}
