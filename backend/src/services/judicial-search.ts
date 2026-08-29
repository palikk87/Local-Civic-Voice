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
import { env } from "../env";

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

/**
 * One decision, one result — however many clusters CourtListener holds for it.
 *
 * Observed in live output: a search for phone privacy returned Riley v.
 * California TWICE, as clusters 8385044 and 8391734. CourtListener stores the
 * same case more than once — a slip opinion and the bound volume, a corrected
 * reissue, a second reporter's copy — and deduping by cluster id treats those
 * as different cases. To a reader it is the same ruling listed twice, pushing
 * a different case off the page.
 *
 * The docket number is the court's own identifier for a case, so it is the key
 * where there is one. Normalised because the same docket appears as
 * "No. 13–132." and "13-132": the reporter's prefix, an en dash rather than a
 * hyphen, a trailing period.
 */
function caseKey(cluster: RawCluster): string {
  const docket = (cluster.docketNumber ?? "")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/^no\.?\s*/, "")
    .replace(/[^a-z0-9-]/g, "")
    .trim();
  if (docket) return `docket:${docket}`;

  // No docket published — fall back to the case name, which is still a better
  // identity than the cluster id for this purpose.
  const name = (cluster.caseName ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name) return `name:${name}`;

  return String(cluster.cluster_id ?? cluster.absolute_url ?? "");
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

  // PROMINENCE = long-run weight + being current, and it needs both.
  //
  // Citations alone was the first version of this, defended on the grounds
  // that a 1905 opinion can be today's controlling law. True — and it buries
  // every ruling handed down this term, because a case has no citations for
  // the same reason it is news: nobody has had time to cite it yet.
  //
  // Measured on the query that exposed it. "cell phone privacy":
  //   Riley v. California      2014, 1,311 citations
  //   Carpenter v. US          2018, 1,222 citations
  //   Chatrie v. US            2026,     0 citations
  //
  // Chatrie is the case a person asking that question today most wants, and on
  // citations it finished behind Birchfield v. North Dakota — a drunk-driving
  // blood-test case that matched "search incident to arrest" and has had ten
  // years to be cited.
  //
  // So a recent decision earns credit for being recent, decaying over three
  // years: long enough to carry a ruling until it starts accumulating
  // citations of its own. The ceiling is set slightly ABOVE the citation
  // ceiling on purpose. When a court has just decided the exact question
  // somebody is asking, that ruling IS the answer and a heavily cited
  // predecessor is context — which is the order a plain web search puts them
  // in, and the order a citizen expects.
  //
  // It can only ever reorder. Currency is prominence: a case still has to have
  // matched the query to be in the list at all.
  const cites = cluster.citeCount ?? 0;
  const standing = Math.min(40, Math.round(Math.log10(cites + 1) * 20));

  // CURRENCY HOLDS, THEN FADES. It used to decay from the day of the ruling, so
  // a decision handed down THIS TERM began losing its edge within weeks: two
  // months after Chatrie was decided it had already shed enough to fall behind
  // a 2014 landmark, and the guard that pins this behaviour started failing on
  // nothing but the passage of time.
  //
  // That was the wrong shape. "Decided this term" is not a quantity that
  // shrinks a little each morning — it is true for a year and then it is not.
  // So a ruling keeps full credit for its first year, then decays over the two
  // after that, and is worth nothing extra at three. The ceiling still sits
  // just above the citation ceiling on purpose: when a court has decided the
  // exact question somebody is asking, that ruling IS the answer and a heavily
  // cited predecessor is context.
  const filed = Date.parse(result.date_filed || "");
  const ageYears = Number.isFinite(filed) ? (Date.now() - filed) / (365.25 * 86_400_000) : 99;
  const currency =
    ageYears <= 1
      ? 45
      : ageYears <= 3
        ? Math.round(45 * (1 - (ageYears - 1) / 2))
        : 0;

  const prominence = (cluster.court_id === "scotus" ? 30 : 0) + standing + currency;

  return relevance + prominence;
}

export async function searchJudicialOpinions(
  query: string,
  limit: number,
): Promise<JudicialSearchOutput> {
  const intent = await interpretSearch(query, "judicial");
  const ladder = buildLadder(intent);
  const deadlineAt = Date.now() + DEADLINE_MS;
  const apiKey = env.COURTLISTENER_API_KEY;

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
      const key = caseKey(raw);
      if (!key) return;
      const existing = found.get(key);
      if (existing) {
        existing.result.matchedVia.push(rung.label);
        if (rung.weight > existing.weight) {
          existing.weight = rung.weight;
          existing.rank = rank;
        }
        // Two copies of one decision: keep the better-attested one. The bound
        // volume carries the citations and the slip opinion carries none, and
        // which of them CourtListener happens to return first is not a fact
        // about the case.
        if ((raw.citeCount ?? 0) > (existing.raw.citeCount ?? 0)) {
          existing.raw = raw;
          existing.result = normalize(raw, existing.result.matchedVia);
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
