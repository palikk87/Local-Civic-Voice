import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query'

import { supabase, isSupabaseConfigured } from './supabase'
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
  FeedItem,
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

// Helper to safely extract data from Supabase responses
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractData<T>(data: any): T {
  return data as T
}

// ==========================================
// BILLS HOOKS
// ==========================================

export function useBills(params: BillSearchParams = {}) {
  return useQuery({
    queryKey: queryKeys.billSearch(params),
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      let query = supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)

      if (params.query) {
        query = query.or(`title.ilike.%${params.query}%,short_title.ilike.%${params.query}%,simplified_text.ilike.%${params.query}%`)
      }

      if (params.category) {
        query = query.eq('category', params.category)
      }

      if (params.status) {
        query = query.eq('status', params.status)
      }

      // Sorting
      if (params.sortBy === 'trending') {
        query = query.order('total_votes', { ascending: false })
      } else if (params.sortBy === 'oldest') {
        query = query.order('introduced_date', { ascending: true })
      } else {
        query = query.order('introduced_date', { ascending: false })
      }

      if (params.limit) {
        query = query.limit(params.limit)
      }

      if (params.offset) {
        query = query.range(params.offset, params.offset + (params.limit || 20) - 1)
      }

      const { data, error } = await query

      if (error) throw error
      return extractData<BillWithSponsor[]>(data) || []
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  })
}

export function useBill(id: string) {
  return useQuery({
    queryKey: queryKeys.bill(id),
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return null
      }

      const { data, error } = await supabase
        .from('bills')
        .select(`
          *,
          representatives (*),
          related_laws (*)
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      return data
    },
    enabled: isSupabaseConfigured() && !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useTrendingBills(limit = 5) {
  return useQuery({
    queryKey: [...queryKeys.trendingBills, limit],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      const { data, error } = await supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .eq('is_trending', true)
        .order('total_votes', { ascending: false })
        .limit(limit)

      if (error) throw error
      return extractData<BillWithSponsor[]>(data) || []
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 5,
  })
}

// ==========================================
// FEED HOOKS
// ==========================================

interface FeedItemRaw extends FeedItem {
  profiles: Profile
  bills: Bill
  votes: Vote | null
}

export function useFeed(limit = 20) {
  return useQuery({
    queryKey: queryKeys.feed(limit),
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      const { data, error } = await supabase
        .from('feed_items')
        .select(`
          *,
          profiles:user_id (*),
          bills:bill_id (*),
          votes:vote_id (*)
        `)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error

      const rawData = extractData<FeedItemRaw[]>(data) || []

      // Transform the data to match our expected type
      return rawData.map((item) => ({
        ...item,
        user: item.profiles,
        bill: item.bills,
        vote: item.votes,
      })) as FeedItemWithDetails[]
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 2, // 2 minutes for feed
  })
}

export function useInfiniteFeed(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: queryKeys.feedInfinite(pageSize),
    queryFn: async ({ pageParam = 0 }) => {
      if (!isSupabaseConfigured()) {
        return { items: [] as FeedItemWithDetails[], nextOffset: null }
      }

      const { data, error } = await supabase
        .from('feed_items')
        .select(`
          *,
          profiles:user_id (*),
          bills:bill_id (*),
          votes:vote_id (*)
        `)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + pageSize - 1)

      if (error) throw error

      const rawData = extractData<FeedItemRaw[]>(data) || []

      const items = rawData.map((item) => ({
        ...item,
        user: item.profiles,
        bill: item.bills,
        vote: item.votes,
      })) as FeedItemWithDetails[]

      return {
        items,
        nextOffset: items.length === pageSize ? pageParam + pageSize : null,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    initialPageParam: 0,
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 2,
  })
}

// ==========================================
// VOTING HOOKS
// ==========================================

export function useUserVote(userId: string | undefined, billId: string) {
  return useQuery({
    queryKey: queryKeys.userVote(userId || '', billId),
    queryFn: async () => {
      if (!isSupabaseConfigured() || !userId) {
        return null
      }

      const { data, error } = await supabase
        .from('votes')
        .select('*')
        .eq('user_id', userId)
        .eq('bill_id', billId)
        .maybeSingle()

      if (error) throw error
      return extractData<Vote | null>(data)
    },
    enabled: isSupabaseConfigured() && !!userId && !!billId,
    staleTime: 1000 * 60 * 5,
  })
}

interface VoteWithBillRaw extends Vote {
  bills: Bill
}

export function useUserVoteHistory(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.userVoteHistory(userId || ''),
    queryFn: async () => {
      if (!isSupabaseConfigured() || !userId) {
        return []
      }

      const { data, error } = await supabase
        .from('votes')
        .select(`
          *,
          bills (*)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) throw error

      const rawData = extractData<VoteWithBillRaw[]>(data) || []

      return rawData.map((item) => ({
        ...item,
        bill: item.bills,
      })) as VoteWithBill[]
    },
    enabled: isSupabaseConfigured() && !!userId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCastVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      billId,
      vote,
    }: {
      userId: string
      billId: string
      vote: VoteType
    }) => {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase not configured')
      }

      // Upsert the vote (insert or update)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('votes') as any)
        .upsert(
          {
            user_id: userId,
            bill_id: billId,
            vote,
          },
          {
            onConflict: 'user_id,bill_id',
          }
        )
        .select()
        .single()

      if (error) throw error
      return data
    },
    onMutate: async ({ userId, billId, vote }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.userVote(userId, billId) })
      await queryClient.cancelQueries({ queryKey: queryKeys.bill(billId) })

      // Snapshot previous values
      const previousVote = queryClient.getQueryData(queryKeys.userVote(userId, billId))
      const previousBill = queryClient.getQueryData(queryKeys.bill(billId))

      // Optimistically update the vote
      queryClient.setQueryData(queryKeys.userVote(userId, billId), {
        user_id: userId,
        bill_id: billId,
        vote,
      })

      // Optimistically update bill counts
      queryClient.setQueryData(queryKeys.bill(billId), (old: BillWithSponsor | undefined) => {
        if (!old) return old
        const wasYea = (previousVote as Vote | null)?.vote === 'yea'
        const wasNay = (previousVote as Vote | null)?.vote === 'nay'
        const hadVote = wasYea || wasNay

        return {
          ...old,
          yea_count: old.yea_count + (vote === 'yea' ? 1 : 0) - (wasYea ? 1 : 0),
          nay_count: old.nay_count + (vote === 'nay' ? 1 : 0) - (wasNay ? 1 : 0),
          total_votes: old.total_votes + (hadVote ? 0 : 1),
        }
      })

      return { previousVote, previousBill }
    },
    onError: (_err, { userId, billId }, context) => {
      // Rollback on error
      if (context?.previousVote !== undefined) {
        queryClient.setQueryData(queryKeys.userVote(userId, billId), context.previousVote)
      }
      if (context?.previousBill !== undefined) {
        queryClient.setQueryData(queryKeys.bill(billId), context.previousBill)
      }
    },
    onSettled: (_data, _error, { userId, billId }) => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: queryKeys.userVote(userId, billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.bill(billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.userVoteHistory(userId) })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })
}

export function useRemoveVote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, billId }: { userId: string; billId: string }) => {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase not configured')
      }

      const { error } = await supabase
        .from('votes')
        .delete()
        .eq('user_id', userId)
        .eq('bill_id', billId)

      if (error) throw error
    },
    onSettled: (_data, _error, { userId, billId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userVote(userId, billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.bill(billId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.userVoteHistory(userId) })
    },
  })
}

// ==========================================
// FEED LIKES HOOKS
// ==========================================

export function useUserFeedLikes(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.feedLikes(userId || ''),
    queryFn: async () => {
      if (!isSupabaseConfigured() || !userId) {
        return new Set<string>()
      }

      const { data, error } = await supabase
        .from('feed_likes')
        .select('feed_item_id')
        .eq('user_id', userId)

      if (error) throw error
      const rawData = extractData<{ feed_item_id: string }[]>(data) || []
      return new Set(rawData.map((item) => item.feed_item_id))
    },
    enabled: isSupabaseConfigured() && !!userId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useToggleFeedLike() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      userId,
      feedItemId,
      isLiked,
    }: {
      userId: string
      feedItemId: string
      isLiked: boolean
    }) => {
      if (!isSupabaseConfigured()) {
        throw new Error('Supabase not configured')
      }

      if (isLiked) {
        // Unlike
        const { error } = await supabase
          .from('feed_likes')
          .delete()
          .eq('user_id', userId)
          .eq('feed_item_id', feedItemId)

        if (error) throw error
      } else {
        // Like
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from('feed_likes') as any).insert({
          user_id: userId,
          feed_item_id: feedItemId,
        })

        if (error) throw error
      }
    },
    onMutate: async ({ userId, feedItemId, isLiked }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.feedLikes(userId) })

      const previousLikes = queryClient.getQueryData<Set<string>>(queryKeys.feedLikes(userId))

      queryClient.setQueryData(queryKeys.feedLikes(userId), (old: Set<string> | undefined) => {
        const newSet = new Set(old)
        if (isLiked) {
          newSet.delete(feedItemId)
        } else {
          newSet.add(feedItemId)
        }
        return newSet
      })

      return { previousLikes }
    },
    onError: (_err, { userId }, context) => {
      if (context?.previousLikes) {
        queryClient.setQueryData(queryKeys.feedLikes(userId), context.previousLikes)
      }
    },
    onSettled: (_data, _error, { userId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.feedLikes(userId) })
      queryClient.invalidateQueries({ queryKey: ['feed'] })
    },
  })
}

// ==========================================
// REPRESENTATIVES HOOKS
// ==========================================

export function useRepresentatives(filters?: { chamber?: 'house' | 'senate'; search?: string }) {
  return useQuery({
    queryKey: [...queryKeys.representatives, filters],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      let query = supabase.from('representatives').select('*')

      if (filters?.chamber) {
        query = query.eq('chamber', filters.chamber)
      }

      if (filters?.search) {
        query = query.or(`name.ilike.%${filters.search}%,state.ilike.%${filters.search}%`)
      }

      query = query.order('name')

      const { data, error } = await query

      if (error) throw error
      return extractData<Representative[]>(data) || []
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 30, // 30 minutes - representatives don't change often
  })
}

// ==========================================
// DELEGATES HOOKS
// ==========================================

interface DelegateProfileRaw {
  id: string
  user_id: string
  expertise: BillCategory[]
  delegator_count: number
  total_votes: number
  yea_votes: number
  nay_votes: number
  bio: string | null
  is_featured: boolean
  created_at: string
  updated_at: string
  profiles: Profile
}

export function useFeaturedDelegates() {
  return useQuery({
    queryKey: queryKeys.delegates,
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      const { data, error } = await supabase
        .from('delegate_profiles')
        .select(`
          *,
          profiles:user_id (*)
        `)
        .eq('is_featured', true)
        .order('delegator_count', { ascending: false })

      if (error) throw error

      const rawData = extractData<DelegateProfileRaw[]>(data) || []

      return rawData.map((item) => ({
        ...item,
        user: item.profiles,
      })) as DelegateProfileWithUser[]
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 10,
  })
}

// ==========================================
// PROFILE HOOKS
// ==========================================

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.profile(userId || ''),
    queryFn: async () => {
      if (!isSupabaseConfigured() || !userId) {
        return null
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) throw error
      return extractData<Profile>(data)
    },
    enabled: isSupabaseConfigured() && !!userId,
    staleTime: 1000 * 60 * 5,
  })
}

// ==========================================
// DAILY BILL DIGEST HOOKS (Voice Weight)
// ==========================================

export interface DailyDigestBill extends Bill {
  weight_score: number
  cosponsor_count: number
  amendment_count: number
  representatives?: Representative | null
}

export function useDailyBillDigest(limit = 10, category?: BillCategory) {
  return useQuery({
    queryKey: ['dailyDigest', limit, category],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      let query = supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .order('weight_score', { ascending: false })
        .limit(limit)

      if (category) {
        query = query.eq('category', category)
      }

      const { data, error } = await query

      if (error) throw error
      return extractData<DailyDigestBill[]>(data) || []
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 10, // 10 minutes - digest doesn't change frequently
  })
}

export function useHighImpactBills(minWeight = 25, limit = 20) {
  return useQuery({
    queryKey: ['highImpactBills', minWeight, limit],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return []
      }

      const { data, error } = await supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .gte('weight_score', minWeight)
        .order('weight_score', { ascending: false })
        .limit(limit)

      if (error) throw error
      return extractData<DailyDigestBill[]>(data) || []
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 10,
  })
}

// ==========================================
// MULTI-SESSION CONGRESS HOOKS
// ==========================================

export function useCurrentCongress() {
  return useQuery({
    queryKey: ['currentCongress'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return 119 // Default to 119th Congress
      }

      const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'current_congress')
        .single()

      if (error) {
        console.warn('Failed to fetch current congress:', error)
        return 119
      }
      const result = data as { value: string } | null
      return parseInt(result?.value ?? '119', 10)
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 60, // 1 hour - rarely changes
  })
}

export function useCurrentCongressBills(limit = 50, category?: BillCategory) {
  const { data: currentCongress } = useCurrentCongress()

  return useQuery({
    queryKey: ['currentCongressBills', currentCongress, limit, category],
    queryFn: async () => {
      if (!isSupabaseConfigured() || !currentCongress) {
        return []
      }

      let query = supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .eq('congress_number', currentCongress)
        .order('weight_score', { ascending: false, nullsFirst: false })
        .order('introduced_date', { ascending: false })
        .limit(limit)

      if (category) {
        query = query.eq('category', category)
      }

      const { data, error } = await query

      if (error) throw error
      return extractData<DailyDigestBill[]>(data) || []
    },
    enabled: isSupabaseConfigured() && !!currentCongress,
    staleTime: 1000 * 60 * 10,
  })
}

export interface HistoricalBill extends Bill {
  congress_number: number
  congress_label: string
  representatives?: Representative | null
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
    queryFn: async () => {
      if (!isSupabaseConfigured() || !currentCongress) {
        return []
      }

      let query = supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .lt('congress_number', currentCongress)
        .order('congress_number', { ascending: false })
        .order('introduced_date', { ascending: false })
        .range(offset, offset + limit - 1)

      if (congressNumber) {
        query = query.eq('congress_number', congressNumber)
      }

      if (category) {
        query = query.eq('category', category)
      }

      const { data, error } = await query

      if (error) throw error

      // Add congress_label to each bill
      const getCongressLabel = (num: number): string => {
        const labels: Record<number, string> = {
          119: '119th Congress (2025-2027)',
          118: '118th Congress (2023-2025)',
          117: '117th Congress (2021-2023)',
          116: '116th Congress (2019-2021)',
        }
        return labels[num] || `${num}th Congress`
      }

      return (extractData<Bill[]>(data) || []).map((bill) => ({
        ...bill,
        congress_label: getCongressLabel(bill.congress_number),
      })) as HistoricalBill[]
    },
    enabled: isSupabaseConfigured() && !!currentCongress,
    staleTime: 1000 * 60 * 30, // 30 minutes - historical data rarely changes
  })
}

export interface CongressInfo {
  congress_number: number
  congress_label: string
  bill_count: number
  is_current: boolean
}

export function useAvailableCongresses() {
  return useQuery({
    queryKey: ['availableCongresses'],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return [{
          congress_number: 119,
          congress_label: '119th Congress (2025-2027)',
          bill_count: 0,
          is_current: true,
        }] as CongressInfo[]
      }

      const { data: currentCongressData } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'current_congress')
        .single()

      const settingsResult = currentCongressData as { value: string } | null
      const currentCongress = parseInt(settingsResult?.value ?? '119', 10)

      const { data, error } = await supabase
        .from('bills')
        .select('congress_number')

      if (error) throw error

      // Aggregate by congress_number
      const billsData = extractData<{ congress_number: number }[]>(data) || []
      const congressCounts = billsData.reduce<Record<number, number>>((acc, bill) => {
        const num = bill.congress_number
        acc[num] = (acc[num] || 0) + 1
        return acc
      }, {})

      const getCongressLabel = (num: number): string => {
        const labels: Record<number, string> = {
          119: '119th Congress (2025-2027)',
          118: '118th Congress (2023-2025)',
          117: '117th Congress (2021-2023)',
          116: '116th Congress (2019-2021)',
        }
        return labels[num] || `${num}th Congress`
      }

      return Object.entries(congressCounts)
        .map(([num, count]) => ({
          congress_number: parseInt(num, 10),
          congress_label: getCongressLabel(parseInt(num, 10)),
          bill_count: count,
          is_current: parseInt(num, 10) === currentCongress,
        }))
        .sort((a, b) => b.congress_number - a.congress_number) as CongressInfo[]
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 30,
  })
}

// ==========================================
// RANDOMIZED BILL FEED HOOKS
// ==========================================

export interface RandomizedBill extends DailyDigestBill {
  discovery_score: number
}

/**
 * Fetch bills for randomized feed with weighted discovery scores
 * Used for the "For You" feed with session exclusion
 */
export function useRandomizedBillFeed(
  seenBillIds: Set<string>,
  limit = 10,
  category?: BillCategory
) {
  return useQuery({
    queryKey: ['randomizedFeed', limit, category, Array.from(seenBillIds).length],
    queryFn: async () => {
      if (!isSupabaseConfigured()) {
        return { bills: [] as RandomizedBill[], newSeenIds: [] as string[] }
      }

      // Fetch more bills than needed to allow filtering
      const fetchLimit = Math.max(50, limit * 3)

      let query = supabase
        .from('bills')
        .select(`
          *,
          representatives (*)
        `)
        .order('weight_score', { ascending: false, nullsFirst: false })
        .limit(fetchLimit)

      if (category) {
        query = query.eq('category', category)
      }

      const { data, error } = await query

      if (error) throw error

      const allBills = extractData<DailyDigestBill[]>(data) || []

      // Filter out seen bills
      const unseenBills = allBills.filter(bill => !seenBillIds.has(bill.id))

      // Apply weighted randomization (imported from feed-algorithm)
      // Take top 20, assign discovery scores, shuffle, re-sort
      const topPool = unseenBills.slice(0, 20)
      const randomized = topPool.map(bill => ({
        ...bill,
        discovery_score: (bill.weight_score ?? 0) * (0.7 + Math.random() * 0.6),
      }))

      // Sort by discovery_score
      randomized.sort((a, b) => b.discovery_score - a.discovery_score)

      // Take requested limit
      const result = randomized.slice(0, limit)
      const newSeenIds = result.map(bill => bill.id)

      return {
        bills: result,
        newSeenIds,
      }
    },
    enabled: isSupabaseConfigured(),
    staleTime: 1000 * 60 * 2, // 2 minutes - refresh more frequently for variety
  })
}
