/**
 * Congress.gov API Service
 * Fetches real legislative data from the official Congress.gov API
 *
 * API Documentation: https://api.congress.gov/
 *
 * Note: Requires EXPO_PUBLIC_CONGRESS_API_KEY environment variable
 */

import type { CongressBill, Bill, Representative } from './types';
import { representatives } from './mock-data';

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';

// Default congress number (can be overridden by system_settings)
const DEFAULT_CONGRESS = 119; // 119th Congress (2025-2027)

// Cache for current congress to avoid repeated database calls
let cachedCurrentCongress: number | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

/**
 * Get the current congress number from system_settings
 * Uses caching to minimize database calls
 */
export async function getCurrentCongress(): Promise<number> {
  const now = Date.now();

  // Return cached value if still valid
  if (cachedCurrentCongress !== null && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedCurrentCongress;
  }

  // The Supabase `system_settings` lookup that used to run here went with the
  // Supabase SDK. It was gated behind isSupabaseConfigured(), which has always
  // been false, so DEFAULT_CONGRESS was the only path that ever executed — and
  // it is the path that remains. Mirrors apps/mobile/src/lib/congress-api.ts.

  // Fallback to default
  cachedCurrentCongress = DEFAULT_CONGRESS;
  cacheTimestamp = now;
  return DEFAULT_CONGRESS;
}

/**
 * Clear the congress cache (useful when congress is updated)
 */
export function clearCongressCache(): void {
  cachedCurrentCongress = null;
  cacheTimestamp = 0;
}

// Get API key from environment
const getApiKey = (): string | null => {
  return import.meta.env.VITE_CONGRESS_API_KEY ?? null;
};

// Map Congress.gov status to our app's status
const mapBillStatus = (latestAction: string): Bill['status'] => {
  const action = latestAction.toLowerCase();

  if (action.includes('became public law') || action.includes('signed by president')) {
    return 'signed_into_law';
  }
  if (action.includes('vetoed')) {
    return 'vetoed';
  }
  if (action.includes('passed senate') && action.includes('passed house')) {
    return 'enacted';
  }
  if (action.includes('passed senate')) {
    return 'passed_senate';
  }
  if (action.includes('passed house')) {
    return 'passed_house';
  }
  if (action.includes('committee')) {
    return 'in_committee';
  }
  return 'introduced';
};

// Map bill type to chamber
const mapChamber = (billType: string, originChamber: string): 'house' | 'senate' => {
  if (billType.startsWith('s') || originChamber === 'Senate') {
    return 'senate';
  }
  return 'house';
};

// Infer category from bill title
const inferCategory = (title: string): Bill['category'] => {
  const titleLower = title.toLowerCase();

  if (titleLower.includes('health') || titleLower.includes('medicare') || titleLower.includes('medicaid') || titleLower.includes('drug')) {
    return 'healthcare';
  }
  if (titleLower.includes('education') || titleLower.includes('school') || titleLower.includes('student')) {
    return 'education';
  }
  if (titleLower.includes('climate') || titleLower.includes('environment') || titleLower.includes('clean energy')) {
    return 'environment';
  }
  if (titleLower.includes('tax') || titleLower.includes('economic') || titleLower.includes('budget') || titleLower.includes('social security')) {
    return 'economy';
  }
  if (titleLower.includes('civil rights') || titleLower.includes('discrimination') || titleLower.includes('voting')) {
    return 'civil_rights';
  }
  if (titleLower.includes('defense') || titleLower.includes('military') || titleLower.includes('national security') || titleLower.includes('authorization act')) {
    return 'defense';
  }
  if (titleLower.includes('immigration') || titleLower.includes('border') || titleLower.includes('visa')) {
    return 'immigration';
  }
  if (titleLower.includes('tech') || titleLower.includes('cyber') || titleLower.includes('data') || titleLower.includes('online') || titleLower.includes('internet')) {
    return 'technology';
  }
  if (titleLower.includes('housing') || titleLower.includes('rent') || titleLower.includes('mortgage')) {
    return 'housing';
  }
  if (titleLower.includes('infrastructure') || titleLower.includes('transportation') || titleLower.includes('road') || titleLower.includes('bridge')) {
    return 'infrastructure';
  }

  return 'economy'; // Default fallback
};

// Find a representative to assign as sponsor
const findSponsor = (sponsor?: CongressBill['sponsors']): Representative => {
  if (sponsor && sponsor.length > 0) {
    const congressSponsor = sponsor[0];
    // Try to find matching representative in our database
    const match = representatives.find(
      (rep) => rep.id === congressSponsor.bioguideId ||
               rep.name.toLowerCase().includes(congressSponsor.fullName.split(' ').pop()?.toLowerCase() ?? '')
    );
    if (match) return match;
  }
  // Return first representative as fallback
  return representatives[0];
};

export interface FetchBillsOptions {
  limit?: number;
  offset?: number;
  chamber?: 'house' | 'senate';
  sort?: 'updateDate' | 'latestAction';
}

/**
 * Fetch recent bills from Congress.gov API
 */
export async function fetchRecentBills(options: FetchBillsOptions = {}): Promise<CongressBill[]> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('Congress API key not configured. Using fallback data.');
    return [];
  }

  const { limit = 20, offset = 0, sort = 'updateDate' } = options;

  try {
    const currentCongress = await getCurrentCongress();
    const url = `${CONGRESS_API_BASE}/bill/${currentCongress}?format=json&limit=${limit}&offset=${offset}&sort=${sort}+desc&api_key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Congress API error: ${response.status}`);
    }

    const data = await response.json();

    return data.bills?.map((bill: Record<string, unknown>) => ({
      billNumber: `${String(bill.type ?? '').toUpperCase()}.${bill.number}`,
      billType: String(bill.type ?? 'hr').toLowerCase(),
      congress: bill.congress as number,
      title: bill.title as string,
      latestAction: bill.latestAction as { actionDate: string; text: string },
      originChamber: bill.originChamber as 'House' | 'Senate',
      updateDate: bill.updateDate as string,
      url: bill.url as string,
    })) ?? [];
  } catch (error) {
    console.error('Failed to fetch bills from Congress.gov:', error);
    return [];
  }
}

/**
 * Fetch detailed bill information including sponsors and actions
 */
export async function fetchBillDetails(
  congress: number,
  billType: string,
  billNumber: number
): Promise<CongressBill | null> {
  const apiKey = getApiKey();

  if (!apiKey) {
    console.warn('Congress API key not configured.');
    return null;
  }

  try {
    const url = `${CONGRESS_API_BASE}/bill/${congress}/${billType}/${billNumber}?format=json&api_key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Congress API error: ${response.status}`);
    }

    const data = await response.json();
    const bill = data.bill;

    return {
      billNumber: `${String(bill.type ?? '').toUpperCase()}.${bill.number}`,
      billType: bill.type?.toLowerCase() ?? 'hr',
      congress: bill.congress,
      title: bill.title,
      latestAction: bill.latestAction,
      originChamber: bill.originChamber,
      updateDate: bill.updateDate,
      url: bill.url ?? `https://www.congress.gov/bill/${congress}th-congress/${billType.toLowerCase()}-bill/${billNumber}`,
      sponsors: bill.sponsors,
    };
  } catch (error) {
    console.error('Failed to fetch bill details:', error);
    return null;
  }
}

/**
 * Fetch vote results for a specific bill
 */
export async function fetchBillVotes(
  congress: number,
  billType: string,
  billNumber: number
): Promise<{ yea: number; nay: number; present: number; notVoting: number } | null> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return null;
  }

  try {
    const url = `${CONGRESS_API_BASE}/bill/${congress}/${billType}/${billNumber}/actions?format=json&api_key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Look for roll call votes in actions
    const voteAction = data.actions?.find((action: Record<string, unknown>) =>
      action.recordedVotes && (action.recordedVotes as unknown[]).length > 0
    );

    if (voteAction?.recordedVotes?.[0]) {
      const vote = voteAction.recordedVotes[0];
      return {
        yea: vote.yea ?? 0,
        nay: vote.nay ?? 0,
        present: vote.present ?? 0,
        notVoting: vote.notVoting ?? 0,
      };
    }

    return null;
  } catch (error) {
    console.error('Failed to fetch bill votes:', error);
    return null;
  }
}

/**
 * Convert Congress.gov bill to our app's Bill format
 */
export function convertCongressBillToAppBill(
  congressBill: CongressBill,
  existingVotes?: { yea: number; nay: number },
  officialVotes?: { yea: number; nay: number; present: number; notVoting: number }
): Partial<Bill> {
  const chamber = mapChamber(congressBill.billType, congressBill.originChamber);
  const status = mapBillStatus(congressBill.latestAction?.text ?? '');
  const category = inferCategory(congressBill.title);
  const sponsor = findSponsor(congressBill.sponsors);

  return {
    congressNumber: congressBill.billNumber,
    title: congressBill.title,
    shortTitle: congressBill.title.length > 80
      ? congressBill.title.substring(0, 77) + '...'
      : congressBill.title,
    status,
    chamber,
    sponsor,
    introducedDate: congressBill.latestAction?.actionDate ?? new Date().toISOString().split('T')[0],
    lastActionDate: congressBill.updateDate?.split('T')[0] ?? new Date().toISOString().split('T')[0],
    category,
    communityVotes: existingVotes
      ? { yea: existingVotes.yea, nay: existingVotes.nay, totalVoters: existingVotes.yea + existingVotes.nay }
      : { yea: 0, nay: 0, totalVoters: 0 },
    officialVotes: officialVotes
      ? { yea: officialVotes.yea, nay: officialVotes.nay, abstain: officialVotes.present, notVoting: officialVotes.notVoting }
      : undefined,
  };
}

/**
 * Search bills by keyword
 */
export async function searchBills(query: string, limit = 20): Promise<CongressBill[]> {
  const apiKey = getApiKey();

  if (!apiKey) {
    return [];
  }

  try {
    const currentCongress = await getCurrentCongress();
    const url = `${CONGRESS_API_BASE}/bill/${currentCongress}?format=json&limit=${limit}&query=${encodeURIComponent(query)}&api_key=${apiKey}`;

    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    return data.bills?.map((bill: Record<string, unknown>) => ({
      billNumber: `${String(bill.type ?? '').toUpperCase()}.${bill.number}`,
      billType: String(bill.type ?? 'hr').toLowerCase(),
      congress: bill.congress as number,
      title: bill.title as string,
      latestAction: bill.latestAction as { actionDate: string; text: string },
      originChamber: bill.originChamber as 'House' | 'Senate',
      updateDate: bill.updateDate as string,
      url: bill.url as string,
    })) ?? [];
  } catch (error) {
    console.error('Failed to search bills:', error);
    return [];
  }
}

/**
 * Check if Congress API is available
 */
export function isCongressApiConfigured(): boolean {
  return !!getApiKey();
}
