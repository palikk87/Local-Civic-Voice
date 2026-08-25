/**
 * Legacy Supabase-backed data hooks — now inert, kept for their call sites.
 *
 * These hooks queried a Supabase project directly from the client, against a
 * snake_case schema (`bills`, `votes`, `feed_likes`, `representatives`,
 * `system_settings`) unrelated to the Prisma schema this product actually runs
 * on. Every one of them was gated: each `queryFn` opened with
 * `if (!isSupabaseConfigured()) return <empty>` and each `useQuery` carried
 * `enabled: isSupabaseConfigured()`. That gate has always been false, so none of
 * the query bodies has ever executed in this app.
 *
 * The bodies are gone because they needed `@supabase/supabase-js`, and a vendor
 * SDK in the client is exactly the coupling this project is removing: the
 * database has to stay a plain Postgres reachable by a connection string, so it
 * can be repointed at any provider without touching application code.
 *
 * What survives is each hook's name, parameters, and the value it returns when
 * disabled — which is the value it returns today. Screens importing these keep
 * compiling and keep behaving identically; they already fall back to the Hono
 * backend (`lib/api`) or to local mock data.
 *
 * The three mutations still throw, as they did, so a caller that reaches one is
 * loud rather than silently doing nothing.
 *
 * These should be deleted outright once the screens stop importing them. That is
 * a change to feature code, not a migration concern.
 */

import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'

import type {
  Bill,
  BillCategory,
  BillStatus,
  Representative,
  FeedItemWithDetails,
  Vote,
  VoteType,
  VoteWithBill,
  Profile,
  DelegateProfileWithUser,
} from './database.types'

// Query keys for cache management
export const queryKeys = {
  bills: ['bills'] as const,
  bill: (id: string) => ['bills', id] as const,
  billSearch: (params: BillSearchParams) => ['bills', 'search', params] as const,
  trendingBills: ['bills', 'trending'] as const,
  feed: (limit: number) => ['feed', limit] as const,
  feedInfinite: (pageSize: number) => ['feed', 'infinite', pageSize] as const,
  userVotes: (userId: string) => ['votes', userId] as const,
  userVote: (userId: string, billId: string) => ['votes', userId, billId] as const,
  userVoteHistory: (userId: string) => ['votes', 'history', userId] as const,
  profile: (userId: string) => ['profile', userId] as const,
  representatives: ['representatives'] as const,
  delegates: ['delegates'] as const,
  feedLikes: (userId: string) => ['feedLikes', userId] as const,
}

// Types
export interface BillSearchParams {
  query?: string
  category?: BillCategory
  status?: BillStatus
  sortBy?: 'newest' | 'trending' | 'oldest'
  limit?: number
  offset?: number
}

export interface BillWithSponsor extends Bill {
  representatives?: Representative | null
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
  extends Omit<Bill, 'cosponsor_count' | 'amendment_count'> {
  weight_score: number
  representatives?: Representative | null
}

export interface CongressInfo {
  congress_number: number
  congress_label: string
  bill_count: number
  is_current: boolean
}

export interface RandomizedBill extends DailyDigestBill {
  discovery_score: number
}

// The single reason every hook below is disabled. One named constant rather
// than `enabled: false` repeated eighteen times, so the reason stays legible
// and re-enabling anything has to be deliberate.
const SUPABASE_DATA_ENABLED = false

const DISABLED_MUTATION_MESSAGE =
  'This mutation targeted the removed Supabase data layer. Use the backend API (lib/api) instead.'

// ==========================================
// BILLS HOOKS
// ==========================================

export function useBills(params: BillSearchParams = {}) {
  return useQuery({
    queryKey: queryKeys.billSearch(params),
    queryFn: async (): Promise<BillWithSponsor[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 5,
  })
}

export function useBill(id: string) {
  return useQuery({
    queryKey: queryKeys.bill(id),
    queryFn: async (): Promise<BillWithSponsor | null> => null,
    enabled: SUPABASE_DATA_ENABLED && !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useTrendingBills(limit = 5) {
  return useQuery({
    queryKey: [...queryKeys.trendingBills, limit],
    queryFn: async (): Promise<BillWithSponsor[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 5,
  })
}

// ==========================================
// FEED HOOKS
// ==========================================

export function useFeed(limit = 20) {
  return useQuery({
    queryKey: queryKeys.feed(limit),
    queryFn: async (): Promise<FeedItemWithDetails[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 2,
  })
}

export function useInfiniteFeed(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: queryKeys.feedInfinite(pageSize),
    queryFn: async (): Promise<{ items: FeedItemWithDetails[]; nextOffset: number | null }> => ({
      items: [],
      nextOffset: null,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 2,
  })
}

// ==========================================
// VOTING HOOKS
// ==========================================

export function useUserVote(userId: string | undefined, billId: string) {
  return useQuery({
    queryKey: queryKeys.userVote(userId || '', billId),
    queryFn: async (): Promise<Vote | null> => null,
    enabled: SUPABASE_DATA_ENABLED && !!userId,
  })
}

export function useUserVoteHistory(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userVoteHistory(userId || ''),
    queryFn: async (): Promise<VoteWithBill[]> => [],
    enabled: SUPABASE_DATA_ENABLED && !!userId,
  })
}

export function useCastVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (_variables: {
      userId: string
      billId: string
      vote: VoteType
    }): Promise<never> => {
      throw new Error(DISABLED_MUTATION_MESSAGE)
    },
    onSettled: (_data, _error, { userId, billId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userVote(userId, billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.bill(billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.userVoteHistory(userId) })
    },
  })
}

export function useRemoveVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (_variables: { userId: string; billId: string }): Promise<never> => {
      throw new Error(DISABLED_MUTATION_MESSAGE)
    },
    onSettled: (_data, _error, { userId, billId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userVote(userId, billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.bill(billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.userVoteHistory(userId) })
    },
  })
}

// ==========================================
// FEED LIKE HOOKS
// ==========================================

export function useUserFeedLikes(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.feedLikes(userId || ''),
    queryFn: async (): Promise<Set<string>> => new Set<string>(),
    enabled: SUPABASE_DATA_ENABLED && !!userId,
  })
}

export function useToggleFeedLike() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (_variables: {
      userId: string
      feedItemId: string
      isLiked: boolean
    }): Promise<never> => {
      throw new Error(DISABLED_MUTATION_MESSAGE)
    },
    onSettled: (_data, _error, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feedLikes(userId) })
    },
  })
}

// ==========================================
// REPRESENTATIVE HOOKS
// ==========================================

export function useRepresentatives(filters?: { chamber?: 'house' | 'senate'; search?: string }) {
  return useQuery({
    queryKey: [...queryKeys.representatives, filters],
    queryFn: async (): Promise<Representative[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 30,
  })
}

export function useFeaturedDelegates() {
  return useQuery({
    queryKey: queryKeys.delegates,
    queryFn: async (): Promise<DelegateProfileWithUser[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 10,
  })
}

// ==========================================
// PROFILE HOOKS
// ==========================================

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profile(userId || ''),
    queryFn: async (): Promise<Profile | null> => null,
    enabled: SUPABASE_DATA_ENABLED && !!userId,
  })
}

// ==========================================
// DAILY BILL DIGEST HOOKS (Voice Weight)
// ==========================================

export function useDailyBillDigest(limit = 10, category?: BillCategory) {
  return useQuery({
    queryKey: ['dailyDigest', limit, category],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 10,
  })
}

export function useHighImpactBills(minWeight = 25, limit = 20) {
  return useQuery({
    queryKey: ['highImpactBills', minWeight, limit],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 10,
  })
}

// ==========================================
// MULTI-SESSION CONGRESS HOOKS
// ==========================================

export function useCurrentCongress() {
  return useQuery({
    queryKey: ['currentCongress'],
    // The 119th Congress began in January 2025. This was the fallback whenever
    // the lookup was unavailable, which is always.
    queryFn: async (): Promise<number> => 119,
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 60,
  })
}

export function useCurrentCongressBills(limit = 50, category?: BillCategory) {
  const { data: currentCongress } = useCurrentCongress()

  return useQuery({
    queryKey: ['currentCongressBills', currentCongress, limit, category],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: SUPABASE_DATA_ENABLED && !!currentCongress,
    staleTime: 1000 * 60 * 10,
  })
}

export function useHistoricalBills(
  congressNumber?: number,
  limit = 50,
  offset = 0,
  category?: BillCategory
) {
  const { data: currentCongress } = useCurrentCongress()

  return useQuery({
    queryKey: ['historicalBills', congressNumber, currentCongress, limit, offset, category],
    queryFn: async (): Promise<DailyDigestBill[]> => [],
    enabled: SUPABASE_DATA_ENABLED && !!currentCongress,
    staleTime: 1000 * 60 * 30,
  })
}

export function useAvailableCongresses() {
  return useQuery({
    queryKey: ['availableCongresses'],
    queryFn: async (): Promise<CongressInfo[]> => [
      {
        congress_number: 119,
        congress_label: '119th Congress (2025-2027)',
        bill_count: 0,
        is_current: true,
      },
    ],
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 30,
  })
}

// ==========================================
// RANDOMIZED BILL FEED HOOKS
// ==========================================

/**
 * Bills for the randomized "For You" feed, with session exclusion.
 */
export function useRandomizedBillFeed(
  seenBillIds: Set<string>,
  limit = 10,
  category?: BillCategory
) {
  return useQuery({
    queryKey: ['randomizedFeed', limit, category, Array.from(seenBillIds).length],
    queryFn: async (): Promise<{ bills: RandomizedBill[]; newSeenIds: string[] }> => ({
      bills: [],
      newSeenIds: [],
    }),
    enabled: SUPABASE_DATA_ENABLED,
    staleTime: 1000 * 60 * 5,
  })
}
