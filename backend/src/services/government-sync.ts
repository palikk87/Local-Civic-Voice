/**
 * Government data sync — pulls fresh, real-world items into GovernmentReference:
 *   - Bills:            congress.gov recently-updated bills of the current congress
 *   - Executive orders: Federal Register, newest executive orders
 *   - SCOTUS cases:     CourtListener, newest Supreme Court opinions
 *
 * Runs at server start and once per day via the job queue (SYNC_GOVERNMENT_DATA).
 * Rows are upserted by masterReferenceId, so community votes, comments, and
 * citizen briefs on existing rows are never touched — only factual fields refresh.
 * The Discover page then serves "10 most popular per branch" from
 * GET /api/government-references/trending, which both faucets consume.
 */

import { prisma } from "../prisma";
import { ReferenceType, normalizeReferenceId } from "./deduplication-service";
import { billReferenceId } from "./master-reference-id";
import { NameSource, claimName, findByName as claimedBy } from "./reference-names";
// The one fingerprint for official text. A second implementation here would
// disagree with that one on every row and report the law as changed nightly.
import {
  hashText,
  htmlToText,
  sanitizeOfficialText,
  stripFederalRegisterFurniture,
} from "./reference-content";
import { notifyLawUpdate } from "./notification-service";
import { env } from "../env";

const SYNC_COUNT = 10;
const FETCH_TIMEOUT_MS = 20_000;

// Re-syncing more often than this is a no-op (guards against dev hot reloads).
const MIN_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastSuccessfulSyncAt = 0;

export interface GovernmentSyncResult {
  bills: number;
  executiveOrders: number;
  scotusCases: number;
  skipped: boolean;
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[GovSync] ${response.status} from ${url.split("?")[0]}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(`[GovSync] fetch failed for ${url.split("?")[0]}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Official text, cleaned the same way the content pipeline cleans it.
 *
 * This used to keep whatever came back verbatim, and what comes back from the
 * Federal Register's `.txt` URL is not text: it is an <html><head><title>
 * Federal Register, Volume 91 Issue 156</title> wrapper around a <pre> block.
 * Sync stored that as the full text of the executive order, so every brief for
 * an order was written from a page header — and because sync had already put
 * something in the column, the content pipeline saw text present and never
 * replaced it.
 *
 * Same two functions the reader-facing fetch uses, and the same floor: a
 * document under 200 characters is an error page, not a law.
 */
async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const raw = await response.text();
    const looksLikeHtml = /<\/?(html|body|div|p|pre)\b/i.test(raw.slice(0, 2_000));
    // Never truncate — official text is stored in its entirety.
    const text = sanitizeOfficialText(looksLikeHtml ? htmlToText(raw) : raw);
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

/** Congress numbers advance every two years; the 119th began in January 2025. */
function currentCongress(): number {
  return Math.floor((new Date().getFullYear() - 1789) / 2) + 1;
}

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ["healthcare", /health|medicare|medicaid|insurance|drug|prescription|hospital|medical/i],
  ["defense", /defense|military|armed forces|veterans?|national security|weapons?|army|navy/i],
  ["environment", /environment|climate|energy|clean|emissions?|conservation|wildlife|agricultur/i],
  ["education", /education|school|student|college|university|teacher/i],
  ["immigration", /immigra|border|visa|asylum|citizenship|refugee/i],
  ["technology", /technolog|artificial intelligence|cyber|internet|broadband|data privacy|quantum|semiconductor/i],
  ["housing", /housing|mortgage|rent|homeless/i],
  ["civil_rights", /civil rights|voting rights|discrimination|equality|free speech|first amendment/i],
  ["justice", /court|justice|crime|criminal|police|prison|judicial|election|campaign/i],
  ["economy", /econom|tax|trade|tariff|budget|small business|jobs?|labor|bank|fraud|fund/i],
];

export function categorize(title: string): string {
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(title)) return category;
  }
  return "economy";
}

export function billStatusFromAction(actionText: string | undefined): string {
  const text = (actionText ?? "").toLowerCase();
  if (/became public law|signed by president/.test(text)) return "passed";
  if (/passed|agreed to/.test(text)) return "passed";
  if (/committee|calendar/.test(text)) return "committee";
  return "proposed";
}

interface UpsertData {
  masterReferenceId: string;
  referenceType: string;
  title: string;
  shortTitle?: string;
  sourceUrl?: string;
  chamber?: string;
  congress?: number;
  status: string;
  category: string;
  description?: string;
  fullText?: string;
  signedDate?: Date;
  decidedDate?: Date;
}

/**
 * Insert new rows or refresh factual fields, never touching votes/briefs.
 *
 * The name goes into the registry in the same transaction as the row. A record
 * the registry does not know about is one no former-name lookup can ever reach,
 * and this is the path most records arrive by — so registering names only in
 * findOrCreateReference would have left the daily sync's records outside the
 * system that is supposed to guarantee their links never die.
 *
 * claimName is idempotent, so the refresh half of an upsert re-registers
 * nothing; and it never steals a name another record holds, so a sync cannot
 * quietly reassign one.
 */
async function upsertReference(data: UpsertData): Promise<void> {
  const { masterReferenceId, ...fields } = data;
  const notifyAfterCommit: Array<{ id: string; masterReferenceId: string; title: string }> = [];

  await prisma.$transaction(async (tx) => {
    // Which record does this name belong to? Usually the one called that, but a
    // name can also be one a record used to be called — after a repair, or a
    // merge. Either way that record IS this law, and refreshing it is right
    // where creating a second row named after it would be a split vote pool.
    const held = await claimedBy(masterReferenceId, tx);

    // Did the LAW change, or just the row?
    //
    // `updatedAt` moves every time somebody votes, so it cannot answer that.
    // Only three things count as the law itself moving: a new title, a new
    // status, or official text that no longer hashes the same. A refreshed
    // description or a re-fetched source URL is bookkeeping, and treating it as
    // a change would badge every post on the platform every night and pay to
    // rewrite every brief.
    const before = await tx.governmentReference.findUnique({
      where: held ? { id: held.referenceId } : { masterReferenceId },
      select: { id: true, title: true, status: true, fullTextHash: true, lawVersion: true },
    });

    const nextTextHash = fields.fullText ? hashText(fields.fullText) : null;
    const lawMoved =
      before !== null &&
      (before.title !== fields.title ||
        before.status !== fields.status ||
        (nextTextHash !== null && before.fullTextHash !== null && before.fullTextHash !== nextTextHash));

    const row = await tx.governmentReference.upsert({
      where: held ? { id: held.referenceId } : { masterReferenceId },
      create: {
        masterReferenceId,
        ...fields,
        ...(nextTextHash ? { fullTextHash: nextTextHash } : {}),
        // The tally starts at nothing, because nothing is what anybody has
        // said about it yet.
      },
      update: {
        title: fields.title,
        status: fields.status,
        ...(fields.shortTitle ? { shortTitle: fields.shortTitle } : {}),
        ...(fields.sourceUrl ? { sourceUrl: fields.sourceUrl } : {}),
        ...(fields.description ? { description: fields.description } : {}),
        ...(fields.fullText ? { fullText: fields.fullText } : {}),
        ...(nextTextHash ? { fullTextHash: nextTextHash } : {}),
        ...(fields.signedDate ? { signedDate: fields.signedDate } : {}),
        ...(fields.decidedDate ? { decidedDate: fields.decidedDate } : {}),
        ...(lawMoved
          ? { lawChangedAt: new Date(), lawVersion: { increment: 1 } }
          : {}),
      },
      select: { id: true },
    });

    if (lawMoved && before) {
      // Outside the transaction on purpose. Notifying is not part of writing the
      // record, and a notification failure must never roll back a law update —
      // the record being right matters more than the telling.
      notifyAfterCommit.push({
        id: row.id,
        masterReferenceId,
        title: fields.title,
      });

      console.log(
        `[GovSync] ${masterReferenceId} moved to version ${before.lawVersion + 1}: ` +
          [
            before.title !== fields.title ? "title" : null,
            before.status !== fields.status ? `status ${before.status} -> ${fields.status}` : null,
            nextTextHash && before.fullTextHash && before.fullTextHash !== nextTextHash
              ? "official text"
              : null,
          ]
            .filter(Boolean)
            .join(", "),
      );
    }

    const claimed = await claimName(tx, row.id, masterReferenceId, NameSource.CREATED, {
      current: true,
    });
    if (!claimed.ok) {
      console.warn(
        `[GovSync] "${masterReferenceId}" is already registered to another record — ` +
          `left alone; these two are a duplicate pair, not a rename`,
      );
    }
  });

  for (const moved of notifyAfterCommit) {
    const { notified } = await notifyLawUpdate(moved.id, moved.masterReferenceId, moved.title);
    if (notified > 0) {
      console.log(`[GovSync] told ${notified} person(s) that ${moved.masterReferenceId} changed`);
    }
  }
}

// ---------- Bills (congress.gov) ----------

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

async function syncBills(): Promise<number> {
  const apiKey = env.CONGRESS_API_KEY;
  if (!apiKey) {
    console.warn("[GovSync] CONGRESS_API_KEY not set — skipping bills");
    return 0;
  }
  const congress = currentCongress();
  // NOTE: the API needs a literal "+" in sort — URL-encoding it to %2B makes
  // congress.gov silently fall back to oldest-first order.
  const url = `https://api.congress.gov/v3/bill/${congress}?limit=${SYNC_COUNT * 2}&format=json&api_key=${apiKey}&sort=updateDate+desc`;
  const data = await fetchJson<CongressListResponse>(url);
  if (!data?.bills) return 0;

  let synced = 0;
  for (const bill of data.bills) {
    if (synced >= SYNC_COUNT) break;
    if (!bill.title || !bill.number || !bill.type) continue;
    const type = bill.type.toLowerCase();
    // Named from congress.gov's own three fields, which is the only place they
    // arrive already separated. A type congress.gov has never published yields
    // null, and the row is skipped rather than written under a guessed name —
    // an unfindable record is worse than a missing one.
    const masterReferenceId = billReferenceId({
      type,
      number: bill.number,
      congress: bill.congress ?? congress,
    });
    if (!masterReferenceId) {
      console.warn(`[GovSync] Skipping bill with unrecognised type "${bill.type}" (${bill.number})`);
      continue;
    }
    const chamberPath = type.startsWith("h") ? "house-bill" : "senate-bill";
    await upsertReference({
      masterReferenceId,
      referenceType: "bill",
      title: bill.title,
      status: billStatusFromAction(bill.latestAction?.text),
      category: categorize(bill.title),
      chamber: bill.originChamber?.toLowerCase() === "senate" ? "senate" : "house",
      congress: bill.congress ?? congress,
      sourceUrl: `https://www.congress.gov/bill/${bill.congress ?? congress}th-congress/${chamberPath}/${bill.number}`,
      description: bill.latestAction
        ? `${bill.type.toUpperCase()} ${bill.number} — ${bill.congress ?? congress}th Congress. Latest action (${bill.latestAction.actionDate}): ${bill.latestAction.text}`
        : undefined,
    });
    synced++;
  }
  return synced;
}

// ---------- Executive orders (Federal Register) ----------

interface FederalRegisterListResponse {
  results?: Array<{
    executive_order_number?: string | number | null;
    title: string;
    abstract: string | null;
    signing_date: string | null;
    publication_date: string | null;
    html_url: string;
    document_number: string;
    president?: { name?: string } | null;
    body_html_url?: string | null;
    raw_text_url?: string | null;
  }>;
}

async function syncExecutiveOrders(): Promise<number> {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("conditions[presidential_document_type]", "executive_order");
  url.searchParams.append("conditions[type][]", "PRESDOCU");
  url.searchParams.set("order", "newest");
  url.searchParams.set("per_page", String(SYNC_COUNT));
  for (const field of ["executive_order_number", "title", "abstract", "signing_date", "publication_date", "html_url", "document_number", "president", "body_html_url", "raw_text_url"]) {
    url.searchParams.append("fields[]", field);
  }
  const data = await fetchJson<FederalRegisterListResponse>(url.toString());
  if (!data?.results) return 0;

  let synced = 0;
  for (const doc of data.results) {
    if (!doc.title) continue;
    const eoNumber = doc.executive_order_number ? String(doc.executive_order_number).replace(/\D/g, "") : null;
    const masterReferenceId = eoNumber ? `eo-${eoNumber}` : `eo-${doc.document_number.toLowerCase()}`;

    const existing = await prisma.governmentReference.findUnique({
      where: { masterReferenceId },
      select: { id: true, fullText: true },
    });
    // Full text is a separate download per order — only fetch it once.
    //
    // body_html first. It is the order and nothing else; raw_text_url is the
    // page of the Federal Register the order was printed on, gazette furniture
    // and all. Whatever comes back has that furniture stripped either way.
    const textUrl = doc.body_html_url ?? doc.raw_text_url;
    const fetched = !existing?.fullText && textUrl ? await fetchText(textUrl) : null;
    const fullText = fetched ? stripFederalRegisterFurniture(fetched, eoNumber) : null;

    const presidentName = doc.president?.name;
    const descriptionParts = [
      doc.abstract,
      presidentName ? `Signed by President ${presidentName}${doc.signing_date ? ` on ${doc.signing_date}` : ""}.` : null,
    ].filter(Boolean);

    await upsertReference({
      masterReferenceId,
      referenceType: "executive_order",
      title: doc.title,
      status: "active",
      category: categorize(doc.title),
      sourceUrl: doc.html_url,
      description: descriptionParts.length > 0 ? descriptionParts.join(" ") : undefined,
      fullText: fullText ?? undefined,
      signedDate: doc.signing_date ? new Date(doc.signing_date) : doc.publication_date ? new Date(doc.publication_date) : undefined,
    });
    synced++;
  }
  return synced;
}

// ---------- SCOTUS cases (CourtListener) ----------

// CourtListener v4 search. Two shape changes from the retired v3 endpoint:
// the per-opinion `snippet` moved from the result into the nested `opinions[]`
// array, and `page_size` is ignored (fixed 20 per page, cursor-paginated via
// `next`). Roughly half of SCOTUS results are "Revisions:" housekeeping copies
// of a case we already have, so one page is not reliably SYNC_COUNT real cases.
interface CourtListenerSearchResponse {
  next?: string | null;
  results?: Array<{
    caseName?: string;
    docketNumber?: string;
    dateFiled?: string;
    dateArgued?: string | null;
    absolute_url: string;
    status?: string;
    opinions?: Array<{ snippet?: string | null }>;
  }>;
}

// Cap the cursor walk so a page full of skippable entries can't loop forever.
const COURTLISTENER_MAX_PAGES = 4;

async function syncScotusCases(): Promise<number> {
  const apiKey = env.COURTLISTENER_API_KEY;
  if (!apiKey) {
    console.warn("[GovSync] COURTLISTENER_API_KEY not set — skipping SCOTUS cases");
    return 0;
  }

  const firstPage = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  firstPage.searchParams.set("type", "o");
  firstPage.searchParams.set("court", "scotus");
  firstPage.searchParams.set("order_by", "dateFiled desc");

  let nextUrl: string | null = firstPage.toString();
  let synced = 0;
  const seen = new Set<string>();

  for (let page = 0; page < COURTLISTENER_MAX_PAGES && nextUrl && synced < SYNC_COUNT; page++) {
    const data: CourtListenerSearchResponse | null = await fetchJson<CourtListenerSearchResponse>(nextUrl, {
      Authorization: `Token ${apiKey}`,
    });
    if (!data?.results?.length) break;
    nextUrl = data.next ?? null;

    for (const opinion of data.results) {
      if (synced >= SYNC_COUNT) break;
      if (!opinion.caseName || !opinion.docketNumber) continue;
      // Skip housekeeping entries like "Trump v. ... Revisions: 7/01/26"
      if (/revisions?:/i.test(opinion.caseName)) continue;
      const masterReferenceId = normalizeReferenceId(ReferenceType.SCOTUS_CASE, opinion.docketNumber);
      if (seen.has(masterReferenceId)) continue;
      seen.add(masterReferenceId);

      const snippet = opinion.opinions
        ?.map((o) => o.snippet)
        .find((s): s is string => typeof s === "string" && s.trim().length > 0)
        ?.replace(/\s+/g, " ")
        .trim();
      await upsertReference({
        masterReferenceId,
        referenceType: "scotus_case",
        title: opinion.caseName,
        shortTitle: opinion.caseName.length > 200 ? `${opinion.caseName.slice(0, 197)}...` : opinion.caseName,
        status: "decided",
        category: categorize(opinion.caseName + " " + (snippet ?? "")),
        sourceUrl: `https://www.courtlistener.com${opinion.absolute_url}`,
        description: snippet ? (snippet.length > 500 ? `${snippet.slice(0, 497)}...` : snippet) : undefined,
        decidedDate: opinion.dateFiled ? new Date(opinion.dateFiled) : undefined,
      });
      synced++;
    }
  }
  return synced;
}

// ---------- Entry point ----------

export async function syncGovernmentData(trigger: string = "manual"): Promise<GovernmentSyncResult> {
  if (trigger !== "manual" && Date.now() - lastSuccessfulSyncAt < MIN_SYNC_INTERVAL_MS) {
    console.log("[GovSync] Skipping — last sync was under 6 hours ago");
    return { bills: 0, executiveOrders: 0, scotusCases: 0, skipped: true };
  }

  console.log(`[GovSync] Starting government data sync (trigger: ${trigger})`);
  const [bills, executiveOrders, scotusCases] = await Promise.all([
    syncBills(),
    syncExecutiveOrders(),
    syncScotusCases(),
  ]);

  if (bills + executiveOrders + scotusCases > 0) {
    lastSuccessfulSyncAt = Date.now();
  }
  console.log(`[GovSync] Done — bills: ${bills}, executive orders: ${executiveOrders}, SCOTUS cases: ${scotusCases}`);
  return { bills, executiveOrders, scotusCases, skipped: false };
}
