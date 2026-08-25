/**
 * Library search — web faucet.
 *
 * The result shapes and the adapters that normalize them into
 * GovernmentSearchResult live in lib/mobile/government-api.ts, which mirrors the
 * mobile app's file exactly. They are re-exported here so the Library page has
 * one import, NOT redefined — a third copy is how the two faucets drift apart.
 */
import { api } from "@/lib/api";
import type {
  CongressResult,
  ExecutiveResult,
  JudicialResult,
} from "@/lib/mobile/government-api";

export {
  congressToSearchResult,
  executiveToSearchResult,
  judicialToSearchResult,
  determineStatusLabel,
  mapExecutiveTypeToCategory,
} from "@/lib/mobile/government-api";

export type {
  CongressResult,
  ExecutiveResult,
  JudicialResult,
  GovernmentSearchResult,
  LegislativeStatus,
  SearchBranch,
} from "@/lib/mobile/government-api";

// ---------- Library branch metadata ----------

/**
 * "all" is the default, and the reason is a bug this fixes.
 *
 * The Library preselected "congress" and searched only the selected branch, so
 * a reader typing "immigration" silently got no executive orders and no court
 * cases — two thirds of the platform's own subject matter, excluded by a
 * default nobody chose. A branch tab should NARROW a search somebody asked to
 * narrow, not quietly define it.
 */
export type LibraryBranch = "all" | "congress" | "executive" | "judicial";

/**
 * One search result, carrying which branch it came from.
 *
 * The three sources return three unrelated shapes, and the Library used to keep
 * them in three parallel arrays and render whichever one matched the selected
 * tab. That worked only because exactly one tab could ever be selected — and
 * the moment "All" existed, all three arrays were empty and a search that had
 * fetched thirty records displayed none of them. Tagging each row with its
 * branch makes the mixed case the ordinary case rather than a fourth branch of
 * an if-statement that nobody remembers to add.
 */
export type LibraryRow =
  | { branch: "congress"; item: CongressResult }
  | { branch: "executive"; item: ExecutiveResult }
  | { branch: "judicial"; item: JudicialResult };

interface CongressResponse {
  results: CongressResult[];
  pagination?: { count: number };
}
interface ExecutiveResponse {
  results: ExecutiveResult[];
}
interface JudicialResponse {
  results: JudicialResult[];
}

function buildQ(q: string, limit = 15, offset = 0): string {
  const search = new URLSearchParams({ q, limit: String(limit) });
  if (offset) search.set("offset", String(offset));
  return `?${search.toString()}`;
}

export const libraryApi = {
  congress: (q: string, limit = 15) =>
    api.get<CongressResponse>(`/api/government/congress/search${buildQ(q, limit)}`),

  executive: (q: string, limit = 15) =>
    api.get<ExecutiveResponse>(`/api/government/executive/search${buildQ(q, limit)}`),

  judicial: (q: string, limit = 15) =>
    api.get<JudicialResponse>(`/api/government/judicial/search${buildQ(q, limit)}`),
};
