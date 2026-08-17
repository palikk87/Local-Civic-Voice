/**
 * In-memory LRU Cache with TTL support
 * Designed to support ~1000 concurrent users without Redis dependency
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  currentSize: number;
  maxSize: number;
}

interface CacheConfig {
  maxSize: number;
  ttlMs: number;
  name: string;
}

/**
 * LRU Cache implementation with TTL support
 * Uses Map to maintain insertion order for LRU eviction
 */
export class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly name: string;
  private stats: CacheStats;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.maxSize = config.maxSize;
    this.ttlMs = config.ttlMs;
    this.name = config.name;
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
      currentSize: 0,
      maxSize: config.maxSize,
    };

    // Start cleanup interval - run every minute to remove expired entries
    this.startCleanupInterval();
  }

  /**
   * Get a value from the cache
   * Returns undefined if not found or expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      this.stats.misses++;
      this.stats.expirations++;
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Set a value in the cache
   * Optionally override the default TTL
   */
  set(key: string, value: T, customTtlMs?: number): void {
    // If key exists, delete it first to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entries if at capacity
    while (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const ttl = customTtlMs ?? this.ttlMs;
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.stats.currentSize = this.cache.size;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    this.stats.currentSize = this.cache.size;
    return deleted;
  }

  /**
   * Delete all keys matching a pattern
   * Pattern supports simple wildcards: * matches any characters
   */
  deletePattern(pattern: string): number {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    );
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    this.stats.currentSize = this.cache.size;
    return count;
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.currentSize = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: number; name: string } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      name: this.name,
      currentSize: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
    this.stats.expirations = 0;
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get the number of entries
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict the oldest (least recently used) entry
   */
  private evictOldest(): void {
    // Map maintains insertion order, first key is oldest
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Start the background cleanup interval
   */
  private startCleanupInterval(): void {
    // Clean up every 60 seconds
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupExpired();
    }, 60000);

    // Unref to not prevent process exit
    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Remove all expired entries
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.stats.expirations++;
      }
    }
    this.stats.currentSize = this.cache.size;
  }

  /**
   * Stop the cleanup interval (for testing or shutdown)
   */
  destroy(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }
}

// =============================================================================
// Pre-configured Cache Instances
// =============================================================================

/**
 * Feed cache - stores personalized feed responses
 * TTL: 2 minutes (feeds should be relatively fresh)
 * Max: 500 entries (each user might have multiple feed types)
 */
export const feedCache = new LRUCache<unknown>({
  name: "feedCache",
  ttlMs: 2 * 60 * 1000, // 2 minutes
  maxSize: 500,
});

/**
 * User preferences cache - stores computed user preferences
 * TTL: 5 minutes (preferences don't change frequently)
 * Max: 1000 entries (one per active user)
 */
export const userPrefsCache = new LRUCache<unknown>({
  name: "userPrefsCache",
  ttlMs: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000,
});

/**
 * Creator metrics cache - stores computed creator metrics
 * TTL: 10 minutes (metrics are expensive to compute)
 * Max: 500 entries (for top creators being viewed)
 */
export const metricsCache = new LRUCache<unknown>({
  name: "metricsCache",
  ttlMs: 10 * 60 * 1000, // 10 minutes
  maxSize: 500,
});

/**
 * Trending cache - stores trending content data
 * TTL: 5 minutes (trending changes frequently but not per-request)
 * Max: 50 entries (limited number of trending queries)
 */
export const trendingCache = new LRUCache<unknown>({
  name: "trendingCache",
  ttlMs: 5 * 60 * 1000, // 5 minutes
  maxSize: 50,
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get cached value or fetch and cache it
 * This is the primary function for cache-aside pattern
 */
export async function getCachedOrFetch<T>(
  cache: LRUCache<T>,
  key: string,
  fetchFn: () => Promise<T>,
  customTtlMs?: number
): Promise<T> {
  // Try to get from cache first
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  // Cache miss - fetch the data
  const data = await fetchFn();

  // Store in cache
  cache.set(key, data, customTtlMs);

  return data;
}

/**
 * Invalidate all caches related to a specific user
 * Call this when user data changes (follows, preferences, etc.)
 */
export function invalidateUserCache(userId: string): void {
  // Clear feed cache entries for this user
  feedCache.deletePattern(`feed:${userId}:*`);
  feedCache.deletePattern(`*:user:${userId}`);

  // Clear user preferences
  userPrefsCache.delete(`prefs:${userId}`);
  userPrefsCache.deletePattern(`*:${userId}:*`);

  // Clear metrics related to this user
  metricsCache.delete(`creator:${userId}`);
  metricsCache.deletePattern(`*:${userId}:*`);
}

/**
 * Invalidate cache for a specific post
 * Call this when post is created, updated, or deleted
 */
export function invalidatePostCache(postId: string, authorId?: string): void {
  // Every cached feed, and the base query underneath them.
  //
  // getPersonalizedFeed caches two things: the assembled response for 30
  // seconds under `feed:<user>:<type>:<cursor>:<limit>`, and the raw rows it
  // was built from for two minutes under `posts:<type>:<cursor>:<limit>`.
  //
  // The patterns here used to be `feed:*:for_you` and friends, which are
  // anchored at both ends and so matched nothing at all — a real key has the
  // cursor and the limit after the feed type. And nothing cleared the row cache
  // in any case, so rebuilding the response just reassembled the same stale
  // rows. A deleted post therefore kept coming back from /api/feed for up to
  // two minutes after it was gone from the database, which from outside is
  // indistinguishable from the delete not having worked.
  //
  // A post can appear in any user's feed and in any feed type, so the whole
  // cache goes. It rebuilds on the next request.
  feedCache.deletePattern(`feed:*`);
  feedCache.deletePattern(`posts:*`);

  // Clear trending cache
  trendingCache.clear();

  // If author is known, invalidate their metrics
  if (authorId) {
    metricsCache.delete(`creator:${authorId}`);
  }
}

/**
 * Get aggregated cache statistics for monitoring
 */
export function getCacheStats(): {
  caches: Array<ReturnType<LRUCache<unknown>["getStats"]>>;
  totals: {
    totalHits: number;
    totalMisses: number;
    totalEvictions: number;
    totalExpirations: number;
    totalEntries: number;
    overallHitRate: number;
  };
} {
  const caches = [
    feedCache.getStats(),
    userPrefsCache.getStats(),
    metricsCache.getStats(),
    trendingCache.getStats(),
  ];

  const totals = caches.reduce(
    (acc, cache) => ({
      totalHits: acc.totalHits + cache.hits,
      totalMisses: acc.totalMisses + cache.misses,
      totalEvictions: acc.totalEvictions + cache.evictions,
      totalExpirations: acc.totalExpirations + cache.expirations,
      totalEntries: acc.totalEntries + cache.currentSize,
    }),
    {
      totalHits: 0,
      totalMisses: 0,
      totalEvictions: 0,
      totalExpirations: 0,
      totalEntries: 0,
    }
  );

  const totalRequests = totals.totalHits + totals.totalMisses;
  const overallHitRate = totalRequests > 0 ? totals.totalHits / totalRequests : 0;

  return {
    caches,
    totals: {
      ...totals,
      overallHitRate,
    },
  };
}

/**
 * Clear all caches (useful for testing or emergency reset)
 */
export function clearAllCaches(): void {
  feedCache.clear();
  userPrefsCache.clear();
  metricsCache.clear();
  trendingCache.clear();
}

/**
 * Generate a cache key from components
 * Ensures consistent key formatting
 */
export function cacheKey(...parts: (string | number | undefined | null)[]): string {
  return parts
    .filter((p) => p !== undefined && p !== null)
    .map((p) => String(p))
    .join(":");
}

// =============================================================================
// Type Exports for Type Safety
// =============================================================================

export type { CacheEntry, CacheStats, CacheConfig };
