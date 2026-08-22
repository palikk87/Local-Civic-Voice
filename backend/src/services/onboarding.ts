/**
 * The first five minutes: start from where you stand, not from who is popular.
 *
 * WHY NOT THE USUAL ONBOARDING. Every social platform opens by asking a new
 * arrival to pick five accounts to follow, ranked by size. That single screen
 * does most of the damage everybody complains about later: it sorts a person
 * into a camp before they have said anything, it rewards the accounts that are
 * already loudest, and the feed it produces is a prediction about who they are
 * rather than a record of what they think.
 *
 * This platform can open the other way round, because it has something no feed
 * has: a set of public records with public positions on them. So the first
 * thing a new citizen does is take positions — and only then are they shown
 * people, chosen by whether they actually agreed, in both directions.
 *
 * NOTHING HERE IS INVENTED. If there are not enough records to ask about, or
 * not enough people who have voted on the same ones, the answer is a short
 * list or an empty one. There is no filler.
 */

import { prisma } from "../prisma";
import { alignmentWith } from "./common-ground";
import { hiddenFrom } from "./relationships";

export interface StarterRecord {
  id: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  category: string | null;
  status: string;
  support: number;
  oppose: number;
  /** How evenly the room is split, 0..1 — 1 means dead even. */
  contested: number;
}

/**
 * Records worth asking a newcomer about.
 *
 * THE MOST CONTESTED ONES, not the most popular. A record where 97% agree
 * teaches a new arrival nothing about themselves and nothing about anybody
 * else; a record the room is split on places them straight away. Ties broken
 * by how many people have voted, so a 1-1 split does not outrank a 400-380.
 *
 * Anything they have already taken a position on is skipped, so this can be
 * called again without asking the same question twice.
 */
export async function starterRecords(
  userId: string | null,
  limit = 5,
  minimumVoices = 4,
): Promise<StarterRecord[]> {
  const alreadyVoted = userId
    ? (
        await prisma.governmentReferenceVote.findMany({
          where: { userId },
          select: { governmentReferenceId: true },
        })
      ).map((v) => v.governmentReferenceId)
    : [];

  const grouped = await prisma.governmentReferenceVote.groupBy({
    by: ["governmentReferenceId", "position"],
    where: {
      position: { in: ["support", "oppose"] },
      ...(alreadyVoted.length > 0 ? { governmentReferenceId: { notIn: alreadyVoted } } : {}),
    },
    _count: true,
  });

  const counts = new Map<string, { support: number; oppose: number }>();
  for (const row of grouped) {
    const entry = counts.get(row.governmentReferenceId) ?? { support: 0, oppose: 0 };
    if (row.position === "support") entry.support = row._count;
    else entry.oppose = row._count;
    counts.set(row.governmentReferenceId, entry);
  }

  const ranked = [...counts.entries()]
    .map(([id, tally]) => {
      const total = tally.support + tally.oppose;
      const smaller = Math.min(tally.support, tally.oppose);
      return { id, ...tally, total, contested: total > 0 ? (smaller * 2) / total : 0 };
    })
    .filter((row) => row.total >= minimumVoices)
    .sort((a, b) => b.contested - a.contested || b.total - a.total)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  const references = await prisma.governmentReference.findMany({
    where: { id: { in: ranked.map((r) => r.id) }, mergedIntoId: null },
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
      referenceType: true,
      category: true,
      status: true,
    },
  });
  const byId = new Map(references.map((r) => [r.id, r]));

  return ranked
    .map((row) => {
      const reference = byId.get(row.id);
      if (!reference) return null;
      return {
        ...reference,
        support: row.support,
        oppose: row.oppose,
        contested: Math.round(row.contested * 100) / 100,
      };
    })
    .filter((row): row is StarterRecord => row !== null);
}

export interface Neighbour {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
  bio: string | null;
  shared: number;
  agreed: number;
  disagreed: number;
  agreementPct: number | null;
}

export interface Neighbours {
  /** Records the reader has taken a position on. */
  positions: number;
  /** How many more are needed before this can say anything. */
  needed: number;
  agree: Neighbour[];
  disagree: Neighbour[];
}

/**
 * The people whose record most resembles the reader's, and the people whose
 * record least resembles it.
 *
 * BOTH LISTS, ALWAYS, and neither is a recommendation. Offering only the
 * agreements would build the echo chamber on the first screen — which is
 * precisely what a follow-the-popular-accounts onboarding does by accident.
 * Offering only the disagreements would be a fight. A new citizen gets both
 * and decides.
 *
 * A minimum of three positions before this returns anybody. Two shared votes
 * is a coincidence, and introducing somebody as "your closest match" off a
 * coincidence is the kind of confident nonsense this platform exists to avoid.
 */
export async function neighbours(
  userId: string,
  minimumPositions = 3,
  limit = 5,
): Promise<Neighbours> {
  const mine = await prisma.governmentReferenceVote.findMany({
    where: { userId, position: { in: ["support", "oppose"] } },
    select: { governmentReferenceId: true },
  });

  if (mine.length < minimumPositions) {
    return {
      positions: mine.length,
      needed: minimumPositions - mine.length,
      agree: [],
      disagree: [],
    };
  }

  const referenceIds = mine.map((v) => v.governmentReferenceId);

  // Everybody who has voted on any of the same records. Scoped to the reader's
  // own records so this stays one indexed query however large the platform is.
  const others = await prisma.governmentReferenceVote.findMany({
    where: {
      governmentReferenceId: { in: referenceIds },
      userId: { not: userId },
      position: { in: ["support", "oppose"] },
    },
    select: { userId: true },
  });

  const hidden = await hiddenFrom(userId);
  const alreadyFollowing = (
    await prisma.follow.findMany({ where: { followerId: userId }, select: { followingId: true } })
  ).map((f) => f.followingId);

  const skip = new Set([...hidden, ...alreadyFollowing, userId]);
  const candidates = [...new Set(others.map((v) => v.userId))].filter((id) => !skip.has(id));
  if (candidates.length === 0) {
    return { positions: mine.length, needed: 0, agree: [], disagree: [] };
  }

  const alignment = await alignmentWith(userId, candidates, minimumPositions);
  const measurable = alignment.filter((row) => row.agreementPct !== null);
  if (measurable.length === 0) {
    return { positions: mine.length, needed: 0, agree: [], disagree: [] };
  }

  const people = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: measurable.map((row) => row.userId) } },
        select: { id: true, name: true, username: true, image: true, bio: true },
      })
    ).map((u) => [u.id, u]),
  );

  const describe = (row: (typeof measurable)[number]): Neighbour | null => {
    const person = people.get(row.userId);
    if (!person) return null;
    return { ...person, shared: row.shared, agreed: row.agreed, disagreed: row.disagreed, agreementPct: row.agreementPct };
  };

  // Sorted once, taken from both ends, and never overlapping. Where only four
  // people qualify, two land in each list rather than all four appearing twice
  // as somebody's closest match AND their furthest.
  const byAgreement = [...measurable].sort(
    (a, b) => (b.agreementPct ?? 0) - (a.agreementPct ?? 0) || b.shared - a.shared,
  );
  const half = Math.min(limit, Math.floor(byAgreement.length / 2) || byAgreement.length);

  const agree = byAgreement
    .slice(0, half)
    .map(describe)
    .filter((row): row is Neighbour => row !== null);

  const disagree = byAgreement
    .slice(Math.max(half, byAgreement.length - limit))
    .reverse()
    .map(describe)
    .filter((row): row is Neighbour => row !== null);

  return { positions: mine.length, needed: 0, agree, disagree };
}
