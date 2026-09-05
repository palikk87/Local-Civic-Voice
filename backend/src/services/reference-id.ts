/**
 * Canonical reference ids are stored lowercase and hyphenated ("hr-4836-119",
 * "eo-14147", "scotus-22-451") but people read and type them the way they are
 * printed: "H.R. 4836", "EO 14147", "No. 22-451".
 *
 * This module owns both directions of that translation so display and search
 * never disagree — the bug it fixes was a picker rendering "HR 4836" while only
 * matching "hr-4836", so typing back exactly what was on screen found nothing.
 */

/** Bill type prefixes as printed by Congress. */
const BILL_PREFIX_LABELS: Record<string, string> = {
  hr: "H.R.",
  s: "S.",
  hjres: "H.J.Res.",
  sjres: "S.J.Res.",
  hconres: "H.Con.Res.",
  sconres: "S.Con.Res.",
  hres: "H.Res.",
  sres: "S.Res.",
};

/**
 * The id as a person would read it. Falls back to the raw id uppercased so an
 * unrecognised format still shows something truthful rather than nothing.
 */
export function formatReferenceDisplayId(
  masterReferenceId: string | null | undefined,
  referenceType: string
): string {
  const raw = (masterReferenceId ?? "").trim();
  if (!raw) return "";

  if (referenceType === "bill") {
    // "hr-4836-119" → prefix "hr", number "4836", congress "119"
    const match = /^([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(raw);
    if (match?.[1] && match[2]) {
      const prefix = match[1].toLowerCase();
      const label = BILL_PREFIX_LABELS[prefix] ?? `${prefix.toUpperCase()}.`;
      return `${label} ${match[2]}`;
    }
  }

  if (referenceType === "executive_order") {
    /*
     * AN ORDER WAITING ON ITS NUMBER MUST NOT BE SHOWN ONE.
     *
     * An order read from whitehouse.gov the day it was signed is called
     * eo-2026-09-04*, and printing that as "EO 2026-09-04*" would put something
     * shaped exactly like an order number in front of a reader — on a platform
     * whose whole claim is that its records are the real ones. The Federal
     * Register assigns the number, and until it has, the true thing to say is
     * when the order was signed.
     *
     * The trailing "-2" on the second order of a day is ours, not the
     * government's, so it is shown as a plain count rather than as part of a
     * date.
     */
    const provisional = /^eo-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\*$/i.exec(raw);
    if (provisional?.[1]) {
      return provisional[2] ? `Signed ${provisional[1]} (${provisional[2]})` : `Signed ${provisional[1]}`;
    }

    // "eo-14147" → "EO 14147". Federal Register document numbers such as
    // "2026-08928" have no EO number, so they are shown as printed.
    const match = /^eo-?(.+)$/i.exec(raw);
    if (match?.[1]) return `EO ${match[1].toUpperCase()}`;
    return raw.toUpperCase();
  }

  if (referenceType === "scotus_case") {
    // "scotus-22-451" → "No. 22-451"; bare docket numbers keep their form.
    const docket = raw.replace(/^scotus-/i, "");
    return `No. ${docket.toUpperCase()}`;
  }

  return raw.toUpperCase();
}

/**
 * Candidate forms of a typed query to match against masterReferenceId, so
 * "H.R. 4836", "HR 4836", "hr4836" and "hr-4836" all reach "hr-4836-119".
 * Returns an empty array when the query has no id-like content.
 */
export function referenceIdSearchVariants(query: string): string[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];

  const variants = new Set<string>();

  // What the user typed, minus punctuation that never appears in stored ids.
  const hyphenated = raw.replace(/[^a-z0-9-]/g, "");
  if (hyphenated) variants.add(hyphenated);

  // Fully compact form: "h.r. 4836" → "hr4836"
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact) variants.add(compact);

  // Split a leading letter prefix from the digits that follow so the stored
  // hyphenated form is reachable: "hr4836" → "hr-4836" (and "hr-4836-" so the
  // congress suffix boundary is preferred over a longer bill number).
  const split = /^([a-z]+)(\d.*)$/.exec(compact);
  if (split?.[1] && split[2]) {
    variants.add(`${split[1]}-${split[2]}`);
    variants.add(`${split[1]}-${split[2]}-`);
    variants.add(split[2]);
  }

  // Two-digit docket forms ("22-451") are already stored as typed.
  return [...variants].filter((variant) => variant.length >= 2);
}
