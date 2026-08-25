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

/**
 * The gap, or the reason there isn't one yet.
 *
 * WHY THIS EXISTS ALONGSIDE representationGap(). That function answers null for
 * four completely different situations — the record is unknown, barely anybody
 * here has voted, the chamber has not voted, or the chamber's vote carries no
 * split to compare. The clients rendered nothing for all four, so the most
 * compelling thing this platform can show simply vanished from the page with no
 * explanation, and looked to everyone like a missing feature rather than a
 * measurement that is not available yet.
 *
 * Same lesson as the mail failures: an absent number and a number that cannot
 * be computed yet are different states, and collapsing them into silence is how
 * a working feature gets reported as broken.
 */
export type GapStatus =
  | { gap: RepresentationGap; reason: null }
  | {
      gap: null;
      reason: "unknown_record" | "not_enough_voices" | "no_official_vote" | "no_recorded_split";
      /** For "not_enough_voices": how many have voted, and how many are needed. */
      publicTotal?: number;
      needed?: number;
    };

export async function gapStatus(referenceId: string): Promise<GapStatus> {
  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, supportVotes: true, opposeVotes: true },
  });
  if (!reference) return { gap: null, reason: "unknown_record" };

  const publicTotal = reference.supportVotes + reference.opposeVotes;
  if (publicTotal < MINIMUM_PUBLIC_VOICES) {
    return {
      gap: null,
      reason: "not_enough_voices",
      publicTotal,
      needed: MINIMUM_PUBLIC_VOICES,
    };
  }

  const rollCall = await prisma.rollCall.findFirst({
    where: { governmentReferenceId: referenceId },
    orderBy: { votedAt: "desc" },
  });
  if (!rollCall) return { gap: null, reason: "no_official_vote" };
  if (rollCall.yea + rollCall.nay === 0) return { gap: null, reason: "no_recorded_split" };

  const gap = await representationGap(referenceId);
  // representationGap() re-reads and re-applies the same rules, so a null here
  // would mean the two disagree. Reported rather than papered over.
  return gap ? { gap, reason: null } : { gap: null, reason: "no_recorded_split" };
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
