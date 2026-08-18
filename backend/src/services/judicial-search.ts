/**
 * Judicial branch search — CourtListener, asked in the language of a ruling.
 *
 * WHAT IT USED TO DO. The reader's words went into CourtListener's `q`
 * untouched. Measured against the live API:
 *
 *   "can the government make you get a vaccine"
 *     → "Department of Education v. California" (2025), then two more
 *       unrelated cases
 *
 * The search engine was fine. It was handed a sentence in which the only
 * distinctive word is "vaccine" and asked to do its best.
 *
 * WHAT IT DOES NOW. The same question, translated into the words a court
 * actually writes:
 *
 *   "compulsory vaccination"
 *     → Jacobson v. Massachusetts (1905) — the case that decides exactly the
 *       question that was asked
 *
 * That gap is the whole feature. A reader asks in the language of a citizen;
 * an opinion is written in the language of a court; nobody was translating.
 *
 * TWO REQUESTS, MAXIMUM. CourtListener allows five a minute per account —
 * a ceiling one reader can hit by searching twice. So the ladder is short and
 * stops the moment it has enough, and a throttle is waited out rather than
 * reported as an empty result set.
 */

import { fetchCourtListener } from "./courtlistener";
import type { SearchIntent } from "./search-intent";
import { interpretSearch } from "./search-intent";

export interface JudicialResult {
  /** The opinion id, which addresses the text; falls back to the cluster id. */
  id: number;
  case_name: string;
  court: string;
  date_filed: string;
  docket_number: string;
  absolute_url: string;
  matchedVia: string[];
}

export interface JudicialSearchOutput {
  results: JudicialResult[];
  count: number;
  next?: string | undefined;
  intent: SearchIntent;
  attempted: string[];
}

interface RawCluster {
  cluster_id?: number;
  opinions?: Array<{ id?: number; snippet?: string }>;
  caseName?: string;
  court?: string;
  court_id?: string;
  dateFiled?: string;
  docketNumber?: string;
  absolute_url?: string;
  citeCount?: number;
}

/** Wall-clock budget for the whole search, including waiting out one throttle. */
const DEADLINE_MS = 20_000;
/** Requests per search. Five a minute is the account ceiling; two is a search. */
const MAX_QUERIES = 2;

interface Rung {
  q: string;
  label: string;
  weight: number;
  /** Restrict to one court, or search them all. */
  court?: "scotus";
}

/**
 * Most precise first — and the Supreme Court before every court.
 *
 * THE ORDER HERE WAS MEASURED, AND THE FIRST VERSION WAS WRONG. Searching
 * `"compulsory vaccination"` across all federal courts returns 290 results led
 * by district-court disputes; Jacobson v. Massachusetts is nowhere near the
 * first page. Scoped to the Supreme Court the same phrase returns 12, with
 * Jacobson among them.
 *
 * That is not a quirk of one query. A citizen asking "can the government make
 * you get a vaccine" is asking what the law IS, and what the law is comes from
 * the court that settles it. So the Supreme Court is asked first and the other
 * federal courts after — both, merged, nothing removed. Rank order, not scope.
 *
 * A named case is a stronger lead still, and is searched across every court,
 * because the case a reader names may well be a lower one. It remains a lead:
 * the name came from a model, so it is asked of CourtListener rather than
 * shown, and a case that does not come back does not exist here.
 */
export function buildLadder(intent: SearchIntent): Rung[] {
  const rungs: Rung[] = [];

  if (intent.caseNames.length > 0) {
    const names = intent.caseNames.map((n) => `"${n}"`).join(" OR ");
    rungs.push({ q: `caseName:(${names})`, label: `case name ${names}`, weight: 150 });
  }

  if (intent.phrases.length > 0) {
    const phrases = intent.phrases.map((p) => `"${p}"`).join(" OR ");
    rungs.push({
      q: phrases,
      label: `phrase ${phrases} (Supreme Court)`,
      weight: 120,
      court: "scotus",
    });
    rungs.push({ q: phrases, label: `phrase ${phrases} (all courts)`, weight: 100 });
  }

  if (intent.topic) {
    rungs.push({
      q: intent.topic,
      label: `topic "${intent.topic}" (Supreme Court)`,
      weight: 60,
      court: "scotus",
    });
    rungs.push({ q: intent.topic, label: `topic "${intent.topic}" (all courts)`, weight: 50 });
  }

  if (rungs.length === 0) {
    rungs.push({ q: intent.raw, label: "the query as typed", weight: 50 });
  }

  return rungs.slice(0, MAX_QUERIES);
}

function urlFor(intent: SearchIntent, rung: Rung, perPage: number): string {
  const url = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  url.searchParams.set("q", rung.q);
  url.searchParams.set("type", "o");
  url.searchParams.set("page_size", String(perPage));
  // Scope belongs to the rung, not to the search. Every federal court is still
  // reachable — the Supreme Court is simply asked first.
  if (rung.court) url.searchParams.set("court", rung.court);
  if (intent.from) url.searchParams.set("filed_after", intent.from);
  if (intent.to) url.searchParams.set("filed_before", intent.to);
  return url.toString();
}

function normalize(cluster: RawCluster, matchedVia: string[]): JudicialResult {
  return {
    id: cluster.opinions?.find((o) => typeof o.id === "number")?.id ?? cluster.cluster_id ?? 0,
    case_name: cluster.caseName ?? "",
    court: cluster.court ?? "",
    date_filed: cluster.dateFiled ?? "",
    docket_number: cluster.docketNumber ?? "",
    absolute_url: cluster.absolute_url ?? "",
    matchedVia,
  };
}

/**
 * Order the merged results.
 *
 * RELEVANCE is earned from the query — which rung found it and how highly
 * CourtListener's own relevance ranked it there, plus the words appearing in
 * the case name or the matched snippet. PROMINENCE is the case mattering:
 * how often it has been cited, and whether it is a Supreme Court ruling. A
 * landmark stays a landmark, but being one is never why it appears in a list.
 *
 * Citation count and not recency, deliberately. A 1905 opinion can be the
 * controlling law on a question asked today, and ranking courts by freshness
 * would bury exactly the cases a citizen is looking for.
 */
function score(
  cluster: RawCluster,
  result: JudicialResult,
  intent: SearchIntent,
  best: { weight: number; rank: number },
): number {
  let relevance = best.weight + Math.max(0, 20 - best.rank * 2);

  const haystack = `${result.case_name} ${(cluster.opinions ?? []).map((o) => o.snippet ?? "").join(" ")}`
    .toLowerCase();
  for (const phrase of intent.phrases) {
    if (haystack.includes(phrase.toLowerCase())) relevance += 40;
  }
  for (const term of intent.terms) {
    if (haystack.includes(term.toLowerCase())) relevance += 5;
  }

  const cites = cluster.citeCount ?? 0;
  const prominence =
    (cluster.court_id === "scotus" ? 30 : 0) + Math.min(40, Math.round(Math.log10(cites + 1) * 20));

  return relevance + prominence;
}

export async function searchJudicialOpinions(
  query: string,
  limit: number,
): Promise<JudicialSearchOutput> {
  const intent = await interpretSearch(query, "judicial");
  const ladder = buildLadder(intent);
  const deadlineAt = Date.now() + DEADLINE_MS;
  const apiKey = process.env.COURTLISTENER_API_KEY;

  const found = new Map<
    string,
    { raw: RawCluster; result: JudicialResult; weight: number; rank: number }
  >();
  const attempted: string[] = [];
  let count = 0;
  let next: string | undefined;

  for (const rung of ladder) {
    const page = await fetchCourtListener<{
      results?: RawCluster[];
      count?: number;
      next?: string | null;
    }>(urlFor(intent, rung, Math.max(limit, 20)), {
      deadlineAt,
      apiKey,
      label: rung.label,
    });

    attempted.push(`${rung.label} -> ${page ? `${page.results?.length ?? 0} hit(s)` : "failed"}`);
    if (!page) continue;

    count = Math.max(count, page.count ?? 0);
    next ??= page.next ?? undefined;

    (page.results ?? []).forEach((raw, rank) => {
      const key = String(raw.cluster_id ?? raw.absolute_url ?? raw.caseName ?? "");
      if (!key) return;
      const existing = found.get(key);
      if (existing) {
        existing.result.matchedVia.push(rung.label);
        if (rung.weight > existing.weight) {
          existing.weight = rung.weight;
          existing.rank = rank;
        }
        return;
      }
      found.set(key, { raw, result: normalize(raw, [rung.label]), weight: rung.weight, rank });
    });

    // A named case that came back is as good as this gets, and every further
    // request is a fifth of a minute's budget spent to dilute it.
    if (found.size >= limit && rung.weight >= 120) break;
  }

  const results = [...found.values()]
    .map((entry) => ({
      result: entry.result,
      total: score(entry.raw, entry.result, intent, entry),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((entry) => entry.result);

  return { results, count: Math.max(count, results.length), next, intent, attempted };
}
