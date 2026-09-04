/**
 * Posts carry a link to the government action they are about. The feed and
 * timeline cards render that link as a law card — badge, status, category,
 * source link and the live support/oppose tally with the caller's own position.
 *
 * READ LIVE, NEVER COPIED. The post row stores a frozen copy of the title from
 * the moment it was written; this loader ignores it and reads the record. That
 * is the whole point of a master reference: the law is shared and the post
 * frames it to one person's timeline, so when the government updates the law,
 * updating the record updates every post showing it. Nobody has to walk the
 * posts, and no post is ever edited.
 *
 * Batch-fetched in one query (plus one for the caller's votes) and handed back
 * as a map keyed by GovernmentReference.id.
 */
import { prisma } from "../prisma";
import type { PostReference } from "../types";
import { formatReferenceDisplayId } from "./reference-id";
import { recordCompleteness } from "./record-completeness";
import { ensurePortraitFor } from "./reference-attribution";

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
        lawChangedAt: true,
        lawVersion: true,
        // What the completeness badge is worked out from. Selected here rather
        // than fetched per card so a feed page stays one query — see
        // services/record-completeness.ts.
        fullText: true,
        fullTextSource: true,
        sourceCheckedAt: true,
        introducedDate: true,
        signedDate: true,
        decidedDate: true,
        sponsorName: true,
        sponsorBioguideId: true,
        sponsorPhotoUrl: true,
        citizenBriefJson: true,
        citizenBriefVersion: true,
        precedentialStatus: true,
        // Existence only. The tally itself belongs to the law page; all the
        // badge asks is whether a recorded vote is stored at all.
        rollCalls: { select: { id: true }, take: 1 },
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
    /*
     * A LAW CARD IS LOADING, so find the face of whoever is behind it — for
     * whoever sees this card next.
     *
     * Part of the card's own load rather than a sweep over the archive: 1,532
     * executive orders are held and most will never be looked at, so paying for
     * all of them to serve the few that are read is backwards.
     *
     * Costs this request nothing. It is not awaited, a person is only ever
     * asked about once per process, the lookups queue behind a single worker,
     * and one answer fills every record that person is behind.
     */
    ensurePortraitFor(reference);

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
      // HOW COMPLETE OUR RECORD OF THIS LAW IS, and what is still outstanding.
      // The same answer the law's own page gives — one function, so a feed card
      // and the record it links to can never disagree about our own work.
      completeness: recordCompleteness({
        ...reference,
        hasRollCall: reference.rollCalls.length > 0,
      }),
      // When the LAW last moved — not when the row was last written. A post
      // older than this is showing a law that has changed since its author
      // wrote about it, which is what the badge on the card is for.
      lawChangedAt: reference.lawChangedAt?.toISOString() ?? null,
      lawVersion: reference.lawVersion,
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

/**
 * Was this post written before the law it points at last changed?
 *
 * The badge on a post card. The post itself is never edited — the author's
 * words stay theirs — but the law underneath moves forward, and a reader
 * deserves to know that the text being argued about is not the text that was
 * argued about.
 *
 * Computed here, once, rather than in each client: web and mobile each doing
 * their own date comparison is two chances to disagree about what "before"
 * means, on a badge whose entire job is to be trustworthy.
 */
export function lawMovedSincePost(
  postCreatedAt: Date,
  reference: Pick<PostReference, "lawChangedAt"> | null | undefined
): boolean {
  if (!reference?.lawChangedAt) return false;
  return new Date(reference.lawChangedAt).getTime() > postCreatedAt.getTime();
}
