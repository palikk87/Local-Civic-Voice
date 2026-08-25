/**
 * Lightweight web-search grounding for the legislative search pipeline.
 *
 * Why this exists: gpt-4o-mini interprets a user's search query (see
 * services/congress-search.ts → interpretQuery) using only its training
 * knowledge, so a bill that became news AFTER the cutoff is invisible to it.
 * A user typing a trending headline phrase gets nothing back.
 *
 * This module fetches a handful of current web snippets first, which are then
 * handed to the model as context so it can resolve fresh headlines to real
 * bill numbers and the correct congress.
 *
 * FAIL OPEN, ALWAYS. Search is an interactive, latency-sensitive path. Every
 * failure mode — missing key, timeout, non-200, malformed body — returns [] so
 * the caller silently falls back to unaided interpretation. A slow or dead
 * search provider must never stall or break the search box.
 */
import { env } from "../env";

export interface WebSnippet {
  title: string;
  url: string;
  /** Provider-extracted page text, already trimmed to a usable length. */
  content: string;
}

/**
 * Hard ceiling on the grounding step. This sits on the critical path *before*
 * the LLM call (which itself precedes the dependent GovInfo lookups), so it is
 * tighter than the 6-8s timeouts used elsewhere in search — but it must still
 * be long enough for Tavily's basic tier to actually answer. Measured against
 * the live API: a cold query costs ~3s, a repeat of a recent one ~0.2s (Tavily
 * caches). The original 800ms ceiling aborted every cold call, which silently
 * disabled grounding even with a valid key — precisely the queries that need
 * grounding most (novel phrasings) are the ones that are never cached.
 */
const TIMEOUT_MS = 5000;

/** Snippets sent to the model. Enough signal without bloating the prompt. */
const MAX_SNIPPETS = 5;

/** Per-snippet character cap — keeps the whole context block ~2k chars. */
const MAX_SNIPPET_CHARS = 400;

/**
 * Steer a colloquial query toward legislative coverage rather than general
 * news. "merging israeli military" alone returns defense reporting; with this
 * suffix it returns the articles that actually name the bill.
 */
function legislativeQuery(query: string): string {
  return `${query} congress bill legislation`;
}

let missingKeyWarned = false;

/** Log the "grounding is off" state a single time per process. */
function warnMissingKeyOnce(): void {
  if (missingKeyWarned) return;
  missingKeyWarned = true;
  console.warn(
    "[web-search] TAVILY_API_KEY is not set — search grounding is DISABLED. " +
      "Queries are interpreted from model training data only, so bills that became " +
      "news after the cutoff will not resolve. Add TAVILY_API_KEY to enable.",
  );
}

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string }>;
  answer?: string;
}

/**
 * Fetch current web snippets for a query. Returns [] on ANY problem.
 *
 * @param query The user's raw search query.
 */
export async function searchWebForContext(query: string): Promise<WebSnippet[]> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) {
    // Grounding is optional — not configured is not an error, but it IS the
    // difference between resolving a slang query to a real bill and guessing
    // from stale training data. Warn once so it is visible in the logs rather
    // than looking like the resolver "just isn't very good".
    warnMissingKeyOnce();
    return [];
  }

  const trimmed = query.trim();
  if (trimmed.length < 3) return []; // Too short to ground meaningfully.

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: legislativeQuery(trimmed),
        // "basic" is the fast tier — "advanced" routinely exceeds our budget.
        search_depth: "basic",
        topic: "news",
        max_results: MAX_SNIPPETS,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[web-search] tavily -> ${response.status}`);
      return [];
    }

    const data = (await response.json()) as TavilyResponse;
    const snippets: WebSnippet[] = [];
    for (const r of data?.results ?? []) {
      const content = typeof r.content === "string" ? r.content.trim() : "";
      if (!content) continue;
      snippets.push({
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.url === "string" ? r.url : "",
        content: content.slice(0, MAX_SNIPPET_CHARS),
      });
      if (snippets.length >= MAX_SNIPPETS) break;
    }
    return snippets;
  } catch (e) {
    // Timeout (AbortError), DNS, TLS, malformed JSON — all non-fatal.
    console.error("[web-search] tavily failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** True when grounding is configured. Used only for logging/diagnostics. */
export function webSearchAvailable(): boolean {
  return !!env.TAVILY_API_KEY;
}

/** Render snippets as the prompt block the interpreter model consumes. */
export function formatSnippetsForPrompt(snippets: WebSnippet[]): string {
  return snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`)
    .join("\n\n");
}
