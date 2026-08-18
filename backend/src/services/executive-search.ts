/**
 * Executive branch search — the Federal Register, asked in its own language.
 *
 * WHAT IT USED TO DO. The reader's words went into `conditions[term]`
 * untouched. Measured against the live API:
 *
 *   "laws about protecting kids from vaccines"
 *     → 30 results, the first being "National Child's Day, 2023"
 *
 * The Federal Register was working perfectly. It was asked whether the words
 * "laws", "about", "protecting", "kids", "from" and "vaccines" appear in a
 * document, and it answered honestly. Nobody writes an executive order using
 * the word "kids".
 *
 * WHAT IT DOES NOW. The same question, understood first and then asked as a
 * quoted phrase in the language the order itself uses:
 *
 *   "childhood vaccine" + presidential documents
 *     → 2 results, both the actual executive order
 *
 * A LADDER, NOT A GUESS. The precise phrase is tried first and the broad terms
 * after it, because precision that returns nothing is not precision. Results
 * merge in that order, so an exact-phrase hit outranks a loose keyword hit that
 * happens to be newer.
 *
 * WHY NOTHING IS FILTERED OUT HERE. The Federal Register searches the FULL TEXT
 * of every document and returns only the title and abstract. A document can
 * match perfectly on wording that never appears in either. Dropping results
 * whose titles do not match our keywords would throw away exactly the documents
 * full-text search exists to find — so what we compute here ORDERS results, it
 * never removes them. The source did the filtering; it is the only party that
 * can see what it filtered on.
 */

import type { SearchIntent } from "./search-intent";
import { interpretSearch } from "./search-intent";

export interface ExecutiveDocument {
  title: string;
  type: string;
  subtype: string;
  abstract: string;
  publication_date: string;
  signing_date: string;
  executive_order_number: string;
  president: string;
  agencies: Array<{ name: string }>;
  html_url: string;
  document_number: string;
  /** Which query found it, in plain words. Shown to nobody; read in the logs. */
  matchedVia: string[];
}

export interface ExecutiveSearchOutput {
  results: ExecutiveDocument[];
  count: number;
  intent: SearchIntent;
  /** The queries actually sent, in order, for the log line. */
  attempted: string[];
}

interface RawDocument {
  title?: string;
  type?: string;
  subtype?: string;
  abstract?: string | null;
  publication_date?: string;
  signing_date?: string;
  executive_order_number?: string | number | null;
  president?: { name?: string } | null;
  agencies?: Array<{ name?: string }>;
  html_url?: string;
  document_number?: string;
}

const FIELDS = [
  "title", "type", "subtype", "abstract", "publication_date", "signing_date",
  "executive_order_number", "president", "agencies", "html_url", "document_number",
];

const TIMEOUT_MS = 8_000;
/** Network calls per search. The Federal Register is fast and unthrottled, but
 *  this sits in front of a person waiting for a list. */
const MAX_QUERIES = 3;

/** One rung of the ladder: a term expression and what it is worth if it hits. */
interface Rung {
  term: string;
  label: string;
  /** Precision credit. An exact-phrase match is stronger evidence than keywords. */
  weight: number;
}

/**
 * Most precise first.
 *
 * Each phrase is quoted, because that is the whole difference between finding
 * the order and finding National Child's Day. The unquoted topic goes last as
 * the safety net for a query whose phrasing we guessed wrong.
 */
export function buildLadder(intent: SearchIntent): Rung[] {
  const rungs: Rung[] = [];

  for (const phrase of intent.phrases) {
    rungs.push({ term: `"${phrase}"`, label: `phrase "${phrase}"`, weight: 100 });
  }

  // Every phrase in ONE request, joined by OR.
  //
  // This was AND, on the reasoning that two phrases together are narrower than
  // either alone. Measured against the live API, `"childhood vaccine" AND
  // "immunization schedule"` returns ZERO — the two phrases rarely co-occur in
  // one document, so the narrowest rung was also an empty one. And because it
  // led the ladder, it consumed a request and pushed the broad topic rung off
  // the end of the budget entirely.
  //
  // OR is both cheaper and better: one request that reaches every document
  // matching any phrase in the family, which is what the family is for.
  if (intent.phrases.length >= 2) {
    rungs.unshift({
      term: intent.phrases.map((p) => `"${p}"`).join(" OR "),
      label: `any of ${intent.phrases.length} phrases`,
      weight: 130,
    });
  }

  // The safety net, and it is never optional.
  //
  // Interpretation can produce phrases that read plausibly and appear in no
  // document. When that happens the precise rungs all return nothing, and the
  // broad query is the only thing standing between the reader and an empty
  // page — so it is appended AFTER the ladder is trimmed, not before.
  const precise = rungs.slice(0, Math.max(1, MAX_QUERIES - 1));
  const broad = intent.topic || intent.raw;
  return [...precise, { term: broad, label: `topic "${broad}"`, weight: 50 }];
}

function urlFor(intent: SearchIntent, rung: Rung, perPage: number): string {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("conditions[term]", rung.term);
  // Presidential documents: orders, proclamations, memoranda. Both clients
  // label this search "executive orders", so agency rulemaking is noise.
  url.searchParams.append("conditions[type][]", "PRESDOCU");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("per_page", String(perPage));

  // NO AGENCY FILTER. It was here and it silently emptied the results.
  //
  // Measured: conditions[agencies][] with a name the model produces
  // ("Department of Health and Human Services") answers HTTP 400, and the API's
  // own slug ("health-and-human-services-department") answers 0 — presidential
  // documents are not attributed to agencies in the first place. Applied to
  // every rung, it turned a working search into an empty one whenever the
  // interpretation happened to mention a department.
  //
  // Agencies stay in the intent because they are good ranking signal; they are
  // simply never used to filter.
  if (intent.from) url.searchParams.set("conditions[publication_date][gte]", intent.from);
  if (intent.to) url.searchParams.set("conditions[publication_date][lte]", intent.to);
  for (const field of FIELDS) url.searchParams.append("fields[]", field);

  return url.toString();
}

async function fetchRung(url: string): Promise<{ results: RawDocument[]; count: number } | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[executive-search] ${response.status} from federalregister.gov`);
      return null;
    }
    const data = (await response.json()) as { results?: RawDocument[]; count?: number };
    return { results: data.results ?? [], count: data.count ?? 0 };
  } catch {
    return null;
  }
}

function normalize(doc: RawDocument, matchedVia: string[]): ExecutiveDocument {
  return {
    title: doc.title ?? "",
    type: doc.type ?? "",
    subtype: doc.subtype ?? "",
    abstract: doc.abstract ?? "",
    publication_date: doc.publication_date ?? "",
    signing_date: doc.signing_date ?? "",
    executive_order_number:
      doc.executive_order_number != null ? String(doc.executive_order_number) : "",
    president: doc.president?.name ?? "",
    agencies: (doc.agencies ?? []).map((a) => ({ name: a.name ?? "" })),
    html_url: doc.html_url ?? "",
    document_number: doc.document_number ?? "",
    matchedVia,
  };
}

/**
 * Order the merged results.
 *
 * Two numbers kept apart on purpose, the same way the legislative ranker keeps
 * them apart. RELEVANCE is earned from the query: which rung found it, how well
 * the source ranked it there, and whether the words show up in the title.
 * PROMINENCE is the document being recent. Prominence may reorder results;
 * it can never be the reason one is in the list.
 */
function score(
  doc: ExecutiveDocument,
  intent: SearchIntent,
  best: { weight: number; rank: number },
): { relevance: number; prominence: number; total: number } {
  // The rung that found it, and how highly that rung's own relevance ranked it.
  let relevance = best.weight + Math.max(0, 20 - best.rank * 2);

  const haystack = `${doc.title} ${doc.abstract}`.toLowerCase();
  for (const phrase of intent.phrases) {
    if (haystack.includes(phrase.toLowerCase())) relevance += 40;
  }
  for (const term of intent.terms) {
    if (haystack.includes(term.toLowerCase())) relevance += 6;
  }
  // An executive order proper, when the reader asked about presidential action.
  if (intent.presidentialOnly && doc.executive_order_number) relevance += 10;

  const signed = Date.parse(doc.signing_date || doc.publication_date || "");
  const ageDays = Number.isFinite(signed) ? (Date.now() - signed) / 86_400_000 : 9_999;
  const prominence = ageDays < 365 ? 25 : ageDays < 365 * 4 ? 10 : 0;

  return { relevance, prominence, total: relevance + prominence };
}

export async function searchExecutiveDocuments(
  query: string,
  limit: number,
): Promise<ExecutiveSearchOutput> {
  const intent = await interpretSearch(query, "executive");
  const ladder = buildLadder(intent);

  const found = new Map<string, { doc: ExecutiveDocument; weight: number; rank: number }>();
  const attempted: string[] = [];
  let count = 0;

  for (const rung of ladder) {
    const page = await fetchRung(urlFor(intent, rung, Math.max(limit, 20)));
    attempted.push(`${rung.label} -> ${page ? `${page.count} hit(s)` : "failed"}`);
    if (!page) continue;
    count = Math.max(count, page.count);

    page.results.forEach((raw, rank) => {
      const key = raw.document_number || raw.html_url || raw.title || "";
      if (!key) return;
      const existing = found.get(key);
      if (existing) {
        existing.doc.matchedVia.push(rung.label);
        // Keep the strongest evidence, not the latest.
        if (rung.weight > existing.weight) {
          existing.weight = rung.weight;
          existing.rank = rank;
        }
        return;
      }
      found.set(key, { doc: normalize(raw, [rung.label]), weight: rung.weight, rank });
    });

    // Enough precise hits to fill the page — no need to widen and dilute them.
    if (found.size >= limit && rung.weight >= 100) break;
  }

  const results = [...found.values()]
    .map((entry) => ({ doc: entry.doc, score: score(entry.doc, intent, entry) }))
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit)
    .map((entry) => entry.doc);

  return { results, count: Math.max(count, results.length), intent, attempted };
}
