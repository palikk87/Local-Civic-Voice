/**
 * WHICH RECORDS ARE HANDED TO GOOGLE, AND WHY MOST OF THEM ARE NOT YET.
 *
 * Every record has a working, shareable address. That is not the same as being
 * worth submitting to a search engine, and the difference matters more than it
 * sounds.
 *
 * WHAT A BARE RECORD ACTUALLY IS. A title, a date, a vote counter reading 0–0,
 * and — where we hold it — the official text. That text is public domain and
 * Google already has it from federalregister.gov, congress.gov and
 * CourtListener, which it will rank ahead of us and should. So a bare record
 * page is a near-duplicate of a government page with an empty widget on it.
 *
 * Publishing 1,900 of those is not a neutral act. Google's own guidance treats
 * mass-produced pages made mainly to rank as spam, whether a person or a
 * machine wrote them, and the judgement lands on the whole domain rather than
 * the pages. The cost of getting this wrong is the site, not the page.
 *
 * SO A RECORD EARNS ITS LISTING by carrying something the government's own
 * page does not:
 *
 *   - a Citizen's Brief — what it means, in plain English
 *   - a real description — more than a restated title
 *   - recorded votes — the Public Pulse, which is the one thing about these
 *     records that exists nowhere else on the internet
 *
 * THIS IS A RULE, NOT A LIST. It is evaluated fresh every time the sitemap is
 * built, so a record that nobody had written about on Monday and that fifty
 * people voted on by Friday is in the sitemap on Friday, with nobody deciding
 * anything. The set grows because the platform is used — which is also the
 * only kind of growth Google is trying to reward.
 */

/** Below this, a tally is a handful of people and not yet a public pulse. */
export const VOTES_TO_COUNT = 3;

/** A description that is just the title again tells a reader nothing. */
const DESCRIPTION_FLOOR = 80;

export interface FindableInput {
  slug: string | null;
  citizenBrief: string | null;
  description: string | null;
  supportVotes: number;
  opposeVotes: number;
}

/**
 * Is this record worth putting in front of somebody who searched for it?
 *
 * No slug means no readable address, and an address is the point — so that is
 * the one hard requirement rather than a matter of substance.
 */
export function isFindable(reference: FindableInput): boolean {
  if (!reference.slug) return false;

  if (reference.citizenBrief && reference.citizenBrief.trim().length > 0) return true;
  if ((reference.description?.trim().length ?? 0) >= DESCRIPTION_FLOOR) return true;
  if (reference.supportVotes + reference.opposeVotes >= VOTES_TO_COUNT) return true;

  return false;
}

/** Why a record is or is not listed, in words, for the admin panel and tests. */
export function findableReason(reference: FindableInput): string {
  if (!reference.slug) return "no readable address yet";
  if (reference.citizenBrief && reference.citizenBrief.trim().length > 0) {
    return "has a Citizen's Brief";
  }
  if ((reference.description?.trim().length ?? 0) >= DESCRIPTION_FLOOR) {
    return "has a description of its own";
  }
  const votes = reference.supportVotes + reference.opposeVotes;
  if (votes >= VOTES_TO_COUNT) return `${votes} people have taken a position`;
  return "nothing on it yet that the government's own page does not have";
}
