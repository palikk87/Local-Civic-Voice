/**
 * Find records whose "official text" is a block page, and clear them.
 *
 * ONE IMPLEMENTATION, TWO DOORS. This lives in a service rather than in the
 * script that first needed it because the same job has to be runnable from the
 * admin panel. Maintenance that only a shell can perform is maintenance that
 * waits for somebody with a shell, and the person who can see the problem on
 * their phone is usually not that person.
 *
 * WHAT IT LOOKS FOR. Until official-source.ts landed, the only check on fetched
 * official text was `length > 200`. The Federal Register's anti-scraping page
 * — "Request Access", served as HTTP 200, about 1,500 characters — passed, and
 * was written into GovernmentReference.fullText as the text of a law. It was
 * then hashed as the law's fingerprint, shown to readers as the order, and
 * summarised by the AI into a Citizen's Brief with a case for and a case
 * against, published under Support and Oppose buttons.
 *
 * WHAT IT CLEARS, and why each one: fullText and fullTextHash (the false
 * record), and every citizenBrief field on the same row (written from it, so it
 * describes the block page rather than the law). Nothing else. Votes, posts,
 * comments and positions are untouched, and the row itself stays — nulling the
 * text is precisely what makes the content pipeline fetch it again, honestly,
 * on its next pass.
 */

import { prisma } from "../prisma";
import { judgeOfficialText } from "./official-source";

export interface BlockedRecord {
  id: string;
  masterReferenceId: string;
  referenceType: string;
  title: string;
  /** The phrase that convicted it, for the report. */
  matched: string;
  /** A brief was written from the block page and will be cleared with it. */
  hadBrief: boolean;
}

export interface PurgeResult {
  /** How many records hold text at all — the pool that was examined. */
  examined: number;
  found: BlockedRecord[];
  /** True when the rows were actually written. */
  applied: boolean;
  cleared: number;
}

/**
 * @param referenceType  Narrow to one branch, or leave undefined for all.
 * @param apply          Write. Defaults to false: on a database shared with
 *                       another project, reporting first is the only
 *                       responsible default.
 */
export async function purgeBlockedText(
  options: { referenceType?: string; apply?: boolean } = {},
): Promise<PurgeResult> {
  const apply = options.apply ?? false;

  const rows = await prisma.governmentReference.findMany({
    where: {
      fullText: { not: null },
      ...(options.referenceType ? { referenceType: options.referenceType } : {}),
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

  const found: BlockedRecord[] = [];
  for (const row of rows) {
    const verdict = judgeOfficialText(row.fullText);
    // `too_short` is not evidence of a block page — a genuinely short record
    // predates a change in the floor and is a separate question. Only text that
    // announces itself as something other than a document is cleared here.
    if (verdict.ok || verdict.reason !== "not_a_document") continue;
    found.push({
      id: row.id,
      masterReferenceId: row.masterReferenceId,
      referenceType: row.referenceType,
      title: row.title,
      matched: verdict.matched ?? "unknown",
      hadBrief: row.citizenBrief !== null,
    });
  }

  if (!apply || found.length === 0) {
    return { examined: rows.length, found, applied: false, cleared: 0 };
  }

  for (const record of found) {
    await prisma.governmentReference.update({
      where: { id: record.id },
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

  return { examined: rows.length, found, applied: true, cleared: found.length };
}
