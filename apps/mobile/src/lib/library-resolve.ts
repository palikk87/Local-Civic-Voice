/**
 * Library search result → resolve payload.
 *
 * The Library searches the live official APIs, so a result is not yet a row in our
 * database and has no brief. Instead of writing a brief on the device (which can
 * only see the search blurb), we hand the document's IDENTITY to the server, which
 * finds or creates its master reference, pulls the ENTIRE official text, and writes
 * the brief there — the same pipeline the bill/order/case detail screens use.
 *
 * Everything below is read off the metadata both faucets already build in
 * government-api.ts. Nothing is invented here.
 */
import type { LibraryResolveRequest } from "@/lib/api/references";
import type { GovernmentSearchResult } from "@/lib/government-api";

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Federal Register results set metadata.eoNumber to "EO 14147" for real orders but
 * fall back to the document number for everything else — only the former is an
 * executive order number, so only that form is passed on.
 */
function executiveOrderNumber(value: unknown): string | undefined {
  const raw = str(value);
  const match = raw?.match(/^EO\s*(\d+)$/i);
  return match ? match[1] : undefined;
}

export function toResolveRequest(result: GovernmentSearchResult): LibraryResolveRequest {
  const meta = result.metadata ?? {};
  const base: LibraryResolveRequest = {
    branch: result.branch,
    title: result.title,
    sourceUrl: result.sourceUrl,
    summary: result.rawText?.slice(0, 500),
  };

  switch (result.branch) {
    case "legislative":
      return {
        ...base,
        congress: num(meta.congress),
        billType: str(meta.type),
        billNumber: str(meta.number),
        chamber: str(meta.chamber),
        latestAction: result.status,
      };
    case "executive":
      return {
        ...base,
        documentNumber: str(meta.documentNumber),
        eoNumber: executiveOrderNumber(meta.eoNumber),
      };
    case "judicial":
      return {
        ...base,
        docketNumber: str(meta.docketNumber),
        opinionId: num(meta.opinionId),
        // Which court issued it. The server refuses anything but the Supreme
        // Court: this platform carries its rulings, and a district court order
        // stored as one of them is a false record.
        courtId: str(meta.courtId),
      };
  }
}
