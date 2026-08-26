/**
 * A record that is holding a lie fixes itself.
 *
 * WHAT WENT WRONG, and why a button was not the answer. The Federal Register
 * serves its anti-scraping page as HTTP 200, about 1,500 characters of prose.
 * Before official-source.ts, the only check on fetched text was `length > 200`,
 * so that page was written into GovernmentReference.fullText as the text of an
 * executive order, hashed as the law's fingerprint, summarised by the AI into a
 * Citizen's Brief with a case for and a case against, and published under
 * Support and Oppose buttons. Somebody read a captcha notice and was invited to
 * vote on it.
 *
 * The guard stopped new ones arriving. The clean-up became a button in the
 * admin console — which was still wrong, and this file is the correction. A
 * button means the defect sits there until a person notices it, finds the tab
 * and presses it; the person who noticed last time was Khalid, on his phone,
 * reading the app. Making the reader the janitor is not a fix, it is a queue
 * with one operator.
 *
 * The server can recognise this defect on its own — the detector is the same
 * one the admin panel uses, and it is tested. So it runs at boot and on a
 * schedule, clears what it finds, and asks for the real text to be fetched
 * again. Nobody presses anything and nobody has to be watching.
 *
 * WHAT IT WILL NOT DO. It never invents text, never leaves a placeholder, and
 * never touches a vote, post or comment. A record it clears shows an honest
 * empty state until the official source answers — which is a finished state,
 * not a broken one.
 *
 * WHAT STOPS IT HAMMERING THE GOVERNMENT. Only records whose source has not
 * been checked in a day are re-queued, because reference-content.ts stamps
 * sourceCheckedAt on a FAILED pull as well as a successful one — so a law whose
 * text genuinely is not published is asked about once a day, not once a sweep.
 * And the batch is capped, so a database full of empty records produces a slow
 * trickle rather than a stampede.
 */

import { prisma } from "../prisma";
import { purgeBlockedText } from "./blocked-text-purge";
import { jobQueue, JobPriority, JobType } from "./job-queue";

/** How long a failed or successful source check is trusted before asking again. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How many records may be asked about in one sweep.
 *
 * Deliberately small. Each one is a request to a government API that is doing
 * us a favour by existing, and there is no deadline here — a record that waits
 * for tomorrow's sweep costs a reader nothing, because it shows an honest empty
 * state in the meantime.
 */
const DEFAULT_MAX_REQUEUE = 25;

export interface SelfHealResult {
  /** Records whose stored "law" was really a block page. */
  clearedBlockPages: number;
  /** Identifiers of those records, so the log names them rather than counting them. */
  cleared: string[];
  /** Records asked to fetch their official text again. */
  requeued: number;
  /** Records with no text at all, before the cap was applied. */
  missingText: number;
}

export async function healReferenceContent(
  options: { maxRequeue?: number } = {},
): Promise<SelfHealResult> {
  const maxRequeue = options.maxRequeue ?? DEFAULT_MAX_REQUEUE;

  // 1. THE LIES FIRST. Same implementation the admin panel calls, so the two
  //    can never disagree about what counts as a block page.
  const purge = await purgeBlockedText({ apply: true });

  // 2. WHAT WE JUST EMPTIED, UNCONDITIONALLY. These do not go through the
  //    once-a-day guard below, and the test that made this explicit is worth
  //    keeping in mind: a record cleared a moment ago still carries a RECENT
  //    sourceCheckedAt, because the source was checked — it just answered with
  //    a captcha. Left to the guard, a record we emptied ourselves would sit
  //    blank in front of readers for up to a day waiting to be asked again.
  //    The freshness rule exists to spare the government's servers, not to
  //    delay repairing damage we did.
  const clearedIds = purge.found.map((record) => record.id);
  for (const id of clearedIds) {
    jobQueue.enqueue(JobType.REEXTRACT_REFERENCE_TEXT, { referenceId: id }, JobPriority.NORMAL);
  }

  // 3. THEN THE OTHER GAPS, politely.
  const candidates = await prisma.governmentReference.findMany({
    where: {
      mergedIntoId: null,
      fullText: null,
      OR: [
        { sourceCheckedAt: null },
        { sourceCheckedAt: { lt: new Date(Date.now() - RECHECK_AFTER_MS) } },
      ],
    },
    select: { id: true, masterReferenceId: true },
    // Oldest check first, so nothing is starved by a record that keeps failing.
    orderBy: [{ sourceCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: maxRequeue,
  });

  const missingText = await prisma.governmentReference.count({
    where: { mergedIntoId: null, fullText: null },
  });

  for (const record of candidates) {
    if (clearedIds.includes(record.id)) continue; // already asked for, a moment ago
    jobQueue.enqueue(
      JobType.REEXTRACT_REFERENCE_TEXT,
      { referenceId: record.id },
      JobPriority.LOW,
    );
  }

  return {
    clearedBlockPages: purge.cleared,
    cleared: purge.found.map((record) => record.masterReferenceId),
    requeued: candidates.filter((record) => !clearedIds.includes(record.id)).length + clearedIds.length,
    missingText,
  };
}

/**
 * Run it, and say what happened — but only when something happened.
 *
 * A scheduled job that logs "nothing to do" every few hours trains everyone to
 * skim past it, which is how the interesting line gets missed. Clearing a block
 * page is always worth a line: it means a reader was shown something false, and
 * that is the kind of thing that should leave a trace even when it is fixed
 * automatically.
 */
export async function runContentSelfHeal(trigger: string): Promise<void> {
  try {
    const result = await healReferenceContent();

    if (result.clearedBlockPages > 0) {
      console.warn(
        `[SelfHeal] Cleared a block page from ${result.clearedBlockPages} record(s) ` +
          `(${result.cleared.join(", ")}). They were showing an anti-scraping notice as the ` +
          `text of a law. The official text will be fetched again.`,
      );
    }
    if (result.requeued > 0) {
      console.log(
        `[SelfHeal] ${trigger}: asked ${result.requeued} of ${result.missingText} record(s) ` +
          `with no official text to fetch it again.`,
      );
    }
  } catch (error) {
    // Never take the server down over housekeeping.
    console.error("[SelfHeal] sweep failed:", error);
  }
}
