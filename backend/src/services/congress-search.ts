import { prisma } from "../prisma";
import { webSearchAvailable } from "./web-search";
import { interpretSearch } from "./search-intent";
import {
  ReferenceKind,
  billReferenceId,
  isBillType,
  parseReferenceId,
} from "./master-reference-id";

/**
 * Multi-source Congress bill search.
 *
 * The congress.gov v3 list API has NO text search, so a single-source
 * "fetch recent + filter titles" approach misses anything not updated
 * recently (e.g. the SAVE Act). This service merges five sources:
 *
 *   1. GovInfo full-text/title relevance search (true search over ALL bills;
 *      works with the same api.data.gov key as congress.gov)
 *   2. AI query interpretation, grounded in live web search — recognizes
 *      famous legislation by name from current events and expands acronyms
 *      (SAVE → Safeguard American Voter Eligibility), enabling direct bill
 *      lookups. Web snippets are fetched first (services/web-search.ts) so
 *      headlines newer than the model's training data still resolve to real
 *      bill numbers; grounding is best-effort and degrades silently.
 *   3. Explicit bill references typed by the user ("HR 22", "s. 1234")
 *   4. The recently-updated pool from congress.gov (fresh bills)
 *   5. The app's own GovernmentReference table (community aliases +
 *      engagement), keyed by masterReferenceId
 *
 * Results are deduped by canonical masterReferenceId (`hr-22-119`), scored
 * for relevance, and linked back to existing GovernmentReference rows.
 */

// ---------- Types ----------

export interface BillIdentity {
  congress: number;
  type: string; // hr, s, hjres, sjres, hconres, sconres, hres, sres
  number: string;
}

export interface RankedBill extends BillIdentity {
  title: string;
  originChamber: string;
  latestAction?: { actionDate: string; text: string };
  url: string;
  masterReferenceId: string;
  updateDate?: string;
  score: number;
  /**
   * The part of the score that came from matching the query, as opposed to the
   * bill simply being recent or prominent. Always > 0 for a returned result —
   * if this is ever 0, something reached the reader without matching what they
   * asked for, which is the defect this field exists to make visible.
   */
  relevance: number;
  matchedVia: string[];
  reference: {
    id: string;
    supportVotes: number;
    opposeVotes: number;
    totalComments: number;
    postsCount: number;
  } | null;
}

interface SourceBill extends BillIdentity {
  title?: string;
  originChamber?: string;
  latestAction?: { actionDate: string; text: string };
  updateDate?: string;
  source: string;
  sourceRank: number; // position within its source (0 = best)
  progress?: number; // legislative progress (0 introduced .. 50 enrolled)
}

interface Interpretation {
  knownBills: BillIdentity[];
  expandedTerms: string[];
  correctedQuery?: string;
  congress?: number;
  billType?: string;
}

const CURRENT_CONGRESS = 119;

const STOPWORDS = new Set([
  "act", "bill", "law", "the", "of", "and", "to", "for", "a", "an",
  "in", "on", "or", "resolution", "amendment", "legislation",
]);

// ---------- Helpers ----------

/**
 * The canonical name of a bill record.
 *
 * Delegates to master-reference-id.ts rather than formatting the string here,
 * because a second opinion about naming is exactly how search ended up looking
 * for `sres-829-119` while the database held `s-res-829-119`. `??` is not a
 * fallback to a guess: billReferenceId only returns null for a measure type
 * congress.gov does not publish, and the raw form is then more honest than a
 * corrected one.
 */
export function masterRefId(b: BillIdentity): string {
  return (
    billReferenceId({ type: b.type, number: b.number, congress: b.congress }) ??
    `${b.type.toLowerCase()}-${b.number}-${b.congress}`
  );
}

function meaningfulKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((k) => k.length > 1 && !STOPWORDS.has(k));
}

const CHAMBER_SLUGS: Record<string, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres: "house-resolution",
  sres: "senate-resolution",
};

function ordinal(n: number): string {
  const rem = n % 10;
  const suffix = rem === 1 && n % 100 !== 11 ? "st" : rem === 2 && n % 100 !== 12 ? "nd" : rem === 3 && n % 100 !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

/** Human-facing congress.gov page (not the raw JSON API URL). */
function congressGovUrl(b: BillIdentity): string {
  const slug = CHAMBER_SLUGS[b.type.toLowerCase()] ?? "house-bill";
  return `https://www.congress.gov/bill/${ordinal(b.congress)}-congress/${slug}/${b.number}`;
}

function originChamberFor(type: string): string {
  return type.toLowerCase().startsWith("h") ? "House" : "Senate";
}

/**
 * Legislative-progress weight from a GovInfo bill version suffix.
 * A bill that has passed a chamber (or both) is far more prominent than one
 * that was only introduced — this ranks the newsworthy SAVE Act (passed the
 * House) above the four other bills that happen to share the name.
 */
function progressWeight(version: string): number {
  if (version.startsWith("enr")) return 50; // enrolled — passed both chambers
  if (version.startsWith("ea")) return 35; // engrossed amendment
  if (version.startsWith("e")) return 30; // engrossed — passed its chamber
  if (version.startsWith("rf") || version.startsWith("rd") || version.startsWith("pc")) return 30; // arrived in the other chamber
  if (version.startsWith("r")) return 10; // reported from committee
  if (version.startsWith("i")) return 0; // introduced
  return 5;
}

/** Parse a GovInfo package id like BILLS-119hr22eh into identity + progress. */
function parsePackageId(packageId: string): (BillIdentity & { progress: number }) | null {
  const m = /^BILLS-(\d+)(hconres|hjres|hres|hr|sconres|sjres|sres|s)(\d+)([a-z0-9]*)$/.exec(packageId);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return {
    congress: parseInt(m[1], 10),
    type: m[2],
    number: m[3],
    progress: progressWeight(m[4] ?? ""),
  };
}

/** Parse explicit references typed by the user: "HR 22", "h.r.22", "S 1234". */
export function parseExplicitBillRefs(query: string): BillIdentity[] {
  const refs: BillIdentity[] = [];
  const re = /\b(h\.?\s?r\.?|s\.?|h\.?j\.?\s?res\.?|s\.?j\.?\s?res\.?|h\.?con\.?\s?res\.?|s\.?con\.?\s?res\.?|h\.?\s?res\.?|s\.?\s?res\.?)\s*(\d{1,5})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const prefix = (m[1] ?? "").toLowerCase().replace(/[.\s]/g, "");
    const number = m[2] ?? "";
    if (isBillType(prefix) && number) {
      refs.push({ congress: CURRENT_CONGRESS, type: prefix, number });
    }
  }
  return refs;
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T | null> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!response.ok) {
      console.error(`[congress-search] ${url.split("?")[0]} -> ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (e) {
    console.error(`[congress-search] fetch failed: ${url.split("?")[0]}`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ---------- Source 1: GovInfo relevance search ----------

interface GovInfoResponse {
  results?: Array<{ packageId?: string; title?: string; lastModified?: string; dateIssued?: string }>;
}

async function govInfoSearch(
  apiKey: string,
  query: string,
  congress: number,
  source: string,
  titleScoped: boolean,
): Promise<SourceBill[]> {
  const scoped = titleScoped ? `title:(${query})` : query;
  // Current + previous congress: landmark laws people search for ("tiktok
  // ban") are often from the session that just ended.
  const congressScope = `${congress} OR ${congress - 1}`;
  const data = await fetchJson<GovInfoResponse>("https://api.govinfo.gov/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
    body: JSON.stringify({
      query: `${scoped} collection:(BILLS) congress:(${congressScope})`,
      pageSize: 100,
      offsetMark: "*",
      sorts: [{ field: "score", sortOrder: "DESC" }],
    }),
  });

  const bills: SourceBill[] = [];
  const byKey = new Map<string, SourceBill>();
  for (const r of data?.results ?? []) {
    if (!r.packageId) continue;
    const id = parsePackageId(r.packageId);
    if (!id) continue;
    const key = masterRefId(id);
    const existing = byKey.get(key);
    if (existing) {
      // GovInfo returns one entry per print version — keep the furthest progress.
      existing.progress = Math.max(existing.progress ?? 0, id.progress);
      continue;
    }
    const bill: SourceBill = {
      congress: id.congress,
      type: id.type,
      number: id.number,
      progress: id.progress,
      title: r.title,
      updateDate: r.lastModified ?? r.dateIssued,
      source,
      sourceRank: bills.length,
    };
    byKey.set(key, bill);
    bills.push(bill);
  }
  return bills;
}

// ---------- Source 2: AI interpretation (current-events knowledge) ----------

/**
 * Translate an informal query into formal legislative search terms.
 *
 * Two-step "search grounding": live web snippets are fetched first (see
 * services/web-search.ts) and passed in here as context, so the model can
 * resolve breaking headlines to real bill numbers instead of guessing from
 * training memory alone. Grounding is best-effort — when snippets are empty
 * (no key, timeout, no hits) this behaves exactly as it did before.
 */
/**
 * Understand the query — through the layer all three branches share.
 *
 * This used to be a hand-rolled call straight to one hardcoded OpenAI model.
 * Two things were wrong with that, and neither was the prompt:
 *
 *   1. No failover. generateAI walks to the other provider when the first one
 *      is down; a direct fetch just returns nothing, and interpretation went
 *      silently off for every reader with no signal anywhere that it had.
 *   2. Only bills had one at all. Executive and judicial search passed the
 *      reader's raw words to a government API and returned whatever matched,
 *      which is how "laws about protecting kids from vaccines" produced
 *      "National Child's Day, 2023".
 *
 * The understanding step is one thing now; what each branch does with it is
 * three things, because the three sources speak three different languages.
 * Nothing legislative search could express before is lost — including the
 * Congress and bill-type constraints, which are still honoured only when the
 * reader states them.
 */
async function interpretQuery(query: string): Promise<Interpretation> {
  const intent = await interpretSearch(query, "legislative");
  if (!intent.interpreted) return { knownBills: [], expandedTerms: [] };

  const corrected = intent.topic.trim();
  return {
    knownBills: intent.bills
      .filter((b) => isBillType(b.type))
      .map((b) => ({ congress: b.congress, type: b.type, number: b.number })),
    // Phrases first: they are the wording most likely to appear in a bill's
    // official title, which is what these terms are searched against.
    expandedTerms: [...intent.phrases, ...intent.terms].slice(0, 8),
    correctedQuery:
      corrected && corrected !== query.trim().toLowerCase() ? corrected : undefined,
    congress: intent.congress ?? undefined,
    billType: intent.billType ?? undefined,
  };
}

// ---------- Source 3: direct bill lookup (congress.gov detail) ----------

interface CongressBillDetail {
  bill?: {
    congress?: number;
    number?: string;
    title?: string;
    type?: string;
    originChamber?: string;
    updateDate?: string;
    latestAction?: { actionDate: string; text: string };
  };
}

async function lookupBill(apiKey: string, id: BillIdentity, source: string): Promise<SourceBill | null> {
  const data = await fetchJson<CongressBillDetail>(
    `https://api.congress.gov/v3/bill/${id.congress}/${id.type.toLowerCase()}/${id.number}?format=json&api_key=${apiKey}`,
  );
  const bill = data?.bill;
  if (!bill?.title) return null;
  return {
    congress: bill.congress ?? id.congress,
    type: (bill.type ?? id.type).toLowerCase(),
    number: String(bill.number ?? id.number),
    title: bill.title,
    originChamber: bill.originChamber,
    latestAction: bill.latestAction,
    updateDate: bill.updateDate,
    source,
    sourceRank: 0,
  };
}

// ---------- Source 4: recently-updated pool ----------

interface CongressListResponse {
  bills?: Array<{
    congress: number;
    number: string;
    title: string;
    type: string;
    originChamber: string;
    updateDate?: string;
    latestAction?: { actionDate: string; text: string };
  }>;
}

/**
 * How much of `keywords` must appear in `title` to count as a match.
 * Short queries (1-2 words) require every word — otherwise a single common
 * word would match almost everything. Longer, more descriptive queries
 * (the kind real users type — "merging israel military aid") require only a
 * majority, since a title rarely restates every word of a colloquial phrase.
 */
function keywordsMatch(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const matched = keywords.filter((k) => title.includes(k)).length;
  const threshold = keywords.length <= 2 ? keywords.length : Math.ceil(keywords.length * 0.6);
  return matched >= threshold;
}

async function recentPool(apiKey: string, congress: number, keywords: string[]): Promise<SourceBill[]> {
  if (keywords.length === 0) return [];
  // NOTE: the API needs a literal "+" in sort — URL-encoding it to %2B makes
  // congress.gov silently fall back to oldest-first order.
  const url = `https://api.congress.gov/v3/bill/${congress}?limit=250&format=json&api_key=${apiKey}&sort=updateDate+desc`;
  const data = await fetchJson<CongressListResponse>(url);
  const out: SourceBill[] = [];
  for (const bill of data?.bills ?? []) {
    const title = (bill.title || "").toLowerCase();
    if (!keywordsMatch(title, keywords)) continue;
    out.push({
      congress: bill.congress,
      type: bill.type.toLowerCase(),
      number: String(bill.number),
      title: bill.title,
      originChamber: bill.originChamber,
      latestAction: bill.latestAction,
      updateDate: bill.updateDate,
      source: "recent",
      sourceRank: out.length,
    });
  }
  return out;
}

// ---------- Source 5: local GovernmentReference table ----------

interface DbRef {
  id: string;
  masterReferenceId: string;
  title: string;
  shortTitle: string | null;
  congress: number | null;
  supportVotes: number;
  opposeVotes: number;
  totalComments: number;
  postsCount: number;
}

async function searchDbReferences(query: string, keywords: string[]): Promise<DbRef[]> {
  const terms = [query, ...keywords].filter((t) => t.length > 1);
  if (terms.length === 0) return [];
  const rows = await prisma.governmentReference.findMany({
    where: {
      referenceType: "bill",
      mergedIntoId: null,
      OR: terms.flatMap((t) => [
        { title: { contains: t } },
        { shortTitle: { contains: t } },
        { aliases: { contains: t.toLowerCase().replace(/\s+/g, "-") } },
        { masterReferenceId: { contains: t.toLowerCase() } },
      ]),
    },
    take: 25,
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
      shortTitle: true,
      congress: true,
      supportVotes: true,
      opposeVotes: true,
      totalComments: true,
      _count: { select: { posts: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    masterReferenceId: r.masterReferenceId,
    title: r.title,
    shortTitle: r.shortTitle,
    congress: r.congress,
    supportVotes: r.supportVotes,
    opposeVotes: r.opposeVotes,
    totalComments: r.totalComments,
    postsCount: r._count.posts,
  }));
}

/**
 * Parse a bill masterReferenceId like "hr-22-119" back into an identity.
 *
 * Returns null when the stored id carries no Congress, because everything
 * downstream of this — the congress.gov lookup, the public URL — needs one and
 * would otherwise have to invent it.
 */
function parseMasterRefId(id: string): BillIdentity | null {
  const key = parseReferenceId(ReferenceKind.BILL, id);
  if (key?.kind !== "bill" || key.congress === null) return null;
  return { type: key.billType, number: key.number, congress: key.congress };
}

// ---------- Scoring ----------

/**
 * Progress inferred from a bill's latest action text — the authoritative
 * signal for how far it advanced (used to rank e.g. the House-passed SAVE Act
 * above unrelated introduced bills that share the name).
 */
function actionProgress(actionText?: string): number {
  if (!actionText) return 0;
  const t = actionText.toLowerCase();
  if (t.includes("became public law") || t.includes("signed by president")) return 60;
  if (t.includes("passed") || t.includes("agreed to")) return 30;
  if (t.includes("received in the senate") || t.includes("received in the house")) return 30;
  if (t.includes("cloture") || t.includes("motion to proceed")) return 30;
  if (t.includes("reported")) return 10;
  return 0;
}

function daysSince(dateStr?: string): number {
  if (!dateStr) return Infinity;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 86_400_000;
}

/**
 * Two numbers, deliberately kept apart: did this bill match what was asked for,
 * and how prominent is it.
 *
 * THE BUG THIS SPLIT EXISTS FOR. There used to be one score and a `> 10` floor,
 * and a bill could clear that floor without matching the query at all: being in
 * the current Congress was +25, updated in the last 60 days +20, arriving from
 * the recently-updated pool +10, and a leadership bill number (HR/S 1-25) +15.
 * Seventy points of pure prominence, with a bar at ten. So every search
 * returned the same handful of freshly-touched headline bills whatever you
 * typed, and it read exactly like a canned list — because it was one.
 *
 * Relevance is earned from the query. Prominence only ORDERS things that
 * already earned it, and can never admit anything on its own.
 */
interface BillScore {
  /** Matched the query. Zero means this is not a search result. */
  relevance: number;
  /** Freshness, legislative progress, community activity. Ordering only. */
  prominence: number;
  total: number;
}

function scoreBill(
  bill: SourceBill & { sources: Set<string>; bestGovinfoTitleRank: number },
  query: string,
  keywords: string[],
  expandedTerms: string[],
  dbRef: DbRef | undefined,
): BillScore {
  const title = (bill.title ?? "").toLowerCase();
  const q = query.toLowerCase().trim();

  // ---- Relevance: every point here traces back to what was typed ----------
  let relevance = 0;

  // Asked for by name, or named by the interpreter as the bill in question.
  if (bill.sources.has("explicit")) relevance += 200;
  if (bill.sources.has("known-bill")) relevance += 80;

  if (q.length > 2 && title.includes(q)) relevance += 100;
  if (title.startsWith(q)) relevance += 40;

  // A bill whose ENTIRE title (or one part of a compound title like
  // "Safeguard American Voter Eligibility Act; SAVE Act") is the query or
  // "<query> act" is almost certainly the one the user means.
  const qBare = q.replace(/\s*\bact\b\s*/g, " ").replace(/\s+/g, " ").trim();
  const exactTitleHit = title.split(";").some((part) => {
    const bare = part
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\bof \d{4}\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return bare === q || bare === qBare || bare === `${qBare} act`;
  });
  if (exactTitleHit) relevance += 110;

  for (const term of expandedTerms) {
    if (title.includes(term.toLowerCase())) relevance += 60;
  }
  if (keywords.length > 0) {
    const matched = keywords.filter((k) => title.includes(k)).length;
    relevance += Math.round(50 * (matched / keywords.length));
  }

  // Found by a search, as opposed to merely being nearby.
  if (bill.sources.has("govinfo-title")) {
    relevance += Math.max(0, 30 - 2 * bill.bestGovinfoTitleRank);
  }
  if (bill.sources.has("govinfo-fulltext")) relevance += 10;
  // The local table was searched by text too, so being returned by it is a
  // match. Merely HAVING a reference row is not — that is a join, not a hit,
  // and it is scored as prominence below.
  if (bill.sources.has("db-reference")) relevance += 25;

  // ---- Prominence: ordering only. Never admits anything on its own. ------
  let prominence = 0;

  // The recently-updated pool is a source of candidates, not evidence of a
  // match. Whatever made it relevant is already counted above.
  if (bill.sources.has("recent")) prominence += 10;

  // How far the bill advanced (passed a chamber >> introduced)...
  prominence += bill.progress ?? 0;
  // ...and leadership-reserved bill numbers (HR 1-25 / S 1-25 are set aside
  // for each party's headline priorities — e.g. HR 22, the SAVE Act).
  const num = parseInt(bill.number, 10);
  if (!Number.isNaN(num) && num <= 25) prominence += 15;

  const age = Math.min(daysSince(bill.updateDate), daysSince(bill.latestAction?.actionDate));
  if (age < 60) prominence += 20;
  else if (age < 365) prominence += 10;

  // A 2009 resolution should never outrank a sitting-congress bill on the same
  // topic. Anything older than the previous congress is history, not news.
  if (bill.congress >= CURRENT_CONGRESS) prominence += 25;
  else if (bill.congress === CURRENT_CONGRESS - 1) prominence += 10;
  else prominence -= 80;

  if (dbRef) {
    prominence += 15;
    prominence += Math.min(
      30,
      dbRef.supportVotes + dbRef.opposeVotes + 2 * dbRef.totalComments + 2 * dbRef.postsCount,
    );
  }

  return { relevance, prominence, total: relevance + prominence };
}

// ---------- Main entry point ----------

export interface CongressSearchOutput {
  results: RankedBill[];
  totalMatched: number;
  interpretation: {
    expandedTerms: string[];
    knownBillCount: number;
    /** Web snippets used to ground the interpretation (0 = ungrounded). */
    groundedSnippets: number;
  };
}

export async function searchCongressBills(
  apiKey: string,
  query: string,
  limit: number,
  offset: number,
): Promise<CongressSearchOutput> {
  const keywords = meaningfulKeywords(query);
  const explicitRefs = parseExplicitBillRefs(query);

  // Legislation is overwhelmingly named "<Something> Act" — when the user
  // types a short query ("save", "chips"), also search for that exact-phrase
  // act name so acronym-titled bills (SAVE Act, CHIPS Act) always surface.
  const actPhrase =
    keywords.length > 0 && keywords.length <= 2 && !/\bact\b/i.test(query)
      ? `"${keywords.join(" ")} act"`
      : null;

  // Phase 1 — all independent sources in parallel.
  // Search grounding: fetch live web snippets, then interpret the query with
  // them as context. These two are serial (the model needs the snippets), but
  // the whole chain still runs in parallel with every GovInfo/DB source below,
  // so grounding costs only the web-search leg (<=2.5s) on the critical path.
  // The shared layer does its own grounding — it is the one that knows which
  // kind of web search suits the branch being searched ("congress bill
  // legislation" here, "supreme court ruling" for an opinion). Counting
  // snippets separately would mean fetching them twice.
  const groundedInterpretation = interpretQuery(query).then((i) => ({
    ...i,
    groundedSnippets: webSearchAvailable() ? 1 : 0,
  }));

  const [interpretation, govinfoTitle, govinfoActPhrase, govinfoFull, pool, dbRefs, explicitBills] = await Promise.all([
    groundedInterpretation,
    govInfoSearch(apiKey, query, CURRENT_CONGRESS, "govinfo-title", true),
    actPhrase
      ? govInfoSearch(apiKey, actPhrase, CURRENT_CONGRESS, "govinfo-title", true)
      : Promise.resolve([]),
    govInfoSearch(apiKey, query, CURRENT_CONGRESS, "govinfo-fulltext", false),
    recentPool(apiKey, CURRENT_CONGRESS, keywords),
    searchDbReferences(query, keywords),
    Promise.all(explicitRefs.map((r) => lookupBill(apiKey, r, "explicit"))),
  ]);

  // Phase 2 — lookups that depend on AI output (famous bills + expansions).
  const knownBillIds = interpretation.knownBills.filter(
    (kb) => !explicitRefs.some((e) => masterRefId(e) === masterRefId(kb)),
  );

  // Spell-corrected / topically-restated keywords — the main lever for
  // colloquial, typo-laden, current-events-style queries ("merging isreal
  // military") where the literal query matches nothing.
  const correctedKeywords = interpretation.correctedQuery ? meaningfulKeywords(interpretation.correctedQuery) : [];
  const combinedKeywords = [...new Set([...keywords, ...correctedKeywords])];

  // Broad topical terms (expansions + corrected query) get merged into a
  // single OR query per GovInfo call — real bill text/title is far more
  // likely to contain the *correctly spelled, formally worded* version of a
  // topic than the user's exact literal phrasing.
  const broadTerms = [...new Set([...interpretation.expandedTerms, ...(interpretation.correctedQuery ? [interpretation.correctedQuery] : [])])];
  const broadOrQuery = broadTerms.map((t) => `(${t})`).join(" OR ");

  const [knownBills, broadTitle, broadFulltext, correctedPool, correctedDbRefs] = await Promise.all([
    Promise.all(knownBillIds.map((kb) => lookupBill(apiKey, kb, "known-bill"))),
    broadTerms.length > 0
      ? govInfoSearch(apiKey, broadOrQuery, CURRENT_CONGRESS, "govinfo-title", true)
      : Promise.resolve([]),
    broadTerms.length > 0
      ? govInfoSearch(apiKey, broadOrQuery, CURRENT_CONGRESS, "govinfo-fulltext", false)
      : Promise.resolve([]),
    correctedKeywords.length > 0 ? recentPool(apiKey, CURRENT_CONGRESS, correctedKeywords) : Promise.resolve([]),
    interpretation.correctedQuery ? searchDbReferences(interpretation.correctedQuery, correctedKeywords) : Promise.resolve([]),
  ]);

  // Merge original + spell-corrected DB reference lookups (dedup by id).
  const allDbRefs = [...dbRefs, ...correctedDbRefs.filter((r) => !dbRefs.some((d) => d.id === r.id))];

  // DB refs whose masterReferenceId parses as a bill join the candidate set too
  // (community-created references stay searchable even with no API hit).
  const dbSourceBills: SourceBill[] = [];
  for (const ref of allDbRefs) {
    const id = parseMasterRefId(ref.masterReferenceId);
    if (!id) continue;
    dbSourceBills.push({
      ...id,
      title: ref.shortTitle ?? ref.title,
      source: "db-reference",
      sourceRank: dbSourceBills.length,
    });
  }

  // Merge + dedupe by masterReferenceId.
  const merged = new Map<string, SourceBill & { sources: Set<string>; bestGovinfoTitleRank: number }>();
  const allSources: SourceBill[] = [
    ...explicitBills.filter((b): b is SourceBill => b !== null),
    ...knownBills.filter((b): b is SourceBill => b !== null),
    ...govinfoTitle,
    ...govinfoActPhrase,
    ...broadTitle,
    ...broadFulltext,
    ...govinfoFull,
    ...pool,
    ...correctedPool,
    ...dbSourceBills,
  ];
  for (const bill of allSources) {
    const key = masterRefId(bill);
    const existing = merged.get(key);
    if (existing) {
      existing.sources.add(bill.source);
      // Prefer richer data (title/latestAction) from whichever source has it.
      existing.title = existing.title ?? bill.title;
      existing.originChamber = existing.originChamber ?? bill.originChamber;
      existing.latestAction = existing.latestAction ?? bill.latestAction;
      existing.updateDate = existing.updateDate ?? bill.updateDate;
      existing.progress = Math.max(existing.progress ?? 0, bill.progress ?? 0);
      if (bill.source === "govinfo-title") {
        existing.bestGovinfoTitleRank = Math.min(existing.bestGovinfoTitleRank, bill.sourceRank);
      }
    } else {
      merged.set(key, {
        ...bill,
        sources: new Set([bill.source]),
        bestGovinfoTitleRank: bill.source === "govinfo-title" ? bill.sourceRank : 99,
      });
    }
  }

  // Link to existing GovernmentReference rows by masterReferenceId.
  const refByMasterId = new Map(allDbRefs.map((r) => [r.masterReferenceId, r]));
  const unlinkedIds = [...merged.keys()].filter((k) => !refByMasterId.has(k));
  if (unlinkedIds.length > 0) {
    const linked = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { in: unlinkedIds }, mergedIntoId: null },
      select: {
        id: true,
        masterReferenceId: true,
        title: true,
        shortTitle: true,
        congress: true,
        supportVotes: true,
        opposeVotes: true,
        totalComments: true,
        _count: { select: { posts: true } },
      },
    });
    for (const r of linked) {
      refByMasterId.set(r.masterReferenceId, {
        id: r.id,
        masterReferenceId: r.masterReferenceId,
        title: r.title,
        shortTitle: r.shortTitle,
        congress: r.congress,
        supportVotes: r.supportVotes,
        opposeVotes: r.opposeVotes,
        totalComments: r.totalComments,
        postsCount: r._count.posts,
      });
    }
  }

  // Preliminary score and rank.
  const ranked = [...merged.values()]
    .map((bill) => {
      const key = masterRefId(bill);
      const dbRef = refByMasterId.get(key);
      return { bill, key, dbRef, score: scoreBill(bill, query, combinedKeywords, broadTerms, dbRef) };
    })
    // MUST have matched the query. Prominence orders results; it does not
    // create them. The old floor was a total of 10, which a bill could clear on
    // freshness and a low bill number alone — which is why every search
    // returned the same recently-touched headline bills.
    .filter((r) => r.score.relevance > 0)
    .sort(
      (a, b) =>
        b.score.total - a.score.total ||
        daysSince(a.bill.updateDate) - daysSince(b.bill.updateDate),
    );

  // Hydrate the top candidates with congress.gov detail (GovInfo results lack
  // latestAction), then RE-score with real legislative progress so a
  // House-passed headline bill outranks same-named introduced bills.
  const hydrateCount = Math.min(ranked.length, offset + limit + 5, 24);
  await Promise.all(
    ranked.slice(0, hydrateCount).map(async (entry) => {
      if (!entry.bill.latestAction || !entry.bill.title) {
        const detail = await lookupBill(apiKey, entry.bill, "hydrate");
        if (detail) {
          entry.bill = { ...entry.bill, ...detail, source: entry.bill.source, sourceRank: entry.bill.sourceRank };
        }
      }
      // Legislative progress is prominence — a House-passed bill outranks a
      // same-named introduced one, but it cannot make an irrelevant bill appear.
      const progress = actionProgress(entry.bill.latestAction?.text);
      entry.score = {
        ...entry.score,
        prominence: entry.score.prominence + progress,
        total: entry.score.total + progress,
      };
    }),
  );
  const rescored = [
    ...ranked
      .slice(0, hydrateCount)
      .sort(
        (a, b) =>
          b.score.total - a.score.total ||
          daysSince(a.bill.updateDate) - daysSince(b.bill.updateDate),
      ),
    ...ranked.slice(hydrateCount),
  ];

  const page = rescored.slice(offset, offset + limit);
  const results = page.map(({ bill, key, dbRef, score }): RankedBill => ({
    congress: bill.congress,
    type: bill.type.toUpperCase(),
    number: bill.number,
    title: bill.title ?? dbRef?.title ?? "(untitled)",
    originChamber: bill.originChamber ?? originChamberFor(bill.type),
    latestAction: bill.latestAction,
    url: congressGovUrl(bill),
    masterReferenceId: key,
    updateDate: bill.updateDate,
    score: score.total,
    relevance: score.relevance,
    matchedVia: [...bill.sources],
    reference: dbRef
      ? {
          id: dbRef.id,
          supportVotes: dbRef.supportVotes,
          opposeVotes: dbRef.opposeVotes,
          totalComments: dbRef.totalComments,
          postsCount: dbRef.postsCount,
        }
      : null,
  }));

  return {
    results,
    totalMatched: ranked.length,
    interpretation: {
      expandedTerms: interpretation.expandedTerms,
      knownBillCount: interpretation.knownBills.length,
      groundedSnippets: interpretation.groundedSnippets,
    },
  };
}
