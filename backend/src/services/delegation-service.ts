/**
 * Liquid democracy: earned delegate eligibility and delegated vote weighting.
 *
 * ELIGIBILITY IS EARNED, NOT GRANTED. Only routinely active accounts qualify —
 * this preserves the integrity of delegation (no fresh or dormant accounts
 * collecting voting power). Rules are enforced server-side on every delegation
 * create, so clients cannot bypass them. Both faucets consume the same rules.
 *
 * VOTE WEIGHTING. A delegate's vote on a reference counts once for themselves
 * plus once for each active delegation that covers the reference's category —
 * unless the delegator voted directly (a direct vote always overrides your
 * delegate). Weighted totals are written to GovernmentReference.supportVotes /
 * opposeVotes, so the Pulse, Discover, trending, and detail pages all reflect
 * delegation automatically.
 */

import { prisma } from "../prisma";

// Tunable "routinely active" thresholds
export const DELEGATE_REQUIREMENTS = {
  MIN_ACCOUNT_AGE_DAYS: 14,
  MIN_VOTES: 20,
  MIN_POSTS: 3,
  ACTIVE_WITHIN_DAYS: 14,
} as const;

export interface EligibilityRequirement {
  key: string;
  label: string;
  required: number;
  current: number;
  met: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  requirements: EligibilityRequirement[];
}

interface ActivityStats {
  accountAgeDays: number;
  totalVotes: number;
  totalPosts: number;
  daysSinceLastActivity: number | null;
}

async function getActivityStats(userId: string): Promise<ActivityStats | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      _count: { select: { votes: true, posts: true } },
    },
  });
  if (!user) return null;

  const [refVoteCount, latestRefVote, latestPost, latestVote] = await Promise.all([
    prisma.governmentReferenceVote.count({ where: { userId } }),
    prisma.governmentReferenceVote.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    prisma.post.findFirst({
      where: { authorId: userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.vote.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);

  const lastActivity = [latestRefVote?.updatedAt, latestPost?.createdAt, latestVote?.updatedAt]
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const DAY = 24 * 60 * 60 * 1000;
  return {
    accountAgeDays: Math.floor((Date.now() - user.createdAt.getTime()) / DAY),
    totalVotes: user._count.votes + refVoteCount,
    totalPosts: user._count.posts,
    daysSinceLastActivity: lastActivity
      ? Math.floor((Date.now() - lastActivity.getTime()) / DAY)
      : null,
  };
}

function evaluate(stats: ActivityStats): EligibilityResult {
  const R = DELEGATE_REQUIREMENTS;
  const requirements: EligibilityRequirement[] = [
    {
      key: "account_age",
      label: `Account at least ${R.MIN_ACCOUNT_AGE_DAYS} days old`,
      required: R.MIN_ACCOUNT_AGE_DAYS,
      current: stats.accountAgeDays,
      met: stats.accountAgeDays >= R.MIN_ACCOUNT_AGE_DAYS,
    },
    {
      key: "votes",
      label: `At least ${R.MIN_VOTES} votes cast`,
      required: R.MIN_VOTES,
      current: stats.totalVotes,
      met: stats.totalVotes >= R.MIN_VOTES,
    },
    {
      key: "posts",
      label: `At least ${R.MIN_POSTS} posts or shares`,
      required: R.MIN_POSTS,
      current: stats.totalPosts,
      met: stats.totalPosts >= R.MIN_POSTS,
    },
    {
      key: "recent_activity",
      label: `Active within the last ${R.ACTIVE_WITHIN_DAYS} days`,
      required: R.ACTIVE_WITHIN_DAYS,
      current: stats.daysSinceLastActivity ?? Number.MAX_SAFE_INTEGER,
      met:
        stats.daysSinceLastActivity !== null &&
        stats.daysSinceLastActivity <= R.ACTIVE_WITHIN_DAYS,
    },
  ];

  return { eligible: requirements.every((r) => r.met), requirements };
}

/** Full eligibility report for one user (null if the user doesn't exist). */
export async function checkDelegateEligibility(
  userId: string,
): Promise<EligibilityResult | null> {
  const stats = await getActivityStats(userId);
  return stats ? evaluate(stats) : null;
}

export interface DelegateListing {
  id: string;
  name: string;
  username: string;
  image: string | null;
  bio: string | null;
  delegatorCount: number;
  totalVotes: number;
  totalPosts: number;
  followerCount: number;
  topCategories: string[];
  memberSince: string;
}

/**
 * The delegate directory: every user who currently meets the earned-eligibility
 * bar, with the stats the directory cards display. Recomputed live so lapsed
 * users drop out automatically.
 */
export async function listEligibleDelegates(limit = 50): Promise<DelegateListing[]> {
  const R = DELEGATE_REQUIREMENTS;
  const oldestAllowedCreation = new Date(Date.now() - R.MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000);
  const activityCutoff = new Date(Date.now() - R.ACTIVE_WITHIN_DAYS * 24 * 60 * 60 * 1000);

  // Candidates: old enough accounts with enough posts. Vote counts span two
  // tables, so they're checked after this first cut.
  const candidates = await prisma.user.findMany({
    where: { createdAt: { lte: oldestAllowedCreation } },
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      image: true,
      bio: true,
      createdAt: true,
      _count: { select: { votes: true, posts: true, followers: true, delegationsReceived: true } },
    },
  });

  const withEnoughPosts = candidates.filter((u) => u._count.posts >= R.MIN_POSTS);
  if (withEnoughPosts.length === 0) return [];
  const candidateIds = withEnoughPosts.map((u) => u.id);

  const [refVoteCounts, recentRefVotes, recentPosts, recentVotes, activeDelegations] =
    await Promise.all([
      prisma.governmentReferenceVote.groupBy({
        by: ["userId"],
        where: { userId: { in: candidateIds } },
        _count: true,
      }),
      prisma.governmentReferenceVote.groupBy({
        by: ["userId"],
        where: { userId: { in: candidateIds }, updatedAt: { gte: activityCutoff } },
        _count: true,
      }),
      prisma.post.groupBy({
        by: ["authorId"],
        where: { authorId: { in: candidateIds }, createdAt: { gte: activityCutoff } },
        _count: true,
      }),
      prisma.vote.groupBy({
        by: ["userId"],
        where: { userId: { in: candidateIds }, updatedAt: { gte: activityCutoff } },
        _count: true,
      }),
      prisma.delegation.groupBy({
        by: ["toUserId"],
        where: { toUserId: { in: candidateIds }, isActive: true },
        _count: true,
      }),
    ]);

  const refVotesByUser = new Map(refVoteCounts.map((r) => [r.userId, r._count]));
  const recentlyActive = new Set([
    ...recentRefVotes.map((r) => r.userId),
    ...recentPosts.map((r) => r.authorId),
    ...recentVotes.map((r) => r.userId),
  ]);
  const delegatorsByUser = new Map(activeDelegations.map((d) => [d.toUserId, d._count]));

  const eligible = withEnoughPosts.filter((u) => {
    const totalVotes = u._count.votes + (refVotesByUser.get(u.id) ?? 0);
    return totalVotes >= R.MIN_VOTES && recentlyActive.has(u.id);
  });

  // Expertise tags: the categories of the references each delegate engages with
  const eligibleIds = eligible.map((u) => u.id);
  const categoryRows = eligibleIds.length
    ? await prisma.governmentReferenceVote.findMany({
        where: { userId: { in: eligibleIds } },
        select: {
          userId: true,
          governmentReference: { select: { category: true } },
        },
      })
    : [];
  const categoriesByUser = new Map<string, Map<string, number>>();
  for (const row of categoryRows) {
    const cat = row.governmentReference.category;
    if (!cat) continue;
    const counts = categoriesByUser.get(row.userId) ?? new Map<string, number>();
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
    categoriesByUser.set(row.userId, counts);
  }

  return eligible
    .map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username ?? u.email.split("@")[0] ?? "user",
      image: u.image,
      bio: u.bio,
      delegatorCount: delegatorsByUser.get(u.id) ?? 0,
      totalVotes: u._count.votes + (refVotesByUser.get(u.id) ?? 0),
      totalPosts: u._count.posts,
      followerCount: u._count.followers,
      topCategories: [...(categoriesByUser.get(u.id) ?? new Map<string, number>())]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat),
      memberSince: u.createdAt.toISOString(),
    }))
    .sort((a, b) => b.delegatorCount - a.delegatorCount || b.totalVotes - a.totalVotes)
    .slice(0, limit);
}

/**
 * Weighted tally for one reference: direct votes count 1; each active
 * delegation covering the reference's category adds 1 to the delegate's
 * position, unless the delegator voted directly themselves. When one user
 * delegated to several people, a category-specific delegation beats "all".
 */
export async function computeWeightedTally(
  referenceId: string,
  /**
   * The client to read through. Defaults to the shared one; a merge passes its
   * transaction so the tally is computed from the votes as they will be after
   * the merge commits, not as they were before it started.
   */
  db: Pick<typeof prisma, "governmentReference" | "governmentReferenceVote" | "delegation"> = prisma,
): Promise<{ support: number; oppose: number }> {
  const reference = await db.governmentReference.findUnique({
    where: { id: referenceId },
    select: { category: true },
  });

  const votes = await db.governmentReferenceVote.findMany({
    where: { governmentReferenceId: referenceId },
    select: { userId: true, position: true },
  });

  const positionByVoter = new Map(votes.map((v) => [v.userId, v.position]));
  const voterIds = [...positionByVoter.keys()];

  let support = votes.filter((v) => v.position === "support").length;
  let oppose = votes.filter((v) => v.position === "oppose").length;

  if (voterIds.length > 0) {
    const category = reference?.category ?? null;
    const delegations = await db.delegation.findMany({
      where: {
        toUserId: { in: voterIds },
        isActive: true,
        OR: [{ category: null }, { category: "all" }, ...(category ? [{ category }] : [])],
      },
      select: { fromUserId: true, toUserId: true, category: true },
    });

    // One weighted vote per delegator: specific category beats "all"; and a
    // delegator's own direct vote always overrides their delegate.
    const chosen = new Map<string, { toUserId: string; specific: boolean }>();
    for (const d of delegations) {
      if (positionByVoter.has(d.fromUserId)) continue;
      const specific = d.category !== null && d.category !== "all";
      const existing = chosen.get(d.fromUserId);
      if (!existing || (specific && !existing.specific)) {
        chosen.set(d.fromUserId, { toUserId: d.toUserId, specific });
      }
    }

    for (const { toUserId } of chosen.values()) {
      const position = positionByVoter.get(toUserId);
      if (position === "support") support++;
      else if (position === "oppose") oppose++;
    }
  }

  return { support, oppose };
}

/**
 * Recompute the weighted tally and persist it on the reference row.
 *
 * supportVotes/opposeVotes hold the public tally, and the public tally is now
 * exactly the real weighted count. It used to have a "seed layer" folded in —
 * a few thousand invented supporters per record so a new card would not read
 * 0-0 — which meant every number this platform published was partly fiction.
 * That layer is gone; see the migration that removed it.
 */
export async function applyWeightedTally(
  referenceId: string,
): Promise<{ support: number; oppose: number }> {
  const { support, oppose } = await computeWeightedTally(referenceId);
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { supportVotes: support, opposeVotes: oppose },
  });
  return { support, oppose };
}
