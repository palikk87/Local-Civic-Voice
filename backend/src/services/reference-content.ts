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
import { composeBrief, flattenBrief, parseBrief, serializeBrief } from "./citizen-brief";
import { JobPriority, JobType, jobQueue } from "./job-queue";
import { notifyLawUpdate } from "./notification-service";
import { ReferenceKind, parseReferenceId } from "./master-reference-id";
import { markSettled, markWorking } from "./brief-state";

const FETCH_TIMEOUT_MS = 15_000;
/** How long stored text is trusted before we re-compare it against the official source. */
const SOURCE_RECHECK_MS = 24 * 60 * 60 * 1000;

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

/**
 * Which official sources this deployment can actually reach.
 *
 * WHY THIS IS SURFACED. "No official text available" is the same sentence
 * whether the law genuinely has nothing published or the server has no key to
 * ask with — and the second is an operator problem wearing the first one's
 * clothes. Without a key, congress.gov answers 403 to every request, every bill
 * reports no text, and every Citizen's Brief is unavailable. Nothing in the
 * product said so.
 *
 * Reported by GET /health alongside the email configuration, for the same
 * reason: a credential that is missing fails silently at the moment a reader
 * needs it, not at boot.
 */
export function officialSources(): {
  congress: boolean;
  courtListener: boolean;
  federalRegister: true;
} {
  return {
    // Bills. Without it there is no legislative text at all.
    congress: !!process.env.CONGRESS_API_KEY,
    // Supreme Court opinions. Optional — the public page is the fallback.
    courtListener: !!process.env.COURTLISTENER_API_KEY,
    // Executive orders. Public API, no key exists to be missing.
    federalRegister: true,
  };
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

  // Loud, and specific about whose problem it is. This used to fall through to
  // the generic "no official text available", so a missing key looked exactly
  // like a law nobody has published — and every bill on the platform reported
  // the second when the truth was the first.
  if (!apiKey) {
    console.error(
      `[RefContent] CONGRESS_API_KEY is not set. No bill text can be fetched, so every ` +
        `Citizen's Brief for a bill will report as unavailable. ${ref.masterReferenceId} is ` +
        `one of them.`,
    );
  }

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
// Citizen brief
// ---------------------------------------------------------------------------
//
// The brief itself lives in citizen-brief.ts, which knows one thing: how to turn
// the official text of a law into a plain-English paragraph plus the case for
// and the case against. It is given the text and nothing else — no title, no
// status, no summary written by somebody else — because every other input is a
// route to a confident claim the law does not make.
//
// This file's job is the text: fetching it, noticing when it changes, and
// storing what comes back.

/**
 * Write the brief for a record whose text we already hold, and store it.
 *
 * NO TEXT, NO BRIEF, and that decision is made here rather than deep in a
 * prompt: a summary written from a title and a status is a guess, and a guess
 * rendered in the brief card is indistinguishable from a real one.
 */
async function generateAndStoreBrief(ref: ReferenceRow): Promise<void> {
  const outcome = await composeBrief(ref.fullText);

  if (outcome.state === "unavailable") {
    await markSettled(ref.id, "unavailable");
    console.warn(`[Brief] no brief for ${ref.masterReferenceId}: ${outcome.reason}`);
    return;
  }

  await prisma.governmentReference.update({
    where: { id: ref.id },
    data: {
      citizenBriefJson: serializeBrief(outcome.brief),
      citizenBrief: flattenBrief(outcome.brief),
      citizenBriefAt: new Date(),
      citizenBriefModel: outcome.model,
      // Pinned to the version of the law it describes. This is what makes "one
      // brief per version" checkable: every later reader compares this against
      // lawVersion and reuses instead of paying again.
      citizenBriefVersion: ref.lawVersion,
      contentStatus: "ready",
      contentStartedAt: null,
    },
  });

  console.log(
    `[Brief] stored for ${ref.masterReferenceId} (${outcome.model}, ${ref.fullText?.length ?? 0} chars)`
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
  // PARSED, not merely present — and this is the same question briefState()
  // answers for the client, so it has to be answered the same way.
  //
  // When these two disagreed, the button stopped working entirely. A record
  // holding a brief written to an EARLIER definition of what a Citizen's Brief
  // is would satisfy `Boolean(citizenBriefJson)`, so this said "already
  // current", settled the row as ready, and returned without fetching text or
  // writing anything. The endpoint then re-read the row, asked briefState(),
  // which parses — and got "not ready". Press the button, nothing happens.
  // Press it again, nothing happens. Forever, for every record that had ever
  // been briefed before.
  const briefIsCurrent =
    parseBrief(current.citizenBriefJson) !== null &&
    current.citizenBriefVersion === current.lawVersion;
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
