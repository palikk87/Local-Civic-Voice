// Web port of mobile/src/lib/api/hooks.ts — same hooks against the same
// backend routes, using the webapp api helper instead of expo/fetch.
// User endpoints are typed to the real backend shape ({ results, pagination }).
import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { User } from "./types";

// ============================================================================
// Types
// ============================================================================

// Bill types - matches backend response
export interface ApiBill {
  id: string;
  title: string;
  summary: string;
  category: string;
  status: string;
  chamber: "house" | "senate";
  sponsor: string;
  introducedDate?: string;
  lastActionDate?: string;
  lastAction?: string;
  votes: {
    support: number;
    oppose: number;
    total: number;
  };
  postsCount: number;
  userVote: "support" | "oppose" | null;
  createdAt: string;
  // Extended fields for single bill response
  fullText?: string;
  cosponsors?: string[];
  sourceUrl?: string;
}

export interface BillsResponse {
  bills: ApiBill[];
  nextCursor?: string | null;
  hasMore: boolean;
}

export interface BillResponse {
  bill: ApiBill;
}

export interface VoteResponse {
  vote: {
    position: "support" | "oppose";
  };
  votes: {
    support: number;
    oppose: number;
    total: number;
  };
}

export interface RemoveVoteResponse {
  votes: {
    support: number;
    oppose: number;
    total: number;
  };
}

// User list endpoints (/api/users/discover|active|new|search)
export interface UsersResponse {
  results: User[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface FollowUserResponse {
  success: boolean;
  userId: string;
  isFollowing: boolean;
}

export interface UnfollowUserResponse {
  success: boolean;
  userId: string;
  isFollowing: boolean;
}

// ============================================================================
// Query Keys
// ============================================================================

export const queryKeys = {
  // Bills
  bills: ["bills"] as const,
  bill: (id: string) => ["bills", id] as const,

  // Users
  users: ["users"] as const,
  usersDiscover: () => ["users", "discover"] as const,
  usersActive: () => ["users", "active"] as const,
  usersNew: () => ["users", "new"] as const,
  usersSearch: (query: string) => ["users", "search", query] as const,
  user: (id: string) => ["users", id] as const,
} as const;

// ============================================================================
// Bills Hooks
// ============================================================================

/**
 * Fetch paginated list of bills
 */
export function useBills() {
  return useInfiniteQuery({
    queryKey: queryKeys.bills,
    queryFn: async ({ pageParam }) => {
      const url = pageParam ? `/api/bills?cursor=${pageParam}` : "/api/bills";
      return api.get<BillsResponse>(url);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}

/**
 * Fetch a single bill by ID
 */
export function useBill(id: string) {
  return useQuery({
    queryKey: queryKeys.bill(id),
    queryFn: () => api.get<BillResponse>(`/api/bills/${id}`),
    enabled: !!id,
  });
}

// Bill voting goes through the central reference vote pipeline
// (see reference-votes.ts) — the legacy /api/bills/:id/vote hooks were removed.

// ============================================================================
// Users Hooks
// ============================================================================

/**
 * Discover users (suggested for you)
 */
export function useDiscoverUsers(limit = 10) {
  return useQuery({
    queryKey: queryKeys.usersDiscover(),
    queryFn: () => api.get<UsersResponse>(`/api/users/discover?limit=${limit}`),
  });
}

/**
 * Get most active users (by votes)
 */
export function useActiveUsers(limit = 10) {
  return useQuery({
    queryKey: queryKeys.usersActive(),
    queryFn: () => api.get<UsersResponse>(`/api/users/active?limit=${limit}`),
  });
}

/**
 * Get newest members
 */
export function useNewUsers(limit = 10) {
  return useQuery({
    queryKey: queryKeys.usersNew(),
    queryFn: () => api.get<UsersResponse>(`/api/users/new?limit=${limit}`),
  });
}

/**
 * Search users by name or username
 */
export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: queryKeys.usersSearch(query),
    queryFn: () =>
      api.get<UsersResponse>(`/api/users/search?q=${encodeURIComponent(query)}`),
    enabled: query.length > 0,
  });
}

/**
 * Follow a user
 */
export function useFollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api.post<FollowUserResponse>(`/api/users/${userId}/follow`),
    onSuccess: (_data, userId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}

/**
 * Unfollow a user
 */
export function useUnfollowUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      api.delete<UnfollowUserResponse>(`/api/users/${userId}/follow`),
    onSuccess: (_data, userId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.user(userId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.users });
    },
  });
}
