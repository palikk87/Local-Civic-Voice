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
import { hiddenFrom } from "./relationships";
import { publicHandle } from "./public-identity";

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
  /** Bill of Rights Article IV — carried from the vote. */
  isAnonymous?: boolean;
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
        isAnonymous: input.isAnonymous === true,
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
  /** True when this was taken anonymously. Only ever sent to its own author. */
  isAnonymous: boolean;
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
  /**
   * Who is reading. A citizen always sees their own record in full, including
   * the positions they took anonymously — Article IV shields them from other
   * people, not from themselves. Anybody else gets the public record only.
   */
  viewerId?: string | null,
): Promise<{ results: PositionRecord[]; nextCursor: string | null }> {
  const isOwner = viewerId === userId;

  const rows = await prisma.positionEvent.findMany({
    where: { userId, ...(isOwner ? {} : { isAnonymous: false }) },
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
      isAnonymous: row.isAnonymous,
      createdAt: row.createdAt.toISOString(),
      // The text under this position has moved on since it was taken.
      lawMovedSince: row.governmentReference.lawVersion > row.lawVersion,
      reference: row.governmentReference,
    })),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export interface PositionSummary {
  /** Laws they hold a position on right now. Always support + oppose. */
  total: number;
  /** Laws they stand Aye on right now. */
  support: number;
  /** Laws they stand Nay on right now. */
  oppose: number;
  /** Laws they voted on and then withdrew from, leaving no position. */
  withdrawn: number;
  /**
   * How many times they took a different position than they had before.
   * Counted over the whole ledger, not per law — this one is a count of acts.
   */
  changesOfMind: number;
  /** Positions they hold now on a version of a law that has since moved on. */
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
export async function positionSummary(
  userId: string,
  /** Who is reading — see positionHistory. */
  viewerId?: string | null,
): Promise<PositionSummary> {
  const isOwner = viewerId === userId;

  // MUST MATCH WHAT THE LIST SHOWS. A summary counting twelve positions above
  // a list of eight tells a stranger there are four hidden ones and roughly
  // what they were — which is the fact Article IV is protecting.
  const rows = await prisma.positionEvent.findMany({
    where: { userId, ...(isOwner ? {} : { isAnonymous: false }) },
    // Newest first, so the first row seen for a law is where they stand on it.
    // The id breaks a tie when two acts share a timestamp, so the answer is the
    // same every time it is asked.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      governmentReferenceId: true,
      position: true,
      isChange: true,
      lawVersion: true,
      governmentReference: { select: { lawVersion: true } },
    },
  });

  /*
   * ONE LAW, ONE POSITION.
   *
   * Reported plainly: "if I go from aye to nah on something it subtracts from
   * one and ads to the other."
   *
   * The ledger is append-only — every act is kept, because a person having
   * changed their mind is a fact about them and not an embarrassment to be
   * overwritten. Counting those rows, though, counted the same law twice: an
   * Aye you have since abandoned stayed in the Aye column forever, and the
   * total climbed every time somebody reconsidered. Seventeen "positions" on
   * seven laws.
   *
   * So the four counters describe WHERE SOMEBODY STANDS NOW — the latest act
   * on each law, one vote each. Aye plus Nay is the total, and crossing over
   * moves you between the columns instead of adding to both.
   *
   * "Changed my mind" is the one counter that still reads the whole ledger,
   * because it is a count of acts, not of laws — reconsidering twice on the
   * same bill is two changes of mind, and that is the point of showing it.
   */
  // A STRANGER SEES THE LATEST POSITION THEY ARE ALLOWED TO SEE, which is not
  // always the latest one taken — an anonymous vote is filtered out above, so
  // a public Aye followed by an anonymous Nay still reads as Aye to them. That
  // is exactly what the list on the same page already shows, so it reveals
  // nothing new; the alternative, hiding the law entirely, would tell them a
  // hidden position exists. Article IV withholds the vote, not the person.
  const standing = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!standing.has(row.governmentReferenceId)) standing.set(row.governmentReferenceId, row);
  }
  const now = [...standing.values()];
  // Withdrawing leaves you holding no position, so it is not one.
  const held = now.filter((r) => r.position !== "withdrawn");

  return {
    total: held.length,
    support: held.filter((r) => r.position === "support").length,
    oppose: held.filter((r) => r.position === "oppose").length,
    withdrawn: now.filter((r) => r.position === "withdrawn").length,
    changesOfMind: rows.filter((r) => r.isChange).length,
    standingOnOldText: held.filter((r) => r.governmentReference.lawVersion > r.lawVersion).length,
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

export interface StandingEntry {
  reference: {
    id: string;
    masterReferenceId: string;
    title: string;
    referenceType: string;
  };
  yourPosition: string;
  support: number;
  oppose: number;
  /** Share of the Pulse that agrees with them, 0-100. */
  agreementPct: number;
  withMajority: boolean;
}

export interface Standing {
  /** Records where enough people have spoken for "majority" to mean anything. */
  measured: number;
  withMajority: number;
  inMinority: number;
  /** The ones where they are most alone. */
  mostAlone: StandingEntry[];
}

/**
 * Where this person stands relative to everyone else.
 *
 * A CIVIC MIRROR, NOT A SCORE. It would be easy to make this flattering — a
 * percentage that goes up, a badge for agreeing with people. That is what an
 * engagement product would build, and it would teach exactly the wrong lesson:
 * that being with the majority is the goal.
 *
 * So the useful half is the uncomfortable half. It surfaces the records where
 * somebody is most alone, because those are the positions worth knowing you
 * hold — the ones where you should either find the argument for the other side
 * or be certain of your own. The count of agreements is there for context and
 * is not the point.
 *
 * MEASURED AGAINST DIRECT VOTES ONLY, deliberately. The published tally folds
 * in delegated weight, which means one well-followed delegate can swing what
 * "the majority" appears to be. For a mirror held up to one person, the honest
 * comparison is against other people who spoke for themselves.
 */
export async function standing(userId: string, minimumVoices = 3): Promise<Standing> {
  const mine = await prisma.governmentReferenceVote.findMany({
    where: { userId, position: { in: ["support", "oppose"] } },
    select: {
      position: true,
      governmentReference: {
        select: { id: true, masterReferenceId: true, title: true, referenceType: true },
      },
    },
  });
  if (mine.length === 0) {
    return { measured: 0, withMajority: 0, inMinority: 0, mostAlone: [] };
  }

  const referenceIds = mine.map((v) => v.governmentReference.id);
  const grouped = await prisma.governmentReferenceVote.groupBy({
    by: ["governmentReferenceId", "position"],
    where: { governmentReferenceId: { in: referenceIds } },
    _count: true,
  });

  const counts = new Map<string, { support: number; oppose: number }>();
  for (const row of grouped) {
    const entry = counts.get(row.governmentReferenceId) ?? { support: 0, oppose: 0 };
    if (row.position === "support") entry.support = row._count;
    else if (row.position === "oppose") entry.oppose = row._count;
    counts.set(row.governmentReferenceId, entry);
  }

  const entries: StandingEntry[] = [];
  for (const vote of mine) {
    const tally = counts.get(vote.governmentReference.id);
    if (!tally) continue;

    const total = tally.support + tally.oppose;
    // Below the threshold "the majority" is one or two people, and telling
    // somebody they are in a minority of three is noise dressed as insight.
    if (total < minimumVoices) continue;

    const agreeing = vote.position === "support" ? tally.support : tally.oppose;
    const agreementPct = Math.round((agreeing / total) * 100);

    entries.push({
      reference: vote.governmentReference,
      yourPosition: vote.position,
      support: tally.support,
      oppose: tally.oppose,
      agreementPct,
      withMajority: agreeing * 2 > total,
    });
  }

  return {
    measured: entries.length,
    withMajority: entries.filter((e) => e.withMajority).length,
    inMinority: entries.filter((e) => !e.withMajority).length,
    mostAlone: entries
      .filter((e) => !e.withMajority)
      .sort((a, b) => a.agreementPct - b.agreementPct)
      .slice(0, 10),
  };
}

export interface TurningPoint {
  id: string;
  user: { id: string; displayName: string; username: string; avatar: string };
  from: "support" | "oppose";
  to: "support" | "oppose";
  reason: string | null;
  /** The version of the text they were reading when they moved. */
  lawVersion: number;
  /** True when the government had changed the text between their two positions. */
  afterTextChanged: boolean;
  createdAt: string;
}

export interface TurningPoints {
  results: TurningPoint[];
  /** Every recorded crossing on this record, not just the page above. */
  toSupport: number;
  toOppose: number;
  total: number;
  /** People, not crossings — somebody who moved twice is one person. */
  people: number;
  /** Crossings that followed a change in the text of the law. */
  afterTextChanged: number;
}

/**
 * Who changed their mind on this law, which way, and what they said about it.
 *
 * NO OTHER PLATFORM CAN SHOW THIS, and most are built so it can never be
 * shown. Elsewhere a change of mind is a liability: the old post is still
 * there, screenshot-ready, and the safe move is to never say anything you
 * might have to walk back. The incentive that produces is the one everybody
 * complains about — people defending a position long after they stopped
 * believing it, because moving costs more than being wrong.
 *
 * This platform can invert that, because a position here is attached to a
 * government record and the record knows when its own text changed. So a
 * crossing is not a gotcha, it is evidence: the bill was amended and some
 * number of people read the new text and moved. That is the single most
 * useful thing a citizen can know about a contested bill, and it is invisible
 * everywhere else.
 *
 * Public, like the positions themselves. Filtered only for the people the
 * reader has blocked or muted.
 */
export async function turningPoints(
  referenceId: string,
  viewerId: string | null | undefined,
  limit = 10,
): Promise<TurningPoints> {
  const hidden = await hiddenFrom(viewerId);

  // EVERY crossing, anonymous ones included. Article IV withholds the person,
  // never the movement: filtering anonymous crossings out of the counts would
  // let anonymity quietly change the published picture of how opinion moved on
  // a bill, which is the opposite of what the article promises. The names are
  // withheld a few lines down, when the page is built.
  const crossings = await prisma.positionEvent.findMany({
    where: {
      governmentReferenceId: referenceId,
      isChange: true,
      ...(hidden.length > 0 ? { userId: { notIn: hidden } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      position: true,
      reason: true,
      lawVersion: true,
      createdAt: true,
      isAnonymous: true,
    },
  });

  if (crossings.length === 0) {
    return { results: [], toSupport: 0, toOppose: 0, total: 0, people: 0, afterTextChanged: 0 };
  }

  // Only the crossings that can carry a name reach the page. An anonymous one
  // is counted in every total above and shown to nobody.
  const page = crossings.filter((row) => !row.isAnonymous).slice(0, limit);
  const everyMover = [...new Set(crossings.map((row) => row.userId))];
  const pageUserIds = [...new Set(page.map((row) => row.userId))];

  // THE PREVIOUS SIDE'S VERSION, not this one's. "They moved after the text
  // changed" is a claim about the gap between two positions, and the event
  // alone cannot answer it — an event on version 3 says nothing about whether
  // the person's earlier position was also taken on version 3.
  const [priorEvents, users] = await Promise.all([
    prisma.positionEvent.findMany({
      where: {
        governmentReferenceId: referenceId,
        userId: { in: everyMover },
        position: { in: ["support", "oppose"] },
      },
      orderBy: { createdAt: "asc" },
      select: { userId: true, lawVersion: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { id: { in: pageUserIds } },
      select: { id: true, name: true, username: true, displayUsername: true, image: true },
    }),
  ]);

  const byUser = new Map<
    string,
    { id: string; name: string; username: string | null; displayUsername: string | null; image: string | null }
  >(
    users.map((u) => [u.id, u]),
  );

  function versionBefore(userId: string, at: Date): number | null {
    let found: number | null = null;
    for (const event of priorEvents) {
      if (event.userId !== userId) continue;
      if (event.createdAt >= at) break;
      found = event.lawVersion;
    }
    return found;
  }

  const results: TurningPoint[] = [];
  for (const row of page) {
    const user = byUser.get(row.userId);
    if (!user) continue; // Account deleted between the two queries.

    const to = row.position === "support" ? "support" : "oppose";
    const previousVersion = versionBefore(row.userId, row.createdAt);

    results.push({
      id: row.id,
      user: {
        id: user.id,
        displayName: user.name,
        username: publicHandle(user),
        avatar: user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
      },
      // A crossing is binary and isChange is only ever set on one, so the side
      // they left is the side they did not land on.
      from: to === "support" ? "oppose" : "support",
      to,
      reason: row.reason,
      lawVersion: row.lawVersion,
      afterTextChanged: previousVersion !== null && row.lawVersion > previousVersion,
      createdAt: row.createdAt.toISOString(),
    });
  }

  // Counted over every crossing, so the headline does not change when
  // somebody asks for a shorter page.
  const afterTextChangedTotal = crossings.filter(
    (row) => {
      const previous = versionBefore(row.userId, row.createdAt);
      return previous !== null && row.lawVersion > previous;
    },
  ).length;

  return {
    results,
    toSupport: crossings.filter((r) => r.position === "support").length,
    toOppose: crossings.filter((r) => r.position === "oppose").length,
    total: crossings.length,
    people: new Set(crossings.map((r) => r.userId)).size,
    afterTextChanged: afterTextChangedTotal,
  };
}
