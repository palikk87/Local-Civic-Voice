// Civil Voice Bill of Rights
// A Covenant for the Digital Body Politic
// These principles govern the operation of the entire platform

export interface Article {
  id: string;
  number: string; // Roman numeral
  title: string;
  subtitle: string;
  content: string;
  principles: string[]; // Key principles enforced in code
  icon: string; // Icon name from lucide-react-native
}

export interface BillOfRights {
  preamble: string;
  articles: Article[];
  effectiveDate: string;
  version: string;
}

export const BILL_OF_RIGHTS: BillOfRights = {
  preamble: `We, the Users of AYE & NAY, in order to form a more perfect Union of citizens and technology, do hereby establish these fundamental rights to ensure the integrity of our collective voice and the security of our individual sovereignty.`,

  articles: [
    {
      id: 'article-1',
      number: 'I',
      title: 'The Right of Individual Sovereignty',
      subtitle: 'Liquid Democracy',
      content: `No user shall be permanently bound to any representative or leader. The power of the vote originates in the individual and is only lent, never given. Every citizen retains the absolute right to instantly revoke or reassign their delegation at any time, for any reason, without delay or penalty.`,
      principles: [
        'Instant delegation revocation',
        'No lock-in periods on delegations',
        'Individual vote always overrides delegation',
        'Transparent delegation chains',
      ],
      icon: 'Crown',
    },
    {
      id: 'article-2',
      number: 'II',
      title: 'The Right to Algorithmic Neutrality',
      subtitle: 'Public Pulse Integrity',
      content: `The "Public Pulse" shall not be manipulated for profit, engagement, or bias. The platform shall remain a neutral conduit for human intent. No "Black Box" algorithm shall amplify one voice over another based on outrage or commercial interest; only the verifiable weight of Liquid Democracy shall determine the prominence of an idea.`,
      principles: [
        'No engagement-based manipulation',
        'No profit-driven amplification',
        'Transparent ranking factors',
        'Equal voice weight by default',
      ],
      icon: 'Scale',
    },
    {
      id: 'article-3',
      number: 'III',
      title: 'The Right of Redress & Transparency',
      subtitle: 'Vote Details',
      content: `The "Vote Details" of any federal action shall be a public record within the platform. Every user has the right to see the mathematical path of a decision—to know exactly how many direct votes and delegated weights formed the Pulse. No "Dark Money" or bot-driven influence shall be permitted to obscure the true will of the people.`,
      principles: [
        'Public vote tallies',
        'Visible delegation weights',
        'Anti-bot verification',
        'No hidden influence',
      ],
      icon: 'Eye',
    },
    {
      id: 'article-4',
      number: 'IV',
      title: 'The Right to Data Security & Anonymity',
      subtitle: 'Digital Privacy',
      content: `The right of the people to be secure in their digital persons, papers, and effects shall not be violated. AYE & NAY shall collect only the minimum data necessary to verify citizenship and jurisdiction. Personal identity shall remain shielded from the federal government and third parties, ensuring that the "Public Pulse" is a reflection of honest conviction, not a target for surveillance.`,
      principles: [
        'Minimal data collection',
        'No government data sharing',
        'Anonymous voting option',
        'Encrypted personal data',
      ],
      icon: 'Shield',
    },
    {
      id: 'article-5',
      number: 'V',
      title: 'The Right to Meritocratic Leadership',
      subtitle: 'Civil Leader Accountability',
      content: `The status of "Civil Leader" is a privilege granted by the community, not a right of the platform. A Leader's magnification is tied directly to their Trust Score. The community retains the right to "Impeach" or demote any leader who violates the platform's integrity or spreads verifiable falsehoods, as determined by the collective will of their followers.`,
      principles: [
        'Community-granted leadership',
        'Trust Score determines influence',
        'Community impeachment rights',
        'Falsehood accountability',
      ],
      icon: 'Award',
    },
  ],

  effectiveDate: '2025-01-01',
  version: '1.0',
};

// Helper functions to check compliance with Bill of Rights principles

/**
 * Article I: Check if a delegation can be revoked immediately
 * Returns true always - delegations must be instantly revocable
 */
export function canRevokeDelegate(): boolean {
  return true; // Always true per Article I
}

/**
 * Article I: Check if individual vote overrides delegation
 */
export function doesIndividualVoteOverride(): boolean {
  return true; // Always true per Article I
}

/**
 * Article II: Validate feed algorithm neutrality
 * Returns factors that are allowed to influence ranking
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
 * Article III: Get transparency requirements for vote display
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
 * Article IV: Data collection limits
 */
export interface DataCollectionPolicy {
  collectsOnlyEssential: boolean;
  sharesWithGovernment: boolean;
  sharesWithThirdParties: boolean;
  allowsAnonymousVoting: boolean;
  encryptsPersonalData: boolean;
}

export function getDataPolicy(): DataCollectionPolicy {
  return {
    collectsOnlyEssential: true,
    sharesWithGovernment: false,
    sharesWithThirdParties: false,
    allowsAnonymousVoting: true,
    encryptsPersonalData: true,
  };
}

/**
 * Article V: Civil Leader requirements
 */
export interface LeaderRequirements {
  communityGranted: boolean;
  trustScoreBased: boolean;
  canBeImpeached: boolean;
  accountableForFalsehoods: boolean;
}

export function getLeaderRequirements(): LeaderRequirements {
  return {
    communityGranted: true,
    trustScoreBased: true,
    canBeImpeached: true,
    accountableForFalsehoods: true,
  };
}

/**
 * Calculate Trust Score penalty for falsehoods
 * Per Article V, leaders spreading verifiable falsehoods face penalties
 */
export function calculateFalsehoodPenalty(
  currentTrustScore: number,
  falsehoodSeverity: 'minor' | 'moderate' | 'severe'
): number {
  const penalties = {
    minor: 0.05, // 5% reduction
    moderate: 0.15, // 15% reduction
    severe: 0.30, // 30% reduction
  };

  return Math.max(0, currentTrustScore * (1 - penalties[falsehoodSeverity]));
}

/**
 * Check if a leader can be impeached based on follower votes
 * Per Article V, community retains impeachment rights
 */
export function canImpeachLeader(
  followerCount: number,
  impeachVotes: number,
  threshold: number = 0.66 // 2/3 majority required
): boolean {
  if (followerCount === 0) return false;
  return (impeachVotes / followerCount) >= threshold;
}
