/**
 * Your civic score, from the server that counts it.
 *
 * ONE PROFILE, EVERY DEVICE. This screen used to read the score, the level and
 * the streak out of a zustand store persisted to the phone's own storage, while
 * the web app read the same three things from the server. Two devices, two
 * answers, for one person — which is exactly what was reported: a streak
 * "showing 1 thing on my computer but something else on my phone".
 *
 * Both were telling the truth about themselves. That is the problem. A score
 * kept per device is not one record with two views, it is two records, and a
 * person signing in somewhere new starts again from nothing they earned.
 *
 * Deliberately the same file, the same query key and the same shape as
 * apps/web/src/hooks/use-civic-score.ts, so the two cannot drift.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/api";

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
