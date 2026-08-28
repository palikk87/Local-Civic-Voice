// Trust & Transparency Layer - Making data trustworthy for real change
// ============================================
// BILL OF RIGHTS ARTICLE III COMPLIANCE:
// "The Vote Details of any federal action shall
// be a public record within the platform."
//
// ARTICLE V COMPLIANCE:
// "A Leader's magnification is tied directly to
// their Trust Score. The community retains the
// right to Impeach or demote any leader."
// ============================================

import type { Bill, Representative, OfficialVoteTally } from './types';

// ==========================================
// DATA SOURCE VERIFICATION
// ==========================================

export type DataSourceType =
  | 'congress_gov' // Official Congress.gov
  | 'govtrack' // GovTrack.us
  | 'propublica' // ProPublica Congress API
  | 'opensecrets' // Campaign finance
  | 'ballotpedia' // Election data
  | 'fec' // Federal Election Commission
  | 'community' // AYE & NAY community data
  | 'ai_generated'; // AI-summarized content

export interface DataSource {
  type: DataSourceType;
  name: string;
  url: string;
  lastUpdated: string;
  trustScore: number; // 0-100
  isOfficial: boolean;
  verificationMethod: 'api' | 'scrape' | 'manual' | 'crowdsourced';
}

export const OFFICIAL_SOURCES: Record<DataSourceType, DataSource> = {
  congress_gov: {
    type: 'congress_gov',
    name: 'Congress.gov',
    url: 'https://www.congress.gov',
    lastUpdated: new Date().toISOString(),
    trustScore: 100,
    isOfficial: true,
    verificationMethod: 'api',
  },
  govtrack: {
    type: 'govtrack',
    name: 'GovTrack.us',
    url: 'https://www.govtrack.us',
    lastUpdated: new Date().toISOString(),
    trustScore: 95,
    isOfficial: false,
    verificationMethod: 'api',
  },
  propublica: {
    type: 'propublica',
    name: 'ProPublica Congress API',
    url: 'https://projects.propublica.org/api-docs/congress-api/',
    lastUpdated: new Date().toISOString(),
    trustScore: 95,
    isOfficial: false,
    verificationMethod: 'api',
  },
  opensecrets: {
    type: 'opensecrets',
    name: 'OpenSecrets',
    url: 'https://www.opensecrets.org',
    lastUpdated: new Date().toISOString(),
    trustScore: 90,
    isOfficial: false,
    verificationMethod: 'api',
  },
  ballotpedia: {
    type: 'ballotpedia',
    name: 'Ballotpedia',
    url: 'https://ballotpedia.org',
    lastUpdated: new Date().toISOString(),
    trustScore: 90,
    isOfficial: false,
    verificationMethod: 'api',
  },
  fec: {
    type: 'fec',
    name: 'Federal Election Commission',
    url: 'https://www.fec.gov',
    lastUpdated: new Date().toISOString(),
    trustScore: 100,
    isOfficial: true,
    verificationMethod: 'api',
  },
  community: {
    type: 'community',
    name: 'AYE & NAY Community',
    url: 'https://ayeandnay.com',
    lastUpdated: new Date().toISOString(),
    trustScore: 70,
    isOfficial: false,
    verificationMethod: 'crowdsourced',
  },
  ai_generated: {
    type: 'ai_generated',
    name: 'AI Summary',
    url: '',
    lastUpdated: new Date().toISOString(),
    trustScore: 60,
    isOfficial: false,
    verificationMethod: 'manual',
  },
};

// ==========================================
// BILL VERIFICATION
// ==========================================

export interface BillVerification {
  billId: string;
  verifiedAt: string;
  sources: DataSource[];
  overallTrustScore: number;
  verificationStatus: 'verified' | 'pending' | 'disputed' | 'outdated';
  discrepancies: Discrepancy[];
  officialLink: string;
  /** Null when congress.gov has not been asked yet. Renders as nothing. */
  lastOfficialUpdate: string | null;
}

export interface Discrepancy {
  field: string;
  sourceA: { source: DataSourceType; value: string };
  sourceB: { source: DataSourceType; value: string };
  resolved: boolean;
  resolution?: string;
}

export function verifyBill(bill: Bill): BillVerification {
  const sources = [OFFICIAL_SOURCES.congress_gov];

  // Add Congress.gov link
  const officialLink = bill.congressUrl || `https://www.congress.gov/bill/119th-congress/${
    bill.chamber === 'house' ? 'house-bill' : 'senate-bill'
  }/${bill.congressNumber?.replace(/[^\d]/g, '')}`;

  // Calculate overall trust score
  const overallTrustScore = calculateTrustScore(bill, sources);

  // Check for discrepancies
  const discrepancies = checkDiscrepancies(bill);

  // Determine verification status
  let verificationStatus: BillVerification['verificationStatus'] = 'verified';
  if (discrepancies.some(d => !d.resolved)) {
    verificationStatus = 'disputed';
  }

  /*
   * "Outdated" needs a date to be outdated FROM.
   *
   * lastActionDate used to be the moment our row was written, so nothing was
   * ever more than a few days old and this branch effectively never fired. It
   * is real now, and absent until congress.gov has been asked — and a record
   * whose last action is unknown is not known to be stale, so the status is
   * left alone rather than asserted.
   */
  const daysSinceUpdate = bill.lastActionDate ? getDaysSince(bill.lastActionDate) : null;
  if (daysSinceUpdate !== null && daysSinceUpdate > 30) {
    verificationStatus = 'outdated';
  }

  return {
    billId: bill.id,
    verifiedAt: new Date().toISOString(),
    sources,
    overallTrustScore,
    verificationStatus,
    discrepancies,
    officialLink,
    lastOfficialUpdate: bill.lastActionDate ?? null,
  };
}

function calculateTrustScore(bill: Bill, sources: DataSource[]): number {
  let score = 0;

  // Base score from sources
  const avgSourceScore = sources.reduce((sum, s) => sum + s.trustScore, 0) / sources.length;
  score += avgSourceScore * 0.4;

  // Bonus for official Congress number
  if (bill.congressNumber) score += 20;

  // Bonus for official vote data
  if (bill.officialVotes) score += 20;

  // Penalty for old data. No date means no penalty: not knowing when a law
  // last moved is not evidence that it moved long ago.
  const daysSinceUpdate = bill.lastActionDate ? getDaysSince(bill.lastActionDate) : null;
  if (daysSinceUpdate !== null && daysSinceUpdate > 30) score -= 10;
  if (daysSinceUpdate !== null && daysSinceUpdate > 90) score -= 20;

  return Math.min(100, Math.max(0, score));
}

function checkDiscrepancies(bill: Bill): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  // Check vote totals add up
  if (bill.officialVotes) {
    const total = bill.officialVotes.yea + bill.officialVotes.nay +
      bill.officialVotes.abstain + bill.officialVotes.notVoting;

    // House has 435 members, Senate has 100
    const expectedTotal = bill.chamber === 'house' ? 435 : 100;

    if (Math.abs(total - expectedTotal) > 5) {
      discrepancies.push({
        field: 'officialVotes.total',
        sourceA: { source: 'congress_gov', value: String(total) },
        sourceB: { source: 'community', value: String(expectedTotal) },
        resolved: false,
      });
    }
  }

  return discrepancies;
}

// ==========================================
// REPRESENTATION GAP VERIFICATION
// ==========================================

export interface GapVerification {
  billId: string;
  publicVoteCount: number;
  publicVoteSource: DataSource;
  officialVoteCount: number;
  officialVoteSource: DataSource;
  gapCalculation: {
    publicYeaPct: number;
    officialYeaPct: number;
    rawGap: number;
    marginOfError: number;
    confidenceLevel: number;
  };
  isStatisticallySignificant: boolean;
  minimumSampleSize: number;
  actualSampleSize: number;
}

export function verifyRepresentationGap(
  bill: Bill,
  officialVotes: OfficialVoteTally
): GapVerification {
  const publicTotal = bill.communityVotes.totalVoters;
  const officialTotal = officialVotes.yea + officialVotes.nay;

  const publicYeaPct = publicTotal > 0
    ? (bill.communityVotes.yea / publicTotal) * 100
    : 50;

  const officialYeaPct = officialTotal > 0
    ? (officialVotes.yea / officialTotal) * 100
    : 50;

  const rawGap = Math.abs(publicYeaPct - officialYeaPct);

  // Statistical significance calculation
  // Using Wilson score interval for confidence
  const minimumSampleSize = 100; // Need at least 100 votes for significance
  const marginOfError = calculateMarginOfError(publicTotal);
  const confidenceLevel = publicTotal >= minimumSampleSize ? 95 : (publicTotal / minimumSampleSize) * 95;

  const isStatisticallySignificant =
    publicTotal >= minimumSampleSize && rawGap > marginOfError * 2;

  return {
    billId: bill.id,
    publicVoteCount: publicTotal,
    publicVoteSource: OFFICIAL_SOURCES.community,
    officialVoteCount: officialTotal,
    officialVoteSource: OFFICIAL_SOURCES.congress_gov,
    gapCalculation: {
      publicYeaPct,
      officialYeaPct,
      rawGap,
      marginOfError,
      confidenceLevel,
    },
    isStatisticallySignificant,
    minimumSampleSize,
    actualSampleSize: publicTotal,
  };
}

function calculateMarginOfError(sampleSize: number): number {
  if (sampleSize === 0) return 100;
  // 95% confidence interval: 1.96 * sqrt(0.25 / n) * 100
  return 1.96 * Math.sqrt(0.25 / sampleSize) * 100;
}

// ==========================================
// ACCOUNTABILITY TOOLS
// ==========================================

export interface RepresentativeAccountability {
  repId: string;
  name: string;
  party: string;
  state: string;

  // Voting record
  totalVotesRecorded: number;
  votesWithConstituents: number;
  votesAgainstConstituents: number;
  alignmentScore: number; // 0-100

  // Gap participation
  significantGapVotes: Array<{
    billId: string;
    billTitle: string;
    repVote: 'yea' | 'nay';
    publicMajority: 'yea' | 'nay';
    gapPct: number;
  }>;

  // Contact info
  contactMethods: {
    phone?: string;
    email?: string;
    website?: string;
    twitter?: string;
    officeAddress?: string;
  };
}

export function calculateRepAccountability(
  rep: Representative,
  votingRecords: Array<{
    billId: string;
    billTitle: string;
    repVote: 'yea' | 'nay';
    publicYeaPct: number;
  }>
): RepresentativeAccountability {
  const significantGapVotes: RepresentativeAccountability['significantGapVotes'] = [];
  let votesWithConstituents = 0;
  let votesAgainstConstituents = 0;

  for (const record of votingRecords) {
    const publicMajority = record.publicYeaPct >= 50 ? 'yea' : 'nay';
    const gapPct = Math.abs(record.publicYeaPct - (record.repVote === 'yea' ? 100 : 0));

    if (record.repVote === publicMajority) {
      votesWithConstituents++;
    } else {
      votesAgainstConstituents++;
    }

    // Track significant gaps (>30%)
    if (gapPct >= 30) {
      significantGapVotes.push({
        billId: record.billId,
        billTitle: record.billTitle,
        repVote: record.repVote,
        publicMajority,
        gapPct,
      });
    }
  }

  const totalVotes = votingRecords.length;
  const alignmentScore = totalVotes > 0
    ? Math.round((votesWithConstituents / totalVotes) * 100)
    : 50;

  return {
    repId: rep.id,
    name: rep.name,
    party: rep.party,
    state: rep.state,
    totalVotesRecorded: totalVotes,
    votesWithConstituents,
    votesAgainstConstituents,
    alignmentScore,
    significantGapVotes,
    contactMethods: {
      phone: rep.contactPhone,
      email: rep.contactEmail,
      website: rep.website,
      twitter: rep.socialMedia?.twitter,
    },
  };
}

// ==========================================
// SHARE TEXT GENERATORS (for real change)
// ==========================================

export function generateAccountabilityShareText(
  bill: Bill,
  gapPct: number,
  rep?: RepresentativeAccountability
): string {
  const baseText = `🗳️ AYE & NAY GAP ALERT\n\n"${bill.shortTitle}"\n\n📊 ${Math.round(gapPct)}% gap between citizens and Congress!\n`;

  if (rep) {
    const alignment = rep.alignmentScore >= 70 ? 'often aligns' : 'frequently disagrees';
    return baseText +
      `\n👤 ${rep.name} (${rep.party}-${rep.state}) ${alignment} with constituents (${rep.alignmentScore}% alignment)\n` +
      `\n📞 Contact: ${rep.contactMethods.phone || 'N/A'}\n` +
      `\n#AyeAndNay #Accountability #YourVoteMatters`;
  }

  return baseText +
    `\nCongress isn't listening. Make YOUR voice heard.\n` +
    `\n#AyeAndNay #RepresentationGap #Democracy`;
}

export function generateBillShareText(bill: Bill, verification: BillVerification): string {
  const statusEmoji = {
    introduced: '📝',
    in_committee: '🏛️',
    passed_house: '✅',
    passed_senate: '✅',
    enacted: '📜',
    vetoed: '❌',
    signed_into_law: '🎉',
  };

  const emoji = statusEmoji[bill.status] || '📋';
  const yeaPct = Math.round((bill.communityVotes.yea / Math.max(1, bill.communityVotes.totalVoters)) * 100);

  return `${emoji} ${bill.shortTitle}\n\n` +
    `📊 Community: ${yeaPct}% support (${bill.communityVotes.totalVoters.toLocaleString()} votes)\n` +
    `🔍 Trust Score: ${verification.overallTrustScore}%\n` +
    `📎 ${verification.officialLink}\n\n` +
    `Have YOUR say on AYE & NAY!\n` +
    `#AyeAndNay #${bill.category}`;
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getDaysSince(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

// ==========================================
// VERIFICATION UI HELPERS
// ==========================================

export function getTrustBadge(score: number): {
  label: string;
  color: string;
  icon: string;
} {
  if (score >= 90) {
    return { label: 'Highly Trusted', color: '#22C55E', icon: '✓✓' };
  }
  if (score >= 70) {
    return { label: 'Trusted', color: '#3B82F6', icon: '✓' };
  }
  if (score >= 50) {
    return { label: 'Moderate', color: '#F59E0B', icon: '~' };
  }
  return { label: 'Unverified', color: '#EF4444', icon: '?' };
}

export function getGapConfidenceBadge(confidence: number): {
  label: string;
  color: string;
} {
  if (confidence >= 95) {
    return { label: 'High Confidence', color: '#22C55E' };
  }
  if (confidence >= 80) {
    return { label: 'Good Confidence', color: '#3B82F6' };
  }
  if (confidence >= 60) {
    return { label: 'Moderate Confidence', color: '#F59E0B' };
  }
  return { label: 'Low Confidence - More Votes Needed', color: '#EF4444' };
}

export function getAlignmentBadge(score: number): {
  label: string;
  color: string;
  description: string;
} {
  if (score >= 80) {
    return {
      label: 'Highly Aligned',
      color: '#22C55E',
      description: 'This representative frequently votes with their constituents',
    };
  }
  if (score >= 60) {
    return {
      label: 'Moderately Aligned',
      color: '#3B82F6',
      description: 'This representative sometimes differs from constituent preferences',
    };
  }
  if (score >= 40) {
    return {
      label: 'Mixed Record',
      color: '#F59E0B',
      description: 'This representative often votes differently than their constituents',
    };
  }
  return {
    label: 'Low Alignment',
    color: '#EF4444',
    description: 'This representative frequently votes against constituent preferences',
  };
}

// ==========================================
// CIVIL LEADER TRUST — DELIBERATELY NOT HERE
// ==========================================
//
// This file used to carry `CivilLeaderTrust`, `calculateCivilLeaderTrust`,
// `FalsehoodReport`, `reportLeaderFalsehood` and `getCivilLeaderBadge`. All of
// it was deleted, and none of it was replaced in kind.
//
// WHY IT WENT. Nothing had ever called any of it, and it could not have worked
// if anything had: the calculation read `const impeachmentVotes = 0; // Would
// come from database`, so every score it produced was a formula over a number
// nobody fetched. It also returned a `magnificationMultiplier` — a leader's
// reach, multiplied by their score.
//
// WHY IT IS NOT COMING BACK IN THIS SHAPE. "Trust scores are not meant to rank
// anyone. They are meant to inform people when delegating votes." A score that
// multiplies reach is the platform deciding what people see, which the Bill of
// Rights reserves to delegated votes alone.
//
// The real thing lives in backend/src/services/trust-score.ts. It is computed
// from rows that exist, it publishes every part it is made of, it says "not
// enough yet" rather than scoring an empty record, and it touches nothing but
// the screens where somebody is choosing a delegate.
