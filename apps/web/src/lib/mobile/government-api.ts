// Government API Service — Live Gateway to Official Sources
// Web faucet. Mirrors webapp/mobile/src/lib/government-api.ts one-for-one.
//
// ONE WATER SOURCE. Every search here goes through the backend
// (/api/government/{congress,executive,judicial}/search), which is the same
// endpoint the web faucet calls. The backend owns the API keys, the multi-source
// merge, the web-search-grounded AI query interpretation, and the relevance
// ranking — see backend/src/services/congress-search.ts.
//
// This file used to hold a second, device-side search engine: it called
// Congress.gov, the Library of Congress, CourtListener and OpenAI directly with
// EXPO_PUBLIC_* keys, kept its own Supabase result cache, and did its own
// ranking. That meant mobile and web produced DIFFERENT results for the same
// query, and mobile could never benefit from backend search improvements. It is
// gone. Do not reintroduce a client-side search path.

import { api } from '@/lib/api';

// ===========================================
// TYPES
// ===========================================

export type SearchBranch = 'legislative' | 'executive' | 'judicial';

export interface GovernmentSearchResult {
  id: string;
  branch: SearchBranch;
  title: string;
  shortTitle: string;
  date: string;
  status: string;
  statusLabel: LegislativeStatus; // [Active], [Proposed], [Repealed], [Landmark], [Pending]
  category: string;
  sourceUrl: string;
  rawText: string;
  metadata: Record<string, unknown>;
}

export type LegislativeStatus = 'active' | 'proposed' | 'repealed' | 'landmark' | 'pending';

// ---------- Backend response shapes (backend/src/routes/government.ts) ----------

export interface CongressResult {
  congress: number;
  number: string;
  title: string;
  type: string;
  originChamber: string;
  latestAction?: { actionDate: string; text: string };
  url: string;
  /** Canonical reference id (e.g. "hr-22-119") tying this bill to the app's reference system. */
  masterReferenceId: string;
  /** Present when this bill already has a reference (votes/discussion) in the app. */
  reference: {
    id: string;
    supportVotes: number;
    opposeVotes: number;
    totalComments: number;
    postsCount: number;
  } | null;
}

export interface ExecutiveResult {
  title: string;
  type: string;
  subtype: string;
  abstract: string;
  publication_date: string;
  signing_date: string;
  /** Bare EO number ("14385") for real executive orders, else "". */
  executive_order_number: string;
  president: string;
  agencies: Array<{ name: string }>;
  html_url: string;
  document_number: string;
}

export interface JudicialResult {
  id: number;
  case_name: string;
  court: string;
  date_filed: string;
  docket_number: string;
  absolute_url: string;
}

// ===========================================
// HELPERS
// ===========================================

/**
 * Determine status label based on latest action text
 * Labels results relative to the present state: [Active], [Proposed], [Repealed], [Landmark]
 */
export function determineStatusLabel(latestAction?: string, status?: string): LegislativeStatus {
  const actionLower = (latestAction ?? '').toLowerCase();
  const statusLower = (status ?? '').toLowerCase();

  // Check for landmark indicators
  if (actionLower.includes('became public law') || actionLower.includes('signed by president')) {
    return 'landmark';
  }

  // Check for active/enacted
  if (actionLower.includes('enacted') || statusLower.includes('enacted') || statusLower.includes('law')) {
    return 'active';
  }

  // Check for repealed/vetoed
  if (actionLower.includes('vetoed') || actionLower.includes('repealed') || statusLower.includes('vetoed')) {
    return 'repealed';
  }

  // Check for proposed/introduced
  if (actionLower.includes('introduced') || actionLower.includes('referred to') || statusLower.includes('introduced')) {
    return 'proposed';
  }

  // Check for pending/in progress
  if (actionLower.includes('passed') || actionLower.includes('received') || actionLower.includes('committee')) {
    return 'pending';
  }

  return 'proposed';
}

/** Topic chip for an executive document, inferred from the issuing agencies. */
export function mapExecutiveTypeToCategory(type?: string, agencies?: string[]): string {
  if (!type && !agencies) return 'economy';

  const agencyStr = agencies?.join(' ').toLowerCase() ?? '';

  if (agencyStr.includes('health') || agencyStr.includes('hhs')) return 'healthcare';
  if (agencyStr.includes('education')) return 'education';
  if (agencyStr.includes('epa') || agencyStr.includes('environment') || agencyStr.includes('energy')) return 'environment';
  if (agencyStr.includes('defense') || agencyStr.includes('military')) return 'defense';
  if (agencyStr.includes('homeland') || agencyStr.includes('immigration')) return 'immigration';
  if (agencyStr.includes('commerce') || agencyStr.includes('treasury')) return 'economy';
  if (agencyStr.includes('housing') || agencyStr.includes('hud')) return 'housing';
  if (agencyStr.includes('transport')) return 'infrastructure';

  return 'economy';
}

function truncate(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

// ===========================================
// ADAPTERS — backend result → GovernmentSearchResult
// ===========================================
// The library screen and the Citizen's Brief both drive off the single
// GovernmentSearchResult shape, and library-resolve.ts reads specific metadata
// keys off it (congress/type/number/chamber, documentNumber/eoNumber,
// docketNumber/opinionId) to hand a document's identity to the server. Keep
// those keys in sync with lib/library-resolve.ts.

export function congressToSearchResult(item: CongressResult): GovernmentSearchResult {
  const title = item.title || 'Untitled Bill';
  return {
    id: item.masterReferenceId,
    branch: 'legislative',
    title,
    shortTitle: truncate(title),
    date: item.latestAction?.actionDate ?? '',
    status: item.latestAction?.text ?? 'Introduced',
    statusLabel: determineStatusLabel(item.latestAction?.text),
    category: 'government',
    sourceUrl: item.url,
    rawText: `${title}. ${item.originChamber ? `Originated in the ${item.originChamber}.` : ''} ${
      item.latestAction?.text ? `Latest action: ${item.latestAction.text}` : ''
    }`.trim(),
    metadata: {
      congress: item.congress,
      type: item.type,
      number: item.number,
      chamber: item.originChamber,
      congressNumber: `${item.type}.${item.number}`,
    },
  };
}

export function executiveToSearchResult(item: ExecutiveResult): GovernmentSearchResult {
  const title = item.title || 'Untitled Document';
  const agencies = item.agencies?.map((a) => a.name) ?? [];
  // library-resolve.ts only forwards an EO number in the "EO 14147" form, so
  // real orders get the prefix and everything else falls back to the doc number.
  const eoNumber = item.executive_order_number
    ? `EO ${item.executive_order_number}`
    : item.document_number;
  return {
    id: `federal-register-${item.document_number}`,
    branch: 'executive',
    title,
    shortTitle: truncate(title),
    date: item.signing_date || item.publication_date || '',
    status: item.type === 'Presidential Document' ? 'active' : item.type || 'unknown',
    statusLabel: item.type === 'Presidential Document' ? 'active' : 'proposed',
    category: mapExecutiveTypeToCategory(item.subtype, agencies),
    sourceUrl: item.html_url || 'https://www.federalregister.gov',
    rawText: item.abstract || title,
    metadata: {
      documentNumber: item.document_number,
      eoNumber,
      president: item.president,
      publicationDate: item.publication_date,
      signingDate: item.signing_date,
      type: item.type,
      subtype: item.subtype,
      agencies,
    },
  };
}

export function judicialToSearchResult(item: JudicialResult): GovernmentSearchResult {
  const title = item.case_name || 'Unknown Case';
  return {
    id: String(item.id),
    branch: 'judicial',
    title,
    shortTitle: truncate(title),
    date: item.date_filed,
    status: item.court,
    statusLabel: 'landmark',
    category: 'government',
    sourceUrl: `https://www.courtlistener.com${item.absolute_url}`,
    rawText: `${title}. Court: ${item.court}. Docket: ${item.docket_number}`,
    metadata: {
      court: item.court,
      docketNumber: item.docket_number,
      // opinionId lets the server fetch the real opinion text when resolving.
      opinionId: item.id,
    },
  };
}

// ===========================================
// SEARCH — one backend call per branch
// ===========================================
// Results arrive already ranked by the backend. Do NOT re-sort them here: the
// congress ranking folds in legislative progress, live engagement and
// web-grounded relevance that the client cannot see.

function buildQ(q: string, limit: number): string {
  return `?${new URLSearchParams({ q, limit: String(limit) }).toString()}`;
}

export async function searchLegislation(query: string, limit = 20): Promise<GovernmentSearchResult[]> {
  try {
    const data = await api.get<{ results: CongressResult[] }>(
      `/api/government/congress/search${buildQ(query, limit)}`,
    );
    return (data?.results ?? []).map(congressToSearchResult);
  } catch (error) {
    console.error('Congress search failed:', error);
    return [];
  }
}

export async function searchExecutive(query: string, limit = 20): Promise<GovernmentSearchResult[]> {
  try {
    const data = await api.get<{ results: ExecutiveResult[] }>(
      `/api/government/executive/search${buildQ(query, limit)}`,
    );
    return (data?.results ?? []).map(executiveToSearchResult);
  } catch (error) {
    console.error('Executive search failed:', error);
    return [];
  }
}

export async function searchJudicial(query: string, limit = 20): Promise<GovernmentSearchResult[]> {
  try {
    const data = await api.get<{ results: JudicialResult[] }>(
      `/api/government/judicial/search${buildQ(query, limit)}`,
    );
    return (data?.results ?? []).map(judicialToSearchResult);
  } catch (error) {
    console.error('Judicial search failed:', error);
    return [];
  }
}

// ===========================================
// UNIFIED SEARCH ROUTER
// ===========================================

export async function searchGovernment(
  branch: SearchBranch,
  query: string,
  limit = 20
): Promise<GovernmentSearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  switch (branch) {
    case 'legislative':
      return searchLegislation(query.trim(), limit);
    case 'executive':
      return searchExecutive(query.trim(), limit);
    case 'judicial':
      return searchJudicial(query.trim(), limit);
    default:
      return [];
  }
}

/**
 * All three branches at once, interleaved.
 *
 * The Library used to open with one branch preselected and search only that
 * branch, so a reader typing "immigration" got no executive orders and no court
 * cases — two thirds of the platform's own subject matter, excluded by a
 * default nobody chose and with nothing on screen to say so.
 *
 * `allSettled`, not `all`: one source being down must not blank the other two.
 * A partial answer visibly drawn from what responded beats an error page that
 * hides two working branches.
 *
 * Interleaved, not concatenated, so a search does not open with twenty bills
 * and bury the other two branches below the fold — the same exclusion as
 * before, just softer.
 */
export async function searchAllBranches(
  query: string,
  limit = 20
): Promise<GovernmentSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const settled = await Promise.allSettled([
    searchLegislation(trimmed, limit),
    searchExecutive(trimmed, limit),
    searchJudicial(trimmed, limit),
  ]);

  const lists = settled.map((outcome) => (outcome.status === 'fulfilled' ? outcome.value : []));

  const interleaved: GovernmentSearchResult[] = [];
  const longest = Math.max(...lists.map((list) => list.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item) interleaved.push(item);
    }
  }
  return interleaved;
}

// ===========================================
// BILL SPONSOR
// ===========================================

export interface SponsorInfo {
  name: string;
  party: string;
  state: string;
  district?: string;
  bioguideId?: string;
  imageUrl?: string;
}

/**
 * Sponsor of a bill, looked up from its Congress.gov URL.
 *
 * NOTE: this is the last browser-side call to Congress.gov in this file and it
 * needs VITE_CONGRESS_API_KEY, which is NOT configured — so this currently
 * always returns null on web while the mobile faucet (which does ship an
 * EXPO_PUBLIC_ key) returns a real sponsor. The two faucets do not match. This
 * wants to move behind the backend like everything above it.
 */
export async function fetchBillSponsor(sourceUrl: string): Promise<SponsorInfo | null> {
  try {
    // URL format: https://www.congress.gov/bill/118th-congress/house-bill/1234
    const urlMatch = sourceUrl.match(/congress\.gov\/bill\/(\d+)(?:th|st|nd|rd)-congress\/(house|senate)-bill\/(\d+)/i);

    if (!urlMatch) {
      console.log('Could not parse Congress.gov URL:', sourceUrl);
      return null;
    }

    const [, congress, chamber, billNumber] = urlMatch;
    const billType = chamber.toLowerCase() === 'house' ? 'hr' : 's';

    const response = await fetch(
      `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${import.meta.env.VITE_CONGRESS_API_KEY ?? ''}`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!response.ok) {
      console.log('Congress API error:', response.status);
      return null;
    }

    const data = await response.json();
    const bill = data.bill;

    if (!bill?.sponsors || bill.sponsors.length === 0) {
      console.log('No sponsors found for bill');
      return null;
    }

    const sponsor = bill.sponsors[0];

    return {
      name: sponsor.fullName ?? sponsor.firstName + ' ' + sponsor.lastName,
      party: sponsor.party ?? 'Unknown',
      state: sponsor.state ?? '',
      district: sponsor.district,
      bioguideId: sponsor.bioguideId,
      imageUrl: sponsor.bioguideId
        ? `https://www.congress.gov/img/member/${sponsor.bioguideId.toLowerCase()}_200.jpg`
        : undefined,
    };
  } catch (error) {
    console.error('Error fetching bill sponsor:', error);
    return null;
  }
}
