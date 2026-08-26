/**
 * Find records whose "official text" is actually a block page, and clear them.
 *
 *   bun run scripts/purge-blocked-text.ts               # report only, writes nothing
 *   bun run scripts/purge-blocked-text.ts --apply       # clear what it found
 *   bun run scripts/purge-blocked-text.ts --apply --type executive_order
 *
 * The work is in src/services/blocked-text-purge.ts, because the admin panel
 * runs the same job from a button. Maintenance that only a shell can perform is
 * maintenance that waits for somebody with a shell.
 *
 * SAFE TO RE-RUN, and safe to run first without --apply. It reports before it
 * touches anything, and on a shared database that is the only responsible
 * default.
 */

import { prisma } from "../src/prisma";
import { purgeBlockedText } from "../src/services/blocked-text-purge";

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const referenceType = flag("type") ?? undefined;

  const result = await purgeBlockedText({ referenceType, apply });

  console.log(
    `Examined ${result.examined} record${result.examined === 1 ? "" : "s"} that hold text.\n`,
  );

  for (const record of result.found) {
    console.log(
      `  ${record.masterReferenceId.padEnd(18)} ${record.referenceType.padEnd(17)} ` +
        `matched "${record.matched}"${record.hadBrief ? "  [has a brief written from it]" : ""}`,
    );
    console.log(`    ${record.title.slice(0, 74)}`);
  }

  if (result.found.length === 0) {
    console.log("Nothing to clear: no stored text looks like a block page.");
    return;
  }

  const withBriefs = result.found.filter((r) => r.hadBrief).length;
  console.log(
    `\n${result.found.length} record${result.found.length === 1 ? "" : "s"} hold a block page ` +
      `as official text` +
      (withBriefs > 0
        ? `, and ${withBriefs} of them ${withBriefs === 1 ? "has" : "have"} a brief written from it`
        : "") +
      ".",
  );

  if (!result.applied) {
    console.log("\nNothing was written. Re-run with --apply to clear them.");
    return;
  }

  console.log(
    `\nCleared ${result.cleared}. Those records now show an honest empty state, and the ` +
      `content pipeline will fetch the real text on its next pass.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
