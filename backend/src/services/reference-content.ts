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
import { aiAvailability } from "./ai-generate";
import { JobPriority, JobType, jobQueue } from "./job-queue";
import { notifyLawUpdate } from "./notification-service";
import { ReferenceKind, parseReferenceId } from "./master-reference-id";
import { fetchCourtListener } from "./courtlistener";
import { markSettled, markWorking } from "./brief-state";

const FETCH_TIMEOUT_MS = 15_000;

/**
 * When the three branch-specific extractors replaced the shared one.
 *
 * Any record whose text was last confirmed before this holds text produced by
 * the broken extraction: an executive order with the Federal Register's cover
 * page above it, a bill at the version that was introduced rather than the one
 * that passed, a Supreme Court case with no text at all.
 *
 * Two things read this, and both matter:
 *
 *   the repair pass   queues exactly those records for re-extraction, once,
 *                     on the deploy that carries the fix
 *   lawMoved          refuses to call the difference a change of law, on ANY
 *                     path, until the record has been re-extracted
 *
 * The second is not redundant. Without it, a reader who opens a record in the
 * minutes between the deploy and the repair reaching that record triggers an
 * ordinary daily recheck, which pulls the corrected text, sees it differs, and
 * tells everyone who shared it that the law changed. Same false statement, same
 * blast radius, through a door the repair pass does not cover.
 *
 * `fullTextAt` is the marker rather than `sourceCheckedAt` because it moves
 * only when text is actually confirmed. A failed pull stamps sourceCheckedAt
 * and would take a record out of the repair set while leaving the old text on
 * it — checked, unfixed, and no longer protected.
 */
export const EXTRACTION_FIXED_AT = new Date("2026-08-18T00:00:00Z");

/** Was this record's stored text produced by the extraction we replaced? */
function predatesExtractionFix(fullTextAt: Date | null): boolean {
  return fullTextAt === null || fullTextAt < EXTRACTION_FIXED_AT;
}
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
  /**
   * This run is fixing OUR extraction, not following the law.
   *
   * When a retrieval bug is repaired, every affected record pulls text that
   * differs from what is stored — and by every ordinary measure that is the law
   * changing. It is not. The Federal Register did not reissue an order because
   * we stopped storing the page header above it, and Congress did not re-pass a
   * bill because we stopped serving the introduced draft of it.
   *
   * Treating it as a change would increment lawVersion, badge every post that
   * shared the record as "updated since this was posted", and notify everyone
   * who shared it. That is a false statement about the government, sent to
   * every user at once, caused by us fixing our own defect.
   *
   * So under this flag the text is replaced and the version is left alone —
   * but the stored brief is invalidated, because a brief written from the old
   * extraction described a page header rather than a law and must not be served
   * again.
   */
  reextract?: boolean;
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
      // A rate limit is not a dead endpoint, and the two must not read the same
      // in the log. congress.gov runs on api.data.gov, whose ceiling is hourly:
      // there is no wait short enough to sit out inside a request, so this says
      // plainly that the key is throttled rather than that the law is missing.
      if (response.status === 429) {
        console.error(
          `[RefContent] RATE LIMITED by ${new URL(url).host}. The key is valid and over its ` +
            `quota, so text will keep failing until the window resets — this is not a law ` +
            `without published text.`
        );
      } else {
        console.warn(`[RefContent] ${response.status} from ${url.split("?")[0]}`);
      }
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Strip markup so stored "full text" is readable plain text regardless of source format. */
export function htmlToText(input: string): string {
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
export function sanitizeOfficialText(text: string): string {
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
  briefWriter: boolean;
} {
  const ai = aiAvailability();
  return {
    // Bills. Without it there is no legislative text at all.
    congress: !!process.env.CONGRESS_API_KEY,
    // Supreme Court opinions. NOT optional, and it used to be described here as
    // if it were: CourtListener answers 401 on the opinion endpoint without a
    // token and serves a bot check on its public page, so a missing key means
    // no judicial text at all.
    courtListener: !!process.env.COURTLISTENER_API_KEY,
    // Executive orders. Public API, no key exists to be missing.
    federalRegister: true,
    // Having the text is half of it. With no model key there is no brief for
    // any branch, and this endpoint said nothing about that at all — so a
    // platform-wide brief outage looked from here like three healthy sources.
    briefWriter: ai.gemini || ai.openai,
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
  fullTextAt: Date | null;
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

// ---------------------------------------------------------------------------
// Legislative — congress.gov
// ---------------------------------------------------------------------------
//
// congress.gov needs a key, gives clean text, and asks one question the other
// two branches never do: WHICH text? A bill is not one document. HR 1 of the
// 119th Congress has six of them — introduced, reported, engrossed, placed on
// calendar, enrolled, public law — and they say materially different things.
// Serving the wrong one is not a formatting problem; it is briefing a citizen
// on a draft that was amended before it passed.
//
// MEASURED, because the code here assumed the opposite and was wrong:
// congress.gov returns textVersions NEWEST FIRST.
//
//   HR 22 (119th)   2025-04-10 Engrossed in House
//                   2025-01-03 Introduced in House
//
// The chain reversed that list, commented "Newest version last in the API
// response", and took the introduced text of every bill on the platform.
//
// List position is not a stage, though, so it is not trusted either way. HR 1
// comes back with "Enrolled Bill" first carrying a NULL date, and "Public Law"
// LAST — neither ordering rule finds the enacted text. The version is chosen by
// what the version IS.

interface BillTextVersion {
  date?: string | null;
  type?: string | null;
  formats?: Array<{ type?: string; url?: string }>;
}

/**
 * How far through Congress this text got. Higher wins.
 *
 * The enacted text beats the passed text beats the draft, whatever order the
 * API lists them in and whatever dates it does or does not attach.
 */
function stageOf(versionType: string | null | undefined): number {
  const type = (versionType ?? "").toLowerCase();
  if (type.includes("public law")) return 60;
  if (type.includes("enrolled")) return 50;
  if (type.includes("engrossed")) return 40;
  if (type.includes("passed")) return 40;
  if (type.includes("reported")) return 30;
  if (type.includes("placed on calendar")) return 25;
  if (type.includes("referred")) return 20;
  if (type.includes("introduced")) return 10;
  return 15;
}

/** Furthest through Congress first; among equals, the most recent. */
function byAuthority(a: BillTextVersion, b: BillTextVersion): number {
  const stage = stageOf(b.type) - stageOf(a.type);
  if (stage !== 0) return stage;
  // A null date must not sink a version — "Enrolled Bill" arrives with one.
  const at = a.date ? Date.parse(a.date) : 0;
  const bt = b.date ? Date.parse(b.date) : 0;
  return bt - at;
}

/** The plain-text rendering, if this version has one. */
function preferredFormat(version: BillTextVersion): string | null {
  const formats = version.formats ?? [];
  const pick =
    formats.find((f) => (f.type ?? "").toLowerCase().includes("formatted text")) ??
    formats.find((f) => (f.type ?? "").toLowerCase() === "text") ??
    // Never a PDF: it downloads as bytes we cannot read, and accepting it would
    // store a binary blob where the law belongs.
    formats.find((f) => !(f.type ?? "").toLowerCase().includes("pdf"));
  return pick?.url ?? null;
}

/**
 * The Government Publishing Office stamps four lines of provenance above every
 * bill, then a run of blank lines:
 *
 *   [Congressional Bills 119th Congress]
 *   [From the U.S. Government Publishing Office]
 *   [H.R. 22 Engrossed in House (EH)]
 *   <DOC>
 *
 * True, useful to a librarian, and not part of the bill. Off it comes, and the
 * text starts where the law starts.
 */
export function stripGpoHeader(text: string): string {
  return text
    .replace(/^\s*(?:\[[^\]\n]*\]\s*\n)+/, "")
    .replace(/^\s*<DOC>\s*/i, "")
    .replace(/^(?:[ \t]*\n){2,}/, "")
    .trim();
}

export async function fetchBillText(ref: ReferenceRow, deadlineAt: number): Promise<TextResult | null> {
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
    const data = await fetchJson<{ textVersions?: BillTextVersion[] }>(
      `${base}/text?format=json&api_key=${apiKey}`,
      deadlineAt
    );

    const versions = [...(data?.textVersions ?? [])].sort(byAuthority);
    for (const version of versions) {
      const url = preferredFormat(version);
      if (!url) continue;
      const text = await fetchDocumentText(url, deadlineAt);
      if (text) {
        const body = stripGpoHeader(text);
        if (body.length > 200) {
          console.log(
            `[RefContent] ${ref.masterReferenceId}: using the "${version.type ?? "unknown"}" text`
          );
          return { text: body, source: "congress.gov/text", url };
        }
      }
    }

    // Source 2: the CRS summary. A summary is not the law, and it is used only
    // when no version of the text is published — which is the ordinary state of
    // a bill in its first days.
    const summaries = await fetchJson<{
      summaries?: Array<{ text?: string; updateDate?: string; actionDate?: string }>;
    }>(`${base}/summaries?format=json&api_key=${apiKey}`, deadlineAt);

    // Sorted, not indexed. The last element is the newest summary only if the
    // API happens to order them that way, and assuming that about textVersions
    // is what put the introduced text of every bill in front of readers.
    const latestSummary = [...(summaries?.summaries ?? [])].sort((a, b) => {
      const at = Date.parse(a.actionDate ?? a.updateDate ?? "") || 0;
      const bt = Date.parse(b.actionDate ?? b.updateDate ?? "") || 0;
      return bt - at;
    })[0]?.text;

    if (latestSummary) {
      const text = sanitizeOfficialText(htmlToText(latestSummary));
      if (text.length > 200) {
        return { text, source: "congress.gov/summaries", url: `${base}/summaries` };
      }
    }
  }

  // Source 3: the official congress.gov page for this bill.
  if (ref.sourceUrl) {
    const text = await fetchDocumentText(`${ref.sourceUrl}/text`, deadlineAt);
    if (text) {
      const body = stripGpoHeader(text);
      if (body.length > 200) {
        return { text: body, source: "congress.gov/page", url: `${ref.sourceUrl}/text` };
      }
    }
  }

  console.warn(
    `[RefContent] congress.gov has no text for ${ref.masterReferenceId} ` +
      `(${parsed ? `${parsed.congress}/${parsed.type}/${parsed.number}` : "unparseable id"})`
  );
  return null;
}

// ---------------------------------------------------------------------------
// Executive — Federal Register
// ---------------------------------------------------------------------------
//
// The Federal Register is open: no key, no token, no throttle to negotiate. Its
// difficulty is a different one — it publishes the same order at three URLs and
// only one of them is the order.
//
// Measured against document 2026-16730 (Executive Order 14420):
//
//   raw_text_url       11,224 bytes, and despite the .txt it is HTML: an
//                      <html><head><title>Federal Register, Volume 91 Issue
//                      156</title> wrapper around a <pre> block, which then
//                      opens with the gazette furniture — [[Page 53171]],
//                      "Vol. 91", "No. 156", "Part XXX", running heads and
//                      rules — before reaching the order
//   body_html_url      12,006 bytes that begin "Executive Order 14420 of
//                      August 10, 2026", the title, and "By the authority
//                      vested in me as President…". The order, and nothing else
//   full_text_xml_url  the same content in FR's own tag vocabulary
//
// So body_html comes first. The old order tried raw text first, stored the
// gazette wrapper as the text of the order, and handed a model a page header
// to write a brief from.

/** The URLs the Federal Register serves one document at, best first. */
interface FederalRegisterDocument {
  body_html_url?: string | null;
  raw_text_url?: string | null;
  full_text_xml_url?: string | null;
}

function federalRegisterSources(doc: FederalRegisterDocument | null): string[] {
  return [doc?.body_html_url, doc?.raw_text_url, doc?.full_text_xml_url].filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );
}

/**
 * Take the order out of the gazette.
 *
 * The raw-text file is a page of the Federal Register, not a document: issue
 * header, volume and number, part number, printer's rules, and a [[Page NNNNN]]
 * marker wherever the typesetter broke a page — dropped mid-sentence, so they
 * corrupt the prose as well as padding it.
 *
 * TWO GUARDS, both learned by getting it wrong:
 *
 * 1. Only a gazette page is taken apart. The document body served at
 *    body_html_url carries none of this furniture, and running a cut over it
 *    would be all risk and no benefit — so a text with no gazette markings is
 *    returned untouched.
 *
 * 2. The cut is made on the order's OWN number. An order that cites an earlier
 *    one says "Executive Order 14407 of May 29, 2026" in the middle of its own
 *    text; cutting at the first heading-shaped thing threw away everything
 *    before that, enacting sentence included. Measured on this document: the
 *    real heading sits at character 778 and the citation at 1,982, and only the
 *    number tells them apart.
 */
const GAZETTE_MARKERS = /\[\[Page|From the Federal Register Online|Federal Register\s*\/\s*Vol/i;
/** How far into the text the Federal Register's own front matter can run. */
const FRONT_MATTER_CHARS = 3_000;

export function stripFederalRegisterFurniture(text: string, eoNumber?: string | null): string {
  if (!GAZETTE_MARKERS.test(text.slice(0, 4_000))) return text;

  const withoutPageMarks = text
    .replace(/\[\[Page[^\]]*\]\]/g, " ")
    .replace(/^\s*-{10,}\s*$/gm, "")
    .replace(/^\s*_{10,}\s*$/gm, "");

  // Without a number there is nothing safe to cut on, so only the page markers
  // come off. A wrong cut loses the operative text; a header left in place
  // costs a few hundred characters of a document the model reads in full.
  let cut = -1;
  if (eoNumber) {
    const heading = new RegExp(`Executive Order ${eoNumber}\\s+of\\s+\\w+`, "g");
    for (const match of withoutPageMarks.matchAll(heading)) {
      if (match.index === undefined || match.index > FRONT_MATTER_CHARS) break;
      cut = match.index;
    }
  }

  const body = cut >= 0 ? withoutPageMarks.slice(cut) : withoutPageMarks;
  return body.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

async function fetchFederalRegisterText(
  url: string,
  deadlineAt: number,
  eoNumber: string | null
): Promise<string | null> {
  const text = await fetchDocumentText(url, deadlineAt);
  if (!text) return null;
  const cleaned = stripFederalRegisterFurniture(text, eoNumber);
  return cleaned.length > 200 ? cleaned : null;
}

export async function fetchExecutiveOrderText(
  ref: ReferenceRow,
  deadlineAt: number
): Promise<TextResult | null> {
  // Source 1: the document record, which names every URL it is published at.
  // The document number is embedded in the html_url stored at sync time.
  const eoNumber = ref.masterReferenceId.replace(/^eo-/i, "").replace(/\D/g, "") || null;

  const docNumber = ref.sourceUrl?.match(/federalregister\.gov\/documents\/[\d/]+\/([\w-]+)/)?.[1];
  if (docNumber) {
    const doc = await fetchJson<FederalRegisterDocument>(
      `https://www.federalregister.gov/api/v1/documents/${docNumber}.json` +
        `?fields[]=body_html_url&fields[]=raw_text_url&fields[]=full_text_xml_url`,
      deadlineAt
    );
    for (const url of federalRegisterSources(doc)) {
      const text = await fetchFederalRegisterText(url, deadlineAt, eoNumber);
      if (text) return { text, source: "federalregister", url };
    }
  }

  // Source 2: find the order by its number.
  //
  // conditions[term] and not conditions[executive_order_number]: the second one
  // reads like the right filter and the API answers it with HTTP 400. The term
  // search returns the right document, and the number is checked below rather
  // than trusted.
  if (eoNumber) {
    const search = await fetchJson<{
      results?: Array<FederalRegisterDocument & { executive_order_number?: string | number | null }>;
    }>(
      `https://www.federalregister.gov/api/v1/documents.json` +
        `?conditions[presidential_document_type]=executive_order&conditions[term]=${eoNumber}` +
        `&per_page=5&fields[]=executive_order_number&fields[]=body_html_url&fields[]=raw_text_url&fields[]=full_text_xml_url`,
      deadlineAt
    );
    const match = search?.results?.find(
      (r) => String(r.executive_order_number ?? "").replace(/\D/g, "") === eoNumber
    );
    for (const url of federalRegisterSources(match ?? null)) {
      const text = await fetchFederalRegisterText(url, deadlineAt, eoNumber);
      if (text) return { text, source: "federalregister/search", url };
    }
  }

  // Source 3: whatever official page we have on file. Last, because it is a
  // rendered web page with navigation and related-document links around the
  // order rather than the order on its own.
  if (ref.sourceUrl) {
    const text = await fetchFederalRegisterText(ref.sourceUrl, deadlineAt, eoNumber);
    if (text) return { text, source: "source-page", url: ref.sourceUrl };
  }

  console.warn(
    `[RefContent] Federal Register has no text for ${ref.masterReferenceId} ` +
      `(document ${docNumber ?? "unknown"}, EO number "${eoNumber}")`
  );
  return null;
}

// ---------------------------------------------------------------------------
// Judicial — CourtListener
// ---------------------------------------------------------------------------
//
// Each branch gets its own retrieval, because each source is built differently
// and one shared protocol fits none of them. This is the judicial one.
//
// WHAT COURTLISTENER ACTUALLY DOES, measured rather than assumed:
//
//   /api/rest/v4/search/      answers 200 with NO token
//   /api/rest/v4/opinions/…   answers 401 with no token
//   the public courtlistener.com opinion page answers 202 with a ~2KB
//     bot-check interstitial and no opinion in it
//
// So the whole judicial branch stands on COURTLISTENER_API_KEY. Search working
// without one is a trap: the case is found, the text is refused, and the
// "fallback" to the public page collects an interstitial that is not a ruling.
// There is no unauthenticated path to a Supreme Court opinion here, and
// pretending otherwise is what made this look like an unpublished-text problem.
//
// AND IT IS ADDRESSED BY CLUSTER, NOT BY DOCKET NUMBER. A CourtListener
// "cluster" is one decision; its sub-opinions are the majority, the
// concurrences and the dissents. The cluster id is already sitting in the
// sourceUrl we stored at sync time (…/opinion/9986254/loper-bright…/), so the
// text is one hop away. Re-deriving the case from a docket-number search is a
// guess we do not need to make — it is kept only for a record whose stored URL
// predates this and carries no id.

/** Opinion text, in the order of preference CourtListener actually populates. */
interface CourtListenerOpinion {
  id?: number;
  type?: string;
  ordering_key?: number | null;
  plain_text?: string | null;
  html_with_citations?: string | null;
  html?: string | null;
  html_lawbox?: string | null;
  html_columbia?: string | null;
  html_anon_2020?: string | null;
  xml_harvard?: string | null;
}

/**
 * The best body this opinion carries.
 *
 * Modern opinions come through as `plain_text`. Older ones have no plain text
 * at all and live in one of the markup columns — reading only two of them, as
 * this used to, drops those cases with no error anywhere.
 */
function opinionBody(opinion: CourtListenerOpinion): string {
  const plain = opinion.plain_text?.trim();
  if (plain) return sanitizeOfficialText(plain);

  const markup =
    opinion.html_with_citations ||
    opinion.html ||
    opinion.html_lawbox ||
    opinion.html_columbia ||
    opinion.html_anon_2020 ||
    opinion.xml_harvard ||
    "";
  return markup ? sanitizeOfficialText(htmlToText(markup)) : "";
}

/**
 * "030concurrence" → "Concurrence". CourtListener prefixes a sort key to the
 * type; the digits order the opinions and the word says what each one is.
 */
function opinionLabel(type: string | undefined): string {
  const word = (type ?? "").replace(/^\d+/, "").trim();
  if (!word || word === "combined") return "Opinion";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Every opinion in the decision, joined, labelled, in the court's own order.
 *
 * A ruling is not only the majority. The dissent is the strongest statement of
 * the case against, written by justices who heard the same argument — leaving
 * it out and then asking for "the argument against" invites the model to invent
 * one. Concurrences narrow what the holding actually decided. All of it is the
 * text of the decision, so all of it is what gets stored.
 */
function joinOpinions(opinions: CourtListenerOpinion[]): string {
  return [...opinions]
    .sort((a, b) => (a.ordering_key ?? 0) - (b.ordering_key ?? 0))
    .map((opinion) => {
      const body = opinionBody(opinion);
      return body ? `## ${opinionLabel(opinion.type)}\n\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** The cluster id CourtListener put in the URL we stored: /opinion/9986254/name/ */
function clusterIdFrom(sourceUrl: string | null): string | null {
  return sourceUrl?.match(/courtlistener\.com\/opinion\/(\d+)/)?.[1] ?? null;
}

async function opinionsInCluster(
  clusterId: string,
  deadlineAt: number,
  apiKey: string
): Promise<TextResult | null> {
  const url = `https://www.courtlistener.com/api/rest/v4/opinions/?cluster=${clusterId}`;
  const data = await fetchCourtListener<{ results?: CourtListenerOpinion[] }>(url, {
    deadlineAt,
    apiKey,
    label: "opinion text",
  });
  const text = joinOpinions(data?.results ?? []);
  if (text.length <= 200) return null;
  return {
    text,
    source: "courtlistener/cluster",
    url: `https://www.courtlistener.com/opinion/${clusterId}/`,
  };
}

export async function fetchScotusText(ref: ReferenceRow, deadlineAt: number): Promise<TextResult | null> {
  const apiKey = process.env.COURTLISTENER_API_KEY;

  if (!apiKey) {
    console.error(
      `[RefContent] COURTLISTENER_API_KEY is not set. Every Supreme Court opinion needs it: ` +
        `CourtListener answers 401 on the opinion endpoint without a token, and its public ` +
        `page serves a bot check rather than the ruling. ${ref.masterReferenceId} is one of them.`
    );
    return null;
  }

    // Source 1: straight to the decision, using the cluster id already in hand.
  const storedCluster = clusterIdFrom(ref.sourceUrl);
  if (storedCluster) {
    const found = await opinionsInCluster(storedCluster, deadlineAt, apiKey);
    if (found) return found;
  }

  // Source 2: no usable id on the record — find the case by its docket number,
  // then take the cluster the search names and read that.
  const docket = ref.masterReferenceId.replace(/^scotus-/i, "");
  const search = await fetchCourtListener<{
    results?: Array<{ cluster_id?: number }>;
  }>(
    `https://www.courtlistener.com/api/rest/v4/search/?type=o&court=scotus&docket_number=${encodeURIComponent(docket)}`,
    { deadlineAt, apiKey, label: `docket ${docket}` },
  );

  for (const result of (search?.results ?? []).slice(0, 3)) {
    if (result.cluster_id === undefined) continue;
    if (String(result.cluster_id) === storedCluster) continue;
    const found = await opinionsInCluster(String(result.cluster_id), deadlineAt, apiKey);
    if (found) return { ...found, source: "courtlistener/docket-search" };
  }

  // Deliberately no HTML-page fallback. It answers 202 with a bot check, which
  // is not a ruling, and accepting it would store a placeholder as if it were
  // the law.
  console.warn(
    `[RefContent] CourtListener has no opinion text for ${ref.masterReferenceId} ` +
      `(cluster ${storedCluster ?? "unknown"}, docket "${docket}")`
  );
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
  fullTextAt: true,
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
  const {
    force = false,
    deadlineMs = 8_000,
    generateBriefInline = false,
    reextract = false,
  } = options;
  const deadlineAt = Date.now() + deadlineMs;

  const ref = (await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: SELECT_FIELDS,
  })) as ReferenceRow | null;

  if (!ref) return;

  const textMissing = !ref.fullText;
  const dueForRecheck =
    !ref.sourceCheckedAt || Date.now() - ref.sourceCheckedAt.getTime() > SOURCE_RECHECK_MS;
  const shouldFetchText = force || reextract || textMissing || dueForRecheck;

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

      // Write whenever the row is not already holding this text — which is not
      // the same question as whether the text CHANGED.
      //
      // A row can carry a hash with no text behind it: the column was cleared,
      // a write was rolled back, a restore brought the metadata and not the
      // body. On such a row the fetch succeeds, the hash matches, `textChanged`
      // is false, and the branch below is skipped — so nothing is ever stored,
      // the brief is refused for want of text, and the next reader repeats the
      // whole thing. Permanently unavailable, with the source answering 200
      // every time.
      const mustStore = textChanged || !ref.fullText;

      if (mustStore) {
        // A first pull is not a change. The law did not move; we simply did not
        // have it yet, and badging every post on a record whose text we just
        // fetched for the first time would be a lie told at scale.
        const lawMoved =
          textChanged &&
          ref.fullTextHash !== null &&
          !reextract &&
          !predatesExtractionFix(ref.fullTextAt);

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
            // The law is where it was; the brief that described the old
            // extraction is not usable and must be written again.
            ...(reextract ? { citizenBriefVersion: null } : {}),
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
          ...(reextract ? { citizenBriefVersion: null } : {}),
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
          data: {
            sourceCheckedAt: now,
            // Nothing to fix on this record — but it HAS now been confirmed
            // against the current extractor, and saying so is what stops the
            // repair pass queueing it again on every restart forever.
            ...(reextract ? { fullTextAt: now } : {}),
          },
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

/**
 * Queue the one-time repair of every record still holding text from the
 * extraction that was replaced.
 *
 * Runs at boot, on the deploy that carries the fix, and then finds nothing ever
 * again: re-extraction stamps `fullTextAt`, which is what this selects on.
 *
 * It is deliberately not an operator's job. The manual endpoint exists too, but
 * a fix that only works if somebody remembers to press a button afterwards is a
 * fix that sits unapplied — which is the same failure mode as a finished change
 * sitting on a branch nothing deploys.
 */
export async function repairStoredExtractions(): Promise<number> {
  const stale = await prisma.governmentReference.findMany({
    where: {
      mergedIntoId: null,
      OR: [{ fullTextAt: null }, { fullTextAt: { lt: EXTRACTION_FIXED_AT } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  for (const record of stale) {
    jobQueue.enqueue(JobType.REEXTRACT_REFERENCE_TEXT, { referenceId: record.id }, JobPriority.LOW);
  }

  return stale.length;
}

/** Job-queue entry point: finish the pull and build the brief inline. */
export async function processReferenceBrief(referenceId: string, force: boolean): Promise<void> {
  await ensureReferenceContent(referenceId, {
    force,
    deadlineMs: FETCH_TIMEOUT_MS * 2,
    generateBriefInline: true,
  });
}
