/**
 * Job Processors - Implementation of background job handlers
 * These processors are registered with the job queue and execute the actual work
 */

import { prisma } from "../prisma";
import {
  jobQueue,
  JobType,
  type UpdatePostMetricsData,
  type UpdateCreatorMetricsData,
  type CalculateViralityData,
  type TrackInteractionData,
  type UpdateTrendingData,
  type SyncGovernmentDataData,
  type GenerateReferenceBriefData,
} from "./job-queue";
import { syncGovernmentData } from "./government-sync";
import { processReferenceBrief } from "./reference-content";
import { metricsCache, trendingCache, cacheKey } from "./cache";

/**
 * Process post metrics update
 * Updates view counts, engagement metrics, and calculates virality
 */
async function processUpdatePostMetrics(data: UpdatePostMetricsData): Promise<void> {
  const { postId, interactionType, dwellTimeMs } = data;

  const updateData: Record<string, unknown> = {};

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

  console.log(`[JobProcessor] Updated post metrics for post ${postId}`);
}

/**
 * Process creator metrics update
 * Recalculates engagement rates, influence scores, and top categories
 */
async function processUpdateCreatorMetrics(data: UpdateCreatorMetricsData): Promise<void> {
  const { userId } = data;

  // Get all user's posts with engagement AND bill categories in ONE query
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
    followerCount > 0 && posts.length > 0
      ? (totalLikes + totalComments + totalShares) / followerCount / posts.length
      : 0;

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

  // Get top categories from user's posts
  const categoryCounts: Record<string, number> = {};
  for (const post of posts) {
    if (post.bill?.category) {
      categoryCounts[post.bill.category] = (categoryCounts[post.bill.category] || 0) + 1;
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

  console.log(`[JobProcessor] Updated creator metrics for user ${userId}`);
}

/**
 * Process virality score calculation
 * Calculates engagement velocity and quality scores
 */
async function processCalculateVirality(data: CalculateViralityData): Promise<void> {
  const { postId } = data;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { createdAt: true },
  });

  if (!post) {
    console.warn(`[JobProcessor] Post not found for virality calculation: ${postId}`);
    return;
  }

  const metrics = await prisma.postMetrics.findUnique({ where: { postId } });
  if (!metrics) {
    console.warn(`[JobProcessor] Metrics not found for virality calculation: ${postId}`);
    return;
  }

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

  console.log(`[JobProcessor] Calculated virality for post ${postId}: ${viralityScore.toFixed(2)}`);
}

/**
 * Process interaction tracking
 * Records user interactions for personalization
 */
async function processTrackInteraction(data: TrackInteractionData): Promise<void> {
  const { userId, interactionType, postId, targetUserId, dwellTimeMs, metadata } = data;

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

  console.log(`[JobProcessor] Tracked ${interactionType} interaction for user ${userId}`);
}

/**
 * Process trending content update
 * Recalculates trending posts and hashtags
 */
async function processUpdateTrending(data: UpdateTrendingData): Promise<void> {
  const { category, limit = 20 } = data;

  // Get recent posts with high engagement velocity
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const whereClause: Record<string, unknown> = {
    createdAt: { gte: twentyFourHoursAgo },
  };

  if (category) {
    whereClause.bill = { category };
  }

  const trendingPosts = await prisma.post.findMany({
    where: whereClause,
    include: {
      _count: {
        select: {
          likes: true,
          comments: true,
        },
      },
      author: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  // Get metrics for these posts
  const postIds = trendingPosts.map((p) => p.id);
  const metricsData = await prisma.postMetrics.findMany({
    where: { postId: { in: postIds } },
  });
  const metricsMap = new Map(metricsData.map((m) => [m.postId, m]));

  // Calculate trending score for each post
  const scoredPosts = trendingPosts.map((post) => {
    const metrics = metricsMap.get(post.id);
    const ageHours = (Date.now() - post.createdAt.getTime()) / (1000 * 60 * 60);

    const engagement =
      post._count.likes +
      post._count.comments * 2 +
      (metrics?.shareCount || 0) * 3;

    // Trending score: engagement velocity with recency boost
    const velocity = ageHours > 0 ? engagement / ageHours : engagement;
    const recencyBoost = Math.max(0, 1 - ageHours / 24); // Full boost at 0h, 0 at 24h

    return {
      postId: post.id,
      score: velocity * (1 + recencyBoost),
      engagement,
      ageHours,
    };
  });

  // Sort by score and take top posts
  scoredPosts.sort((a, b) => b.score - a.score);
  const topTrending = scoredPosts.slice(0, limit);

  // Cache the trending results
  const cacheKeyStr = category
    ? cacheKey("trending", "posts", category)
    : cacheKey("trending", "posts", "all");

  trendingCache.set(cacheKeyStr, topTrending, 5 * 60 * 1000);

  // Also update hashtag trending scores
  // Get recent post IDs first, then find their hashtags
  const recentPosts = await prisma.post.findMany({
    where: {
      createdAt: { gte: twentyFourHoursAgo },
    },
    select: { id: true },
  });

  const recentPostIds = recentPosts.map((p) => p.id);

  if (recentPostIds.length > 0) {
    const recentPostHashtags = await prisma.postHashtag.findMany({
      where: {
        postId: { in: recentPostIds },
      },
      select: {
        hashtagId: true,
      },
    });

    // Count uses per hashtag
    const hashtagUseCounts: Record<string, number> = {};
    for (const ph of recentPostHashtags) {
      hashtagUseCounts[ph.hashtagId] = (hashtagUseCounts[ph.hashtagId] || 0) + 1;
    }

    // Get the full hashtag records and update trending scores
    const hashtagIds = Object.keys(hashtagUseCounts);
    if (hashtagIds.length > 0) {
      const hashtags = await prisma.hashtag.findMany({
        where: { id: { in: hashtagIds } },
      });

      // Update trending scores for hashtags
      for (const hashtag of hashtags) {
        const recentUseCount = hashtagUseCounts[hashtag.id] || 0;
        const trendingScore = recentUseCount * Math.log10(hashtag.useCount + 1);

        await prisma.hashtag.update({
          where: { id: hashtag.id },
          data: {
            trendingScore,
          },
        });
      }
    }
  }

  console.log(
    `[JobProcessor] Updated trending content${category ? ` for ${category}` : ""}: ${topTrending.length} posts`
  );
}

/**
 * Process government data sync
 * Pulls fresh bills, executive orders, and SCOTUS cases into GovernmentReference
 */
async function processSyncGovernmentData(data: SyncGovernmentDataData): Promise<void> {
  await syncGovernmentData(data.trigger);
}

/**
 * Build a citizen brief for one government reference and store it on the master
 * reference row. Queued the first time someone opens or shares a law, so the reader
 * gets the official text immediately and the brief lands seconds later — every
 * later reader is served the stored copy.
 */
async function processGenerateReferenceBrief(data: GenerateReferenceBriefData): Promise<void> {
  await processReferenceBrief(data.referenceId, data.force ?? false);
}

/**
 * Initialize all job processors with the job queue
 * Call this function when the server starts
 */
export function initializeProcessors(): void {
  jobQueue.registerProcessor(JobType.UPDATE_POST_METRICS, processUpdatePostMetrics);
  jobQueue.registerProcessor(JobType.UPDATE_CREATOR_METRICS, processUpdateCreatorMetrics);
  jobQueue.registerProcessor(JobType.CALCULATE_VIRALITY, processCalculateVirality);
  jobQueue.registerProcessor(JobType.TRACK_INTERACTION, processTrackInteraction);
  jobQueue.registerProcessor(JobType.UPDATE_TRENDING, processUpdateTrending);
  jobQueue.registerProcessor(JobType.SYNC_GOVERNMENT_DATA, processSyncGovernmentData);
  jobQueue.registerProcessor(JobType.GENERATE_REFERENCE_BRIEF, processGenerateReferenceBrief);

  console.log("[JobProcessor] All processors registered successfully");
}

// Export individual processors for testing
export {
  processUpdatePostMetrics,
  processUpdateCreatorMetrics,
  processCalculateVirality,
  processTrackInteraction,
  processUpdateTrending,
};
