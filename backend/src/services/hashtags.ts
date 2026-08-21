/**
 * Hashtags: pulling them out of a post and keeping the counts.
 *
 * The Hashtag and PostHashtag tables have existed, with indexes and a trending
 * score, since long before anything wrote to them. Nothing did. So the trending
 * list was always empty, every tag in every post was plain text, and the whole
 * feature was a schema.
 */

import { prisma } from "../prisma";

/**
 * The tags in a piece of writing.
 *
 * Lowercased, because #Insulin and #insulin are the same subject and a platform
 * that treats them as two is one where neither has enough posts to be worth
 * opening. Deduplicated, so writing the same tag three times for emphasis
 * counts once.
 *
 * Letters, numbers and underscore only, and never all digits — "#1" in "ranked
 * #1 in the country" is not a topic, and a tag made of digits is almost always
 * somebody numbering a list.
 */
export function extractHashtags(text: string): string[] {
  const found = text.match(/#([A-Za-z0-9_]{1,64})\b/g) ?? [];
  const tags = found
    .map((raw) => raw.slice(1).toLowerCase())
    .filter((tag) => !/^\d+$/.test(tag));
  return [...new Set(tags)];
}

/**
 * Record a post's tags and bump their counts.
 *
 * Never throws into the caller: a post is the thing somebody wrote and it must
 * not be lost because a tag failed to file. The counts are a convenience, the
 * post is the point.
 */
export async function linkHashtags(postId: string, content: string): Promise<string[]> {
  const tags = extractHashtags(content);
  if (tags.length === 0) return [];

  try {
    for (const tag of tags) {
      const hashtag = await prisma.hashtag.upsert({
        where: { tag },
        create: { tag, useCount: 1, lastUsedAt: new Date(), trendingScore: 1 },
        update: {
          useCount: { increment: 1 },
          lastUsedAt: new Date(),
          trendingScore: { increment: 1 },
        },
        select: { id: true },
      });

      await prisma.postHashtag.upsert({
        where: { postId_hashtagId: { postId, hashtagId: hashtag.id } },
        create: { postId, hashtagId: hashtag.id },
        update: {},
      });
    }
  } catch (error) {
    console.error("[Hashtags] could not file tags for post", postId, error);
  }

  return tags;
}
