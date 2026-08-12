// Government API Service - Live Gateway to Official Sources
// Routes queries to Congress.gov, Federal Register, and CourtListener APIs

import { supabase, isSupabaseConfigured } from './supabase';
import { getCurrentCongress } from './congress-api';

// ===========================================
// API KEYS (From Environment Variables)
// ===========================================
// API keys are now stored in environment variables for security
// Backend proxy is preferred when available
const BACKEND_URL = process.env.EXPO_PUBLIC_VIBECODE_BACKEND_URL || 'http://localhost:3000';

const API_KEYS = {
  // These keys are used as fallback when backend proxy is unavailable
  // In production, all requests should go through the backend
  congress: process.env.EXPO_PUBLIC_CONGRESS_API_KEY || '',
  courtListener: process.env.EXPO_PUBLIC_COURTLISTENER_API_KEY || '',
  openai: process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY || '',
  // Federal Register is open access - no key required
} as const;

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

function scoreSearchResult(result: GovernmentSearchResult, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const title = result.title.toLowerCase();
  const shortTitle = result.shortTitle.toLowerCase();
  const rawText = result.rawText.toLowerCase();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  let relevanceScore = 0;

  if (title.includes(normalizedQuery)) relevanceScore += 8;
  if (shortTitle.includes(normalizedQuery)) relevanceScore += 6;
  if (rawText.includes(normalizedQuery)) relevanceScore += 2;

  for (const token of tokens) {
    if (title.includes(token)) relevanceScore += 2;
    if (shortTitle.includes(token)) relevanceScore += 1.5;
    if (rawText.includes(token)) relevanceScore += 0.5;
  }

  const dateValue = Date.parse(result.date || '');
  let recencyBoost = 0;
  if (!Number.isNaN(dateValue)) {
    const daysAgo = (Date.now() - dateValue) / (1000 * 60 * 60 * 24);
    // Prefer newer bills, but ONLY after relevance
    const recencyScore = Math.max(0, 90 - daysAgo) / 90; // 0..1
    recencyBoost = recencyScore * 2;
  }

  // Relevance dominates, recency is a secondary boost
  return relevanceScore * 10 + recencyBoost;
}

function rankSearchResults(
  results: GovernmentSearchResult[],
  query: string
): GovernmentSearchResult[] {
  if (!query.trim()) return results;

  return [...results]
    .map((result) => ({
      result,
      score: scoreSearchResult(result, query),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateA = Date.parse(a.result.date || '1900-01-01');
      const dateB = Date.parse(b.result.date || '1900-01-01');
      return dateB - dateA;
    })
    .map(({ result }) => result);
}

// Congress.gov API Response Types
interface CongressBillResult {
  congress: number;
  type: string;
  number: number;
  title: string;
  originChamber: string;
  introducedDate: string;
  latestAction?: {
    actionDate: string;
    text: string;
  };
  policyArea?: {
    name: string;
  };
  url: string;
}

interface CongressSearchResponse {
  bills: CongressBillResult[];
  pagination: {
    count: number;
    next?: string;
  };
}

// Federal Register API Response Types
interface FederalRegisterResult {
  title: string;
  document_number: string;
  publication_date: string;
  type: string;
  subtype?: string;
  abstract?: string;
  raw_text_url?: string;
  html_url: string;
  pdf_url?: string;
  president?: { name: string };
  executive_order_number?: number;
  signing_date?: string;
  agencies?: { name: string }[];
}

interface FederalRegisterResponse {
  count: number;
  results: FederalRegisterResult[];
  next_page_url?: string;
}

// CourtListener API Response Types
interface CourtListenerResult {
  id: number;
  absolute_url: string;
  caseName: string;
  docketNumber: string;
  court: string;
  dateFiled?: string;
  dateArgued?: string;
  status?: string;
  snippet?: string;
  suitNature?: string;
}

interface CourtListenerResponse {
  count: number;
  results: CourtListenerResult[];
  next?: string;
}

// ===========================================
// CATEGORY MAPPING
// ===========================================

const mapPolicyAreaToCategory = (policyArea?: string): string => {
  if (!policyArea) return 'economy';

  const mapping: Record<string, string> = {
    'Health': 'healthcare',
    'Education': 'education',
    'Environmental Protection': 'environment',
    'Energy': 'environment',
    'Economics and Public Finance': 'economy',
    'Taxation': 'economy',
    'Commerce': 'economy',
    'Civil Rights and Liberties, Minority Issues': 'civil_rights',
    'Armed Forces and National Security': 'defense',
    'Immigration': 'immigration',
    'Science, Technology, Communications': 'technology',
    'Housing and Community Development': 'housing',
    'Transportation and Public Works': 'infrastructure',
  };

  return mapping[policyArea] ?? 'economy';
};

const mapExecutiveTypeToCategory = (type?: string, agencies?: string[]): string => {
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
};

// ===========================================
// AI BILL IDENTIFIER GENERATION
// ===========================================

type AIBillIdentifier = string;

/**
 * AI-powered smart search that understands natural language queries
 * Translates everyday language into effective search terms
 * Examples:
 * - "laws about guns" -> "firearms gun control second amendment"
 * - "stuff about climate" -> "climate change environment clean energy"
 * - "healthcare for old people" -> "medicare seniors healthcare elderly"
 */
async function aiSmartSearch(rawInput: string): Promise<{ keywords: string; explanation: string }> {
  const openaiKey = process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY;
  if (!openaiKey) return { keywords: rawInput, explanation: '' };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a legislation search assistant that helps regular citizens find relevant laws and bills.

Your job is to translate everyday language into effective search terms for Congress.gov.

IMPORTANT RULES:
1. Understand casual/informal language (e.g., "stuff about" = "related to")
2. Expand abbreviations and slang (e.g., "healthcare" could also mean "health insurance", "medical")
3. Include synonyms and related official terms
4. Think about what the official bill titles might contain
5. Keep it to 3-5 key terms maximum

Return JSON only: {"keywords": "term1 term2 term3", "explanation": "brief explanation of what you're searching for"}

Examples:
- "gun laws" -> {"keywords": "firearms gun control second amendment weapons", "explanation": "Laws related to gun control and firearm regulations"}
- "immigration stuff" -> {"keywords": "immigration border visa citizenship", "explanation": "Immigration and border-related legislation"}
- "taxes" -> {"keywords": "tax taxation revenue IRS", "explanation": "Tax-related bills and fiscal policy"}
- "tiktok ban" -> {"keywords": "TikTok social media foreign app ban", "explanation": "Legislation about TikTok and foreign-owned apps"}
- "weed laws" -> {"keywords": "cannabis marijuana legalization drug", "explanation": "Cannabis and marijuana-related legislation"}`,
          },
          { role: 'user', content: rawInput },
        ],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return { keywords: rawInput, explanation: '' };
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`Smart search: "${rawInput}" -> "${parsed.keywords}" (${parsed.explanation})`);
        return {
          keywords: parsed.keywords || rawInput,
          explanation: parsed.explanation || '',
        };
      }
    } catch {
      // JSON parse failed
    }

    // Fallback: extract any text that looks like keywords
    const cleaned = content.replace(/[\r\n"{}]/g, '').trim();
    return { keywords: cleaned || rawInput, explanation: '' };
  } catch {
    return { keywords: rawInput, explanation: '' };
  }
}

async function aiExtractKeywords(rawInput: string): Promise<string> {
  const result = await aiSmartSearch(rawInput);
  return result.keywords;
}

// ===========================================
// STATUS LABELS (Perpetual Semantic Librarian)
// ===========================================

export type LegislativeStatus = 'active' | 'proposed' | 'repealed' | 'landmark' | 'pending';

/**
 * Determine status label based on latest action text
 * Labels results relative to the present state: [Active], [Proposed], [Repealed], [Landmark]
 */
function determineStatusLabel(latestAction?: string, status?: string): LegislativeStatus {
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

/**
 * Use OpenAI to find congressional bills (Perpetual Semantic Librarian)
 * - Dynamic Time-Scoping: No fixed date filters, searches all archives
 * - Relevance over Recency: Semantic match priority with recency boost for modern vibes
 * - Modern Vibe detection: AI queries handle popularized names and modern terms
 */
async function getAIBillIdentifiers(query: string, limit = 15): Promise<AIBillIdentifier[]> {
  console.log(`OpenAI Search (Semantic Librarian): Finding bills for "${query}"`);

  const openaiKey = process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY;

  if (!openaiKey) {
    console.log('OpenAI Search: No API key available');
    return [];
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `# Role: Perpetual Semantic Librarian

# Search Protocol:
1. DYNAMIC TIME-SCOPING: Search ALL Congressional sessions (not just recent). If PATRIOT Act from 2001 matches the query, include it.
2. RELEVANCE OVER RECENCY: Prioritize semantic matches. If a 2015 law is THE primary match, rank it first.
3. MODERN VIBE DETECTION: For queries like "AI Privacy" or "TikTok Ban", apply recency boost but keep historical foundations visible.
4. EVOLUTIONARY CHAINS: If an old law is being debated/amended now, include the current version too.

Return JSON array only of bill identifiers as strings.
Valid formats: "H.R. 1234", "S. 567", "H.Res. 100", "S.Res. 200", "H.J.Res. 1", "S.J.Res. 2", "H.Con.Res. 3", "S.Con.Res. 4".

Max ${limit} results. Sort by relevance. No extra text.`
          },
          {
            role: 'user',
            content: query
          }
        ],
        max_tokens: 1500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.log('OpenAI Search: API request failed', response.status);
      return [];
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '[]';

    console.log('OpenAI raw response:', content.substring(0, 300));

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as string[];
        const normalized = parsed
          .map((value) => String(value).trim())
          .filter((value) =>
            /^(H\.?R\.?|S\.?|H\.?RES\.?|S\.?RES\.?|H\.?J\.?RES\.?|S\.?J\.?RES\.?|H\.?CON\.?RES\.?|S\.?CON\.?RES\.?)\s*\d+$/i.test(
              value
            )
          );
        console.log(`OpenAI Search: Found ${normalized.length} bills for "${query}"`);
        return normalized;
      }
    } catch {
      console.log('OpenAI Search: Failed to parse response');
    }

    return [];
  } catch (error) {
    console.log('OpenAI Search: Network error', error);
    return [];
  }
}

/**
 * Parse AI bill identifier into Congress.gov API format
 */
function parseBillIdentifier(identifier: AIBillIdentifier): { billType: string; billNumber: number } | null {
  const billNum = identifier.toUpperCase().trim();

  // Parse different formats like "H.R. 2732", "S. 1234", "H.Res. 100"
  const patterns = [
    { regex: /H\.?R\.?\s*(\d+)/i, type: 'hr' },
    { regex: /S\.?\s*(\d+)/i, type: 's' },
    { regex: /H\.?RES\.?\s*(\d+)/i, type: 'hres' },
    { regex: /S\.?RES\.?\s*(\d+)/i, type: 'sres' },
    { regex: /H\.?J\.?RES\.?\s*(\d+)/i, type: 'hjres' },
    { regex: /S\.?J\.?RES\.?\s*(\d+)/i, type: 'sjres' },
    { regex: /H\.?CON\.?RES\.?\s*(\d+)/i, type: 'hconres' },
    { regex: /S\.?CON\.?RES\.?\s*(\d+)/i, type: 'sconres' },
  ];

  for (const pattern of patterns) {
    const match = billNum.match(pattern.regex);
    if (match) {
      return {
        billType: pattern.type,
        billNumber: parseInt(match[1], 10),
      };
    }
  }

  return null;
}

async function fetchLocGovSearch(query: string, limit: number): Promise<Record<string, unknown>[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  // Use Congress.gov API directly instead of loc.gov (more reliable for React Native)
  try {
    let currentCongress = 119; // Default to 119th Congress
    try {
      currentCongress = await getCurrentCongress();
    } catch {
      console.log('Using default congress 119');
    }
    const congresses = [currentCongress, currentCongress - 1, currentCongress - 2].filter(c => c > 0);
    const allResults: Record<string, unknown>[] = [];

    for (const congress of congresses) {
      if (allResults.length >= limit) break;

      try {
        const url = `https://api.congress.gov/v3/bill/${congress}?format=json&limit=${Math.min(limit, 20)}&sort=updateDate+desc&api_key=${API_KEYS.congress}`;
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          // Add timeout for React Native compatibility
        });

        if (!response.ok) {
          console.log(`Congress API error for congress ${congress}:`, response.status);
          continue;
        }

        const data = await response.json();
        const bills = data?.bills;

        if (Array.isArray(bills)) {
          // Filter bills that match the query
          const queryLower = normalizedQuery.toLowerCase();
          const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

          const matchedBills = bills.filter((bill: Record<string, unknown>) => {
            const title = ((bill.title as string) ?? '').toLowerCase();
            const policyArea = ((bill.policyArea as Record<string, unknown>)?.name as string ?? '').toLowerCase();

            // Check if any query word matches the title or policy area
            return queryWords.some(word => title.includes(word) || policyArea.includes(word));
          });

          // Convert to expected format with bill identifier
          for (const bill of matchedBills) {
            if (allResults.length >= limit) break;
            const billType = ((bill.type as string) ?? 'HR').toUpperCase();
            const billNumber = bill.number as number ?? 0;
            allResults.push({
              ...bill,
              billIdentifier: `${billType} ${billNumber}`,
              congress,
            });
          }
        }
      } catch (innerError) {
        console.log(`Congress fetch error for congress ${congress}:`, innerError);
        continue;
      }
    }

    return allResults;
  } catch (error) {
    console.error('Congress.gov search failed:', error);
    return [];
  }
}

async function fetchCongressGovBillSearch(query: string, limit: number): Promise<string[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  try {
    // Use Congress.gov API to search for bills
    const billItems = await fetchLocGovSearch(normalizedQuery, Math.max(20, limit * 3));
    if (!billItems.length) return [];

    // Sort by date (newest first)
    const sortedItems = [...billItems].sort((a, b) => {
      const dateA = new Date((a.latestAction as Record<string, unknown>)?.actionDate as string ?? (a.introducedDate as string) ?? '1900-01-01').getTime();
      const dateB = new Date((b.latestAction as Record<string, unknown>)?.actionDate as string ?? (b.introducedDate as string) ?? '1900-01-01').getTime();
      return dateB - dateA;
    });

    // Extract bill identifiers from the results
    const extractedIds: string[] = sortedItems
      .map((item) => item.billIdentifier as string | undefined)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    return Array.from(new Set(extractedIds));
  } catch (error) {
    console.error('Congress.gov bill search failed:', error);
    return [];
  }
}

async function fetchBillAcrossCongresses(
  billType: string,
  billNumber: number,
  friendlyName: string
): Promise<GovernmentSearchResult | null> {
  let currentCongress = 119; // Default to 119th Congress
  try {
    currentCongress = await getCurrentCongress();
  } catch {
    console.log('Using default congress 119 for bill lookup');
  }
  const congresses = [currentCongress, currentCongress - 1, currentCongress - 2]
    .filter((congress) => congress > 0);
  for (const congress of congresses) {
    const result = await fetchBillById(congress, billType, billNumber, friendlyName);
    if (result) return result;
  }
  return null;
}

/**
 * Fetch a specific bill from Congress.gov by its identifier
 */
async function fetchBillById(
  congress: number,
  billType: string,
  billNumber: number,
  friendlyName: string
): Promise<GovernmentSearchResult | null> {
  try {
    const url = `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${API_KEYS.congress}&format=json`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.log(`Bill fetch failed: ${congress}/${billType}/${billNumber} - ${response.status}`);
      return null;
    }

    const data = await response.json();
    const bill = data.bill;

    if (!bill) return null;

    // Build public URL
    const chamberSlug = billType.startsWith('s') && billType !== 'sconres' && billType !== 'sres' && billType !== 'sjres' ? 'senate-bill' :
                        billType === 'hr' ? 'house-bill' :
                        billType === 'hres' ? 'house-resolution' :
                        billType === 'sres' ? 'senate-resolution' :
                        billType === 'hjres' ? 'house-joint-resolution' :
                        billType === 'sjres' ? 'senate-joint-resolution' :
                        billType === 'hconres' ? 'house-concurrent-resolution' :
                        billType === 'sconres' ? 'senate-concurrent-resolution' :
                        billType === 's' ? 'senate-bill' : 'house-bill';
    const publicUrl = `https://www.congress.gov/bill/${congress}th-congress/${chamberSlug}/${billNumber}`;

    const congressNumber = `${billType.toUpperCase()}.${billNumber}`;

    const fullTitle = bill.title || 'Untitled Bill';
    const normalizedTitle = fullTitle.toLowerCase();
    const normalizedFriendly = friendlyName?.toLowerCase().trim();
    const safeFriendlyName =
      normalizedFriendly && normalizedTitle.includes(normalizedFriendly)
        ? friendlyName
        : undefined;

    return {
      id: `congress-${congress}-${congressNumber}-0`,
      branch: 'legislative',
      title: fullTitle,
      shortTitle: fullTitle.length > 80 ? `${fullTitle.slice(0, 80)}...` : fullTitle,
      date: bill.latestAction?.actionDate ?? bill.introducedDate ?? '',
      status: bill.latestAction?.text ?? 'Introduced',
      statusLabel: determineStatusLabel(bill.latestAction?.text),
      category: mapPolicyAreaToCategory(bill.policyArea?.name),
      sourceUrl: publicUrl,
      rawText: `${fullTitle}. ${bill.policyArea?.name ? `Policy Area: ${bill.policyArea.name}.` : ''} ${bill.originChamber ? `Originated in the ${bill.originChamber}.` : ''} ${bill.latestAction?.text ? `Latest action: ${bill.latestAction.text}` : ''}`.trim(),
      metadata: {
        congress: bill.congress,
        type: billType.toUpperCase(),
        number: billNumber,
        chamber: bill.originChamber,
        congressNumber,
        policyArea: bill.policyArea?.name,
        friendlyName: safeFriendlyName,
      },
    };
  } catch (error) {
    console.log(`Error fetching bill ${congress}/${billType}/${billNumber}:`, error);
    return null;
  }
}

// ===========================================
// BILL CACHE FUNCTIONS (Cost Optimization)
// ===========================================

// Type for cached bill data (matches bill_cache table)
interface CachedBill {
  id: string;
  search_query: string | null;
  bill_id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  short_title: string;
  status: string;
  category: string;
  date: string;
  source_url: string;
  raw_text: string;
  metadata: Record<string, unknown>;
  created_at: string;
  expires_at: string;
}

/**
 * Check bill_cache for existing search results
 * Returns cached results if found and not expired
 */
async function getCachedSearchResults(query: string): Promise<GovernmentSearchResult[] | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const normalizedQuery = query.toLowerCase().trim();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('bill_cache')
      .select('*')
      .eq('search_query', normalizedQuery)
      .gt('expires_at', now)
      .order('created_at', { ascending: false });

    // If table doesn't exist or other error, just return null (cache miss)
    if (error) {
      // Only log if it's not a "relation does not exist" error (table not created yet)
      if (!error.message?.includes('does not exist')) {
        console.log('Cache lookup skipped:', error.message ?? 'Unknown error');
      }
      return null;
    }

    if (!data || data.length === 0) {
      return null;
    }

    const cachedData = data as unknown as CachedBill[];
    console.log(`Cache HIT: Found ${cachedData.length} cached results for "${query}" (Cost: $0)`);

    // Convert cached data to GovernmentSearchResult format
    return cachedData.map((cached): GovernmentSearchResult => ({
      id: cached.bill_id,
      branch: 'legislative',
      title: cached.title,
      shortTitle: cached.short_title,
      date: cached.date,
      status: cached.status,
      statusLabel: determineStatusLabel(cached.status),
      category: cached.category,
      sourceUrl: cached.source_url,
      rawText: cached.raw_text,
      metadata: cached.metadata,
    }));
  } catch {
    // Silently fail - cache is optional optimization
    return null;
  }
}

/**
 * Check bill_cache for a specific bill by ID
 */
async function getCachedBillById(billId: string): Promise<GovernmentSearchResult | null> {
  if (!isSupabaseConfigured()) return null;

  try {
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('bill_cache')
      .select('*')
      .eq('bill_id', billId)
      .gt('expires_at', now)
      .single();

    // Silently handle errors (table might not exist yet)
    if (error || !data) return null;

    const cached = data as unknown as CachedBill;
    console.log(`Cache HIT: Found cached bill ${billId} (Cost: $0)`);

    return {
      id: cached.bill_id,
      branch: 'legislative',
      title: cached.title,
      shortTitle: cached.short_title,
      date: cached.date,
      status: cached.status,
      statusLabel: determineStatusLabel(cached.status),
      category: cached.category,
      sourceUrl: cached.source_url,
      rawText: cached.raw_text,
      metadata: cached.metadata,
    };
  } catch {
    // Silently fail - cache is optional optimization
    return null;
  }
}

/**
 * Save search results to bill_cache for future free lookups
 * Silently fails if table doesn't exist - cache is optional optimization
 */
async function cacheSearchResults(
  query: string,
  results: GovernmentSearchResult[]
): Promise<void> {
  if (!isSupabaseConfigured() || results.length === 0) return;

  try {
    const normalizedQuery = query.toLowerCase().trim();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const cacheEntries = results.map((result) => {
      const metadata = result.metadata as Record<string, unknown>;
      return {
        search_query: normalizedQuery,
        bill_id: result.id,
        congress: (metadata.congress as number) ?? 119,
        bill_type: (metadata.type as string) ?? 'hr',
        bill_number: (metadata.number as number) ?? 0,
        title: result.title,
        short_title: result.shortTitle,
        status: result.status,
        category: result.category,
        date: result.date,
        source_url: result.sourceUrl,
        raw_text: result.rawText,
        metadata: JSON.stringify(result.metadata),
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      };
    });

    // Upsert to avoid duplicates (update if bill_id exists)
    const { error } = await supabase
      .from('bill_cache')
      .upsert(cacheEntries as never[], {
        onConflict: 'bill_id',
        ignoreDuplicates: false,
      });

    // Only log if successful or if it's NOT a "table doesn't exist" error
    if (error) {
      if (!error.message?.includes('does not exist')) {
        console.log('Cache save skipped:', error.message ?? 'Unknown error');
      }
      // Silently skip caching if table doesn't exist
    } else {
      console.log(`Cached ${results.length} results for "${query}" - next lookup is FREE`);
    }
  } catch {
    // Silently fail - cache is optional optimization
  }
}

async function fetchBillsByCongressQuery(query: string, limit: number): Promise<GovernmentSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  // Search across multiple congresses for better coverage (like Congress.gov website)
  // Congress.gov website searches ALL congresses - we'll search the last 5 for better results
  let currentCongress = 119; // Default to 119th Congress
  try {
    currentCongress = await getCurrentCongress();
  } catch {
    console.log('Using default congress 119 for direct search');
  }

  // Search last 5 congresses for broader coverage (like Congress.gov does)
  const congresses = [currentCongress, currentCongress - 1, currentCongress - 2, currentCongress - 3, currentCongress - 4].filter(c => c > 0);
  const results: GovernmentSearchResult[] = [];
  const seenBills = new Set<string>();

  // Build search query words
  const queryLower = normalizedQuery.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  // Fetch from multiple congresses in parallel for speed
  const congressPromises = congresses.map(async (congress) => {
    const congressResults: GovernmentSearchResult[] = [];

    try {
      // Fetch more bills per congress to increase chance of finding matches
      // Congress.gov API returns max 250 per request
      const url = `https://api.congress.gov/v3/bill/${congress}?format=json&limit=250&sort=updateDate+desc&api_key=${API_KEYS.congress}`;

      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        console.log(`Congress API returned ${response.status} for congress ${congress}`);
        return congressResults;
      }

      const data: CongressSearchResponse = await response.json();
      if (!data.bills || !Array.isArray(data.bills)) return congressResults;

      for (const bill of data.bills) {
        const billType = (bill.type ?? 'hr').toLowerCase();
        const billNum = bill.number ?? 0;
        const billKey = `${bill.congress ?? congress}-${billType}-${billNum}`;

        // Check if bill matches query
        const titleLower = (bill.title ?? '').toLowerCase();
        const policyLower = (bill.policyArea?.name ?? '').toLowerCase();
        const actionLower = (bill.latestAction?.text ?? '').toLowerCase();

        const matchesQuery = queryWords.length === 0 || queryWords.some(word =>
          titleLower.includes(word) ||
          policyLower.includes(word) ||
          actionLower.includes(word)
        );

        if (!matchesQuery) continue;

        const chamberSlug = billType.startsWith('s') && !['sconres', 'sres', 'sjres'].includes(billType)
          ? 'senate-bill'
          : billType === 'hr'
          ? 'house-bill'
          : billType === 'hres'
          ? 'house-resolution'
          : billType === 'sres'
          ? 'senate-resolution'
          : billType === 'hjres'
          ? 'house-joint-resolution'
          : billType === 'sjres'
          ? 'senate-joint-resolution'
          : billType === 'hconres'
          ? 'house-concurrent-resolution'
          : billType === 'sconres'
          ? 'senate-concurrent-resolution'
          : 'house-bill';
        const publicUrl = `https://www.congress.gov/bill/${congress}th-congress/${chamberSlug}/${billNum}`;

        congressResults.push({
          id: `congress-${congress}-${billType}-${billNum}`,
          branch: 'legislative',
          title: bill.title ?? 'Untitled Bill',
          shortTitle: (bill.title ?? 'Untitled Bill').length > 80
            ? `${(bill.title ?? 'Untitled Bill').slice(0, 80)}...`
            : (bill.title ?? 'Untitled Bill'),
          date: bill.latestAction?.actionDate ?? bill.introducedDate ?? '',
          status: bill.latestAction?.text ?? 'Introduced',
          statusLabel: determineStatusLabel(bill.latestAction?.text),
          category: mapPolicyAreaToCategory(bill.policyArea?.name),
          sourceUrl: publicUrl,
          rawText: `${bill.title ?? 'Untitled Bill'}. ${bill.policyArea?.name ? `Policy Area: ${bill.policyArea.name}.` : ''} ${bill.originChamber ? `Originated in the ${bill.originChamber}.` : ''} ${bill.latestAction?.text ? `Latest action: ${bill.latestAction.text}` : ''}`.trim(),
          metadata: {
            congress: bill.congress ?? congress,
            type: bill.type,
            number: bill.number,
            chamber: bill.originChamber,
            congressNumber: `${bill.type ?? 'HR'}.${billNum}`,
            policyArea: bill.policyArea?.name,
          },
        });
      }
    } catch (error) {
      console.error(`Congress query search failed for congress ${congress}:`, error);
    }

    return congressResults;
  });

  // Wait for all congress searches to complete
  const allResults = await Promise.all(congressPromises);

  // Combine and deduplicate results
  for (const congressResults of allResults) {
    for (const result of congressResults) {
      if (!seenBills.has(result.id)) {
        seenBills.add(result.id);
        results.push(result);
      }
    }
  }

  // Sort by date (newest first)
  results.sort((a, b) => {
    const dateA = new Date(a.date || '1900-01-01').getTime();
    const dateB = new Date(b.date || '1900-01-01').getTime();
    return dateB - dateA;
  });

  return results.slice(0, limit);
}

// ===========================================
// DIRECT BILL NUMBER LOOKUP
// ===========================================

/**
 * Detect if the query is a bill number (e.g., H.R.7147, S.2941, HR7147, S2941)
 * Returns parsed bill info if detected, null otherwise
 */
function detectBillNumber(query: string): { billType: string; billNumber: number } | null {
  const normalizedQuery = query.trim().toUpperCase().replace(/\s+/g, '');

  // Patterns to match various bill number formats:
  // H.R.7147, HR7147, H.R. 7147, HR 7147
  // S.2941, S2941, S. 2941, S 2941
  // H.RES.100, HRES100, S.RES.200, SRES200
  // H.J.RES.1, HJRES1, S.J.RES.2, SJRES2
  // H.CON.RES.3, HCONRES3, S.CON.RES.4, SCONRES4

  const patterns = [
    { regex: /^H\.?R\.?\s*(\d+)$/i, type: 'hr' },
    { regex: /^S\.?\s*(\d+)$/i, type: 's' },
    { regex: /^H\.?RES\.?\s*(\d+)$/i, type: 'hres' },
    { regex: /^S\.?RES\.?\s*(\d+)$/i, type: 'sres' },
    { regex: /^H\.?J\.?RES\.?\s*(\d+)$/i, type: 'hjres' },
    { regex: /^S\.?J\.?RES\.?\s*(\d+)$/i, type: 'sjres' },
    { regex: /^H\.?CON\.?RES\.?\s*(\d+)$/i, type: 'hconres' },
    { regex: /^S\.?CON\.?RES\.?\s*(\d+)$/i, type: 'sconres' },
  ];

  for (const pattern of patterns) {
    const match = normalizedQuery.match(pattern.regex);
    if (match) {
      return {
        billType: pattern.type,
        billNumber: parseInt(match[1], 10),
      };
    }
  }

  return null;
}

/**
 * Directly fetch a specific bill by its number across recent congresses
 */
async function fetchBillByNumber(
  billType: string,
  billNumber: number
): Promise<GovernmentSearchResult | null> {
  let currentCongress = 119;
  try {
    currentCongress = await getCurrentCongress();
  } catch {
    console.log('Using default congress 119 for bill lookup');
  }

  // Search across last 5 congresses to find the bill
  const congresses = [currentCongress, currentCongress - 1, currentCongress - 2, currentCongress - 3, currentCongress - 4].filter(c => c > 0);

  for (const congress of congresses) {
    const result = await fetchBillById(congress, billType, billNumber, '');
    if (result) {
      console.log(`Found bill ${billType.toUpperCase()} ${billNumber} in Congress ${congress}`);
      return result;
    }
  }

  console.log(`Bill ${billType.toUpperCase()} ${billNumber} not found in recent congresses`);
  return null;
}

// ===========================================
// LEGISLATIVE - Congress.gov API (Direct Search)
// ===========================================

export async function searchLegislation(query: string, limit = 50): Promise<GovernmentSearchResult[]> {
  try {
    console.log(`Congress.gov search: "${query}"`);

    // Check if Congress API key is configured
    if (!API_KEYS.congress) {
      console.log('Congress API key not configured - using AI-enhanced search only');
    }

    // STEP 0: Check if query is a direct bill number (e.g., H.R.7147, S.2941)
    const billNumberMatch = detectBillNumber(query);
    if (billNumberMatch && API_KEYS.congress) {
      console.log(`Detected bill number: ${billNumberMatch.billType.toUpperCase()} ${billNumberMatch.billNumber}`);
      const directBill = await fetchBillByNumber(billNumberMatch.billType, billNumberMatch.billNumber);
      if (directBill) {
        return [directBill];
      }
      // If not found, continue with regular search
      console.log('Direct bill lookup failed, falling back to regular search');
    }

    // STEP 1: Check cache first (Cost: $0)
    try {
      const cachedResults = await getCachedSearchResults(query);
      if (cachedResults && cachedResults.length > 0) {
        const rankedCache = rankSearchResults(cachedResults, query);
        const cacheHasRelevance = rankedCache.some(
          (result) => scoreSearchResult(result, query) > 0
        );
        if (cacheHasRelevance) {
          return rankedCache.slice(0, limit);
        }
      }
    } catch (cacheError) {
      console.log('Cache check failed, continuing with live search:', cacheError);
    }

    // STEP 2: Use AI to understand the user's intent and expand search terms
    let smartKeywords = query;
    try {
      const smartResult = await aiSmartSearch(query);
      smartKeywords = smartResult.keywords;
      console.log(`AI expanded: "${query}" -> "${smartKeywords}"`);
    } catch {
      console.log('AI search enhancement failed, using original query');
    }

    // STEP 3: Try direct Congress.gov API search with expanded keywords
    if (API_KEYS.congress) {
      try {
        // Try with smart keywords first
        let directResults = await fetchBillsByCongressQuery(smartKeywords, limit);

        // If no results with smart keywords, try original query
        if (directResults.length === 0 && smartKeywords !== query) {
          console.log('Smart keywords returned no results, trying original query');
          directResults = await fetchBillsByCongressQuery(query, limit);
        }

        // If still no results, try individual keywords from smart search
        if (directResults.length === 0) {
          const keywords = smartKeywords.split(/\s+/).filter(w => w.length > 2);
          for (const keyword of keywords.slice(0, 3)) {
            const keywordResults = await fetchBillsByCongressQuery(keyword, Math.ceil(limit / 2));
            directResults.push(...keywordResults);
            if (directResults.length >= limit) break;
          }
        }

        if (directResults.length > 0) {
          console.log(`Direct Congress.gov search returned ${directResults.length} results`);
          // Deduplicate results
          const uniqueResults = Array.from(
            new Map(directResults.map(r => [r.id, r])).values()
          );
          try {
            await cacheSearchResults(query, uniqueResults);
          } catch {
            // Ignore cache save errors
          }
          return rankSearchResults(uniqueResults, query).slice(0, limit);
        }
      } catch (directError) {
        console.log('Direct Congress.gov search failed:', directError);
      }
    }

    // STEP 4: AI keyword extraction -> Congress.gov search (fallback)
    if (API_KEYS.congress) {
      try {
        const billIdentifiers = await fetchCongressGovBillSearch(smartKeywords, Math.max(20, limit * 3));

        const uniqueIds = Array.from(new Set(billIdentifiers));

        if (uniqueIds.length === 0) {
          console.log('No bill identifiers found from AI search');
          // Try fetching recent bills as last resort
          const recentBills = await fetchRecentBills(limit);
          if (recentBills.length > 0) {
            return rankSearchResults(recentBills, query).slice(0, limit);
          }
          return [];
        }

        const aiResults = await Promise.all(
          uniqueIds.map(async (identifier) => {
            try {
              const parsed = parseBillIdentifier(identifier);
              if (!parsed) return null;
              return fetchBillAcrossCongresses(
                parsed.billType,
                parsed.billNumber,
                ''
              );
            } catch {
              return null;
            }
          })
        );

        const validAiResults = aiResults.filter(
          (result): result is GovernmentSearchResult => result !== null
        );

        // Prefer newest congress for the same bill number/type
        const dedupedByBill = new Map<string, GovernmentSearchResult>();
        for (const result of validAiResults) {
          const metadata = result.metadata as Record<string, unknown>;
          const billType = (metadata.type as string | undefined) ?? '';
          const billNumber = (metadata.number as number | undefined) ?? 0;
          const congress = (metadata.congress as number | undefined) ?? 0;
          const billKey = `${billType}-${billNumber}`;

          const existing = dedupedByBill.get(billKey);
          if (!existing) {
            dedupedByBill.set(billKey, result);
            continue;
          }

          const existingCongress = ((existing.metadata as Record<string, unknown>).congress as number | undefined) ?? 0;
          if (congress > existingCongress) {
            dedupedByBill.set(billKey, result);
          }
        }

        const uniqueAiResults = Array.from(dedupedByBill.values());

        if (uniqueAiResults.length > 0) {
          try {
            await cacheSearchResults(query, uniqueAiResults);
          } catch {
            // Ignore cache save errors
          }
          return rankSearchResults(uniqueAiResults, query).slice(0, limit);
        }
      } catch (aiError) {
        console.log('AI-assisted search failed:', aiError);
      }
    }

    // STEP 5: Last resort - fetch recent bills and filter
    if (API_KEYS.congress) {
      try {
        const recentBills = await fetchRecentBills(limit * 2);
        if (recentBills.length > 0) {
          // Filter by relevance to the query
          const rankedRecent = rankSearchResults(recentBills, query);
          // Only return bills that have some relevance
          const relevantBills = rankedRecent.filter(
            bill => scoreSearchResult(bill, query) > 0
          );
          if (relevantBills.length > 0) {
            return relevantBills.slice(0, limit);
          }
          // If nothing matches, return recent bills anyway
          return rankedRecent.slice(0, limit);
        }
      } catch (recentError) {
        console.log('Recent bills fetch failed:', recentError);
      }
    }

    return [];
  } catch (error) {
    console.error('Error in Congress.gov search:', error);
    return [];
  }
}

// Live search (no cache, no preloaded list fallback)
export async function searchLegislationLive(
  query: string,
  limit = 20
): Promise<GovernmentSearchResult[]> {
  try {
    console.log(`Congress.gov live search: "${query}"`);

    const congressQueryResults = await fetchBillsByCongressQuery(query, limit);
    if (congressQueryResults.length > 0) {
      return rankSearchResults(congressQueryResults, query).slice(0, limit);
    }

    const searchParams = new URLSearchParams({
      api_key: API_KEYS.congress,
      limit: limit.toString(),
      sort: 'updateDate desc',
      format: 'json',
    });

    let searchUrl = `https://api.congress.gov/v3/bill?${searchParams.toString()}&q=${encodeURIComponent(query)}`;
    let response = await fetch(searchUrl, { headers: { Accept: 'application/json' } });
    let data: CongressSearchResponse | null = null;

    if (response.ok) {
      data = await response.json();
    }

    if (!data?.bills || data.bills.length === 0) {
      const keywordUrl = `https://api.congress.gov/v3/bill?api_key=${API_KEYS.congress}&limit=${limit}&sort=updateDate+desc&format=json`;
      response = await fetch(keywordUrl, { headers: { Accept: 'application/json' } });

      if (response.ok) {
        const allBills: CongressSearchResponse = await response.json();
        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

        if (allBills.bills && Array.isArray(allBills.bills)) {
          const matchedBills = allBills.bills.filter(bill => {
            const titleLower = (bill.title ?? '').toLowerCase();
            const policyLower = (bill.policyArea?.name ?? '').toLowerCase();
            return queryWords.some(word =>
              titleLower.includes(word) || policyLower.includes(word)
            );
          });

          if (matchedBills.length > 0) {
            data = { bills: matchedBills, pagination: { count: matchedBills.length } };
          }
        }
      }
    }

    if (!data?.bills || !Array.isArray(data.bills) || data.bills.length === 0) {
      return [];
    }

    const seenBills = new Set<string>();
    const results = data.bills
      .filter((bill) => {
        const billKey = `${bill.congress ?? 119}-${bill.type ?? 'hr'}-${bill.number ?? ''}`;
        if (seenBills.has(billKey)) return false;
        seenBills.add(billKey);
        return true;
      })
      .map((bill): GovernmentSearchResult => {
        const billType = (bill.type ?? 'hr').toLowerCase();
        const congress = bill.congress ?? 119;
        const billNum = bill.number ?? 0;
        const congressNumber = `${bill.type ?? 'HR'}.${billNum}`;

        const chamberSlug = billType.startsWith('s') && !['sconres', 'sres', 'sjres'].includes(billType)
          ? 'senate-bill'
          : billType === 'hr'
          ? 'house-bill'
          : billType === 'hres'
          ? 'house-resolution'
          : billType === 'sres'
          ? 'senate-resolution'
          : billType === 'hjres'
          ? 'house-joint-resolution'
          : billType === 'sjres'
          ? 'senate-joint-resolution'
          : billType === 'hconres'
          ? 'house-concurrent-resolution'
          : billType === 'sconres'
          ? 'senate-concurrent-resolution'
          : billType === 's'
          ? 'senate-bill'
          : 'house-bill';
        const publicUrl = `https://www.congress.gov/bill/${congress}th-congress/${chamberSlug}/${billNum}`;

        return {
          id: `congress-${congress}-${billType}-${billNum}`,
          branch: 'legislative',
          title: bill.title ?? 'Untitled Bill',
          shortTitle: (bill.title ?? 'Untitled Bill').length > 80
            ? `${(bill.title ?? 'Untitled Bill').slice(0, 80)}...`
            : (bill.title ?? 'Untitled Bill'),
          date: bill.latestAction?.actionDate ?? bill.introducedDate ?? '',
          status: bill.latestAction?.text ?? 'Introduced',
          statusLabel: determineStatusLabel(bill.latestAction?.text),
          category: mapPolicyAreaToCategory(bill.policyArea?.name),
          sourceUrl: publicUrl,
          rawText: `${bill.title ?? 'Untitled Bill'}. ${bill.policyArea?.name ? `Policy Area: ${bill.policyArea.name}.` : ''} ${bill.originChamber ? `Originated in the ${bill.originChamber}.` : ''} ${bill.latestAction?.text ? `Latest action: ${bill.latestAction.text}` : ''}`.trim(),
          metadata: {
            congress: bill.congress ?? congress,
            type: bill.type,
            number: bill.number,
            chamber: bill.originChamber,
            congressNumber,
            policyArea: bill.policyArea?.name,
          },
        };
      });

    return rankSearchResults(results, query).slice(0, limit);
  } catch (error) {
    console.error('Live legislation search failed:', error);
    return [];
  }
}

// Fallback function to get recent bills when search fails
async function fetchRecentBills(limit: number): Promise<GovernmentSearchResult[]> {
  try {
    const url = `https://api.congress.gov/v3/bill?api_key=${API_KEYS.congress}&limit=${limit}&sort=updateDate+desc&format=json`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return [];

    const data: CongressSearchResponse = await response.json();

    if (!data.bills || !Array.isArray(data.bills)) return [];

    // Use a Set to track seen bills and ensure uniqueness
    const seenBills = new Set<string>();

    return data.bills
      .filter((bill) => {
        // Generate unique key based on bill data
        const billKey = `${bill.congress ?? 119}-${bill.type ?? 'hr'}-${bill.number ?? ''}`;
        if (seenBills.has(billKey)) {
          return false; // Skip duplicate
        }
        seenBills.add(billKey);
        return true;
      })
      .map((bill): GovernmentSearchResult => {
        const billType = (bill.type ?? 'hr').toLowerCase();
        const congress = bill.congress ?? 119;
        const billNum = bill.number ?? 0;
        const congressNumber = `${bill.type ?? 'HR'}.${billNum}`;

        const chamberSlug = billType.startsWith('s') ? 'senate-bill' :
                            billType === 'hr' ? 'house-bill' :
                            billType === 'hres' ? 'house-resolution' :
                            billType === 'sres' ? 'senate-resolution' :
                            billType === 'hjres' ? 'house-joint-resolution' :
                            billType === 'sjres' ? 'senate-joint-resolution' :
                            billType === 'hconres' ? 'house-concurrent-resolution' :
                            billType === 'sconres' ? 'senate-concurrent-resolution' : 'house-bill';
        const publicUrl = `https://www.congress.gov/bill/${congress}th-congress/${chamberSlug}/${billNum}`;

        // Generate unique ID based on actual bill data, not index
        const uniqueId = `congress-${congress}-${billType}-${billNum}`;

        return {
          id: uniqueId,
          branch: 'legislative',
          title: bill.title ?? 'Untitled Bill',
          shortTitle: (bill.title ?? 'Untitled Bill').length > 80 ? `${(bill.title ?? 'Untitled Bill').slice(0, 80)}...` : (bill.title ?? 'Untitled Bill'),
          date: bill.latestAction?.actionDate ?? bill.introducedDate ?? '',
          status: bill.latestAction?.text ?? 'Introduced',
          statusLabel: determineStatusLabel(bill.latestAction?.text),
          category: mapPolicyAreaToCategory(bill.policyArea?.name),
          sourceUrl: publicUrl,
          rawText: `${bill.title ?? 'Untitled Bill'}. ${bill.policyArea?.name ? `Policy Area: ${bill.policyArea.name}.` : ''} ${bill.originChamber ? `Originated in the ${bill.originChamber}.` : ''} ${bill.latestAction?.text ? `Latest action: ${bill.latestAction.text}` : ''}`.trim(),
          metadata: {
            congress: bill.congress,
            type: bill.type,
            number: bill.number,
            chamber: bill.originChamber,
            congressNumber,
            policyArea: bill.policyArea?.name,
          },
        };
      });
  } catch {
    return [];
  }
}

// ===========================================
// EXECUTIVE - Federal Register API
// ===========================================

export async function searchExecutive(query: string, limit = 20): Promise<GovernmentSearchResult[]> {
  try {
    const params = new URLSearchParams({
      'conditions[term]': query,
      'conditions[type][]': 'PRESDOCU',
      'per_page': limit.toString(),
      'order': 'newest', // Sort by newest first
    });

    const url = `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
    console.log('Federal Register search URL:', url);

    const response = await fetch(
      url,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('Federal Register API error:', response.status, response.statusText);
      return [];
    }

    const data: FederalRegisterResponse = await response.json();

    // Handle empty or missing results
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    return data.results.map((item): GovernmentSearchResult => {
      const eoNumber = item.executive_order_number
        ? `EO ${item.executive_order_number}`
        : item.document_number;

      // Determine executive order status
      const eoStatus: LegislativeStatus = item.type === 'Presidential Document' ? 'active' : 'proposed';

      return {
        id: `federal-register-${item.document_number}`,
        branch: 'executive',
        title: item.title ?? 'Untitled Document',
        shortTitle: (item.title ?? 'Untitled Document').length > 80 ? `${(item.title ?? 'Untitled Document').slice(0, 80)}...` : (item.title ?? 'Untitled Document'),
        date: item.signing_date ?? item.publication_date ?? '',
        status: item.type === 'Presidential Document' ? 'active' : (item.type ?? 'unknown'),
        statusLabel: eoStatus,
        category: mapExecutiveTypeToCategory(item.subtype, item.agencies?.map(a => a.name)),
        sourceUrl: item.html_url ?? 'https://www.federalregister.gov',
        rawText: item.abstract ?? item.title ?? 'No details available',
        metadata: {
          documentNumber: item.document_number,
          eoNumber,
          president: item.president?.name,
          publicationDate: item.publication_date,
          signingDate: item.signing_date,
          type: item.type,
          subtype: item.subtype,
          pdfUrl: item.pdf_url,
          fullTextUrl: item.raw_text_url,
          agencies: item.agencies?.map(a => a.name),
        },
      };
    });
  } catch (error) {
    console.error('Error fetching from Federal Register:', error);
    return [];
  }
}

// ===========================================
// JUDICIAL - CourtListener API
// ===========================================

export async function searchJudicial(query: string, limit = 20): Promise<GovernmentSearchResult[]> {
  try {
    // Search ALL federal courts, not just SCOTUS
    // This includes Circuit Courts, District Courts, etc.
    const params = new URLSearchParams({
      q: query,
      type: 'o', // opinions
      // Remove court filter to search all courts
      order_by: 'dateFiled desc', // Sort by date (newest first)
      page_size: limit.toString(),
    });

    const url = `https://www.courtlistener.com/api/rest/v4/search/?${params.toString()}`;
    console.log('CourtListener search URL:', url.replace(API_KEYS.courtListener, 'API_KEY'));

    const response = await fetch(
      url,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Token ${API_KEYS.courtListener}`,
        },
      }
    );

    if (!response.ok) {
      console.error('CourtListener API error:', response.status, response.statusText);
      return [];
    }

    const data: CourtListenerResponse = await response.json();

    // Handle empty or missing results
    if (!data.results || !Array.isArray(data.results)) {
      return [];
    }

    // Sort by date (newest first) and map results
    const sortedResults = [...data.results].sort((a, b) => {
      const dateA = new Date(a.dateFiled ?? a.dateArgued ?? '1900-01-01').getTime();
      const dateB = new Date(b.dateFiled ?? b.dateArgued ?? '1900-01-01').getTime();
      return dateB - dateA;
    });

    return sortedResults.map((item, index): GovernmentSearchResult => {
      // CourtListener may return id in different formats - ensure we have a unique key
      const itemId = item.id ?? item.docketNumber ?? `index-${index}`;

      // Determine judicial status
      const judicialStatus: LegislativeStatus = item.status === 'decided' || item.status === 'Published' ? 'landmark' : 'pending';

      // Get court name for display
      const courtName = item.court ?? 'Federal Court';

      return {
        id: `courtlistener-${itemId}-${index}`,
        branch: 'judicial',
        title: item.caseName ?? 'Unknown Case',
        shortTitle: (item.caseName ?? 'Unknown Case').length > 80 ? `${(item.caseName ?? 'Unknown Case').slice(0, 80)}...` : (item.caseName ?? 'Unknown Case'),
        date: item.dateFiled ?? item.dateArgued ?? '',
        status: item.status ?? 'decided',
        statusLabel: judicialStatus,
        category: 'civil_rights', // Default for court cases
        sourceUrl: item.absolute_url ? `https://www.courtlistener.com${item.absolute_url}` : 'https://www.courtlistener.com',
        rawText: item.snippet ?? item.caseName ?? 'No details available',
        metadata: {
          docketNumber: item.docketNumber,
          court: courtName,
          dateArgued: item.dateArgued,
          dateFiled: item.dateFiled,
          suitNature: item.suitNature,
          opinionId: item.id,
        },
      };
    });
  } catch (error) {
    console.error('Error fetching from CourtListener:', error);
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
      return rankSearchResults(await searchLegislation(query, limit), query);
    case 'executive':
      return rankSearchResults(await searchExecutive(query, limit), query);
    case 'judicial':
      return rankSearchResults(await searchJudicial(query, limit), query);
    default:
      return [];
  }
}

export async function searchGovernmentLive(
  branch: SearchBranch,
  query: string,
  limit = 20
): Promise<GovernmentSearchResult[]> {
  if (!query.trim()) {
    return [];
  }

  switch (branch) {
    case 'legislative':
      return rankSearchResults(await searchLegislationLive(query, limit), query);
    case 'executive':
      return rankSearchResults(await searchExecutive(query, limit), query);
    case 'judicial':
      return rankSearchResults(await searchJudicial(query, limit), query);
    default:
      return [];
  }
}

// ===========================================
// FETCH SINGLE DOCUMENT DETAILS
// ===========================================

export async function fetchDocumentDetails(
  branch: SearchBranch,
  documentId: string
): Promise<GovernmentSearchResult | null> {
  try {
    switch (branch) {
      case 'legislative': {
        // Extract congress and bill number from ID
        const match = documentId.match(/congress-(\d+)-(.+)-\d+$/);
        if (!match) return null;

        const [, congress, billPart] = match;
        // billPart could be "HR.123" or "S.456" etc.
        const billMatch = billPart.match(/([A-Z]+)\.(\d+)/i);
        if (!billMatch) return null;

        const [, billTypeRaw, billNumber] = billMatch;
        const billType = billTypeRaw.toLowerCase();

        // Fetch bill details
        const response = await fetch(
          `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${API_KEYS.congress}`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!response.ok) return null;

        const data = await response.json();
        const bill = data.bill;

        // Also try to fetch the summary for better preview content
        let summaryText = '';
        try {
          const summaryResponse = await fetch(
            `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}/summaries?api_key=${API_KEYS.congress}`,
            { headers: { 'Accept': 'application/json' } }
          );
          if (summaryResponse.ok) {
            const summaryData = await summaryResponse.json();
            // Get the most recent summary (they're usually sorted by version)
            const summaries = summaryData.summaries ?? [];
            if (summaries.length > 0) {
              // Strip HTML tags from summary text
              summaryText = (summaries[summaries.length - 1]?.text ?? '').replace(/<[^>]*>/g, '');
            }
          }
        } catch {
          // Summary fetch failed - continue without it
        }

        // Build human-readable Congress.gov URL
        const chamberSlug = billType.startsWith('s') ? 'senate-bill' :
                            billType === 'hr' ? 'house-bill' :
                            billType === 'hres' ? 'house-resolution' :
                            billType === 'sres' ? 'senate-resolution' :
                            billType === 'hjres' ? 'house-joint-resolution' :
                            billType === 'sjres' ? 'senate-joint-resolution' :
                            billType === 'hconres' ? 'house-concurrent-resolution' :
                            billType === 'sconres' ? 'senate-concurrent-resolution' : 'house-bill';
        const publicUrl = `https://www.congress.gov/bill/${congress}th-congress/${chamberSlug}/${billNumber}`;

        // Build rich rawText for AI preview
        const rawTextParts = [bill.title];
        if (bill.policyArea?.name) rawTextParts.push(`Policy Area: ${bill.policyArea.name}.`);
        if (summaryText) rawTextParts.push(`Summary: ${summaryText}`);
        if (bill.latestAction?.text) rawTextParts.push(`Latest action: ${bill.latestAction.text}`);

        return {
          id: documentId,
          branch: 'legislative',
          title: bill.title,
          shortTitle: bill.title.length > 80 ? `${bill.title.slice(0, 80)}...` : bill.title,
          date: bill.latestAction?.actionDate ?? bill.introducedDate,
          status: bill.latestAction?.text ?? 'Introduced',
          statusLabel: determineStatusLabel(bill.latestAction?.text),
          category: mapPolicyAreaToCategory(bill.policyArea?.name),
          sourceUrl: publicUrl,
          rawText: rawTextParts.join(' '),
          metadata: {
            congress: bill.congress,
            sponsors: bill.sponsors,
            cosponsors: bill.cosponsors,
            committees: bill.committees,
            actions: bill.actions,
            policyArea: bill.policyArea?.name,
            summary: summaryText || undefined,
          },
        };
      }

      case 'executive': {
        const docNumber = documentId.replace('federal-register-', '');
        const response = await fetch(
          `https://www.federalregister.gov/api/v1/documents/${docNumber}.json`,
          { headers: { 'Accept': 'application/json' } }
        );

        if (!response.ok) return null;

        const item: FederalRegisterResult = await response.json();

        return {
          id: documentId,
          branch: 'executive',
          title: item.title,
          shortTitle: item.title.length > 80 ? `${item.title.slice(0, 80)}...` : item.title,
          date: item.signing_date ?? item.publication_date,
          status: 'active',
          statusLabel: 'active' as LegislativeStatus,
          category: mapExecutiveTypeToCategory(item.subtype, item.agencies?.map(a => a.name)),
          sourceUrl: item.html_url,
          rawText: item.abstract ?? item.title,
          metadata: {
            documentNumber: item.document_number,
            eoNumber: item.executive_order_number ? `EO ${item.executive_order_number}` : item.document_number,
            president: item.president?.name,
            fullTextUrl: item.raw_text_url,
            pdfUrl: item.pdf_url,
          },
        };
      }

      case 'judicial': {
        const opinionId = documentId.replace('courtlistener-', '');
        const response = await fetch(
          `https://www.courtlistener.com/api/rest/v4/opinions/${opinionId}/`,
          {
            headers: {
              'Accept': 'application/json',
              'Authorization': `Token ${API_KEYS.courtListener}`,
            },
          }
        );

        if (!response.ok) return null;

        const item = await response.json();

        return {
          id: documentId,
          branch: 'judicial',
          title: item.case_name ?? `Case ${opinionId}`,
          shortTitle: (item.case_name ?? `Case ${opinionId}`).slice(0, 80),
          date: item.date_filed ?? '',
          status: 'decided',
          statusLabel: 'landmark' as LegislativeStatus,
          category: 'civil_rights',
          sourceUrl: `https://www.courtlistener.com${item.absolute_url}`,
          rawText: item.plain_text ?? item.html ?? item.case_name,
          metadata: {
            docketNumber: item.docket,
            judges: item.judges,
            citations: item.citations,
          },
        };
      }

      default:
        return null;
    }
  } catch (error) {
    console.error('Error fetching document details:', error);
    return null;
  }
}

// ===========================================
// FETCH BILL SPONSOR FROM CONGRESS.GOV
// ===========================================

export interface SponsorInfo {
  name: string;
  party: string;
  state: string;
  district?: string;
  bioguideId?: string;
  imageUrl?: string;
}

export async function fetchBillSponsor(sourceUrl: string): Promise<SponsorInfo | null> {
  try {
    // Extract bill info from Congress.gov URL
    // URL format: https://www.congress.gov/bill/118th-congress/house-bill/1234
    const urlMatch = sourceUrl.match(/congress\.gov\/bill\/(\d+)(?:th|st|nd|rd)-congress\/(house|senate)-bill\/(\d+)/i);

    if (!urlMatch) {
      console.log('Could not parse Congress.gov URL:', sourceUrl);
      return null;
    }

    const [, congress, chamber, billNumber] = urlMatch;
    const billType = chamber.toLowerCase() === 'house' ? 'hr' : 's';

    // Fetch bill details from Congress.gov API
    const response = await fetch(
      `https://api.congress.gov/v3/bill/${congress}/${billType}/${billNumber}?api_key=${API_KEYS.congress}`,
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
