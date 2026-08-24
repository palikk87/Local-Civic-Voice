/**
 * The people here said 73% oppose. The House passed it 218-210.
 *
 * The single most compelling sentence this platform can say, and it could not
 * say it. The UI for it has existed on both clients since the beginning —
 * PulseGap, and an "Official Vote" block on the bill page — and neither had
 * ever rendered for a real record, because nothing stored how Congress voted
 * and `officialVotes` was set by nothing.
 *
 * BOTH HALVES ARE REAL OR THERE IS NO GAP. The public half is the published
 * weighted tally on the record; the official half is a roll call parsed from
 * senate.gov or clerk.house.gov and stored with the URL it came from. When
 * either side is missing this returns null and the panels stay hidden, which
 * is the same rule the rest of this codebase follows: an absent feature is
 * better than an invented number.
 */

import { prisma } from "../prisma";

export interface RepresentationGap {
  referenceId: string;
  /** What the citizens here said. */
  publicSupportPct: number;
  publicSupport: number;
  publicOppose: number;
  publicTotal: number;
  /** What the chamber did. */
  officialSupportPct: number;
  officialYea: number;
  officialNay: number;
  chamber: string;
  question: string;
  result: string;
  votedAt: string;
  sourceUrl: string;
  /** Percentage points between the two. */
  gapPct: number;
  /** True when the public and the chamber landed on opposite sides. */
  opposite: boolean;
}

/** Below this the "public" half is a handful of people, not a public. */
export const MINIMUM_PUBLIC_VOICES = 10;

/**
 * The gap on one record, or null when there is not one to show.
 *
 * Uses the LATEST roll call on the record. A bill can be voted on many times —
 * procedural motions, amendments, final passage — and the honest comparison is
 * against where the chamber last stood, not against whichever roll call
 * happens to flatter the gap.
 */
export async function representationGap(
  referenceId: string,
): Promise<RepresentationGap | null> {
  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, supportVotes: true, opposeVotes: true },
  });
  if (!reference) return null;

  const publicTotal = reference.supportVotes + reference.opposeVotes;
  if (publicTotal < MINIMUM_PUBLIC_VOICES) return null;

  const rollCall = await prisma.rollCall.findFirst({
    where: { governmentReferenceId: referenceId },
    orderBy: { votedAt: "desc" },
  });
  if (!rollCall) return null;

  const officialTotal = rollCall.yea + rollCall.nay;
  // A voice vote or a unanimous-consent record carries no split to compare.
  if (officialTotal === 0) return null;

  const publicSupportPct = Math.round((reference.supportVotes / publicTotal) * 100);
  const officialSupportPct = Math.round((rollCall.yea / officialTotal) * 100);

  return {
    referenceId,
    publicSupportPct,
    publicSupport: reference.supportVotes,
    publicOppose: reference.opposeVotes,
    publicTotal,
    officialSupportPct,
    officialYea: rollCall.yea,
    officialNay: rollCall.nay,
    chamber: rollCall.chamber,
    question: rollCall.question,
    result: rollCall.result,
    votedAt: rollCall.votedAt.toISOString(),
    sourceUrl: rollCall.sourceUrl,
    gapPct: Math.abs(publicSupportPct - officialSupportPct),
    // The case worth a headline: a majority here wanted one thing and the
    // chamber did the other.
    opposite: publicSupportPct >= 50 !== officialSupportPct >= 50,
  };
}

export interface MemberVoteView {
  memberId: string;
  name: string;
  party: string;
  state: string;
  district: string | null;
  voteCast: string;
}

/**
 * How every member voted on the latest roll call for a record.
 *
 * Ordered by state then surname, which is how both chambers print their own
 * tallies, so somebody looking for their own delegation finds it where they
 * expect it.
 */
export async function officialVoteRoll(referenceId: string): Promise<{
  chamber: string;
  question: string;
  votedAt: string;
  sourceUrl: string;
  members: MemberVoteView[];
} | null> {
  const rollCall = await prisma.rollCall.findFirst({
    where: { governmentReferenceId: referenceId },
    orderBy: { votedAt: "desc" },
    include: {
      memberVotes: { orderBy: [{ state: "asc" }, { lastName: "asc" }] },
    },
  });
  if (!rollCall || rollCall.memberVotes.length === 0) return null;

  return {
    chamber: rollCall.chamber,
    question: rollCall.question,
    votedAt: rollCall.votedAt.toISOString(),
    sourceUrl: rollCall.sourceUrl,
    members: rollCall.memberVotes.map((vote) => ({
      memberId: vote.memberId,
      name: vote.firstName ? `${vote.firstName} ${vote.lastName}` : vote.lastName,
      party: vote.party,
      state: vote.state,
      district: vote.district,
      voteCast: vote.voteCast,
    })),
  };
}
