// THE CONSTITUTION OF AYE & NAY
//
// The supreme governing document of the platform, and the only copy of it.
// Both clients read this file; neither keeps text of its own.
//
// The Bill of Rights is not a second document. It is Amendments I–V, at the
// bottom of this file, and it is part of this Constitution. Where an Amendment
// and an Article conflict, the Amendment governs.
//
// WHAT THIS REWRITE WAS FOR. The previous text promised five things the
// platform does not do: immediate demotion by a jury, the "magnification" of
// leaders, encrypted personal data, a check on citizenship, and a Trust Score
// that determines influence. A platform whose whole argument is that it tells
// you the truth about what happened cannot ship a constitution that is wrong
// about itself. Every sentence here describes something the code actually
// does, or it is not here.
//
// Numbers are deliberately absent. Panel sizes, the delegation count that
// carries the Civil Leader title, the privacy floor and the clocks are served
// live from /api/juries/rules and /api/audits/rules, so a threshold can never
// be true in the document and false in the build.

export interface ConstitutionalArticle {
  id: string;
  number: string; // Roman numeral
  title: string;
  sections: ConstitutionalSection[];
  icon: string;
}

export interface ConstitutionalSection {
  id: string;
  title: string;
  content: string;
  /**
   * TRUE MEANS A TEST PROVES IT.
   *
   * This used to sit beside a `codeReference` file path — and three of those
   * paths pointed at files that had since been deleted. A clause claiming
   * enforcement while citing a file that does not exist is worse than a clause
   * claiming nothing.
   *
   * The rule is mechanical now: a clause may set this true only if a test
   * somewhere under backend/tests carries its id in the test name, like
   * `[art2-sec2]`. backend/tests/constitution-enforced.test.ts reads this file
   * and fails the build otherwise. The badge on the screen cannot outrun the
   * suite, and the counter beside it is counted rather than typed.
   *
   * Article VI is that rule, written down.
   */
  enforcedInCode: boolean;
}

/** One entry of Article VII. Binding, not glossary decoration. */
export interface Definition {
  term: string;
  meaning: string;
}

/**
 * An Amendment carries the same badge as an Article, earned the same way: a
 * test under backend/tests naming it, like `[bor-art5]`. The ids keep their
 * `bor-` prefix because that is what the existing tests are tagged with, and
 * moving a tag to make a name prettier is how a proof quietly stops proving.
 */
export interface Amendment {
  id: string;
  number: string; // Roman numeral
  title: string;
  subtitle: string;
  content: string;
  icon: string;
  enforcedInCode: boolean;
}

export interface Constitution {
  preamble: string;
  articles: ConstitutionalArticle[];
  definitions: {
    number: string;
    title: string;
    note: string;
    terms: Definition[];
  };
  amendments: Amendment[];
  amendmentsNote: string;
  effectiveDate: string;
  version: string;
}

export const CONSTITUTION: Constitution = {
  preamble: `We, the People, in order to reclaim our inherent right to self-governance in a digital age, establish this Constitution. We declare that the Will of the People — verified, deliberated, and transparent — is the supreme authority of this platform. All code, algorithms, and leadership structures are subordinate to this singular objective.`,

  articles: [
    {
      id: 'article-1',
      number: 'I',
      title: 'The Supremacy of the Pulse',
      icon: 'Activity',
      sections: [
        {
          id: 'art1-sec1',
          title: 'The Pulse as Law',
          content: `The Public Pulse shall be the only official output of this platform.`,
          enforcedInCode: true,
        },
        {
          id: 'art1-sec2',
          title: 'Anti-Manipulation',
          content: `No external entity, corporate, governmental or algorithmic, shall have the power to alter, suppress or prioritize any segment of the Pulse.`,
          enforcedInCode: true,
        },
        {
          id: 'art1-sec3',
          title: 'The Human Requirement',
          content: `The Pulse is a count of people. The platform shall take reasonable measures to satisfy itself that a person is present before a voice is counted, and shall not describe as Verified a Citizen it has not verified. Artificial Intelligence may summarize or assist; it holds no vote and no weight in any tally.`,
          enforcedInCode: true,
        },
      ],
    },
    {
      id: 'article-2',
      number: 'II',
      title: 'The Doctrine of Liquid Sovereignty',
      icon: 'Droplets',
      sections: [
        {
          id: 'art2-sec1',
          title: 'The Reclaimable Voice',
          content: `Political power on this platform is never won; it is only borrowed.`,
          enforcedInCode: true,
        },
        {
          id: 'art2-sec2',
          title: 'Instant Recall',
          content: `Every Citizen retains the absolute, non-negotiable right to instantly revoke their Delegation, from whomever they lent it to, at any time and for any reason.`,
          enforcedInCode: true,
        },
        {
          id: 'art2-sec3',
          title: 'The Floor, Not the Ceiling',
          content: `Citizens may always speak for themselves on any matter before the platform, overriding the stance of the one they lent their voice to, without ending the loan.`,
          enforcedInCode: true,
        },
      ],
    },
    {
      id: 'article-3',
      number: 'III',
      title: 'The Transparency of the Architecture',
      icon: 'Eye',
      sections: [
        {
          id: 'art3-sec1',
          title: 'The Open Ledger',
          content: `The method by which the Pulse and every published measure is calculated shall be open to inspection. The platform shall publish no figure it will not explain.`,
          enforcedInCode: true,
        },
        {
          id: 'art3-sec2',
          title: 'The Right to Audit',
          content: `Any Citizen or group of Citizens may demand an Integrity Audit of a vote where there is evidence of interference or malfunction. No permission is required and no Officer of this platform may refuse it.

An Audit shall answer in counts, never in names. Where a finding cannot be given without exposing an individual, it shall not be given. Audits are public and permanent, and one shall accompany any charge brought under Article V, so that none may be judged upon evidence they have not seen.`,
          enforcedInCode: true,
        },
        {
          id: 'art3-sec3',
          title: 'Nothing Invented',
          content: `Every Record the platform carries shall trace back to a real act of government and to the source that issued it. The platform shall report what government did, and shall not invent, embellish or estimate it.`,
          enforcedInCode: true,
        },
      ],
    },
    {
      id: 'article-4',
      number: 'IV',
      title: 'The Separation of Powers',
      icon: 'Scale',
      sections: [
        {
          id: 'art4-sec1',
          title: 'The Electorate',
          content: `The sole source of all power. They vote, they delegate, and they impeach.`,
          enforcedInCode: true,
        },
        {
          id: 'art4-sec2',
          title: 'The Vanguard',
          content: `Whoever carries a borrowed voice holds nothing but what was lent them, and holds it on the same terms whether they carry one voice or a thousand. The title of Civil Leader carries no amplification, no advantage in what Citizens are shown, and no immunity from this Constitution. It marks how many have lent, and nothing more.`,
          enforcedInCode: true,
        },
        {
          id: 'art4-sec3',
          title: 'The Judiciary',
          content: `Disputes of conduct are settled by Juries drawn at random from Citizens the community has already entrusted with a voice.

None shall sit in judgement upon anyone to whom they have lent their voice, nor upon any matter in which they are a party. A Juror shall give their reasons. The drawing of every Jury shall remain open to examination afterwards, that no verdict rest on a panel no one may inspect.`,
          enforcedInCode: true,
        },
      ],
    },
    {
      id: 'article-5',
      number: 'V',
      title: 'The Self-Correction Mechanism',
      icon: 'RotateCcw',
      sections: [
        {
          id: 'art5-sec1',
          title: 'Accountability for Borrowed Voice',
          content: `Anyone carrying a borrowed voice who is found by a Jury to have misrepresented what a law says shall carry that Finding publicly and permanently.

The platform shall impose no penalty of its own. Those who lent their voice shall be told, and the decision to withdraw it is theirs alone. What was borrowed is recalled by the lender, never by the platform on their behalf.`,
          enforcedInCode: true,
        },
        {
          id: 'art5-sec2',
          title: 'Platform Neutrality',
          content: `If the Officers of this platform are found to be biasing the Pulse, the Electorate may trigger a System-Wide Reset by super-majority, forcing a roll-back to a neutral state.`,
          enforcedInCode: true,
        },
        {
          id: 'art5-sec3',
          title: 'No Officer May Halt a Proceeding',
          content: `No Proceeding under this Article may be halted, delayed or reversed by any Officer, at any level of authority. Redress against a charge brought in bad faith lies against the one who brought it, and does not suspend the Proceeding. The right to bring a charge does not belong to those being charged.`,
          enforcedInCode: true,
        },
      ],
    },
    {
      id: 'article-6',
      number: 'VI',
      title: 'How This Constitution Is Kept',
      icon: 'Shield',
      sections: [
        {
          id: 'art6-sec1',
          title: 'Enforced in Code, or Not Claimed',
          content: `No clause of this Constitution may claim to be enforced in code unless an automated test bearing that clause's name proves it, and passes. The count of enforced clauses shall be counted, never asserted. A clause that loses its proof loses its claim, and the platform shall not build until the two agree.`,
          enforcedInCode: true,
        },
      ],
    },
  ],

  definitions: {
    number: 'VII',
    title: 'Definitions',
    note: `Binding. Every capitalised term in this Constitution carries the meaning given here and no other.`,
    terms: [
      {
        term: 'Platform',
        meaning: `AYE & NAY: the software, the data it holds, and the organisation operating it.`,
      },
      {
        term: 'Citizen',
        meaning: `Any person holding an account.`,
      },
      {
        term: 'Verified',
        meaning: `A Citizen who has confirmed their sign-up and satisfied the platform that a person is present.`,
      },
      {
        term: 'Electorate',
        meaning: `All Citizens, taken together.`,
      },
      {
        term: 'Officer',
        meaning: `Any administrator, developer, operator or owner of the platform.`,
      },
      {
        term: 'Record',
        meaning: `Any bill, executive order or court ruling the platform carries, together with the official source that issued it.`,
      },
      {
        term: 'The Pulse',
        meaning: `The aggregated, weighted sentiment of Citizens on a Record: direct votes and the Delegated voice carried with them.`,
      },
      {
        term: 'Delegation',
        meaning: `The lending of a Citizen's voice to another Citizen, revocable instantly and without penalty. Never a transfer. Any Citizen may receive one.`,
      },
      {
        term: 'Delegator',
        meaning: `A Citizen who has lent their voice to another.`,
      },
      {
        term: 'Civil Leader',
        meaning: `A Citizen carrying delegated votes at or above the threshold the platform publishes with its rules. The title is descriptive; it confers nothing and withholds nothing.`,
      },
      {
        term: 'Vanguard',
        meaning: `All Citizens carrying a borrowed voice, whatever its size.`,
      },
      {
        term: 'Trust Score',
        meaning: `A published description of what an account has done on this platform. It informs a Citizen choosing whether to delegate. It is not a rank and has no effect on what any Citizen is shown.`,
      },
      {
        term: 'Integrity Audit',
        meaning: `An examination of a vote, a Citizen's delegated support, or a Proceeding, reported in counts and never in names.`,
      },
      {
        term: 'Jury',
        meaning: `Citizens drawn at random from those who have earned delegate standing, to settle one dispute of conduct and give reasons.`,
      },
      {
        term: 'Juror',
        meaning: `A Citizen serving on a Jury.`,
      },
      {
        term: 'Finding',
        meaning: `A Jury's determination that conduct breached the Code of Conduct or this Constitution. A public record, and not a punishment.`,
      },
      {
        term: 'Proceeding',
        meaning: `An Impeachment or a System-Wide Reset, from the moment it is opened until it is decided.`,
      },
      {
        term: 'Impeachment',
        meaning: `The recall, by the Delegators of anyone carrying a borrowed voice, of the voice they lent. It suspends the receiving of Delegations and nothing else.`,
      },
      {
        term: 'System-Wide Reset',
        meaning: `The return of all borrowed voice and the zeroing of every published tally, by super-majority of the Electorate.`,
      },
      {
        term: 'Anonymous',
        meaning: `A position recorded without attribution to the Citizen who took it. An Anonymous position may never be used to describe or discover them.`,
      },
      {
        term: 'Amendment',
        meaning: `The articles of rights set out below, which are part of this Constitution.`,
      },
    ],
  },

  amendmentsNote: `Part of this Constitution. Where an Amendment and an Article conflict, the Amendment governs.`,

  amendments: [
    {
      id: 'bor-art1',
      number: 'I',
      title: 'Individual Sovereignty',
      subtitle: 'Liquid Democracy',
      icon: 'Crown',
      content: `No Citizen shall be permanently bound to anyone they have lent their voice to. The power of the vote originates in the individual and is only lent, never given. Every Citizen retains the absolute right to instantly revoke or reassign their Delegation at any time, for any reason, without delay or penalty.`,
      enforcedInCode: true,
    },
    {
      id: 'bor-art2',
      number: 'II',
      title: 'Algorithmic Neutrality',
      subtitle: 'Public Pulse Integrity',
      icon: 'Scale',
      content: `The Pulse shall not be manipulated for profit, engagement or bias. The platform shall remain a neutral conduit for human intent. No black-box algorithm shall amplify one voice over another on grounds of outrage or commercial interest.

No measure of a person shall decide what any Citizen is shown. Prominence is conferred by Delegation and by nothing else.`,
      enforcedInCode: true,
    },
    {
      id: 'bor-art3',
      number: 'III',
      title: 'Redress and Transparency',
      subtitle: 'Vote Details',
      icon: 'Eye',
      content: `The vote details of any government action shall be a public record within the platform. Every Citizen has the right to see the mathematical path of a decision, and to require that any published tally be proven against the votes beneath it. No dark money or automated influence shall obscure the true will of the people.`,
      enforcedInCode: true,
    },
    {
      id: 'bor-art4',
      number: 'IV',
      title: 'Data Security and Anonymity',
      subtitle: 'Digital Privacy',
      icon: 'Shield',
      content: `The right of the people to be secure in their digital persons, papers and effects shall not be violated.

The platform shall collect only what it needs to function. It shall demand no proof of a Citizen's identity or nationality, and shall never present a Citizen's private contact details as their public name. A voice given Anonymously shall remain Anonymous.

The platform shall state what it protects and how, and shall claim no protection it does not provide.`,
      enforcedInCode: true,
    },
    {
      id: 'bor-art5',
      number: 'V',
      title: 'Accountability for Borrowed Voice',
      subtitle: 'Borrowed Voice',
      icon: 'Award',
      content: `The status of Civil Leader is a privilege granted by the community, not a right of the platform. It confers no amplification, no advantage, and no protection.

The community retains the right to Impeach anyone carrying a borrowed voice who violates the platform's integrity or spreads verifiable falsehoods, as determined by the collective will of those who lent it.`,
      enforcedInCode: true,
    },
  ],

  effectiveDate: '2026-08-28',
  version: '2.0',
};

// ==========================================
// WHAT THE DOCUMENT LEANS ON
// ==========================================

/**
 * WHAT WAS DELETED HERE, AND WHY.
 *
 * This file used to carry six helpers that no caller ever had:
 *
 *   isHumanVoter()          — returned true unless the id began "ai_" or
 *                             "bot_". The real check is a Turnstile challenge
 *                             at sign-up plus a verified flag on every vote
 *                             route; see backend/src/services/human-check.ts.
 *   checkPulseManipulation()— declared four `const has… = false` and then
 *                             reported the Pulse clean. A self-audit that
 *                             cannot fail is not an audit, and this is the
 *                             exact shape of the "11 of 11" bar that Article
 *                             VI now forbids.
 *   createPulseAuditTrail() — built a tally object from numbers handed to it.
 *                             The real breakdown is computed from the vote
 *                             rows and served at
 *                             /api/government-references/:id/vote-details.
 *   requestIntegrityAudit() — made an object with a `Date.now()` id and status
 *                             "pending". Article III §2 is real now:
 *                             backend/src/services/integrity-audit.ts.
 *   classifyUserPower()     — listed "Magnified voice based on Trust Score"
 *                             and "Demote leaders for misconduct" as powers.
 *                             Neither exists. A Trust Score magnifies nothing
 *                             and a Jury demotes nobody.
 *
 * Each of them described a platform we do not have, in a file whose whole
 * purpose is to say what we do have.
 */

/**
 * Article II, Section 3: a Citizen's own vote overrides the one they lent.
 *
 * The Pulse itself is computed in backend/src/services/voting.ts; this is the
 * same rule stated once, in the document that requires it.
 */
export function getEffectiveVote(
  userDirectVote: 'yea' | 'nay' | null,
  delegatedVote: 'yea' | 'nay' | null
): 'yea' | 'nay' | null {
  if (userDirectVote !== null) {
    return userDirectVote;
  }
  return delegatedVote;
}

/**
 * Article V, Section 2: the super-majority a System-Wide Reset needs.
 *
 * backend/tests/system-reset.test.ts reads this constant out of this file and
 * asserts the running service uses the same one, so the Constitution and the
 * build cannot drift apart on the number that matters most.
 */
export const SYSTEM_RESET_THRESHOLD = 0.66; // 66% super-majority

export interface SystemResetVote {
  id: string;
  initiatedAt: string;
  reason: string;
  evidence: string;
  votesFor: number;
  votesAgainst: number;
  totalEligibleVoters: number;
  status: 'voting' | 'passed' | 'failed' | 'executed';
  expiresAt: string; // 7 day voting window
}

export function canTriggerSystemReset(vote: SystemResetVote): boolean {
  const totalVotes = vote.votesFor + vote.votesAgainst;
  const participation = totalVotes / vote.totalEligibleVoters;

  // Need at least 50% participation and 66% approval
  if (participation < 0.5) return false;
  if (vote.votesFor / totalVotes < SYSTEM_RESET_THRESHOLD) return false;

  return true;
}

// ==========================================
// ARTICLE VI, COUNTED
// ==========================================

/**
 * How many clauses are genuinely enforced, counted rather than typed.
 *
 * WHAT THIS REPLACED. `getConstitutionalCompliance()` returned eleven
 * hardcoded entries, every one `isCompliant: true` with a sentence of prose
 * beside it. The phone rendered it as "11 of 11 provisions are enforced in
 * code" over a full green bar. It could not report a failure even in
 * principle, and three of its eleven claims were false — including "Integrity
 * audit system is available", for a feature that did not exist in any form.
 *
 * A self-audit that always passes is not an audit. This counts the flags, and
 * backend/tests/constitution-enforced.test.ts is what makes each flag mean
 * something: no clause may claim enforcement without a test named for it.
 */
export interface ConstitutionalEnforcement {
  enforced: number;
  total: number;
  /** The clauses that are not yet enforced, so a screen can name them. */
  outstanding: { article: string; section: string }[];
}

export function getConstitutionalEnforcement(): ConstitutionalEnforcement {
  const outstanding: { article: string; section: string }[] = [];
  let enforced = 0;
  let total = 0;

  for (const article of CONSTITUTION.articles) {
    for (const section of article.sections) {
      total += 1;
      if (section.enforcedInCode) enforced += 1;
      else outstanding.push({ article: article.number, section: section.title });
    }
  }

  return { enforced, total, outstanding };
}

/**
 * The same count for the Amendments, for the same reason.
 *
 * The Bill of Rights badge printed "5 Articles enshrined in code" — the article
 * count, relabelled as a claim about enforcement. It would have read the same
 * with nothing behind any of them. Article VI does not stop at the Articles.
 */
export function getAmendmentEnforcement(): ConstitutionalEnforcement {
  const outstanding: { article: string; section: string }[] = [];
  let enforced = 0;

  for (const amendment of CONSTITUTION.amendments) {
    if (amendment.enforcedInCode) enforced += 1;
    else outstanding.push({ article: amendment.number, section: amendment.title });
  }

  return { enforced, total: CONSTITUTION.amendments.length, outstanding };
}
