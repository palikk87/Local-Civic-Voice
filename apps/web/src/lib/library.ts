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

export type LibraryBranch = "congress" | "executive" | "judicial";

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
