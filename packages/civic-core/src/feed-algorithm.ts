// Smart Feed Algorithm - Neutral, Transparent Ranking
// ============================================
// BILL OF RIGHTS ARTICLE II COMPLIANCE:
// "The Public Pulse shall not be manipulated
// for profit, engagement, or bias. The platform
// shall remain a neutral conduit for human intent.
// No Black Box algorithm shall amplify one voice
// over another based on outrage or commercial interest."
// ============================================

import type { FeedItem, Bill, BillCategory, User } from './types';
import { getAlgorithmCompliance } from './bill-of-rights';

// ==========================================
// ENGAGEMENT SIGNALS
// ==========================================

export interface EngagementSignals {
  // Content signals
  likes: number;
  comments: number;
  shares: number;
  totalVotes: number;
  hasRepGap: boolean;
  gapSeverity: number; // 0-100

  // Time signals
  contentAge: number; // hours since posted
  billUrgency: number; // hours until vote/deadline

  // User signals
  authorFollowers: number;
  authorEngagementRate: number;
  isFromFollowing: boolean;
  isFromDelegate: boolean;
}

export interface UserPreferences {
  userId: string;
  preferredCategories: BillCategory[];
  votingHistory: Array<{ category: BillCategory; vote: 'yea' | 'nay' }>;
  interactionHistory: Array<{
    feedItemId: string;
    type: 'view' | 'like' | 'comment' | 'share' | 'vote';
    timestamp: string;
    dwellTime?: number; // ms spent viewing
  }>;
  location?: {
    state: string;
    district?: string;
  };
  lastActive: string;
}

export interface ScoredFeedItem extends FeedItem {
  score: number;
  scoreBreakdown: {
    engagement: number;
    recency: number;
    relevance: number;
    gapBoost: number;
    diversityPenalty: number;
  };
  isSponsored?: boolean;
  feedReason?: FeedReason;
}

export type FeedReason =
  | { type: 'following'; user: string }
  | { type: 'trending'; rank: number }
  | { type: 'local'; state: string }
  | { type: 'category'; category: BillCategory }
  | { type: 'rep_gap'; gapPct: number }
  | { type: 'breaking'; urgency: 'critical' | 'high' | 'medium' }
  | { type: 'similar_voters'; matchPct: number }
  | { type: 'delegate'; delegateName: string }
  /**
   * The reader and this author are on public record disagreeing about the
   * same bill. Every other platform's "see the other side" is a guess about
   * somebody's politics; this is two votes.
   */
  | { type: 'other_side' };

// ==========================================
// ALGORITHM WEIGHTS (Tunable)
// ARTICLE II: Weights are transparent and documented
// No hidden "outrage amplification" or "engagement bait" factors
// ==========================================

// Verify algorithm compliance before applying weights
const compliance = getAlgorithmCompliance();

const WEIGHTS = {
  // Engagement weights - NEUTRAL, not outrage-based
  // Article II: Only verifiable Liquid Democracy weight determines prominence
  like: compliance.engagementBait ? 0 : 1, // Disabled if engagement bait detected
  comment: compliance.engagementBait ? 0 : 2, // Lower than typical social media
  share: compliance.engagementBait ? 0 : 3,
  vote: 4, // Votes are primary - aligned with Liquid Democracy

  // Time decay - TRANSPARENT half-life formula
  recencyHalfLife: 12, // hours - slower decay than engagement-focused platforms

  // Personalization - USER CONTROLLED preferences only
  categoryMatch: compliance.paidPromotion ? 0 : 2.0,
  followingBoost: 3.0,
  delegateBoost: 4.0, // Liquid Democracy weight
  localBoost: 2.5,

  // Representation gap bonus (unique to AYE & NAY - TRANSPARENT)
  // This is the "verifiable weight of Liquid Democracy"
  gapMultiplier: 2.0,
  gapThreshold: 20, // % difference to trigger bonus

  // Diversity penalty (prevent echo chambers - DOCUMENTED)
  sameCategoryPenalty: 0.3,
  sameAuthorPenalty: 0.5,

  // Breaking news boost - based on URGENCY not outrage
  urgentBillBoost: 3.0,

  // ARTICLE II PROHIBITED:
  outrageAmplification: 0, // Explicitly disabled
  controversyBoost: 0, // Explicitly disabled
  paidPromotion: 0, // No paid content boosting
};

// ==========================================
// SCORING FUNCTIONS
// ==========================================

/**
 * Calculate engagement score (FB/IG style weighted engagement)
 */
function calculateEngagementScore(item: FeedItem): number {
  const likes = item.likes || 0;
  const totalVotes = item.bill.communityVotes.totalVoters || 1;

  // Weighted engagement
  let score = likes * WEIGHTS.like + totalVotes * WEIGHTS.vote;

  // Normalize by time online (engagement rate)
  const hoursOnline = Math.max(1, getHoursAgo(item.timestamp));
  const engagementRate = score / hoursOnline;

  // Viral threshold - exponential boost for high engagement
  if (engagementRate > 100) {
    score *= 1 + Math.log10(engagementRate / 100);
  }

  return Math.min(score, 10000); // Cap at 10k
}

/**
 * Calculate recency score with exponential decay (TikTok style)
 */
function calculateRecencyScore(timestamp: string): number {
  const hoursAgo = getHoursAgo(timestamp);

  // Exponential decay with half-life
  const decay = Math.pow(0.5, hoursAgo / WEIGHTS.recencyHalfLife);

  // Bonus for very fresh content
  if (hoursAgo < 1) return 100 * decay;
  if (hoursAgo < 3) return 80 * decay;

  return 60 * decay;
}

/**
 * Calculate relevance score based on user preferences
 */
function calculateRelevanceScore(
  item: FeedItem,
  userPrefs: UserPreferences | null
): { score: number; reason?: FeedReason } {
  if (!userPrefs) return { score: 50 }; // Default mid-score

  let score = 50;
  let reason: FeedReason | undefined;

  // Category preference
  const categoryMatchCount = userPrefs.votingHistory.filter(
    (v) => v.category === item.bill.category
  ).length;
  if (categoryMatchCount > 0) {
    const categoryBoost = Math.min(categoryMatchCount * 10, 30) * WEIGHTS.categoryMatch;
    score += categoryBoost;
    reason = { type: 'category', category: item.bill.category };
  }

  // From followed user
  // In production, check if item.user.id is in following list
  if (userPrefs.interactionHistory.some(h =>
    h.type === 'like' && h.feedItemId.includes(item.user.id)
  )) {
    score += 40 * WEIGHTS.followingBoost;
    reason = { type: 'following', user: item.user.displayName };
  }

  // Local relevance
  if (userPrefs.location) {
    const billAffectsLocal = checkLocalRelevance(item.bill, userPrefs.location);
    if (billAffectsLocal) {
      score += 30 * WEIGHTS.localBoost;
      reason = { type: 'local', state: userPrefs.location.state };
    }
  }

  return { score: Math.min(score, 100), reason };
}

/**
 * Calculate representation gap boost (moral reward!)
 */
function calculateGapBoost(bill: Bill): { score: number; gapPct: number } {
  if (!bill.officialVotes) return { score: 0, gapPct: 0 };

  const publicYeaPct = (bill.communityVotes.yea / Math.max(1, bill.communityVotes.totalVoters)) * 100;
  const totalOfficial = bill.officialVotes.yea + bill.officialVotes.nay;
  const officialYeaPct = totalOfficial > 0
    ? (bill.officialVotes.yea / totalOfficial) * 100
    : 50;

  const gapPct = Math.abs(publicYeaPct - officialYeaPct);

  if (gapPct >= WEIGHTS.gapThreshold) {
    // Exponential boost for larger gaps
    const boost = Math.pow(gapPct / 10, 1.5) * WEIGHTS.gapMultiplier;
    return { score: Math.min(boost * 10, 50), gapPct };
  }

  return { score: 0, gapPct };
}

/**
 * Calculate urgency boost for time-sensitive bills
 */
function calculateUrgencyBoost(bill: Bill): { score: number; urgency?: 'critical' | 'high' | 'medium' } {
  const lastActionDate = new Date(bill.lastActionDate);
  const daysSinceAction = (Date.now() - lastActionDate.getTime()) / (1000 * 60 * 60 * 24);

  // Bills in active stages get urgency boost
  if (bill.status === 'in_committee' && daysSinceAction < 3) {
    return { score: 30 * WEIGHTS.urgentBillBoost, urgency: 'critical' };
  }
  if (bill.status === 'passed_house' || bill.status === 'passed_senate') {
    if (daysSinceAction < 7) {
      return { score: 20 * WEIGHTS.urgentBillBoost, urgency: 'high' };
    }
  }
  if (bill.status === 'introduced' && daysSinceAction < 14) {
    return { score: 10, urgency: 'medium' };
  }

  return { score: 0 };
}

/**
 * Calculate diversity penalty to prevent echo chambers
 */
function calculateDiversityPenalty(
  item: FeedItem,
  recentCategories: BillCategory[],
  recentAuthors: string[]
): number {
  let penalty = 0;

  // Penalize same category appearing too often
  const categoryCount = recentCategories.filter(c => c === item.bill.category).length;
  if (categoryCount > 2) {
    penalty += categoryCount * 10 * WEIGHTS.sameCategoryPenalty;
  }

  // Penalize same author appearing too often
  const authorCount = recentAuthors.filter(a => a === item.user.id).length;
  if (authorCount > 1) {
    penalty += authorCount * 15 * WEIGHTS.sameAuthorPenalty;
  }

  return penalty;
}

// ==========================================
// MAIN ALGORITHM
// ==========================================

/**
 * Score and rank feed items using engagement-based algorithm
 */
export function rankFeedItems(
  items: FeedItem[],
  userPrefs: UserPreferences | null = null,
  options: {
    diversityEnabled?: boolean;
    maxItems?: number;
    boostGaps?: boolean;
  } = {}
): ScoredFeedItem[] {
  const { diversityEnabled = true, maxItems = 50, boostGaps = true } = options;

  const recentCategories: BillCategory[] = [];
  const recentAuthors: string[] = [];

  // Score all items
  const scored = items.map((item): ScoredFeedItem => {
    // Calculate all score components
    const engagement = calculateEngagementScore(item);
    const recency = calculateRecencyScore(item.timestamp);
    const { score: relevance, reason } = calculateRelevanceScore(item, userPrefs);
    const { score: gapBoost, gapPct } = boostGaps
      ? calculateGapBoost(item.bill)
      : { score: 0, gapPct: 0 };
    const { score: urgencyBoost, urgency } = calculateUrgencyBoost(item.bill);

    // Diversity penalty (calculated during sort to account for position)
    const diversityPenalty = diversityEnabled
      ? calculateDiversityPenalty(item, recentCategories, recentAuthors)
      : 0;

    // Final score calculation
    const baseScore = engagement * 0.3 + recency * 0.25 + relevance * 0.25;
    const bonuses = gapBoost + urgencyBoost;
    const finalScore = Math.max(0, baseScore + bonuses - diversityPenalty);

    // Determine feed reason
    let feedReason = reason;
    if (gapPct >= WEIGHTS.gapThreshold) {
      feedReason = { type: 'rep_gap', gapPct };
    } else if (urgency) {
      feedReason = { type: 'breaking', urgency };
    }

    return {
      ...item,
      score: finalScore,
      scoreBreakdown: {
        engagement,
        recency,
        relevance,
        gapBoost,
        diversityPenalty,
      },
      feedReason,
    };
  });

  // Sort by score
  scored.sort((a, b) => b.score - a.score);

  // Re-calculate diversity penalties based on position
  if (diversityEnabled) {
    const reranked: ScoredFeedItem[] = [];
    const seenCategories: BillCategory[] = [];
    const seenAuthors: string[] = [];

    for (const item of scored) {
      const penalty = calculateDiversityPenalty(item, seenCategories, seenAuthors);
      item.score = Math.max(0, item.score - penalty);
      item.scoreBreakdown.diversityPenalty = penalty;

      seenCategories.push(item.bill.category);
      seenAuthors.push(item.user.id);
      reranked.push(item);
    }

    // Re-sort after diversity adjustments
    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, maxItems);
  }

  return scored.slice(0, maxItems);
}

/**
 * Get trending items (viral content)
 */
export function getTrendingItems(items: FeedItem[], limit = 10): ScoredFeedItem[] {
  const scored = items.map((item): ScoredFeedItem => {
    const engagement = calculateEngagementScore(item);
    const recency = calculateRecencyScore(item.timestamp);
    const hoursAgo = getHoursAgo(item.timestamp);

    // Trending score: high engagement + recent
    const trendingScore = (engagement / Math.max(1, hoursAgo)) * (recency / 50);

    return {
      ...item,
      score: trendingScore,
      scoreBreakdown: {
        engagement,
        recency,
        relevance: 0,
        gapBoost: 0,
        diversityPenalty: 0,
      },
      feedReason: { type: 'trending', rank: 0 },
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((item, idx) => ({
    ...item,
    feedReason: { type: 'trending', rank: idx + 1 },
  }));
}

/**
 * Get items with significant representation gaps (moral rewards)
 */
export function getGapItems(items: FeedItem[], limit = 10): ScoredFeedItem[] {
  return items
    .filter(item => {
      const { gapPct } = calculateGapBoost(item.bill);
      return gapPct >= WEIGHTS.gapThreshold;
    })
    .map((item): ScoredFeedItem => {
      const { score, gapPct } = calculateGapBoost(item.bill);
      return {
        ...item,
        score,
        scoreBreakdown: {
          engagement: 0,
          recency: 0,
          relevance: 0,
          gapBoost: score,
          diversityPenalty: 0,
        },
        feedReason: { type: 'rep_gap', gapPct },
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get locally relevant items
 */
export function getLocalItems(
  items: FeedItem[],
  location: { state: string; district?: string },
  limit = 10
): ScoredFeedItem[] {
  return items
    .filter(item => checkLocalRelevance(item.bill, location))
    .map((item): ScoredFeedItem => ({
      ...item,
      score: calculateEngagementScore(item),
      scoreBreakdown: {
        engagement: calculateEngagementScore(item),
        recency: calculateRecencyScore(item.timestamp),
        relevance: 100,
        gapBoost: 0,
        diversityPenalty: 0,
      },
      feedReason: { type: 'local', state: location.state },
    }))
    .slice(0, limit);
}

// ==========================================
// FISHER-YATES SHUFFLE (Session Randomization)
// ==========================================

/**
 * Fisher-Yates (Knuth) shuffle algorithm
 * Provides unbiased random permutation of array elements
 * Used to ensure different users see different orderings
 */
export function fisherYatesShuffle<T>(array: T[]): T[] {
  // Create a copy to avoid mutating original
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    // Generate random index from 0 to i (inclusive)
    const j = Math.floor(Math.random() * (i + 1));
    // Swap elements at i and j
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Discovery Score calculation
 * Combines Voice Weight with random factor for varied exposure
 * Formula: discovery_score = weight_score * (0.7 + random * 0.6)
 * This ensures high-weight bills still appear prominently while adding variety
 */
export function calculateDiscoveryScore(weightScore: number): number {
  const randomFactor = 0.7 + Math.random() * 0.6; // Range: 0.7 to 1.3
  return weightScore * randomFactor;
}

/**
 * Weighted random selection with discovery scores
 * Takes top N bills, assigns discovery scores, shuffles, and re-sorts
 */
export function weightedRandomize<T extends { weight_score?: number }>(
  items: T[],
  topN: number = 20
): (T & { discovery_score: number })[] {
  // Take top N items by weight_score
  const topItems = items
    .slice(0, topN)
    .map(item => ({
      ...item,
      discovery_score: calculateDiscoveryScore(item.weight_score ?? 0),
    }));

  // Shuffle to add randomness
  const shuffled = fisherYatesShuffle(topItems);

  // Re-sort by discovery_score (maintains weighted priority with variance)
  return shuffled.sort((a, b) => b.discovery_score - a.discovery_score);
}

/**
 * Filter out seen bills from feed
 * Used to prevent repetitive content within a session
 */
export function filterSeenBills<T extends { id: string }>(
  items: T[],
  seenBillIds: Set<string>
): T[] {
  return items.filter(item => !seenBillIds.has(item.id));
}

/**
 * Get randomized bill feed with session exclusion
 * Main function for the "For You" feed
 */
export function getRandomizedBillFeed<T extends { id: string; weight_score?: number }>(
  items: T[],
  seenBillIds: Set<string>,
  limit: number = 10,
  topPoolSize: number = 20
): { bills: (T & { discovery_score: number })[]; newSeenIds: string[] } {
  // Step 1: Filter out already-seen bills
  const unseenItems = filterSeenBills(items, seenBillIds);

  // Step 2: Apply weighted randomization to top pool
  const randomized = weightedRandomize(unseenItems, topPoolSize);

  // Step 3: Take requested limit
  const result = randomized.slice(0, limit);

  // Step 4: Track new seen IDs
  const newSeenIds = result.map(item => item.id);

  return {
    bills: result,
    newSeenIds,
  };
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function getHoursAgo(timestamp: string): number {
  const now = new Date();
  const then = new Date(timestamp);
  return (now.getTime() - then.getTime()) / (1000 * 60 * 60);
}

function checkLocalRelevance(
  bill: Bill,
  location: { state: string; district?: string }
): boolean {
  // Check if bill sponsor is from user's state
  if (bill.sponsor.state === location.state) return true;

  // Check if bill title/category affects local issues
  const localKeywords = ['state', location.state.toLowerCase()];
  const titleLower = bill.title.toLowerCase();

  return localKeywords.some(keyword => titleLower.includes(keyword));
}

// ==========================================
// FEED TYPES FOR UI
// ==========================================

export type FeedType = 'for_you' | 'following' | 'trending' | 'gaps' | 'local';

export interface FeedConfig {
  type: FeedType;
  label: string;
  icon: string;
  description: string;
}

export const FEED_TYPES: FeedConfig[] = [
  { type: 'for_you', label: 'For You', icon: 'Sparkles', description: 'Personalized based on your interests' },
  { type: 'following', label: 'Following', icon: 'Users', description: 'From people you follow' },
  { type: 'trending', label: 'Trending', icon: 'TrendingUp', description: 'Most engaging right now' },
  { type: 'gaps', label: 'Gaps', icon: 'AlertTriangle', description: 'Public vs Congress disagreements' },
  { type: 'local', label: 'Local', icon: 'MapPin', description: 'Bills affecting your area' },
];
