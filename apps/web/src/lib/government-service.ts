/**
 * Government data layer — the Congress roster plus the executive and judicial branches.
 *
 * Types mirror the Zod contracts in `backend/src/types.ts` (the single source of truth).
 * The mobile faucet has the same functions in `webapp/mobile/src/lib/government-service.ts`.
 *
 * Endpoints (shared by both faucets — do not add client-specific routes):
 *   GET /api/representatives   — every sitting Senator and Representative
 *   GET /api/representatives/:id
 *   GET /api/government/officials — President, VP, Cabinet, Justices, succession
 */

import { api } from "./api";

export type Party = "R" | "D" | "I";
export type Chamber = "house" | "senate";
export type Branch = "executive" | "legislative" | "judicial";

export interface Member {
  id: string;
  name: string;
  party: Party;
  partyName: string;
  chamber: Chamber;
  state: string;
  stateName: string;
  district: number | null;
  title: string;
  leadershipRole: string | null;
  phone: string | null;
  website: string | null;
  twitter: string | null;
  photoUrl: string | null;
  office: string | null;
  servingSince: number | null;
}

export interface MemberListResponse {
  representatives: Member[];
  counts: { house: number; senate: number; total: number };
  congress: number;
  source: "congress.gov" | "fallback";
  lastUpdated: string;
}

export interface Official {
  id: string;
  name: string;
  title: string;
  shortTitle: string;
  branch: Branch;
  group: string;
  acting: boolean;
  party: Party | null;
  department: string | null;
  since: string | null;
  appointedBy: string | null;
  photoUrl: string | null;
  website: string | null;
  phone: string | null;
  bio: string | null;
  successionOrder: number | null;
}

export interface Department {
  id: string;
  name: string;
  abbreviation: string;
  branch: Branch;
  established: string | null;
  website: string | null;
  description: string | null;
  headOfficialId: string | null;
}

export interface OfficialsResponse {
  executive: Official[];
  judicial: Official[];
  departments: Department[];
  succession: Official[];
  congressionalLeadership: Official[];
  lastUpdated: string;
  sources: string[];
}

export interface MemberFilters {
  search?: string;
  chamber?: Chamber | "all";
  party?: Party | "all";
  state?: string;
  leadership?: boolean;
}

function toQuery(filters: MemberFilters): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.chamber && filters.chamber !== "all") params.set("chamber", filters.chamber);
  if (filters.party && filters.party !== "all") params.set("party", filters.party);
  if (filters.state) params.set("state", filters.state);
  if (filters.leadership) params.set("leadership", "true");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Every sitting member of Congress, optionally filtered server-side. */
export async function fetchMembers(filters: MemberFilters = {}): Promise<MemberListResponse> {
  const res = await api.get<{ data: MemberListResponse }>(
    `/api/representatives${toQuery(filters)}`
  );
  return res.data;
}

/** One member by bioguide ID, with contact details resolved on demand. */
export async function fetchMember(id: string): Promise<Member> {
  const res = await api.get<{ data: { representative: Member } }>(`/api/representatives/${id}`);
  return res.data.representative;
}

/** The executive and judicial branches, departments and the line of succession. */
export async function fetchOfficials(): Promise<OfficialsResponse> {
  const res = await api.get<{ data: OfficialsResponse }>("/api/government/officials");
  return res.data;
}

// ---------- Presentation helpers (shared behaviour across both faucets) ----------

export const PARTY_LABELS: Record<Party, string> = {
  D: "Democrat",
  R: "Republican",
  I: "Independent",
};

/** Initials for the avatar fallback when an official has no official portrait. */
export function initials(name: string): string {
  const parts = name
    .replace(/\b(Jr\.|Sr\.|II|III|IV)\b/g, "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 1 && !p.endsWith("."));
  if (parts.length === 0) return name.slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** "Serving since 2023" / "Took seat 2005" style line. */
export function sinceLabel(value: string | number | null): string | null {
  if (value === null) return null;
  const year = typeof value === "number" ? value : new Date(value).getFullYear();
  return Number.isFinite(year) ? String(year) : String(value);
}

/** Groups within the executive branch, in the order the screen shows them. */
export const EXECUTIVE_GROUPS: Array<{ key: string; label: string; blurb: string }> = [
  { key: "president", label: "President", blurb: "Head of state and head of government" },
  { key: "vice-president", label: "Vice President", blurb: "President of the Senate, first in the line of succession" },
  { key: "cabinet", label: "The Cabinet", blurb: "Heads of the 15 executive departments" },
  { key: "cabinet-rank", label: "Cabinet-Rank Officials", blurb: "Agency heads who sit with the Cabinet" },
  { key: "white-house", label: "Senior White House Staff", blurb: "The Executive Office of the President" },
];

/** State code → full name, for the state filter. Derived from the roster itself. */
export function statesFromMembers(members: Member[]): Array<{ code: string; name: string }> {
  const seen = new Map<string, string>();
  for (const m of members) {
    if (!seen.has(m.state)) seen.set(m.state, m.stateName);
  }
  return Array.from(seen, ([code, name]) => ({ code, name })).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}
