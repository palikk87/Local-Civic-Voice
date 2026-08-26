/**
 * Executive branch search — the Federal Register, asked exactly what was typed.
 *
 * NO INTERPRETATION LAYER, DELIBERATELY REMOVED. There was one, and it made
 * this worse. The reasoning behind it was sound and the measurement behind it
 * was too narrow: one full-sentence query ("laws about protecting kids from
 * vaccines") returns junk from a plain keyword search, so a rewriting layer was
 * built to fix it — and it was then applied to every query, including the ones
 * that were already fine.
 *
 * What people actually type is two or three words, and the Federal Register's
 * own full-text relevance search is very good at those. Measured, raw, with no
 * rewriting at all:
 *
 *   "tariffs"                 355 hits, first "Ending Certain Tariff Actions"
 *   "childhood vaccines"        9 hits, first "Delivering Gold Standard
 *                                       Childhood Vaccine Recommendations"
 *   "artificial intelligence"  66 hits, first "Promoting Advanced Artificial
 *                                       Intelligence Innovation and Security"
 *   "student loans"            92 hits, first "Restoring Public Service Loan
 *                                       Forgiveness"
 *
 * Every one of those is the document a person meant, found by typing the words
 * they would naturally type. A model rewriting "childhood vaccines" into a
 * quoted phrase of its own choosing could only move that result, never improve
 * it — and when the phrase it chose did not occur verbatim, the search returned
 * nothing at all.
 *
 * SCOPE: EXECUTIVE ORDERS. Not proclamations, memoranda or notices — see the
 * filter below for what that is worth on a real query.
 *
 * THE HONEST TRADE. A full natural-language sentence still searches poorly here
 * ("laws about protecting kids from vaccines" → 3 hits led by "National Child's
 * Day, 2023"), because it is being matched as words rather than read as a
 * question. That is the cost of this design and it is worth it: it fails on the
 * rare shape and is excellent on the common one, which is the opposite of what
 * it replaced.
 */

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
}

export interface ExecutiveSearchOutput {
  results: ExecutiveDocument[];
  count: number;
}

import { officialSourceHeaders } from "./official-source";

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

/**
 * Requested explicitly because the defaults omit what both clients need:
 * executive_order_number (so a result resolves to the real order), signing_date
 * (shown instead of the publication date) and subtype (drives the category chip).
 */
const FIELDS = [
  "title", "type", "subtype", "abstract", "publication_date", "signing_date",
  "executive_order_number", "president", "agencies", "html_url", "document_number",
];

const TIMEOUT_MS = 10_000;

function normalize(doc: RawDocument): ExecutiveDocument {
  return {
    title: doc.title ?? "",
    type: doc.type ?? "",
    subtype: doc.subtype ?? "",
    // The API returns null for a document with no abstract.
    abstract: doc.abstract ?? "",
    publication_date: doc.publication_date ?? "",
    signing_date: doc.signing_date ?? "",
    executive_order_number:
      doc.executive_order_number != null ? String(doc.executive_order_number) : "",
    president: doc.president?.name ?? "",
    agencies: (doc.agencies ?? []).map((a) => ({ name: a.name ?? "" })),
    html_url: doc.html_url ?? "",
    document_number: doc.document_number ?? "",
  };
}

/**
 * One request, the reader's own words, the Federal Register's own ranking.
 *
 * Nothing here reorders what comes back. The source searched the full text of
 * every document and returned them in its own relevance order; this code sees
 * only titles and abstracts, so any ranking it applied would be a worse opinion
 * formed from less information.
 */
export async function searchExecutiveDocuments(
  query: string,
  limit: number,
  offset = 0,
): Promise<ExecutiveSearchOutput> {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("conditions[term]", query);

  // EXECUTIVE ORDERS ONLY, not presidential documents generally.
  //
  // PRESDOCU alone also returns proclamations, memoranda, notices and
  // determinations. Both clients label this search "executive orders", and the
  // difference is not academic — measured on the live API:
  //
  //   "border security"   292 presidential documents, the second of which is
  //                       the proclamation "90th Anniversary of the Social
  //                       Security Act"
  //                        86 executive orders, the second of which is EO 14167,
  //                       "Clarifying the Military's Role in Protecting the
  //                       Territorial Integrity of the United States"
  //
  // The second list is the one somebody searching a civics app for executive
  // orders is asking for. It also means every result carries a real EO number,
  // which is what a record is named after (eo-14420) — a proclamation has no
  // number to be named by and cannot become one.
  url.searchParams.append("conditions[type][]", "PRESDOCU");
  url.searchParams.append("conditions[presidential_document_type][]", "executive_order");
  url.searchParams.set("order", "relevance");
  url.searchParams.set("per_page", String(limit));
  url.searchParams.set("page", String(Math.floor(offset / Math.max(limit, 1)) + 1));
  for (const field of FIELDS) url.searchParams.append("fields[]", field);

  const response = await fetch(url.toString(), {
    headers: officialSourceHeaders({ Accept: "application/json" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    console.warn(`[executive-search] ${response.status} from federalregister.gov for "${query}"`);
    return { results: [], count: 0 };
  }

  const data = (await response.json()) as { results?: RawDocument[]; count?: number };
  return {
    results: (data.results ?? []).map(normalize),
    count: data.count ?? 0,
  };
}
