import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  QueryKey,
} from "@tanstack/react-query";
import { api } from "@/lib/api/api";

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
  nextCursor: string | null;
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

// Post types
export interface ApiPost {
  id: string;
  content: string;
  author: ApiUser;
  billId?: string;
  bill?: ApiBill;
  createdAt: string;
  updatedAt: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
}

export interface PostsResponse {
  posts: ApiPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreatePostInput {
  content: string;
  billId?: string;
  /** GovernmentReference.id of the selected reference. The server resolves it and
   *  supplies the authoritative type and title. */
  governmentReferenceId: string;
  mediaIds?: string[];
}

export interface CreatePostResponse {
  post: ApiPost;
}

export interface DeletePostResponse {
  success: boolean;
  postId: string;
}

export interface LikePostResponse {
  success: boolean;
  postId: string;
  likesCount: number;
}

export interface UnlikePostResponse {
  success: boolean;
  postId: string;
  likesCount: number;
}

// User types
export interface ApiUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  location?: string;
  joinedDate: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing: boolean;
}

export interface UsersResponse {
  // Real backend shape: { results, pagination }
  results: ApiUser[];
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
}

export interface SearchUsersResponse {
  results: ApiUser[];
  pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
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
  billsList: (cursor?: string) => ["bills", "list", cursor] as const,
  bill: (id: string) => ["bills", id] as const,
  billPosts: (billId: string) => ["bills", billId, "posts"] as const,

  // Posts
  posts: ["posts"] as const,
  postsFeed: (cursor?: string) => ["posts", "feed", cursor] as const,
  post: (id: string) => ["posts", id] as const,

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
      const url = pageParam
        ? `/api/bills?cursor=${pageParam}`
        : "/api/bills";
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

/**
 * Fetch posts for a specific bill
 */
export function useBillPosts(billId: string) {
  return useQuery({
    queryKey: queryKeys.billPosts(billId),
    queryFn: () => api.get<PostsResponse>(`/api/bills/${billId}/posts`),
    enabled: !!billId,
  });
}

// ============================================================================
// Posts Hooks
// ============================================================================

/**
 * Fetch paginated posts feed
 */
export function usePosts() {
  return useInfiniteQuery({
    queryKey: queryKeys.posts,
    queryFn: async ({ pageParam }) => {
      const url = pageParam
        ? `/api/posts?cursor=${pageParam}`
        : "/api/posts";
      return api.get<PostsResponse>(url);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
  });
}

/**
 * Create a new post
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) =>
      api.post<CreatePostResponse>("/api/posts", input),
    onSuccess: () => {
      // Invalidate posts feed to show new post
      queryClient.invalidateQueries({
        queryKey: queryKeys.posts,
      });
    },
  });
}

/**
 * Delete a post
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      api.delete<DeletePostResponse>(`/api/posts/${postId}`),
    onSuccess: () => {
      // Invalidate posts feed
      queryClient.invalidateQueries({
        queryKey: queryKeys.posts,
      });
    },
  });
}

/**
 * Like a post
 */
export function useLikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      api.post<LikePostResponse>(`/api/posts/${postId}/like`),
    onSuccess: () => {
      // Invalidate posts feed to update like counts
      queryClient.invalidateQueries({
        queryKey: queryKeys.posts,
      });
    },
  });
}

/**
 * Unlike a post
 */
export function useUnlikePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) =>
      api.delete<UnlikePostResponse>(`/api/posts/${postId}/like`),
    onSuccess: () => {
      // Invalidate posts feed to update like counts
      queryClient.invalidateQueries({
        queryKey: queryKeys.posts,
      });
    },
  });
}

// ============================================================================
// Users Hooks
// ============================================================================

/**
 * Discover users
 */
export function useDiscoverUsers() {
  return useQuery({
    queryKey: queryKeys.usersDiscover(),
    queryFn: () => api.get<UsersResponse>("/api/users/discover"),
  });
}

/**
 * Get active users
 */
export function useActiveUsers() {
  return useQuery({
    queryKey: queryKeys.usersActive(),
    queryFn: () => api.get<UsersResponse>("/api/users/active"),
  });
}

/**
 * Get new members
 */
export function useNewUsers() {
  return useQuery({
    queryKey: queryKeys.usersNew(),
    queryFn: () => api.get<UsersResponse>("/api/users/new"),
  });
}

/**
 * Search users by query
 */
export function useSearchUsers(query: string) {
  return useQuery({
    queryKey: queryKeys.usersSearch(query),
    queryFn: () =>
      api.get<SearchUsersResponse>(
        `/api/users/search?q=${encodeURIComponent(query)}`
      ),
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
    onSuccess: (data, userId) => {
      // Invalidate user queries to update follow state
      queryClient.invalidateQueries({
        queryKey: queryKeys.user(userId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users,
      });
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
    onSuccess: (data, userId) => {
      // Invalidate user queries to update follow state
      queryClient.invalidateQueries({
        queryKey: queryKeys.user(userId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.users,
      });
    },
  });
}
