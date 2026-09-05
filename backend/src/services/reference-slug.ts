/**
 * THE ADDRESS A PERSON COULD HAVE TYPED.
 *
 * Every record lived at /reference/<cuid>. That address matches no query
 * anybody has ever entered, and tells somebody handed the link nothing about
 * what is on the other end. This builds the readable one.
 *
 * IT IS MINTED WHERE RECORDS ARRIVE, not by a sweep. services/government-sync
 * is the single seam every government record comes through, so a bill that
 * lands at three in the morning has its address at three in the morning and is
 * in the sitemap without anybody touching anything. The records already held
 * are brought up to the same rule by backfillSlugs below — the same function,
 * applied to what came before.
 *
 * ONCE ASSIGNED IT NEVER CHANGES. A slug is a promise to everybody who has the
 * link. Re-deriving one because a title was corrected would break every share,
 * every bookmark and every result Google had already indexed.
 */
import { prisma } from "../prisma";
import { ReferenceKind, canonicalReferenceId } from "./master-reference-id";

/** Words that carry no search signal and only make an address longer. */
const NOISE = new Set([
  "the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "at", "by",
  "et", "al", "no", "inc", "llc", "ltd", "co",
]);

/**
 * Free text to the safe part of a URL: lowercase, hyphens, nothing else.
 *
 * Accents are folded rather than dropped, so a name is still recognisable.
 */
function slugify(text: string, maxWords = 8): string {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // An apostrophe joins a word, it does not separate one. Turned into a
    // space it leaves a stray letter behind — "america's" becomes
    // "america-s-" — which now matters for every executive order, since their
    // addresses are built from their titles.
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  // Noise words go, but never all of them — a title that is entirely noise
  // still needs an address.
  const kept = words.filter((w) => !NOISE.has(w));
  return (kept.length > 0 ? kept : words).slice(0, maxWords).join("-");
}

/**
 * The slug a record should have, before collisions are resolved.
 *
 * A BILL IS KNOWN BY ITS NUMBER. "H.R. 1" is what people say, write and search
 * for, so hr-1-119 is the address.
 *
 * AN EXECUTIVE ORDER IS NOT. Nobody has ever gone looking for "EO 14421"; they
 * go looking for the order about vaccines, or tariffs, or ranchers. And the
 * number is not even available when it matters most: an order arrives here the
 * day it is signed and the Federal Register does not assign a number for
 * another three to seven days, so a number-based address would either not
 * exist yet or be built on a guess that later turns out wrong. Built from the
 * title, the address is right the moment the order lands and never has to
 * change again — which is what lets the number be corrected freely.
 *
 * THE SUPREME COURT'S ids are docket numbers, so the case name is used and the
 * docket is kept only as a tiebreaker in `candidates` below.
 */
export function preferredSlug(reference: {
  referenceType: string;
  masterReferenceId: string;
  title: string | null;
}): string | null {
  const { referenceType, masterReferenceId, title } = reference;

  if (referenceType === "bill") {
    return canonicalReferenceId(ReferenceKind.BILL, masterReferenceId) || null;
  }
  if (referenceType === "executive_order") {
    // "Ending Birth Tourism" is what somebody searches for. "eo-14419" is
    // bookkeeping, and for the first few days of an order's life we do not
    // have it.
    const fromTitle = title ? slugify(title) : "";
    if (fromTitle) return fromTitle;
    return canonicalReferenceId(ReferenceKind.EXECUTIVE_ORDER, masterReferenceId) || null;
  }
  if (referenceType === "scotus_case") {
    // "Fuld v. Palestine Liberation Organization" is what somebody searches.
    // "24-20" is what the Court files it under, and is no use to anybody here.
    const fromTitle = title ? slugify(title) : "";
    if (fromTitle) return fromTitle;
    return slugify(masterReferenceId) || null;
  }

  return slugify(masterReferenceId) || null;
}

/**
 * The slugs to try, in order, until one is free.
 *
 * Two Supreme Court cases genuinely can share a name, and two bills cannot
 * share a master id — so the tiebreaker is the record's own id, which is
 * unique by construction. A number would be prettier and would also mean the
 * answer depended on the order rows were processed in.
 */
function candidates(reference: {
  referenceType: string;
  masterReferenceId: string;
  title: string | null;
}): string[] {
  const first = preferredSlug(reference);
  if (!first) return [];

  const docket = slugify(reference.masterReferenceId);
  const tries = [first];
  if (docket && docket !== first) tries.push(`${first}-${docket}`);
  return tries;
}

/**
 * Give one record its address, if it does not have one.
 *
 * Never throws and never overwrites: a record that already has a slug keeps
 * it, and a failure here must not take a government sync down with it. Returns
 * the slug the record now has, or null if one could not be built.
 */
export async function ensureSlug(referenceId: string): Promise<string | null> {
  try {
    const row = await prisma.governmentReference.findUnique({
      where: { id: referenceId },
      select: { id: true, slug: true, referenceType: true, masterReferenceId: true, title: true },
    });
    if (!row) return null;
    if (row.slug) return row.slug;

    for (const candidate of candidates(row)) {
      const taken = await prisma.governmentReference.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (taken && taken.id !== row.id) continue;

      await prisma.governmentReference.update({
        where: { id: row.id },
        data: { slug: candidate },
      });
      return candidate;
    }

    // Nothing free. The record keeps working on its cuid rather than being
    // given a guessed address that collides with somebody else's.
    return null;
  } catch (error) {
    console.error("[Slug] could not assign one for", referenceId, error);
    return null;
  }
}

/**
 * The records already held, brought up to the rule that governs new ones.
 *
 * Idempotent: a record with a slug is skipped, so this can be run as often as
 * anybody likes. Returns how many were given one.
 */
export async function backfillSlugs(batch = 500): Promise<number> {
  let assigned = 0;

  for (;;) {
    const missing = await prisma.governmentReference.findMany({
      where: { slug: null },
      select: { id: true },
      take: batch,
    });
    if (missing.length === 0) break;

    for (const row of missing) {
      if (await ensureSlug(row.id)) assigned += 1;
    }

    // Everything in this pass failed to get one, so another pass would do the
    // same thing forever.
    if (missing.length > 0 && assigned === 0) break;
    if (missing.length < batch) break;
  }

  return assigned;
}
