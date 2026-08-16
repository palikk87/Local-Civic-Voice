import { prisma } from "../prisma";
import { computeWeightedTally } from "./delegation-service";
import { canonicalReferenceId } from "./master-reference-id";

/**
 * Deterministic placeholder tally for a brand-new reference so its card never
 * shows a dead 0–0. Hash of the master id → stable numbers per reference.
 * Lives in the seed columns, so an admin can strip it later without touching
 * real votes (POST /api/admin/references/clear-seed-votes).
 */
export function seedTallyFor(masterReferenceId: string): {
  seedSupport: number;
  seedOppose: number;
} {
  let hash = 0;
  for (let i = 0; i < masterReferenceId.length; i++) {
    hash = (hash * 31 + masterReferenceId.charCodeAt(i)) >>> 0;
  }
  // NOTE: >>> keeps the shift unsigned — >> flips negative for hashes ≥ 2^31
  // and produced negative tallies.
  const seedSupport = 400 + (hash % 4600); // 400–4,999
  const seedOppose = 300 + ((hash >>> 7) % 3700); // 300–3,999
  return { seedSupport, seedOppose };
}

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
      if (candidate.aliases) {
        try {
          const candidateAliases = JSON.parse(candidate.aliases) as string[];
          const normalizedAliases = candidateAliases.map(a => normalizeReferenceId(type, a));

          for (const searchTerm of allSearchTerms) {
            if (normalizedAliases.includes(searchTerm) || candidate.masterReferenceId === searchTerm) {
              // Avoid duplicates
              if (!results.some(r => r.id === candidate.id)) {
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
        } catch {
          // Invalid JSON in aliases, skip
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

  // No duplicate found, create new reference
  const reference = await prisma.governmentReference.create({
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
      ...(() => {
        // Same removable placeholder layer new synced references get — a card
        // should never appear with a dead 0–0 tally.
        const seed = seedTallyFor(normalizedId);
        return {
          seedSupport: seed.seedSupport,
          seedOppose: seed.seedOppose,
          supportVotes: seed.seedSupport,
          opposeVotes: seed.seedOppose,
        };
      })(),
    },
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
    },
  });

  return {
    reference,
    created: true,
  };
}

/**
 * Merge two references by updating all posts to point to the target
 * and marking the source as merged
 */
export async function mergeReferences(
  sourceId: string,
  targetId: string
): Promise<{
  success: boolean;
  postsUpdated: number;
  votesTransferred: number;
  aliasesMerged: string[];
}> {
  if (sourceId === targetId) {
    throw new Error("Cannot merge a reference into itself");
  }

  // Get both references
  const [source, target] = await Promise.all([
    prisma.governmentReference.findUnique({
      where: { id: sourceId },
      include: {
        posts: { select: { id: true } },
        votes: true,
      },
    }),
    prisma.governmentReference.findUnique({
      where: { id: targetId },
    }),
  ]);

  if (!source) {
    throw new Error("Source reference not found");
  }
  if (!target) {
    throw new Error("Target reference not found");
  }
  if (source.mergedIntoId) {
    throw new Error("Source reference has already been merged");
  }
  if (target.mergedIntoId) {
    throw new Error("Target reference has been merged into another reference");
  }

  // Merge aliases
  const sourceAliases = source.aliases ? JSON.parse(source.aliases) as string[] : [];
  const targetAliases = target.aliases ? JSON.parse(target.aliases) as string[] : [];

  // Add source's master ID and aliases to target's aliases
  const newAliases = [
    ...new Set([
      ...targetAliases,
      source.masterReferenceId,
      ...sourceAliases,
    ]),
  ];

  // Transfer votes (if user hasn't already voted on target)
  let votesTransferred = 0;
  for (const vote of source.votes) {
    const existingVote = await prisma.governmentReferenceVote.findUnique({
      where: {
        governmentReferenceId_userId: {
          governmentReferenceId: targetId,
          userId: vote.userId,
        },
      },
    });

    if (!existingVote) {
      await prisma.governmentReferenceVote.update({
        where: { id: vote.id },
        data: { governmentReferenceId: targetId },
      });
      votesTransferred++;
    } else {
      // User already voted on target, delete the source vote
      await prisma.governmentReferenceVote.delete({
        where: { id: vote.id },
      });
    }
  }

  // Perform the merge in a transaction
  const result = await prisma.$transaction([
    // Update all posts to point to target
    prisma.post.updateMany({
      where: { governmentReferenceId: sourceId },
      data: { governmentReferenceId: targetId },
    }),

    // Update target with merged aliases and recalculate stats
    prisma.governmentReference.update({
      where: { id: targetId },
      data: {
        aliases: JSON.stringify(newAliases),
        supportVotes: { increment: source.supportVotes },
        opposeVotes: { increment: source.opposeVotes },
        seedSupport: { increment: source.seedSupport },
        seedOppose: { increment: source.seedOppose },
        totalComments: { increment: source.totalComments },
        totalShares: { increment: source.totalShares },
      },
    }),

    // Mark source as merged (don't delete to preserve history)
    prisma.governmentReference.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: targetId,
        // Reset stats since they've been transferred
        supportVotes: 0,
        opposeVotes: 0,
        seedSupport: 0,
        seedOppose: 0,
        totalComments: 0,
        totalShares: 0,
      },
    }),
  ]);

  return {
    success: true,
    postsUpdated: result[0].count,
    votesTransferred,
    aliasesMerged: newAliases,
  };
}

/**
 * Add an alias to an existing reference
 */
export async function addAlias(
  referenceId: string,
  alias: string
): Promise<{ success: boolean; aliases: string[] }> {
  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
  });

  if (!reference) {
    throw new Error("Reference not found");
  }

  const currentAliases = reference.aliases ? JSON.parse(reference.aliases) as string[] : [];
  const normalizedAlias = normalizeReferenceId(reference.referenceType as ReferenceTypeValue, alias);

  if (currentAliases.includes(normalizedAlias)) {
    return { success: true, aliases: currentAliases };
  }

  const newAliases = [...currentAliases, normalizedAlias];

  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { aliases: JSON.stringify(newAliases) },
  });

  return { success: true, aliases: newAliases };
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
  // Recompute the public tally the same way voting does: weighted real votes
  // (delegations included) plus the reference's seed layer.
  const tally = await computeWeightedTally(referenceId);
  const seed = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { seedSupport: true, seedOppose: true },
  });
  const supportVotes = tally.support + (seed?.seedSupport ?? 0);
  const opposeVotes = tally.oppose + (seed?.seedOppose ?? 0);

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
