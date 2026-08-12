/**
 * Posts carry a link to the government action they are about. The feed and
 * timeline cards render that link as a law card — badge, status, category,
 * source link and the live support/oppose tally with the caller's own position.
 *
 * The post rows only store the reference id and a copy of the title, so this
 * loader batch-fetches the rest in one query (plus one for the caller's votes)
 * and hands back a map keyed by GovernmentReference.id.
 */
import { prisma } from "../prisma";
import type { PostReference } from "../types";
import { formatReferenceDisplayId } from "./reference-id";

/**
 * @param referenceIds GovernmentReference ids collected from a page of posts.
 * @param userId The signed-in caller, or null — decides whether userVote is filled.
 */
export async function loadPostReferenceViews(
  referenceIds: Array<string | null | undefined>,
  userId: string | null | undefined
): Promise<Map<string, PostReference>> {
  const ids = [...new Set(referenceIds.filter((id): id is string => Boolean(id)))];
  const views = new Map<string, PostReference>();
  if (ids.length === 0) return views;

  const [references, votes] = await Promise.all([
    prisma.governmentReference.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        masterReferenceId: true,
        referenceType: true,
        title: true,
        shortTitle: true,
        status: true,
        category: true,
        sourceUrl: true,
        citizenBrief: true,
        supportVotes: true,
        opposeVotes: true,
      },
    }),
    userId
      ? prisma.governmentReferenceVote.findMany({
          where: { userId, governmentReferenceId: { in: ids } },
          select: { governmentReferenceId: true, position: true },
        })
      : Promise.resolve([]),
  ]);

  const voteByReference = new Map(votes.map((v) => [v.governmentReferenceId, v.position]));

  for (const reference of references) {
    const position = voteByReference.get(reference.id);
    views.set(reference.id, {
      id: reference.id,
      masterReferenceId: reference.masterReferenceId,
      displayId: formatReferenceDisplayId(reference.masterReferenceId, reference.referenceType),
      // The column is a free-form string; posts only ever attach these three types.
      referenceType: reference.referenceType as PostReference["referenceType"],
      title: reference.title,
      shortTitle: reference.shortTitle,
      status: reference.status,
      category: reference.category,
      sourceUrl: reference.sourceUrl,
      citizenBrief: reference.citizenBrief,
      votes: {
        support: reference.supportVotes,
        oppose: reference.opposeVotes,
        total: reference.supportVotes + reference.opposeVotes,
      },
      userVote: position === "support" || position === "oppose" ? position : null,
    });
  }

  return views;
}

/** Single-post convenience wrapper around {@link loadPostReferenceViews}. */
export async function loadPostReferenceView(
  referenceId: string | null | undefined,
  userId: string | null | undefined
): Promise<PostReference | null> {
  if (!referenceId) return null;
  const views = await loadPostReferenceViews([referenceId], userId);
  return views.get(referenceId) ?? null;
}
