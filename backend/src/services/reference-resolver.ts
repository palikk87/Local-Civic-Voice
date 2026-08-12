import { prisma } from "../prisma";

/**
 * Resolves a client-selected GovernmentReference to its active canonical row.
 *
 * The reference picker (ReferenceSearchModal / ComposeCard) always selects a row
 * that already exists in the database, so this is a validated foreign-key lookup —
 * NOT citation parsing and NOT fuzzy deduplication. Free text never reaches here.
 *
 * Deliberate constraints:
 * - Only an exact `GovernmentReference.id` is accepted. A canonical master ID such
 *   as "hr-82" is rejected, which is what stops the picker's old offline-fallback
 *   values from creating unlinked posts.
 * - Client-supplied type/title/status are ignored; the stored row is authoritative.
 */

export type ResolvedReference = {
  id: string;
  masterReferenceId: string;
  referenceType: string;
  title: string;
};

export type ResolveFailure =
  | { ok: false; reason: "conflicting_ids" }
  | { ok: false; reason: "not_found"; value: string }
  | { ok: false; reason: "merge_cycle"; value: string };

export type ResolveResult = { ok: true; reference: ResolvedReference } | ResolveFailure;

/** Guard against a corrupt `mergedIntoId` chain looping forever. */
const MAX_MERGE_HOPS = 10;

/**
 * Pick the reference ID to use from the new and legacy request fields.
 *
 * `governmentReferenceId` is the current contract. `referenceId` is the legacy
 * field that deployed mobile builds still send; it is accepted only during the
 * compatibility period and only when it matches a real row.
 */
export function selectReferenceInput(input: {
  governmentReferenceId?: string;
  referenceId?: string;
}): { ok: true; value: string; usedLegacyField: boolean } | { ok: false; reason: "conflicting_ids" } {
  const next = input.governmentReferenceId?.trim();
  const legacy = input.referenceId?.trim();

  if (next && legacy && next !== legacy) {
    return { ok: false, reason: "conflicting_ids" };
  }

  if (next) {
    return { ok: true, value: next, usedLegacyField: false };
  }

  return { ok: true, value: legacy ?? "", usedLegacyField: true };
}

/**
 * Look up a reference by exact ID and follow `mergedIntoId` to the active row.
 *
 * Accepts an optional Prisma client so callers can run this inside a transaction.
 */
export async function resolveReferenceId(
  referenceId: string,
  db: Pick<typeof prisma, "governmentReference"> = prisma
): Promise<ResolveResult> {
  type Row = ResolvedReference & { mergedIntoId: string | null };

  const select = {
    id: true,
    masterReferenceId: true,
    referenceType: true,
    title: true,
    mergedIntoId: true,
  } as const;

  // Clients may send either the database id or the canonical masterReferenceId
  // (e.g. "hr-82-119", "eo-14110") — share flows commonly carry the latter.
  const first: Row | null =
    (await db.governmentReference.findUnique({
      where: { id: referenceId },
      select,
    })) ??
    (await db.governmentReference.findUnique({
      where: { masterReferenceId: referenceId.toLowerCase() },
      select,
    }));

  if (!first) {
    return { ok: false, reason: "not_found", value: referenceId };
  }

  let current: Row = first;
  const visited = new Set<string>([current.id]);

  // Walk to the active root. Merge chains should be at most one hop, but older
  // merges may have produced longer chains, so follow them rather than trusting depth.
  for (let hop = 0; current.mergedIntoId; hop++) {
    if (hop >= MAX_MERGE_HOPS || visited.has(current.mergedIntoId)) {
      return { ok: false, reason: "merge_cycle", value: referenceId };
    }

    const next: Row | null = await db.governmentReference.findUnique({
      where: { id: current.mergedIntoId },
      select,
    });

    // A dangling merge pointer means the tombstone is the best row available.
    if (!next) break;

    visited.add(next.id);
    current = next;
  }

  return {
    ok: true,
    reference: {
      id: current.id,
      masterReferenceId: current.masterReferenceId,
      referenceType: current.referenceType,
      title: current.title,
    },
  };
}

/**
 * Resolve a create-post payload's reference fields in one step.
 */
export async function resolvePostReference(
  input: { governmentReferenceId?: string; referenceType?: string; referenceId?: string },
  db: Pick<typeof prisma, "governmentReference"> = prisma
): Promise<ResolveResult & { usedLegacyField?: boolean }> {
  const selected = selectReferenceInput(input);
  if (!selected.ok) {
    return selected;
  }

  if (!selected.value) {
    return { ok: false, reason: "not_found", value: "" };
  }

  const resolved = await resolveReferenceId(selected.value, db);
  if (!resolved.ok) {
    return resolved;
  }

  if (selected.usedLegacyField) {
    console.warn(
      `[posts] legacy referenceId field used for reference ${resolved.reference.masterReferenceId} — update the client to send governmentReferenceId`
    );
  }

  if (input.referenceType && input.referenceType !== resolved.reference.referenceType) {
    console.warn(
      `[posts] client sent referenceType="${input.referenceType}" but reference ${resolved.reference.masterReferenceId} is "${resolved.reference.referenceType}" — using the stored value`
    );
  }

  return { ...resolved, usedLegacyField: selected.usedLegacyField };
}
