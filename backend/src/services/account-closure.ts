/**
 * CLOSING AN ACCOUNT THAT OTHER PEOPLE ARE STILL RELYING ON.
 *
 * Closing an account is normally immediate and total — services/account-deletion.ts
 * does that, and it is the ordinary path. This file is the one exception, and
 * the owner set it out plainly: "Deleting accounts works routinely, but if
 * someone has an open article or report going then their profile is still
 * visible to the public. Their account is effectively suspended, but other
 * users can take a look at their profile while the proceedings are still live.
 * When proceedings close out then the profile disappears."
 *
 * WHY THE PLATFORM IS ENTITLED TO DO THIS. Constitution Article V §3: "No
 * Proceeding under this Article may be halted, delayed or reversed by any
 * Officer, at any level of authority." An accused person who could delete their
 * way out mid-case halts the proceeding without being an officer at all — they
 * simply stop existing, and everyone who was voting or judging is left holding
 * a case about nobody. Amendment III puts the other half: the vote details of
 * any action are a public record, and a live vote whose subject cannot be
 * looked at is not a record anybody can check.
 *
 * WHAT THE HOLD IS NOT. It is not a cooling-off period and it is not a second
 * chance. The owner: "the deletion cannot be undone just because the
 * proceedings are ongoing. The limbo profile is for the benefit of others, not
 * themselves. They chose to delete and that's a real lasting choice." From the
 * moment they confirm, the account is closed to them for good — no sign-in, no
 * posting, no voting, nothing written to their record. What survives is a page
 * other people can read, and it survives exactly as long as their business with
 * those people does.
 *
 * WHAT COUNTS AS BEING A PARTY. Both directions, decided by the owner:
 * something they filed, or something filed about them. Sitting on a jury is
 * NOT one of these — a juror is not a party, their name is not on the case, and
 * account-deletion.ts already handles that properly by recusing the seat and
 * drawing a replacement.
 *
 * WHY A SWEEP AND NOT A HOOK ON EVERY CLOSE. Proceedings finish in six
 * different places — a verdict, an expiry, a super-majority, a 48-hour notice
 * elapsing, an admin closing a report, a jury being abandoned. Hanging a
 * deletion off each one means the day somebody adds a seventh, an account stays
 * up forever and nobody notices, because the failure is silent and the person
 * it happens to has already left. One sweep asks one question — is anything
 * still holding this account — and gets the same answer no matter how the
 * proceeding ended.
 */

import { prisma } from "../prisma";
import { deleteAccount, type DeletionOutcome } from "./account-deletion";
import { FIRST_RUN, schedule } from "./scheduled-work";

/** Impeachment states where the proceeding is still live. */
const OPEN_IMPEACHMENT = ["open"];

/**
 * Reset states where the proceeding is still live.
 *
 * "scheduled" counts. It is the 48 hours between the people deciding and the
 * reset running, and it is precisely when everyone most wants to see who
 * brought it.
 */
const OPEN_RESET = ["voting", "scheduled"];

/** Report states where the complaint has not been settled. */
const OPEN_REPORT = ["open"];

export type ProceedingRole = "filed" | "subject";

export interface HoldingProceeding {
  kind: "impeachment" | "system_reset" | "report";
  id: string;
  /** Did they bring it, or is it about them? */
  role: ProceedingRole;
  /** Plain words for the person reading the warning. */
  label: string;
  openedAt: string;
  /**
   * When this proceeding is currently due to end, if it has a clock.
   *
   * Null is a real answer and is shown as one. A report waits on a jury and a
   * jury waits on people, so there is no honest date to put on it — inventing
   * "about a week" would be exactly the plausible value the governing rule
   * forbids.
   */
  expectedBy: string | null;
}

/**
 * Everything that stops this account from being erased right now.
 *
 * Empty means an ordinary immediate deletion. Anything in it means the hold.
 * Read before the person confirms, so the warning can name what is holding
 * them, and read again by the sweep to decide whether the hold is over.
 */
export async function proceedingsHolding(userId: string): Promise<HoldingProceeding[]> {
  const [filedImpeachments, againstThem, filedResets, filedReports, aboutThem] = await Promise.all([
    prisma.impeachment.findMany({
      where: { filedById: userId, status: { in: OPEN_IMPEACHMENT } },
      select: { id: true, openedAt: true, expiresAt: true },
    }),
    prisma.impeachment.findMany({
      where: { leaderId: userId, status: { in: OPEN_IMPEACHMENT } },
      select: { id: true, openedAt: true, expiresAt: true },
    }),
    prisma.systemReset.findMany({
      where: { filedById: userId, status: { in: OPEN_RESET } },
      select: { id: true, openedAt: true, expiresAt: true, executeAfter: true },
    }),
    prisma.report.findMany({
      where: { reporterId: userId, status: { in: OPEN_REPORT } },
      select: { id: true, createdAt: true },
    }),
    prisma.report.findMany({
      where: { reportedUserId: userId, status: { in: OPEN_REPORT } },
      select: { id: true, createdAt: true },
    }),
  ]);

  const held: HoldingProceeding[] = [];

  for (const row of filedImpeachments) {
    held.push({
      kind: "impeachment",
      id: row.id,
      role: "filed",
      label: "Articles of impeachment you brought",
      openedAt: row.openedAt.toISOString(),
      expectedBy: row.expiresAt.toISOString(),
    });
  }

  for (const row of againstThem) {
    held.push({
      kind: "impeachment",
      id: row.id,
      role: "subject",
      label: "Articles of impeachment brought against you",
      openedAt: row.openedAt.toISOString(),
      expectedBy: row.expiresAt.toISOString(),
    });
  }

  for (const row of filedResets) {
    held.push({
      kind: "system_reset",
      id: row.id,
      role: "filed",
      label: "The system reset you called for",
      openedAt: row.openedAt.toISOString(),
      // Once a reset is scheduled the vote is over and the date that matters is
      // when it runs, not when the voting would have closed.
      expectedBy: (row.executeAfter ?? row.expiresAt).toISOString(),
    });
  }

  for (const row of filedReports) {
    held.push({
      kind: "report",
      id: row.id,
      role: "filed",
      label: "A report you filed",
      openedAt: row.createdAt.toISOString(),
      expectedBy: null,
    });
  }

  for (const row of aboutThem) {
    held.push({
      kind: "report",
      id: row.id,
      role: "subject",
      label: "A report filed about you",
      openedAt: row.createdAt.toISOString(),
      expectedBy: null,
    });
  }

  return held;
}

export interface ClosureOutcome {
  ok: boolean;
  message?: string;
  /** True when the account was erased on the spot. */
  deleted: boolean;
  /** What is holding it, when it was not. */
  held: HoldingProceeding[];
  /** Present only when the deletion actually ran. */
  deletion?: DeletionOutcome;
}

/**
 * Close an account: erase it now, or hold it until its proceedings are decided.
 *
 * The one door both the person's own "close my account" and the admin console
 * come through, so the two can never mean different things.
 */
export async function closeAccount(userId: string): Promise<ClosureOutcome> {
  const held = await proceedingsHolding(userId);

  if (held.length === 0) {
    const deletion = await deleteAccount(userId);
    return { ok: deletion.ok, message: deletion.message, deleted: true, held: [], deletion };
  }

  // ALREADY ASKED FOR. Re-confirming does not restart anything and does not
  // move the date — the first request is the one that counts.
  const already = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionRequestedAt: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { deletionRequestedAt: already?.deletionRequestedAt ?? new Date() },
  });

  // OUT OF THE ACCOUNT IMMEDIATELY. The decision takes effect now even though
  // the record has not gone yet; leaving them signed in would make the hold
  // look like a change of mind was still possible.
  await prisma.session.deleteMany({ where: { userId } });

  return { ok: true, deleted: false, held };
}

/**
 * Whether this account is closing but not yet closed.
 *
 * Read on every request by the middleware, and by the profile so it can say so
 * out loud. Kept as one small query because it runs constantly.
 */
export async function isClosing(userId: string): Promise<Date | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { deletionRequestedAt: true },
  });
  return row?.deletionRequestedAt ?? null;
}

export interface SweepOutcome {
  /** Accounts still waiting on a proceeding. */
  stillHeld: number;
  /** Accounts erased on this pass. */
  deleted: number;
  /** Accounts that could not be erased, with the reason. */
  failed: { userId: string; message: string }[];
}

/**
 * Erase every held account whose last proceeding has closed.
 *
 * Runs on a schedule rather than off each proceeding's ending, so that a
 * proceeding type added later is covered without anybody remembering to wire
 * it up. See the note at the top of this file.
 */
export async function sweepClosedAccounts(): Promise<SweepOutcome> {
  const waiting = await prisma.user.findMany({
    where: { deletionRequestedAt: { not: null } },
    select: { id: true },
  });

  const outcome: SweepOutcome = { stillHeld: 0, deleted: 0, failed: [] };

  for (const person of waiting) {
    const held = await proceedingsHolding(person.id);
    if (held.length > 0) {
      outcome.stillHeld += 1;
      continue;
    }

    // One account failing must not strand the rest. A deletion that throws is
    // reported and left in place to be retried next pass, which is the right
    // outcome for a transient database error and a loud one for a real bug.
    try {
      const deletion = await deleteAccount(person.id);
      if (deletion.ok) {
        outcome.deleted += 1;
      } else {
        outcome.failed.push({ userId: person.id, message: deletion.message ?? "refused" });
      }
    } catch (error) {
      outcome.failed.push({
        userId: person.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcome;
}

/**
 * Run the sweep on a schedule that survives a restart.
 *
 * Hourly, and staggered to land just after the impeachment, reset and jury
 * sweeps — those are what actually close a proceeding, and this is what notices
 * that the last one holding somebody is finally over.
 *
 * A LATE SWEEP IS SOMEBODY'S RECORD STILL PUBLIC AFTER THEY ASKED IT NOT TO BE.
 * The hold is justified only while a proceeding needs it; an hour past that it
 * is just retention, which is the thing Amendment IV forbids. So this runs on a
 * clock rather than waiting for the next admin action, and through `schedule()`
 * rather than a bare setInterval, because a container that restarts several
 * times an hour never reaches an interval whose first run is hours away.
 */
export function scheduleAccountClosureSweeps(): void {
  schedule({
    name: "account closure sweep",
    firstRunAfterMs: FIRST_RUN.accountClosure,
    everyMs: 60 * 60 * 1000,
    run: async () => {
      const outcome = await sweepClosedAccounts();
      if (outcome.deleted > 0 || outcome.failed.length > 0) {
        console.log(
          `[AccountClosure] erased ${outcome.deleted}, still held ${outcome.stillHeld}` +
            (outcome.failed.length ? `, failed ${outcome.failed.length}` : ""),
        );
      }
      for (const failure of outcome.failed) {
        console.error(`[AccountClosure] could not erase ${failure.userId}: ${failure.message}`);
      }
    },
  });
}
