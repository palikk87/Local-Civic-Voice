/**
 * Representation Gap Calculator
 *
 * Calculates the discrepancy between public sentiment (Civic Voice votes)
 * and official Congressional votes on bills.
 *
 * A "significant gap" is defined as > 30% difference between public and official approval.
 */

import type { Bill, RepresentationGap } from './types';

const SIGNIFICANT_GAP_THRESHOLD = 30; // 30% difference triggers "Representation Gap" alert

/**
 * Calculate approval percentage from vote counts
 */
export function calculateApprovalPct(yea: number, nay: number): number {
  const total = yea + nay;
  if (total === 0) return 0;
  return (yea / total) * 100;
}

/**
 * Calculate the Representation Gap for a single bill
 */
export function calculateRepresentationGap(bill: Bill): RepresentationGap {
  // Calculate public (Civic Voice) approval percentage
  const publicApprovalPct = calculateApprovalPct(
    bill.communityVotes.yea,
    bill.communityVotes.nay
  );

  // Calculate official (Congress) approval percentage
  let officialApprovalPct = 0;
  if (bill.officialVotes) {
    officialApprovalPct = calculateApprovalPct(
      bill.officialVotes.yea,
      bill.officialVotes.nay
    );
  }

  // Calculate the absolute gap
  const gapPercentage = Math.abs(publicApprovalPct - officialApprovalPct);

  // Determine gap direction
  let gapDirection: RepresentationGap['gapDirection'] = 'aligned';
  if (gapPercentage >= SIGNIFICANT_GAP_THRESHOLD) {
    gapDirection = publicApprovalPct > officialApprovalPct ? 'public_higher' : 'official_higher';
  }

  return {
    billId: bill.id,
    billTitle: bill.shortTitle,
    publicApprovalPct: Math.round(publicApprovalPct * 10) / 10,
    officialApprovalPct: Math.round(officialApprovalPct * 10) / 10,
    gapPercentage: Math.round(gapPercentage * 10) / 10,
    hasSignificantGap: gapPercentage >= SIGNIFICANT_GAP_THRESHOLD,
    gapDirection,
  };
}

/**
 * Calculate Representation Gaps for multiple bills
 */
export function calculateBulkRepresentationGaps(bills: Bill[]): RepresentationGap[] {
  return bills.map(calculateRepresentationGap);
}

/**
 * Get bills with significant representation gaps (> 30%)
 */
export function getBillsWithSignificantGaps(bills: Bill[]): Bill[] {
  return bills.filter((bill) => {
    const gap = calculateRepresentationGap(bill);
    return gap.hasSignificantGap;
  });
}

/**
 * Sort bills by representation gap (largest gap first)
 */
export function sortByRepresentationGap(bills: Bill[]): Bill[] {
  return [...bills].sort((a, b) => {
    const gapA = calculateRepresentationGap(a);
    const gapB = calculateRepresentationGap(b);
    return gapB.gapPercentage - gapA.gapPercentage;
  });
}

/**
 * Get a human-readable description of the gap
 */
export function getGapDescription(gap: RepresentationGap): string {
  if (!gap.hasSignificantGap) {
    return 'Public sentiment is aligned with Congressional vote';
  }

  if (gap.gapDirection === 'public_higher') {
    return `${Math.round(gap.publicApprovalPct)}% of citizens support this, but only ${Math.round(gap.officialApprovalPct)}% of Congress voted YES`;
  }

  return `Only ${Math.round(gap.publicApprovalPct)}% of citizens support this, but ${Math.round(gap.officialApprovalPct)}% of Congress voted YES`;
}

/**
 * Generate shareable text for social media
 */
export function generateShareText(gap: RepresentationGap): string {
  if (!gap.hasSignificantGap) {
    return `On "${gap.billTitle}", public opinion (${Math.round(gap.publicApprovalPct)}%) aligns with Congress (${Math.round(gap.officialApprovalPct)}%). See how your voice matches at Civic Voice.`;
  }

  if (gap.gapDirection === 'public_higher') {
    return `REPRESENTATION GAP: ${Math.round(gap.publicApprovalPct)}% of Civic Voice users support "${gap.billTitle}", but Congress only voted ${Math.round(gap.officialApprovalPct)}% YES. Your voice matters. #CivicVoice`;
  }

  return `REPRESENTATION GAP: Only ${Math.round(gap.publicApprovalPct)}% of Civic Voice users support "${gap.billTitle}", yet Congress voted ${Math.round(gap.officialApprovalPct)}% YES. Make your voice heard. #CivicVoice`;
}

/**
 * Get gap severity level for styling
 */
export function getGapSeverity(gap: RepresentationGap): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (gap.gapPercentage < 10) return 'none';
  if (gap.gapPercentage < 20) return 'low';
  if (gap.gapPercentage < 30) return 'medium';
  if (gap.gapPercentage < 50) return 'high';
  return 'critical';
}

/**
 * Get color for gap visualization
 */
export function getGapColor(severity: ReturnType<typeof getGapSeverity>): string {
  switch (severity) {
    case 'none':
      return '#22C55E'; // Green - aligned
    case 'low':
      return '#84CC16'; // Light green
    case 'medium':
      return '#F59E0B'; // Amber - warning
    case 'high':
      return '#EF4444'; // Red - significant gap
    case 'critical':
      return '#DC2626'; // Dark red - critical gap
    default:
      return '#6B7280'; // Gray
  }
}
