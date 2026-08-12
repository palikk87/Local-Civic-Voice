import type { Context, Next, MiddlewareHandler } from "hono";
import type { auth } from "../auth";

/**
 * Rate Limiter Configuration
 */
export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom key generator (defaults to IP/user ID) */
  keyGenerator?: (c: Context) => string;
  /** Custom message for rate limit exceeded response */
  message?: string;
  /** Skip rate limiting for certain requests */
  skip?: (c: Context) => boolean;
}

/**
 * Sliding window entry for tracking requests
 */
interface SlidingWindowEntry {
  /** Timestamps of requests within the current window */
  timestamps: number[];
  /** Last cleanup time to avoid excessive array operations */
  lastCleanup: number;
}

/**
 * In-memory sliding window rate limiter
 * Uses a sliding window algorithm for accurate rate limiting
 */
class SlidingWindowRateLimiter {
  private store: Map<string, SlidingWindowEntry> = new Map();
  private readonly cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cleanupIntervalMs: number = 60000) {
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.startCleanupTimer();
  }

  /**
   * Start automatic cleanup of stale entries
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleEntries();
    }, this.cleanupIntervalMs);
  }

  /**
   * Stop the cleanup timer (useful for graceful shutdown)
   */
  public stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Remove entries that haven't been accessed recently
   */
  private cleanupStaleEntries(): void {
    const now = Date.now();
    const staleThreshold = now - this.cleanupIntervalMs * 2;

    for (const [key, entry] of this.store.entries()) {
      if (entry.lastCleanup < staleThreshold && entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Check if a request should be allowed and track it
   * Returns the number of remaining requests, or -1 if rate limited
   */
  public checkAndTrack(
    key: string,
    maxRequests: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetTime: number } {
    const now = Date.now();
    const windowStart = now - windowMs;

    let entry = this.store.get(key);

    if (!entry) {
      entry = { timestamps: [], lastCleanup: now };
      this.store.set(key, entry);
    }

    // Clean up old timestamps (sliding window)
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
    entry.lastCleanup = now;

    const currentCount = entry.timestamps.length;
    const remaining = Math.max(0, maxRequests - currentCount - 1);

    // Calculate reset time (when the oldest request in window expires)
    const oldestTimestamp = entry.timestamps[0];
    const resetTime =
      oldestTimestamp !== undefined
        ? oldestTimestamp + windowMs
        : now + windowMs;

    if (currentCount >= maxRequests) {
      return { allowed: false, remaining: 0, resetTime };
    }

    // Track this request
    entry.timestamps.push(now);

    return { allowed: true, remaining, resetTime };
  }

  /**
   * Get current stats for a key (useful for debugging/monitoring)
   */
  public getStats(key: string, windowMs: number): { count: number; remaining: number } | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    const windowStart = now - windowMs;
    const activeTimestamps = entry.timestamps.filter((ts) => ts > windowStart);

    return {
      count: activeTimestamps.length,
      remaining: 0, // Would need maxRequests to calculate
    };
  }

  /**
   * Clear all entries (useful for testing)
   */
  public clear(): void {
    this.store.clear();
  }

  /**
   * Get the number of tracked keys (useful for monitoring)
   */
  public get size(): number {
    return this.store.size;
  }
}

// Singleton rate limiter instance
const rateLimiter = new SlidingWindowRateLimiter(60000);

// Type for context with auth variables
type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

/**
 * Get client identifier for rate limiting
 * Uses user ID if authenticated, otherwise falls back to IP address
 */
export function getClientIdentifier(c: Context<{ Variables: AuthVariables }>): string {
  // Try to get authenticated user ID first
  try {
    const user = c.get("user");
    if (user?.id) {
      return `user:${user.id}`;
    }
  } catch {
    // User variable not set, fall back to IP
  }

  // Fall back to IP address
  // Check common proxy headers for real client IP
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    const clientIp = forwardedFor.split(",")[0]?.trim() ?? forwardedFor.trim();
    return `ip:${clientIp}`;
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return `ip:${realIp}`;
  }

  // Fallback to CF-Connecting-IP for Cloudflare
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) {
    return `ip:${cfIp}`;
  }

  // Last resort: use a generic key (not ideal but prevents errors)
  return "ip:unknown";
}

/**
 * Create a rate limiting middleware for Hono
 */
export function createRateLimiter(config: RateLimitConfig): MiddlewareHandler {
  const {
    maxRequests,
    windowMs,
    keyGenerator,
    message = "Too many requests, please try again later.",
    skip,
  } = config;

  return async (c: Context, next: Next) => {
    // Check if we should skip rate limiting for this request
    if (skip && skip(c)) {
      await next();
      return;
    }

    // Generate the key for this client
    const key = keyGenerator
      ? keyGenerator(c)
      : getClientIdentifier(c as Context<{ Variables: AuthVariables }>);

    // Check rate limit
    const result = rateLimiter.checkAndTrack(key, maxRequests, windowMs);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetTime / 1000)));

    if (!result.allowed) {
      // Calculate retry-after in seconds
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      c.header("Retry-After", String(retryAfter));

      return c.json(
        {
          error: "Too Many Requests",
          message,
          retryAfter,
        },
        429
      );
    }

    await next();
  };
}

/**
 * Pre-configured rate limiters for different endpoint types
 */

/**
 * General API rate limit: 100 requests per minute
 * Suitable for most API endpoints
 */
export const generalRateLimit = createRateLimiter({
  maxRequests: 100,
  windowMs: 60 * 1000, // 1 minute
  message: "Too many requests. Please slow down.",
});

/**
 * Feed rate limit: 30 requests per minute
 * More restrictive for expensive feed operations
 */
export const feedRateLimit = createRateLimiter({
  maxRequests: 30,
  windowMs: 60 * 1000, // 1 minute
  message: "Feed requests are limited. Please wait before refreshing.",
});

/**
 * Interaction rate limit: 60 requests per minute
 * For likes, comments, shares, etc.
 */
export const interactionRateLimit = createRateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000, // 1 minute
  message: "Too many interactions. Please slow down.",
});

/**
 * Auth rate limit: 10 requests per minute
 * Very restrictive for authentication endpoints to prevent brute force
 */
export const authRateLimit = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 1000, // 1 minute
  message: "Too many authentication attempts. Please try again later.",
});

/**
 * Strict auth rate limit: 5 requests per 5 minutes
 * For sensitive operations like password reset
 */
export const strictAuthRateLimit = createRateLimiter({
  maxRequests: 5,
  windowMs: 5 * 60 * 1000, // 5 minutes
  message: "Too many attempts. Please wait 5 minutes before trying again.",
});

/**
 * Upload rate limit: 20 requests per minute
 * For file upload endpoints
 */
export const uploadRateLimit = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 1000, // 1 minute
  message: "Too many upload requests. Please wait before uploading more files.",
});

/**
 * Search rate limit: 40 requests per minute
 * For search endpoints which can be resource-intensive
 */
export const searchRateLimit = createRateLimiter({
  maxRequests: 40,
  windowMs: 60 * 1000, // 1 minute
  message: "Too many search requests. Please slow down.",
});

// Export the rate limiter instance for advanced usage
export { rateLimiter, SlidingWindowRateLimiter };

// Export types for external use
export type { SlidingWindowEntry };
