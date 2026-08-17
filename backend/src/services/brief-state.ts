/**
 * What state is this reference's brief in, and can it be trusted?
 *
 * THE FAILURE THIS EXISTS FOR. `contentStatus` had two working values,
 * "fetching" and "brief_pending", and nothing recorded when the work behind
 * them started. Work in flight ends; a claim that work is in flight does not.
 * A job lost to a restart, a crash, or a deploy left the row asserting it was
 * busy permanently — and the client, which polls while the server says busy,
 * spun forever. Reloading the page did not help, because the stuck state was
 * stored in the database rather than held in the browser.
 *
 * A start time makes "busy" checkable rather than eternal. Past the timeout it
 * is abandoned work, not current work, and the reader is offered the button
 * again instead of a spinner.
 *
 * The four states this collapses to are the four things a reader can be shown:
 *
 *   ready        a brief written for the version of the law in front of you
 *   working      somebody asked for one and it is genuinely being written now
 *   unavailable  no official source has the text, so there is nothing to write from
 *   idle         nobody has asked yet — show the button
 *
 * `idle` is the state the old code could never reach again once it left, which
 * is precisely why the spinner never stopped.
 */

import { prisma } from "../prisma";

export type BriefState = "ready" | "working" | "unavailable" | "idle";

/** The two contentStatus values that describe work rather than an outcome. */
export const WORKING_STATUSES = ["fetching", "brief_pending"] as const;
export type WorkingStatus = (typeof WORKING_STATUSES)[number];

/**
 * How long work may claim to be in flight before it is presumed abandoned.
 *
 * Generous on purpose: a long bill goes to the model in several passes and is
 * then fact-checked, which legitimately takes a while. The cost of waiting too
 * long is one reader seeing a spinner for an extra minute; the cost of waiting
 * too short is two jobs writing the same brief. Neither is as bad as the old
 * behaviour, which was waiting forever.
 */
export const WORK_TIMEOUT_MS = 5 * 60 * 1000;

export interface BriefStateRow {
  contentStatus: string | null;
  contentStartedAt: Date | null;
  citizenBriefJson: string | null;
  citizenBriefVersion: number | null;
  lawVersion: number;
}

/** True when the row claims to be working and that claim has aged out. */
export function isAbandoned(row: Pick<BriefStateRow, "contentStatus" | "contentStartedAt">): boolean {
  if (!isWorking(row.contentStatus)) return false;
  // No start time at all means the row predates this column, so there is no
  // evidence any work is happening — treat it as abandoned rather than trust it.
  if (!row.contentStartedAt) return true;
  return Date.now() - row.contentStartedAt.getTime() > WORK_TIMEOUT_MS;
}

export function isWorking(status: string | null): status is WorkingStatus {
  return status === "fetching" || status === "brief_pending";
}

/**
 * What to tell the client.
 *
 * A stored brief wins over any status: if there is a brief written for this
 * version of the law, the reader can have it now whatever the row says about
 * background work. Everything else follows from the status, with abandoned
 * work reported as idle so the button comes back.
 */
export function briefState(row: BriefStateRow): BriefState {
  const hasCurrentBrief =
    Boolean(row.citizenBriefJson) && row.citizenBriefVersion === row.lawVersion;
  if (hasCurrentBrief) return "ready";

  if (isWorking(row.contentStatus)) return isAbandoned(row) ? "idle" : "working";
  if (row.contentStatus === "unavailable") return "unavailable";

  // Everything else is idle, including "ready" with no brief for this version —
  // that means the law moved after the brief was written, so what is stored
  // describes an earlier text and the honest offer is to write a new one. The
  // old brief is still returned by the detail route, with both version numbers,
  // so the reader can see what they have and that it is behind.
  return "idle";
}

/**
 * Enter a working state, recording when.
 *
 * Every write of a working status goes through here. That is the whole point:
 * the old code set "fetching" in four places and none of them wrote down the
 * time, so none of them could be aged out.
 */
export async function markWorking(referenceId: string, status: WorkingStatus): Promise<void> {
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { contentStatus: status, contentStartedAt: new Date() },
  });
}

/**
 * Leave a working state for an outcome.
 *
 * Clearing the start time matters as much as setting the status: a settled row
 * that kept an old timestamp would be aged out into `idle` by the next reader
 * and quietly re-run work that had already finished.
 */
export async function markSettled(
  referenceId: string,
  status: "ready" | "unavailable"
): Promise<void> {
  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { contentStatus: status, contentStartedAt: null },
  });
}

/**
 * Release rows whose work was abandoned, in bulk.
 *
 * Called at boot, because the most common way work is abandoned is the process
 * that was doing it going away — and the process that replaces it is the one
 * reading this. Without it, every row a deploy interrupted stays a spinner
 * until someone opens it and waits out the timeout.
 */
export async function releaseAbandonedWork(): Promise<number> {
  const cutoff = new Date(Date.now() - WORK_TIMEOUT_MS);
  const { count } = await prisma.governmentReference.updateMany({
    where: {
      contentStatus: { in: [...WORKING_STATUSES] },
      OR: [{ contentStartedAt: null }, { contentStartedAt: { lt: cutoff } }],
    },
    data: { contentStatus: null, contentStartedAt: null },
  });
  return count;
}
