// Government API Service — Live Gateway to Official Sources
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

import { api } from './api/api';
import { memberPhotoUrl } from "@/lib/member-photo";

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
  /**
   * OUR OWN RECORD, on an order the Federal Register has not published yet.
   *
   * Present only on results that came from our database rather than from the
   * Register — an order signed in the last few days. The Register has no
   * document number for it, so opening it has to go straight to the record we
   * already hold.
   */
  reference_id?: string;
  /** Signed and posted by the White House; not yet in the Federal Register. */
  just_signed?: boolean;
}

export interface JudicialResult {
  id: number;
  case_name: string;
  court: string;
  /**
   * CourtListener's id for the court — "scotus". Carried so it can be handed
   * back when a ruling is opened: the display name is not enough, because
   * several STATE supreme courts are also called "Supreme Court".
   */
  court_id?: string;
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
    /*
     * An order signed in the last few days has no Federal Register document
     * number, because the Register has not published it. It has something
     * better: a record here already, with its full text. Identified by that,
     * so nothing downstream tries to resolve `federal-register-` with nothing
     * after it.
     */
    id: item.reference_id ? `reference-${item.reference_id}` : `federal-register-${item.document_number}`,
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
      ...(item.reference_id ? { referenceId: item.reference_id } : {}),
      ...(item.just_signed ? { justSigned: true } : {}),
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
      // The court's ID, so the server can refuse to store a ruling from any
      // court but the Supreme Court. See backend services/library-resolve.ts.
      courtId: item.court_id,
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

/**
 * WHAT ONE SEARCH CAME BACK WITH, AND WHETHER IT GOT TO ASK.
 *
 * An empty list means nothing on its own. The court records answering "no such
 * ruling" and the court records not answering at all are completely different
 * facts, and until this existed they arrived here as the same empty array.
 *
 * MEASURED, NOT IMAGINED. CourtListener allows FIVE REQUESTS A MINUTE to one
 * caller and a single search spends several of them, so the second search in a
 * minute can come back with nothing. Eight identical live searches for "phone
 * privacy" against production: six returned five rulings each, TWO returned
 * nothing. Both of those two would have rendered "No results found" — the
 * platform stating, in its own voice, something it did not know.
 */
export interface GovernmentSearchOutcome {
  results: GovernmentSearchResult[];
  /** True only when NOT ONE query reached the court records. */
  courtRecordsUnavailable: boolean;
}

export async function searchJudicial(
  query: string,
  limit = 20,
): Promise<GovernmentSearchOutcome> {
  try {
    const data = await api.get<{ results: JudicialResult[]; sourceUnavailable?: boolean }>(
      `/api/government/judicial/search${buildQ(query, limit)}`,
    );
    return {
      results: (data?.results ?? []).map(judicialToSearchResult),
      courtRecordsUnavailable: Boolean(data?.sourceUnavailable),
    };
  } catch (error) {
    console.error('Judicial search failed:', error);
    // The request itself failed, so we certainly did not reach the records.
    return { results: [], courtRecordsUnavailable: true };
  }
}

// ===========================================
// UNIFIED SEARCH ROUTER
// ===========================================

export async function searchGovernment(
  branch: SearchBranch,
  query: string,
  limit = 20
): Promise<GovernmentSearchOutcome> {
  if (!query.trim()) {
    return { results: [], courtRecordsUnavailable: false };
  }

  switch (branch) {
    case 'legislative':
      return {
        results: await searchLegislation(query.trim(), limit),
        courtRecordsUnavailable: false,
      };
    case 'executive':
      return {
        results: await searchExecutive(query.trim(), limit),
        courtRecordsUnavailable: false,
      };
    case 'judicial':
      return searchJudicial(query.trim(), limit);
    default:
      return { results: [], courtRecordsUnavailable: false };
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
): Promise<GovernmentSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], courtRecordsUnavailable: false };

  const [legislative, executive, judicial] = await Promise.allSettled([
    searchLegislation(trimmed, limit),
    searchExecutive(trimmed, limit),
    searchJudicial(trimmed, limit),
  ]);

  const lists: GovernmentSearchResult[][] = [
    legislative.status === 'fulfilled' ? legislative.value : [],
    executive.status === 'fulfilled' ? executive.value : [],
    judicial.status === 'fulfilled' ? judicial.value.results : [],
  ];

  const interleaved: GovernmentSearchResult[] = [];
  const longest = Math.max(...lists.map((list) => list.length), 0);
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item) interleaved.push(item);
    }
  }

  return {
    results: interleaved,
    // The other two branches answering does not make the court records
    // reachable, so this is only ever the judicial branch's own answer.
    courtRecordsUnavailable:
      judicial.status === 'fulfilled' ? judicial.value.courtRecordsUnavailable : true,
  };
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
 * NOTE: this is the last device-side call to Congress.gov in this file and it
 * needs EXPO_PUBLIC_CONGRESS_API_KEY on the client. The web faucet's copy of
 * this function reads a VITE_ key that isn't configured, so sponsors silently
 * come back null there — the two faucets do not match. This wants to move
 * behind the backend like everything above it.
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
      `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${process.env.EXPO_PUBLIC_CONGRESS_API_KEY ?? ''}`,
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
      imageUrl: memberPhotoUrl(sponsor.bioguideId) ?? undefined,
    };
  } catch (error) {
    console.error('Error fetching bill sponsor:', error);
    return null;
  }
}
