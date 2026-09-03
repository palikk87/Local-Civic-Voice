/**
 * Library search result → master reference row.
 *
 * The Library screen searches the live official APIs, so its results are not yet
 * rows in our database. A citizen brief is only trustworthy when it is written
 * from the ENTIRE official text, and that pull happens server-side against the
 * master reference. So before any brief exists, the document has to BE a master
 * reference: this module turns a search result's identity into the canonical
 * masterReferenceId, finds or creates that row, and hands the id back. The brief
 * then comes from the same pipeline that serves the bill/order/case detail
 * screens — one water source, no second brief writer.
 *
 * The identity fields come straight off the search result both faucets already
 * build (GovernmentSearchResult.metadata), so nothing new is invented client-side.
 */

import {
  ReferenceType,
  type ReferenceTypeValue,
  findOrCreateReference,
  normalizeReferenceId,
} from "./deduplication-service";
import { billStatusFromAction, categorize } from "./government-sync";
import { fillProvenanceForBill } from "./bill-provenance";

const FR_LOOKUP_TIMEOUT_MS = 6_000;

export type LibraryBranch = "legislative" | "executive" | "judicial";

export interface LibraryDocumentInput {
  branch: LibraryBranch;
  title: string;
  sourceUrl?: string;
  /** Search-result blurb — stored as the row's description, never as the brief. */
  summary?: string;
  /** Canonical id when the search endpoint already computed one (congress search does). */
  masterReferenceId?: string;
  // Legislative identity
  congress?: number;
  billType?: string;
  billNumber?: string;
  chamber?: string;
  latestAction?: string;
  // Executive identity
  documentNumber?: string;
  eoNumber?: string;
  // Judicial identity
  docketNumber?: string;
  opinionId?: number;
}

export type LibraryResolveResult =
  | {
      ok: true;
      id: string;
      masterReferenceId: string;
      referenceType: ReferenceTypeValue;
      created: boolean;
    }
  | { ok: false; reason: "unidentifiable" };

const BRANCH_TO_TYPE: Record<LibraryBranch, ReferenceTypeValue> = {
  legislative: ReferenceType.BILL,
  executive: ReferenceType.EXECUTIVE_ORDER,
  judicial: ReferenceType.SCOTUS_CASE,
};

/**
 * Federal Register search returns a document number, not an EO number. Ask the
 * Federal Register for the EO number so a library-opened order lands on the SAME
 * row (`eo-14147`) the daily sync creates, instead of a parallel duplicate.
 */
async function lookupExecutiveOrderNumber(documentNumber: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://www.federalregister.gov/api/v1/documents/${documentNumber}.json?fields[]=executive_order_number`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FR_LOOKUP_TIMEOUT_MS),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { executive_order_number?: number | string | null };
    const raw = data.executive_order_number;
    return raw ? String(raw) : null;
  } catch {
    return null;
  }
}

/** The Federal Register document number embedded in a document's public URL. */
function documentNumberFromUrl(sourceUrl: string | undefined): string | null {
  return sourceUrl?.match(/federalregister\.gov\/documents\/[\d/]+\/([\w-]+)/)?.[1] ?? null;
}

/**
 * Canonical id for the document, matching what the daily sync would produce so
 * both paths converge on one row per law.
 */
async function canonicalIdFor(input: LibraryDocumentInput): Promise<string | null> {
  const provided = input.masterReferenceId?.trim();

  switch (input.branch) {
    case "legislative": {
      if (provided) return normalizeReferenceId(ReferenceType.BILL, provided);
      const type = input.billType?.toLowerCase().replace(/[^a-z]/g, "");
      const number = input.billNumber?.toString().replace(/[^\d]/g, "");
      if (!type || !number || !input.congress) return null;
      return normalizeReferenceId(ReferenceType.BILL, `${type}-${number}-${input.congress}`);
    }

    case "executive": {
      if (input.eoNumber) {
        return normalizeReferenceId(ReferenceType.EXECUTIVE_ORDER, `eo-${input.eoNumber}`);
      }
      const documentNumber = input.documentNumber ?? documentNumberFromUrl(input.sourceUrl);
      if (!documentNumber) return provided ? provided.toLowerCase() : null;
      const eoNumber = await lookupExecutiveOrderNumber(documentNumber);
      if (eoNumber) {
        return normalizeReferenceId(ReferenceType.EXECUTIVE_ORDER, `eo-${eoNumber}`);
      }
      // A Federal Register document that is not an executive order (a rule or
      // notice). It still has official text, so it gets a row — namespaced by
      // document number so it can never collide with an EO id.
      return `fr-${documentNumber.toLowerCase()}`;
    }

    case "judicial": {
      const docket = input.docketNumber?.trim();
      if (docket) return normalizeReferenceId(ReferenceType.SCOTUS_CASE, docket);
      if (input.opinionId) return `cl-${input.opinionId}`;
      return provided ? provided.toLowerCase() : null;
    }
  }
}

/** Row state a freshly created reference starts in, per branch. */
function statusFor(input: LibraryDocumentInput): string {
  switch (input.branch) {
    case "legislative":
      return billStatusFromAction(input.latestAction);
    case "executive":
      return "active";
    case "judicial":
      return "decided";
  }
}

/**
 * Find or create the master reference for a library search result. Does NOT pull
 * text or write a brief — the caller triggers ensureReferenceContent, which owns
 * that work for every surface in the app.
 */
export async function resolveLibraryDocument(
  input: LibraryDocumentInput
): Promise<LibraryResolveResult> {
  const masterReferenceId = await canonicalIdFor(input);
  if (!masterReferenceId) return { ok: false, reason: "unidentifiable" };

  const referenceType = BRANCH_TO_TYPE[input.branch];
  const title = input.title.trim().slice(0, 500);
  const { reference, created } = await findOrCreateReference({
    masterReferenceId,
    referenceType,
    title,
    shortTitle: title.length > 200 ? `${title.slice(0, 197)}...` : title,
    ...(input.sourceUrl && /^https?:\/\//.test(input.sourceUrl) ? { sourceUrl: input.sourceUrl } : {}),
    ...(input.chamber ? { chamber: input.chamber.toLowerCase() } : {}),
    ...(input.congress ? { congress: input.congress } : {}),
    status: statusFor(input),
    category: categorize(`${title} ${input.summary ?? ""}`),
    ...(input.summary ? { description: input.summary.slice(0, 500) } : {}),
  });

  /*
   * WHO WROTE IT, ASKED FOR NOW RATHER THAN IN FOUR HOURS.
   *
   * A search result names the bill and nothing about the member behind it, so a
   * law arriving this way was created with no sponsor, no party, no state and no
   * introduced date. Those were filled by the Provenance sweep — which runs every
   * four hours.
   *
   * Measured on a real one. H.R. 5183 was found in the Library, pulled in, given
   * its official text and its brief, and shared to a timeline, all inside four
   * minutes; the page it produced carried no name and no face, and would not have
   * until the sweep's next turn. The moment somebody finds a law is the moment
   * they share it, so that window is the whole of the law's first impression.
   *
   * ONE CALL, THE SAME ONE THE SWEEP MAKES. Only for a bill, only when the record
   * is new, and awaited so the caller is handed a finished record rather than one
   * that fills itself in behind them. congress.gov refusing costs nothing: the
   * columns stay null, which renders as nothing rather than as a guess, and the
   * sweep still picks the bill up on its own schedule.
   */
  if (created && referenceType === ReferenceType.BILL) {
    try {
      await fillProvenanceForBill(reference.id, reference.masterReferenceId);
    } catch (error) {
      console.error(`[Library] could not fill provenance for ${reference.masterReferenceId}:`, error);
    }
  }

  return {
    ok: true,
    id: reference.id,
    masterReferenceId: reference.masterReferenceId,
    referenceType,
    created,
  };
}
