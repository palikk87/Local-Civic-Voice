/**
 * THE CIVIC SCORE, COUNTED FROM WHAT ACTUALLY HAPPENED.
 *
 * REPORTED as a streak "showing 1 thing on my computer but something else on
 * my phone". Both were right about themselves: the score and the streak lived
 * in the browser. Two devices kept two different tallies, neither followed
 * anybody to a new machine, and clearing a cache reset a person's whole civic
 * history to zero.
 *
 * WHY THERE IS NO POINTS LEDGER HERE. The obvious build is a table of awards,
 * a hook on every action that writes one, rules against farming, and a backfill
 * for everything that already happened. I priced that at a couple of days and
 * was wrong to, because none of it is needed: every vote, post and comment is
 * already a row with a person and a timestamp on it. The score is not something
 * to record. It is something to count.
 *
 * That is also the better design, not merely the cheaper one:
 *
 *   - Nothing to backfill. Everything anybody has ever done already counts.
 *   - It cannot drift, because there is no second copy to keep in step.
 *   - Clearing a cache does nothing. Signing in on a new phone shows the same
 *     number, because both are asking the same question of the same rows.
 *   - It cannot be inflated by a bug in an award hook, because there is no
 *     award hook. Delete a post and the score it earned goes with it.
 *
 * WHAT IT IS NOT. It is not a ranking. There is no endpoint here that orders
 * people, and there is not meant to be — the Constitution says the platform
 * never ranks anybody, and a score exists to show somebody their own record.
 */

import { prisma } from "../prisma";

/**
 * What each thing is worth.
 *
 * Voting is the point of the platform, so it is worth the most. Writing takes
 * more effort than commenting, so it is worth more. These are the defaults
 * offered to Khalid — 10 / 5 / 2 — and they live here as one named object so
 * changing them is one edit and every screen agrees afterwards.
 */
export const POINTS = { vote: 10, post: 5, comment: 2 } as const;

/**
 * A day's worth of anything, above which more of it stops adding.
 *
 * Not anti-farming machinery — there is nothing to farm when the score is a
 * count of real records — but a shape decision: somebody who votes on forty
 * bills in one sitting has not been forty times more civic than somebody who
 * voted on ten. The cap makes the score reward turning up over time, which is
 * what the streak is for as well.
 */
export const DAILY_CAP = 50;

/**
 * The ceiling, and it is deliberately far away.
 *
 * The old scale ran 0-1000 in even-ish bands, which with the daily cap meant a
 * determined person topped out in about twenty days and then had nothing left
 * to climb. A ladder you finish in three weeks stops mattering in three weeks.
 *
 * The bands below widen as they go, so each takes longer than the last: the
 * first is about five days of turning up, the last is the better part of a year.
 */
export const MAX_SCORE = 20_000;

export type CivicLevel =
  | "newcomer"
  | "citizen"
  | "advocate"
  | "activist"
  | "champion"
  | "leader";

/** The same six tiers the app has always shown, named on the server so the
 *  number and the title cannot disagree about which band it is in. */
export const LEVELS: Array<{ id: CivicLevel; min: number; max: number; title: string }> = [
  // Each band is twice the width of the one before it, and the last is the
  // widest of all — the climb must never get easier the higher you are. At the
  // 50-a-day cap that is about 5 days to leave the first, then 10, 20, 40, 80,
  // and roughly eight months of turning up to cross the last.
  { id: "newcomer", min: 0, max: 249, title: "New here" },
  { id: "citizen", min: 250, max: 749, title: "Engaged Citizen" },
  { id: "advocate", min: 750, max: 1749, title: "Democracy Advocate" },
  { id: "activist", min: 1750, max: 3749, title: "Civic Activist" },
  { id: "champion", min: 3750, max: 7749, title: "Accountability Champion" },
  { id: "leader", min: 7750, max: MAX_SCORE, title: "Democracy Leader" },
];

export function levelFor(score: number): (typeof LEVELS)[number] {
  return LEVELS.find((level) => score >= level.min && score <= level.max) ?? LEVELS[0]!;
}

/**
 * BADGES THAT CAN ACTUALLY BE EARNED.
 *
 * The app declared twelve and could award five; seven were deleted earlier for
 * exactly that reason — a badge nothing can unlock is a promise the platform
 * does not keep. The same rule applies here, so this list holds only badges
 * that follow from data that exists: votes cast, a category voted in, and days
 * turned up in a row.
 *
 * gap_hunter and truth_seeker are deliberately absent. One needs a record of
 * which representation gaps somebody looked at, the other a record of whose
 * full text they read. Neither is kept, so neither can be honestly awarded.
 */
export const BADGES = [
  // VOTING — the point of the platform, so the longest ladder.
  { id: "first_vote", name: "First Voice", description: "Cast your first vote on a law", requirement: 1, kind: "votes" },
  { id: "ten_votes", name: "Active Voter", description: "Vote on 10 laws", requirement: 10, kind: "votes" },
  { id: "fifty_votes", name: "Dedicated Democrat", description: "Vote on 50 laws", requirement: 50, kind: "votes" },
  { id: "hundred_votes", name: "Century Voter", description: "Cast 100 votes", requirement: 100, kind: "votes" },
  { id: "two_fifty_votes", name: "Standing Record", description: "Cast 250 votes", requirement: 250, kind: "votes" },
  { id: "five_hundred_votes", name: "Roll Call", description: "Cast 500 votes", requirement: 500, kind: "votes" },
  { id: "thousand_votes", name: "Thousand Voices", description: "Cast 1,000 votes", requirement: 1000, kind: "votes" },

  // TURNING UP — earned by the longest run, so a missed day never takes one back.
  { id: "three_day_streak", name: "Getting Started", description: "Turn up 3 days running", requirement: 3, kind: "streak" },
  { id: "weekly_warrior", name: "Weekly Warrior", description: "Turn up 7 days running", requirement: 7, kind: "streak" },
  { id: "monthly_maven", name: "Monthly Maven", description: "Turn up 30 days running", requirement: 30, kind: "streak" },
  { id: "quarter_champion", name: "Quarter Champion", description: "Turn up 90 days running", requirement: 90, kind: "streak" },
  { id: "half_year", name: "Half a Year", description: "Turn up 180 days running", requirement: 180, kind: "streak" },
  { id: "full_year", name: "Every Day for a Year", description: "Turn up 365 days running", requirement: 365, kind: "streak" },

  // DEPTH — a lot of attention on one subject.
  { id: "category_expert", name: "Policy Expert", description: "Vote on 20 laws in one category", requirement: 20, kind: "category" },
  { id: "category_master", name: "Subject Authority", description: "Vote on 50 laws in one category", requirement: 50, kind: "category" },
  { id: "category_scholar", name: "Standing Scholar", description: "Vote on 100 laws in one category", requirement: 100, kind: "category" },

  // BREADTH — attention spread across subjects, which is a different virtue.
  { id: "broad_three", name: "Wide Interest", description: "Vote in 3 different categories", requirement: 3, kind: "breadth" },
  { id: "broad_six", name: "Whole Picture", description: "Vote in 6 different categories", requirement: 6, kind: "breadth" },
  { id: "broad_ten", name: "Nothing Ignored", description: "Vote in 10 different categories", requirement: 10, kind: "breadth" },

  // WRITING — saying why, not only how.
  { id: "first_post", name: "Said Something", description: "Write your first post", requirement: 1, kind: "posts" },
  { id: "ten_posts", name: "Regular Voice", description: "Write 10 posts", requirement: 10, kind: "posts" },
  { id: "fifty_posts", name: "Persistent Voice", description: "Write 50 posts", requirement: 50, kind: "posts" },
  { id: "two_hundred_posts", name: "Public Record", description: "Write 200 posts", requirement: 200, kind: "posts" },

  // TALKING TO PEOPLE — the half of a platform that is not broadcasting.
  { id: "first_comment", name: "Joined In", description: "Leave your first comment", requirement: 1, kind: "comments" },
  { id: "twentyfive_comments", name: "In the Conversation", description: "Leave 25 comments", requirement: 25, kind: "comments" },
  { id: "hundred_comments", name: "Always Replying", description: "Leave 100 comments", requirement: 100, kind: "comments" },
  { id: "five_hundred_comments", name: "Town Square", description: "Leave 500 comments", requirement: 500, kind: "comments" },

  // TOTAL DAYS — not a run; how many days you have ever shown up at all.
  { id: "thirty_days", name: "A Month of Days", description: "Be active on 30 days", requirement: 30, kind: "days" },
  { id: "hundred_days", name: "A Hundred Days", description: "Be active on 100 days", requirement: 100, kind: "days" },
  { id: "year_of_days", name: "A Year of Days", description: "Be active on 365 days", requirement: 365, kind: "days" },
] as const;

export interface EarnedBadge {
  id: string;
  name: string;
  description: string;
  requirement: number;
  /** How far along, in the same units as the requirement. */
  progress: number;
  earned: boolean;
}

export interface CivicScore {
  total: number;
  level: CivicLevel;
  levelTitle: string;
  /** Points into the current band, and how wide the band is. */
  intoLevel: number;
  levelSpan: number;
  toNextLevel: number;
  counts: { votes: number; posts: number; comments: number };
  earned: { votes: number; posts: number; comments: number };
  streak: { current: number; longest: number; activeToday: boolean };
  /** Every day with any activity on it, most recent first, ISO dates. */
  activeDays: string[];
  /** Votes per category, largest first. Real categories only — no zero rows. */
  byCategory: Array<{ category: string; votes: number }>;
  badges: EarnedBadge[];
  /** All six bands, so the page can show the whole ladder and where you are. */
  levels: Array<{ id: CivicLevel; title: string; min: number; max: number; reached: boolean }>;
}

/** A calendar day in UTC. Every device asks the same question, so the answer
 *  must not depend on where the person asking happens to be standing. */
function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Walk back from today counting unbroken days.
 *
 * A streak that breaks the instant midnight passes is a streak nobody can
 * keep, so today NOT being in the set does not end it — yesterday does. Once
 * a day is missed, the run is over; the day it ended on is not carried.
 */
function streakFrom(days: Set<string>): { current: number; longest: number; activeToday: boolean } {
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000));
  const activeToday = days.has(today);

  let current = 0;
  if (days.has(today) || days.has(yesterday)) {
    const cursor = new Date(days.has(today) ? today : yesterday);
    while (days.has(dayOf(cursor))) {
      current += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // The longest run anywhere in the record, which is a fact about a person
  // worth keeping even after they miss a day.
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    if (previous) {
      const gap = (Date.parse(day) - Date.parse(previous)) / 86_400_000;
      run = gap === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = day;
  }

  return { current, longest, activeToday };
}

/**
 * One person's score, counted now.
 *
 * Three queries and some arithmetic. Deliberately not cached: it is cheap, and
 * a cached score is a second copy of the truth, which is the thing this file
 * exists to stop.
 */
export async function civicScoreFor(userId: string): Promise<CivicScore> {
  const [votes, posts, comments] = await Promise.all([
    prisma.governmentReferenceVote.findMany({
      where: { userId },
      // The category comes from the law, so the Policy Expert badge is counted
      // from what was actually voted on rather than a tally kept alongside.
      select: { createdAt: true, governmentReference: { select: { category: true } } },
    }),
    prisma.post.findMany({ where: { authorId: userId }, select: { createdAt: true } }),
    prisma.comment.findMany({ where: { authorId: userId }, select: { createdAt: true } }),
  ]);

  // Points are gathered per day so the cap can be applied per day. A single
  // total cannot be capped after the fact without losing which day it came from.
  const perDay = new Map<string, number>();
  const add = (at: Date, points: number) => {
    const day = dayOf(at);
    perDay.set(day, (perDay.get(day) ?? 0) + points);
  };

  for (const row of votes) add(row.createdAt, POINTS.vote);
  for (const row of posts) add(row.createdAt, POINTS.post);
  for (const row of comments) add(row.createdAt, POINTS.comment);

  let total = 0;
  for (const points of perDay.values()) total += Math.min(points, DAILY_CAP);
  total = Math.min(total, MAX_SCORE);

  const level = levelFor(total);

  // Votes per category, for the badge and for showing where somebody's
  // attention actually goes. Absent categories are absent, not zero rows.
  const categories = new Map<string, number>();
  for (const row of votes) {
    const category = row.governmentReference?.category;
    if (!category) continue;
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const byCategory = [...categories.entries()]
    .map(([category, count]) => ({ category, votes: count }))
    .sort((a, b) => b.votes - a.votes);

  const streak = streakFrom(new Set(perDay.keys()));
  const biggestCategory = byCategory[0]?.votes ?? 0;

  const badges: EarnedBadge[] = BADGES.map((badge) => {
    // A badge for turning up is earned by the LONGEST run, not the current one:
    // missing a day should not take back a thing already done.
    const progress =
      badge.kind === "votes"
        ? votes.length
        : badge.kind === "posts"
          ? posts.length
          : badge.kind === "comments"
            ? comments.length
            : badge.kind === "category"
              ? biggestCategory
              : badge.kind === "breadth"
                ? byCategory.length
                : badge.kind === "days"
                  ? perDay.size
                  : streak.longest;
    return {
      id: badge.id,
      name: badge.name,
      description: badge.description,
      requirement: badge.requirement,
      progress: Math.min(progress, badge.requirement),
      earned: progress >= badge.requirement,
    };
  });

  return {
    total,
    level: level.id,
    levelTitle: level.title,
    intoLevel: total - level.min,
    levelSpan: level.max - level.min + 1,
    toNextLevel: Math.max(0, level.max + 1 - total),
    counts: { votes: votes.length, posts: posts.length, comments: comments.length },
    earned: {
      votes: votes.length * POINTS.vote,
      posts: posts.length * POINTS.post,
      comments: comments.length * POINTS.comment,
    },
    streak,
    activeDays: [...perDay.keys()].sort().reverse(),
    byCategory,
    badges,
    levels: LEVELS.map((band) => ({
      id: band.id,
      title: band.title,
      min: band.min,
      max: band.max,
      reached: total >= band.min,
    })),
  };
}
