/**
 * Delete specific posts by exact content or by id.
 *
 * Written for the two test posts the delete bug orphaned — they were "deleted"
 * from the timeline while the server never heard about it, so they are still
 * live rows with no way to reach them from the UI that created them.
 *
 * DRY RUN BY DEFAULT. It prints what it matched and changes nothing until you
 * pass --confirm. A script that deletes posts is not one that should do
 * anything on a mistyped argument.
 *
 *   # see what would go
 *   bun scripts/delete-posts.ts --content "Parity audit test post - please ignore. Will delete."
 *
 *   # actually delete
 *   bun scripts/delete-posts.ts --confirm \
 *     --content "Parity audit test post - please ignore. Will delete." \
 *     --content "Pagination probe A - will delete"
 *
 *   # or by id
 *   bun scripts/delete-posts.ts --confirm --id clx123... --id clx456...
 *
 * Matching on content is EXACT, not a substring search. "Delete every post
 * containing X" is how a cleanup takes somebody's real writing with it.
 *
 * Goes through the same media purge the API does, so the stored objects leave
 * with the rows rather than being stranded in the bucket with the only record
 * of their keys destroyed.
 */

import { prisma } from "../src/prisma";
import { purgeMediaObjects } from "../src/services/media-objects";

function argValues(flag: string): string[] {
  const values: string[] = [];
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1] !== undefined) values.push(args[i + 1]!);
  }
  return values;
}

const confirmed = process.argv.includes("--confirm");
const contents = argValues("--content");
const ids = argValues("--id");

if (contents.length === 0 && ids.length === 0) {
  console.error(
    "Nothing to do. Pass --content \"exact post text\" and/or --id <postId>.\n" +
      "Add --confirm to actually delete; without it this is a dry run.",
  );
  process.exit(1);
}

const matches = await prisma.post.findMany({
  where: {
    OR: [
      ...(contents.length > 0 ? [{ content: { in: contents } }] : []),
      ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
    ],
  },
  include: { media: true, author: { select: { email: true } } },
});

if (matches.length === 0) {
  console.log("No posts matched. Nothing to do.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`Matched ${matches.length} post(s):\n`);
for (const post of matches) {
  console.log(`  ${post.id}  ${post.author.email}  ${post.createdAt.toISOString()}`);
  console.log(`    ${JSON.stringify(post.content.slice(0, 120))}`);
  if (post.media.length > 0) console.log(`    ${post.media.length} attached media object(s)`);
}

// Anything asked for that is not there — usually the sign of a typo, or of the
// post already being gone.
const found = new Set(matches.map((p) => p.content));
const foundIds = new Set(matches.map((p) => p.id));
for (const c of contents) if (!found.has(c)) console.log(`\n  not found (content): ${JSON.stringify(c)}`);
for (const id of ids) if (!foundIds.has(id)) console.log(`\n  not found (id): ${id}`);

if (!confirmed) {
  console.log("\nDry run — nothing deleted. Re-run with --confirm to delete these.");
  await prisma.$disconnect();
  process.exit(0);
}

let deleted = 0;
for (const post of matches) {
  // Bytes before rows. Media.postId cascades, so deleting the post first would
  // destroy the only record of the object keys while the objects stayed in the
  // bucket.
  const purge = await purgeMediaObjects(post.media, `post ${post.id}`);
  if (!purge.ok) {
    console.error(`\nStopped: could not remove media for ${post.id} — ${purge.message}`);
    console.error("No further posts were deleted.");
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.post.delete({ where: { id: post.id } });
  deleted += 1;
  console.log(`\ndeleted ${post.id}`);
}

console.log(`\nDone — ${deleted} post(s) deleted.`);
await prisma.$disconnect();
