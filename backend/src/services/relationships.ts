/**
 * Who can see whom, and who can reach whom.
 *
 * ONE PLACE, ON PURPOSE. Blocking is only as good as its least careful query:
 * a platform can hide a blocked person from the feed and still surface them in
 * search, in a comment thread, in the followers list, or in a notification —
 * and every one of those is the same failure to the person who blocked them.
 * Scattering the rule guarantees one of those gets missed, so the rule lives
 * here and callers ask.
 *
 * BLOCK AND MUTE ARE DIFFERENT THINGS.
 *
 *   A block is about contact. It works in both directions whoever pressed it:
 *   neither person sees the other's posts or comments, neither can follow,
 *   message, or reply to the other. Existing follows are severed, because a
 *   block that leaves a follow in place is not a block.
 *
 *   A mute is about attention. Their posts leave your feed and nothing else
 *   changes — they can still follow you, message you, and reply to you, and
 *   they are never told. It is the option for somebody you do not want to read
 *   but do not want to make a decision about.
 *
 * NOBODY IS TOLD THEY WERE BLOCKED. No response says so, and a blocked person's
 * request to reach the blocker fails the way it would if the blocker had never
 * existed. Telling them is an invitation to open a second account, and the
 * point of a block is that contact stops.
 */

import { prisma } from "../prisma";
import { republishTalliesAfterDelegationChange } from "./delegation-service";

/** Everyone this person cannot see and cannot be seen by. */
export async function blockedBothWays(userId: string): Promise<string[]> {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });

  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.blockerId === userId ? row.blockedId : row.blockerId);
  }
  return [...ids];
}

/** Everyone this person has muted. One-directional, unlike a block. */
export async function mutedBy(userId: string): Promise<string[]> {
  const rows = await prisma.mute.findMany({
    where: { muterId: userId },
    select: { mutedId: true },
  });
  return rows.map((row) => row.mutedId);
}

/**
 * Everyone whose content should not appear in this person's feeds and lists:
 * blocks in both directions, plus their own mutes.
 *
 * Returns an empty array for a signed-out reader, who has blocked nobody and
 * is hiding from nobody.
 */
export async function hiddenFrom(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const [blocked, muted] = await Promise.all([blockedBothWays(userId), mutedBy(userId)]);
  return [...new Set([...blocked, ...muted])];
}

/**
 * A Prisma `where` fragment that drops hidden authors from a list of posts.
 *
 * Returns `{}` when there is nothing to hide, so callers can spread it
 * unconditionally without building two versions of every query.
 */
export function excludeAuthors(ids: string[]): { authorId?: { notIn: string[] } } {
  return ids.length > 0 ? { authorId: { notIn: ids } } : {};
}

/** Is either of these two blocking the other? */
export async function blockExistsBetween(a: string, b: string): Promise<boolean> {
  const found = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Block someone, and clear what a block should clear.
 *
 * Follows go in both directions: leaving one in place would keep their posts in
 * a feed built from follows, and keep the blocker in a follower count the
 * blocked person can read. Done in one transaction so a block never half-exists.
 */
export async function block(blockerId: string, blockedId: string): Promise<void> {
  // Which delegates were being lent a voice through a link this block breaks.
  // Collected before the delete, republished after — a severed delegation moves
  // published tallies exactly as a revoke does, and "instantly, without delay"
  // is the same promise whichever way the delegation ended.
  const severed = await prisma.delegation.findMany({
    where: {
      isActive: true,
      OR: [
        { fromUserId: blockerId, toUserId: blockedId },
        { fromUserId: blockedId, toUserId: blockerId },
      ],
    },
    select: { toUserId: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });

    await tx.follow.deleteMany({
      where: {
        OR: [
          { followerId: blockerId, followingId: blockedId },
          { followerId: blockedId, followingId: blockerId },
        ],
      },
    });

    // A delegation is a loan of political voice. Nobody should be lending it to
    // somebody they have just refused to deal with, in either direction.
    await tx.delegation.deleteMany({
      where: {
        OR: [
          { fromUserId: blockerId, toUserId: blockedId },
          { fromUserId: blockedId, toUserId: blockerId },
        ],
      },
    });
  });

  for (const toUserId of new Set(severed.map((d) => d.toUserId))) {
    await republishTalliesAfterDelegationChange(toUserId);
  }
}
