/**
 * The six civic levels, and nothing else.
 *
 * WHAT USED TO BE HERE. A zustand store persisted to the device holding a civic
 * score, unlocked badges, badge progress, a streak, a voting history, bills
 * read, gaps viewed, gaps shared and reps contacted — every one of them a fact
 * about a person, written to whichever device they happened to be holding.
 *
 * The owner's rule: "if my badges are stored on my phone then I login to my
 * computer then I'm not having a singular experience. I might as well have
 * multiple profiles." A device may cache what makes the app quicker; a person's
 * record lives on the server and nowhere else.
 *
 * All of it is now counted by backend/src/services/civic-score.ts from the rows
 * that actually exist — votes, posts, comments — and read through
 * /api/me/civic-score. Every device asks the same question of the same rows and
 * gets the same answer, which is the entire point.
 *
 * These bands survive because they are not anybody's data. They are the labels
 * and colours the plaque paints with, identical for everyone, and the server
 * returns which one you are in. Kept here so the two feeds share one palette.
 */

export type CivicLevel =
  | 'newcomer'
  | 'citizen'
  | 'advocate'
  | 'activist'
  | 'champion'
  | 'leader';

export const CIVIC_LEVELS: Record<CivicLevel, { min: number; max: number; title: string; color: string }> = {
  newcomer: { min: 0, max: 99, title: 'New here', color: '#94A3B8' },
  citizen: { min: 100, max: 249, title: 'Engaged Citizen', color: '#22C55E' },
  advocate: { min: 250, max: 499, title: 'Democracy Advocate', color: '#3B82F6' },
  activist: { min: 500, max: 749, title: 'Civic Activist', color: '#8B5CF6' },
  champion: { min: 750, max: 899, title: 'Accountability Champion', color: '#F59E0B' },
  leader: { min: 900, max: 1000, title: 'Democracy Leader', color: '#EF4444' },
};
