import { prisma } from "../prisma";
import { parseBrief } from "./citizen-brief";
import { computeWeightedTally } from "./delegation-service";
import { canonicalReferenceId } from "./master-reference-id";
import { NameSource, claimName, findByName, namesFor, transferNames } from "./reference-names";


/**
 * Valid reference types for government references
 */
export const ReferenceType = {
  BILL: "bill",
  EXECUTIVE_ORDER: "executive_order",
  SCOTUS_CASE: "scotus_case",
} as const;

export type ReferenceTypeValue = (typeof ReferenceType)[keyof typeof ReferenceType];

/**
 * Every name a record has ever answered to, read out of the `aliases` column.
 *
 * The column is TEXT holding a JSON array, and rows predating that convention
 * hold other things. Unreadable content is an empty list rather than a throw:
 * a record with a corrupt alias blob is a record with no former names, which is
 * true and recoverable, whereas a merge that dies on one is neither.
 */
export function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Result of a duplicate search
 */
export interface DuplicateSearchResult {
  id: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  matchType: "exact_id" | "alias" | "fuzzy_title";
  similarity?: number;
}

/**
 * Canonical form of a reference id.
 *
 * Kept as a name because a dozen call sites use it, but it holds no opinion of
 * its own any more — naming lives in master-reference-id.ts, which is the only
 * module allowed to decide how a law is spelled. The version that used to live
 * here matched bill prefixes with a leftmost-first alternation and mangled four
 * of the eight measure types; that is the whole reason the naming rules were
 * pulled out into one place with a round-trip test around them.
 */
export function normalizeReferenceId(type: ReferenceTypeValue, id: string): string {
  return canonicalReferenceId(type, id);
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a value between 0 (completely different) and 1 (identical)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Create matrix with explicit initialization
  const rows = s1.length + 1;
  const cols = s2.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0) as number[]);

  // Initialize first column
  for (let i = 0; i <= s1.length; i++) {
    matrix[i]![0] = i;
  }
  // Initialize first row
  for (let j = 0; j <= s2.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      const deletion = (matrix[i - 1]?.[j] ?? 0) + 1;
      const insertion = (matrix[i]?.[j - 1] ?? 0) + 1;
      const substitution = (matrix[i - 1]?.[j - 1] ?? 0) + cost;
      matrix[i]![j] = Math.min(deletion, insertion, substitution);
    }
  }

  const distance = matrix[s1.length]?.[s2.length] ?? 0;
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

/**
 * Normalize a title for comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // Remove punctuation
    .replace(/\s+/g, " ")    // Normalize whitespace
    .trim();
}

/**
 * Find potential duplicate references
 * Searches by:
 * 1. Exact master reference ID match
 * 2. Alias match
 * 3. Fuzzy title match (optional, controlled by threshold)
 */
export async function findDuplicates(
  type: ReferenceTypeValue,
  options: {
    masterReferenceId?: string;
    title?: string;
    aliases?: string[];
    fuzzyThreshold?: number; // 0-1, default 0.85
  }
): Promise<DuplicateSearchResult[]> {
  const results: DuplicateSearchResult[] = [];
  const { masterReferenceId, title, aliases = [], fuzzyThreshold = 0.85 } = options;

  // 1. Check exact master reference ID match
  if (masterReferenceId) {
    const normalizedId = normalizeReferenceId(type, masterReferenceId);
    const exactMatch = await prisma.governmentReference.findUnique({
      where: { masterReferenceId: normalizedId },
      select: {
        id: true,
        masterReferenceId: true,
        title: true,
        referenceType: true,
        mergedIntoId: true,
      },
    });

    if (exactMatch) {
      // If this reference was merged, return the target instead
      if (exactMatch.mergedIntoId) {
        const mergedTarget = await prisma.governmentReference.findUnique({
          where: { id: exactMatch.mergedIntoId },
          select: {
            id: true,
            masterReferenceId: true,
            title: true,
            referenceType: true,
          },
        });
        if (mergedTarget) {
          results.push({
            ...mergedTarget,
            matchType: "exact_id",
          });
        }
      } else {
        results.push({
          id: exactMatch.id,
          masterReferenceId: exactMatch.masterReferenceId,
          title: exactMatch.title,
          referenceType: exactMatch.referenceType,
          matchType: "exact_id",
        });
      }
      return results; // Exact match found, no need to continue
    }
  }

  // 2. Check alias matches
  const allSearchTerms = [
    ...(masterReferenceId ? [normalizeReferenceId(type, masterReferenceId)] : []),
    ...aliases.map(a => normalizeReferenceId(type, a)),
  ];

  if (allSearchTerms.length > 0) {
    // Find references where aliases JSON contains any of our search terms
    const candidates = await prisma.governmentReference.findMany({
      where: {
        referenceType: type,
        mergedIntoId: null, // Don't return merged references
      },
      select: {
        id: true,
        masterReferenceId: true,
        title: true,
        referenceType: true,
        aliases: true,
      },
    });

    for (const candidate of candidates) {
      const names = parseAliases(candidate.aliases).map((a) => normalizeReferenceId(type, a));

      for (const searchTerm of allSearchTerms) {
        if (names.includes(searchTerm) || candidate.masterReferenceId === searchTerm) {
          // Avoid duplicates
          if (!results.some((r) => r.id === candidate.id)) {
            results.push({
              id: candidate.id,
              masterReferenceId: candidate.masterReferenceId,
              title: candidate.title,
              referenceType: candidate.referenceType,
              matchType: "alias",
            });
          }
          break;
        }
      }
    }
  }

  // 3. Fuzzy title match
  if (title && results.length === 0) {
    const normalizedSearchTitle = normalizeTitle(title);

    // Get all references of this type for fuzzy matching
    const candidates = await prisma.governmentReference.findMany({
      where: {
        referenceType: type,
        mergedIntoId: null,
      },
      select: {
        id: true,
        masterReferenceId: true,
        title: true,
        referenceType: true,
      },
    });

    for (const candidate of candidates) {
      const normalizedCandidateTitle = normalizeTitle(candidate.title);
      const similarity = calculateSimilarity(normalizedSearchTitle, normalizedCandidateTitle);

      if (similarity >= fuzzyThreshold) {
        results.push({
          id: candidate.id,
          masterReferenceId: candidate.masterReferenceId,
          title: candidate.title,
          referenceType: candidate.referenceType,
          matchType: "fuzzy_title",
          similarity,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  }

  return results;
}

/**
 * Find or create a government reference
 * This is the main deduplication entry point - it will:
 * 1. Try to find an existing reference with matching ID/aliases/title
 * 2. If found, return the existing reference
 * 3. If not found, create a new reference
 */
export async function findOrCreateReference(
  data: {
    masterReferenceId: string;
    referenceType: ReferenceTypeValue;
    title: string;
    shortTitle?: string;
    sourceUrl?: string;
    chamber?: string;
    congress?: number;
    status: string;
    category?: string;
    description?: string;
    fullText?: string;
    signedDate?: Date;
    decidedDate?: Date;
    aliases?: string[];
  }
): Promise<{ reference: { id: string; masterReferenceId: string; title: string }; created: boolean }> {
  const normalizedId = normalizeReferenceId(data.referenceType, data.masterReferenceId);

  // Check for duplicates
  const duplicates = await findDuplicates(data.referenceType, {
    masterReferenceId: normalizedId,
    title: data.title,
    aliases: data.aliases,
  });

  if (duplicates.length > 0) {
    // Return the best match (first one)
    const existing = duplicates[0]!;
    return {
      reference: {
        id: existing.id,
        masterReferenceId: existing.masterReferenceId,
        title: existing.title,
      },
      created: false,
    };
  }

  // One more check before creating anything: does some record already answer to
  // this name? findDuplicates asks the `aliases` mirror; this asks the registry,
  // which is the authority and which holds names the mirror never had. A name
  // held by another record does not mean "close enough to merge" — it means
  // this IS that record, and creating a second one would be the exact
  // duplication the master reference system exists to prevent.
  const held = await findByName(normalizedId);
  if (held) {
    const owner = await prisma.governmentReference.findUnique({
      where: { id: held.referenceId },
      select: { id: true, masterReferenceId: true, title: true },
    });
    if (owner) return { reference: owner, created: false };
  }

  // Create the record and register its name in the same transaction, so a
  // record can never exist that the registry does not know about. Anything
  // created outside that registration is a record no former-name lookup can
  // ever reach.
  const reference = await prisma.$transaction(async (tx) => {
    const created = await tx.governmentReference.create({
      data: {
        masterReferenceId: normalizedId,
        referenceType: data.referenceType,
        title: data.title,
        shortTitle: data.shortTitle,
        sourceUrl: data.sourceUrl,
        chamber: data.chamber,
        congress: data.congress,
        status: data.status,
        category: data.category,
        description: data.description,
        fullText: data.fullText,
        signedDate: data.signedDate,
        decidedDate: data.decidedDate,
        aliases: data.aliases ? JSON.stringify(data.aliases) : null,
        // No placeholder tally. A new record starts at nothing, because
        // nothing is what anybody has said about it yet.
      },
      select: {
        id: true,
        masterReferenceId: true,
        title: true,
      },
    });

    await claimName(tx, created.id, normalizedId, NameSource.CREATED, { current: true });
    for (const alias of data.aliases ?? []) {
      // A name another record already holds is left where it is. Two records
      // answering to one name is the duplicate this system exists to prevent,
      // and quietly reassigning it would hide exactly that.
      await claimName(tx, created.id, normalizeReferenceId(data.referenceType, alias), NameSource.CREATED);
    }

    return created;
  });

  return {
    reference,
    created: true,
  };
}

/**
 * The shape of a completed merge, reported rather than summarised.
 *
 * A merge is the one operation that rewrites who owns what. `success: true`
 * with no detail is not an answer anybody can check, and the previous version
 * of this function returned exactly that while quietly skewing the counters.
 */
export interface MergeReport {
  target: { id: string; masterReferenceId: string; title: string };
  source: { id: string; masterReferenceId: string };
  postsMoved: number;
  votesMoved: number;
  votesSuperseded: number;
  chainsFlattened: number;
  namesKept: string[];
  brief: "target kept its own" | "adopted from source" | "neither had one";
  officialText: "target kept its own" | "adopted from source" | "neither had one";
  tally: { support: number; oppose: number };
}

/**
 * Fold one record into another.
 *
 * This is what makes the Public Pulse a single number. Congress files the same
 * law twice — a House bill and its identical Senate companion — and until they
 * are joined, the country's opinion on that law is split across two counts and
 * neither is true.
 *
 * WHAT MOVES AND WHAT DOES NOT
 *
 * Votes move. A vote is a position on the government's business, not on a
 * particular filing of it, so every vote from both records ends up in one pool.
 * That is the Public Pulse.
 *
 * Speech does not merge. Posts move to point at the surviving record, because
 * they must keep showing a law that exists — but they are never rewritten,
 * combined, or reattributed. Comments and shares stay in the thread they were
 * written in, under the post they belong to. Somebody's words are theirs.
 *
 * WHEN ONE PERSON VOTED ON BOTH
 *
 * They stated a position twice on the same business. The later one stands. Not
 * the survivor's by default — that would be an accident of which record an
 * admin happened to type first — and not both, because one person is one voice.
 * If they said support in March and oppose in July, they oppose it.
 *
 * WHY THE TALLY IS RECOMPUTED RATHER THAN ADDED UP
 *
 * The old implementation read both records' counters before moving anything and
 * then incremented the survivor by the source's numbers. Every vote it went on
 * to discard as a duplicate was still counted, so a merge inflated the pulse by
 * exactly the number of people who cared enough to vote on both. It also used a
 * snapshot taken before the votes moved. Counting the votes that actually exist
 * afterwards cannot drift.
 *
 * SEED LAYERS ARE NOT ADDED TOGETHER
 *
 * Seed votes are a per-record display placeholder so a brand-new card does not
 * read 0–0. They are not support anybody expressed, so they are not a quantity
 * that can be transferred or accumulated: summing two of them would manufacture
 * thousands of new fake votes out of a bookkeeping event. The survivor keeps its
 * own seed layer and the source's is dropped. Clearing seeds entirely is still
 * one admin action away, and after that this line does nothing at all.
 *
 * ATOMIC
 *
 * Everything happens in one transaction. The previous version moved votes in a
 * loop of individual queries outside the transaction that marked the source
 * merged, so a process that died halfway left votes on a record nothing pointed
 * at any more.
 */
export async function mergeReferences(sourceId: string, targetId: string): Promise<MergeReport> {
  if (sourceId === targetId) {
    throw new Error("Cannot merge a reference into itself");
  }

  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.governmentReference.findUnique({ where: { id: sourceId } }),
      tx.governmentReference.findUnique({ where: { id: targetId } }),
    ]);

    if (!source) throw new Error("Source reference not found");
    if (!target) throw new Error("Target reference not found");
    if (source.mergedIntoId) throw new Error("Source reference has already been merged");
    if (target.mergedIntoId) {
      throw new Error("Target reference has been merged into another reference");
    }
    if (source.referenceType !== target.referenceType) {
      // A bill is not an executive order. Nothing in the platform should ever
      // ask for this, and honouring it would produce a record that is one type
      // on paper and another in substance.
      throw new Error(
        `Cannot merge a ${source.referenceType} into a ${target.referenceType}`,
      );
    }

    // --- Votes -------------------------------------------------------------
    //
    // Written as set operations rather than a loop over rows: a loop is one
    // round trip per vote, and on a record with real traffic that is the
    // difference between a merge and a timeout.

    // Someone voted on both, and their vote on the source is the later one:
    // their position on the survivor becomes the one they last stated.
    const votesSuperseded = await tx.$executeRaw`
      UPDATE "GovernmentReferenceVote" AS t
         SET "position" = s."position",
             "updatedAt" = s."updatedAt"
        FROM "GovernmentReferenceVote" AS s
       WHERE t."governmentReferenceId" = ${targetId}
         AND s."governmentReferenceId" = ${sourceId}
         AND s."userId" = t."userId"
         AND s."updatedAt" > t."updatedAt"
    `;

    // Their duplicate on the source is then spent, whichever way it went.
    await tx.$executeRaw`
      DELETE FROM "GovernmentReferenceVote" AS s
       WHERE s."governmentReferenceId" = ${sourceId}
         AND EXISTS (
           SELECT 1 FROM "GovernmentReferenceVote" AS t
            WHERE t."governmentReferenceId" = ${targetId}
              AND t."userId" = s."userId"
         )
    `;

    // Everyone who voted only on the source now counts toward the survivor.
    const votesMoved = await tx.$executeRaw`
      UPDATE "GovernmentReferenceVote"
         SET "governmentReferenceId" = ${targetId}
       WHERE "governmentReferenceId" = ${sourceId}
    `;

    // --- Posts -------------------------------------------------------------
    //
    // `referenceId` and `referenceTitle` are legacy denormalised copies that
    // older clients still read. The id has to follow the post to the survivor
    // or it points at a tombstone; the title is left alone deliberately —
    // rewriting it would edit somebody's post, and the badge that tells a
    // reader the law has moved on is a separate piece of work.
    const posts = await tx.post.updateMany({
      where: { governmentReferenceId: sourceId },
      data: { governmentReferenceId: targetId, referenceId: targetId },
    });

    // --- Earlier merges ----------------------------------------------------
    //
    // If something was already merged into the source, it now points at the
    // survivor directly. Resolution follows these chains, so leaving them
    // nested still works — but every hop is a query, and a chain that only
    // grows eventually hits the cycle guard and starts failing.
    const chains = await tx.governmentReference.updateMany({
      where: { mergedIntoId: sourceId },
      data: { mergedIntoId: targetId },
    });

    // --- Names -------------------------------------------------------------
    //
    // The survivor answers to everything either record ever answered to, so no
    // link that was shared under an old name dies. The registry is the
    // authority; `aliases` on the row is a mirror it rewrites.
    await transferNames(tx, sourceId, targetId);
    const namesKept = (
      await tx.referenceName.findMany({
        where: { referenceId: targetId, isCurrent: false },
        select: { name: true },
        orderBy: { firstSeenAt: "asc" },
      })
    ).map((n) => n.name);

    // --- Content -----------------------------------------------------------
    //
    // A brief costs real money and real time to produce. If the survivor has
    // none and the source does, the survivor adopts it whole — brief, the
    // structured copy, when it was written and which model wrote it — so the
    // merge neither loses a brief nor triggers a regeneration. If the survivor
    // already has one, nothing is touched: the two records describe the same
    // law, and swapping one good brief for another buys nothing.
    // "Has a usable brief" means one the card can actually render, so it is
    // decided by PARSING, not by the column being non-null. A brief stored to
    // an earlier definition of what a Citizen's Brief is reads as no brief to
    // every reader — and treating it as one here would block the survivor from
    // adopting a real brief the source is holding, which is precisely the loss
    // this merge is supposed to make impossible.
    const targetBrief = parseBrief(target.citizenBriefJson);
    const sourceBrief = parseBrief(source.citizenBriefJson);
    const adoptBrief = !targetBrief && !!sourceBrief;
    const adoptText = !target.fullText && Boolean(source.fullText);

    const updated = await tx.governmentReference.update({
      where: { id: targetId },
      data: {
        totalComments: { increment: source.totalComments },
        totalShares: { increment: source.totalShares },
        ...(target.sourceUrl ? {} : { sourceUrl: source.sourceUrl }),
        ...(target.description ? {} : { description: source.description }),
        ...(adoptBrief
          ? {
              citizenBrief: source.citizenBrief,
              citizenBriefJson: source.citizenBriefJson,
              citizenBriefAt: source.citizenBriefAt,
              citizenBriefModel: source.citizenBriefModel,
              // Pinned to the SURVIVOR's version, not the source's. The two
              // records describe one law, so the adopted brief describes the
              // survivor's current text — and a merge must never be the reason
              // a brief gets rewritten. Carrying the source's number across
              // would make the survivor look a version behind and pay for a
              // regeneration on the next read.
              citizenBriefVersion: target.lawVersion,
            }
          : {}),
        ...(adoptText
          ? {
              fullText: source.fullText,
              fullTextSource: source.fullTextSource,
              fullTextUrl: source.fullTextUrl,
              fullTextHash: source.fullTextHash,
              fullTextAt: source.fullTextAt,
              // Only a settled status crosses. "fetching"/"brief_pending" on the
              // source described a job running against a record that is now a
              // tombstone; copying it would hand the survivor a claim to be busy
              // that nothing is going to finish.
              contentStatus:
                source.contentStatus === "ready" || source.contentStatus === "unavailable"
                  ? source.contentStatus
                  : target.contentStatus,
            }
          : {}),
      },
      select: { id: true, masterReferenceId: true, title: true },
    });

    // --- The survivor's real tally ----------------------------------------
    const { support, oppose } = await computeWeightedTally(targetId, tx);

    await tx.governmentReference.update({
      where: { id: targetId },
      data: { supportVotes: support, opposeVotes: oppose },
    });

    // --- The source becomes a tombstone ------------------------------------
    //
    // Kept, not deleted: it is the record of what the name used to mean, and
    // resolution walks through it so old ids keep working. Its counters go to
    // zero because everything they counted now lives on the survivor, and a
    // tombstone that still reports votes would be counted twice by anything
    // that sums across records.
    await tx.governmentReference.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: targetId,
        supportVotes: 0,
        opposeVotes: 0,
        totalComments: 0,
        totalShares: 0,
      },
    });

    return {
      target: { id: updated.id, masterReferenceId: updated.masterReferenceId, title: updated.title },
      source: { id: source.id, masterReferenceId: source.masterReferenceId },
      postsMoved: posts.count,
      votesMoved,
      votesSuperseded,
      chainsFlattened: chains.count,
      namesKept,
      brief: adoptBrief
        ? ("adopted from source" as const)
        : target.citizenBriefJson
          ? ("target kept its own" as const)
          : ("neither had one" as const),
      officialText: adoptText
        ? ("adopted from source" as const)
        : target.fullText
          ? ("target kept its own" as const)
          : ("neither had one" as const),
      tally: { support, oppose },
    };
  });
}

/**
 * Teach a record another name it should answer to.
 *
 * Fails rather than steals when the name belongs to somebody else. Two records
 * answering to one name is the duplicate the master reference system exists to
 * prevent, so being told which record holds it is more useful than a silent
 * reassignment — that is a merge candidate, not an alias.
 */
export async function addAlias(
  referenceId: string,
  alias: string
): Promise<{ success: boolean; aliases: string[] }> {
  return prisma.$transaction(async (tx) => {
    const reference = await tx.governmentReference.findUnique({
      where: { id: referenceId },
      select: { referenceType: true },
    });

    if (!reference) {
      throw new Error("Reference not found");
    }

    const name = normalizeReferenceId(reference.referenceType as ReferenceTypeValue, alias);
    const claim = await claimName(tx, referenceId, name, NameSource.MANUAL);

    if (!claim.ok) {
      throw new Error(
        `"${name}" already belongs to another reference — these two are a merge candidate, not an alias`,
      );
    }

    const { former } = await namesFor(referenceId, tx);
    return { success: true, aliases: former };
  });
}

/**
 * Update engagement stats for a reference
 */
export async function updateReferenceStats(
  referenceId: string,
  stats: {
    supportVotes?: number;
    opposeVotes?: number;
    totalComments?: number;
    totalShares?: number;
  }
): Promise<void> {
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: stats,
  });
}

/**
 * Recalculate stats for a reference based on actual data
 */
export async function recalculateReferenceStats(referenceId: string): Promise<{
  supportVotes: number;
  opposeVotes: number;
  totalComments: number;
  totalShares: number;
}> {
  // The same way voting does: weighted real votes, delegations included, and
  // nothing else.
  const { support: supportVotes, oppose: opposeVotes } = await computeWeightedTally(referenceId);

  // Count comments on related posts
  const posts = await prisma.post.findMany({
    where: { governmentReferenceId: referenceId },
    include: {
      _count: {
        select: {
          comments: true,
          shares: true,
        },
      },
    },
  });

  const totalComments = posts.reduce((sum, p) => sum + p._count.comments, 0);
  const totalShares = posts.reduce((sum, p) => sum + p._count.shares, 0);

  // Update the reference
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: {
      supportVotes,
      opposeVotes,
      totalComments,
      totalShares,
    },
  });

  return { supportVotes, opposeVotes, totalComments, totalShares };
}
