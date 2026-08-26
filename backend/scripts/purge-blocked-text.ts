/**
 * Find records whose "official text" is actually a block page, and clear them.
 *
 *   bun run scripts/purge-blocked-text.ts               # report only, writes nothing
 *   bun run scripts/purge-blocked-text.ts --apply       # clear what it found
 *   bun run scripts/purge-blocked-text.ts --apply --type executive_order
 *
 * WHY THIS EXISTS. Until official-source.ts landed, the only check on fetched
 * official text was `length > 200`. An anti-bot interstitial — "checking your
 * browser", a captcha, an access-denied notice — is a few kilobytes, so it
 * passed, and was written into GovernmentReference.fullText as the text of a
 * law. From there it did three more things, each worse than the last:
 *
 *   1. it was shown to readers as the text of the executive order;
 *   2. it was hashed as the law's fingerprint, so the next honest fetch reads
 *      as "the law changed" and badges every post attached to it;
 *   3. the Citizen's Brief is written from whatever is in that column, so the
 *      AI summarised a captcha page and that summary was stored as the brief
 *      for that version of the law — one per version, reused forever, shown to
 *      everybody.
 *
 * The guard stops new ones. This clears the ones already written.
 *
 * WHAT IT CLEARS, and why each: fullText and fullTextHash (the false record),
 * and every citizenBrief field on the same row (written from it, so it
 * describes the block page rather than the law). It does NOT touch votes,
 * posts, comments, positions, or the row itself. Nulling the text is what makes
 * the content pipeline fetch it again, honestly, on the next pass.
 *
 * SAFE TO RE-RUN, and safe to run first without --apply. It reports before it
 * touches anything, and on a shared database that is the only responsible
 * default.
 */

import { prisma } from "../src/prisma";
import { judgeOfficialText } from "../src/services/official-source";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}
const APPLY = process.argv.includes("--apply");
const TYPE = flag("type");

async function main() {
  const rows = await prisma.governmentReference.findMany({
    where: {
      fullText: { not: null },
      ...(TYPE ? { referenceType: TYPE } : {}),
    },
    select: {
      id: true,
      masterReferenceId: true,
      referenceType: true,
      title: true,
      fullText: true,
      citizenBrief: true,
    },
  });

  console.log(`Examined ${rows.length} record${rows.length === 1 ? "" : "s"} that hold text.\n`);

  const bad: typeof rows = [];
  for (const row of rows) {
    const verdict = judgeOfficialText(row.fullText);
    // `too_short` is not evidence of a block page — a genuinely short record
    // predates the higher floor and is a separate question. Only text that
    // announces itself as something other than a document is cleared here.
    if (!verdict.ok && verdict.reason === "not_a_document") {
      bad.push(row);
      console.log(
        `  ${row.masterReferenceId.padEnd(18)} ${row.referenceType.padEnd(17)} ` +
          `matched "${verdict.matched}"${row.citizenBrief ? "  [has a brief written from it]" : ""}`,
      );
      console.log(`    ${row.title.slice(0, 74)}`);
    }
  }

  if (bad.length === 0) {
    console.log("Nothing to clear: no stored text looks like a block page.");
    return;
  }

  const withBriefs = bad.filter((r) => r.citizenBrief).length;
  console.log(
    `\n${bad.length} record${bad.length === 1 ? "" : "s"} hold a block page as official text` +
      (withBriefs > 0
        ? `, and ${withBriefs} of them ${withBriefs === 1 ? "has" : "have"} a brief written from it`
        : "") +
      ".",
  );

  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply to clear them.");
    return;
  }

  for (const row of bad) {
    await prisma.governmentReference.update({
      where: { id: row.id },
      data: {
        fullText: null,
        fullTextHash: null,
        // Written from the block page, so it describes the block page.
        citizenBrief: null,
        citizenBriefJson: null,
        citizenBriefAt: null,
        citizenBriefModel: null,
        citizenBriefVersion: null,
        // Let the content pipeline pick it up again rather than believing a
        // fetch is already in flight from whenever this was poisoned.
        contentStartedAt: null,
      },
    });
  }

  console.log(
    `\nCleared ${bad.length}. Those records now show an honest empty state, and the ` +
      `content pipeline will fetch the real text on its next pass.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
