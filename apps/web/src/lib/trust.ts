/**
 * The Trust Score, as the client sees it.
 *
 * "Trust scores are not meant to rank anyone. They are meant to inform people
 * when delegating votes."
 *
 * NOTHING IN THIS FILE SORTS. There is no comparison helper, no "top delegates"
 * call and no band that says anybody is better than anybody. What it offers is
 * a number and every part that produced it, at the moment somebody is deciding
 * whether to lend a stranger their vote.
 *
 * A new account has no score at all — `enough: false` — and the screens say
 * "not enough yet" rather than drawing a low bar.
 */

import { api } from "./api";

export interface TrustPart {
  id: string;
  label: string;
  /** The raw thing counted, so the score can be checked by hand. */
  count: number;
  /** What it added, or took away. Negative for the two that count against. */
  points: number;
  detail: string;
}

export type TrustResult =
  | {
      enough: false;
      reason: "not_enough_yet";
      accountAgeDays: number;
      actions: number;
      needs: { accountAgeDays: number; actions: number };
    }
  | {
      enough: true;
      score: number;
      parts: TrustPart[];
      carriesDelegatedVotes: boolean;
    };

/**
 * What the number means, in one line.
 *
 * NEVER A RANK, and deliberately never a superlative. There is no "top" or
 * "best" here, because "trust scores are not meant to rank anyone. They are
 * meant to inform people when delegating votes." The bands describe how much
 * of a record there is to read, not how good a person is.
 */
export function trustBand(score: number): string {
  if (score >= 75) return "A long record on this platform";
  if (score >= 50) return "A substantial record";
  if (score >= 25) return "Some record to go on";
  return "Not much of a record yet";
}

export const trust = {
  /** One account's score, with every part it is made of. Public. */
  of: (userId: string) =>
    api.get<{ trust: TrustResult; weights: Record<string, number> }>(
      `/api/users/${userId}/trust`,
    ),
};
