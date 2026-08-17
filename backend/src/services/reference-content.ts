/**
 * Master reference content pipeline.
 *
 * THE RULE: the master reference row IS the cache, and it is the first place we look.
 *
 *   1. A user opens or shares a law → we look in the master reference (by masterReferenceId).
 *   2. Official text there? Serve it. Nothing there? Pull it from the official API —
 *      walking a fallback chain of sources so one dead endpoint doesn't mean "no text" —
 *      then SAVE it into the master reference so the next user reads it for free.
 *   3. Citizen brief there? Serve it. Missing? Generate it once and save it into the
 *      master reference. Every later reader gets that same stored brief.
 *   4. What's stored is compared against the live source once a day. If the source has
 *      newer text, the master reference is updated with the new text AND a freshly
 *      generated brief — same row, same masterReferenceId.
 *
 * Both faucets (mobile + web) get this by reading GET /api/government-references/:id.
 * Nothing here is client-specific.
 */

import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { type BriefJobPlan, classifyBriefJob, generateAI, parseJsonObject } from "./ai-generate";
import { JobPriority, JobType, jobQueue } from "./job-queue";
import { notifyLawUpdate } from "./notification-service";
import { ReferenceKind, parseReferenceId } from "./master-reference-id";
import { markSettled, markWorking } from "./brief-state";

const FETCH_TIMEOUT_MS = 15_000;
/** How long stored text is trusted before we re-compare it against the official source. */
const SOURCE_RECHECK_MS = 24 * 60 * 60 * 1000;

export interface CitizenBriefSections {
  theGoal: string;
  theWallet: string;
  theDebate: string;
}

export interface EnsureContentOptions {
  /** Ignore the cache: re-pull text and regenerate the brief. */
  force?: boolean;
  /** Stop fetching sources once this much time has passed, leaving the rest to the job queue. */
  deadlineMs?: number;
  /**
   * true  → generate the brief inline (background job).
   * false → hand the brief to the job queue so the reader isn't kept waiting.
   */
  generateBriefInline?: boolean;
}

export type ContentStatus = "ready" | "brief_pending" | "fetching" | "unavailable";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function withDeadline(deadlineAt: number): number {
  return Math.max(0, Math.min(FETCH_TIMEOUT_MS, deadlineAt - Date.now()));
}

async function fetchJson<T>(
  url: string,
  deadlineAt: number,
  headers: Record<string, string> = {}
): Promise<T | null> {
  const timeout = withDeadline(deadlineAt);
  if (timeout <= 0) return null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      console.warn(`[RefContent] ${response.status} from ${url.split("?")[0]}`);
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Strip markup so stored "full text" is readable plain text regardless of source format. */
function htmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Official sources (GPO/Federal Register raw text especially) embed stray NUL
 * and other control bytes. SQLite treats NUL as a string terminator, silently
 * cutting the stored text off at the first one — strip everything but \n and \t.
 */
function sanitizeOfficialText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
}

async function fetchDocumentText(url: string, deadlineAt: number): Promise<string | null> {
  const timeout = withDeadline(deadlineAt);
  if (timeout <= 0) return null;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain, text/html, */*" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) return null;
    const raw = await response.text();
    const looksLikeHtml = /<\/?(html|body|div|p|pre)\b/i.test(raw.slice(0, 2_000));
    const text = sanitizeOfficialText(looksLikeHtml ? htmlToText(raw) : raw);
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

/**
 * The fingerprint of a piece of official text.
 *
 * Exported because the daily sync needs the SAME answer. Two hash functions
 * over one column is not a style problem: each writer would see the other's
 * value as different, report the law as changed every night, and pay to rewrite
 * every brief on the platform.
 *
 * Known limitation, left alone deliberately: this hashes raw bytes, so a source
 * that re-wraps or re-indents identical text reads as a new version. Making it
 * whitespace-insensitive would be better, but it would also invalidate every
 * hash already stored and regenerate every brief once — a real cost to pay on a
 * guess about behaviour nobody has measured here.
 */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Source chains — one per reference type, tried in order until one yields text
// ---------------------------------------------------------------------------

interface TextResult {
  text: string;
  source: string;
  url: string | null;
}

interface ReferenceRow {
  id: string;
  masterReferenceId: string;
  referenceType: string;
  title: string;
  shortTitle: string | null;
  status: string;
  category: string | null;
  description: string | null;
  sourceUrl: string | null;
  chamber: string | null;
  congress: number | null;
  signedDate: Date | null;
  decidedDate: Date | null;
  fullText: string | null;
  fullTextHash: string | null;
  fullTextUrl: string | null;
  citizenBriefJson: string | null;
  sourceCheckedAt: Date | null;
  lawVersion: number;
  citizenBriefVersion: number | null;
}

/**
 * "hr-82-119" → { type: "hr", number: "82", congress: 119 }
 *
 * `fallbackCongress` is the row's own `congress` column, used when the id
 * carries no Congress of its own. Ids written before the naming rules were
 * consolidated split the type across segments — "hres-1443-119" was stored as
 * "hr-es-1443-119" — and the shared parser rejoins them, so a record still
 * reaches congress.gov under the name it was filed with.
 */
function parseBillId(masterReferenceId: string, fallbackCongress: number | null) {
  const key = parseReferenceId(ReferenceKind.BILL, masterReferenceId);
  if (key?.kind !== "bill") return null;

  const congress = key.congress ?? fallbackCongress;
  if (!congress) return null;

  return { type: key.billType as string, number: key.number, congress };
}

async function fetchBillText(ref: ReferenceRow, deadlineAt: number): Promise<TextResult | null> {
  const apiKey = process.env.CONGRESS_API_KEY;
  const parsed = parseBillId(ref.masterReferenceId, ref.congress);

  // Source 1: congress.gov text versions — the actual legislative text.
  if (apiKey && parsed) {
    const base = `https://api.congress.gov/v3/bill/${parsed.congress}/${parsed.type}/${parsed.number}`;
    const data = await fetchJson<{
      textVersions?: Array<{ formats?: Array<{ type?: string; url?: string }> }>;
    }>(`${base}/text?format=json&api_key=${apiKey}`, deadlineAt);

    const versions = data?.textVersions ?? [];
    // Newest version last in the API response; walk backwards for the freshest text.
    for (const version of [...versions].reverse()) {
      const formats = version.formats ?? [];
      const preferred =
        formats.find((f) => (f.type ?? "").toLowerCase().includes("formatted text")) ??
        formats.find((f) => (f.type ?? "").toLowerCase().includes("text")) ??
        formats[0];
      if (!preferred?.url) continue;
      const text = await fetchDocumentText(preferred.url, deadlineAt);
      if (text) return { text, source: "congress.gov/text", url: preferred.url };
    }

    // Source 2: congress.gov official summaries — CRS plain-English summary of the bill.
    const summaries = await fetchJson<{
      summaries?: Array<{ text?: string; updateDate?: string; actionDate?: string }>;
    }>(`${base}/summaries?format=json&api_key=${apiKey}`, deadlineAt);

    const latestSummary = summaries?.summaries?.[summaries.summaries.length - 1]?.text;
    if (latestSummary) {
      const text = sanitizeOfficialText(htmlToText(latestSummary));
      if (text.length > 200) {
        return {
          text,
          source: "congress.gov/summaries",
          url: `${base}/summaries`,
        };
      }
    }
  }

  // Source 3: the official congress.gov page for this bill.
  if (ref.sourceUrl) {
    const text = await fetchDocumentText(`${ref.sourceUrl}/text`, deadlineAt);
    if (text) return { text, source: "congress.gov/page", url: `${ref.sourceUrl}/text` };
  }

  return null;
}

async function fetchExecutiveOrderText(
  ref: ReferenceRow,
  deadlineAt: number
): Promise<TextResult | null> {
  // Source 1: Federal Register document record → raw text file.
  // The document number is embedded in the html_url we stored at sync time.
  const docNumber = ref.sourceUrl?.match(/federalregister\.gov\/documents\/[\d/]+\/([\w-]+)/)?.[1];
  if (docNumber) {
    const doc = await fetchJson<{ raw_text_url?: string | null; body_html_url?: string | null }>(
      `https://www.federalregister.gov/api/v1/documents/${docNumber}.json?fields[]=raw_text_url&fields[]=body_html_url`,
      deadlineAt
    );
    for (const url of [doc?.raw_text_url, doc?.body_html_url]) {
      if (!url) continue;
      const text = await fetchDocumentText(url, deadlineAt);
      if (text) return { text, source: "federalregister", url };
    }
  }

  // Source 2: search the Federal Register by executive order number.
  const eoNumber = ref.masterReferenceId.replace(/^eo-/i, "").replace(/\D/g, "");
  if (eoNumber) {
    const search = await fetchJson<{
      results?: Array<{ executive_order_number?: string | number | null; raw_text_url?: string | null }>;
    }>(
      `https://www.federalregister.gov/api/v1/documents.json?conditions[presidential_document_type]=executive_order&conditions[term]=${eoNumber}&per_page=5&fields[]=executive_order_number&fields[]=raw_text_url`,
      deadlineAt
    );
    const match = search?.results?.find(
      (r) => String(r.executive_order_number ?? "").replace(/\D/g, "") === eoNumber
    );
    if (match?.raw_text_url) {
      const text = await fetchDocumentText(match.raw_text_url, deadlineAt);
      if (text) return { text, source: "federalregister/search", url: match.raw_text_url };
    }
  }

  // Source 3: whatever official page we have on file.
  if (ref.sourceUrl) {
    const text = await fetchDocumentText(ref.sourceUrl, deadlineAt);
    if (text) return { text, source: "source-page", url: ref.sourceUrl };
  }

  return null;
}

async function fetchScotusText(ref: ReferenceRow, deadlineAt: number): Promise<TextResult | null> {
  const apiKey = process.env.COURTLISTENER_API_KEY;
  const docket = ref.masterReferenceId.replace(/^scotus-/i, "");
  const authHeaders: Record<string, string> = apiKey ? { Authorization: `Token ${apiKey}` } : {};

  // Source 1: CourtListener v4 — find the opinion cluster for this docket, then its text.
  if (apiKey) {
    const search = await fetchJson<{
      results?: Array<{ opinions?: Array<{ id?: number }>; id?: number }>;
    }>(
      `https://www.courtlistener.com/api/rest/v4/search/?type=o&court=scotus&docket_number=${encodeURIComponent(docket)}`,
      deadlineAt,
      authHeaders
    );

    const opinionIds = (search?.results ?? [])
      .flatMap((result) => result.opinions?.map((o) => o.id) ?? [])
      .filter((id): id is number => typeof id === "number");

    for (const opinionId of opinionIds.slice(0, 3)) {
      const opinion = await fetchJson<{
        plain_text?: string | null;
        html_with_citations?: string | null;
      }>(`https://www.courtlistener.com/api/rest/v4/opinions/${opinionId}/`, deadlineAt, authHeaders);
      const raw = opinion?.plain_text || opinion?.html_with_citations;
      if (raw) {
        const text = sanitizeOfficialText(htmlToText(raw));
        if (text.length > 200) {
          return {
            text,
            source: "courtlistener/v4",
            url: `https://www.courtlistener.com/api/rest/v4/opinions/${opinionId}/`,
          };
        }
      }
    }
  }

  // Source 2: the public CourtListener page for the case.
  if (ref.sourceUrl) {
    const text = await fetchDocumentText(ref.sourceUrl, deadlineAt);
    if (text) return { text, source: "courtlistener/page", url: ref.sourceUrl };
  }

  return null;
}

async function fetchOfficialText(ref: ReferenceRow, deadlineAt: number): Promise<TextResult | null> {
  switch (ref.referenceType) {
    case "bill":
      return fetchBillText(ref, deadlineAt);
    case "executive_order":
      return fetchExecutiveOrderText(ref, deadlineAt);
    case "scotus_case":
      return fetchScotusText(ref, deadlineAt);
    default:
      return ref.sourceUrl
        ? await fetchDocumentText(ref.sourceUrl, deadlineAt).then((text) =>
            text ? { text, source: "source-page", url: ref.sourceUrl } : null
          )
        : null;
  }
}

// ---------------------------------------------------------------------------
// Citizen brief generation
// ---------------------------------------------------------------------------

/**
 * Section headings per type. Legislation and executive orders use Goal/Wallet/Debate;
 * a court case asks a question and hands down a ruling instead — same three slots,
 * matching the labels the mobile detail screens already pass to CitizensBriefCard.
 */
export function briefSectionLabels(
  referenceType: string,
  status: string
): { goal: string; wallet: string; debate: string } {
  if (referenceType === "scotus_case") {
    return {
      goal: "The Question",
      wallet: status === "decided" ? "The Ruling" : "What's At Stake",
      debate: "The Debate",
    };
  }
  return { goal: "The Goal", wallet: "The Wallet", debate: "The Debate" };
}

/**
 * Split the official text into rolling-draft chunks sized for the model that
 * will read them, breaking on a line boundary near the target size so sections
 * aren't cut mid-sentence. The ENTIRE text is always covered — chunking changes
 * how many reads it takes, never how much is read.
 */
function splitTextForModel(text: string, chunkChars: number): string[] {
  if (text.length <= chunkChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkChars, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf("\n", end);
      if (lastBreak > start + chunkChars / 2) end = lastBreak;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function objectionsBlock(objections?: string[]): string {
  if (!objections?.length) return "";
  return `\nA fact-check flagged these claims from a previous draft as NOT supported by the official text. Correct or drop them — do not repeat a claim the text does not support:\n${objections
    .map((o) => `- ${o}`)
    .join("\n")}\n`;
}

function briefPrompt(
  ref: ReferenceRow,
  officialText: string,
  totalParts: number,
  objections?: string[]
): { system: string; prompt: string } {
  const text = officialText;
  const textLabel =
    totalParts > 1
      ? `Official text (part 1 of ${totalParts} — the remaining parts will follow in revision passes):`
      : "Official text:";
  const context = [
    `Title: ${ref.title}`,
    ref.shortTitle ? `Short title: ${ref.shortTitle}` : null,
    `Status: ${ref.status}`,
    ref.category ? `Category: ${ref.category}` : null,
    ref.description ? `Official summary: ${ref.description.slice(0, 1_000)}` : null,
    objectionsBlock(objections) || null,
    text ? `${textLabel}\n${text}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (ref.referenceType === "scotus_case") {
    const isDecided = ref.status === "decided";
    return {
      system:
        "You are a non-partisan civic education expert who explains Supreme Court cases to everyday citizens. Be balanced, factual, and accessible. Never take a side. Always return valid JSON.",
      prompt: `Analyze this Supreme Court case and create a "Citizen's Brief" - a non-partisan, accessible summary for everyday Americans.

Docket: ${ref.masterReferenceId}
${context}

Create a Citizen's Brief with EXACTLY these three sections:

1. THE QUESTION: What legal question is the Court deciding, and why does it matter to ordinary people? (2-3 sentences, plain English, no legalese)
2. ${isDecided ? "THE RULING: What did the Court decide and what changes in practice for everyday Americans? Be concrete." : "WHAT'S AT STAKE: The case has not been decided yet. Explain what changes for everyday Americans depending on which way the Court rules. Be concrete about both outcomes."}
3. THE DEBATE: What are the strongest arguments on each side? Present both fairly in 2-3 sentences each.

Ground every claim in the material above. Do not repeat the section name inside the text.

Return as JSON:
{ "theGoal": "...", "theWallet": "...", "theDebate": "..." }`,
    };
  }

  if (ref.referenceType === "executive_order") {
    return {
      system:
        "You are a non-partisan civic education expert who explains executive actions to everyday citizens. Be balanced, factual, and accessible. Never take a side. Always return valid JSON.",
      prompt: `Analyze this presidential executive order and create a "Citizen's Brief" - a non-partisan, accessible summary for everyday Americans.

Order: ${ref.masterReferenceId.toUpperCase()}
${context}

Create a Citizen's Brief with EXACTLY these three sections:

1. THE GOAL: What does this executive order direct the government to do, and who does it affect? (2-3 sentences, plain English)
2. THE WALLET: What does it cost or save taxpayers, and who pays? Be specific with numbers if available. If unknown, explain what financial impact is expected.
3. THE DEBATE: What are the strongest arguments FOR and AGAINST this order, including any dispute over presidential authority? Present both sides fairly in 2-3 sentences each.

Ground every claim in the material above. Do not repeat the section name inside the text.

Return as JSON:
{ "theGoal": "...", "theWallet": "...", "theDebate": "..." }`,
    };
  }

  return {
    system:
      "You are a non-partisan civic education expert who explains legislation to everyday citizens. Be balanced, factual, and accessible. Always return valid JSON.",
    prompt: `Analyze this congressional bill and create a "Citizen's Brief" - a non-partisan, accessible summary for everyday Americans.

Bill: ${ref.masterReferenceId.toUpperCase()}
${ref.chamber ? `Chamber: ${ref.chamber}` : ""}
${context}

Create a Citizen's Brief with EXACTLY these three sections:

1. THE GOAL: What is this bill trying to do? (2-3 sentences, plain English)
2. THE WALLET: How much taxpayer money does this cost or save? Be specific with numbers if available. If unknown, explain what financial impact is expected.
3. THE DEBATE: What are the strongest arguments FOR and AGAINST this bill? Present both sides fairly in 2-3 sentences each.

Ground every claim in the material above. Do not repeat the section name inside the text.

Return as JSON:
{ "theGoal": "...", "theWallet": "...", "theDebate": "..." }`,
  };
}

/**
 * Rolling-draft revision pass: the model reads the NEXT part of the original
 * text alongside the current draft and revises the draft. The only source
 * material is ever the original text — never another summary.
 */
function rollingRevisePrompt(
  ref: ReferenceRow,
  draft: CitizenBriefSections,
  chunk: string,
  part: number,
  totalParts: number,
  objections?: string[]
): { system: string; prompt: string } {
  return {
    system:
      "You are a non-partisan civic education expert revising a draft Citizen's Brief against the original official text. Be balanced, factual, and accessible. Never invent facts — every statement must be grounded in the official text or metadata provided. Always return valid JSON.",
    prompt: `Below is the current draft of a "Citizen's Brief" for "${ref.title}", written from parts 1–${part - 1} of the official text. Now read part ${part} of ${totalParts} of the ORIGINAL official text and revise the draft so it accurately reflects everything read so far.

Rules:
- Only add or change statements grounded in the official text you have been given.
- Keep the same three sections and plain-English style (2-3 sentences each).
- If this part changes nothing material, return the draft unchanged.
${objectionsBlock(objections)}
Current draft (JSON):
${JSON.stringify(draft)}

Official text (part ${part} of ${totalParts}):
${chunk}

Return the full revised brief as JSON:
{ "theGoal": "...", "theWallet": "...", "theDebate": "..." }`,
  };
}

function factCheckPrompt(
  ref: ReferenceRow,
  sections: CitizenBriefSections,
  chunk: string,
  part: number,
  totalParts: number
): { system: string; prompt: string } {
  const partNote =
    totalParts > 1
      ? `\nYou are seeing part ${part} of ${totalParts} of the official text. Flag any claim THIS part does not support; claims supported by other parts are filtered out later.`
      : "";
  return {
    system:
      "You are a meticulous, non-partisan fact-checker. You compare a summary against official source text and flag unsupported claims. Always return valid JSON.",
    prompt: `Fact-check this "Citizen's Brief" against the official text and metadata below.

Flag a sentence ONLY if it misstates what the document does, or asserts specific facts, numbers, or provisions about the document's contents that appear nowhere in the material. Do NOT flag: general characterizations of the public debate or supporter/critic arguments, cost language clearly framed as an expectation or as unknown, or plain-language rephrasing of what the text says.${partNote}

Brief:
${flattenBrief(ref, sections)}

Metadata:
Title: ${ref.title}
${ref.description ? `Official summary: ${ref.description.slice(0, 1_000)}` : ""}

Official text:
${chunk}

Return as JSON (empty array if everything is supported):
{ "unsupported": ["exact sentence from the brief", ...] }`,
  };
}

/**
 * Generate the brief from the original text: one pass when it fits, otherwise
 * a rolling draft carried across sequential passes over the original text.
 */
async function generateBriefFromChunks(
  ref: ReferenceRow,
  chunks: string[],
  plan: BriefJobPlan,
  objections?: string[]
): Promise<{ sections: CitizenBriefSections | null; provider: string }> {
  const totalParts = chunks.length;
  // The pass that produces the text the user reads gets the write model; the
  // earlier passes are mechanical fact-pulling and stay on the cheap reader.
  const modelForPass = (index: number) => (index === totalParts - 1 ? plan.writeModel : plan.readModel);

  const first = briefPrompt(ref, chunks[0] ?? "", totalParts, objections);
  const result = await generateAI({
    system: first.system,
    prompt: first.prompt,
    model: modelForPass(0),
    maxCompletionTokens: 4_000,
    temperature: 0.7,
    jsonMode: true,
  });

  const parsed = result.ok ? parseJsonObject<Partial<CitizenBriefSections>>(result.content) : null;
  if (!result.ok || !isUsable(parsed)) {
    console.warn(
      `[RefContent] First pass failed for ${ref.masterReferenceId}: ${
        result.ok ? `unusable content (${result.content.length} chars)` : result.error.slice(0, 300)
      }`
    );
    return { sections: null, provider: "fallback" };
  }

  let sections: CitizenBriefSections = parsed;
  let provider: string = result.model;

  for (let i = 1; i < totalParts; i++) {
    // Every part of the original text must be read into the draft — retry a
    // failed pass before giving up on that part.
    let incorporated = false;
    for (let attempt = 0; attempt < 3 && !incorporated; attempt++) {
      const revise = rollingRevisePrompt(ref, sections, chunks[i] ?? "", i + 1, totalParts, objections);
      const pass = await generateAI({
        system: revise.system,
        prompt: revise.prompt,
        model: modelForPass(i),
        maxCompletionTokens: 4_000,
        temperature: 0.7,
        jsonMode: true,
      });
      const revised = pass.ok ? parseJsonObject<Partial<CitizenBriefSections>>(pass.content) : null;
      if (pass.ok && isUsable(revised)) {
        sections = revised;
        provider = pass.model;
        incorporated = true;
      } else {
        console.warn(
          `[RefContent] Rolling pass ${i + 1}/${totalParts} attempt ${attempt + 1} failed for ${ref.masterReferenceId}`
        );
      }
    }
    if (!incorporated) {
      console.warn(
        `[RefContent] Rolling pass ${i + 1}/${totalParts} exhausted retries for ${ref.masterReferenceId} — draft may not reflect that part`
      );
    }
  }

  return { sections, provider };
}

/**
 * Verify every sentence of the brief against the original text. Returns the
 * list of unsupported claims ([] = clean), or null if verification couldn't run.
 * With multiple parts, a claim counts as unsupported only if NO part supports it.
 */
async function factCheckBrief(
  ref: ReferenceRow,
  sections: CitizenBriefSections,
  chunks: string[],
  plan: BriefJobPlan
): Promise<string[] | null> {
  if (!chunks[0]) return []; // no official text — brief is metadata-only, nothing to check against
  const normalize = (s: string) => s.trim().toLowerCase();
  let unsupported: Map<string, string> | null = null;

  for (let i = 0; i < chunks.length; i++) {
    const { system, prompt } = factCheckPrompt(ref, sections, chunks[i] ?? "", i + 1, chunks.length);
    const result = await generateAI({
      system,
      prompt,
      model: plan.factCheckModel,
      maxCompletionTokens: 2_000,
      temperature: 0.2,
      jsonMode: true,
    });
    if (!result.ok) return null;
    const parsed = parseJsonObject<{ unsupported?: unknown }>(result.content);
    if (!parsed || !Array.isArray(parsed.unsupported)) return null;

    const flagged = new Map<string, string>();
    for (const claim of parsed.unsupported) {
      if (typeof claim === "string" && claim.trim()) flagged.set(normalize(claim), claim.trim());
    }
    if (flagged.size === 0) return []; // this part supports everything — brief is clean

    if (unsupported === null) {
      unsupported = flagged;
    } else {
      for (const key of [...unsupported.keys()]) {
        if (!flagged.has(key)) unsupported.delete(key);
      }
      if (unsupported.size === 0) return [];
    }
  }

  return [...(unsupported?.values() ?? [])];
}


/** Flat, labelled rendering stored in citizenBrief for cards, posts, and B2B consumers. */
function flattenBrief(ref: ReferenceRow, brief: CitizenBriefSections): string {
  const labels = briefSectionLabels(ref.referenceType, ref.status);
  return [
    `${labels.goal}: ${brief.theGoal}`,
    `${labels.wallet}: ${brief.theWallet}`,
    `${labels.debate}: ${brief.theDebate}`,
  ].join("\n\n");
}

function isUsable(sections: Partial<CitizenBriefSections> | null): sections is CitizenBriefSections {
  return !!sections?.theGoal?.trim() && !!sections.theWallet?.trim() && !!sections.theDebate?.trim();
}

export function parseBriefJson(json: string | null | undefined): CitizenBriefSections | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<CitizenBriefSections>;
    return isUsable(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function generateAndStoreBrief(ref: ReferenceRow): Promise<void> {
  // NO OFFICIAL TEXT, NO BRIEF. A summary written from a title and a one-line
  // blurb is a guess, and a guess rendered in the brief panel is indistinguishable
  // from a grounded brief — which is exactly how inaccurate briefs reached readers.
  // The document says "official text unavailable" instead, and the next reader
  // retries the source chain.
  if (!ref.fullText) {
    await markSettled(ref.id, "unavailable");
    console.warn(
      `[RefContent] No brief for ${ref.masterReferenceId} — official text unavailable, refusing to summarize metadata`
    );
    return;
  }

  // Pick the model BEFORE any call, from the document's size and type. No AI
  // call is spent deciding, and no job walks a ladder of models to find one.
  const text = ref.fullText ?? "";
  const plan = classifyBriefJob({ referenceType: ref.referenceType, textChars: text.length });

  // The ENTIRE official text goes to the model — one read when it fits,
  // otherwise a rolling draft over sequential parts of the original text.
  const chunks = splitTextForModel(text, plan.chunkChars);

  console.log(
    `[RefContent] ${ref.masterReferenceId}: ${text.length} chars → ${plan.lane} lane, ` +
      `${chunks.length} pass${chunks.length === 1 ? "" : "es"} (read: ${plan.readModel}, write: ${plan.writeModel})`
  );

  let generated = await generateBriefFromChunks(ref, chunks, plan);
  let factCheck = "skipped (no draft)";

  if (generated.sections) {
    const issues = await factCheckBrief(ref, generated.sections, chunks, plan);
    if (issues === null) {
      factCheck = "unavailable";
    } else if (issues.length === 0) {
      factCheck = "clean";
    } else {
      // Regenerate once with the objections attached, then re-verify.
      console.warn(
        `[RefContent] Fact-check flagged ${issues.length} claim(s) for ${ref.masterReferenceId}; regenerating`
      );
      const retry = await generateBriefFromChunks(ref, chunks, plan, issues);
      if (retry.sections) generated = retry;
      const retryIssues = generated.sections
        ? await factCheckBrief(ref, generated.sections, chunks, plan)
        : null;
      factCheck =
        retryIssues === null
          ? "retry unverified"
          : retryIssues.length === 0
            ? "clean after retry"
            : `${retryIssues.length} claim(s) still flagged: ${retryIssues.join(" | ")}`;
    }
  }

  // Every provider failed on text we DO have. Leave the brief empty and let the
  // reader retry rather than storing boilerplate that reads like a real summary.
  if (!generated.sections) {
    await markSettled(ref.id, "unavailable");
    console.warn(
      `[RefContent] Brief generation failed for ${ref.masterReferenceId} (${plan.lane} lane, ${chunks.length} pass${chunks.length === 1 ? "" : "es"}) — nothing stored`
    );
    return;
  }

  const brief = generated.sections;
  await prisma.governmentReference.update({
    where: { id: ref.id },
    data: {
      citizenBriefJson: JSON.stringify(brief),
      citizenBrief: flattenBrief(ref, brief),
      citizenBriefAt: new Date(),
      citizenBriefModel: generated.provider,
      // Pin the brief to the version of the law it describes. This is what
      // makes "one per version" checkable: every later reader compares this to
      // lawVersion and reuses instead of paying again.
      citizenBriefVersion: ref.lawVersion,
      contentStatus: "ready",
      contentStartedAt: null,
    },
  });

  console.log(
    `[RefContent] Brief stored for ${ref.masterReferenceId} (${plan.lane} lane, model: ${generated.provider}, ` +
      `${text.length} chars, ${chunks.length} pass${chunks.length === 1 ? "" : "es"}, fact-check: ${factCheck})`
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const SELECT_FIELDS = {
  id: true,
  masterReferenceId: true,
  referenceType: true,
  title: true,
  shortTitle: true,
  status: true,
  category: true,
  description: true,
  sourceUrl: true,
  chamber: true,
  congress: true,
  signedDate: true,
  decidedDate: true,
  fullText: true,
  fullTextHash: true,
  fullTextUrl: true,
  citizenBriefJson: true,
  sourceCheckedAt: true,
  lawVersion: true,
  citizenBriefVersion: true,
} as const;

/** One pull per reference at a time, however many readers arrive at once. */
const inFlight = new Map<string, Promise<void>>();

export async function ensureReferenceContent(
  referenceId: string,
  options: EnsureContentOptions = {}
): Promise<void> {
  const existing = inFlight.get(referenceId);
  if (existing) {
    // Someone is already pulling this law — wait for their result instead of
    // hitting the official API a second time. The brief-builder job must still
    // run afterwards: the run it waited on may only have ENQUEUED that job.
    await existing;
    if (!options.force && !options.generateBriefInline) return;
  }

  const run = runEnsure(referenceId, options).finally(() => {
    inFlight.delete(referenceId);
  });
  inFlight.set(referenceId, run);
  await run;
}

async function runEnsure(referenceId: string, options: EnsureContentOptions): Promise<void> {
  const { force = false, deadlineMs = 8_000, generateBriefInline = false } = options;
  const deadlineAt = Date.now() + deadlineMs;

  const ref = (await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: SELECT_FIELDS,
  })) as ReferenceRow | null;

  if (!ref) return;

  const textMissing = !ref.fullText;
  const dueForRecheck =
    !ref.sourceCheckedAt || Date.now() - ref.sourceCheckedAt.getTime() > SOURCE_RECHECK_MS;
  const shouldFetchText = force || textMissing || dueForRecheck;

  let textChanged = false;
  let current = ref;

  if (shouldFetchText) {
    if (textMissing) {
      await markWorking(ref.id, "fetching");
    }

    const fetched = await fetchOfficialText(ref, deadlineAt);
    const now = new Date();

    if (fetched) {
      const hash = hashText(fetched.text);
      textChanged = hash !== ref.fullTextHash;

      if (textChanged) {
        // A first pull is not a change. The law did not move; we simply did not
        // have it yet, and badging every post on a record whose text we just
        // fetched for the first time would be a lie told at scale.
        const lawMoved = ref.fullTextHash !== null;

        // Stored copy is outdated (or absent) — the master reference takes the new text.
        await prisma.governmentReference.update({
          where: { id: ref.id },
          data: {
            fullText: fetched.text,
            fullTextHash: hash,
            fullTextSource: fetched.source,
            fullTextUrl: fetched.url,
            fullTextAt: now,
            sourceCheckedAt: now,
            ...(lawMoved ? { lawChangedAt: now, lawVersion: { increment: 1 } } : {}),
          },
        });
        // Carry the incremented version forward. The brief written below is
        // pinned to whatever `current.lawVersion` says, so leaving the stale
        // number here would pin every new brief to the version before the one
        // it describes — and every later reader would regenerate it again.
        current = {
          ...ref,
          fullText: fetched.text,
          fullTextHash: hash,
          fullTextUrl: fetched.url,
          lawVersion: lawMoved ? ref.lawVersion + 1 : ref.lawVersion,
        };
        console.log(
          `[RefContent] Text ${textMissing ? "pulled" : "refreshed"} for ${ref.masterReferenceId} from ${fetched.source}`
        );

        if (lawMoved) {
          // Everyone who shared this law gets told, once. Their posts are not
          // touched; the card on each one carries the badge.
          const { notified } = await notifyLawUpdate(ref.id, ref.masterReferenceId, ref.title);
          if (notified > 0) {
            console.log(
              `[RefContent] told ${notified} person(s) that ${ref.masterReferenceId} changed`
            );
          }
        }
      } else {
        await prisma.governmentReference.update({
          where: { id: ref.id },
          data: { sourceCheckedAt: now },
        });
      }
    } else {
      // Every source failed. Record the attempt so we don't hammer a dead endpoint
      // on every page view — the brief still gets built from the official summary.
      await prisma.governmentReference.update({
        where: { id: ref.id },
        data: { sourceCheckedAt: now },
      });
      if (textMissing) {
        console.warn(`[RefContent] No official text available for ${ref.masterReferenceId}`);
      }
    }
  }

  // No official text means no brief, and saying so has to STICK. Without this,
  // every page view would re-enqueue a brief job and flip the row back to
  // brief_pending, so the reader would watch a spinner that never resolves.
  if (!current.fullText) {
    await markSettled(ref.id, "unavailable");
    return;
  }

  // The stored brief still describes this law if it was written for the version
  // the law is on now.
  //
  // `textChanged` alone is not enough and never was: it lives for the length of
  // this function call, so a regeneration that failed left a brief on the row,
  // no record of the failure, and every later reader served a summary of a law
  // that no longer existed. The version comparison outlives the process.
  //
  // It also makes the other half true. A brief that IS current is never
  // rewritten, however many people open it — not per click, not per user, not
  // per post. Once per version of the law.
  const briefIsCurrent =
    Boolean(current.citizenBriefJson) && current.citizenBriefVersion === current.lawVersion;
  const briefNeeded = force || !briefIsCurrent || textChanged;
  if (!briefNeeded) {
    await markSettled(ref.id, "ready");
    return;
  }

  if (generateBriefInline) {
    await generateAndStoreBrief(current);
    return;
  }

  // Hand the brief to the queue: the reader gets official text now and the brief
  // lands a few seconds later, which both faucets poll for.
  await markWorking(ref.id, "brief_pending");
  jobQueue.enqueue(
    JobType.GENERATE_REFERENCE_BRIEF,
    { referenceId: ref.id, force },
    JobPriority.HIGH
  );
}

/** Job-queue entry point: finish the pull and build the brief inline. */
export async function processReferenceBrief(referenceId: string, force: boolean): Promise<void> {
  await ensureReferenceContent(referenceId, {
    force,
    deadlineMs: FETCH_TIMEOUT_MS * 2,
    generateBriefInline: true,
  });
}
