/**
 * Feed Store - Manages the algorithmic feed state
 *
 * This store handles:
 * - Fetching personalized feed from the backend algorithm
 * - Pagination with cursor-based loading
 * - Caching and optimistic updates
 * - Integration with interaction tracking
 */

import { create } from 'zustand';
import {
  getFeed,
  getDiscoverFeed,
  getSavedPosts,
  getTrendingCreators,
  getSimilarUsers,
  savePost as apiSavePost,
  sharePost as apiSharePost,
  type FeedPost,
  type FeedType,
  type TrendingCreator,
  type SimilarUser,
} from './api/feed';
import { api } from './api/api';
import { interactionTracker } from './interaction-tracker';

interface FeedState {
  // Feed data by type
  feeds: Record<FeedType, {
    posts: FeedPost[];
    nextCursor: string | null;
    hasMore: boolean;
    isLoading: boolean;
    error: string | null;
  }>;

  // Saved posts
  savedPosts: FeedPost[];
  savedNextCursor: string | null;
  savedHasMore: boolean;
  savedLoading: boolean;

  // Discovery data
  trendingCreators: TrendingCreator[];
  similarUsers: SimilarUser[];

  // Current active feed type
  activeFeedType: FeedType;

  // Actions
  setActiveFeedType: (type: FeedType) => void;
  fetchFeed: (type?: FeedType, refresh?: boolean) => Promise<void>;
  loadMoreFeed: (type?: FeedType) => Promise<void>;
  fetchSavedPosts: (refresh?: boolean) => Promise<void>;
  loadMoreSavedPosts: () => Promise<void>;
  fetchTrendingCreators: () => Promise<void>;
  fetchSimilarUsers: () => Promise<void>;

  // Post actions
  likePost: (postId: string) => Promise<void>;
  savePost: (postId: string) => Promise<void>;
  sharePost: (postId: string, shareType?: 'internal' | 'external' | 'dm') => Promise<void>;

  // Utility
  refreshAllFeeds: () => Promise<void>;
  clearFeeds: () => void;
}

const initialFeedState = {
  posts: [],
  nextCursor: null,
  hasMore: true,
  isLoading: false,
  error: null,
};

export const useFeedStore = create<FeedState>((set, get) => ({
  feeds: {
    for_you: { ...initialFeedState },
    following: { ...initialFeedState },
    trending: { ...initialFeedState },
    discover: { ...initialFeedState },
  },

  savedPosts: [],
  savedNextCursor: null,
  savedHasMore: true,
  savedLoading: false,

  trendingCreators: [],
  similarUsers: [],

  activeFeedType: 'for_you',

  setActiveFeedType: (type) => {
    set({ activeFeedType: type });
    // Fetch if not already loaded
    const feed = get().feeds[type];
    if (feed.posts.length === 0 && !feed.isLoading) {
      get().fetchFeed(type);
    }
  },

  fetchFeed: async (type, refresh = false) => {
    const feedType = type || get().activeFeedType;
    const currentFeed = get().feeds[feedType];

    // Don't fetch if already loading
    if (currentFeed.isLoading && !refresh) return;

    set((state) => ({
      feeds: {
        ...state.feeds,
        [feedType]: {
          ...state.feeds[feedType],
          isLoading: true,
          error: null,
          // Reset on refresh
          ...(refresh ? { posts: [], nextCursor: null, hasMore: true } : {}),
        },
      },
    }));

    try {
      // Get viewed posts for exclusion (only for "For You" feed)
      const excludePostIds = feedType === 'for_you'
        ? interactionTracker.getViewedPostIds()
        : undefined;

      const response = await getFeed(feedType, 20, undefined, excludePostIds);

      set((state) => ({
        feeds: {
          ...state.feeds,
          [feedType]: {
            posts: response.posts,
            nextCursor: response.nextCursor,
            hasMore: response.hasMore,
            isLoading: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        feeds: {
          ...state.feeds,
          [feedType]: {
            ...state.feeds[feedType],
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to fetch feed',
          },
        },
      }));
    }
  },

  loadMoreFeed: async (type) => {
    const feedType = type || get().activeFeedType;
    const currentFeed = get().feeds[feedType];

    // Don't load if already loading, no more items, or no cursor
    if (currentFeed.isLoading || !currentFeed.hasMore || !currentFeed.nextCursor) return;

    set((state) => ({
      feeds: {
        ...state.feeds,
        [feedType]: {
          ...state.feeds[feedType],
          isLoading: true,
        },
      },
    }));

    try {
      const response = await getFeed(feedType, 20, currentFeed.nextCursor);

      set((state) => ({
        feeds: {
          ...state.feeds,
          [feedType]: {
            posts: [...state.feeds[feedType].posts, ...response.posts],
            nextCursor: response.nextCursor,
            hasMore: response.hasMore,
            isLoading: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      set((state) => ({
        feeds: {
          ...state.feeds,
          [feedType]: {
            ...state.feeds[feedType],
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to load more',
          },
        },
      }));
    }
  },

  fetchSavedPosts: async (refresh = false) => {
    const { savedLoading } = get();
    if (savedLoading && !refresh) return;

    set({
      savedLoading: true,
      ...(refresh ? { savedPosts: [], savedNextCursor: null, savedHasMore: true } : {}),
    });

    try {
      const response = await getSavedPosts(20);
      set({
        savedPosts: response.posts,
        savedNextCursor: response.nextCursor,
        savedHasMore: response.hasMore,
        savedLoading: false,
      });
    } catch {
      set({ savedLoading: false });
    }
  },

  loadMoreSavedPosts: async () => {
    const { savedLoading, savedHasMore, savedNextCursor } = get();
    if (savedLoading || !savedHasMore || !savedNextCursor) return;

    set({ savedLoading: true });

    try {
      const response = await getSavedPosts(20, savedNextCursor);
      set((state) => ({
        savedPosts: [...state.savedPosts, ...response.posts],
        savedNextCursor: response.nextCursor,
        savedHasMore: response.hasMore,
        savedLoading: false,
      }));
    } catch {
      set({ savedLoading: false });
    }
  },

  fetchTrendingCreators: async () => {
    try {
      const response = await getTrendingCreators();
      set({ trendingCreators: response.creators });
    } catch {
      console.warn('Failed to fetch trending creators');
    }
  },

  fetchSimilarUsers: async () => {
    try {
      const response = await getSimilarUsers();
      set({ similarUsers: response.users });
    } catch {
      console.warn('Failed to fetch similar users');
    }
  },

  likePost: async (postId) => {
    // Optimistic update across all feeds
    set((state) => {
      const updatePostInFeed = (posts: FeedPost[]) =>
        posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                isLiked: !p.isLiked,
                metrics: {
                  ...p.metrics,
                  likes: p.isLiked ? p.metrics.likes - 1 : p.metrics.likes + 1,
                },
              }
            : p
        );

      return {
        feeds: {
          for_you: { ...state.feeds.for_you, posts: updatePostInFeed(state.feeds.for_you.posts) },
          following: { ...state.feeds.following, posts: updatePostInFeed(state.feeds.following.posts) },
          trending: { ...state.feeds.trending, posts: updatePostInFeed(state.feeds.trending.posts) },
          discover: { ...state.feeds.discover, posts: updatePostInFeed(state.feeds.discover.posts) },
        },
        savedPosts: updatePostInFeed(state.savedPosts),
      };
    });

    // Track interaction
    interactionTracker.trackLike(postId);

    // Call API
    try {
      await api.post(`/api/posts/${postId}/like`);
    } catch {
      // Revert on error (could implement this)
      console.warn('Failed to like post');
    }
  },

  savePost: async (postId) => {
    // Optimistic update
    set((state) => {
      const updatePostInFeed = (posts: FeedPost[]) =>
        posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                isSaved: !p.isSaved,
                metrics: {
                  ...p.metrics,
                  saves: p.isSaved ? p.metrics.saves - 1 : p.metrics.saves + 1,
                },
              }
            : p
        );

      return {
        feeds: {
          for_you: { ...state.feeds.for_you, posts: updatePostInFeed(state.feeds.for_you.posts) },
          following: { ...state.feeds.following, posts: updatePostInFeed(state.feeds.following.posts) },
          trending: { ...state.feeds.trending, posts: updatePostInFeed(state.feeds.trending.posts) },
          discover: { ...state.feeds.discover, posts: updatePostInFeed(state.feeds.discover.posts) },
        },
      };
    });

    // Track interaction
    interactionTracker.trackSave(postId);

    try {
      await apiSavePost(postId);
    } catch {
      console.warn('Failed to save post');
    }
  },

  sharePost: async (postId, shareType = 'internal') => {
    // Update share count optimistically
    set((state) => {
      const updatePostInFeed = (posts: FeedPost[]) =>
        posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                metrics: {
                  ...p.metrics,
                  shares: p.metrics.shares + 1,
                },
              }
            : p
        );

      return {
        feeds: {
          for_you: { ...state.feeds.for_you, posts: updatePostInFeed(state.feeds.for_you.posts) },
          following: { ...state.feeds.following, posts: updatePostInFeed(state.feeds.following.posts) },
          trending: { ...state.feeds.trending, posts: updatePostInFeed(state.feeds.trending.posts) },
          discover: { ...state.feeds.discover, posts: updatePostInFeed(state.feeds.discover.posts) },
        },
        savedPosts: updatePostInFeed(state.savedPosts),
      };
    });

    // Track interaction
    interactionTracker.trackShare(postId, shareType);

    try {
      await apiSharePost(postId, shareType);
    } catch {
      console.warn('Failed to track share');
    }
  },

  refreshAllFeeds: async () => {
    const { fetchFeed } = get();
    await Promise.all([
      fetchFeed('for_you', true),
      fetchFeed('following', true),
      fetchFeed('trending', true),
      fetchFeed('discover', true),
    ]);
  },

  clearFeeds: () => {
    set({
      feeds: {
        for_you: { ...initialFeedState },
        following: { ...initialFeedState },
        trending: { ...initialFeedState },
        discover: { ...initialFeedState },
      },
      savedPosts: [],
      savedNextCursor: null,
      savedHasMore: true,
      trendingCreators: [],
      similarUsers: [],
    });
    interactionTracker.clearSession();
  },
}));

// Selectors
export const selectActiveFeed = (state: FeedState) => state.feeds[state.activeFeedType];
export const selectFeedByType = (type: FeedType) => (state: FeedState) => state.feeds[type];
export const selectTrendingCreators = (state: FeedState) => state.trendingCreators;
export const selectSimilarUsers = (state: FeedState) => state.similarUsers;
export const selectSavedPosts = (state: FeedState) => state.savedPosts;
