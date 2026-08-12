import { prisma } from "../prisma";
import { feedCache, userPrefsCache, metricsCache, getCachedOrFetch, cacheKey } from "./cache";
import { enqueueMetricsUpdate, enqueueCreatorUpdate, enqueueBatchInteractions } from "./job-queue";

// Algorithm configuration constants
const ALGORITHM_CONFIG = {
  // Engagement weights
  LIKE_WEIGHT: 1.0,
  COMMENT_WEIGHT: 3.0,
  SHARE_WEIGHT: 5.0,
  SAVE_WEIGHT: 4.0,
  MENTION_WEIGHT: 2.0,

  // Time decay - AGGRESSIVE to prevent stale content
  RECENCY_HALF_LIFE_HOURS: 12, // Reduced from 24 - content decays faster
  VIRAL_DETECTION_WINDOW_HOURS: 1,
  VIRAL_THRESHOLD_MULTIPLIER: 5,

  // Personalization weights
  FOLLOWING_BOOST: 50,
  CATEGORY_MATCH_BOOST: 30,
  SIMILAR_USER_BOOST: 20,
  AUTHOR_AFFINITY_BOOST: 40,

  // Diversity controls - STRONGER to prevent repetition
  SAME_AUTHOR_PENALTY: 0.2, // Reduced from 0.3 - stronger penalty
  SAME_CATEGORY_PENALTY: 0.4, // Reduced from 0.5 - stronger penalty
  MAX_POSTS_PER_AUTHOR: 2,
  ENGAGEMENT_SATURATION_THRESHOLD: 500, // Posts with >500 engagement get diminishing returns
  ENGAGEMENT_SATURATION_FACTOR: 0.5, // 50% penalty for saturated posts

  // Creator influence
  HIGH_FOLLOWER_THRESHOLD: 100,
  VERIFIED_BOOST: 20,
  ENGAGEMENT_RATE_WEIGHT: 25,

  // Cold start & Fresh content promotion
  NEW_USER_DISCOVERY_BOOST: 15,
  NEW_POST_BOOST_HOURS: 6, // Extended from 3 - longer fresh content window
  NEW_POST_MAX_BOOST: 40, // Maximum boost for brand new content

  // Restorative feed settings - CRITICAL for healthy content flow
  FRESH_CONTENT_RATIO: 0.3, // 30% of feed should be fresh/rising content
  RISING_CONTENT_WINDOW_HOURS: 24, // Content is "rising" if < 24 hours old
  RISING_ENGAGEMENT_THRESHOLD: 0.5, // Engagement rate to qualify as "rising"
  SEEN_CONTENT_PENALTY: 0.1, // 90% penalty for content user has already seen
  MAX_TIMES_SHOWN: 3, // After 3 impressions, heavily penalize
  RANDOM_DISCOVERY_CHANCE: 0.15, // 15% chance to inject random discovery content
};

interface FeedItem {
  id: string;
  content: string;
  authorId: string;
  author: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    followerCount: number;
    isFollowed: boolean;
  };
  bill: {
    id: string;
    title: string;
    category: string;
  } | null;
  // Attached government document (bill / executive order / SCOTUS case)
  governmentReferenceId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceTitle: string | null;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
  };
  createdAt: Date;
  score: number;
  feedReason: string;
  isLiked: boolean;
  isSaved: boolean;
}

interface UserPreferences {
  preferredCategories: Record<string, number>;
  preferredAuthors: Record<string, number>;
  followingIds: string[];
  interactionHistory: {
    likedPostIds: string[];
    commentedPostIds: string[];
    viewedPostIds: string[];
  };
}

export async function getUserPreferences(userId: string): Promise<UserPreferences> {
  return getCachedOrFetch(
    userPrefsCache as import("./cache").LRUCache<UserPreferences>,
    cacheKey("user", "prefs", userId),
    async () => {
      // Batch all independent queries with Promise.all for better performance
      const [following, likes, comments, interactions, votes] = await Promise.all([
        // Get user's following list
        prisma.follow.findMany({
          where: { followerId: userId },
          select: { followingId: true },
        }),
        // Get user's liked posts
        prisma.postLike.findMany({
          where: { userId },
          select: { postId: true },
          take: 100,
          orderBy: { createdAt: "desc" },
        }),
        // Get user's comments
        prisma.comment.findMany({
          where: { authorId: userId },
          select: { postId: true },
          take: 100,
          orderBy: { createdAt: "desc" },
        }),
        // Get user's recent interactions
        prisma.userInteraction.findMany({
          where: { userId },
          take: 500,
          orderBy: { createdAt: "desc" },
        }),
        // Calculate category preferences from votes
        prisma.vote.findMany({
          where: { userId },
          include: { bill: { select: { category: true } } },
        }),
      ]);

      const followingIds = following.map((f) => f.followingId);
      const likedPostIds = likes.map((l) => l.postId);

      const preferredCategories: Record<string, number> = {};
      votes.forEach((vote) => {
        const category = vote.bill.category;
        preferredCategories[category] = (preferredCategories[category] || 0) + 1;
      });

      // Calculate author preferences from likes and comments
      const preferredAuthors: Record<string, number> = {};

      if (likedPostIds.length > 0) {
        const likedPosts = await prisma.post.findMany({
          where: { id: { in: likedPostIds } },
          select: { authorId: true },
        });
        likedPosts.forEach((post) => {
          preferredAuthors[post.authorId] = (preferredAuthors[post.authorId] || 0) + 2;
        });
      }

      // Get viewed posts from interactions
      const viewedPostIds = interactions
        .filter((i) => i.interactionType === "view" && i.postId)
        .map((i) => i.postId as string);

      return {
        preferredCategories,
        preferredAuthors,
        followingIds,
        interactionHistory: {
          likedPostIds,
          commentedPostIds: comments.map((c) => c.postId),
          viewedPostIds,
        },
      };
    }
  );
}

export async function calculatePostScore(
  post: any,
  userPrefs: UserPreferences,
  seenAuthors: Set<string>,
  seenCategories: Set<string>,
  userViewHistory?: Map<string, number> // postId -> times shown
): Promise<{ score: number; reason: string; isRising: boolean; isFresh: boolean }> {
  let score = 0;
  let reason = "Recommended";
  let isRising = false;
  let isFresh = false;

  const now = new Date();
  const postAge = (now.getTime() - new Date(post.createdAt).getTime()) / (1000 * 60 * 60);

  // 1. Engagement Score with SATURATION CAP
  const likes = post._count?.likes || 0;
  const comments = post._count?.comments || 0;
  const shares = post.metrics?.shareCount || 0;
  const saves = post.metrics?.saveCount || 0;

  let engagementScore =
    likes * ALGORITHM_CONFIG.LIKE_WEIGHT +
    comments * ALGORITHM_CONFIG.COMMENT_WEIGHT +
    shares * ALGORITHM_CONFIG.SHARE_WEIGHT +
    saves * ALGORITHM_CONFIG.SAVE_WEIGHT;

  // RESTORATIVE: Apply diminishing returns for highly engaged content
  // This prevents viral posts from dominating forever
  if (engagementScore > ALGORITHM_CONFIG.ENGAGEMENT_SATURATION_THRESHOLD) {
    const excessEngagement = engagementScore - ALGORITHM_CONFIG.ENGAGEMENT_SATURATION_THRESHOLD;
    engagementScore = ALGORITHM_CONFIG.ENGAGEMENT_SATURATION_THRESHOLD +
      (excessEngagement * ALGORITHM_CONFIG.ENGAGEMENT_SATURATION_FACTOR);
  }

  score += engagementScore;

  // 2. Recency Score (AGGRESSIVE exponential decay)
  const recencyMultiplier = Math.pow(0.5, postAge / ALGORITHM_CONFIG.RECENCY_HALF_LIFE_HOURS);
  score *= recencyMultiplier;

  // 3. FRESH CONTENT BOOST - Strong boost for new posts
  if (postAge < ALGORITHM_CONFIG.NEW_POST_BOOST_HOURS) {
    const freshnessFactor = 1 - (postAge / ALGORITHM_CONFIG.NEW_POST_BOOST_HOURS);
    score += ALGORITHM_CONFIG.NEW_POST_MAX_BOOST * freshnessFactor;
    reason = "Fresh content";
    isFresh = true;
  }

  // 4. RISING CONTENT DETECTION - Identify content gaining momentum
  if (postAge < ALGORITHM_CONFIG.RISING_CONTENT_WINDOW_HOURS && postAge > 0) {
    const views = post.metrics?.viewCount || 1;
    const engagementRate = engagementScore / views;

    if (engagementRate >= ALGORITHM_CONFIG.RISING_ENGAGEMENT_THRESHOLD) {
      score *= 1.5; // 50% boost for rising content
      reason = "Rising";
      isRising = true;
    }
  }

  // 5. Viral Detection (within first hour)
  if (postAge <= ALGORITHM_CONFIG.VIRAL_DETECTION_WINDOW_HOURS && postAge > 0) {
    const engagementVelocity = engagementScore / Math.max(postAge, 0.1);
    if (engagementVelocity > ALGORITHM_CONFIG.VIRAL_THRESHOLD_MULTIPLIER) {
      score *= 2;
      reason = "Trending now";
      isRising = true;
    }
  }

  // 6. SEEN CONTENT PENALTY - Prevent showing same posts repeatedly
  if (userViewHistory) {
    const timesShown = userViewHistory.get(post.id) || 0;
    if (timesShown > 0) {
      if (timesShown >= ALGORITHM_CONFIG.MAX_TIMES_SHOWN) {
        score *= ALGORITHM_CONFIG.SEEN_CONTENT_PENALTY; // 90% penalty
        reason = "Previously seen";
      } else {
        // Gradual penalty based on times shown
        score *= Math.pow(0.7, timesShown); // 30% reduction per view
      }
    }
  }

  // 7. Following Boost
  if (userPrefs.followingIds.includes(post.authorId)) {
    score += ALGORITHM_CONFIG.FOLLOWING_BOOST;
    if (reason === "Recommended") {
      reason = "From someone you follow";
    }
  }

  // 8. Category Match
  if (post.bill?.category && userPrefs.preferredCategories[post.bill.category]) {
    const categoryWeight = Math.min(userPrefs.preferredCategories[post.bill.category] ?? 0, 10);
    score += ALGORITHM_CONFIG.CATEGORY_MATCH_BOOST * (categoryWeight / 10);
    if (reason === "Recommended") {
      reason = `Based on your interest in ${post.bill.category}`;
    }
  }

  // 9. Author Affinity
  if (userPrefs.preferredAuthors[post.authorId]) {
    const affinityWeight = Math.min(userPrefs.preferredAuthors[post.authorId] ?? 0, 10);
    score += ALGORITHM_CONFIG.AUTHOR_AFFINITY_BOOST * (affinityWeight / 10);
    if (reason === "Recommended") {
      reason = "From an author you engage with";
    }
  }

  // 10. Creator Influence Score (with cap to prevent domination)
  if (post.author?.creatorMetrics) {
    const metrics = post.author.creatorMetrics;
    if (metrics.totalFollowers >= ALGORITHM_CONFIG.HIGH_FOLLOWER_THRESHOLD) {
      // Cap the influence boost to prevent top creators from dominating
      const influenceBoost = Math.min(10 * Math.log10(metrics.totalFollowers), 30);
      score += influenceBoost;
      if (reason === "Recommended") {
        reason = "Popular creator";
      }
    }
    score += metrics.avgEngagementRate * ALGORITHM_CONFIG.ENGAGEMENT_RATE_WEIGHT;
  }

  // 11. Diversity Penalties
  if (seenAuthors.has(post.authorId)) {
    score *= ALGORITHM_CONFIG.SAME_AUTHOR_PENALTY;
  }
  if (post.bill?.category && seenCategories.has(post.bill.category)) {
    score *= ALGORITHM_CONFIG.SAME_CATEGORY_PENALTY;
  }

  return { score: Math.max(score, 0), reason, isRising, isFresh };
}

export async function getPersonalizedFeed(
  userId: string | null,
  feedType: "for_you" | "following" | "trending" | "discover" = "for_you",
  limit: number = 20,
  cursor?: string,
  excludePostIds: string[] = []
): Promise<{ posts: FeedItem[]; nextCursor: string | null; hasMore: boolean }> {
  // Check for cached final feed response (30 second TTL)
  const feedCacheKey = cacheKey("feed", userId || "anonymous", feedType, cursor || "initial", limit.toString());
  const cachedFeed = feedCache.get(feedCacheKey) as { posts: FeedItem[]; nextCursor: string | null; hasMore: boolean } | undefined;
  if (cachedFeed && excludePostIds.length === 0) {
    return cachedFeed;
  }

  let userPrefs: UserPreferences | null = null;
  let userViewHistory: Map<string, number> = new Map();

  if (userId) {
    userPrefs = await getUserPreferences(userId);

    // Get user's view history for restorative algorithm
    const viewInteractions = await prisma.userInteraction.findMany({
      where: {
        userId,
        interactionType: "view",
        postId: { not: null },
      },
      select: { postId: true },
    });

    // Count how many times each post was shown
    viewInteractions.forEach((v) => {
      if (v.postId) {
        userViewHistory.set(v.postId, (userViewHistory.get(v.postId) || 0) + 1);
      }
    });
  }

  // Base query for posts
  const whereClause: any = {
    id: { notIn: excludePostIds },
  };

  // Feed type specific filters
  if (feedType === "following" && userPrefs) {
    whereClause.authorId = { in: userPrefs.followingIds };
  }

  // Reduced fetch limit from 150 to 60 for better performance while maintaining diversity
  const fetchLimit = Math.min(limit * 3, 60);

  // Cache key for base post query (2 min TTL)
  const postQueryCacheKey = cacheKey("posts", feedType, cursor || "initial", fetchLimit.toString());

  // Try to get cached posts or fetch from DB
  let posts = feedCache.get(postQueryCacheKey) as typeof rawPosts | undefined;

  const rawPosts = await prisma.post.findMany({
    where: whereClause,
    take: fetchLimit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: feedType === "trending" ? { createdAt: "desc" } : { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          _count: {
            select: {
              followers: true,
            },
          },
        },
      },
      bill: {
        select: {
          id: true,
          title: true,
          category: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
        },
      },
    },
  });

  if (!posts) {
    posts = rawPosts;
    // Cache the base post query for 2 minutes
    feedCache.set(postQueryCacheKey, posts, 2 * 60 * 1000);
  }

  // Batch load all post metrics in ONE query
  const postIds = posts.map((p) => p.id);
  const postMetrics = await prisma.postMetrics.findMany({
    where: { postId: { in: postIds } },
  });
  const metricsMap = new Map(postMetrics.map((m) => [m.postId, m]));

  // Batch load user's likes and saves if authenticated (ONE query each)
  let userLikes: Set<string> = new Set();
  let userSaves: Set<string> = new Set();
  let userFollowing: Set<string> = new Set();

  if (userId) {
    // Batch load likes and saves in parallel
    const [likes, saves] = await Promise.all([
      prisma.postLike.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true },
      }),
      prisma.postSave.findMany({
        where: { userId, postId: { in: postIds } },
        select: { postId: true },
      }),
    ]);

    userLikes = new Set(likes.map((l) => l.postId));
    userSaves = new Set(saves.map((s) => s.postId));
    userFollowing = new Set(userPrefs?.followingIds || []);
  }

  // Score and rank posts into categories
  const seenAuthors = new Set<string>();
  const seenCategories = new Set<string>();
  const authorPostCounts = new Map<string, number>();

  interface ScoredPost extends FeedItem {
    isRising: boolean;
    isFresh: boolean;
  }

  const allScoredPosts: ScoredPost[] = [];
  const freshPosts: ScoredPost[] = [];
  const risingPosts: ScoredPost[] = [];
  const regularPosts: ScoredPost[] = [];

  for (const post of posts) {
    // Skip if author has too many posts already
    const authorCount = authorPostCounts.get(post.authorId) || 0;
    if (authorCount >= ALGORITHM_CONFIG.MAX_POSTS_PER_AUTHOR) {
      continue;
    }

    const metrics = metricsMap.get(post.id);
    const { score, reason, isRising, isFresh } = await calculatePostScore(
      { ...post, metrics },
      userPrefs || {
        preferredCategories: {},
        preferredAuthors: {},
        followingIds: [],
        interactionHistory: { likedPostIds: [], commentedPostIds: [], viewedPostIds: [] },
      },
      seenAuthors,
      seenCategories,
      userViewHistory
    );

    const scoredPost: ScoredPost = {
      id: post.id,
      content: post.content,
      authorId: post.authorId,
      author: {
        id: post.author.id,
        name: post.author.name,
        email: post.author.email,
        image: post.author.image,
        followerCount: post.author._count.followers,
        isFollowed: userFollowing.has(post.author.id),
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      referenceTitle: post.referenceTitle,
      metrics: {
        likes: post._count.likes,
        comments: post._count.comments,
        shares: metrics?.shareCount || 0,
        saves: metrics?.saveCount || 0,
        views: metrics?.viewCount || 0,
      },
      createdAt: post.createdAt,
      score,
      feedReason: reason,
      isLiked: userLikes.has(post.id),
      isSaved: userSaves.has(post.id),
      isRising,
      isFresh,
    };

    allScoredPosts.push(scoredPost);

    // Categorize for restorative mixing
    if (isFresh) {
      freshPosts.push(scoredPost);
    } else if (isRising) {
      risingPosts.push(scoredPost);
    } else {
      regularPosts.push(scoredPost);
    }

    seenAuthors.add(post.authorId);
    if (post.bill?.category) {
      seenCategories.add(post.bill.category);
    }
    authorPostCounts.set(post.authorId, authorCount + 1);
  }

  // RESTORATIVE FEED MIXING
  // Instead of just sorting by score, we interleave fresh/rising content
  // to ensure the feed doesn't become stale with the same top posts

  // Sort each category by score
  freshPosts.sort((a: ScoredPost, b: ScoredPost) => b.score - a.score);
  risingPosts.sort((a: ScoredPost, b: ScoredPost) => b.score - a.score);
  regularPosts.sort((a: ScoredPost, b: ScoredPost) => b.score - a.score);

  let finalFeed: ScoredPost[] = [];

  if (feedType === "for_you" || feedType === "discover") {
    // Calculate slots for each category
    const freshSlots = Math.ceil(limit * ALGORITHM_CONFIG.FRESH_CONTENT_RATIO);
    const risingSlots = Math.ceil(limit * 0.2); // 20% rising content
    const regularSlots = limit - freshSlots - risingSlots;

    // Take from each category
    const selectedFresh = freshPosts.slice(0, freshSlots);
    const selectedRising = risingPosts.slice(0, risingSlots);
    const selectedRegular = regularPosts.slice(0, regularSlots);

    // Interleave the content for variety
    // Pattern: Regular, Fresh, Regular, Rising, Regular, Fresh...
    let freshIdx = 0, risingIdx = 0, regularIdx = 0;

    for (let i = 0; i < limit && finalFeed.length < limit; i++) {
      // Every 3rd slot: fresh content
      if (i % 3 === 1 && freshIdx < selectedFresh.length) {
        const post = selectedFresh[freshIdx];
        if (post) finalFeed.push(post);
        freshIdx++;
      }
      // Every 5th slot: rising content
      else if (i % 5 === 3 && risingIdx < selectedRising.length) {
        const post = selectedRising[risingIdx];
        if (post) finalFeed.push(post);
        risingIdx++;
      }
      // Default: regular content
      else if (regularIdx < selectedRegular.length) {
        const post = selectedRegular[regularIdx];
        if (post) finalFeed.push(post);
        regularIdx++;
      }
      // Fallback to any available content
      else if (freshIdx < selectedFresh.length) {
        const post = selectedFresh[freshIdx];
        if (post) finalFeed.push(post);
        freshIdx++;
      } else if (risingIdx < selectedRising.length) {
        const post = selectedRising[risingIdx];
        if (post) finalFeed.push(post);
        risingIdx++;
      }
    }

    // Random discovery injection (15% chance per remaining slot)
    // This surfaces completely random content to break filter bubbles
    if (finalFeed.length < limit) {
      const unusedPosts = allScoredPosts.filter(
        (p) => !finalFeed.some((f) => f.id === p.id)
      );

      for (const post of unusedPosts) {
        if (finalFeed.length >= limit) break;
        if (Math.random() < ALGORITHM_CONFIG.RANDOM_DISCOVERY_CHANCE) {
          post.feedReason = "Discover something new";
          finalFeed.push(post);
        }
      }
    }

    // Fill remaining slots with highest scored unused posts
    if (finalFeed.length < limit) {
      const usedIds = new Set(finalFeed.map((p) => p.id));
      const remaining = allScoredPosts
        .filter((p) => !usedIds.has(p.id))
        .sort((a: ScoredPost, b: ScoredPost) => b.score - a.score);

      for (const post of remaining) {
        if (finalFeed.length >= limit) break;
        finalFeed.push(post);
      }
    }
  } else if (feedType === "trending") {
    // Sort by pure engagement for trending
    allScoredPosts.sort((a: ScoredPost, b: ScoredPost) => {
      const aEngagement = a.metrics.likes + a.metrics.comments * 2 + a.metrics.shares * 3;
      const bEngagement = b.metrics.likes + b.metrics.comments * 2 + b.metrics.shares * 3;
      return bEngagement - aEngagement;
    });
    finalFeed = allScoredPosts.slice(0, limit);
  } else if (feedType === "following") {
    // Chronological for following feed, but still with score boost
    allScoredPosts.sort((a: ScoredPost, b: ScoredPost) => {
      // Primary: recency, Secondary: score
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (Math.abs(timeDiff) < 1000 * 60 * 60) {
        // Within 1 hour, sort by score
        return b.score - a.score;
      }
      return timeDiff;
    });
    finalFeed = allScoredPosts.slice(0, limit);
  } else {
    // Default: score-based
    allScoredPosts.sort((a: ScoredPost, b: ScoredPost) => b.score - a.score);
    finalFeed = allScoredPosts.slice(0, limit);
  }

  // Strip internal properties before returning
  const resultPosts: FeedItem[] = finalFeed.map((post) => {
    const { isRising, isFresh, ...rest } = post;
    return rest;
  });

  const hasMore = allScoredPosts.length > limit;
  const lastPost = resultPosts[resultPosts.length - 1];
  const nextCursor = lastPost ? lastPost.id : null;

  const result = { posts: resultPosts, nextCursor, hasMore };

  // Cache the final feed response for 30 seconds
  if (excludePostIds.length === 0) {
    feedCache.set(feedCacheKey, result, 30 * 1000);
  }

  return result;
}

export async function trackInteraction(
  userId: string,
  interactionType: string,
  postId?: string,
  targetUserId?: string,
  dwellTimeMs?: number,
  metadata?: Record<string, any>
): Promise<void> {
  // Only the UserInteraction.create is synchronous - this is the critical user-facing operation
  await prisma.userInteraction.create({
    data: {
      userId,
      postId,
      targetUserId,
      interactionType,
      dwellTimeMs,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });

  // Enqueue post metrics update asynchronously via job queue
  if (postId) {
    enqueueMetricsUpdate(postId, interactionType, dwellTimeMs);
  }

  // Enqueue creator metrics update asynchronously via job queue
  if (interactionType === "like" || interactionType === "follow") {
    // Get the authorId if not provided
    const authorId = targetUserId || (postId ? (await prisma.post.findUnique({ where: { id: postId }, select: { authorId: true } }))?.authorId : null);
    if (authorId) {
      enqueueCreatorUpdate(authorId);
    }
  }
}

async function updatePostMetrics(
  postId: string,
  interactionType: string,
  dwellTimeMs?: number
): Promise<void> {
  const updateData: any = {};

  switch (interactionType) {
    case "view":
      updateData.viewCount = { increment: 1 };
      if (dwellTimeMs) {
        // Update average dwell time
        const current = await prisma.postMetrics.findUnique({ where: { postId } });
        if (current) {
          const newAvg = Math.round(
            (current.avgDwellTimeMs * current.viewCount + dwellTimeMs) / (current.viewCount + 1)
          );
          updateData.avgDwellTimeMs = newAvg;
        } else {
          updateData.avgDwellTimeMs = dwellTimeMs;
        }
      }
      break;
    case "like":
      updateData.likeCount = { increment: 1 };
      break;
    case "comment":
      updateData.commentCount = { increment: 1 };
      break;
    case "share":
      updateData.shareCount = { increment: 1 };
      break;
    case "save":
      updateData.saveCount = { increment: 1 };
      break;
  }

  updateData.lastEngagementAt = new Date();

  await prisma.postMetrics.upsert({
    where: { postId },
    create: {
      postId,
      viewCount: interactionType === "view" ? 1 : 0,
      likeCount: interactionType === "like" ? 1 : 0,
      commentCount: interactionType === "comment" ? 1 : 0,
      shareCount: interactionType === "share" ? 1 : 0,
      saveCount: interactionType === "save" ? 1 : 0,
      avgDwellTimeMs: dwellTimeMs || 0,
      lastEngagementAt: new Date(),
    },
    update: updateData,
  });

  // Calculate virality score
  await calculateViralityScore(postId);
}

async function calculateViralityScore(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { createdAt: true },
  });

  if (!post) return;

  const metrics = await prisma.postMetrics.findUnique({ where: { postId } });
  if (!metrics) return;

  const ageHours = (Date.now() - post.createdAt.getTime()) / (1000 * 60 * 60);
  const totalEngagement = metrics.likeCount + metrics.commentCount * 2 + metrics.shareCount * 3;

  // Virality = engagement velocity (engagement per hour)
  const viralityScore = ageHours > 0 ? totalEngagement / ageHours : totalEngagement;

  // Quality score based on engagement depth
  const qualityScore =
    metrics.viewCount > 0
      ? ((metrics.likeCount + metrics.commentCount + metrics.saveCount) / metrics.viewCount) * 100
      : 0;

  await prisma.postMetrics.update({
    where: { postId },
    data: {
      viralityScore,
      qualityScore,
      engagementRate: metrics.viewCount > 0 ? totalEngagement / metrics.viewCount : 0,
    },
  });
}

export async function updateCreatorMetrics(userId: string): Promise<void> {
  // Get all user's posts with engagement AND bill categories in ONE query (fixes N+1)
  const posts = await prisma.post.findMany({
    where: { authorId: userId },
    include: {
      _count: {
        select: {
          likes: true,
          comments: true,
        },
      },
      bill: {
        select: { category: true },
      },
    },
  });

  // Batch load follower count, mention count in parallel
  const [followerCount, mentionCount] = await Promise.all([
    prisma.follow.count({
      where: { followingId: userId },
    }),
    prisma.mention.count({
      where: { mentionedUserId: userId },
    }),
  ]);

  // Get share count from post metrics
  const postIds = posts.map((p) => p.id);
  const metrics = await prisma.postMetrics.findMany({
    where: { postId: { in: postIds } },
  });

  const totalShares = metrics.reduce((sum, m) => sum + m.shareCount, 0);
  const totalLikes = posts.reduce((sum, p) => sum + p._count.likes, 0);
  const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);

  // Calculate engagement rate
  const avgEngagementRate =
    followerCount > 0 ? (totalLikes + totalComments + totalShares) / followerCount / posts.length : 0;

  // Count viral posts (posts with > 10x average engagement)
  const avgEngagement = posts.length > 0 ? (totalLikes + totalComments) / posts.length : 0;
  const viralPostCount = posts.filter(
    (p) => p._count.likes + p._count.comments > avgEngagement * 10
  ).length;

  // Calculate influence score
  const influenceScore =
    Math.log10(followerCount + 1) * 20 +
    avgEngagementRate * 30 +
    viralPostCount * 10 +
    Math.log10(totalShares + 1) * 15;

  // Get top categories from user's posts - NO MORE N+1 QUERY
  // Categories are already loaded with posts above
  const categoryCounts: Record<string, number> = {};
  for (const post of posts) {
    if (post.bill?.category) {
      categoryCounts[post.bill.category] =
        (categoryCounts[post.bill.category] || 0) + 1;
    }
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cat]) => cat);

  const creatorMetricsData = {
    totalFollowers: followerCount,
    totalLikes,
    totalComments,
    totalShares,
    totalMentions: mentionCount,
    totalPosts: posts.length,
    avgEngagementRate,
    viralPostCount,
    influenceScore,
    topCategories: JSON.stringify(topCategories),
    lastCalculated: new Date(),
  };

  await prisma.creatorMetrics.upsert({
    where: { userId },
    create: {
      userId,
      ...creatorMetricsData,
    },
    update: creatorMetricsData,
  });

  // Cache the creator metrics result
  metricsCache.set(cacheKey("creator", "metrics", userId), creatorMetricsData, 10 * 60 * 1000);
}

export async function getSimilarUsers(userId: string, limit: number = 10): Promise<string[]> {
  // Cache the result for 30 minutes - this is an expensive calculation that doesn't need to be real-time
  const cacheKeyStr = cacheKey("user", "similar", userId);
  const cached = userPrefsCache.get(cacheKeyStr) as string[] | undefined;
  if (cached) {
    return cached.slice(0, limit);
  }

  // Get user's votes
  const userVotes = await prisma.vote.findMany({
    where: { userId },
    select: { billId: true, position: true },
  });

  if (userVotes.length === 0) return [];

  // Find users who voted similarly
  const voteMap = new Map(userVotes.map((v) => [v.billId, v.position]));

  const otherUsers = await prisma.vote.findMany({
    where: {
      billId: { in: Array.from(voteMap.keys()) },
      userId: { not: userId },
    },
    select: { userId: true, billId: true, position: true },
  });

  // Calculate similarity scores
  const similarityScores: Record<string, number> = {};
  for (const vote of otherUsers) {
    const userPosition = voteMap.get(vote.billId);
    if (userPosition === vote.position) {
      similarityScores[vote.userId] = (similarityScores[vote.userId] || 0) + 1;
    }
  }

  // Sort by similarity and return top users
  const result = Object.entries(similarityScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20) // Cache more than we need to handle different limit values
    .map(([uid]) => uid);

  // Cache for 30 minutes
  userPrefsCache.set(cacheKeyStr, result, 30 * 60 * 1000);

  return result.slice(0, limit);
}

export async function getTrendingHashtags(limit: number = 10): Promise<{ tag: string; count: number }[]> {
  const hashtags = await prisma.hashtag.findMany({
    orderBy: { trendingScore: "desc" },
    take: limit,
    select: { tag: true, useCount: true },
  });

  return hashtags.map((h) => ({ tag: h.tag, count: h.useCount }));
}

export async function getDiscoverFeed(
  userId: string | null,
  limit: number = 20
): Promise<FeedItem[]> {
  // Get trending posts from users the user doesn't follow
  const excludeAuthorIds = userId
    ? (await prisma.follow.findMany({
        where: { followerId: userId },
        select: { followingId: true },
      })).map((f) => f.followingId)
    : [];

  const result = await getPersonalizedFeed(
    userId,
    "discover",
    limit,
    undefined,
    []
  );

  // Filter out followed users for discovery
  return result.posts.filter((p) => !excludeAuthorIds.includes(p.authorId));
}
