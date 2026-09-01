/**
 * WHERE A RECORD LIVES. ONE RULE, BOTH APPS.
 *
 * A law has a readable address — /bill/hr-10184-119, /executive-order/eo-14421,
 * /scotus/fuld-v-palestine-liberation-organization — and a permanent one,
 * /reference/<id>, which is what every link shared before the slugs existed
 * still uses. Both serve the page. The readable one is the address; it is what
 * a person can read back over the phone, and what a search engine is told is
 * canonical.
 *
 * THIS LIVES IN THE SHARED PACKAGE BECAUSE THE WEB AND THE PHONE MUST NOT
 * DISAGREE. They already had: the web linked to the readable address while the
 * phone's share sheet sent the raw id, so the same law reached one person as
 * "ayeandnay.com/scotus/monsanto-v-durnell" and another as
 * "ayeandnay.com/reference/cmth6ynso15gsmo01297ykf09". Two copies of a rule is
 * how that happens, so there is one copy and both import it.
 */

/** The server's word for what kind of record this is. */
export type ReferenceType = "bill" | "executive_order" | "scotus_case" | (string & {});

export interface AddressableRecord {
  id: string;
  slug?: string | null;
  /** The server's vocabulary: bill | executive_order | scotus_case. */
  referenceType?: ReferenceType | null;
  /** The feed card's vocabulary: legislative | executive | judicial. */
  branch?: string | null;
}

/**
 * Two vocabularies reach this for the same three things. Neither is wrong —
 * they belong to different layers — so both are accepted here rather than
 * translated at every call site.
 */
function kindOf(record: AddressableRecord): ReferenceType | null {
  if (record.referenceType) return record.referenceType;
  if (record.branch === "executive") return "executive_order";
  if (record.branch === "judicial") return "scotus_case";
  if (record.branch === "legislative") return "bill";
  return null;
}

/** The path this record is served at, readable when it can be. */
export function recordPath(record: AddressableRecord): string {
  // No slug yet — a record that arrived seconds ago, or one the backfill has
  // not reached. The id address is not pretty and it is not wrong.
  if (!record.slug) return `/reference/${record.id}`;

  const kind = kindOf(record);
  if (kind === "executive_order") return `/executive-order/${record.slug}`;
  if (kind === "scotus_case") return `/scotus/${record.slug}`;
  if (kind === "bill") return `/bill/${record.slug}`;
  return `/reference/${record.slug}`;
}
