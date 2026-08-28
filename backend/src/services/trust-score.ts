/**
 * THE TRUST SCORE.
 *
 * "Trust scores are not meant to rank anyone. They are meant to inform people
 * when delegating votes." — Khalid, and that sentence decides everything about
 * this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS NOT.
 *
 * It is not a ranking. Nothing sorts by it, nothing filters by it, and it never
 * reaches the feed — the Bill of Rights says only delegated votes may decide
 * what gets seen, and a score that quietly boosted somebody's reach would be
 * the platform voting. A test asserts no feed or ranking code imports this.
 *
 * It is not a judgement of a person. It is a description of what an account has
 * done here, offered at the moment somebody is deciding whether to lend it
 * their vote, and it is useless anywhere else.
 *
 * WHAT REPLACED WHAT. `calculateCivilLeaderTrust` in packages/civic-core
 * computed a score from `const impeachmentVotes = 0; // Would come from
 * database` — a formula over a number nothing ever fetched, that nothing ever
 * called. It is deleted rather than wired up, because its shape was wrong: it
 * multiplied a leader's reach, which is exactly what this must not do.
 *
 * A NEW ACCOUNT DOES NOT SCORE ZERO. It reports "not enough yet". Scoring an
 * empty record would publish a low number about a person who has simply not
 * done anything, and that reads as a verdict on them. Same rule as everywhere
 * else here: when the data does not exist, show nothing.
 *
 * IT ALWAYS SHOWS ITS WORKING. Every part is returned with its own count and
 * its own contribution. A bare number is something you either believe or you
 * do not; a number with its parts is something you can disagree with.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { prisma } from "../prisma";
import { FALSEHOOD_REASON } from "./jury";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much of a record there has to be before a number means anything.
 *
 * Below this the answer is "not enough yet", not a low score. Deliberately
 * small: three months of nothing is not what this is protecting against — a
 * profile that has existed for a week is.
 */
export const ENOUGH_TO_SCORE = {
  /** A fortnight, the same bar delegate eligibility already uses. */
  ACCOUNT_AGE_DAYS: 14,
  /** Some evidence of taking part at all. */
  ACTIONS: 5,
} as const;

/**
 * A finding stops dragging the number down after a year.
 *
 * IT NEVER LEAVES THE RECORD. services/jury.ts keeps every upheld finding for
 * good and the profile shows them all, permanently — that is not what fades.
 * What fades is the arithmetic: somebody found out once who then spent a year
 * not doing it again has an account that can say so, and a number that can
 * never recover is one nobody bothers trying to recover.
 */
export const FINDING_FADES_AFTER_MS = 365 * DAY_MS;

export interface TrustPart {
  /** Stable machine name, used by the screens and the tests. */
  id: string;
  label: string;
  /** The raw thing counted. Published, so the score can be checked by hand. */
  count: number;
  /** What it added, or took away. Negative for the two that count against. */
  points: number;
  /** One plain sentence. Never a judgement. */
  detail: string;
}

export type TrustResult =
  | {
      enough: false;
      reason: "not_enough_yet";
      /** How old the account is, in days. Safe: it identifies nobody. */
      accountAgeDays: number;
      actions: number;
      /** What it would take to have a score at all. */
      needs: { accountAgeDays: number; actions: number };
    }
  | {
      enough: true;
      /** 0–100. Published with every part that produced it. */
      score: number;
      parts: TrustPart[];
      /** True when this account is currently carrying somebody else's vote. */
      carriesDelegatedVotes: boolean;
    };

/**
 * The weights.
 *
 * Held as one table so a test can read them rather than re-deriving the
 * arithmetic and agreeing with itself, and so anybody arguing with the score
 * can argue with the actual numbers.
 *
 * They are a judgement, not a derivation. What matters far more than the exact
 * values is that every one of them is published on the same panel as the
 * result, and that the two negative ones are things the person chose to do or
 * not do rather than things that happened to them.
 */
export const WEIGHTS = {
  /** Up to 15 for sticking around. Three months gets the lot. */
  TENURE_MAX: 15,
  TENURE_DAYS_FOR_MAX: 90,
  /** Up to 25 for turning up to vote. */
  VOTES_MAX: 25,
  VOTES_FOR_MAX: 30,
  /** Up to 20 for people trusting them with a voice. */
  DELEGATORS_MAX: 20,
  DELEGATORS_FOR_MAX: 10,
  /** Up to 20 for going back to a position after the law under it moved. */
  REVISITED_MAX: 20,
  REVISITED_FOR_MAX: 3,
  /** Up to 20 for answering when the platform asks you to judge a neighbour. */
  JURY_MAX: 20,
  JURY_FOR_MAX: 2,
  /** Each unfaded finding. */
  FINDING_PENALTY: 15,
  /** Each summons accepted or ignored and then left to lapse. */
  LAPSED_PENALTY: 5,
} as const;

/**
 * WHY THOSE CEILINGS ARE WHERE THEY ARE, and why they moved once.
 *
 * They were first set at a year's tenure, a hundred votes, fifty delegators,
 * ten revisits and five juries. Run against a real record — an account two
 * hundred days old with twenty votes, three posts and a position revisited
 * after the law moved — that produced **15 out of 100**, which this file's own
 * bands describe as "little to go on yet".
 *
 * That is a broken instrument, not a strict one. A scale on which a genuine
 * participant is indistinguishable from a stranger tells a person choosing a
 * delegate nothing, and this exists for exactly that choice. The ceilings are
 * now set where an ordinary active citizen lands in the middle and somebody
 * carrying delegated votes and sitting on juries reaches the top.
 *
 * NOBODY IS CAPPED OUT OF A HONEST SCORE. Forty of the hundred are only
 * available to somebody others have lent a vote to or who has sat on a jury —
 * both things that happen TO a person as much as by them. So a citizen who has
 * done everything within their own control tops out around sixty, and the
 * bands are written to call sixty a substantial record rather than a failure.
 */

/** Straight line up to a ceiling. */
function upTo(count: number, forMax: number, max: number): number {
  if (count <= 0) return 0;
  return Math.round(Math.min(1, count / forMax) * max);
}

/**
 * A cost, as a negative number — or a plain zero when there is nothing to cost.
 *
 * `-(0 * 15)` is negative zero in JavaScript, which serialises to `-0` and
 * renders on a panel as "-0" beside "No jury has upheld a report against them".
 * A clean record should not be printed as a small negative.
 */
function cost(count: number, each: number): number {
  return count > 0 ? -(count * each) : 0;
}

/**
 * Everything the score is made of, for one account.
 *
 * Six reads, all against rows that already existed before this feature. Nothing
 * here is stored: a cached score is a score that can be stale at exactly the
 * moment somebody is deciding whether to trust it.
 */
export async function trustScore(userId: string): Promise<TrustResult | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, createdAt: true },
  });
  if (!user) return null;

  const now = Date.now();
  const accountAgeDays = Math.floor((now - user.createdAt.getTime()) / DAY_MS);

  const [votes, delegators, positions, seats, findings] = await Promise.all([
    prisma.governmentReferenceVote.count({ where: { userId } }),
    prisma.delegation.findMany({
      where: { toUserId: userId, isActive: true },
      select: { fromUserId: true },
      distinct: ["fromUserId"],
    }),
    // Every position they have taken, with the version of the law it was taken
    // on and the version that law is at now.
    prisma.positionEvent.findMany({
      where: { userId, position: { not: "withdrawn" } },
      orderBy: { createdAt: "desc" },
      select: {
        governmentReferenceId: true,
        lawVersion: true,
        governmentReference: { select: { lawVersion: true } },
      },
    }),
    prisma.jurySeat.findMany({
      where: { jurorId: userId },
      select: { state: true },
    }),
    prisma.jury.findMany({
      where: { accusedId: userId, verdict: "upheld", report: { reason: FALSEHOOD_REASON } },
      select: { decidedAt: true },
    }),
  ]);

  // A POSITION REVISITED AFTER THE LAW MOVED. Only the latest position on each
  // record counts; an older one that has already been replaced is history. It
  // counts as revisited when the law has been amended at least once and the
  // person's current position was taken on the version it is at now — they came
  // back and looked at what it actually says.
  const latest = new Map<string, { lawVersion: number; current: number }>();
  for (const row of positions) {
    if (latest.has(row.governmentReferenceId)) continue;
    latest.set(row.governmentReferenceId, {
      lawVersion: row.lawVersion,
      current: row.governmentReference.lawVersion,
    });
  }
  const revisited = [...latest.values()].filter(
    (p) => p.current > 1 && p.lawVersion === p.current,
  ).length;

  const answered = seats.filter((s) => s.state === "voted").length;
  const lapsed = seats.filter((s) => s.state === "lapsed").length;
  const standing = findings.filter(
    (f) => !f.decidedAt || now - f.decidedAt.getTime() < FINDING_FADES_AFTER_MS,
  ).length;
  const faded = findings.length - standing;

  // NOT ENOUGH YET. Said before any arithmetic, so no low number is ever
  // computed for an account that simply has not done anything.
  const actions = votes + positions.length + seats.length;
  if (accountAgeDays < ENOUGH_TO_SCORE.ACCOUNT_AGE_DAYS || actions < ENOUGH_TO_SCORE.ACTIONS) {
    return {
      enough: false,
      reason: "not_enough_yet",
      accountAgeDays,
      actions,
      needs: {
        accountAgeDays: ENOUGH_TO_SCORE.ACCOUNT_AGE_DAYS,
        actions: ENOUGH_TO_SCORE.ACTIONS,
      },
    };
  }

  const parts: TrustPart[] = [
    {
      id: "tenure",
      label: "Time on the platform",
      count: accountAgeDays,
      points: upTo(accountAgeDays, WEIGHTS.TENURE_DAYS_FOR_MAX, WEIGHTS.TENURE_MAX),
      detail: `This account is ${accountAgeDays} days old.`,
    },
    {
      id: "votes",
      label: "Votes cast",
      count: votes,
      points: upTo(votes, WEIGHTS.VOTES_FOR_MAX, WEIGHTS.VOTES_MAX),
      detail: `They have taken a position on ${votes} record${votes === 1 ? "" : "s"}.`,
    },
    {
      id: "delegators",
      label: "People lending them a vote",
      count: delegators.length,
      points: upTo(delegators.length, WEIGHTS.DELEGATORS_FOR_MAX, WEIGHTS.DELEGATORS_MAX),
      detail:
        delegators.length === 0
          ? "Nobody is currently lending them a vote."
          : `${delegators.length} ${delegators.length === 1 ? "person is" : "people are"} currently lending them a vote.`,
    },
    {
      id: "revisited",
      label: "Positions revisited when the law changed",
      count: revisited,
      points: upTo(revisited, WEIGHTS.REVISITED_FOR_MAX, WEIGHTS.REVISITED_MAX),
      detail:
        revisited === 0
          ? "They have not gone back to a position after the law under it was amended."
          : `They went back and looked again at ${revisited} record${revisited === 1 ? "" : "s"} after the text changed.`,
    },
    {
      id: "jury-service",
      label: "Jury summonses answered",
      count: answered,
      points: upTo(answered, WEIGHTS.JURY_FOR_MAX, WEIGHTS.JURY_MAX),
      detail:
        answered === 0
          ? "They have not sat on a jury."
          : `They have sat on ${answered} jury${answered === 1 ? "" : " panels"} and cast a verdict.`,
    },
    {
      id: "findings",
      label: "Findings against them",
      count: standing,
      points: cost(standing, WEIGHTS.FINDING_PENALTY),
      detail:
        standing === 0
          ? faded > 0
            ? `${faded} earlier finding${faded === 1 ? "" : "s"} on the record, more than a year old, no longer counted here.`
            : "No jury has upheld a report that they misrepresented a law."
          : `${standing} jury finding${standing === 1 ? "" : "s"} in the last year that they misrepresented a law.`,
    },
    {
      id: "lapsed",
      label: "Summonses left unanswered",
      count: lapsed,
      points: cost(lapsed, WEIGHTS.LAPSED_PENALTY),
      detail:
        lapsed === 0
          ? "They have not let a jury summons lapse."
          : `${lapsed} jury summons${lapsed === 1 ? "" : "es"} went unanswered.`,
    },
  ];

  const raw = parts.reduce((total, part) => total + part.points, 0);

  return {
    enough: true,
    score: Math.max(0, Math.min(100, raw)),
    parts,
    carriesDelegatedVotes: delegators.length > 0,
  };
}

/**
 * Scores for a list of accounts, for the delegate directory.
 *
 * Deliberately a loop over `trustScore` rather than a second, faster
 * implementation: two ways of computing this is two numbers that can disagree,
 * and the one on the card is the one somebody acts on.
 */
export async function trustScores(userIds: string[]): Promise<Map<string, TrustResult>> {
  const out = new Map<string, TrustResult>();
  for (const id of userIds) {
    const result = await trustScore(id);
    if (result) out.set(id, result);
  }
  return out;
}
