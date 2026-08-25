/**
 * Representation Gap Calculator
 *
 * Calculates the discrepancy between public sentiment (AYE & NAY votes)
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
/**
 * The gap, or null when there is no chamber vote to compare against.
 *
 * THIS USED TO RETURN A NUMBER NO MATTER WHAT. Without `bill.officialVotes` it
 * left `officialApprovalPct` at 0 and carried on, so a record Congress had
 * simply not voted on yet was reported as the chamber approving it 0% — and
 * the gap became the public's own support percentage, pointed at a vote that
 * never happened. Every caller happened to check `officialVotes` first, which
 * is the only reason this never reached a screen; the guard lived at four call
 * sites instead of here, and removing it at any one of them would have shipped
 * the fiction silently.
 *
 * The guard lives here now. There is no gap without both halves.
 */
export function calculateRepresentationGap(bill: Bill): RepresentationGap | null {
  if (!bill.officialVotes) return null;

  // Calculate public (AYE & NAY) approval percentage
  const publicApprovalPct = calculateApprovalPct(
    bill.communityVotes.yea,
    bill.communityVotes.nay
  );

  const officialApprovalPct = calculateApprovalPct(
    bill.officialVotes.yea,
    bill.officialVotes.nay
  );

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
 * Gaps for many bills. Bills with no chamber vote are absent from the result
 * rather than present with an invented official percentage, so the length of
 * this array is the number of real comparisons, not the number of bills.
 */
export function calculateBulkRepresentationGaps(bills: Bill[]): RepresentationGap[] {
  return bills
    .map(calculateRepresentationGap)
    .filter((gap): gap is RepresentationGap => gap !== null);
}

/**
 * Get bills with significant representation gaps (> 30%)
 */
export function getBillsWithSignificantGaps(bills: Bill[]): Bill[] {
  return bills.filter((bill) => {
    const gap = calculateRepresentationGap(bill);
    // A bill Congress has not voted on has no gap — not a gap of zero, and not
    // a significant one. It is excluded rather than counted as aligned.
    return gap?.hasSignificantGap ?? false;
  });
}

/**
 * Sort bills by representation gap (largest gap first)
 */
export function sortByRepresentationGap(bills: Bill[]): Bill[] {
  return [...bills].sort((a, b) => {
    // Unmeasurable sorts last, rather than sorting as a gap of zero — which
    // would put "Congress has not voted" among the bills it most agrees with.
    const a_ = calculateRepresentationGap(a)?.gapPercentage ?? -1;
    const b_ = calculateRepresentationGap(b)?.gapPercentage ?? -1;
    return b_ - a_;
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
    return `On "${gap.billTitle}", public opinion (${Math.round(gap.publicApprovalPct)}%) aligns with Congress (${Math.round(gap.officialApprovalPct)}%). See how your voice matches at AYE & NAY.`;
  }

  if (gap.gapDirection === 'public_higher') {
    return `REPRESENTATION GAP: ${Math.round(gap.publicApprovalPct)}% of AYE & NAY users support "${gap.billTitle}", but Congress only voted ${Math.round(gap.officialApprovalPct)}% YES. Your voice matters. #AyeAndNay`;
  }

  return `REPRESENTATION GAP: Only ${Math.round(gap.publicApprovalPct)}% of AYE & NAY users support "${gap.billTitle}", yet Congress voted ${Math.round(gap.officialApprovalPct)}% YES. Make your voice heard. #AyeAndNay`;
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
