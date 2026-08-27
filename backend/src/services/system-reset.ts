/**
 * ARTICLE V — THE SYSTEM-WIDE RESET.
 *
 * The heavier of the two remedies. Impeachment recalls one person's borrowed
 * power; this returns all of it at once and zeroes every published tally, so
 * the Pulse genuinely starts again.
 *
 * WHAT EXECUTING IT ACTUALLY DOES, in full:
 *   1. Every active delegation is switched off. Borrowed power goes home.
 *   2. Every vote on every government record is deleted, and every published
 *      support/oppose count returns to zero.
 *   3. PositionEvent IS NOT TOUCHED. Every citizen keeps their own complete
 *      record of every position they have ever taken — the platform forgets
 *      the aggregate, not the person.
 *   4. Nothing else. No account is deleted, no post, no comment, no follow, no
 *      message, no brief. A reset restarts the collective memory, not the
 *      platform.
 *
 * THE 48 HOURS ARE THE POINT. The result is announced, every account is told
 * exactly what is about to be lost and what survives, and only then does it
 * run. A vote that closes while somebody sleeps must not take their
 * delegations with it before they have read the result.
 *
 * FULL DISCLOSURE, TWICE. The same account of what is lost is shown before
 * anybody votes and again in the 48-hour notice. A vote to wipe the platform
 * cast without knowing what gets wiped is not consent.
 *
 * IT RUNS THE FULL TWO WEEKS. Unlike impeachment there is no early close, even
 * when the arithmetic is already settled: everybody entitled to a say on this
 * should get their whole window to take it.
 */

import { prisma } from "../prisma";
import { NotificationType } from "./notification-service";
import { applyWeightedTally } from "./delegation-service";
import { schedule, FIRST_RUN } from "./scheduled-work";

/** Two weeks. */
export const RESET_WINDOW_DAYS = 14;

/**
 * A majority of the platform has to turn out at all, and two thirds of those
 * who did have to agree.
 *
 * MUST MATCH `canTriggerSystemReset` in packages/civic-core/src/constitution.ts.
 * The backend cannot import that package, so the numbers are duplicated and a
 * test asserts they are equal rather than trusting them to stay in step.
 */
export const RESET_PARTICIPATION_FLOOR = 0.5;
export const RESET_APPROVAL_THRESHOLD = 0.66;

/** Between the people deciding and the reset running. */
export const RESET_DISCLOSURE_HOURS = 48;

export const MIN_ARTICLE_LENGTH = 40;
export const MAX_ARTICLE_LENGTH = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type ResetStatus = "voting" | "failed" | "scheduled" | "executed";

/**
 * WHAT A RESET COSTS, in the platform's own words.
 *
 * One list, exported, so the voting screen, the 48-hour notice and the API all
 * say exactly the same thing. Two copies of this that drifted would mean
 * somebody voted on terms that were never the terms.
 */
export const RESET_DISCLOSURE = {
  lost: [
    "Every delegation ends. Everybody who lent their vote to somebody else gets it back, and every delegate loses the voice they were carrying.",
    "Every vote on every bill, order and case is deleted, and every published support and oppose count returns to zero. The Pulse starts again from nothing.",
  ],
  kept: [
    "Your account, your posts, your comments, your followers and your messages are untouched.",
    "Your own record of every position you have ever taken is kept in full. A reset forgets the aggregate, not the person.",
  ],
  afterwards: [
    "You can put your own positions back in one action — only the ones you cast yourself, never anything a delegate cast in your name.",
    "You can delegate again to anybody eligible, including whoever you were delegating to before.",
  ],
} as const;

// ---------------------------------------------------------------------------
// Opening a reset
// ---------------------------------------------------------------------------

export type OpenResult =
  | { ok: true; resetId: string; eligibleCount: number; expiresAt: Date }
  | { ok: false; code: OpenFailure; message: string };

export type OpenFailure = "already_open" | "articles_too_short" | "articles_too_long";

/**
 * Who counts, for the participation floor and for the right to cast a ballot.
 *
 * Verified, not banned, and signed up before the vote opened. The last one is
 * the anti-malice rule, the same idea as impeachment's frozen electorate: a
 * fortnight is long enough to register a great many accounts, and a reset
 * decided by accounts created to decide it is not the platform deciding.
 */
function eligibleWhere(openedAt: Date) {
  return {
    emailVerified: true,
    banned: false,
    createdAt: { lte: openedAt },
  } as const;
}

export async function openSystemReset(args: {
  filedById: string;
  grounds: string;
  evidence: string;
}): Promise<OpenResult> {
  const grounds = args.grounds.trim();
  const evidence = args.evidence.trim();

  if (grounds.length < MIN_ARTICLE_LENGTH || evidence.length < MIN_ARTICLE_LENGTH) {
    return {
      ok: false,
      code: "articles_too_short",
      message:
        `Articles of System Reset must state the grounds and the evidence, at least ` +
        `${MIN_ARTICLE_LENGTH} characters each. Every account on the platform will read this ` +
        `before deciding, and administrators will review it.`,
    };
  }
  if (grounds.length > MAX_ARTICLE_LENGTH || evidence.length > MAX_ARTICLE_LENGTH) {
    return {
      ok: false,
      code: "articles_too_long",
      message: `Each section of the Articles of System Reset is limited to ${MAX_ARTICLE_LENGTH} characters.`,
    };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_WINDOW_DAYS * DAY_MS);

  const created = await prisma.$transaction(async (tx) => {
    // ONE AT A TIME, PLATFORM-WIDE. Two simultaneous votes on the same
    // irreversible act is not a choice, it is a race.
    const existing = await tx.systemReset.findFirst({
      where: { status: { in: ["voting", "scheduled"] } },
      select: { id: true },
    });
    if (existing) return null;

    const eligibleCount = await tx.user.count({ where: eligibleWhere(now) });

    return tx.systemReset.create({
      data: {
        filedById: args.filedById,
        status: "voting",
        grounds,
        evidence,
        openedAt: now,
        expiresAt,
        eligibleCount,
      },
      select: { id: true, eligibleCount: true },
    });
  });

  if (!created) {
    return {
      ok: false,
      code: "already_open",
      message:
        "A System-Wide Reset is already before the platform. One at a time — the current " +
        "vote has to finish before another can be brought.",
    };
  }

  // EVERY ACCOUNT IS TOLD, with a notification that opens the voting screen.
  // Written with createMany rather than the usual per-user helper because
  // Article V notices have no preference switch to consult, and a platform-wide
  // notice that costs a preference read per account is a notice that arrives
  // over the following hour.
  await notifyEveryone(
    NotificationType.SYSTEM_RESET_OPENED,
    "A vote to reset the platform has opened",
    "Somebody has filed Articles of System Reset. If it passes, every delegation ends and " +
      "every vote count on every record returns to zero — your own record of what you voted " +
      "for is kept. You have two weeks to read the case and decide.",
    { systemResetId: created.id }
  );

  return { ok: true, resetId: created.id, eligibleCount: created.eligibleCount, expiresAt };
}

async function notifyEveryone(
  type: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<number> {
  const payload = JSON.stringify(data);
  let written = 0;
  let cursor: string | undefined;

  // Paged, because this is the one notification in the app addressed to
  // literally everybody and loading every id at once is how it falls over at
  // the scale where it matters most.
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { banned: false },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;

    await prisma.notification.createMany({
      data: batch.map((user) => ({ userId: user.id, type, title, body, data: payload })),
    });
    written += batch.length;
    cursor = batch[batch.length - 1]!.id;
  }

  return written;
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export type BallotResult =
  | { ok: true; support: number; oppose: number; eligibleCount: number }
  | { ok: false; code: BallotFailure; message: string };

export type BallotFailure = "not_found" | "closed" | "not_eligible" | "already_voted";

export async function castBallot(
  resetId: string,
  voterId: string,
  support: boolean
): Promise<BallotResult> {
  const reset = await prisma.systemReset.findUnique({
    where: { id: resetId },
    select: { id: true, status: true, openedAt: true, expiresAt: true, eligibleCount: true },
  });
  if (!reset) return { ok: false, code: "not_found", message: "No such proceeding." };
  if (reset.status !== "voting" || reset.expiresAt <= new Date()) {
    return { ok: false, code: "closed", message: "Voting on this reset has closed." };
  }

  const eligible = await prisma.user.findFirst({
    where: { id: voterId, ...eligibleWhere(reset.openedAt) },
    select: { id: true },
  });
  if (!eligible) {
    return {
      ok: false,
      code: "not_eligible",
      message:
        "Only verified accounts that existed when this vote opened may take part. An account " +
        "created after the filing has no ballot — that rule is what stops a reset being " +
        "decided by accounts made to decide it.",
    };
  }

  const already = await prisma.systemResetBallot.findUnique({
    where: { resetId_voterId: { resetId, voterId } },
    select: { id: true },
  });
  if (already) {
    return { ok: false, code: "already_voted", message: "You have already voted on this." };
  }

  await prisma.systemResetBallot.create({ data: { resetId, voterId, support } });

  const tally = await tallyOf(resetId);
  return {
    ok: true,
    support: tally.support,
    oppose: tally.oppose,
    eligibleCount: reset.eligibleCount,
  };
}

/** Take a ballot back while the window is open. */
export async function withdrawBallot(
  resetId: string,
  voterId: string
): Promise<BallotResult> {
  const reset = await prisma.systemReset.findUnique({
    where: { id: resetId },
    select: { status: true, expiresAt: true, eligibleCount: true },
  });
  if (!reset) return { ok: false, code: "not_found", message: "No such proceeding." };
  if (reset.status !== "voting" || reset.expiresAt <= new Date()) {
    return { ok: false, code: "closed", message: "Voting on this reset has closed." };
  }

  await prisma.systemResetBallot
    .delete({ where: { resetId_voterId: { resetId, voterId } } })
    .catch(() => null);

  const tally = await tallyOf(resetId);
  return {
    ok: true,
    support: tally.support,
    oppose: tally.oppose,
    eligibleCount: reset.eligibleCount,
  };
}

export async function tallyOf(resetId: string): Promise<{ support: number; oppose: number }> {
  const [support, oppose] = await Promise.all([
    prisma.systemResetBallot.count({ where: { resetId, support: true } }),
    prisma.systemResetBallot.count({ where: { resetId, support: false } }),
  ]);
  return { support, oppose };
}

/**
 * Both bars, in one place. Mirrors `canTriggerSystemReset`.
 *
 * A majority of the platform has to turn out AND two thirds of those who did
 * have to agree. The participation floor is what stops a determined handful
 * from restarting a platform nobody else was watching.
 */
export function resetPasses(args: {
  support: number;
  oppose: number;
  eligibleCount: number;
}): boolean {
  const turnout = args.support + args.oppose;
  if (args.eligibleCount === 0 || turnout === 0) return false;
  if (turnout / args.eligibleCount < RESET_PARTICIPATION_FLOOR) return false;
  return args.support / turnout >= RESET_APPROVAL_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Closing the vote, and the 48 hours
// ---------------------------------------------------------------------------

/**
 * Close a reset whose two weeks are up.
 *
 * Deciding is separate from executing on purpose: this sets the clock running,
 * announces the result, and tells every account exactly what is about to
 * happen. Nothing is destroyed here.
 */
export async function decideExpiredResets(): Promise<number> {
  const due = await prisma.systemReset.findMany({
    where: { status: "voting", expiresAt: { lte: new Date() } },
    select: { id: true, eligibleCount: true },
  });

  for (const reset of due) {
    const tally = await tallyOf(reset.id);
    const passed = resetPasses({ ...tally, eligibleCount: reset.eligibleCount });
    const decidedAt = new Date();

    if (!passed) {
      const claimed = await prisma.systemReset.updateMany({
        where: { id: reset.id, status: "voting" },
        data: { status: "failed", decidedAt },
      });
      if (claimed.count > 0) {
        await notifyEveryone(
          NotificationType.SYSTEM_RESET_SETTLED,
          "The reset vote did not pass",
          `${tally.support} for, ${tally.oppose} against, out of ${reset.eligibleCount} accounts ` +
            `entitled to vote. Nothing changes: delegations, votes and counts all stand.`,
          { systemResetId: reset.id }
        );
      }
      continue;
    }

    const executeAfter = new Date(decidedAt.getTime() + RESET_DISCLOSURE_HOURS * HOUR_MS);
    const claimed = await prisma.systemReset.updateMany({
      where: { id: reset.id, status: "voting" },
      data: { status: "scheduled", decidedAt, executeAfter },
    });

    if (claimed.count > 0) {
      // THE DISCLOSURE NOTICE. The same account of what is lost that everybody
      // saw before voting, now that it is actually going to happen.
      await notifyEveryone(
        NotificationType.SYSTEM_RESET_SCHEDULED,
        "The platform will reset in 48 hours",
        [
          `The vote passed: ${tally.support} for, ${tally.oppose} against.`,
          "",
          "WHAT YOU WILL LOSE",
          ...RESET_DISCLOSURE.lost.map((line) => `• ${line}`),
          "",
          "WHAT YOU KEEP",
          ...RESET_DISCLOSURE.kept.map((line) => `• ${line}`),
          "",
          "AFTERWARDS",
          ...RESET_DISCLOSURE.afterwards.map((line) => `• ${line}`),
        ].join("\n"),
        { systemResetId: reset.id }
      );
    }
  }

  return due.length;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecutionReport {
  delegationsEnded: number;
  votesCleared: number;
  referencesZeroed: number;
  positionEventsTouched: 0;
}

/**
 * Run a reset whose 48 hours have passed.
 *
 * THE JOURNAL IS WRITTEN INSIDE THE SAME TRANSACTION AS THE DESTRUCTION. This
 * is the one rule that makes "reversible" true rather than aspirational: a
 * journal written afterwards is a journal missing exactly the rows a crash ate.
 */
export async function executeSystemReset(resetId: string): Promise<ExecutionReport | null> {
  const claimed = await prisma.systemReset.updateMany({
    where: { id: resetId, status: "scheduled", executeAfter: { lte: new Date() } },
    data: { status: "executed", executedAt: new Date() },
  });
  // Not ours to run: already executed, not yet due, or never passed.
  if (claimed.count === 0) return null;

  const report = await prisma.$transaction(
    async (tx) => {
      const delegations = await tx.delegation.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      if (delegations.length > 0) {
        await tx.systemResetJournalDelegation.createMany({
          data: delegations.map((delegation) => ({ resetId, delegationId: delegation.id })),
          skipDuplicates: true,
        });
        await tx.delegation.updateMany({
          where: { id: { in: delegations.map((d) => d.id) } },
          data: { isActive: false },
        });
      }

      const votes = await tx.governmentReferenceVote.findMany({
        select: {
          id: true,
          governmentReferenceId: true,
          userId: true,
          position: true,
          isAnonymous: true,
          createdAt: true,
        },
      });
      if (votes.length > 0) {
        await tx.systemResetJournalVote.createMany({
          data: votes.map((vote) => ({
            resetId,
            governmentReferenceId: vote.governmentReferenceId,
            userId: vote.userId,
            position: vote.position,
            isAnonymous: vote.isAnonymous,
            castAt: vote.createdAt,
          })),
          skipDuplicates: true,
        });
        await tx.governmentReferenceVote.deleteMany({
          where: { id: { in: votes.map((v) => v.id) } },
        });
      }

      // The published counts. Set rather than recomputed because there is
      // nothing left to compute from — every vote is gone, so every tally is
      // zero by definition.
      const zeroed = await tx.governmentReference.updateMany({
        where: { OR: [{ supportVotes: { not: 0 } }, { opposeVotes: { not: 0 } }] },
        data: { supportVotes: 0, opposeVotes: 0 },
      });

      return {
        delegationsEnded: delegations.length,
        votesCleared: votes.length,
        referencesZeroed: zeroed.count,
        positionEventsTouched: 0 as const,
      };
    },
    { timeout: 120_000 }
  );

  await notifyEveryone(
    NotificationType.SYSTEM_RESET_SETTLED,
    "The platform has reset",
    [
      "Every delegation has ended and every vote count is back to zero.",
      "",
      "Your own record of every position you have ever taken is intact. You can put your own " +
        "positions back in one action from Article V — only the ones you cast yourself.",
    ].join("\n"),
    { systemResetId: resetId }
  );

  return report;
}

/** Run any reset whose disclosure period has elapsed. */
export async function sweepDueResets(): Promise<number> {
  await decideExpiredResets();

  const due = await prisma.systemReset.findMany({
    where: { status: "scheduled", executeAfter: { lte: new Date() } },
    select: { id: true },
  });

  for (const reset of due) {
    await executeSystemReset(reset.id).catch((error) =>
      console.error(`[system-reset] executing ${reset.id} failed:`, error)
    );
  }
  return due.length;
}

export function startSystemResetSweep(): void {
  schedule({
    name: "system-reset-sweep",
    firstRunAfterMs: FIRST_RUN.systemReset,
    // Every fifteen minutes. The windows are two weeks and 48 hours, so this
    // only decides how late a reset can be — and a reset that runs a quarter of
    // an hour after its notice said it would is a promise kept closely enough.
    everyMs: 15 * 60 * 1000,
    run: sweepDueResets,
  });
}

// ---------------------------------------------------------------------------
// Putting your own voice back
// ---------------------------------------------------------------------------

/**
 * How much of your own record you could restore.
 *
 * Only ever your own. Every journaled vote is a DIRECT vote — delegated voice
 * is computed and never stored — so this can only ever return positions the
 * caller cast themselves.
 */
export async function restorableFor(
  userId: string
): Promise<{ resetId: string; executedAt: Date | null; available: number; restored: number } | null> {
  const latest = await prisma.systemReset.findFirst({
    where: { status: "executed", revertedAt: null },
    orderBy: { executedAt: "desc" },
    select: { id: true, executedAt: true },
  });
  if (!latest) return null;

  const [available, restored] = await Promise.all([
    prisma.systemResetJournalVote.count({
      where: { resetId: latest.id, userId, restoredAt: null },
    }),
    prisma.systemResetJournalVote.count({
      where: { resetId: latest.id, userId, restoredAt: { not: null } },
    }),
  ]);

  return { resetId: latest.id, executedAt: latest.executedAt, available, restored };
}

/**
 * Put the caller's own positions back. Opt in, idempotent, theirs alone.
 *
 * A position they have already cast again since the reset wins — the newer act
 * is the truer one, and silently overwriting it with an older opinion would be
 * the platform putting words in somebody's mouth.
 */
export async function restoreMyPositions(
  userId: string
): Promise<{ restored: number; skipped: number }> {
  const latest = await prisma.systemReset.findFirst({
    where: { status: "executed", revertedAt: null },
    orderBy: { executedAt: "desc" },
    select: { id: true },
  });
  if (!latest) return { restored: 0, skipped: 0 };

  const mine = await prisma.systemResetJournalVote.findMany({
    where: { resetId: latest.id, userId, restoredAt: null },
  });
  if (mine.length === 0) return { restored: 0, skipped: 0 };

  let restored = 0;
  let skipped = 0;
  const touched = new Set<string>();

  for (const entry of mine) {
    const current = await prisma.governmentReferenceVote.findUnique({
      where: {
        governmentReferenceId_userId: {
          governmentReferenceId: entry.governmentReferenceId,
          userId,
        },
      },
      select: { id: true },
    });

    if (current) {
      skipped += 1;
      await prisma.systemResetJournalVote.update({
        where: { id: entry.id },
        data: { restoredAt: new Date() },
      });
      continue;
    }

    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: entry.governmentReferenceId,
        userId,
        position: entry.position,
        isAnonymous: entry.isAnonymous,
        createdAt: entry.castAt,
      },
    });
    await prisma.systemResetJournalVote.update({
      where: { id: entry.id },
      data: { restoredAt: new Date() },
    });
    touched.add(entry.governmentReferenceId);
    restored += 1;
  }

  await recomputeTallies([...touched]);
  return { restored, skipped };
}

/**
 * RECOMPUTE, never hand-edit.
 *
 * The published counts are derived from the votes and the delegation graph. The
 * merge journal learned this the hard way: restoring a stored number puts back
 * a count that was right at the moment it was captured and is wrong now.
 */
async function recomputeTallies(referenceIds: string[]): Promise<void> {
  if (referenceIds.length === 0) return;
  const edges = await prisma.delegation.findMany({
    where: { isActive: true },
    select: { fromUserId: true, toUserId: true, category: true },
  });
  for (const referenceId of referenceIds) {
    await applyWeightedTally(referenceId, edges);
  }
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/**
 * Put an executed reset back.
 *
 * THIS IS NOT A VETO, AND THE DISTINCTION MATTERS. Nothing here can stop a
 * proceeding, refuse a result, or keep a reset from running — those routes do
 * not exist at any permission level. This is disaster recovery for an
 * irreversible bulk delete, which this codebase already decided a destructive
 * operation must have when it built the merge journal.
 *
 * The tension is real and worth naming rather than hiding: an owner who undoes
 * a reset the people voted for HAS overturned them. It is the owner's alone, it
 * is recorded with their name against it, and the people can vote again.
 *
 * Refuses to replay, and RECOMPUTES the tallies rather than restoring stored
 * numbers — the five mechanics the merge journal already proves.
 */
export async function undoSystemReset(
  resetId: string,
  by: string
): Promise<{ delegationsRestored: number; votesRestored: number; referencesRecomputed: number }> {
  const reset = await prisma.systemReset.findUnique({
    where: { id: resetId },
    select: { id: true, status: true, revertedAt: true },
  });
  if (!reset) throw new Error("No such reset.");
  if (reset.status !== "executed") throw new Error("That reset has not been executed.");
  if (reset.revertedAt) throw new Error("That reset has already been put back.");

  const claimed = await prisma.systemReset.updateMany({
    where: { id: resetId, revertedAt: null },
    data: { revertedAt: new Date(), revertedBy: by },
  });
  if (claimed.count === 0) throw new Error("That reset has already been put back.");

  const [delegations, votes] = await Promise.all([
    prisma.systemResetJournalDelegation.findMany({ where: { resetId } }),
    prisma.systemResetJournalVote.findMany({ where: { resetId, restoredAt: null } }),
  ]);

  const delegationsRestored = delegations.length
    ? (
        await prisma.delegation.updateMany({
          where: { id: { in: delegations.map((d) => d.delegationId) } },
          data: { isActive: true },
        })
      ).count
    : 0;

  let votesRestored = 0;
  const touched = new Set<string>();
  for (const entry of votes) {
    const created = await prisma.governmentReferenceVote
      .create({
        data: {
          governmentReferenceId: entry.governmentReferenceId,
          userId: entry.userId,
          position: entry.position,
          isAnonymous: entry.isAnonymous,
          createdAt: entry.castAt,
        },
      })
      // A position cast again since the reset is the newer act and wins.
      .catch(() => null);
    if (created) votesRestored += 1;
    touched.add(entry.governmentReferenceId);
  }

  await recomputeTallies([...touched]);

  return {
    delegationsRestored,
    votesRestored,
    referencesRecomputed: touched.size,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function currentReset() {
  return prisma.systemReset.findFirst({
    where: { status: { in: ["voting", "scheduled"] } },
    orderBy: { openedAt: "desc" },
  });
}
