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
import { ensureSlug } from "./reference-slug";
import { cleanOpinionSnippet } from "./opinion-snippet";
import { SUPREME_COURT } from "./judicial-search";
import { fetchSlipOpinions, termOf } from "./scotus-slip-opinions";
import { notifyLawUpdate } from "./notification-service";
import { acceptOfficialText, officialSourceHeaders } from "./official-source";
import { congressGovKey, env } from "../env";

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
      headers: officialSourceHeaders({ Accept: "application/json", ...headers }),
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
    const response = await fetch(url, {
      // Identify ourselves. Unsigned requests from a datacenter IP on a
      // schedule are what an anti-bot service exists to stop, and the Federal
      // Register's API documentation asks callers to say who they are.
      headers: officialSourceHeaders({ Accept: "text/plain, text/html, */*" }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const raw = await response.text();
    const looksLikeHtml = /<\/?(html|body|div|p|pre)\b/i.test(raw.slice(0, 2_000));
    // Never truncate — official text is stored in its entirety.
    const text = sanitizeOfficialText(looksLikeHtml ? htmlToText(raw) : raw);
    // The old test was `length > 200`, which a captcha page passes comfortably.
    // See official-source.ts: a source that will not give us the document must
    // produce nothing, not a block page stored as the law.
    return acceptOfficialText(text, "GovSync");
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
  /**
   * From the bill LIST response, which carries latestAction and nothing else
   * about provenance. The introduced date and the sponsor need a detail call
   * each and are filled afterwards by services/bill-provenance.ts.
   */
  lastActionDate?: Date;
  lastActionText?: string;
  /**
   * WHO IS BEHIND THIS RECORD, for the branches that come with a name attached.
   *
   * A bill's sponsor arrives later, from a detail call per bill — see
   * bill-provenance.ts. An executive order and a Supreme Court opinion both
   * name their person in the LIST response, so they can be stored on the way
   * past: the Federal Register gives the President, CourtListener gives the
   * justice who wrote the majority.
   */
  sponsorName?: string;
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
  /*
   * EVERY RECORD THAT COMES THROUGH HERE GETS A READABLE ADDRESS.
   *
   * This is the single seam every government record arrives by, which is why
   * the address is minted here rather than by a sweep: a bill that lands at
   * three in the morning has /bill/hr-10184-119 at three in the morning, and
   * is in the sitemap as soon as it has anything worth reading on it.
   *
   * Collected and assigned after the transaction commits — a slug is not part
   * of writing the record, and a naming failure must never roll back a law
   * update.
   */
  const slugAfterCommit: string[] = [];

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
        ...(fields.lastActionDate ? { lastActionDate: fields.lastActionDate } : {}),
        ...(fields.lastActionText ? { lastActionText: fields.lastActionText } : {}),
        // The person behind it. Only ever written when the source named one,
        // so a sync that omits it never blanks a name already stored.
        ...(fields.sponsorName ? { sponsorName: fields.sponsorName } : {}),
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

    slugAfterCommit.push(row.id);

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

  for (const id of slugAfterCommit) {
    await ensureSlug(id);
  }

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
  const apiKey = congressGovKey();
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
      // Real, and available right here in the list response. It used to be
      // ref.createdAt on the client, which is when WE saw the bill.
      ...(bill.latestAction?.actionDate
        ? { lastActionDate: new Date(`${bill.latestAction.actionDate}T00:00:00Z`) }
        : {}),
      ...(bill.latestAction?.text ? { lastActionText: bill.latestAction.text } : {}),
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

/**
 * How many orders to ask for in one request. The Federal Register serves up to
 * 1,000 per page; 100 is a page size that is polite and still catches up fast.
 */
const EO_PAGE_SIZE = 100;

/**
 * Stop once this many consecutive orders are ones we already hold with text.
 *
 * The old sync took a fixed newest 10 and stopped. Since the newest ten barely
 * change between daily runs, it re-upserted the same ten rows forever: the
 * Federal Register publishes 1,556 executive orders and this platform would
 * hold about ten of them, permanently, with no way to ever catch up. Worse, any
 * outage longer than "ten orders' worth of time" silently lost whatever was
 * signed meanwhile — the gap never healed, because nothing ever looked back.
 *
 * Paging until it recognises what it is reading makes the sync self-healing: a
 * normal night stops after one page of familiar records, and a night following
 * a week of downtime keeps going until it has caught up.
 */
const EO_STOP_AFTER_KNOWN = 25;

/** A ceiling, so a bad answer from the source cannot walk the whole corpus. */
const EO_MAX_PAGES = 20;

/**
 * How many NEW orders one run will take. This is the important number.
 *
 * Without it, "page until you recognise what you are reading" means the first
 * run after this ships walks the entire Federal Register — 1,556 orders, each
 * with its own full-text download — in a single night, into a database shared
 * with another project, against a public server run for the public. Catching up
 * over a fortnight of ordinary nightly runs is not worse for anybody, and the
 * backfill script raises this deliberately when a person is watching.
 */
const EO_MAX_NEW_PER_RUN = 50;

interface ExecutiveOrderSyncOptions {
  /** Page until this many consecutive known orders. Raise it to backfill. */
  stopAfterKnown?: number;
  /** Hard ceiling on pages walked. */
  maxPages?: number;
  /** How many new orders to take before stopping. Raise it to backfill. */
  maxNew?: number;
  /** Pause between requests. These are public servers run for the public. */
  pauseMs?: number;
  /**
   * Only orders signed on or before this date.
   *
   * THE WHOLE ARCHIVE, WITHOUT WALKING IT TWICE. The forward sync starts at the
   * newest and pages until it recognises what it is reading, which is right for
   * catching up on a few days. It is the wrong shape for fetching 1,494 orders
   * going back to 1994: every run would re-walk everything already held before
   * reaching anything new, and the cost of a run would grow with the size of
   * the archive already collected.
   *
   * Anchoring on a date makes each run start exactly where the last one
   * stopped, with no state to keep and nothing to re-read. The anchor is
   * derived from the data — the oldest order held — so it is self-correcting:
   * interrupt it, restart it, or run it twice, and it resumes from whatever is
   * actually in the database rather than from a bookmark that could be wrong.
   */
  signedBefore?: Date;
}

/** What one pass over the archive did, and whether there is any more of it. */
export interface ExecutiveOrderSyncResult {
  synced: number;
  /**
   * True when the source returned nothing at all for this window — which,
   * walking backwards, means the beginning of the archive has been reached.
   */
  exhausted: boolean;
}

export async function syncExecutiveOrders(options: ExecutiveOrderSyncOptions = {}): Promise<number> {
  return (await syncExecutiveOrdersDetailed(options)).synced;
}

export async function syncExecutiveOrdersDetailed(
  options: ExecutiveOrderSyncOptions = {},
): Promise<ExecutiveOrderSyncResult> {
  const stopAfterKnown = options.stopAfterKnown ?? EO_STOP_AFTER_KNOWN;
  const maxPages = options.maxPages ?? EO_MAX_PAGES;
  const maxNew = options.maxNew ?? EO_MAX_NEW_PER_RUN;
  const pauseMs = options.pauseMs ?? 250;

  let synced = 0;
  let taken = 0;
  let consecutiveKnown = 0;
  /**
   * Whether the source had anything at all to say for this window. Only
   * meaningful walking backwards, where "nothing older exists" is the finish
   * line rather than a failure.
   */
  let sawAnyResult = false;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("conditions[presidential_document_type]", "executive_order");
    url.searchParams.append("conditions[type][]", "PRESDOCU");
    url.searchParams.set("order", "newest");
    url.searchParams.set("per_page", String(EO_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    if (options.signedBefore) {
      url.searchParams.set(
        "conditions[signing_date][lte]",
        options.signedBefore.toISOString().slice(0, 10),
      );
    }
    for (const field of ["executive_order_number", "title", "abstract", "signing_date", "publication_date", "html_url", "document_number", "president", "body_html_url", "raw_text_url"]) {
      url.searchParams.append("fields[]", field);
    }

    const data = await fetchJson<FederalRegisterListResponse>(url.toString());
    if (!data?.results || data.results.length === 0) break;
    sawAnyResult = true;

    for (const doc of data.results) {
      if (!doc.title) continue;
      const eoNumber = doc.executive_order_number ? String(doc.executive_order_number).replace(/\D/g, "") : null;
      const masterReferenceId = eoNumber ? `eo-${eoNumber}` : `eo-${doc.document_number.toLowerCase()}`;

      const existing = await prisma.governmentReference.findUnique({
        where: { masterReferenceId },
        select: { id: true, fullText: true },
      });

      // "Known" means we hold it AND we hold its text. A row whose text is
      // missing — never fetched, or cleared because a block page had been
      // stored in it — is not caught up, and must not count towards stopping.
      if (existing?.fullText) {
        consecutiveKnown++;
        if (consecutiveKnown >= stopAfterKnown) return { synced, exhausted: false };
      } else {
        consecutiveKnown = 0;
        // Only records we actually have to go and fetch count against the
        // budget. Re-reading ones we already hold is cheap.
        if (taken >= maxNew) {
          console.log(
            `[GovSync] Executive orders: took ${taken} this run and stopped. ` +
              `More remain; the next run picks up where this one left off.`,
          );
          return { synced, exhausted: false };
        }
        taken++;
      }

      // Full text is a separate download per order — only fetch it once.
      //
      // body_html first. It is the order and nothing else; raw_text_url is the
      // page of the Federal Register the order was printed on, gazette
      // furniture and all. Whatever comes back has that furniture stripped
      // either way, and is refused outright if it turns out to be a block page
      // rather than a law — see official-source.ts.
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
        // THE PRESIDENT WHO SIGNED IT, stored rather than only mentioned.
        //
        // This name was already fetched and spent on one sentence of the
        // description. Kept as a field, the record can carry a face the way a
        // bill carries its sponsor's — see services/reference-attribution.ts.
        sponsorName: presidentName ?? undefined,
        signedDate: doc.signing_date ? new Date(doc.signing_date) : doc.publication_date ? new Date(doc.publication_date) : undefined,
      });
      synced++;
    }

    if (data.results.length < EO_PAGE_SIZE) break;
    if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return { synced, exhausted: !sawAnyResult };
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
    /** The court that issued it. Read so a scoped request can be verified. */
    court_id?: string;
    /**
     * WHO WROTE THE MAJORITY OPINION, or "Per Curiam" when the Court issued it
     * as one body with no individual author. CourtListener has always returned
     * this; nothing read it. Verified live: "John G. Roberts", "Brett
     * Kavanaugh", "Per Curiam".
     */
    judge?: string | null;
    opinions?: Array<{ snippet?: string | null }>;
  }>;
}

// Cap the cursor walk so a page full of skippable entries can't loop forever.
const COURTLISTENER_MAX_PAGES = 4;

/**
 * WHAT THE COURT HAS PUBLISHED THAT WE DO NOT ALREADY HOLD.
 *
 * A KNOCK, NOT A HAUL. This used to re-read the ten most recent rulings from
 * CourtListener every single day, forever, whether or not anything had
 * happened. Measured from the Supreme Court Database, the Court decides 58-65
 * cases a year — the last five terms are 60, 65, 65, 58, 59 — so the daily haul
 * re-read the same ten cases about three hundred times a year to catch roughly
 * one new one a week, in bursts, mostly in June.
 *
 * The Court's own term table answers the actual question — "is there anything
 * here we have not got?" — in one request, and every case on it is a Supreme
 * Court case BY CONSTRUCTION. There is no court filter to get right and no
 * third party to verify.
 *
 * Returns null when the Court's list could not be read, so the caller can fall
 * back rather than conclude the Court has published nothing.
 */
async function syncFromTheCourtsOwnList(): Promise<number | null> {
  const listed = await fetchSlipOpinions(termOf(new Date()));
  if (!listed) return null;

  const ids = listed.map((opinion) => ({
    opinion,
    masterReferenceId: normalizeReferenceId(ReferenceType.SCOTUS_CASE, opinion.docket),
  }));

  const held = new Set(
    (
      await prisma.governmentReference.findMany({
        where: { masterReferenceId: { in: ids.map((entry) => entry.masterReferenceId) } },
        select: { masterReferenceId: true },
      })
    ).map((row) => row.masterReferenceId),
  );

  const missing = ids.filter((entry) => !held.has(entry.masterReferenceId));
  if (missing.length === 0) {
    console.log(
      `[GovSync] the Court lists ${listed.length} decision(s) this term and we hold every one`,
    );
    return 0;
  }

  let synced = 0;
  // Newest first, because that is what somebody is looking for today.
  for (const { opinion, masterReferenceId } of missing.slice(0, SYNC_COUNT)) {
    await upsertReference({
      masterReferenceId,
      referenceType: "scotus_case",
      title: opinion.caseName,
      shortTitle:
        opinion.caseName.length > 200 ? `${opinion.caseName.slice(0, 197)}...` : opinion.caseName,
      status: "decided",
      category: categorize(opinion.caseName),
      // THE COURT'S OWN PDF. Not a third party's copy of the opinion — the
      // document the Court published, on the Court's own server.
      sourceUrl: opinion.pdfUrl ?? `https://www.supremecourt.gov/opinions/slipopinion/${termOf(opinion.decidedDate)}`,
      decidedDate: opinion.decidedDate,
    });
    synced += 1;
    console.log(
      `[GovSync] the Court published ${opinion.docket} "${opinion.caseName.slice(0, 60)}" on ` +
        `${opinion.decidedDate.toISOString().slice(0, 10)}`,
    );
  }

  // The author, the precedential status and any date we already had wrong are
  // settled by services/scotus-court-facts, which reads the same table.
  return synced;
}

async function syncScotusCases(): Promise<number> {
  /*
   * THE COURT FIRST, ALWAYS.
   *
   * Khalid: "or maybe that can go thru the direct SCOTUS site" — and it is the
   * better signal of the two, measured side by side. Both are equally current,
   * but CourtListener carries re-posting noise the Court's list does not:
   *
   *   Court's site   8/31/26  26A203  National Park Service v. National Trust
   *   CourtListener  2026-08-31  26A203  National Park Service v. National Trust
   *                  2026-06-30  25-365  Trump v. Barbara Revisions: 7/01/26  <- noise
   *
   * The Court cannot lag its own opinions, and every case on its list is a
   * Supreme Court case with no filter to get wrong.
   */
  const fromTheCourt = await syncFromTheCourtsOwnList();
  if (fromTheCourt !== null) return fromTheCourt;

  console.warn(
    "[GovSync] the Court's slip opinion table could not be read — falling back to CourtListener",
  );

  const apiKey = env.COURTLISTENER_API_KEY;
  if (!apiKey) {
    console.warn("[GovSync] COURTLISTENER_API_KEY not set — skipping SCOTUS cases");
    return 0;
  }

  const firstPage = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  firstPage.searchParams.set("type", "o");
  firstPage.searchParams.set("court", SUPREME_COURT);
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
      /*
       * THE SCOPE, VERIFIED RATHER THAN ASSUMED.
       *
       * The request above asks for the Supreme Court and always has, so this
       * has never had anything to reject. It is here because the Library's
       * search made exactly the opposite assumption — that asking politely was
       * the same as being answered correctly — and a Maryland magistrate
       * judge's order was published as a Supreme Court ruling. A stored record
       * is a claim about which court decided something; it should not rest on
       * a query parameter nobody checks.
       *
       * A result that does not say which court is kept: the request asked for
       * one, and discarding an answer for being quiet would stop the sync.
       */
      if (opinion.court_id && opinion.court_id.trim().toLowerCase() !== SUPREME_COURT) {
        console.warn(
          `[GovSync] skipped "${opinion.caseName.slice(0, 60)}" — court "${opinion.court_id}" is not the Supreme Court`,
        );
        continue;
      }
      // Skip housekeeping entries like "Trump v. ... Revisions: 7/01/26"
      if (/revisions?:/i.test(opinion.caseName)) continue;
      const masterReferenceId = normalizeReferenceId(ReferenceType.SCOTUS_CASE, opinion.docketNumber);
      if (seen.has(masterReferenceId)) continue;
      seen.add(masterReferenceId);

      /*
       * A ruling is listed here before its text has been fetched, so the
       * snippet is all there is at this moment — and CourtListener's snippet is
       * the opening characters of the opinion document, which on a slip opinion
       * is the Reporter of Decisions' standard notice. That block is identical
       * on every ruling the Court publishes, and storing it gave all seventeen
       * Supreme Court records one identical description, on their pages as well
       * as in their previews and search results.
       *
       * So the snippet is kept only when it says something. When it does not,
       * nothing is stored and the description fills itself in from the real
       * syllabus once the text arrives — see services/reference-content.ts.
       */
      const snippet = cleanOpinionSnippet(
        opinion.opinions
          ?.map((o) => o.snippet)
          .find((s): s is string => typeof s === "string" && s.trim().length > 0),
      );
      await upsertReference({
        masterReferenceId,
        referenceType: "scotus_case",
        title: opinion.caseName,
        shortTitle: opinion.caseName.length > 200 ? `${opinion.caseName.slice(0, 197)}...` : opinion.caseName,
        status: "decided",
        category: categorize(opinion.caseName + " " + (snippet ?? "")),
        sourceUrl: `https://www.courtlistener.com${opinion.absolute_url}`,
        description: snippet,
        // WHO WROTE IT. CourtListener has always sent this and nothing read it.
        // "Per Curiam" is left to reference-attribution.ts to reject: it is the
        // Court speaking as one body, not a person, and attributing it to
        // somebody would invent a fact about who decided a case.
        sponsorName: opinion.judge?.trim() || undefined,
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

/**
 * FILL IN WHO SIGNED THE ORDERS ALREADY HELD.
 *
 * THE HOLE THIS CLOSES. The signer's name was added to the executive-order
 * sync, but 1,532 orders were already in the archive by then and the sync never
 * revisits a record it has: the forward pass covers what is new, the archive
 * sweep walks backwards from the OLDEST order held. Nothing was ever going to
 * come back for the middle. Measured against production: 58 of 60 orders had no
 * signer stored, so the law page showed no "Signed by" line and there was no
 * name to look a portrait up with.
 *
 * WHY THIS IS A SWEEP WHEN PORTRAITS ARE NOT. Khalid: "1500 EO orders are easy
 * to download... thousands and thousands of SCOTUS ruling or bills and
 * legislation on the other hand is a different story." This is the cheap case.
 * The Federal Register hands back the president alongside 100 documents per
 * request, so the whole archive is about sixteen requests — and once every
 * order has a name this does nothing at all, forever.
 *
 * NOTHING IS INFERRED. The name comes from the same government source as the
 * order itself. Deriving a president from a signing date would be a guess
 * dressed as a fact, and a wrong name on a law is worse than no name.
 */
export async function fillExecutiveOrderSigners(maxPages = 20): Promise<{
  asked: number;
  named: number;
}> {
  const missing = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", sponsorName: null, mergedIntoId: null },
  });
  // Already complete. This is the state it stays in.
  if (missing === 0) return { asked: 0, named: 0 };

  /** Signer name to the source URLs of every order they signed. */
  const byPresident = new Map<string, string[]>();
  let asked = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
    url.searchParams.set("conditions[presidential_document_type]", "executive_order");
    url.searchParams.append("conditions[type][]", "PRESDOCU");
    url.searchParams.set("order", "newest");
    url.searchParams.set("per_page", String(EO_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    // Two fields only. The text and the abstract are already stored; this is
    // the cheapest request that answers the one question left.
    for (const field of ["html_url", "president"]) {
      url.searchParams.append("fields[]", field);
    }

    const data = await fetchJson<FederalRegisterListResponse>(url.toString());
    if (!data?.results || data.results.length === 0) break;
    asked += data.results.length;

    for (const doc of data.results) {
      const name = doc.president?.name?.trim();
      if (!name || !doc.html_url) continue;
      const urls = byPresident.get(name) ?? [];
      urls.push(doc.html_url);
      byPresident.set(name, urls);
    }
  }

  // One write per president, not per order — there are about eight of them
  // across the whole archive.
  let named = 0;
  for (const [name, urls] of byPresident) {
    const written = await prisma.governmentReference.updateMany({
      where: {
        referenceType: "executive_order",
        sourceUrl: { in: urls },
        sponsorName: null,
        mergedIntoId: null,
      },
      data: { sponsorName: name },
    });
    named += written.count;
  }

  console.log(
    `[GovSync] Executive order signers: ${missing} were missing one, ` +
      `${asked} documents read, ${named} given a name`,
  );
  return { asked, named };
}
