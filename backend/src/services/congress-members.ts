/**
 * Live roster of every sitting member of Congress, from the official Congress.gov API.
 *
 * The list endpoint gives us name / party / state / district / photo for all ~537
 * current members in three pages. It does NOT include phone, website, office or
 * leadership role — those come from the per-member detail endpoint, which we fetch
 * in a throttled background pass and merge in as it completes.
 *
 * So: the roster is available within a second of the first request, and contact
 * details fill in shortly after. Cached for 24 hours; falls back to the bundled
 * static list if Congress.gov is unreachable or no API key is configured.
 */

import type { Chamber, Member, Party } from "../types";
import { FALLBACK_MEMBERS } from "../data/congress-fallback";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Congress.gov allows 5,000 requests/hour. 60ms between detail calls keeps us well under. */
const DETAIL_DELAY_MS = 60;

/**
 * Members who held a leadership post last time we looked. Enriching these first means
 * the Leadership section and the succession line are populated within a couple of
 * seconds of a cold start, instead of after the full ~35s roster pass.
 *
 * This is only a hint about WHOM TO CHECK FIRST — every title still comes from the
 * live API, so a member who loses their post simply drops out, and a member who gains
 * one still appears (just later in the pass). A stale entry costs one wasted call.
 */
const LEADERSHIP_FIRST = [
  "J000299", // Speaker of the House
  "G000386", // President pro tempore
  "S001176", "E000294", "J000294", "C001101", "A000371", "L000582", // House
  "T000250", "B001261", "S000148", "D000563", "H001082", "M001136", "N000191", // Senate + caucus
];

const STATE_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY",
  // Non-voting delegations
  "District of Columbia": "DC", "Puerto Rico": "PR", Guam: "GU",
  "American Samoa": "AS", "Virgin Islands": "VI",
  "Northern Mariana Islands": "MP",
};

/**
 * Interim headshots for members who have no official photo on Congress.gov yet
 * (typically freshly-appointed members). Sourced from their Wikipedia portraits.
 * Remove an entry once Congress.gov publishes an official depiction — the live
 * photo always wins when present.
 */
const PHOTO_FALLBACKS: Record<string, string> = {
  // Alan Armstrong (R-OK), appointed March 2026
  A000383:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Alan_S_Armstrong_official_portrait_%28cropped_2%29.jpg/330px-Alan_S_Armstrong_official_portrait_%28cropped_2%29.jpg",
  // Darline Graham (R-SC), appointed July 2026
  G000608:
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Darline_Graham%2C_2026_%28cropped%29.png/330px-Darline_Graham%2C_2026_%28cropped%29.png",
};

const PARTY_NAMES: Record<Party, string> = {
  R: "Republican",
  D: "Democrat",
  I: "Independent",
};

function normaliseParty(partyName: string | undefined): Party {
  const p = (partyName ?? "").toLowerCase();
  if (p.startsWith("republican")) return "R";
  if (p.startsWith("democrat")) return "D";
  return "I";
}

function normaliseChamber(chamber: string | undefined): Chamber {
  return (chamber ?? "").toLowerCase().includes("senate") ? "senate" : "house";
}

/** Congress.gov returns "Johnson, Mike" — the app shows "Mike Johnson". */
function directOrder(invertedName: string): string {
  const comma = invertedName.indexOf(",");
  if (comma === -1) return invertedName.trim();
  const last = invertedName.slice(0, comma).trim();
  const first = invertedName.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

function buildTitle(chamber: Chamber, state: string, district: number | null): string {
  if (chamber === "senate") return `Senator - ${state}`;
  return district === null || district === 0
    ? `Delegate - ${state}`
    : `Representative - ${state} District ${district}`;
}

interface ApiListMember {
  bioguideId: string;
  name: string;
  partyName?: string;
  state?: string;
  district?: number;
  depiction?: { imageUrl?: string };
  terms?: { item?: Array<{ chamber?: string; startYear?: number }> };
}

interface ApiDetailMember {
  bioguideId: string;
  officialWebsiteUrl?: string;
  addressInformation?: { officeAddress?: string; city?: string; district?: string; zipCode?: number; phoneNumber?: string };
  leadership?: Array<{ congress: number; type: string; current?: boolean }>;
  terms?: { item?: Array<{ chamber?: string; startYear?: number }> };
}

interface Roster {
  members: Member[];
  congress: number;
  source: "congress.gov" | "fallback";
  fetchedAt: number;
  /** True once the background contact-detail pass has finished. */
  enriched: boolean;
}

let cache: Roster | null = null;
let inFlight: Promise<Roster> | null = null;

function apiKey(): string | undefined {
  const key = process.env.CONGRESS_API_KEY;
  return key && key.trim() ? key.trim() : undefined;
}

/** Congress.gov occasionally returns a transient non-JSON 404, so retry with backoff. */
async function getJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Congress.gov ${res.status} for ${url.split("?")[0]}`);
      return (await res.json()) as T;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function fetchCurrentCongress(key: string): Promise<number> {
  try {
    const data = await getJson<{ congress?: { number?: number } }>(
      `${API_BASE}/congress/current?api_key=${key}&format=json`
    );
    return data.congress?.number ?? 119;
  } catch {
    return 119;
  }
}

/** Page through /member?currentMember=true and map to our Member shape. */
async function fetchRoster(key: string): Promise<Member[]> {
  const members: Member[] = [];
  let offset = 0;

  for (;;) {
    const data = await getJson<{ members?: ApiListMember[]; pagination?: { count?: number; next?: string } }>(
      `${API_BASE}/member?currentMember=true&limit=${PAGE_SIZE}&offset=${offset}&api_key=${key}&format=json`
    );
    const batch = data.members ?? [];
    for (const m of batch) {
      const latestTerm = m.terms?.item?.[m.terms.item.length - 1];
      const chamber = normaliseChamber(latestTerm?.chamber);
      const stateName = m.state ?? "";
      const state = STATE_ABBR[stateName] ?? stateName.slice(0, 2).toUpperCase();
      const district = chamber === "house" ? (m.district ?? null) : null;
      const party = normaliseParty(m.partyName);

      members.push({
        id: m.bioguideId,
        name: directOrder(m.name),
        party,
        partyName: PARTY_NAMES[party],
        chamber,
        state,
        stateName,
        district,
        title: buildTitle(chamber, state, district),
        leadershipRole: null,
        phone: null,
        website: null,
        twitter: null,
        photoUrl: m.depiction?.imageUrl ?? PHOTO_FALLBACKS[m.bioguideId] ?? null,
        office: null,
        servingSince: latestTerm?.startYear ?? null,
      });
    }
    if (!data.pagination?.next || batch.length === 0) break;
    offset += PAGE_SIZE;
    if (offset > 2000) break; // safety stop
  }

  // Senators first within a state, then by name — matches how the app groups them.
  members.sort((a, b) => a.name.localeCompare(b.name));
  return members;
}

/**
 * Fill in phone / website / office / leadership role from the per-member detail
 * endpoint. Runs in the background against the cached roster and mutates it in
 * place, so the list endpoint gets progressively richer without ever blocking.
 */
async function enrichRoster(roster: Roster, key: string, congress: number): Promise<void> {
  const byId = new Map(roster.members.map((m) => [m.id, m]));

  // Leadership first, then everyone else, each member exactly once.
  const ordered = [
    ...LEADERSHIP_FIRST.map((id) => byId.get(id)).filter((m): m is Member => m !== undefined),
    ...roster.members.filter((m) => !LEADERSHIP_FIRST.includes(m.id)),
  ];

  for (const member of ordered) {
    // Bail out if a newer roster replaced this one while we were working.
    if (cache !== roster) return;
    try {
      const data = await getJson<{ member?: ApiDetailMember }>(
        `${API_BASE}/member/${member.id}?api_key=${key}&format=json`
      );
      const d = data.member;
      if (!d) continue;

      const target = byId.get(member.id);
      if (!target) continue;

      target.website = d.officialWebsiteUrl ?? target.website;
      target.phone = d.addressInformation?.phoneNumber ?? target.phone;

      const addr = d.addressInformation;
      if (addr?.officeAddress) {
        target.office = [addr.officeAddress, addr.city, addr.district, addr.zipCode]
          .filter(Boolean)
          .join(", ");
      }

      const currentLeadership = d.leadership?.find((l) => l.current) ??
        d.leadership?.filter((l) => l.congress === congress).pop();
      if (currentLeadership?.type) target.leadershipRole = currentLeadership.type;
    } catch {
      // A single member failing is not worth aborting the whole pass.
    }
    await new Promise((r) => setTimeout(r, DETAIL_DELAY_MS));
  }

  if (cache === roster) {
    roster.enriched = true;
    console.log(`[congress-members] contact details filled in for ${roster.members.length} members`);
  }
}

function fallbackRoster(): Roster {
  return {
    members: FALLBACK_MEMBERS,
    congress: 119,
    source: "fallback",
    fetchedAt: Date.now(),
    enriched: true,
  };
}

async function loadRoster(): Promise<Roster> {
  const key = apiKey();
  if (!key) {
    console.warn("[congress-members] CONGRESS_API_KEY not set — serving bundled fallback roster");
    return fallbackRoster();
  }

  const congress = await fetchCurrentCongress(key);
  const members = await fetchRoster(key);
  if (members.length === 0) throw new Error("Congress.gov returned an empty roster");

  const roster: Roster = {
    members,
    congress,
    source: "congress.gov",
    fetchedAt: Date.now(),
    enriched: false,
  };
  console.log(`[congress-members] loaded ${members.length} members of the ${congress}th Congress`);
  return roster;
}

/**
 * The whole roster, cached for 24h. Never throws — on failure it serves the
 * bundled static list so the Government screen always has something to show.
 */
export async function getMembers(): Promise<Roster> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = loadRoster()
    .catch((err) => {
      console.error("[congress-members] live fetch failed, using fallback:", err);
      return fallbackRoster();
    })
    .then((roster) => {
      cache = roster;
      const key = apiKey();
      if (roster.source === "congress.gov" && key) {
        // Fire and forget — enrichment mutates the cached roster as it goes.
        void enrichRoster(roster, key, roster.congress);
      }
      return roster;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export async function getMemberById(id: string): Promise<Member | undefined> {
  const roster = await getMembers();
  const member = roster.members.find((m) => m.id === id);
  if (!member) return undefined;

  // If the background pass hasn't reached this member yet, fetch them on demand
  // so the detail view always shows contact info.
  const key = apiKey();
  if (key && roster.source === "congress.gov" && !member.website && !member.phone) {
    try {
      const data = await getJson<{ member?: ApiDetailMember }>(
        `${API_BASE}/member/${id}?api_key=${key}&format=json`
      );
      const d = data.member;
      if (d) {
        member.website = d.officialWebsiteUrl ?? member.website;
        member.phone = d.addressInformation?.phoneNumber ?? member.phone;
        const addr = d.addressInformation;
        if (addr?.officeAddress) {
          member.office = [addr.officeAddress, addr.city, addr.district, addr.zipCode]
            .filter(Boolean)
            .join(", ");
        }
        const lead = d.leadership?.find((l) => l.current);
        if (lead?.type) member.leadershipRole = lead.type;
      }
    } catch {
      // Fall through with whatever we already have.
    }
  }

  return member;
}

/**
 * Every member currently holding a leadership post. On a cold start the background
 * enrichment pass may not have reached them yet, so we prime the known leadership
 * IDs on demand (in parallel, ~300ms) rather than serve an empty Leadership section.
 * Titles always come from the live API, never from the ID list.
 */
export async function getLeadership(): Promise<Member[]> {
  const roster = await getMembers();
  const held = () => roster.members.filter((m) => m.leadershipRole !== null);

  if (held().length === 0 && !roster.enriched) {
    await Promise.all(LEADERSHIP_FIRST.map((id) => getMemberById(id).catch(() => undefined)));
  }

  return held();
}

export function clearMemberCache(): void {
  cache = null;
}
