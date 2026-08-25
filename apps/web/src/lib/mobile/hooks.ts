// Web port of mobile/src/lib/hooks.ts
// Supabase is hard-disabled in the mobile app (see supabase.ts), so every hook
// there runs with `enabled: false` and returns its unconfigured fallback.
// This port keeps the exact same hook signatures and fallback values without
// pulling in @supabase/supabase-js.
import { useQuery, useMutation } from '@tanstack/react-query'
import type {
  Bill,
  Representative,
  Profile,
  Vote as UserVote,
  FeedItemWithDetails,
  BillCategory,
} from './database.types'
import { isSupabaseConfigured } from './supabase'

export interface BillSearchParams {
  category?: BillCategory
  chamber?: 'house' | 'senate'
  search?: string
  trending?: boolean
  limit?: number
}

export function useBills(params: BillSearchParams = {}) {
  return useQuery({
    queryKey: ['bills', params],
    queryFn: async (): Promise<Bill[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export function useBill(id: string) {
  return useQuery({
    queryKey: ['bill', id],
    queryFn: async (): Promise<Bill | null> => null,
    enabled: isSupabaseConfigured() && !!id,
  })
}

export function useTrendingBills(limit = 5) {
  return useQuery({
    queryKey: ['trendingBills', limit],
    queryFn: async (): Promise<Bill[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export function useFeed(limit = 20) {
  return useQuery({
    queryKey: ['feed', limit],
    queryFn: async (): Promise<FeedItemWithDetails[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export function useUserVote(userId: string | undefined, billId: string) {
  return useQuery({
    queryKey: ['userVote', userId, billId],
    queryFn: async (): Promise<UserVote | null> => null,
    enabled: isSupabaseConfigured() && !!userId && !!billId,
  })
}

export function useUserVoteHistory(userId: string | undefined) {
  return useQuery({
    queryKey: ['userVoteHistory', userId],
    queryFn: async (): Promise<UserVote[]> => [],
    enabled: isSupabaseConfigured() && !!userId,
  })
}

export function useCastVote() {
  return useMutation({
    mutationFn: async (_vars: { userId: string; billId: string; vote: 'yea' | 'nay' }) => null,
  })
}

export function useRemoveVote() {
  return useMutation({
    mutationFn: async (_vars: { userId: string; billId: string }) => null,
  })
}

export function useUserFeedLikes(userId: string | undefined) {
  return useQuery({
    queryKey: ['userFeedLikes', userId],
    queryFn: async (): Promise<Set<string>> => new Set<string>(),
    enabled: isSupabaseConfigured() && !!userId,
  })
}

export function useToggleFeedLike() {
  return useMutation({
    mutationFn: async (_vars: { userId: string; feedItemId: string; isLiked: boolean }) => null,
  })
}

export function useRepresentatives(filters?: { chamber?: 'house' | 'senate'; search?: string }) {
  return useQuery({
    queryKey: ['representatives', filters],
    queryFn: async (): Promise<Representative[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export function useFeaturedDelegates() {
  return useQuery({
    queryKey: ['featuredDelegates'],
    queryFn: async (): Promise<Profile[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async (): Promise<Profile | null> => null,
    enabled: isSupabaseConfigured() && !!userId,
  })
}

/**
 * DELIBERATELY DROPS TWO FIELDS THE BASE TYPE DEMANDS.
 *
 * `Bill` inherits cosponsor_count and amendment_count from the old Supabase
 * generated types. Neither has a column behind it: Prisma's Bill model has
 * `cosponsors` as free text and nothing at all for amendments, and
 * GovernmentReference has neither. A required field with no source is how the
 * digest came to invent both — a status lookup table "for demo" plus
 * Math.random() on every render — and feed them into the voice-weight figure
 * that tells a citizen how much their vote counts.
 *
 * Omitted rather than defaulted to zero: zero says a bill has no cosponsors,
 * and what is true is that this platform does not know.
 */
export interface DailyDigestBill
  extends Omit<
    Bill,
    | 'cosponsor_count'
    | 'amendment_count'
    | 'introduced_date'
    | 'last_action_date'
    | 'created_at'
    | 'updated_at'
  > {
  weight_score: number
  representatives?: Representative | null
  /**
   * NULLABLE, because these are facts about the legislation and we may not
   * have them yet.
   *
   * The generated row type declares them required, which is what let the
   * mapper fill both with the moment OUR row was written — so a 2007 statute
   * displayed as introduced today. congress.gov fills them now, in a
   * background pass; until it reaches a record they are null and the card
   * renders no date rather than the wrong one.
   */
  introduced_date: string | null
  last_action_date: string | null
  created_at: string | null
  updated_at: string | null
}

export function useDailyBillDigest(limit = 10, category?: BillCategory) {
  return useQuery({
    queryKey: ['dailyDigest', limit, category],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 10,
  })
}

export function useHighImpactBills(minWeight = 25, limit = 20) {
  return useQuery({
    queryKey: ['highImpactBills', minWeight, limit],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: isSupabaseConfigured(),
  })
}

export interface RandomizedBill extends DailyDigestBill {
  discovery_score: number
}

export function useRandomizedBillFeed(
  seenBillIds: Set<string>,
  limit = 10,
  category?: BillCategory
) {
  return useQuery({
    queryKey: ['randomizedFeed', limit, category, Array.from(seenBillIds).length],
    queryFn: async () => ({ bills: [] as RandomizedBill[], newSeenIds: [] as string[] }),
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 2,
  })
}
