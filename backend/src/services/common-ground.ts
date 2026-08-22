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
  const theirs = await prisma.governmentReferenceVote.findMany({
    where: {
      userId: otherId,
      position: { in: ["support", "oppose"] },
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
