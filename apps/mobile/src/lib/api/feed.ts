/**
 * Feed API - Client for the social media feed algorithm API
 */

import { api } from './api';

// Types for feed responses
export interface FeedAuthor {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  followerCount: number;
  isFollowed: boolean;
}

export interface FeedBill {
  id: string;
  title: string;
  category: string;
}

export interface FeedMetrics {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
}

export interface FeedPost {
  id: string;
  content: string;
  author: FeedAuthor;
  bill: FeedBill | null;
  metrics: FeedMetrics;
  feedReason: string;
  isLiked: boolean;
  isSaved: boolean;
  createdAt: string;
}

export interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TrendingCreator {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  bio: string | null;
  followerCount: number;
  totalLikes: number;
  engagementRate: number;
  influenceScore: number;
  topCategories: string[];
  isFollowed: boolean;
}

export interface SimilarUser {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  bio: string | null;
  followerCount: number;
  postCount: number;
  isFollowed: boolean;
}

export interface TrendingHashtag {
  tag: string;
  count: number;
}

export type FeedType = 'for_you' | 'following' | 'trending' | 'discover';
export type InteractionType = 'view' | 'like' | 'comment' | 'share' | 'save' | 'follow' | 'mention' | 'dwell';

/**
 * Get personalized feed based on algorithm
 */
export async function getFeed(
  type: FeedType = 'for_you',
  limit: number = 20,
  cursor?: string,
  excludePostIds?: string[]
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  params.set('type', type);
  params.set('limit', limit.toString());
  if (cursor) params.set('cursor', cursor);
  if (excludePostIds?.length) params.set('exclude', excludePostIds.join(','));

  return api.get<FeedResponse>(`/api/feed?${params.toString()}`);
}

/**
 * Get discovery feed (content from people you don't follow)
 */
export async function getDiscoverFeed(limit: number = 20): Promise<FeedResponse> {
  return api.get<FeedResponse>(`/api/feed/discover?limit=${limit}`);
}

/**
 * Track a single user interaction
 */
export async function trackInteraction(
  interactionType: InteractionType,
  postId?: string,
  targetUserId?: string,
  dwellTimeMs?: number,
  metadata?: Record<string, unknown>
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>('/api/feed/interaction', {
    interactionType,
    postId,
    targetUserId,
    dwellTimeMs,
    metadata,
  });
}

/**
 * Track multiple interactions at once (more efficient for batching)
 */
export async function trackInteractionsBatch(
  interactions: Array<{
    interactionType: InteractionType;
    postId?: string;
    targetUserId?: string;
    dwellTimeMs?: number;
    metadata?: Record<string, unknown>;
  }>
): Promise<{ success: boolean; tracked: number }> {
  return api.post<{ success: boolean; tracked: number }>('/api/feed/interactions/batch', {
    interactions,
  });
}

/**
 * Get users with similar voting patterns
 */
export async function getSimilarUsers(): Promise<{ users: SimilarUser[] }> {
  return api.get<{ users: SimilarUser[] }>('/api/feed/similar-users');
}

/**
 * Get trending hashtags
 */
export async function getTrendingHashtags(): Promise<{ hashtags: TrendingHashtag[] }> {
  return api.get<{ hashtags: TrendingHashtag[] }>('/api/feed/trending-hashtags');
}

/**
 * Get trending/popular content creators
 */
export async function getTrendingCreators(): Promise<{ creators: TrendingCreator[] }> {
  return api.get<{ creators: TrendingCreator[] }>('/api/feed/trending-creators');
}

/**
 * Save/bookmark a post
 */
export async function savePost(postId: string): Promise<{ success: boolean; saved: boolean }> {
  return api.post<{ success: boolean; saved: boolean }>(`/api/feed/posts/${postId}/save`);
}

/**
 * Share a post (track the share)
 */
export async function sharePost(
  postId: string,
  shareType: 'internal' | 'external' | 'dm' = 'internal'
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/feed/posts/${postId}/share`, { shareType });
}

/**
 * Get user's saved posts
 */
export async function getSavedPosts(
  limit: number = 20,
  cursor?: string
): Promise<FeedResponse> {
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  if (cursor) params.set('cursor', cursor);

  return api.get<FeedResponse>(`/api/feed/saved?${params.toString()}`);
}

/**
 * Refresh creator metrics for current user
 */
export async function refreshMyCreatorMetrics(): Promise<{ success: boolean; metrics: unknown }> {
  // This endpoint uses the current user's ID from the session
  return api.post<{ success: boolean; metrics: unknown }>('/api/feed/refresh-creator-metrics/me');
}

/**
 * Pass a post on. With `content` it is a quote — your words above theirs.
 * Without, pressing it again takes it back.
 */
export function repostPost(postId: string, content?: string) {
  return api.post<{ reposted: boolean; repostId?: string; repostsCount: number }>(
    `/api/posts/${postId}/repost`,
    content ? { content } : {},
  );
}

export interface PostSearchResult {
  id: string;
  content: string;
  author: { id: string; displayName: string; username: string; avatar: string };
  referenceTitle: string | null;
  governmentReferenceId: string | null;
  commentsCount: number;
  likesCount: number;
  createdAt: string;
}

/** Find what people have said, not just who they are. */
export function searchPosts(q: string) {
  return api.get<{ results: PostSearchResult[] }>(
    `/api/posts/search?q=${encodeURIComponent(q)}`,
  );
}

/** The posts under one tag. */
export function postsByHashtag(tag: string) {
  return api.get<{ tag: string; count: number; results: PostSearchResult[] }>(
    `/api/posts/hashtag/${encodeURIComponent(tag.replace(/^#/, ""))}`,
  );
}
