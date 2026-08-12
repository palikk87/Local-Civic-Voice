/**
 * Interaction Tracker - Automatically tracks user interactions for feed personalization
 *
 * Features:
 * - Batches interactions to reduce API calls
 * - Tracks dwell time on posts
 * - Handles view tracking with visibility detection
 * - Queues interactions and flushes periodically
 */

import { trackInteractionsBatch, type InteractionType } from './api/feed';

interface QueuedInteraction {
  interactionType: InteractionType;
  postId?: string;
  targetUserId?: string;
  dwellTimeMs?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// Configuration
const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 5000; // Flush every 5 seconds
const MIN_DWELL_TIME_MS = 500; // Minimum dwell time to track (500ms)
const MAX_QUEUE_SIZE = 50;

class InteractionTracker {
  private queue: QueuedInteraction[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private dwellTimers: Map<string, { startTime: number; postId: string }> = new Map();
  private viewedPosts: Set<string> = new Set(); // Track viewed posts in session

  constructor() {
    this.startFlushInterval();
  }

  /**
   * Start the periodic flush interval
   */
  private startFlushInterval() {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Stop the flush interval (call on app close)
   */
  public stopFlushInterval() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Flush remaining items
    this.flush();
  }

  /**
   * Add an interaction to the queue
   */
  private addToQueue(interaction: Omit<QueuedInteraction, 'timestamp'>) {
    this.queue.push({
      ...interaction,
      timestamp: Date.now(),
    });

    // Auto-flush if queue is full
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush the queue to the API
   */
  public async flush() {
    if (this.queue.length === 0) return;

    const interactions = this.queue.splice(0, BATCH_SIZE);

    try {
      await trackInteractionsBatch(interactions.map(i => ({
        interactionType: i.interactionType,
        postId: i.postId,
        targetUserId: i.targetUserId,
        dwellTimeMs: i.dwellTimeMs,
        metadata: i.metadata,
      })));
    } catch (error) {
      // Re-queue failed interactions
      console.warn('Failed to track interactions, re-queuing:', error);
      this.queue.unshift(...interactions);
    }
  }

  /**
   * Track a post view (called when post becomes visible)
   */
  public trackView(postId: string) {
    // Only track first view per session
    if (this.viewedPosts.has(postId)) return;
    this.viewedPosts.add(postId);

    this.addToQueue({
      interactionType: 'view',
      postId,
    });
  }

  /**
   * Start tracking dwell time for a post (call when post enters viewport)
   */
  public startDwellTracking(postId: string) {
    if (this.dwellTimers.has(postId)) return;

    this.dwellTimers.set(postId, {
      startTime: Date.now(),
      postId,
    });
  }

  /**
   * Stop tracking dwell time and record it (call when post exits viewport)
   */
  public stopDwellTracking(postId: string) {
    const timer = this.dwellTimers.get(postId);
    if (!timer) return;

    const dwellTime = Date.now() - timer.startTime;
    this.dwellTimers.delete(postId);

    // Only track if user spent meaningful time on the post
    if (dwellTime >= MIN_DWELL_TIME_MS) {
      this.addToQueue({
        interactionType: 'dwell',
        postId,
        dwellTimeMs: dwellTime,
      });
    }
  }

  /**
   * Track a like interaction
   */
  public trackLike(postId: string) {
    this.addToQueue({
      interactionType: 'like',
      postId,
    });
  }

  /**
   * Track a comment interaction
   */
  public trackComment(postId: string) {
    this.addToQueue({
      interactionType: 'comment',
      postId,
    });
  }

  /**
   * Track a share interaction
   */
  public trackShare(postId: string, shareType: 'internal' | 'external' | 'dm' = 'internal') {
    this.addToQueue({
      interactionType: 'share',
      postId,
      metadata: { shareType },
    });
  }

  /**
   * Track a save/bookmark interaction
   */
  public trackSave(postId: string) {
    this.addToQueue({
      interactionType: 'save',
      postId,
    });
  }

  /**
   * Track a follow interaction
   */
  public trackFollow(targetUserId: string) {
    this.addToQueue({
      interactionType: 'follow',
      targetUserId,
    });
  }

  /**
   * Track a mention interaction
   */
  public trackMention(postId: string, mentionedUserId: string) {
    this.addToQueue({
      interactionType: 'mention',
      postId,
      targetUserId: mentionedUserId,
    });
  }

  /**
   * Get list of posts viewed in this session (for feed exclusion)
   */
  public getViewedPostIds(): string[] {
    return Array.from(this.viewedPosts);
  }

  /**
   * Clear session data (call on logout)
   */
  public clearSession() {
    this.viewedPosts.clear();
    this.dwellTimers.clear();
    this.queue = [];
  }
}

// Singleton instance
export const interactionTracker = new InteractionTracker();

// React hook for using the tracker
import { useEffect, useCallback, useRef } from 'react';

/**
 * Hook to track post visibility and dwell time
 */
export function usePostVisibilityTracking(postId: string) {
  const isVisible = useRef(false);

  const onVisible = useCallback(() => {
    if (!isVisible.current) {
      isVisible.current = true;
      interactionTracker.trackView(postId);
      interactionTracker.startDwellTracking(postId);
    }
  }, [postId]);

  const onHidden = useCallback(() => {
    if (isVisible.current) {
      isVisible.current = false;
      interactionTracker.stopDwellTracking(postId);
    }
  }, [postId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isVisible.current) {
        interactionTracker.stopDwellTracking(postId);
      }
    };
  }, [postId]);

  return { onVisible, onHidden };
}

/**
 * Hook to track interactions (like, comment, share, save)
 */
export function useInteractionTracking() {
  const trackLike = useCallback((postId: string) => {
    interactionTracker.trackLike(postId);
  }, []);

  const trackComment = useCallback((postId: string) => {
    interactionTracker.trackComment(postId);
  }, []);

  const trackShare = useCallback((postId: string, shareType?: 'internal' | 'external' | 'dm') => {
    interactionTracker.trackShare(postId, shareType);
  }, []);

  const trackSave = useCallback((postId: string) => {
    interactionTracker.trackSave(postId);
  }, []);

  const trackFollow = useCallback((userId: string) => {
    interactionTracker.trackFollow(userId);
  }, []);

  return {
    trackLike,
    trackComment,
    trackShare,
    trackSave,
    trackFollow,
  };
}
