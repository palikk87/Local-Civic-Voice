/**
 * The registry of every name a record has ever answered to.
 *
 * A master reference id is permanent in intent but not in fact. It gets
 * repaired when it was written wrong, replaced when two records merge, and
 * changed when the government renumbers a measure. Each of those rewrites a
 * name that is already out in the world — in a link somebody shared, a
 * bookmark, a client that cached it. The platform correcting itself must never
 * be the reason somebody's link stops working.
 *
 * ONE NAME MEANS ONE PIECE OF GOVERNMENT BUSINESS
 *
 * `ReferenceName.name` is unique across every record. That is not a
 * convenience; it is the invariant the whole master reference system rests on.
 * Two records claiming one name is a duplicate, and the constraint makes it
 * visible instead of letting a lookup quietly pick a winner. `claimName`
 * therefore never steals: if a name is already held, it says who holds it and
 * changes nothing.
 *
 * THE MIRROR
 *
 * `GovernmentReference.aliases` — a TEXT column holding a JSON array — is now
 * derived from this table, not the other way round. It is still written because
 * search does a LIKE against it and search has not been rebuilt yet. Every
 * function here that changes a name updates the mirror in the same transaction,
 * so there is one writer and no window where they disagree. When search is
 * rebuilt on this table, the column stops being written and the mirror goes
 * away.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

/**
 * Where a name came from. Not decoration: a rename nobody can explain is
 * indistinguishable from data loss, and this is the column that explains it.
 */
export const NameSource = {
  /** Minted when the record was created from an official source. */
  CREATED: "created",
  /** Recovered from the old `aliases` column when this table was introduced. */
  BACKFILLED: "backfilled",
  /** The record was stored under a mangled id and has been given its real one. */
  REPAIRED: "repaired",
  /** Inherited from a record that was folded into this one. */
  MERGED: "merged",
  /** The government renumbered the measure. */
  RENUMBERED: "renumbered",
  /** Added by hand through the admin surface. */
  MANUAL: "manual",
} as const;

export type NameSourceValue = (typeof NameSource)[keyof typeof NameSource];

/**
 * A Prisma client or an interactive transaction. Every function here takes one
 * so a caller can make a rename atomic with whatever else it is doing — a merge
 * moves names and votes in the same transaction or neither.
 */
export type Db = Prisma.TransactionClient | typeof prisma;

export type ClaimResult =
  | { ok: true; created: boolean }
  /** Somebody else already answers to this name. Nothing was changed. */
  | { ok: false; heldBy: { referenceId: string; isCurrent: boolean } };

/**
 * Rewrite the `aliases` mirror for one record from the registry.
 *
 * Former names only: the current name is on the record itself, and repeating it
 * in its own alias list is how a lookup ends up matching a record to itself.
 */
async function refreshMirror(db: Db, referenceId: string): Promise<void> {
  const former = await db.referenceName.findMany({
    where: { referenceId, isCurrent: false },
    select: { name: true },
    orderBy: { firstSeenAt: "asc" },
  });

  await db.governmentReference.update({
    where: { id: referenceId },
    data: { aliases: former.length > 0 ? JSON.stringify(former.map((n) => n.name)) : null },
  });
}

/**
 * Record that a reference answers to a name.
 *
 * Idempotent: claiming a name the record already holds succeeds and changes
 * nothing. Claiming a name another record holds fails and changes nothing — the
 * caller is being told it has found a duplicate, which is information worth
 * more than a silently overwritten row.
 */
export async function claimName(
  db: Db,
  referenceId: string,
  name: string,
  learnedFrom: NameSourceValue,
  options: { current?: boolean } = {},
): Promise<ClaimResult> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: true, created: false };

  const existing = await db.referenceName.findUnique({
    where: { name: trimmed },
    select: { referenceId: true, isCurrent: true },
  });

  if (existing) {
    if (existing.referenceId !== referenceId) {
      return { ok: false, heldBy: existing };
    }
    return { ok: true, created: false };
  }

  await db.referenceName.create({
    data: { name: trimmed, referenceId, isCurrent: options.current ?? false, learnedFrom },
  });

  if (!options.current) await refreshMirror(db, referenceId);
  return { ok: true, created: true };
}

/**
 * Change what a record is called, keeping the old name pointing at it.
 *
 * This is the only correct way to change a `masterReferenceId`. Writing the
 * column directly leaves every existing link pointing at a name nothing answers
 * to any more.
 */
export async function renameReference(
  db: Db,
  referenceId: string,
  newName: string,
  learnedFrom: NameSourceValue,
): Promise<ClaimResult> {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: true, created: false };

  const holder = await db.referenceName.findUnique({
    where: { name: trimmed },
    select: { referenceId: true, isCurrent: true },
  });

  if (holder && holder.referenceId !== referenceId) {
    return { ok: false, heldBy: holder };
  }

  const current = await db.governmentReference.findUnique({
    where: { id: referenceId },
    select: { masterReferenceId: true },
  });
  if (!current) throw new Error("Reference not found");
  if (current.masterReferenceId === trimmed) return { ok: true, created: false };

  // The name it was called until now becomes a name it still answers to.
  await db.referenceName.updateMany({
    where: { referenceId, isCurrent: true },
    data: { isCurrent: false },
  });
  await claimName(db, referenceId, current.masterReferenceId, learnedFrom);

  if (holder) {
    await db.referenceName.update({ where: { name: trimmed }, data: { isCurrent: true } });
  } else {
    await db.referenceName.create({
      data: { name: trimmed, referenceId, isCurrent: true, learnedFrom },
    });
  }

  await db.governmentReference.update({
    where: { id: referenceId },
    data: { masterReferenceId: trimmed },
  });

  await refreshMirror(db, referenceId);
  return { ok: true, created: !holder };
}

/**
 * Hand every name a record holds to another record.
 *
 * Called by a merge. The source's current name stops being current — the source
 * is a tombstone and is not called anything any more — but it keeps pointing at
 * the survivor, which is what stops links dying.
 */
export async function transferNames(
  db: Db,
  sourceId: string,
  targetId: string,
): Promise<string[]> {
  const moving = await db.referenceName.findMany({
    where: { referenceId: sourceId },
    select: { name: true },
  });

  await db.referenceName.updateMany({
    where: { referenceId: sourceId },
    data: { referenceId: targetId, isCurrent: false, learnedFrom: NameSource.MERGED },
  });

  await refreshMirror(db, targetId);
  return moving.map((n) => n.name);
}

/**
 * The record that answers to a name, in one indexed probe.
 *
 * Does not follow merge pointers — that is the resolver's job, and doing it in
 * two places is how the two disagree.
 */
export async function findByName(
  name: string,
  db: Db = prisma,
): Promise<{ referenceId: string; isCurrent: boolean } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  return db.referenceName.findUnique({
    where: { name: trimmed },
    select: { referenceId: true, isCurrent: true },
  });
}

/** What a record is called now, and everything it used to be called. */
export async function namesFor(
  referenceId: string,
  db: Db = prisma,
): Promise<{ current: string | null; former: string[] }> {
  const rows = await db.referenceName.findMany({
    where: { referenceId },
    select: { name: true, isCurrent: true },
    orderBy: { firstSeenAt: "asc" },
  });

  return {
    current: rows.find((r) => r.isCurrent)?.name ?? null,
    former: rows.filter((r) => !r.isCurrent).map((r) => r.name),
  };
}
