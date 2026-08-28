// THE AMENDMENTS — the Bill of Rights of AYE & NAY.
//
// THIS FILE NO LONGER HOLDS A DOCUMENT. It holds a view of one.
//
// The Bill of Rights is part of the Constitution — Amendments I to V — and the
// text lives with the rest of it in ./constitution.ts. It used to be a second
// document with its own preamble, its own version and its own effective date,
// and it drifted: it promised encrypted personal data the platform does not
// encrypt, a check on citizenship the platform never makes, and a Trust Score
// that determines influence it does not determine.
//
// Two founding documents that can disagree is one founding document and one
// forgery, and no reader can tell which is which. So there is one now. The
// `BILL_OF_RIGHTS` export survives because a dozen screens import it by that
// name, and because "the Bill of Rights" is what people call it.

import {
  CONSTITUTION,
  getAmendmentEnforcement,
  type Amendment,
} from './constitution';

/**
 * An article of the Bill of Rights is an Amendment. The alias is kept because
 * the two clients import `Article` from here.
 */
export type Article = Amendment;

export interface BillOfRights {
  preamble: string;
  articles: Article[];
  effectiveDate: string;
  version: string;
}

export const BILL_OF_RIGHTS: BillOfRights = {
  preamble: CONSTITUTION.amendmentsNote,
  articles: CONSTITUTION.amendments,
  effectiveDate: CONSTITUTION.effectiveDate,
  version: CONSTITUTION.version,
};

export { getAmendmentEnforcement };

// ==========================================
// WHAT THE AMENDMENTS LEAN ON
// ==========================================

/**
 * Amendment I: a Delegation is always revocable. There is no state of this
 * platform in which it is not, which is why this takes no argument.
 */
export function canRevokeDelegate(): boolean {
  return true;
}

/**
 * Amendment I: a Citizen's own vote overrides the voice they lent.
 */
export function doesIndividualVoteOverride(): boolean {
  return true;
}

/**
 * Amendment II: what the feed is allowed to weigh.
 *
 * These are not decoration. packages/civic-core/src/feed-algorithm.ts reads
 * this object and multiplies its weights by it, so a prohibited factor
 * switched on here would be switched on there — and switching one off zeroes
 * the weight rather than quietly leaving it in place.
 *
 * `backend/tests/constitution-compliance.test.ts` publishes and checks these
 * factors against the running feed, under [art3-sec1].
 */
export interface AlgorithmFactors {
  liquidDemocracyWeight: boolean; // Allowed
  engagementBait: boolean; // NOT allowed
  paidPromotion: boolean; // NOT allowed
  outrageAmplification: boolean; // NOT allowed
  recency: boolean; // Allowed (neutral)
  userPreference: boolean; // Allowed (user-controlled)
}

export function getAlgorithmCompliance(): AlgorithmFactors {
  return {
    liquidDemocracyWeight: true,
    engagementBait: false,
    paidPromotion: false,
    outrageAmplification: false,
    recency: true,
    userPreference: true,
  };
}

/**
 * Amendment III: what a vote breakdown must show.
 */
export interface VoteTransparency {
  showDirectVotes: boolean;
  showDelegatedVotes: boolean;
  showDelegationChain: boolean;
  showTotalWeight: boolean;
}

export function getVoteTransparencyRequirements(): VoteTransparency {
  return {
    showDirectVotes: true,
    showDelegatedVotes: true,
    showDelegationChain: true,
    showTotalWeight: true,
  };
}

/**
 * DATA POLICY — deliberately not here any more.
 *
 * `getDataPolicy()` returned a hardcoded object whose last field was
 * `encryptsPersonalData: true`. Nothing about a Citizen is encrypted.
 * Passwords are hashed and the platform's own API keys are encrypted at rest;
 * a name, a post and a vote are stored as they are, like every other row.
 *
 * Nothing read the object, so nothing behaved differently for it — it existed
 * only to be true, and it was not. Amendment IV now says what the platform
 * actually does, and ends with the sentence that makes a repeat of this a
 * breach rather than an oversight: it shall claim no protection it does not
 * provide.
 */

/**
 * LEADER REQUIREMENTS — deliberately not here any more.
 *
 * `getLeaderRequirements()` claimed `trustScoreBased: true`. The Trust Score
 * is shown beside a delegate and changes nothing: not reach, not ranking, not
 * standing, not the title. backend/tests/trust-score.test.ts has a source scan
 * that fails the build if any feed or ordering code so much as imports it.
 *
 * What actually governs the Vanguard is Article IV §2 and Amendment V, both of
 * which now say the title confers nothing.
 */

/**
 * FALSEHOOD PENALTIES — deliberately not here any more.
 *
 * `calculateFalsehoodPenalty` used to take a trust score and a severity of
 * 'minor' | 'moderate' | 'severe' and shave a percentage off. Nothing called
 * it, and nothing could have called it honestly: no part of this platform has
 * ever graded a falsehood by severity, so the input did not exist.
 *
 * What exists now is a jury. It decides one question — did this break the
 * rules — and a finding either stands or it does not. The arithmetic lives in
 * backend/src/services/trust-score.ts, where a standing finding costs a fixed
 * amount and stops counting after a year, and every part of that is published
 * next to the number it produced.
 */

/**
 * Amendment V: the share of Delegators an Impeachment needs.
 *
 * The running threshold is in backend/src/services/impeachment.ts, and
 * backend/tests/impeachment.test.ts asserts the two are the same number.
 */
export function canImpeachLeader(
  followerCount: number,
  impeachVotes: number,
  threshold: number = 0.66 // 2/3 majority required
): boolean {
  if (followerCount === 0) return false;
  return (impeachVotes / followerCount) >= threshold;
}
