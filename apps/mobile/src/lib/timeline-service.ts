/**
 * Timeline Service - Lightweight Supabase integration for posts
 *
 * Cost Optimization Strategy:
 * - Posts table only stores: user_id, bill_cache_id, opinion
 * - Bill details are fetched via SQL JOIN from bill_cache table
 * - This keeps the database small and within Supabase Free Tier
 *
 * Note: These functions silently fail if tables don't exist yet.
 * The tables are optional cost optimizations.
 */

import { supabase, isSupabaseConfigured } from './supabase';
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

/**
 * Helper to extract error message safely
 */
function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return (error as { message: string }).message;
  }
  return 'Unknown error';
}

/**
 * Check if error is "table doesn't exist" (expected when tables not created yet)
 */
function isTableNotExistError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('does not exist') || message.includes('relation');
}

/**
 * Create a timeline post (lightweight - only stores references)
 * The bill data is already in bill_cache, so we just reference it
 */
export async function createTimelinePost(
  post: CreateTimelinePost
): Promise<{ success: boolean; postId?: string; error?: string }> {
  if (!isSupabaseConfigured()) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { data, error } = await supabase
      .from('timeline_posts')
      .insert({
        user_id: post.userId,
        bill_cache_id: post.billCacheId,
        opinion: post.opinion ?? null,
      } as never)
      .select('id')
      .single();

    if (error) {
      // Silently skip if table doesn't exist
      if (!isTableNotExistError(error)) {
        console.log('Timeline post skipped:', error.message ?? 'Unknown error');
      }
      return { success: false, error: error.message };
    }

    console.log('Created lightweight timeline post:', data);
    return { success: true, postId: (data as { id: string }).id };
  } catch {
    // Silently fail - timeline posts are optional
    return { success: false, error: 'Failed to create post' };
  }
}

/**
 * Load timeline posts with bill data via SQL JOIN
 * This is the efficient way - bill data comes from bill_cache
 */
export async function loadTimelinePosts(
  limit = 20,
  offset = 0
): Promise<TimelinePostWithBillData[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    // Use Supabase's automatic join syntax
    // This performs: SELECT * FROM timeline_posts
    //                JOIN bill_cache ON timeline_posts.bill_cache_id = bill_cache.id
    //                JOIN profiles ON timeline_posts.user_id = profiles.id
    const { data, error } = await supabase
      .from('timeline_posts')
      .select(`
        id,
        user_id,
        opinion,
        likes_count,
        shares_count,
        created_at,
        bill_cache (
          id,
          bill_id,
          title,
          short_title,
          status,
          category,
          date,
          source_url,
          raw_text,
          metadata
        ),
        profiles (
          id,
          username,
          display_name,
          avatar
        )
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Silently handle errors (table might not exist yet)
    if (error || !data) {
      return [];
    }

    // Transform the joined data into our app format
    const posts = (data as unknown as TimelinePostWithBill[]).map((row): TimelinePostWithBillData => {
      const billCache = row.bill_cache as unknown as {
        id: string;
        bill_id: string;
        title: string;
        short_title: string;
        status: string;
        category: string;
        date: string;
        source_url: string;
        raw_text: string;
        metadata: Record<string, unknown>;
      } | null;

      const profile = row.profiles as unknown as {
        id: string;
        username: string;
        display_name: string;
        avatar: string | null;
      } | null;

      return {
        id: row.id,
        userId: row.user_id,
        opinion: row.opinion,
        likesCount: row.likes_count,
        sharesCount: row.shares_count,
        createdAt: row.created_at,
        bill: billCache ? {
          id: billCache.bill_id,
          title: billCache.title,
          shortTitle: billCache.short_title,
          status: billCache.status,
          category: billCache.category,
          date: billCache.date,
          sourceUrl: billCache.source_url,
          rawText: billCache.raw_text,
          metadata: billCache.metadata,
        } : null,
        author: profile ? {
          id: profile.id,
          username: profile.username,
          displayName: profile.display_name,
          avatar: profile.avatar,
        } : null,
      };
    });

    if (posts.length > 0) {
      console.log(`Loaded ${posts.length} timeline posts with bill data via JOIN`);
    }
    return posts;
  } catch {
    // Silently fail - timeline posts are optional
    return [];
  }
}

/**
 * Like a timeline post
 */
export async function likeTimelinePost(
  postId: string
): Promise<{ success: boolean }> {
  if (!isSupabaseConfigured()) {
    return { success: false };
  }

  try {
    // Get current count and increment
    const { data: currentPost } = await supabase
      .from('timeline_posts')
      .select('likes_count')
      .eq('id', postId)
      .single();

    if (currentPost) {
      const currentCount = (currentPost as { likes_count: number }).likes_count ?? 0;
      await supabase
        .from('timeline_posts')
        .update({ likes_count: currentCount + 1 } as never)
        .eq('id', postId);
    }

    return { success: true };
  } catch {
    // Silently fail
    return { success: false };
  }
}

/**
 * Share a timeline post (increment share count)
 */
export async function shareTimelinePost(
  postId: string
): Promise<{ success: boolean }> {
  if (!isSupabaseConfigured()) {
    return { success: false };
  }

  try {
    // Simple increment - in production you'd use an RPC function
    const { data: currentPost } = await supabase
      .from('timeline_posts')
      .select('shares_count')
      .eq('id', postId)
      .single();

    if (currentPost) {
      const currentCount = (currentPost as { shares_count: number }).shares_count ?? 0;
      await supabase
        .from('timeline_posts')
        .update({ shares_count: currentCount + 1 } as never)
        .eq('id', postId);
    }

    return { success: true };
  } catch {
    // Silently fail
    return { success: false };
  }
}

/**
 * Delete a timeline post
 */
export async function deleteTimelinePost(
  postId: string,
  userId: string
): Promise<{ success: boolean }> {
  if (!isSupabaseConfigured()) {
    return { success: false };
  }

  try {
    const { error } = await supabase
      .from('timeline_posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', userId);

    // Silently handle errors
    if (error) {
      return { success: false };
    }

    return { success: true };
  } catch {
    // Silently fail
    return { success: false };
  }
}

/**
 * Get bill cache ID for a bill (to use when creating posts)
 */
export async function getBillCacheId(
  billId: string
): Promise<string | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('bill_cache')
      .select('id')
      .eq('bill_id', billId)
      .single();

    // Silently handle errors (table might not exist)
    if (error || !data) return null;

    return (data as { id: string }).id;
  } catch {
    // Silently fail
    return null;
  }
}
