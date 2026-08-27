// Bill and voting related types

// Government Branch identifier
export type GovernmentBranch = 'legislative' | 'executive' | 'judicial';

export interface Bill {
  id: string;
  title: string;
  shortTitle: string;
  status: 'introduced' | 'in_committee' | 'passed_house' | 'passed_senate' | 'enacted' | 'vetoed' | 'signed_into_law';
  chamber: 'house' | 'senate';
  /**
   * OPTIONAL, BECAUSE A SPONSOR WE HAVE NOT FETCHED IS NOT A SPONSOR.
   *
   * Required, this field forced every mapper to produce one, and both of them
   * did — naming the chamber ("U.S. House of Representatives", party
   * Independent, state US, blank avatar) for every bill on the platform. A
   * field that cannot be left out is a field that gets invented.
   */
  sponsor?: Representative;
  /**
   * Also optional, and for the same reason: both were filled with the moment
   * OUR row was written, so a 2007 statute read as introduced today.
   */
  introducedDate?: string;
  lastActionDate?: string;
  category: BillCategory;
  congressNumber?: string; // e.g., "H.R.82", "S.596"
  congressUrl?: string; // Link to Congress.gov
  fullText: string;
  simplifiedText: string;
  realWorldImpact: string;
  relatedLaws: RelatedLaw[];
  communityVotes: VoteTally;
  /*
   * PROJECTED OUTCOME IS GONE, AND NOT REPLACED.
   *
   * It was computed as `votes.support > votes.oppose ? 'likely_pass' :
   * 'uncertain'` — the app's own users' opinions, relabelled as a prediction
   * about what Congress will do. A reader saw "Likely to Pass" on a bill
   * sitting in committee with eleven votes on it, and nothing on the card said
   * where that came from, because there was nowhere honest for it to come from.
   *
   * There is no column for it in the database and never was; the field was
   * invented at the edge, in three different mappers, three different ways.
   * Whether a bill will pass is a real question with a real answer nobody has,
   * and a platform whose claim is that its records are the true ones cannot
   * answer it by taking a poll of its own readers.
   *
   * Status, sponsor, introduction date and last action are all real, all from
   * congress.gov, and all still shown. They are what we actually know.
   */
  officialVotes?: OfficialVoteTally;
  citizensBrief?: CitizensBrief; // AI-generated brief
  branch?: GovernmentBranch; // Default to 'legislative'
}

// Executive Order types
export interface ExecutiveOrder {
  id: string;
  eoNumber: string; // e.g., "EO 14147"
  title: string;
  shortTitle: string;
  president: string;
  signedDate: string;
  publishedDate: string;
  status: 'active' | 'revoked' | 'superseded' | 'expired' | 'partially_revoked';
  category: BillCategory;
  federalRegisterNumber?: string;
  federalRegisterUrl?: string;
  fullText: string;
  simplifiedText: string;
  realWorldImpact: string;
  communityVotes: VoteTally;
  relatedOrders?: string[]; // IDs of related EOs
  revokedBy?: string; // EO that revoked this one
  revokes?: string[]; // EOs this one revokes
  branch: 'executive';
}

// Supreme Court Case types
export interface SupremeCourtCase {
  id: string;
  docketNumber: string; // e.g., "22-451"
  caseName: string;
  shortName: string;
  term: string; // e.g., "2024"
  arguedDate?: string;
  decidedDate?: string;
  status: 'pending' | 'argued' | 'decided' | 'dismissed' | 'remanded';
  outcome?: 'affirmed' | 'reversed' | 'vacated' | 'remanded' | 'dismissed' | 'per_curiam';
  voteBreakdown?: {
    majority: number;
    dissent: number;
    concurring?: number;
  };
  category: BillCategory;
  lowerCourt: string;
  petitioner: string;
  respondent: string;
  questionPresented: string;
  simplifiedQuestion: string;
  majorityOpinion?: string;
  dissentOpinion?: string;
  realWorldImpact: string;
  communityVotes: VoteTally;
  justiceVotes?: JusticeVote[];
  courtListenerUrl?: string;
  branch: 'judicial';
}

export interface JusticeVote {
  justiceName: string;
  vote: 'majority' | 'dissent' | 'concurrence' | 'concur_in_part' | 'dissent_in_part';
  wroteOpinion: boolean;
}

export interface Justice {
  id: string;
  name: string;
  appointedBy: string;
  appointedYear: number;
  isChiefJustice: boolean;
  imageUrl: string;
  ideology: 'conservative' | 'liberal' | 'moderate';
}

// Union type for any government action
export type GovernmentAction = Bill | ExecutiveOrder | SupremeCourtCase;

// Helper to determine action type
export function isExecutiveOrder(action: GovernmentAction): action is ExecutiveOrder {
  return 'eoNumber' in action;
}

export function isSupremeCourtCase(action: GovernmentAction): action is SupremeCourtCase {
  return 'docketNumber' in action;
}

export function isBill(action: GovernmentAction): action is Bill {
  return 'chamber' in action && !('eoNumber' in action);
}

export type BillCategory =
  | 'healthcare'
  | 'education'
  | 'environment'
  | 'economy'
  | 'civil_rights'
  | 'defense'
  | 'immigration'
  | 'technology'
  | 'housing'
  | 'infrastructure';

export interface RelatedLaw {
  id: string;
  title: string;
  type: 'statutory' | 'case_law' | 'regulation' | 'constitutional';
  relationship: 'amends' | 'conflicts' | 'supports' | 'references';
  summary: string;
}

export interface VoteTally {
  yea: number;
  nay: number;
  totalVoters: number;
}

export interface OfficialVoteTally {
  yea: number;
  nay: number;
  abstain: number;
  notVoting: number;
}

export interface Representative {
  id: string;
  name: string;
  party: 'D' | 'R' | 'I';
  state: string;
  district?: string;
  chamber: 'house' | 'senate';
  imageUrl: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  socialMedia?: {
    twitter?: string;
    facebook?: string;
  };
}

// Civil Leader engagement stats for author profiles
export interface CivicEngagementStats {
  libraryPostsCount: number;     // Posts shared from Library
  totalSupportVotes: number;     // Support votes received on posts
  totalOpposeVotes: number;      // Oppose votes received on posts
  totalRepGapVotes: number;      // Representation Gap poll votes received
  totalComments: number;         // Comments received on posts
  /**
   * A weighted score over the counters above.
   *
   * RENAMED FROM "civilLeaderScore". The Constitution's Civil Leader is a
   * person holding delegated votes — the borrowed power Article V impeachment
   * recalls — and this is a local engagement number that has nothing to do
   * with delegation. Two unrelated ideas under one name, on a platform whose
   * whole subject is who holds power.
   */
  engagementScore: number;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  location?: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
  isFollowing?: boolean;
  // Civic engagement stats for "Civil Leader" growth
  civicStats?: CivicEngagementStats;
}

export interface FeedItem {
  id: string;
  type: 'vote' | 'comment' | 'share';
  user: User;
  bill: Bill;
  vote?: 'yea' | 'nay';
  comment?: string;
  timestamp: string;
  likes: number;
  isLiked?: boolean;
  /**
   * This author took the OPPOSITE position to the reader on the record the
   * post is about. Set by the server from two public votes on the same bill —
   * not inferred from anything, which is why the feed can say it out loud.
   */
  isOtherSide?: boolean;
}

export interface UserVote {
  billId: string;
  vote: 'yea' | 'nay';
  votedAt: string;
}

// Representation Gap - measures discrepancy between public and official votes
export interface RepresentationGap {
  billId: string;
  billTitle: string;
  publicApprovalPct: number; // AYE & NAY users' approval %
  officialApprovalPct: number; // Congress official vote %
  gapPercentage: number; // Absolute difference
  hasSignificantGap: boolean; // True if gap > 30%
  gapDirection: 'public_higher' | 'official_higher' | 'aligned';
}

// Citizen's Brief - AI-simplified bill summary
export interface CitizensBrief {
  theGoal: string; // What is this bill trying to do?
  theWallet: string; // How much taxpayer money does this cost or save?
  theDebate: string; // What are the two main arguments for and against?
}

// Congress.gov API response types
export interface CongressBill {
  billNumber: string;
  billType: 'hr' | 's' | 'hjres' | 'sjres';
  congress: number;
  title: string;
  latestAction: {
    actionDate: string;
    text: string;
  };
  originChamber: 'House' | 'Senate';
  updateDate: string;
  url: string;
  sponsors?: Array<{
    bioguideId: string;
    fullName: string;
    party: string;
    state: string;
    district?: number;
  }>;
}

// Foreign Aid tracking
export interface ForeignAidExpenditure {
  id: string;
  country: string;
  countryCode: string;
  fiscalYear: number;
  totalAmount: number;
  category: string;
  description: string;
  publicSentiment?: {
    approve: number;
    disapprove: number;
    totalVotes: number;
  };
}
