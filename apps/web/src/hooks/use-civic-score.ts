import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Your civic score, from the server that counts it.
 *
 * The old one read a zustand store persisted to localStorage, which is why a
 * streak "showed 1 thing on my computer but something else on my phone": each
 * browser kept its own. This asks the same question of the same rows from
 * anywhere, so every device gives the same answer.
 */
export interface CivicScore {
  total: number;
  level: "newcomer" | "citizen" | "advocate" | "activist" | "champion" | "leader";
  levelTitle: string;
  intoLevel: number;
  levelSpan: number;
  toNextLevel: number;
  counts: { votes: number; posts: number; comments: number };
  earned: { votes: number; posts: number; comments: number };
  streak: { current: number; longest: number; activeToday: boolean };
  activeDays: string[];
  byCategory: Array<{ category: string; votes: number }>;
  badges: Array<{
    id: string;
    name: string;
    description: string;
    requirement: number;
    progress: number;
    earned: boolean;
  }>;
  levels: Array<{ id: string; title: string; min: number; max: number; reached: boolean }>;
}

export function useCivicScore(enabled = true) {
  return useQuery({
    queryKey: ["civic-score"],
    queryFn: () => api.get<{ score: CivicScore }>("/api/me/civic-score"),
    enabled,
    // Voting or commenting changes it, and those already invalidate their own
    // queries; a short staleness keeps the plaque honest without a refetch on
    // every render.
    staleTime: 30_000,
  });
}
