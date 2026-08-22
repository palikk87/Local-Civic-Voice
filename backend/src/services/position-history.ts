/**
 * Where a citizen stood, and when, and on which version of the law.
 *
 * THE PLATFORM COULD NOT ANSWER THIS ABOUT ITS OWN USERS. One row per person
 * per record, overwritten on a change of mind: the right shape for a tally and
 * the wrong shape for a person. It meant the Pulse knew everything and the
 * citizen knew nothing — not what they had said, not when, not whether the text
 * had moved since.
 *
 * For a platform whose whole claim is that a public position should be
 * traceable to an official source, having no traceable record of the public's
 * own positions was the gap sitting closest to the premise.
 */

import { prisma } from "../prisma";

export type Position = "support" | "oppose" | "withdrawn";

/**
 * Record a position at the moment it is taken.
 *
 * Never throws into the caller. A vote is the thing the person did and it must
 * not fail because the history did — the tally is the product, this is the
 * memory of it.
 */
export async function recordPosition(input: {
  userId: string;
  referenceId: string;
  position: Position;
  reason?: string | null;
}): Promise<void> {
  try {
    const [reference, previous] = await Promise.all([
      prisma.governmentReference.findUnique({
        where: { id: input.referenceId },
        select: { lawVersion: true },
      }),
      // The last side they actually took. Withdrawing is recorded as its own
      // act but is not a side, so support -> withdrawn -> support is somebody
      // who ended where they started rather than somebody who changed their
      // mind twice.
      prisma.positionEvent.findFirst({
        where: {
          userId: input.userId,
          governmentReferenceId: input.referenceId,
          position: { in: ["support", "oppose"] },
        },
        orderBy: { createdAt: "desc" },
        select: { position: true },
      }),
    ]);

    await prisma.positionEvent.create({
      data: {
        userId: input.userId,
        governmentReferenceId: input.referenceId,
        position: input.position,
        lawVersion: reference?.lawVersion ?? 1,
        reason: input.reason?.trim() || null,
        // A CHANGE OF MIND IS CROSSING SIDES, and nothing else.
        //
        // Not a first position, not voting the same way twice, and not
        // withdrawing — a withdrawal is its own act and is counted as one.
        // Re-casting the same side after withdrawing is a person returning to
        // where they were, which is the opposite of a change of mind and would
        // be a strange thing to put on their record as one.
        isChange:
          previous !== null &&
          input.position !== "withdrawn" &&
          previous.position !== input.position,
      },
    });
  } catch (error) {
    console.error("[Positions] could not record", input.referenceId, error);
  }
}

export interface PositionRecord {
  id: string;
  position: string;
  reason: string | null;
  isChange: boolean;
  lawVersion: number;
  createdAt: string;
  /** True when the law has moved since this position was taken. */
  lawMovedSince: boolean;
  reference: {
    id: string;
    masterReferenceId: string;
    title: string;
    referenceType: string;
    lawVersion: number;
  };
}

/**
 * One citizen's record, newest first.
 *
 * Public on purpose. This platform asks people to take public positions on
 * public business, and a position you can take back invisibly is not a public
 * position — it is a poll answer. The Bill of Rights promises anonymity for
 * personal data, not for what somebody chose to say about a law in public.
 */
export async function positionHistory(
  userId: string,
  limit = 50,
  cursor?: string,
): Promise<{ results: PositionRecord[]; nextCursor: string | null }> {
  const rows = await prisma.positionEvent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      governmentReference: {
        select: {
          id: true,
          masterReferenceId: true,
          title: true,
          referenceType: true,
          lawVersion: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, -1) : rows;

  return {
    results: page.map((row) => ({
      id: row.id,
      position: row.position,
      reason: row.reason,
      isChange: row.isChange,
      lawVersion: row.lawVersion,
      createdAt: row.createdAt.toISOString(),
      // The text under this position has moved on since it was taken.
      lawMovedSince: row.governmentReference.lawVersion > row.lawVersion,
      reference: row.governmentReference,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export interface PositionSummary {
  total: number;
  support: number;
  oppose: number;
  withdrawn: number;
  /** How many times they took a different position than they had before. */
  changesOfMind: number;
  /** Positions taken on a version of a law that has since moved on. */
  standingOnOldText: number;
}

/**
 * The shape of somebody's record, for a profile.
 *
 * `changesOfMind` counts the times somebody crossed from one side to the other,
 * and is deliberately shown rather than buried. Every other platform treats a
 * changed position as a liability to be screenshotted; on a platform about
 * legislation, where the text genuinely changes underneath people,
 * reconsidering is the correct response to new information — and hiding it is
 * what produces a public that cannot admit error.
 */
export async function positionSummary(userId: string): Promise<PositionSummary> {
  const rows = await prisma.positionEvent.findMany({
    where: { userId },
    select: {
      position: true,
      isChange: true,
      lawVersion: true,
      governmentReference: { select: { lawVersion: true } },
    },
  });

  return {
    total: rows.length,
    support: rows.filter((r) => r.position === "support").length,
    oppose: rows.filter((r) => r.position === "oppose").length,
    withdrawn: rows.filter((r) => r.position === "withdrawn").length,
    changesOfMind: rows.filter((r) => r.isChange).length,
    standingOnOldText: rows.filter((r) => r.governmentReference.lawVersion > r.lawVersion).length,
  };
}

/**
 * Positions this person took on a version of a law that has since changed.
 *
 * The prompt this feeds is the point: "you backed this in March; it has been
 * amended twice since. Still with it?" A platform that publishes a tally built
 * from positions taken on text that no longer exists is publishing a number
 * about nothing, and the person who took the position is the only one who can
 * fix that.
 */
export async function positionsNeedingReview(userId: string, limit = 20) {
  const rows = await prisma.positionEvent.findMany({
    where: { userId, position: { not: "withdrawn" } },
    orderBy: { createdAt: "desc" },
    include: {
      governmentReference: {
        select: {
          id: true,
          masterReferenceId: true,
          title: true,
          referenceType: true,
          lawVersion: true,
          lawChangedAt: true,
        },
      },
    },
  });

  // Only the latest position per record counts — an older one that was already
  // replaced is history, not something to be asked about again.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.governmentReferenceId)) latest.set(row.governmentReferenceId, row);
  }

  return [...latest.values()]
    .filter((row) => row.governmentReference.lawVersion > row.lawVersion)
    .slice(0, limit)
    .map((row) => ({
      position: row.position,
      takenAt: row.createdAt.toISOString(),
      takenOnVersion: row.lawVersion,
      nowAtVersion: row.governmentReference.lawVersion,
      lawChangedAt: row.governmentReference.lawChangedAt?.toISOString() ?? null,
      reference: {
        id: row.governmentReference.id,
        masterReferenceId: row.governmentReference.masterReferenceId,
        title: row.governmentReference.title,
        referenceType: row.governmentReference.referenceType,
      },
    }));
}

export interface PulsePoint {
  /** Day, as an ISO date. */
  date: string;
  support: number;
  oppose: number;
  /** True when the law's text changed on this day. */
  lawChanged: boolean;
}

/**
 * How opinion on one record moved, day by day.
 *
 * ONLY POSSIBLE BECAUSE THE LEDGER EXISTS. The vote table holds one row per
 * person, overwritten — from it you can compute today's Pulse and nothing else.
 * The question everybody actually asks about a contested bill is when opinion
 * turned and what turned it, and that was unanswerable here until positions
 * started being kept as events rather than as a current state.
 *
 * Marked with the day the text changed, because on this platform that is
 * usually the answer. A bill is amended and support moves; a line about it in
 * the news does not show up in the data, but the amendment does, and it is the
 * thing that actually changed what people were agreeing to.
 *
 * BUILT FROM WHAT PEOPLE DID, not from a model. Each day carries the running
 * total of positions held at the end of it — a person who backed a bill in
 * March and never revisited it is still counted in April, because they are.
 */
export async function pulseOverTime(referenceId: string): Promise<PulsePoint[]> {
  const [events, reference] = await Promise.all([
    prisma.positionEvent.findMany({
      where: { governmentReferenceId: referenceId },
      orderBy: { createdAt: "asc" },
      select: { userId: true, position: true, createdAt: true },
    }),
    prisma.governmentReference.findUnique({
      where: { id: referenceId },
      select: { lawChangedAt: true },
    }),
  ]);

  if (events.length === 0) return [];

  const changedOn = reference?.lawChangedAt
    ? reference.lawChangedAt.toISOString().slice(0, 10)
    : null;

  // Walk forward, keeping each person's current position. A day's numbers are
  // the state at the end of that day, so a person who has not revisited a
  // position still holds it.
  const held = new Map<string, string>();
  const byDay = new Map<string, { support: number; oppose: number }>();

  for (const event of events) {
    if (event.position === "withdrawn") held.delete(event.userId);
    else held.set(event.userId, event.position);

    const day = event.createdAt.toISOString().slice(0, 10);
    let support = 0;
    let oppose = 0;
    for (const position of held.values()) {
      if (position === "support") support += 1;
      else if (position === "oppose") oppose += 1;
    }
    byDay.set(day, { support, oppose });
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts, lawChanged: date === changedOn }));
}
