/**
 * Voice Weight Algorithm
 *
 * Calculates a weight score (W) for legislative bills to determine their impact/importance.
 *
 * Formula: W = (cosponsor_count * 1.5) + (amendment_count * 2.0) + (action_status_rank * 5.0)
 *
 * Action Status Ranks:
 * - Introduced: 1
 * - Committee Review (in_committee): 3
 * - Passed House/Senate: 5
 * - Signed into Law: 10
 */

import type { BillStatus } from './database.types';

// Action status ranks for the weight calculation
export const ACTION_STATUS_RANKS: Record<BillStatus | 'signed_into_law', number> = {
  introduced: 1,
  in_committee: 3,
  passed_house: 5,
  passed_senate: 5,
  enacted: 10,
  vetoed: 2, // Vetoed bills have some legislative significance but didn't become law
  signed_into_law: 10, // Alias for enacted
};

// Weight multipliers
export const WEIGHT_MULTIPLIERS = {
  cosponsor: 1.5,
  amendment: 2.0,
  actionStatus: 5.0,
} as const;

/**
 * Parameters for calculating voice weight
 */
export interface VoiceWeightParams {
  status: BillStatus;
  cosponsorCount?: number;
  amendmentCount?: number;
}

/**
 * Result of voice weight calculation
 */
export interface VoiceWeightResult {
  weightScore: number;
  breakdown: {
    cosponsorContribution: number;
    amendmentContribution: number;
    statusContribution: number;
  };
  statusRank: number;
}

/**
 * Calculate the Voice Weight score for a bill
 *
 * @param params - The bill parameters for weight calculation
 * @returns The calculated weight score and breakdown
 */
export function calculateVoiceWeight(params: VoiceWeightParams): VoiceWeightResult {
  const { status, cosponsorCount = 0, amendmentCount = 0 } = params;

  // Get the action status rank (default to 1 for unknown statuses)
  const statusRank = ACTION_STATUS_RANKS[status] ?? 1;

  // Calculate individual contributions
  const cosponsorContribution = cosponsorCount * WEIGHT_MULTIPLIERS.cosponsor;
  const amendmentContribution = amendmentCount * WEIGHT_MULTIPLIERS.amendment;
  const statusContribution = statusRank * WEIGHT_MULTIPLIERS.actionStatus;

  // Calculate total weight score
  const weightScore = cosponsorContribution + amendmentContribution + statusContribution;

  return {
    weightScore,
    breakdown: {
      cosponsorContribution,
      amendmentContribution,
      statusContribution,
    },
    statusRank,
  };
}

/**
 * Get the human-readable status label for a given status
 */
export function getStatusLabel(status: BillStatus): string {
  const labels: Record<BillStatus, string> = {
    introduced: 'Introduced',
    in_committee: 'Committee Review',
    passed_house: 'Passed House',
    passed_senate: 'Passed Senate',
    enacted: 'Enacted',
    vetoed: 'Vetoed',
  };
  return labels[status] ?? status;
}

/**
 * Get the status rank description
 */
export function getStatusRankDescription(status: BillStatus): string {
  const rank = ACTION_STATUS_RANKS[status] ?? 1;
  if (rank >= 10) return 'Highest Impact';
  if (rank >= 5) return 'High Impact';
  if (rank >= 3) return 'Medium Impact';
  return 'Early Stage';
}

/**
 * Sort bills by voice weight score
 */
export function sortByVoiceWeight<T extends { weightScore?: number }>(
  bills: T[],
  direction: 'asc' | 'desc' = 'desc'
): T[] {
  return [...bills].sort((a, b) => {
    const scoreA = a.weightScore ?? 0;
    const scoreB = b.weightScore ?? 0;
    return direction === 'desc' ? scoreB - scoreA : scoreA - scoreB;
  });
}

/**
 * Calculate weight scores for an array of bills
 */
export function calculateBulkVoiceWeights(
  bills: Array<{
    id: string;
    status: BillStatus;
    cosponsorCount?: number;
    amendmentCount?: number;
  }>
): Map<string, VoiceWeightResult> {
  const results = new Map<string, VoiceWeightResult>();

  for (const bill of bills) {
    results.set(bill.id, calculateVoiceWeight({
      status: bill.status,
      cosponsorCount: bill.cosponsorCount,
      amendmentCount: bill.amendmentCount,
    }));
  }

  return results;
}

/**
 * Get weight tier based on score
 */
export type WeightTier = 'critical' | 'high' | 'medium' | 'low';

export function getWeightTier(weightScore: number): WeightTier {
  if (weightScore >= 75) return 'critical';
  if (weightScore >= 40) return 'high';
  if (weightScore >= 15) return 'medium';
  return 'low';
}

/**
 * Get tier color for UI display
 */
export function getWeightTierColor(tier: WeightTier): string {
  const colors: Record<WeightTier, string> = {
    critical: '#EF4444', // red-500
    high: '#F59E0B',     // amber-500
    medium: '#3B82F6',   // blue-500
    low: '#64748B',      // slate-500
  };
  return colors[tier];
}

/**
 * Get tier label for UI display
 */
export function getWeightTierLabel(tier: WeightTier): string {
  const labels: Record<WeightTier, string> = {
    critical: 'Critical',
    high: 'High Priority',
    medium: 'Notable',
    low: 'Tracking',
  };
  return labels[tier];
}
