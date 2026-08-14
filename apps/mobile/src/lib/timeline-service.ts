/**
 * Timeline service — inert. Kept for its exported types and call sites.
 *
 * These six functions read and wrote `timeline_posts` and `bill_cache` in a
 * Supabase project, through `@supabase/supabase-js`, over a snake_case schema
 * that is not the Prisma schema this product runs on. Every function opened
 * with `if (!isSupabaseConfigured()) return <failure>`, and that gate has always
 * been false — so none of the bodies has ever run here.
 *
 * The bodies are removed along with the SDK. A vendor client in the app is the
 * coupling this project is eliminating: the database must stay plain Postgres
 * behind a connection string, reachable only by the backend, so it can be moved
 * between providers without an application change.
 *
 * Each function keeps its signature and returns exactly what it returned when
 * disabled, which is what callers already handle. The real timeline lives in
 * the backend's Post and Comment models and is reached through `lib/api`.
 */

import type { TimelinePostWithBill } from './database.types';

// Type for creating a new timeline post (lightweight)
interface CreateTimelinePost {
  userId: string;
  billCacheId: string;
  opinion?: string;
}

// Type for timeline post with bill data (from SQL join)
export interface TimelinePostWithBillData {
  id: string;
  userId: string;
  opinion: string | null;
  likesCount: number;
  sharesCount: number;
  createdAt: string;
  // Bill data from join
  bill?: {
    id: string;
    title: string;
    shortTitle: string;
    status: string;
    category: string;
    date: string;
    sourceUrl: string;
    rawText: string;
    metadata: Record<string, unknown>;
  } | null;
  // User profile from join
  author?: {
    id: string;
    username: string;
    displayName: string;
    avatar: string | null;
  } | null;
}

const UNAVAILABLE = 'Timeline service is not available. Use the backend API (lib/api).';

export async function createTimelinePost(
  _post: CreateTimelinePost
): Promise<{ success: boolean; postId?: string; error?: string }> {
  return { success: false, error: UNAVAILABLE };
}

export async function loadTimelinePosts(
  _limit = 20,
  _offset = 0
): Promise<TimelinePostWithBillData[]> {
  return [];
}

export async function likeTimelinePost(_postId: string): Promise<{ success: boolean }> {
  return { success: false };
}

export async function shareTimelinePost(_postId: string): Promise<{ success: boolean }> {
  return { success: false };
}

export async function deleteTimelinePost(
  _postId: string,
  _userId: string
): Promise<{ success: boolean }> {
  return { success: false };
}

export async function getBillCacheId(_billId: string): Promise<string | null> {
  return null;
}

// Re-exported so importers of this module keep the type they had.
export type { TimelinePostWithBill };
