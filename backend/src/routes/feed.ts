import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import {
  getPersonalizedFeed,
  trackInteraction,
  updateCreatorMetrics,
  getSimilarUsers,
  getTrendingHashtags,
  getDiscoverFeed,
} from "../services/feed-algorithm";
import { loadPostReferenceViews } from "../services/post-reference-view";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const feedRouter = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const feedQuerySchema = z.object({
  type: z.enum(["for_you", "following", "trending", "discover"]).optional().default("for_you"),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
  exclude: z.string().optional(), // Comma-separated post IDs to exclude
});

const interactionSchema = z.object({
  interactionType: z.enum(["view", "like", "comment", "share", "save", "follow", "mention", "dwell"]),
  postId: z.string().optional(),
  targetUserId: z.string().optional(),
  dwellTimeMs: z.number().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

const batchInteractionSchema = z.object({
  interactions: z.array(interactionSchema),
});

/**
 * GET /api/feed
 * Get personalized feed based on user preferences and algorithm
 */
feedRouter.get("/", zValidator("query", feedQuerySchema), async (c) => {
  const user = c.get("user");
  const { type, limit, cursor, exclude } = c.req.valid("query");

  const excludePostIds = exclude ? exclude.split(",") : [];

  try {
    const result = await getPersonalizedFeed(
      user?.id || null,
      type,
      Math.min(limit, 50), // Cap at 50
      cursor,
      excludePostIds
    );

    // Same law-card payload the timeline gets — one faucet, one shape.
    const referenceViews = await loadPostReferenceViews(
      result.posts.map((post) => post.governmentReferenceId),
      user?.id ?? null
    );

    return c.json({
      posts: result.posts.map((post) => ({
        id: post.id,
        content: post.content,
        author: {
          id: post.author.id,
          displayName: post.author.name,
          username: post.author.email.split("@")[0],
          avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
          followerCount: post.author.followerCount,
          isFollowed: post.author.isFollowed,
        },
        bill: post.bill,
        governmentReferenceId: post.governmentReferenceId,
        referenceType: post.referenceType,
        referenceId: post.referenceId,
        // The law as it stands, not the copy frozen when the post was written.
        // The record is shared; the post frames it to one person's timeline.
        referenceTitle:
          (post.governmentReferenceId
            ? referenceViews.get(post.governmentReferenceId)?.title
            : null) ?? post.referenceTitle,
        reference: post.governmentReferenceId
          ? referenceViews.get(post.governmentReferenceId) ?? null
          : null,
        metrics: post.metrics,
        feedReason: post.feedReason,
        isLiked: post.isLiked,
        isSaved: post.isSaved,
        createdAt: post.createdAt.toISOString(),
      })),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error("Feed error:", error);
    return c.json({ error: "Failed to fetch feed" }, 500);
  }
});

/**
 * GET /api/feed/discover
 * Get discovery feed with content from users you don't follow
 */
feedRouter.get("/discover", zValidator("query", z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
})), async (c) => {
  const user = c.get("user");
  const { limit } = c.req.valid("query");

  try {
    const posts = await getDiscoverFeed(user?.id || null, Math.min(limit, 50));

    const referenceViews = await loadPostReferenceViews(
      posts.map((post) => post.governmentReferenceId),
      user?.id ?? null
    );

    return c.json({
      posts: posts.map((post) => ({
        id: post.id,
        content: post.content,
        author: {
          id: post.author.id,
          displayName: post.author.name,
          username: post.author.email.split("@")[0],
          avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
          followerCount: post.author.followerCount,
          isFollowed: post.author.isFollowed,
        },
        bill: post.bill,
        governmentReferenceId: post.governmentReferenceId,
        referenceType: post.referenceType,
        referenceId: post.referenceId,
        // The law as it stands, not the copy frozen when the post was written.
        // The record is shared; the post frames it to one person's timeline.
        referenceTitle:
          (post.governmentReferenceId
            ? referenceViews.get(post.governmentReferenceId)?.title
            : null) ?? post.referenceTitle,
        reference: post.governmentReferenceId
          ? referenceViews.get(post.governmentReferenceId) ?? null
          : null,
        metrics: post.metrics,
        feedReason: post.feedReason,
        isLiked: post.isLiked,
        isSaved: post.isSaved,
        createdAt: post.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Discover feed error:", error);
    return c.json({ error: "Failed to fetch discover feed" }, 500);
  }
});

/**
 * POST /api/feed/interaction
 * Track a user interaction for feed personalization
 */
feedRouter.post("/interaction", zValidator("json", interactionSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { interactionType, postId, targetUserId, dwellTimeMs, metadata } = c.req.valid("json");

  try {
    await trackInteraction(user.id, interactionType, postId, targetUserId, dwellTimeMs, metadata);
    return c.json({ success: true });
  } catch (error) {
    console.error("Track interaction error:", error);
    return c.json({ error: "Failed to track interaction" }, 500);
  }
});

/**
 * POST /api/feed/interactions/batch
 * Track multiple interactions at once (for efficiency)
 */
feedRouter.post("/interactions/batch", zValidator("json", batchInteractionSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { interactions } = c.req.valid("json");

  try {
    await Promise.all(
      interactions.map((interaction) =>
        trackInteraction(
          user.id,
          interaction.interactionType,
          interaction.postId,
          interaction.targetUserId,
          interaction.dwellTimeMs,
          interaction.metadata
        )
      )
    );
    return c.json({ success: true, tracked: interactions.length });
  } catch (error) {
    console.error("Batch track interaction error:", error);
    return c.json({ error: "Failed to track interactions" }, 500);
  }
});

/**
 * GET /api/feed/similar-users
 * Get users with similar voting patterns
 */
feedRouter.get("/similar-users", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const similarUserIds = await getSimilarUsers(user.id, 10);

    const users = await prisma.user.findMany({
      where: { id: { in: similarUserIds } },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        _count: {
          select: {
            followers: true,
            posts: true,
          },
        },
      },
    });

    // Check which users the current user follows
    const following = await prisma.follow.findMany({
      where: {
        followerId: user.id,
        followingId: { in: similarUserIds },
      },
      select: { followingId: true },
    });
    const followingSet = new Set(following.map((f) => f.followingId));

    return c.json({
      users: users.map((u) => ({
        id: u.id,
        displayName: u.name,
        username: u.email.split("@")[0],
        avatar: u.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`,
        bio: u.bio,
        followerCount: u._count.followers,
        postCount: u._count.posts,
        isFollowed: followingSet.has(u.id),
      })),
    });
  } catch (error) {
    console.error("Similar users error:", error);
    return c.json({ error: "Failed to fetch similar users" }, 500);
  }
});

/**
 * GET /api/feed/trending-hashtags
 * Get trending hashtags
 */
feedRouter.get("/trending-hashtags", async (c) => {
  try {
    const hashtags = await getTrendingHashtags(10);
    return c.json({ hashtags });
  } catch (error) {
    console.error("Trending hashtags error:", error);
    return c.json({ error: "Failed to fetch trending hashtags" }, 500);
  }
});

/**
 * GET /api/feed/trending-creators
 * Get trending/popular content creators
 */
feedRouter.get("/trending-creators", async (c) => {
  const user = c.get("user");

  try {
    const creators = await prisma.creatorMetrics.findMany({
      orderBy: [
        { influenceScore: "desc" },
        { avgEngagementRate: "desc" },
      ],
      take: 20,
      select: {
        userId: true,
        totalFollowers: true,
        totalLikes: true,
        avgEngagementRate: true,
        influenceScore: true,
        topCategories: true,
      },
    });

    const userIds = creators.map((c) => c.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
      },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Check which creators the current user follows
    let followingSet = new Set<string>();
    if (user) {
      const following = await prisma.follow.findMany({
        where: {
          followerId: user.id,
          followingId: { in: userIds },
        },
        select: { followingId: true },
      });
      followingSet = new Set(following.map((f) => f.followingId));
    }

    return c.json({
      creators: creators
        .map((c) => {
          const userData = userMap.get(c.userId);
          if (!userData) return null;
          return {
            id: userData.id,
            displayName: userData.name,
            username: userData.email.split("@")[0],
            avatar: userData.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.id}`,
            bio: userData.bio,
            followerCount: c.totalFollowers,
            totalLikes: c.totalLikes,
            engagementRate: c.avgEngagementRate,
            influenceScore: c.influenceScore,
            topCategories: c.topCategories ? JSON.parse(c.topCategories) : [],
            isFollowed: followingSet.has(userData.id),
          };
        })
        .filter(Boolean),
    });
  } catch (error) {
    console.error("Trending creators error:", error);
    return c.json({ error: "Failed to fetch trending creators" }, 500);
  }
});

/**
 * POST /api/feed/posts/:id/save
 * Save/bookmark a post
 */
feedRouter.post("/posts/:id/save", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const postId = c.req.param("id");

  try {
    // Check if already saved
    const existing = await prisma.postSave.findUnique({
      where: { postId_userId: { postId, userId: user.id } },
    });

    if (existing) {
      // Unsave
      await prisma.postSave.delete({
        where: { id: existing.id },
      });
      return c.json({ success: true, saved: false });
    }

    // Save
    await prisma.postSave.create({
      data: { postId, userId: user.id },
    });

    // Track interaction
    await trackInteraction(user.id, "save", postId);

    return c.json({ success: true, saved: true });
  } catch (error) {
    console.error("Save post error:", error);
    return c.json({ error: "Failed to save post" }, 500);
  }
});

/**
 * POST /api/feed/posts/:id/share
 * Track a post share
 */
feedRouter.post("/posts/:id/share", zValidator("json", z.object({
  shareType: z.enum(["internal", "external", "dm"]).optional().default("internal"),
})), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const postId = c.req.param("id");
  const { shareType } = c.req.valid("json");

  try {
    await prisma.postShare.create({
      data: { postId, userId: user.id, shareType },
    });

    // Track interaction
    await trackInteraction(user.id, "share", postId, undefined, undefined, { shareType });

    // Update creator metrics for post author
    const post = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (post) {
      await updateCreatorMetrics(post.authorId);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("Share post error:", error);
    return c.json({ error: "Failed to track share" }, 500);
  }
});

/**
 * GET /api/feed/saved
 * Get user's saved posts
 */
feedRouter.get("/saved", zValidator("query", z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
})), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { limit, cursor } = c.req.valid("query");

  try {
    const saves = await prisma.postSave.findMany({
      where: { userId: user.id },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        post: {
          include: {
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                image: true,
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
                likes: true,
                comments: true,
              },
            },
          },
        },
      },
    });

    const hasMore = saves.length > limit;
    const results = hasMore ? saves.slice(0, -1) : saves;
    const lastSave = results[results.length - 1];
    const nextCursor = lastSave ? lastSave.id : null;

    // Get like status for these posts
    const postIds = results.map((s) => s.postId);
    const likes = await prisma.postLike.findMany({
      where: { userId: user.id, postId: { in: postIds } },
      select: { postId: true },
    });
    const likedSet = new Set(likes.map((l) => l.postId));

    return c.json({
      posts: results.map((save) => ({
        id: save.post.id,
        content: save.post.content,
        author: {
          id: save.post.author.id,
          displayName: save.post.author.name,
          username: save.post.author.email.split("@")[0],
          avatar: save.post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${save.post.author.id}`,
        },
        bill: save.post.bill,
        metrics: {
          likes: save.post._count.likes,
          comments: save.post._count.comments,
        },
        isLiked: likedSet.has(save.post.id),
        isSaved: true,
        savedAt: save.createdAt.toISOString(),
        createdAt: save.post.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("Saved posts error:", error);
    return c.json({ error: "Failed to fetch saved posts" }, 500);
  }
});

/**
 * POST /api/feed/refresh-creator-metrics
 * Manually refresh creator metrics (admin/testing)
 */
feedRouter.post("/refresh-creator-metrics/:userId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  // "me" resolves to the caller. The clients have always sent the literal
  // "me" here (see refreshMyCreatorMetrics in lib/api/feed.ts, whose comment
  // says the endpoint takes the id from the session), but this handler compared
  // the raw segment against user.id — and "me" never equals a cuid, so every
  // call returned 403. Accepting the alias is what the callers already assume.
  const rawUserId = c.req.param("userId");
  const targetUserId = rawUserId === "me" ? user.id : rawUserId;

  // Only allow refreshing own metrics or if admin
  if (targetUserId !== user.id) {
    return c.json({ error: "Not authorized" }, 403);
  }

  try {
    await updateCreatorMetrics(targetUserId);
    const metrics = await prisma.creatorMetrics.findUnique({
      where: { userId: targetUserId },
    });
    return c.json({ success: true, metrics });
  } catch (error) {
    console.error("Refresh creator metrics error:", error);
    return c.json({ error: "Failed to refresh metrics" }, 500);
  }
});

export { feedRouter };
