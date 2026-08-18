/**
 * One understanding layer, three vocabularies.
 *
 * WHY THIS EXISTS. Ask Gemini about a law in plain English and it finds the
 * thing you meant. Ask this platform the same question and — for two of the
 * three branches — the words went straight into a government API's keyword
 * field, untouched. That is not a search, it is a substring match against
 * prose written by lawyers.
 *
 * Measured against the live APIs before a line of this was written:
 *
 *   "laws about protecting kids from vaccines"
 *     Federal Register, raw       → 30 hits, top one "National Child's Day, 2023"
 *     interpreted to "childhood vaccine" + presidential documents
 *                                 → 2 hits, both the actual executive order
 *
 *   "can the government make you get a vaccine"
 *     CourtListener, raw          → "Department of Education v. California"
 *     interpreted to "compulsory vaccination"
 *                                 → Jacobson v. Massachusetts (1905), the case
 *                                   that actually decides the question
 *
 * The difference is not a better model. It is asking each source a question in
 * the language that source speaks — and the three languages have nothing in
 * common, which is why one shared search behaved badly everywhere.
 *
 * THE LINE THIS MODULE DOES NOT CROSS. It never produces results. A model
 * asked for "the top 10 laws about X" will happily write ten bill numbers, and
 * some of them will not exist — the titles are plausible, the numbers are
 * wrong, and on a civics platform a confidently invented law is worse than an
 * empty page. So the model decides WHAT TO ASK and, later, how to rank what
 * came back. Every document a reader sees was returned by a government API.
 *
 * Anything the model names here — a bill number, a case name — is a lead to be
 * looked up, never an answer to be shown. The branch translators enforce that:
 * a lead that no source confirms is dropped silently.
 */

import { generateAI, parseJsonObject } from "./ai-generate";
import { formatSnippetsForPrompt, searchWebForContext, type WebSnippet } from "./web-search";

export type SearchBranch = "legislative" | "executive" | "judicial";

export interface BillLead {
  congress: number;
  type: string;
  number: string;
}

export interface SearchIntent {
  branch: SearchBranch;
  /** The user's own words, kept verbatim. Every ranker still scores against these. */
  raw: string;
  /** 2–6 lowercase keywords naming the policy topic, spelling fixed, filler gone. */
  topic: string;
  /**
   * Phrases likely to appear VERBATIM in the official document. These get
   * quoted into the source query, which is what turns a scatter of common
   * words into a precise hit.
   */
  phrases: string[];
  /** Broader keywords. Used for ranking what came back, not for filtering it out. */
  terms: string[];
  /** Legislative leads: bills the query plausibly names. Confirmed before use. */
  bills: BillLead[];
  /** Judicial leads: case names the query plausibly names. Confirmed before use. */
  caseNames: string[];
  /** Executive: agencies named or implied. */
  agencies: string[];
  /** Executive: the user means presidential documents specifically. */
  presidentialOnly: boolean;
  /** A date window the user asked for, ISO yyyy-mm-dd. */
  from: string | null;
  to: string | null;
  /**
   * Legislative only, and ONLY when the user said so themselves.
   *
   * A Congress the reader did not name is not a constraint to be inferred — a
   * wrong one makes every real bill unfindable, which is a worse answer than
   * searching them all.
   */
  congress: number | null;
  billType: string | null;
  /**
   * Did the model actually answer?
   *
   * false means every field below is the plain fallback built from the user's
   * own words. Search still works — worse, but honestly — and the caller can
   * say so rather than pretending an interpretation happened.
   */
  interpreted: boolean;
}

/** Sent to the model; also the shape parsed back out of it. */
interface ModelIntent {
  topic?: string;
  phrases?: string[];
  terms?: string[];
  bills?: Array<{ congress?: number; type?: string; number?: string | number }>;
  caseNames?: string[];
  agencies?: string[];
  presidentialOnly?: boolean;
  from?: string | null;
  to?: string | null;
  congress?: number | null;
  billType?: string | null;
}

const CURRENT_CONGRESS = 119;
const BILL_TYPES = new Set(["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"]);

/** Words that carry no topic. Stripping them is most of what "topic" means. */
const FILLER = new Set([
  "a", "about", "act", "all", "an", "and", "any", "are", "bill", "can", "did", "do", "does",
  "for", "from", "get", "government", "has", "have", "how", "in", "is", "it", "law", "laws",
  "legislation", "make", "me", "my", "of", "on", "or", "our", "protect", "protecting", "that",
  "the", "there", "they", "thing", "things", "to", "us", "was", "what", "when", "where",
  "which", "who", "why", "will", "with", "you", "your",
]);

/**
 * What search looks like with no model available.
 *
 * Not a degraded copy of the real thing pretending to be it: the user's words,
 * cleaned of filler, and nothing invented on top. `interpreted: false` says so
 * out loud so a caller never reports an interpretation that did not happen.
 */
export function plainIntent(query: string, branch: SearchBranch): SearchIntent {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 1 && !FILLER.has(w));

  return {
    branch,
    raw: query,
    topic: words.join(" ") || query.trim().toLowerCase(),
    // No invented phrase. The only phrase we know is real is the one typed.
    phrases: [],
    terms: words,
    bills: [],
    caseNames: [],
    agencies: [],
    presidentialOnly: branch === "executive",
    from: null,
    to: null,
    congress: null,
    billType: null,
    interpreted: false,
  };
}

/** Steer the grounding search at the branch the reader is actually looking in. */
function groundingQuery(query: string, branch: SearchBranch): string {
  switch (branch) {
    case "legislative":
      return `${query} congress bill legislation`;
    case "executive":
      return `${query} executive order presidential`;
    case "judicial":
      return `${query} supreme court ruling opinion`;
  }
}

/** What each branch needs the model to produce, and nothing it does not. */
function branchInstructions(branch: SearchBranch): string {
  switch (branch) {
    case "legislative":
      return `This search is for BILLS AND RESOLUTIONS in Congress. The current Congress is ${CURRENT_CONGRESS} (2025-2026); 118 was 2023-2024.

- "bills": up to 5 specific bills the query plausibly refers to, ONLY ones you are confident exist. "type" is one of hr, s, hjres, sjres, hconres, sconres, hres, sres. Each is checked against congress.gov and dropped if it is not real, so a wrong guess costs nothing — but do not pad the list.
- "phrases": wording that would appear in a bill's official title or summary — acronym expansions ("safeguard american voter eligibility"), formal programme names, statutory terms.
- Leave "agencies", "caseNames" and "presidentialOnly" empty.`;
    case "executive":
      return `This search is for EXECUTIVE ORDERS and other presidential documents in the Federal Register.

- "phrases": the words the order itself would use. Executive orders are written in formal policy language, so the reader's plain phrasing rarely appears verbatim ("kids and vaccines" -> "childhood vaccine", "childhood immunization").
- "agencies": federal agencies named or clearly implied, in their full official form ("Department of Health and Human Services"), [] if none.
- "presidentialOnly": true unless the user is plainly asking about ordinary agency rulemaking rather than presidential action.
- Leave "bills" and "caseNames" empty.`;
    case "judicial":
      return `This search is for SUPREME COURT OPINIONS.

- "phrases": the legal terms of art an opinion would actually contain. This matters more here than anywhere else: a reader asks "can the government make you get a vaccine" and the opinion says "compulsory vaccination". Translate the question into the language of the ruling.
- "caseNames": up to 5 case names the query plausibly refers to, ONLY ones you are confident exist ("Jacobson v. Massachusetts"). Each is checked against CourtListener and dropped if it is not found.
- Leave "bills", "agencies" and "presidentialOnly" empty.`;
  }
}

const SYSTEM = `You turn a person's plain-English question about US government into a precise query for an official government database.

You are NOT answering the question and NOT listing documents. You produce search terms. Something else does the searching, against real government APIs, and only what those APIs return is ever shown to anyone.

Return JSON only:
{
  "topic": "childhood vaccine policy",
  "phrases": ["childhood vaccine", "immunization schedule"],
  "terms": ["vaccine", "children", "immunization", "schedule"],
  "bills": [{"congress": 119, "type": "hr", "number": "22"}],
  "caseNames": ["Jacobson v. Massachusetts"],
  "agencies": ["Department of Health and Human Services"],
  "presidentialOnly": true,
  "from": null,
  "to": null
}

- topic: 2-6 lowercase keywords naming the actual policy subject. Fix spelling ("isreal" -> "israel"). Drop filler and question words. Restate slang or news phrasing in the words an official document would use.
- phrases: 1-4 SHORT phrases (2-4 words) likely to appear VERBATIM in the official text. These are quoted into the search, so a phrase that never occurs returns nothing — prefer the plain formal term over an elaborate one. [] if you cannot think of a real one.
- terms: 3-8 single keywords for ranking. Include the obvious ones.
- from / to: "yyyy-mm-dd" ONLY if the user named a time period, else null.

Never invent an identifier to look impressive. An empty list is a fine answer; a wrong bill number or a case that does not exist is not.`;

/**
 * Understand the query, in the terms of the branch being searched.
 *
 * FAILS OPEN, ALWAYS. Search is interactive. Every failure — no key, timeout,
 * bad JSON, model outage — falls back to the user's own words rather than
 * breaking the search box. The fallback is marked, not disguised.
 */
export async function interpretSearch(
  query: string,
  branch: SearchBranch,
): Promise<SearchIntent> {
  const fallback = plainIntent(query, branch);
  if (!query.trim()) return fallback;

  // Grounding first: a bill or ruling that became news after the model's
  // training cutoff is invisible to it otherwise. Best-effort — this returns []
  // rather than failing when no provider is configured.
  let snippets: WebSnippet[] = [];
  try {
    snippets = await searchWebForContext(groundingQuery(query, branch));
  } catch {
    snippets = [];
  }

  const grounded = snippets.length > 0;
  const result = await generateAI({
    system: SYSTEM,
    // Gemini Flash: fast enough to sit in front of an interactive search, and
    // generateAI falls over to the other provider if it is down. The interpret
    // step used to call one hardcoded OpenAI model directly, so an outage there
    // silently turned interpretation off for everyone.
    model: "gemini-3.6-flash",
    prompt:
      `${branchInstructions(branch)}\n\n` +
      `User's search: "${query}"\n` +
      (grounded
        ? `\nWeb results retrieved just now. These are more current than your training data — trust them over your own memory for anything time-sensitive, and mine them for formal names, acronym expansions and identifiers:\n${formatSnippetsForPrompt(snippets)}\n`
        : "") +
      `\nReturn the JSON.`,
    jsonMode: true,
    temperature: 0.1,
    maxCompletionTokens: 500,
  });

  if (!result.ok) {
    console.warn(`[search-intent] interpretation unavailable (${result.error.slice(0, 120)})`);
    return fallback;
  }

  const parsed = parseJsonObject<ModelIntent>(result.content);
  if (!parsed) return fallback;

  return {
    branch,
    raw: query,
    topic: clean(parsed.topic) || fallback.topic,
    phrases: strings(parsed.phrases, 4),
    // The user's own words are always in the ranking terms. A model that
    // rewrites the topic beyond recognition must not be able to make the thing
    // somebody actually typed count for nothing.
    terms: unique([...strings(parsed.terms, 8), ...fallback.terms]),
    bills: branch === "legislative" ? billLeads(parsed.bills) : [],
    caseNames: branch === "judicial" ? strings(parsed.caseNames, 5) : [],
    agencies: branch === "executive" ? strings(parsed.agencies, 4) : [],
    presidentialOnly: branch === "executive" ? parsed.presidentialOnly !== false : false,
    from: isoDate(parsed.from),
    to: isoDate(parsed.to),
    congress:
      branch === "legislative" && Number.isInteger(Number(parsed.congress))
        ? Number(parsed.congress)
        : null,
    billType:
      branch === "legislative" && typeof parsed.billType === "string" &&
      BILL_TYPES.has(parsed.billType.toLowerCase())
        ? parsed.billType.toLowerCase()
        : null,
    interpreted: true,
  };
}

// ---------------------------------------------------------------------------
// Reading the model's answer without trusting its shape
// ---------------------------------------------------------------------------

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 1 && v.length < 120),
  ).slice(0, max);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A bill lead is only worth carrying if it could name a real bill: a published
 * measure type, a numeric number, a plausible Congress. Everything surviving
 * this is still looked up before anyone sees it.
 */
function billLeads(value: unknown): BillLead[] {
  if (!Array.isArray(value)) return [];
  const leads: BillLead[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as { congress?: unknown; type?: unknown; number?: unknown };
    const type = typeof raw.type === "string" ? raw.type.toLowerCase().replace(/[^a-z]/g, "") : "";
    const number = String(raw.number ?? "").replace(/\D/g, "");
    const congress = Number(raw.congress);
    if (!BILL_TYPES.has(type) || !number) continue;
    leads.push({
      type,
      number,
      congress: Number.isInteger(congress) && congress >= 93 && congress <= CURRENT_CONGRESS
        ? congress
        : CURRENT_CONGRESS,
    });
    if (leads.length === 5) break;
  }
  return leads;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
