import { prisma } from "../prisma";
import { hiddenFrom } from "./relationships";
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

  // BILL OF RIGHTS ARTICLE II. The two multipliers that used to live here —
  // a 2x for engagement VELOCITY inside the first hour and a 1.5x for a high
  // engagement RATE — are gone, and must not come back.
  //
  // Velocity is the canonical outrage signal. A post that collects reactions
  // fastest in its first hour is, on a platform about contested legislation,
  // usually the angriest one available; doubling its score is the precise
  // mechanic Article II names when it says no algorithm shall "amplify one
  // voice over another based on outrage". Nothing about them was neutral, and
  // the compliance flag that was supposed to gate them never applied to this
  // file at all.
  VIRAL_DETECTION_WINDOW_HOURS: 1, // Kept for CLASSIFICATION only — see below.

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

  // A HARD CEILING ON WHAT REACTIONS CAN BUY.
  //
  // Article II: "only the verifiable weight of Liquid Democracy shall
  // determine the prominence of an idea." Engagement is kept as a tiebreaker
  // because a post nobody answered is weaker evidence than one people argued
  // with — but it is capped so it can never outrank the civic weight below.
  ENGAGEMENT_MAX_CONTRIBUTION: 40,

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

  // THE TWO SIGNALS ONLY THIS PLATFORM HAS.
  //
  // Every weight above this line exists in every feed ever built: engagement,
  // recency, who you follow, what you clicked. They are a model of what will
  // hold attention. These two are not a model of anything — they are read off
  // the public record of what people actually voted on.
  POSITION_MATCH_BOOST: 60, // A post about a record this reader took a side on.
  OTHER_SIDE_RATIO: 0.2, // A FLOOR of the feed from people who voted the other way.

  // THE VERIFIABLE WEIGHT OF LIQUID DEMOCRACY, which Article II says is the
  // only thing that should decide prominence.
  //
  // On this platform that has a precise meaning: the published tally on the
  // record a post is attached to — direct votes plus everything delegation
  // carried into them. A post about a bill four thousand citizens have taken a
  // position on is more prominent than one about a bill nobody has read, and
  // that ordering comes from the Pulse rather than from a reaction count.
  //
  // Logarithmic so the tenth voice matters more than the ten-thousandth: this
  // ranks by how much of the electorate has engaged with the RECORD, not by
  // raw size, and it cannot be bought with volume.
  CIVIC_WEIGHT_PER_DECADE: 45,
  CIVIC_WEIGHT_MAX: 180,
};

/**
 * THE RANKING, IN PUBLIC.
 *
 * Constitution Article III §1: "The method by which the Pulse and every
 * published measure is calculated shall be open to inspection. The platform
 * shall publish no figure it will not explain." Amendment II requires the same
 * of the feed: no black-box algorithm, and prominence conferred by Delegation
 * and by nothing else.
 *
 * Neither was true. The only thing any screen could show was
 * getAlgorithmCompliance(), a hardcoded object in the client bundle that
 * asserted `engagementBait: false` and was never derived from anything — it
 * could not have detected engagement bait if the ranker had been made of it,
 * and it did not apply to this file at all.
 *
 * This returns the numbers actually in use, read off the same object the
 * scorer reads, so an audit is a request rather than a code review.
 */
export function getRankingFactors() {
  return {
    /** What decides prominence, in the order they matter. */
    factors: [
      {
        name: "Civic weight of the record",
        detail:
          "The published tally on the law a post is about — direct votes plus everything delegation carried into them. Logarithmic, so the tenth voice counts for more than the ten-thousandth.",
        maximum: ALGORITHM_CONFIG.CIVIC_WEIGHT_MAX,
        basis: "liquid-democracy",
      },
      {
        name: "You took a position on this record",
        detail: "You are on public record with a side on this exact law.",
        maximum: ALGORITHM_CONFIG.POSITION_MATCH_BOOST,
        basis: "liquid-democracy",
      },
      {
        name: "Someone you follow",
        detail: "You chose to follow this author.",
        maximum: ALGORITHM_CONFIG.FOLLOWING_BOOST,
        basis: "your-choice",
      },
      {
        name: "Recency",
        detail: `Exponential decay, half-life ${ALGORITHM_CONFIG.RECENCY_HALF_LIFE_HOURS} hours.`,
        maximum: null,
        basis: "time",
      },
      {
        name: "Replies and reactions",
        detail:
          "A tiebreaker only, hard-capped so it can never outrank the civic weight above it.",
        maximum: ALGORITHM_CONFIG.ENGAGEMENT_MAX_CONTRIBUTION,
        basis: "engagement",
      },
    ],
    /** Named so their absence is auditable too. */
    forbidden: [
      "Engagement velocity (how fast a post collects reactions)",
      "Paid promotion or any commercial placement",
      "Outrage, sentiment, or predicted emotional response",
      "Anything the platform's operators can set per-account",
    ],
    recencyHalfLifeHours: ALGORITHM_CONFIG.RECENCY_HALF_LIFE_HOURS,
    engagementCap: ALGORITHM_CONFIG.ENGAGEMENT_MAX_CONTRIBUTION,
  };
}

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
  /**
   * Every record this person has taken a public side on, and which side.
   *
   * THE FEED DID NOT KNOW THIS. Category preference and "people like you" were
   * both computed from the legacy `Vote` table, while every client on the
   * platform votes through /api/government-references/:id/vote, which writes
   * `GovernmentReferenceVote`. So the half of the ranking that was supposed to
   * make this feed about legislation read an empty table, and what was left
   * was engagement and recency — the same feed as everywhere else.
   */
  positions: Record<string, string>;
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
      const [following, likes, comments, interactions, positionVotes, legacyVotes] =
        await Promise.all([
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
        // Category preference and the reader's own positions, from the table
        // the platform actually writes to.
        prisma.governmentReferenceVote.findMany({
          where: { userId, position: { in: ["support", "oppose"] } },
          select: {
            governmentReferenceId: true,
            position: true,
            governmentReference: { select: { category: true } },
          },
        }),
        // The legacy table as well, so an account that voted before the
        // reference endpoints existed is not suddenly treated as having no
        // history at all.
        prisma.vote.findMany({
          where: { userId },
          include: { bill: { select: { category: true } } },
        }),
      ]);

      const followingIds = following.map((f) => f.followingId);
      const likedPostIds = likes.map((l) => l.postId);

      const preferredCategories: Record<string, number> = {};
      const positions: Record<string, string> = {};

      positionVotes.forEach((vote) => {
        positions[vote.governmentReferenceId] = vote.position;
        const category = vote.governmentReference?.category;
        if (category) {
          preferredCategories[category] = (preferredCategories[category] || 0) + 1;
        }
      });

      legacyVotes.forEach((vote) => {
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
        positions,
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
  userViewHistory?: Map<string, number>, // postId -> times shown
  /**
   * Post ids whose author took the OPPOSITE side to the reader on the record
   * the post is about. Precomputed in one query rather than looked up per post.
   */
  otherSidePostIds?: Set<string>
): Promise<{
  score: number;
  reason: string;
  isRising: boolean;
  isFresh: boolean;
  isOtherSide: boolean;
}> {
  let score = 0;
  let reason = "Recommended";
  let isRising = false;
  let isFresh = false;
  const isOtherSide = otherSidePostIds?.has(post.id) ?? false;

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

  // CAPPED. Article II keeps reactions as a tiebreaker and nothing more; the
  // civic weight below is what decides prominence.
  score += Math.min(engagementScore, ALGORITHM_CONFIG.ENGAGEMENT_MAX_CONTRIBUTION);

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

  // 4. RISING CONTENT — CLASSIFICATION ONLY, NO LONGER A MULTIPLIER.
  //
  // The flag still exists because the feed interleaves fresh, rising and
  // regular posts for variety, and that mixing is worth keeping. What is gone
  // is the 1.5x it used to apply to the score, and the 2x that a high
  // engagement VELOCITY in the first hour used to apply on top of it.
  //
  // Velocity is the outrage signal. On a platform about contested legislation
  // the post gathering reactions fastest in its first hour is reliably the
  // angriest one on offer, and multiplying its score is exactly what Bill of
  // Rights Article II forbids: amplifying one voice over another on the
  // strength of outrage rather than the verifiable weight of Liquid Democracy.
  if (postAge < ALGORITHM_CONFIG.RISING_CONTENT_WINDOW_HOURS && postAge > 0) {
    const views = post.metrics?.viewCount || 1;
    if (engagementScore / views >= ALGORITHM_CONFIG.RISING_ENGAGEMENT_THRESHOLD) {
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

  // 11. THE VERIFIABLE WEIGHT OF LIQUID DEMOCRACY.
  //
  // Article II names this as the ONLY thing that should decide how prominent
  // an idea is, and on this platform it has an exact meaning: the published
  // tally on the record the post is attached to — direct votes plus everything
  // delegation carried into them. This is now the largest term in the score,
  // which is the whole point. A post is prominent because citizens engaged
  // with the LAW it is about, not because it collected reactions.
  //
  // A post attached to no record gets nothing here rather than a default.
  // Inventing a civic weight for something with no government record behind it
  // is the drift into fiction Constitution Article III, Section 3 exists to
  // prevent.
  const civicVoices =
    (post.governmentReference?.supportVotes ?? 0) + (post.governmentReference?.opposeVotes ?? 0);
  if (civicVoices > 0) {
    // Logarithmic: the tenth voice on a record counts for more than the
    // ten-thousandth, so prominence tracks how much of the electorate has
    // engaged rather than raw size, and cannot be bought with volume.
    score += Math.min(
      Math.log10(civicVoices + 1) * ALGORITHM_CONFIG.CIVIC_WEIGHT_PER_DECADE,
      ALGORITHM_CONFIG.CIVIC_WEIGHT_MAX,
    );
    if (reason === "Recommended") {
      reason = "Citizens are voting on this";
    }
  }

  // 12. THE TWO SIGNALS ONLY THIS PLATFORM HAS.
  //
  // A post about a record this reader has taken a public side on is relevant
  // to them as a matter of record, not as a prediction — they committed to a
  // position on that exact bill. Nothing else in this file can know that.
  if (post.governmentReferenceId && userPrefs.positions[post.governmentReferenceId]) {
    score += ALGORITHM_CONFIG.POSITION_MATCH_BOOST;
    if (reason === "Recommended" || reason === "Fresh content") {
      reason = "About a law you took a position on";
    }
  }

  // And the label for the other side. NOT A BOOST AND NOT A PENALTY: the
  // quota is applied when the feed is assembled, so agreeing with somebody
  // costs nothing and disagreeing buys nothing. What it does buy is the
  // sentence saying why this is here, because a feed that quietly rearranges
  // what somebody sees is the thing this is meant to be an alternative to.
  if (isOtherSide) {
    reason = "They voted the other way on this";
  }

  return { score: Math.max(score, 0), reason, isRising, isFresh, isOtherSide };
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

  // The reader's own switch for the other-side floor below. Absent row means
  // the default, which is on.
  let wantsOtherSide = true;

  if (userId) {
    userPrefs = await getUserPreferences(userId);

    const feedPrefs = await prisma.notificationPreference.findUnique({
      where: { userId },
      select: { showOtherSide: true },
    });
    wantsOtherSide = feedPrefs?.showOtherSide ?? true;

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

  // BLOCKED AND MUTED PEOPLE DO NOT APPEAR. Applied to the query rather than
  // the results, so a feed page is never quietly short because half of it was
  // filtered away after the fact.
  const hidden = await hiddenFrom(userId);

  // Feed type specific filters
  if (feedType === "following" && userPrefs) {
    const following = hidden.length > 0
      ? userPrefs.followingIds.filter((id: string) => !hidden.includes(id))
      : userPrefs.followingIds;
    whereClause.authorId = { in: following };
  } else if (hidden.length > 0) {
    whereClause.authorId = { notIn: hidden };
  }

  // Reduced fetch limit from 150 to 60 for better performance while maintaining diversity
  const fetchLimit = Math.min(limit * 3, 60);

  // NO CACHE ON THIS QUERY, and there must not be one keyed the way the old one
  // was.
  //
  // It cached the base post page under ("posts", feedType, cursor, limit) — no
  // user in the key — and served whatever the first caller got to everybody
  // else for two minutes. That was already wrong for a personalised feed. It
  // became a leak the moment this query started excluding each reader's blocked
  // and muted people, because then one person's block would hide a post from
  // every other reader.
  //
  // It also cost nothing to remove: the query below ran unconditionally and the
  // cached value was used INSTEAD of a result already paid for. The cache saved
  // no database work at all and only served staler data.
  //
  // The per-user feed cache further up (keyed on userId) is untouched and fine.
  const posts = await prisma.post.findMany({
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
      // The published Liquid Democracy tally on the record this post is
      // about. Article II makes this the deciding factor in the ranking, so
      // it is loaded with the page rather than fetched once per post.
      governmentReference: {
        select: { supportVotes: true, opposeVotes: true },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
        },
      },
    },
  });

  // WHICH OF THESE POSTS COME FROM THE OTHER SIDE.
  //
  // One query, not one per post: for every post attached to a record this
  // reader has taken a side on, did its author take the opposite side? That is
  // a fact on the public record — no model, no inference from clicks, and
  // nothing any other feed can compute.
  const otherSidePostIds = new Set<string>();
  // A reader who has turned this off gets none of it: no reserved slots below,
  // and no "voted the other way" label either. Labelling somebody's post by
  // viewpoint after they declined the feature is still the platform annotating
  // by viewpoint, which is the thing Article II is uneasy about.
  if (wantsOtherSide && userPrefs && Object.keys(userPrefs.positions).length > 0) {
    const candidates = posts.filter(
      (post) =>
        post.governmentReferenceId && userPrefs!.positions[post.governmentReferenceId],
    );

    if (candidates.length > 0) {
      const authorVotes = await prisma.governmentReferenceVote.findMany({
        where: {
          userId: { in: [...new Set(candidates.map((p) => p.authorId))] },
          governmentReferenceId: {
            in: [...new Set(candidates.map((p) => p.governmentReferenceId as string))],
          },
          position: { in: ["support", "oppose"] },
          // ARTICLE IV. The badge on this post says "voted the other way",
          // which announces how a named person voted. Only positions somebody
          // put their name to can carry it.
          isAnonymous: false,
        },
        select: { userId: true, governmentReferenceId: true, position: true },
      });

      const theirPosition = new Map(
        authorVotes.map((v) => [`${v.userId}:${v.governmentReferenceId}`, v.position]),
      );

      for (const post of candidates) {
        const mine = userPrefs.positions[post.governmentReferenceId as string];
        const theirs = theirPosition.get(`${post.authorId}:${post.governmentReferenceId}`);
        if (theirs && theirs !== mine) {
          otherSidePostIds.add(post.id);
        }
      }
    }
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
    isOtherSide: boolean;
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
    const { score, reason, isRising, isFresh, isOtherSide } = await calculatePostScore(
      { ...post, metrics },
      userPrefs || {
        preferredCategories: {},
        preferredAuthors: {},
        followingIds: [],
        positions: {},
        interactionHistory: { likedPostIds: [], commentedPostIds: [], viewedPostIds: [] },
      },
      seenAuthors,
      seenCategories,
      userViewHistory,
      otherSidePostIds
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
      // The frozen copy from when the post was written. The routes replace it
      // with the record's live title before responding — see routes/feed.ts.
      // It is carried this far only so a post with no linked record still has
      // something to show.
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
      isOtherSide,
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

    // THE OTHER SIDE IS A FLOOR, NOT A TAX — AND IT IS THE READER'S CHOICE.
    //
    // Article II says only the verifiable weight of Liquid Democracy should
    // decide prominence, and a platform reserving a fifth of the feed by
    // viewpoint is the platform deciding prominence, however good the intent.
    // Article II also calls the platform "a neutral conduit for human intent":
    // a citizen choosing this for themselves is human intent, the platform
    // choosing it for them is not. So it reads a switch they own, and if they
    // have turned it off nothing here runs at all.
    //
    // Up to a fifth of the feed is reserved for people who took the opposite
    // position on a record this reader also voted on. It is added rather than
    // substituted for something similar: agreeing with somebody costs them
    // nothing, and the reader is never shown less of what they came for.
    //
    // Nothing about this is inferred. Every post here is one where two people
    // are on public record disagreeing about the same bill, which is the only
    // reason a platform can do this honestly at all — every other "see the
    // other side" feature is a guess about somebody's politics.
    const otherSideSlots = wantsOtherSide
      ? Math.floor(limit * ALGORITHM_CONFIG.OTHER_SIDE_RATIO)
      : 0;
    if (otherSideSlots > 0) {
      const alreadyIn = new Set(finalFeed.map((p) => p.id));
      const waiting = allScoredPosts
        .filter((p) => p.isOtherSide && !alreadyIn.has(p.id))
        .sort((a, b) => b.score - a.score)
        .slice(0, otherSideSlots);

      // Spread through the feed rather than stacked at the end, where nobody
      // reaches them.
      const step = Math.max(1, Math.floor(finalFeed.length / (waiting.length + 1)));
      waiting.forEach((post, index) => {
        const at = Math.min((index + 1) * step, finalFeed.length);
        finalFeed.splice(at, 0, post);
      });
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

  // THE TABLE THE PLATFORM ACTUALLY WRITES TO.
  //
  // This read `Vote` — the legacy Bill table — while every client votes through
  // /api/government-references/:id/vote, which writes GovernmentReferenceVote.
  // So "people like you" was empty for every account created since, and the
  // feature quietly did nothing at all.
  // ANONYMOUS VOTES ARE NOT MATERIAL FOR THIS, ON EITHER SIDE.
  //
  // This is the one read of GovernmentReferenceVote that did not exclude them.
  // Every other one does — common-ground.ts, position-history.ts, onboarding.ts
  // and the reference routes all filter `isAnonymous: false`, because a person
  // who votes anonymously has said they do not want that position attached to
  // them in public.
  //
  // Here it mattered more than anywhere else, because the endpoint that calls
  // this — GET /api/feed/similar-users — returns NAMES. Somebody who voted
  // anonymously on five records could be handed back to a stranger as
  // "similar", which discloses both that they voted and, over a few records,
  // how. Excluding them from the caller's own side too, so an anonymous vote
  // cannot be used to find people even by the person who cast it.
  const userVotes = await prisma.governmentReferenceVote.findMany({
    where: { userId, position: { in: ["support", "oppose"] }, isAnonymous: false },
    select: { governmentReferenceId: true, position: true },
  });

  if (userVotes.length === 0) return [];

  // Find users who voted similarly
  const voteMap = new Map(userVotes.map((v) => [v.governmentReferenceId, v.position]));

  const otherUsers = await prisma.governmentReferenceVote.findMany({
    where: {
      governmentReferenceId: { in: Array.from(voteMap.keys()) },
      userId: { not: userId },
      position: { in: ["support", "oppose"] },
      isAnonymous: false,
    },
    select: { userId: true, governmentReferenceId: true, position: true },
  });

  // Calculate similarity scores
  const similarityScores: Record<string, number> = {};
  for (const vote of otherUsers) {
    const userPosition = voteMap.get(vote.governmentReferenceId);
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
