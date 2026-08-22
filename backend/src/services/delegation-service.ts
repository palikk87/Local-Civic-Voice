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
 * How far a lent voice may travel before the chain is abandoned.
 *
 * A chain longer than this is far more likely to be a ring of accounts passing
 * weight around than a citizen who genuinely trusts a friend of a friend of a
 * friend. Hitting the cap drops that delegator rather than guessing, which
 * loses one voice — the alternative is inventing one, and the platform's own
 * rule is that no vote may be fabricated.
 */
export const MAX_DELEGATION_DEPTH = 8;

interface DelegationEdge {
  fromUserId: string;
  toUserId: string;
  category: string | null;
}

/**
 * Pick the single delegation a user's voice follows for one category.
 *
 * A user may lend their voice to several people with different scopes. The
 * most specific scope wins: a delegation for "healthcare" beats a blanket one,
 * because the whole point of scoping is to say "trust them on this, not on
 * everything".
 */
function edgeFor(
  edges: DelegationEdge[] | undefined,
  category: string | null,
): DelegationEdge | null {
  if (!edges || edges.length === 0) return null;
  const applicable = edges.filter(
    (e) => e.category === null || e.category === "all" || e.category === category,
  );
  if (applicable.length === 0) return null;
  const specific = applicable.find((e) => e.category !== null && e.category !== "all");
  return specific ?? applicable[0]!;
}

/**
 * Weighted tally for one reference.
 *
 * DIRECT VOTES COUNT ONCE. Then every citizen who lent their voice and did not
 * vote themselves follows their delegation until it reaches somebody who did
 * vote, and their voice lands on that position.
 *
 * THE VOICE TRAVELS THE WHOLE CHAIN. It used to stop after a single hop: if you
 * delegated to someone who had themselves delegated onward, your voice was
 * dropped on the floor. Nobody was told. The app promises "transparent
 * delegation chains" and counts itself the sole record of the public will, so a
 * silently discarded citizen is the worst failure it has — worse than a wrong
 * number, because a wrong number can be argued with.
 *
 * A voice stops travelling when it reaches someone who voted (it lands there),
 * when the chain runs out (nobody along it voted — it counts for nothing), when
 * it revisits an account (a ring — abandoned), or at MAX_DELEGATION_DEPTH.
 *
 * A DIRECT VOTE ALWAYS WINS. At every step, a citizen who voted for themselves
 * keeps their own voice and passes nothing on. That is the Constitution's
 * "floor, not the ceiling": your delegate speaks for you until you speak.
 */
export async function computeWeightedTally(
  referenceId: string,
  /**
   * The client to read through. Defaults to the shared one; a merge passes its
   * transaction so the tally is computed from the votes as they will be after
   * the merge commits, not as they were before it started.
   */
  db: Pick<typeof prisma, "governmentReference" | "governmentReferenceVote" | "delegation"> = prisma,
  /**
   * Every active delegation, already in memory.
   *
   * Recomputing many records at once — which is what a single revoke does —
   * otherwise re-reads the same delegation rows once per record. Passing them
   * in turns hundreds of identical reads into one.
   */
  preloadedEdges?: DelegationEdge[],
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

  let support = votes.filter((v) => v.position === "support").length;
  let oppose = votes.filter((v) => v.position === "oppose").length;

  if (positionByVoter.size === 0) return { support, oppose };

  const category = reference?.category ?? null;

  // Every active delegation that could carry a voice on this reference. Read in
  // one query and walked in memory: a chain walked with a query per hop is a
  // query per citizen per record, which is the shape that takes a database
  // down on the day something finally goes viral.
  const delegations = preloadedEdges
    ? preloadedEdges.filter(
        (e) => e.category === null || e.category === "all" || e.category === category,
      )
    : await db.delegation.findMany({
        where: {
          isActive: true,
          OR: [{ category: null }, { category: "all" }, ...(category ? [{ category }] : [])],
        },
        select: { fromUserId: true, toUserId: true, category: true },
      });

  const outgoing = new Map<string, DelegationEdge[]>();
  for (const edge of delegations) {
    const list = outgoing.get(edge.fromUserId) ?? [];
    list.push(edge);
    outgoing.set(edge.fromUserId, list);
  }

  for (const delegator of outgoing.keys()) {
    // Spoke for themselves — their voice is already counted above and stays put.
    if (positionByVoter.has(delegator)) continue;

    const seen = new Set<string>([delegator]);
    let current = delegator;
    let landed: string | undefined;

    for (let hop = 0; hop < MAX_DELEGATION_DEPTH; hop += 1) {
      const edge = edgeFor(outgoing.get(current), category);
      if (!edge) break;
      if (seen.has(edge.toUserId)) break;

      seen.add(edge.toUserId);
      current = edge.toUserId;

      const position = positionByVoter.get(current);
      if (position) {
        landed = position;
        break;
      }
    }

    if (landed === "support") support++;
    else if (landed === "oppose") oppose++;
  }

  return { support, oppose };
}

/**
 * The same tally, split into the parts the Bill of Rights says a citizen may
 * see: how many voices spoke for themselves, and how many were carried.
 *
 * Counts only — never who. Article IV of the Bill of Rights promises anonymity,
 * and a list of names alongside positions is exactly what it promises not to
 * publish.
 */
export async function voteBreakdown(referenceId: string): Promise<{
  support: { direct: number; delegated: number; total: number };
  oppose: { direct: number; delegated: number; total: number };
  total: number;
}> {
  const [direct, weighted] = await Promise.all([
    prisma.governmentReferenceVote.groupBy({
      by: ["position"],
      where: { governmentReferenceId: referenceId },
      _count: true,
    }),
    computeWeightedTally(referenceId),
  ]);

  const directBy = new Map(direct.map((row) => [row.position, row._count]));
  const supportDirect = directBy.get("support") ?? 0;
  const opposeDirect = directBy.get("oppose") ?? 0;

  return {
    support: {
      direct: supportDirect,
      delegated: weighted.support - supportDirect,
      total: weighted.support,
    },
    oppose: {
      direct: opposeDirect,
      delegated: weighted.oppose - opposeDirect,
      total: weighted.oppose,
    },
    total: weighted.support + weighted.oppose,
  };
}

/**
 * Recompute the weighted tally and persist it on the reference row.
 *
 * supportVotes/opposeVotes hold the public tally, and the public tally is now
 * exactly the real weighted count. It used to have a "seed layer" folded in —
 * a few thousand invented supporters per record so a new card would not read
 * 0-0 — which meant every number this platform published was partly fiction.
 * That layer is gone; see the migration that removed it.
 *
 * THE ROW IS LOCKED WHILE THIS RUNS, and it has to be. Computing and then
 * writing are two steps, and two of them overlapping is a lost update: the
 * slower request writes a total it worked out before the faster one changed
 * anything, and the wrong number then sits on the card until the next vote
 * happens to correct it.
 *
 * That is not theoretical. The browser system check withdrew a vote and revoked
 * a delegation in quick succession, and the record was left publishing two
 * supporters when one person had voted and nobody had lent a voice — confirmed
 * against the database afterwards. On a record several people are voting on at
 * once, which is every record that matters, the same overlap is ordinary
 * traffic.
 *
 * BE PRECISE ABOUT WHAT IS PROVEN. That fault was seen once and has not
 * recurred, with or without this lock: it is a race, and races do not appear on
 * demand. So the lock is here because the hazard is structural and reading the
 * code shows it, not because a test can summon it. Anyone tempted to remove it
 * for want of a failing test should reproduce the interleaving first.
 *
 * FOR UPDATE makes each recount wait its turn for that one row, so whoever
 * writes last has also read last.
 */
export async function applyWeightedTally(
  referenceId: string,
  preloadedEdges?: DelegationEdge[],
): Promise<{ support: number; oppose: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GovernmentReference" WHERE id = ${referenceId} FOR UPDATE`;

    const { support, oppose } = await computeWeightedTally(referenceId, tx, preloadedEdges);
    await tx.governmentReference.update({
      where: { id: referenceId },
      data: { supportVotes: support, opposeVotes: oppose },
    });
    return { support, oppose };
  });
}

export async function referencesAffectedByDelegation(toUserId: string): Promise<string[]> {
  const reachable = new Set<string>([toUserId]);
  let frontier = [toUserId];

  for (let hop = 0; hop < MAX_DELEGATION_DEPTH && frontier.length > 0; hop += 1) {
    const next = await prisma.delegation.findMany({
      where: { fromUserId: { in: frontier }, isActive: true },
      select: { toUserId: true },
    });
    frontier = next.map((d) => d.toUserId).filter((id) => !reachable.has(id));
    for (const id of frontier) reachable.add(id);
  }

  const votes = await prisma.governmentReferenceVote.findMany({
    where: { userId: { in: [...reachable] } },
    select: { governmentReferenceId: true },
    distinct: ["governmentReferenceId"],
  });

  return votes.map((v) => v.governmentReferenceId);
}

/**
 * Re-publish every tally a delegation change touches, so "instant" is instant.
 *
 * Called on grant and on revoke. It is deliberately awaited rather than queued:
 * a citizen who revokes and immediately looks at the record must see their
 * voice already gone, and a background job makes that a race they would lose
 * often enough to notice.
 */
export async function republishTalliesAfterDelegationChange(toUserId: string): Promise<number> {
  const referenceIds = await referencesAffectedByDelegation(toUserId);
  if (referenceIds.length === 0) return 0;

  const edges = await prisma.delegation.findMany({
    where: { isActive: true },
    select: { fromUserId: true, toUserId: true, category: true },
  });

  for (const referenceId of referenceIds) {
    await applyWeightedTally(referenceId, edges);
  }
  return referenceIds.length;
}

export interface ChainLink {
  id: string;
  name: string;
  username: string | null;
}

/**
 * Where a citizen's voice actually ends up.
 *
 * A voice now travels the whole chain, which means it can land on somebody the
 * citizen never chose and has never heard of. The Bill of Rights promises
 * "transparent delegation chains", and that promise only costs something once
 * the chain is real: before this, a chain stopped after one hop and there was
 * nothing to disclose. Now there is, so it is disclosed.
 *
 * Returns everyone after the person they picked, in order. Empty means the
 * chain ends where they chose — the ordinary case.
 */
export async function resolveDelegationChain(
  startUserId: string,
  category: string | null,
): Promise<ChainLink[]> {
  const chain: ChainLink[] = [];
  const seen = new Set<string>([startUserId]);
  let current = startUserId;

  for (let hop = 0; hop < MAX_DELEGATION_DEPTH; hop += 1) {
    const edges = await prisma.delegation.findMany({
      where: {
        fromUserId: current,
        isActive: true,
        OR: [{ category: null }, { category: "all" }, ...(category ? [{ category }] : [])],
      },
      select: {
        fromUserId: true,
        toUserId: true,
        category: true,
        toUser: { select: { id: true, name: true, username: true } },
      },
    });

    const chosen = edgeFor(edges, category);
    if (!chosen || seen.has(chosen.toUserId)) break;

    const link = edges.find((e) => e.toUserId === chosen.toUserId)!.toUser;
    chain.push({ id: link.id, name: link.name, username: link.username });
    seen.add(chosen.toUserId);
    current = chosen.toUserId;
  }

  return chain;
}

export interface VoiceReceipt {
  referenceId: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  /** The position cast in your name. */
  position: string;
  /** Who actually cast it — not always the person you chose. */
  castBy: { id: string; name: string; username: string | null };
  /** The person you lent it to, if the chain went further than them. */
  lentTo: { id: string; name: string; username: string | null } | null;
  /** Everyone between the person you chose and the person who spoke. */
  through: ChainLink[];
  castAt: string;
}

/**
 * EVERY TIME SOMEBODY ELSE SPOKE IN YOUR NAME.
 *
 * This is the thing liquid democracy is usually missing. Delegation is sold as
 * convenience — lend your vote to somebody who follows this more closely than
 * you do — and then the lending is the last you ever hear of it. You are told a
 * number of delegations you have made, never a list of what was done with them.
 *
 * A voice you cannot audit is a voice you have given away rather than lent, and
 * this platform's own Constitution says political power here is "never won, only
 * borrowed". Borrowed means you get to see the receipts.
 *
 * DERIVED, NOT RECORDED. There is no ledger of delegated votes and there must
 * not be one: a second store of who-spoke-for-whom would drift from the rule
 * that actually produces the tally, and then the receipts would describe a
 * count nobody published. This walks the same chain computeWeightedTally walks,
 * for one person, and reports what it finds. If the tally is right, these are
 * right, because they are the same walk.
 */
export async function voiceReceipts(
  userId: string,
  limit = 50,
): Promise<VoiceReceipt[]> {
  const delegations = await prisma.delegation.findMany({
    where: { fromUserId: userId, isActive: true },
    select: {
      toUserId: true,
      category: true,
      toUser: { select: { id: true, name: true, username: true } },
    },
  });
  if (delegations.length === 0) return [];

  // Records this person has already spoken on themselves. A direct vote always
  // overrides a delegate, so nothing was cast in their name on these.
  const ownVotes = await prisma.governmentReferenceVote.findMany({
    where: { userId },
    select: { governmentReferenceId: true },
  });
  const spokenFor = new Set(ownVotes.map((v) => v.governmentReferenceId));

  // Everyone the chain could reach from each person they lent a voice to.
  const reachable = new Map<string, { root: string; hops: number }>();
  for (const delegation of delegations) {
    let current = delegation.toUserId;
    const seen = new Set<string>([userId, current]);
    reachable.set(current, { root: delegation.toUserId, hops: 0 });

    for (let hop = 1; hop < MAX_DELEGATION_DEPTH; hop += 1) {
      const onward = await prisma.delegation.findMany({
        where: {
          fromUserId: current,
          isActive: true,
          OR: [
            { category: null },
            { category: "all" },
            ...(delegation.category ? [{ category: delegation.category }] : []),
          ],
        },
        select: { fromUserId: true, toUserId: true, category: true },
      });
      const edge = edgeFor(onward, delegation.category ?? null);
      if (!edge || seen.has(edge.toUserId)) break;
      seen.add(edge.toUserId);
      current = edge.toUserId;
      if (!reachable.has(current)) {
        reachable.set(current, { root: delegation.toUserId, hops: hop });
      }
    }
  }

  const speakerIds = [...reachable.keys()];
  const votes = await prisma.governmentReferenceVote.findMany({
    where: { userId: { in: speakerIds }, governmentReferenceId: { notIn: [...spokenFor] } },
    orderBy: { updatedAt: "desc" },
    take: limit * 2,
    select: {
      userId: true,
      position: true,
      updatedAt: true,
      governmentReference: {
        select: { id: true, masterReferenceId: true, title: true, referenceType: true, category: true },
      },
    },
  });

  const speakers = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: speakerIds } },
        select: { id: true, name: true, username: true },
      })
    ).map((u) => [u.id, u]),
  );

  const byDelegate = new Map(delegations.map((d) => [d.toUserId, d]));
  const receipts: VoiceReceipt[] = [];
  const counted = new Set<string>();

  for (const vote of votes) {
    const reference = vote.governmentReference;
    if (counted.has(reference.id)) continue;

    const route = reachable.get(vote.userId);
    if (!route) continue;

    // A category delegation only carries on records in that category.
    const delegation = byDelegate.get(route.root)!;
    const scoped = delegation.category && delegation.category !== "all";
    if (scoped && reference.category !== delegation.category) continue;

    counted.add(reference.id);
    const speaker = speakers.get(vote.userId);
    if (!speaker) continue;

    receipts.push({
      referenceId: reference.id,
      masterReferenceId: reference.masterReferenceId,
      title: reference.title,
      referenceType: reference.referenceType,
      position: vote.position,
      castBy: speaker,
      lentTo: route.hops > 0 ? delegation.toUser : null,
      through:
        route.hops > 0
          ? await resolveDelegationChain(delegation.toUserId, delegation.category ?? null)
          : [],
      castAt: vote.updatedAt.toISOString(),
    });

    if (receipts.length >= limit) break;
  }

  return receipts;
}

/**
 * Everybody whose voice lands on this voter for this record.
 *
 * The reverse of the walk `computeWeightedTally` does. That one starts at a
 * citizen and follows their delegation forward until it reaches somebody who
 * voted; this starts at the person who voted and works backwards to find every
 * citizen the vote was cast for.
 *
 * WHY IT HAS TO BE THE REVERSE OF THE SAME RULE, not an approximation: the
 * people this returns are about to be told "your voice was used". Telling
 * somebody that when it was not, or failing to tell somebody when it was, is
 * worse than saying nothing at all — it makes the receipts a story rather than
 * a record. So it respects the same three things the tally does: the most
 * specific category wins, a direct vote stops the chain dead, and a ring is
 * abandoned rather than followed.
 */
export async function whoseVoiceLandedOn(
  voterId: string,
  referenceId: string,
): Promise<string[]> {
  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { category: true },
  });
  if (!reference) return [];

  const category = reference.category;
  const landed: string[] = [];
  const seen = new Set<string>([voterId]);
  let frontier = [voterId];

  for (let depth = 0; depth < MAX_DELEGATION_DEPTH && frontier.length > 0; depth += 1) {
    const incoming = await prisma.delegation.findMany({
      where: { toUserId: { in: frontier }, isActive: true },
      select: { fromUserId: true },
    });

    const candidates = [...new Set(incoming.map((d) => d.fromUserId))].filter(
      (id) => !seen.has(id),
    );
    if (candidates.length === 0) break;

    // A candidate may have lent their voice to several people with different
    // scopes. Only the edge that actually wins for this record counts, so
    // somebody who delegated healthcare to A and everything else to B is not
    // told their voice was used when B votes on a healthcare bill.
    const theirEdges = await prisma.delegation.findMany({
      where: { fromUserId: { in: candidates }, isActive: true },
      select: { fromUserId: true, toUserId: true, category: true },
    });
    const edgesByUser = new Map<string, DelegationEdge[]>();
    for (const edge of theirEdges) {
      const list = edgesByUser.get(edge.fromUserId) ?? [];
      list.push(edge);
      edgesByUser.set(edge.fromUserId, list);
    }

    const onThisPath = candidates.filter((id) => {
      const winner = edgeFor(edgesByUser.get(id), category);
      return winner !== null && frontier.includes(winner.toUserId);
    });
    if (onThisPath.length === 0) break;

    // A DIRECT VOTE STOPS THE CHAIN DEAD. Somebody who voted for themselves
    // kept their own voice, so nothing was cast in their name — and nobody
    // delegating to them reaches this voter either, because their voice lands
    // on that person instead.
    const spokeForThemselves = new Set(
      (
        await prisma.governmentReferenceVote.findMany({
          where: { governmentReferenceId: referenceId, userId: { in: onThisPath } },
          select: { userId: true },
        })
      ).map((v) => v.userId),
    );

    const carried = onThisPath.filter((id) => !spokeForThemselves.has(id));
    for (const id of onThisPath) seen.add(id);

    landed.push(...carried);
    frontier = carried;
  }

  return landed;
}
