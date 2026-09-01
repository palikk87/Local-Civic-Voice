/**
 * WHERE A RECORD LIVES, IN ONE PLACE.
 *
 * Every law had one address — /reference/<cuid> — which matches no query
 * anybody types and tells somebody handed the link nothing at all. Records now
 * carry a readable slug (hr-10184-119, eo-14421,
 * fuld-v-palestine-liberation-organization), and this is the one function that
 * turns a record into a path.
 *
 * BOTH ADDRESSES KEEP WORKING. /reference/:id is what every link ever shared
 * uses, and it still serves the page — the branch URL is simply the canonical
 * one, which is what <PageMeta> tells a crawler. A redirect would have meant a
 * flash on every open and a lookup before we knew where to send anybody.
 */
export type RecordBranch = "bill" | "executive_order" | "scotus_case" | string;

export function recordPath(record: {
  id: string;
  slug?: string | null;
  /** The server's vocabulary: bill | executive_order | scotus_case. */
  referenceType?: RecordBranch | null;
  /** The feed card's vocabulary: legislative | executive | judicial. */
  branch?: string | null;
}): string {
  const { id, slug, branch } = record;
  // Two vocabularies reach this for the same three things. Neither is wrong;
  // they belong to different layers, so both are accepted here rather than
  // translated at every call site.
  const referenceType =
    record.referenceType ??
    (branch === "executive"
      ? "executive_order"
      : branch === "judicial"
        ? "scotus_case"
        : branch === "legislative"
          ? "bill"
          : null);

  // No slug yet — a record that arrived seconds ago, or one the backfill has
  // not reached. The cuid address is not pretty and it is not wrong.
  if (!slug) return `/reference/${id}`;

  if (referenceType === "executive_order") return `/executive-order/${slug}`;
  if (referenceType === "scotus_case") return `/scotus/${slug}`;
  if (referenceType === "bill") return `/bill/${slug}`;

  return `/reference/${slug}`;
}

/** The absolute form, for canonical links and share previews. */
export function recordUrl(record: Parameters<typeof recordPath>[0]): string {
  const origin =
    typeof window === "undefined" ? "https://ayeandnay.com" : window.location.origin;
  return `${origin}${recordPath(record)}`;
}
