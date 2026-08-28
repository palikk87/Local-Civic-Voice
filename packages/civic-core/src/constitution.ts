// Civil Voice Constitution
// The Supreme Governing Document of the Platform
// All code, algorithms, and leadership structures are subordinate to this document

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
   */
  enforcedInCode: boolean;
}

export interface Constitution {
  preamble: string;
  articles: ConstitutionalArticle[];
  effectiveDate: string;
  version: string;
  amendments: Amendment[];
}

export interface Amendment {
  id: string;
  number: number;
  title: string;
  content: string;
  ratifiedDate: string;
}

export const CONSTITUTION: Constitution = {
  preamble: `We, the People, in order to reclaim our inherent right to self-governance in a digital age, establish this Constitution. We declare that the Will of the People—verified, deliberated, and transparent—is the supreme authority of this platform. All code, algorithms, and leadership structures are subordinate to this singular objective.`,

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
          content: `The "Public Pulse" (the aggregated, weighted sentiment of verified citizens) shall be the only official output of this platform.`,
          enforcedInCode: true,
        },
        {
          id: 'art1-sec2',
          title: 'Anti-Manipulation',
          content: `No external entity—corporate, governmental, or algorithmic—shall have the power to alter, suppress, or prioritize any segment of the Pulse.`,
          enforcedInCode: true,
        },
        {
          id: 'art1-sec3',
          title: 'The Human Requirement',
          content: `Only verified human beings may contribute to the Pulse. Artificial Intelligence may summarize or facilitate, but it shall have no vote, no weight, and no "voice" in the final tally.`,
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
          content: `Political power on this platform is never "won"; it is only "borrowed."`,
          enforcedInCode: true,
        },
        {
          id: 'art2-sec2',
          title: 'Instant Recall',
          content: `Every user retains the absolute, non-negotiable right to instantly revoke their delegation from any Civil Leader.`,
          enforcedInCode: true,
        },
        {
          id: 'art2-sec3',
          title: 'The Floor, Not the Ceiling',
          content: `Users may always choose to vote directly on any "Master Reference ID," overriding their chosen Leader's stance for that specific instance without losing their long-term delegation.`,
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
          content: `The logic used to calculate the Pulse, the Trust Scores, and the Magnification of Leaders must be publicly auditable.`,
          enforcedInCode: true,
        },
        {
          id: 'art3-sec2',
          title: 'Right to Audit',
          content: `Any user or group of users may demand an "Integrity Audit" of a specific vote if there is evidence of bot interference or system malfunction.`,
          enforcedInCode: true,
        },
        {
          id: 'art3-sec3',
          title: 'Master Reference Integrity',
          content: `Every data point must link back to an official Executive, Legislative, or Judicial source ID to prevent the "Digital Government" from drifting into fiction.`,
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
          title: 'The Electorate (The Users)',
          content: `The sole source of all power. They vote, delegate, and impeach.`,
          enforcedInCode: true,
        },
        {
          id: 'art4-sec2',
          title: 'The Vanguard (The Civil Leaders)',
          content: `Those who earn magnification through merit and expertise. They have no power other than that which is lent to them by the Electorate.`,
          enforcedInCode: true,
        },
        {
          id: 'art4-sec3',
          title: 'The Judiciary (The Community Juries)',
          content: `Randomly selected high-trust users who resolve disputes regarding the Code of Conduct and the Bill of Rights.`,
          enforcedInCode: false,
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
          title: 'Leader Accountability',
          content: `Any Civil Leader who misrepresents the facts of a Federal ID or violates the Code of Conduct shall be subject to immediate demotion by a Jury of their peers.`,
          enforcedInCode: true,
        },
        {
          id: 'art5-sec2',
          title: 'Platform Neutrality',
          content: `If the platform's administrators or developers are found to be biasing the Pulse, the Electorate may trigger a "System-Wide Reset" via a super-majority vote, forcing a roll-back to a neutral state.`,
          enforcedInCode: true,
        },
      ],
    },
  ],

  amendments: [],
  effectiveDate: '2025-01-01',
  version: '1.0',
};

// ==========================================
// CONSTITUTIONAL ENFORCEMENT FUNCTIONS
// ==========================================

/**
 * Article I, Section 3: Verify voter is human
 * AI cannot vote - only facilitate
 */
export function isHumanVoter(voterId: string): boolean {
  // In production, this would verify against authentication
  // AI service accounts would be flagged
  return !voterId.startsWith('ai_') && !voterId.startsWith('bot_');
}

/**
 * Article I, Section 2: Check for manipulation
 * Returns true if the pulse calculation is clean
 */
export interface ManipulationCheck {
  isClean: boolean;
  violations: string[];
}

export function checkPulseManipulation(): ManipulationCheck {
  const violations: string[] = [];

  // These would be actual checks in production
  const hasExternalInterference = false;
  const hasCorporateBias = false;
  const hasGovernmentInfluence = false;
  const hasAlgorithmicBias = false;

  if (hasExternalInterference) violations.push('External interference detected');
  if (hasCorporateBias) violations.push('Corporate bias detected');
  if (hasGovernmentInfluence) violations.push('Government influence detected');
  if (hasAlgorithmicBias) violations.push('Algorithmic bias detected');

  return {
    isClean: violations.length === 0,
    violations,
  };
}

/**
 * Article II, Section 3: Individual vote overrides delegation
 * The user's direct vote always takes precedence
 */
export function getEffectiveVote(
  userDirectVote: 'yea' | 'nay' | null,
  delegatedVote: 'yea' | 'nay' | null
): 'yea' | 'nay' | null {
  // Per Constitution: "Users may always choose to vote directly...
  // overriding their chosen Leader's stance"
  if (userDirectVote !== null) {
    return userDirectVote;
  }
  return delegatedVote;
}

/**
 * Article III, Section 1: Audit trail for pulse calculation
 */
export interface PulseAuditTrail {
  billId: string;
  calculatedAt: string;
  directVotes: {
    yea: number;
    nay: number;
  };
  delegatedVotes: {
    yea: number;
    nay: number;
  };
  totalWeight: {
    yea: number;
    nay: number;
  };
  algorithmVersion: string;
  isAuditable: boolean;
}

export function createPulseAuditTrail(
  billId: string,
  directYea: number,
  directNay: number,
  delegatedYea: number,
  delegatedNay: number
): PulseAuditTrail {
  return {
    billId,
    calculatedAt: new Date().toISOString(),
    directVotes: { yea: directYea, nay: directNay },
    delegatedVotes: { yea: delegatedYea, nay: delegatedNay },
    totalWeight: {
      yea: directYea + delegatedYea,
      nay: directNay + delegatedNay,
    },
    algorithmVersion: '1.0.0',
    isAuditable: true,
  };
}

/**
 * Article III, Section 2: Integrity audit request
 */
export interface IntegrityAuditRequest {
  id: string;
  requestedBy: string[];
  billId: string;
  reason: string;
  evidence: string;
  requestedAt: string;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  result?: {
    isValid: boolean;
    findings: string;
    auditorIds: string[];
  };
}

export function requestIntegrityAudit(
  requesterId: string,
  billId: string,
  reason: string,
  evidence: string
): IntegrityAuditRequest {
  return {
    id: `audit-${Date.now()}`,
    requestedBy: [requesterId],
    billId,
    reason,
    evidence,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
}

/**
 * Article IV, Section 1: Power classification
 */
export type PowerBranch = 'electorate' | 'vanguard' | 'judiciary';

export interface UserPowerClassification {
  userId: string;
  branch: PowerBranch;
  powers: string[];
  limitations: string[];
}

export function classifyUserPower(
  userId: string,
  isCivilLeader: boolean,
  isJuryMember: boolean
): UserPowerClassification {
  if (isJuryMember) {
    return {
      userId,
      branch: 'judiciary',
      powers: [
        'Resolve Code of Conduct disputes',
        'Adjudicate Bill of Rights violations',
        'Demote leaders for misconduct',
      ],
      limitations: [
        'Cannot vote on policy (conflict of interest)',
        'Term-limited jury service',
        'Subject to recusal requirements',
      ],
    };
  }

  if (isCivilLeader) {
    return {
      userId,
      branch: 'vanguard',
      powers: [
        'Receive delegated votes',
        'Magnified voice based on Trust Score',
        'Lead policy discussions',
      ],
      limitations: [
        'Power is borrowed, not owned',
        'Subject to instant recall',
        'Must maintain Trust Score',
        'Subject to impeachment',
      ],
    };
  }

  // Default: Electorate
  return {
    userId,
    branch: 'electorate',
    powers: [
      'Vote directly on all matters',
      'Delegate vote to Civil Leaders',
      'Revoke delegation instantly',
      'Request integrity audits',
      'Impeach Civil Leaders',
      'Trigger System-Wide Reset (super-majority)',
    ],
    limitations: [
      'One person, one vote (or delegation)',
      'Must be verified human',
    ],
  };
}

/**
 * Article V, Section 2: System-Wide Reset threshold
 * Requires super-majority (2/3) of active users
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
