/**
 * Where two citizens actually agree, and where they do not.
 *
 * WHY THIS IS NOT A COMPATIBILITY SCORE. Every platform that has tried to tell
 * you about another person has done it by inferring: what they clicked, who
 * they follow, what a model thinks they are like. The output is a similarity
 * number, and a similarity number sorts people into groups — which is the
 * mechanism everybody blames for the state of political conversation online.
 *
 * This does not infer anything. Both people took public positions on the same
 * government records, and the overlap is a matter of record. So the honest
 * shape is not "you are 78% alike", it is "you have both taken a position on
 * fourteen records; here are the nine you agree on and the five you do not".
 *
 * THE DISAGREEMENTS ARE RETURNED ALONGSIDE THE AGREEMENTS, ALWAYS. A version
 * of this that surfaced only common ground would be a matchmaker for the echo
 * chamber: it would introduce people to the parts of a stranger they already
 * like and hide the rest. The whole value of a shared record is being able to
 * see that somebody you disagree with about immigration is with you on
 * insulin — and that requires showing both.
 *
 * Direct positions only. Delegated weight is somebody else's judgement being
 * counted, and "we agree" should mean the two of them agreed.
 */

import { prisma } from "../prisma";

export interface SharedPosition {
  reference: { id: string; masterReferenceId: string; title: string; referenceType: string };
  yourPosition: string;
  theirPosition: string;
}

export interface CommonGround {
  /** Records both people have taken a position on. */
  shared: number;
  agreed: number;
  disagreed: number;
  agreements: SharedPosition[];
  disagreements: SharedPosition[];
}

export async function commonGround(
  viewerId: string,
  otherId: string,
  limit = 5,
): Promise<CommonGround> {
  if (viewerId === otherId) {
    return { shared: 0, agreed: 0, disagreed: 0, agreements: [], disagreements: [] };
  }

  const mine = await prisma.governmentReferenceVote.findMany({
    where: { userId: viewerId, position: { in: ["support", "oppose"] } },
    select: { governmentReferenceId: true, position: true },
  });
  if (mine.length === 0) {
    return { shared: 0, agreed: 0, disagreed: 0, agreements: [], disagreements: [] };
  }

  const mineByReference = new Map(mine.map((v) => [v.governmentReferenceId, v.position]));

  // Scoped to the records the viewer has touched, so this stays one query
  // against an indexed column however many records the other person has voted
  // on. The overlap is what is being asked about; the rest is not.
  // ARTICLE IV. Their anonymous positions are not theirs to be told about:
  // this names a specific person's side on a specific bill to somebody else,
  // which is exactly what the anonymous option exists to prevent. The reader's
  // OWN anonymous votes still count on their side of the comparison — hiding a
  // position from the person who took it protects nobody.
  const theirs = await prisma.governmentReferenceVote.findMany({
    where: {
      userId: otherId,
      position: { in: ["support", "oppose"] },
      isAnonymous: false,
      governmentReferenceId: { in: [...mineByReference.keys()] },
    },
    select: {
      position: true,
      governmentReference: {
        select: { id: true, masterReferenceId: true, title: true, referenceType: true },
      },
    },
  });

  const agreements: SharedPosition[] = [];
  const disagreements: SharedPosition[] = [];

  for (const vote of theirs) {
    const yourPosition = mineByReference.get(vote.governmentReference.id);
    if (!yourPosition) continue;

    const entry: SharedPosition = {
      reference: vote.governmentReference,
      yourPosition,
      theirPosition: vote.position,
    };
    (yourPosition === vote.position ? agreements : disagreements).push(entry);
  }

  return {
    shared: agreements.length + disagreements.length,
    agreed: agreements.length,
    disagreed: disagreements.length,
    agreements: agreements.slice(0, limit),
    disagreements: disagreements.slice(0, limit),
  };
}

export interface Alignment {
  userId: string;
  /** Records both people have taken a position on. */
  shared: number;
  agreed: number;
  disagreed: number;
  /** Null below the threshold: a percentage from two records is noise. */
  agreementPct: number | null;
}

/**
 * How often each of these people has agreed with the reader, on the records
 * where both of them actually voted.
 *
 * THIS IS THE NUMBER LIQUID DEMOCRACY HAS ALWAYS NEEDED AND NEVER HAD. Every
 * delegation UI ever built asks somebody to hand their vote to a stranger on
 * the strength of a follower count, a bio, and a category label. None of them
 * can answer the only question that matters — "when I have had an opinion, has
 * this person shared it?" — because none of them have a shared record to
 * measure against. This platform does.
 *
 * Batched deliberately. A delegates directory rendering this per card would
 * otherwise fire one query per delegate on every scroll.
 *
 * Direct votes only, both sides. Counting delegated weight would mean a
 * delegate could look aligned with somebody purely because a third party's
 * chain happened to route through them.
 */
export async function alignmentWith(
  viewerId: string,
  otherIds: string[],
  minimumShared = 3,
): Promise<Alignment[]> {
  const targets = [...new Set(otherIds)].filter((id) => id !== viewerId);
  if (targets.length === 0) return [];

  const mine = await prisma.governmentReferenceVote.findMany({
    where: { userId: viewerId, position: { in: ["support", "oppose"] } },
    select: { governmentReferenceId: true, position: true },
  });
  if (mine.length === 0) {
    return targets.map((userId) => ({
      userId,
      shared: 0,
      agreed: 0,
      disagreed: 0,
      agreementPct: null,
    }));
  }

  const mineByReference = new Map(mine.map((v) => [v.governmentReferenceId, v.position]));

  // Article IV again: an alignment number is a claim about how a named person
  // voted, so it can only be built from the positions they put their name to.
  const theirs = await prisma.governmentReferenceVote.findMany({
    where: {
      userId: { in: targets },
      position: { in: ["support", "oppose"] },
      isAnonymous: false,
      governmentReferenceId: { in: [...mineByReference.keys()] },
    },
    select: { userId: true, governmentReferenceId: true, position: true },
  });

  const tally = new Map<string, { agreed: number; disagreed: number }>();
  for (const vote of theirs) {
    const yourPosition = mineByReference.get(vote.governmentReferenceId);
    if (!yourPosition) continue;

    const entry = tally.get(vote.userId) ?? { agreed: 0, disagreed: 0 };
    if (yourPosition === vote.position) entry.agreed += 1;
    else entry.disagreed += 1;
    tally.set(vote.userId, entry);
  }

  return targets.map((userId) => {
    const entry = tally.get(userId) ?? { agreed: 0, disagreed: 0 };
    const shared = entry.agreed + entry.disagreed;

    return {
      userId,
      shared,
      agreed: entry.agreed,
      disagreed: entry.disagreed,
      // BELOW THE THRESHOLD THERE IS NO NUMBER, rather than a flattering one.
      // "100% aligned" off a single shared record is the most misleading thing
      // this endpoint could say, and it is exactly the shape somebody would
      // act on when deciding who speaks for them.
      agreementPct: shared >= minimumShared ? Math.round((entry.agreed / shared) * 100) : null,
    };
  });
}
