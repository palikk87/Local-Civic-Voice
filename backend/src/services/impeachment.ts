/**
 * ARTICLE V — IMPEACHMENT.
 *
 * Constitution Article V: political power on this platform is borrowed, and
 * what is borrowed can be recalled. This is the recall.
 *
 * WHAT IT TAKES AWAY, AND WHAT IT DOES NOT. A passed impeachment suspends one
 * person from RECEIVING delegated voice, and does nothing else at all. The
 * account stays open. The followers stay. Posts, comments, shares, likes and
 * the person's own vote are untouched — including their right to delegate that
 * vote to somebody else. For the length of the suspension nobody may lend them
 * a vote, and the delegations they were holding go back to the people who lent
 * them. That is the whole penalty, and the narrowness is the point: this is a
 * loan being called in, not a citizen being silenced.
 *
 * THE ELECTORATE IS FROZEN AT FILING. Only people who were delegating to the
 * leader at the moment proceedings opened may vote, and the rows recording that
 * are created once and never added to. This is the single rule that makes the
 * mechanism safe to hand to the public: without it, a leader under a fair
 * proceeding could recruit sympathetic new delegators to dilute the
 * denominator, and a mob could pile in to manufacture a threshold. Neither
 * works against a snapshot.
 *
 * NOBODY CAN STOP A PROCEEDING. Not an admin, not the owner, not the accused.
 * The remedy against a bad-faith filing is against the FILER — the articles go
 * to the admin queue and a malicious filer can be suspended or banned — and it
 * runs alongside the proceeding rather than cancelling it. The right to bring
 * a charge does not belong to the people being charged.
 */

import { prisma } from "../prisma";
import { createNotification, NotificationType } from "./notification-service";
import { republishTalliesAfterDelegationChange } from "./delegation-service";
import { sendNoticeEmail } from "./email";
import { schedule, FIRST_RUN } from "./scheduled-work";

/**
 * How long a proceeding stands. Article V proceedings are not open-ended: one
 * that never closes is a permanent accusation, which is its own punishment.
 */
export const IMPEACHMENT_WINDOW_DAYS = 7;

/**
 * Two thirds of the frozen electorate.
 *
 * MUST MATCH `canImpeachLeader` in packages/civic-core/src/bill-of-rights.ts.
 * The backend cannot import that package (no workspace linking), so the number
 * is duplicated and a test asserts the two are equal rather than trusting them
 * to stay in step.
 */
export const IMPEACHMENT_THRESHOLD = 0.66;

/** Bounds on what a voter may propose. A day is the smallest meaningful unit. */
export const MIN_SUSPENSION_DAYS = 1;
export const MAX_SUSPENSION_DAYS = 365;

/** Articles have to actually say something, and cannot be a wall of text. */
export const MIN_ARTICLE_LENGTH = 40;
export const MAX_ARTICLE_LENGTH = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

export type ImpeachmentStatus = "open" | "passed" | "expired";

export interface FileArgs {
  leaderId: string;
  filedById: string;
  /** Articles of Impeachment: what the leader is accused of. */
  grounds: string;
  /** Articles of Impeachment: what the filer says shows it. */
  evidence: string;
}

export type FileResult =
  | { ok: true; impeachmentId: string; electorCount: number; expiresAt: Date }
  | { ok: false; code: FileFailure; message: string };

export type FileFailure =
  | "leader_not_found"
  | "self_filing"
  | "not_a_delegator"
  | "already_open"
  | "articles_too_short"
  | "articles_too_long";

/**
 * Open proceedings against a leader.
 *
 * Everything here is one transaction. A proceeding that exists without its
 * electorate is a vote nobody may cast, and a snapshot taken outside the
 * transaction that creates the proceeding is a snapshot that can miss a
 * delegation created in between.
 */
export async function fileImpeachment(args: FileArgs): Promise<FileResult> {
  const grounds = args.grounds.trim();
  const evidence = args.evidence.trim();

  if (grounds.length < MIN_ARTICLE_LENGTH || evidence.length < MIN_ARTICLE_LENGTH) {
    return {
      ok: false,
      code: "articles_too_short",
      message:
        `Articles of Impeachment must state the grounds and the evidence, at least ` +
        `${MIN_ARTICLE_LENGTH} characters each. This is a formal accusation that will be ` +
        `delivered to the person accused and reviewed by administrators.`,
    };
  }
  if (grounds.length > MAX_ARTICLE_LENGTH || evidence.length > MAX_ARTICLE_LENGTH) {
    return {
      ok: false,
      code: "articles_too_long",
      message: `Each section of the Articles of Impeachment is limited to ${MAX_ARTICLE_LENGTH} characters.`,
    };
  }

  if (args.leaderId === args.filedById) {
    return { ok: false, code: "self_filing", message: "You cannot impeach yourself." };
  }

  const leader = await prisma.user.findUnique({
    where: { id: args.leaderId },
    select: { id: true, name: true, username: true, email: true },
  });
  if (!leader) {
    return { ok: false, code: "leader_not_found", message: "That account does not exist." };
  }

  // STANDING. Only somebody who actually lent this person their voice may move
  // to take it back. A stranger has lost nothing and is not owed the remedy.
  const standing = await prisma.delegation.findFirst({
    where: { fromUserId: args.filedById, toUserId: args.leaderId, isActive: true },
    select: { id: true },
  });
  if (!standing) {
    return {
      ok: false,
      code: "not_a_delegator",
      message:
        "Only somebody currently delegating to this person can open proceedings against them. " +
        "Impeachment recalls borrowed power, so it belongs to the people who lent it.",
    };
  }

  const filer = await prisma.user.findUnique({
    where: { id: args.filedById },
    select: { id: true, name: true, username: true },
  });
  if (!filer) {
    return { ok: false, code: "not_a_delegator", message: "That account does not exist." };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + IMPEACHMENT_WINDOW_DAYS * DAY_MS);

  let created: { id: string; electorIds: string[] } | null = null;

  try {
    created = await prisma.$transaction(async (tx) => {
      // ONE AT A TIME, PER LEADER. Not one platform-wide: a global lock would
      // let anybody shield a real target by opening a frivolous case against
      // somebody nobody cares about, and hold the whole mechanism hostage.
      const existing = await tx.impeachment.findFirst({
        where: { leaderId: args.leaderId, status: "open" },
        select: { id: true },
      });
      if (existing) return null;

      const delegations = await tx.delegation.findMany({
        where: { toUserId: args.leaderId, isActive: true },
        select: { fromUserId: true },
      });

      // A person delegating in several categories is still one voter.
      const electorIds = [...new Set(delegations.map((d) => d.fromUserId))];

      const impeachment = await tx.impeachment.create({
        data: {
          leaderId: args.leaderId,
          filedById: args.filedById,
          status: "open",
          grounds,
          evidence,
          openedAt: now,
          expiresAt,
        },
        select: { id: true },
      });

      await tx.impeachmentElector.createMany({
        data: electorIds.map((voterId) => ({ impeachmentId: impeachment.id, voterId })),
        skipDuplicates: true,
      });

      return { id: impeachment.id, electorIds };
    });
  } catch (error) {
    // A unique-violation race on the partial one-open rule lands here rather
    // than as a silent second proceeding.
    console.error("[impeachment] filing failed:", error);
    return {
      ok: false,
      code: "already_open",
      message: "Proceedings could not be opened. Try again.",
    };
  }

  if (!created) {
    return {
      ok: false,
      code: "already_open",
      message:
        "Proceedings are already open against this person. One at a time — the current " +
        "vote has to finish before another can be brought.",
    };
  }

  const leaderName = displayName(leader);
  const filerName = displayName(filer);

  // SERVICE OF THE ARTICLES, before anybody is told to vote. The accused
  // hearing it from a delegator's post first would be the platform failing the
  // one procedural right Article V gives them.
  await serveArticles({
    impeachmentId: created.id,
    leader,
    filerName,
    grounds,
    evidence,
    expiresAt,
  });

  await Promise.all(
    created.electorIds.map((voterId) =>
      createNotification(
        voterId,
        NotificationType.IMPEACHMENT_OPENED,
        "Impeachment proceedings opened",
        `${filerName} has filed Articles of Impeachment against ${leaderName}, who holds your ` +
          `delegated vote. You have one week to decide. If two thirds of their delegators vote ` +
          `to impeach, they are suspended from receiving delegations.`,
        { impeachmentId: created.id, leaderId: leader.id }
      ).catch((error) => {
        console.error("[impeachment] elector notification failed:", error);
        return { created: false };
      })
    )
  );

  return {
    ok: true,
    impeachmentId: created.id,
    electorCount: created.electorIds.length,
    expiresAt,
  };
}

/**
 * Deliver the articles to the person accused: in-app, and to the address on
 * file.
 *
 * BOTH, NOT EITHER. The in-app copy is the record. The email is the reach —
 * somebody who has stopped opening the app is exactly the person a quiet
 * proceeding would run past, and a week is short.
 *
 * Never throws. Delivery is best effort and a proceeding does not wait on a
 * mail provider; the right to be heard is not the right to veto by bouncing.
 */
async function serveArticles(args: {
  impeachmentId: string;
  leader: { id: string; name: string; username: string | null; email: string };
  filerName: string;
  grounds: string;
  evidence: string;
  expiresAt: Date;
}): Promise<void> {
  const closes = args.expiresAt.toISOString().slice(0, 10);

  await createNotification(
    args.leader.id,
    NotificationType.IMPEACHMENT_SERVED,
    "Articles of Impeachment have been filed against you",
    `${args.filerName} has filed Articles of Impeachment. Your delegators vote until ${closes}. ` +
      `Grounds: ${args.grounds}\n\nEvidence: ${args.evidence}\n\n` +
      `If it passes you keep your account, your followers, your posts and your own vote — ` +
      `including delegating it to somebody else. You would be suspended from receiving ` +
      `delegations for a period your delegators set.`,
    { impeachmentId: args.impeachmentId, leaderId: args.leader.id }
  ).catch((error) => {
    console.error("[impeachment] serving the accused in-app failed:", error);
    return { created: false };
  });

  const sent = await sendNoticeEmail({
    to: args.leader.email,
    subject: "Articles of Impeachment have been filed against you",
    heading: "Articles of Impeachment",
    paragraphs: [
      `${args.filerName}, who delegates their vote to you, has filed Articles of Impeachment ` +
        `against you on AYE & NAY. You are receiving this because Article V gives you the right ` +
        `to see the accusation.`,
      `GROUNDS\n${args.grounds}`,
      `EVIDENCE\n${args.evidence}`,
      `Everyone who was delegating to you when this was filed may vote until ${closes}. ` +
        `Nobody who delegates to you after the filing gets a vote.`,
      `If two thirds of them vote to impeach, you are suspended from RECEIVING delegations for a ` +
        `period they set. Nothing else changes: your account, your followers, your posts and ` +
        `your own vote are untouched, and you may still delegate your own vote to somebody else.`,
    ],
  });

  if (!sent.ok) {
    // Recorded, not raised. The in-app service already happened and the
    // proceeding is valid; this line is how an operator finds out mail is down.
    console.error(`[impeachment] could not email the accused (${sent.code}): ${sent.detail}`);
  }
}

export type VoteResult =
  | { ok: true; votes: number; electorCount: number; passed: boolean }
  | { ok: false; code: VoteFailure; message: string };

export type VoteFailure =
  | "not_found"
  | "closed"
  | "not_an_elector"
  | "already_voted"
  | "bad_duration";

/**
 * Vote to impeach, and say for how long.
 *
 * There is no vote against. The threshold is two thirds of everybody entitled,
 * so declining to vote already counts against — an explicit no would be the
 * same silence with an extra click, and it would let the page imply a tally
 * ("40 for, 12 against") whose second number decides nothing.
 */
export async function castVote(
  impeachmentId: string,
  voterId: string,
  proposedDays: number
): Promise<VoteResult> {
  if (
    !Number.isInteger(proposedDays) ||
    proposedDays < MIN_SUSPENSION_DAYS ||
    proposedDays > MAX_SUSPENSION_DAYS
  ) {
    return {
      ok: false,
      code: "bad_duration",
      message: `Propose a suspension between ${MIN_SUSPENSION_DAYS} and ${MAX_SUSPENSION_DAYS} days.`,
    };
  }

  const impeachment = await prisma.impeachment.findUnique({
    where: { id: impeachmentId },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!impeachment) {
    return { ok: false, code: "not_found", message: "No such proceeding." };
  }
  if (impeachment.status !== "open" || impeachment.expiresAt <= new Date()) {
    return { ok: false, code: "closed", message: "Voting on this proceeding has closed." };
  }

  // THE ROW IS THE RIGHT. No separate permission check exists or should — a
  // second source of truth for "may this person vote" is how a frozen
  // electorate stops being frozen.
  const elector = await prisma.impeachmentElector.findUnique({
    where: { impeachmentId_voterId: { impeachmentId, voterId } },
    select: { id: true, votedAt: true },
  });
  if (!elector) {
    return {
      ok: false,
      code: "not_an_elector",
      message:
        "Only people who were delegating to this person when proceedings opened may vote. " +
        "Delegating afterwards does not add a vote — that rule is what stops a proceeding " +
        "being swung by whoever arrives after it starts.",
    };
  }
  if (elector.votedAt) {
    return { ok: false, code: "already_voted", message: "You have already voted." };
  }

  await prisma.impeachmentElector.update({
    where: { id: elector.id },
    data: { votedAt: new Date(), proposedDays },
  });

  const outcome = await evaluate(impeachmentId);
  return {
    ok: true,
    votes: outcome.votes,
    electorCount: outcome.electorCount,
    passed: outcome.status === "passed",
  };
}

/** Take a vote back while the window is open. */
export async function withdrawVote(
  impeachmentId: string,
  voterId: string
): Promise<VoteResult> {
  const impeachment = await prisma.impeachment.findUnique({
    where: { id: impeachmentId },
    select: { status: true, expiresAt: true },
  });
  if (!impeachment) {
    return { ok: false, code: "not_found", message: "No such proceeding." };
  }
  if (impeachment.status !== "open" || impeachment.expiresAt <= new Date()) {
    // A decided proceeding is a decided proceeding. Letting a vote out after
    // the fact would make the record of what the people decided editable.
    return { ok: false, code: "closed", message: "Voting on this proceeding has closed." };
  }

  const elector = await prisma.impeachmentElector.findUnique({
    where: { impeachmentId_voterId: { impeachmentId, voterId } },
    select: { id: true },
  });
  if (!elector) {
    return { ok: false, code: "not_an_elector", message: "You are not an elector here." };
  }

  await prisma.impeachmentElector.update({
    where: { id: elector.id },
    data: { votedAt: null, proposedDays: null },
  });

  const tally = await tallyOf(impeachmentId);
  return { ok: true, votes: tally.votes, electorCount: tally.electorCount, passed: false };
}

async function tallyOf(
  impeachmentId: string
): Promise<{ votes: number; electorCount: number; averageDays: number | null }> {
  const [electorCount, voted] = await Promise.all([
    prisma.impeachmentElector.count({ where: { impeachmentId } }),
    prisma.impeachmentElector.findMany({
      where: { impeachmentId, votedAt: { not: null } },
      select: { proposedDays: true },
    }),
  ]);

  const days = voted.map((v) => v.proposedDays ?? 0).filter((d) => d > 0);
  const averageDays =
    days.length > 0
      ? Math.max(
          MIN_SUSPENSION_DAYS,
          Math.round(days.reduce((sum, d) => sum + d, 0) / days.length)
        )
      : null;

  return { votes: voted.length, electorCount, averageDays };
}

/**
 * Two thirds of the frozen electorate. Mirrors `canImpeachLeader`.
 */
export function meetsThreshold(electorCount: number, votes: number): boolean {
  if (electorCount === 0) return false;
  return votes / electorCount >= IMPEACHMENT_THRESHOLD;
}

export interface Outcome {
  status: ImpeachmentStatus;
  votes: number;
  electorCount: number;
  suspendedUntil: Date | null;
}

/**
 * Decide where a proceeding stands, and act if it has ended.
 *
 * Called after every vote and by the sweep. Idempotent: the transition out of
 * "open" is claimed with a conditional update, so two callers arriving together
 * cannot both deactivate the delegations.
 */
export async function evaluate(impeachmentId: string): Promise<Outcome> {
  const impeachment = await prisma.impeachment.findUnique({
    where: { id: impeachmentId },
    select: {
      id: true,
      leaderId: true,
      status: true,
      expiresAt: true,
      suspendedUntil: true,
    },
  });
  if (!impeachment) {
    return { status: "expired", votes: 0, electorCount: 0, suspendedUntil: null };
  }

  const tally = await tallyOf(impeachmentId);

  if (impeachment.status !== "open") {
    return {
      status: impeachment.status as ImpeachmentStatus,
      votes: tally.votes,
      electorCount: tally.electorCount,
      suspendedUntil: impeachment.suspendedUntil,
    };
  }

  const passed = meetsThreshold(tally.electorCount, tally.votes);
  const expired = impeachment.expiresAt <= new Date();

  if (!passed && !expired) {
    return {
      status: "open",
      votes: tally.votes,
      electorCount: tally.electorCount,
      suspendedUntil: null,
    };
  }

  if (!passed) {
    const claimed = await prisma.impeachment.updateMany({
      where: { id: impeachmentId, status: "open" },
      data: { status: "expired", decidedAt: new Date() },
    });
    if (claimed.count > 0) {
      await notifyOutcome(impeachmentId, false, null);
    }
    return {
      status: "expired",
      votes: tally.votes,
      electorCount: tally.electorCount,
      suspendedUntil: null,
    };
  }

  // THE DURATION IS THE AVERAGE OF WHAT THE IMPEACHING VOTERS ASKED FOR.
  // Not a fixed term the platform chose: the people who lent the power decide
  // how long it stays recalled.
  //
  // AVERAGED OVER THE VOTES THAT CARRIED IT. A proceeding closes the instant it
  // crosses two thirds rather than running out the week, because the week is a
  // deadline, not a waiting period — once the people have recalled the loan,
  // holding a decided verdict open would be the platform sitting on their
  // decision. The cost is real and worth naming: an elector who had not voted
  // yet has no say in the length. Their vote is refused outright afterwards
  // rather than accepted and ignored, so nobody is told their say counted when
  // it did not.
  const suspendedUntil = new Date(
    Date.now() + (tally.averageDays ?? MIN_SUSPENSION_DAYS) * DAY_MS
  );

  const claimed = await prisma.impeachment.updateMany({
    where: { id: impeachmentId, status: "open" },
    data: { status: "passed", decidedAt: new Date(), suspendedUntil },
  });

  if (claimed.count === 0) {
    // Somebody else got there first. Report their result, do not redo the work.
    const settled = await prisma.impeachment.findUnique({
      where: { id: impeachmentId },
      select: { status: true, suspendedUntil: true },
    });
    return {
      status: (settled?.status as ImpeachmentStatus) ?? "passed",
      votes: tally.votes,
      electorCount: tally.electorCount,
      suspendedUntil: settled?.suspendedUntil ?? null,
    };
  }

  // RETURN THE LOAN. Every delegation to this person ends; the voice goes back
  // to the people who lent it.
  await prisma.delegation.updateMany({
    where: { toUserId: impeachment.leaderId, isActive: true },
    data: { isActive: false },
  });

  // RECOMPUTE, never hand-edit. The published tallies are derived from the
  // delegation graph, and the graph just changed.
  await republishTalliesAfterDelegationChange(impeachment.leaderId).catch((error) => {
    console.error("[impeachment] tally republish failed:", error);
    return 0;
  });

  await notifyOutcome(impeachmentId, true, suspendedUntil);

  return {
    status: "passed",
    votes: tally.votes,
    electorCount: tally.electorCount,
    suspendedUntil,
  };
}

async function notifyOutcome(
  impeachmentId: string,
  passed: boolean,
  suspendedUntil: Date | null
): Promise<void> {
  const impeachment = await prisma.impeachment.findUnique({
    where: { id: impeachmentId },
    select: {
      leaderId: true,
      leader: { select: { name: true, username: true } },
      electors: { select: { voterId: true } },
    },
  });
  if (!impeachment) return;

  const leaderName = displayName(impeachment.leader);
  const lifts = suspendedUntil ? suspendedUntil.toISOString().slice(0, 10) : null;

  const title = passed ? "Impeachment passed" : "Impeachment did not pass";
  const electorBody = passed
    ? `Two thirds of ${leaderName}'s delegators voted to impeach. Their delegations have ended ` +
      `and they cannot receive new ones until ${lifts}. Your vote is yours again — you can ` +
      `cast it directly or delegate it to somebody else.`
    : `The week has closed without reaching two thirds. ${leaderName} keeps their delegations. ` +
      `Your delegation is unchanged; you can still withdraw it yourself at any time.`;

  const leaderBody = passed
    ? `Two thirds of your delegators voted to impeach. You are suspended from receiving ` +
      `delegations until ${lifts}, and the delegations you held have been returned. ` +
      `Nothing else has changed: your account, your followers, your posts and your own vote ` +
      `are untouched, and you can still delegate your own vote to somebody else.`
    : `The proceedings against you have closed without reaching two thirds. Nothing changes.`;

  await createNotification(
    impeachment.leaderId,
    NotificationType.IMPEACHMENT_DECIDED,
    title,
    leaderBody,
    { impeachmentId, leaderId: impeachment.leaderId }
  ).catch(() => ({ created: false }));

  await Promise.all(
    impeachment.electors.map((elector) =>
      createNotification(
        elector.voterId,
        NotificationType.IMPEACHMENT_DECIDED,
        title,
        electorBody,
        { impeachmentId, leaderId: impeachment.leaderId }
      ).catch(() => ({ created: false }))
    )
  );
}

export interface SuspensionState {
  suspended: boolean;
  /** When it lifts. Null when not suspended. */
  until: Date | null;
  /** The proceeding that did it, so the UI can link to the articles. */
  impeachmentId: string | null;
}

/**
 * Is this person barred from receiving delegations right now?
 *
 * READ LIVE, NEVER SWEPT. There is no `isSuspended` column and no job that
 * clears one. A suspension lapses because the date passed, not because a
 * process remembered to notice — a stored flag that a crashed job failed to
 * clear is a sentence outliving its term, and this codebase has already been
 * burned once by a schedule outliving the process it ran in.
 */
export async function suspensionState(userId: string): Promise<SuspensionState> {
  const active = await prisma.impeachment.findFirst({
    where: {
      leaderId: userId,
      status: "passed",
      suspendedUntil: { gt: new Date() },
    },
    orderBy: { suspendedUntil: "desc" },
    select: { id: true, suspendedUntil: true },
  });

  if (!active) return { suspended: false, until: null, impeachmentId: null };
  return { suspended: true, until: active.suspendedUntil, impeachmentId: active.id };
}

/** Same question, for callers that only need yes or no. */
export async function isSuspendedFromDelegation(userId: string): Promise<boolean> {
  return (await suspensionState(userId)).suspended;
}

/**
 * Close proceedings whose week has run out.
 *
 * A proceeding that reaches two thirds closes on the vote that got it there,
 * so this only ever finds the ones that did not. Without it an unsuccessful
 * proceeding would sit "open" forever and block the next one.
 */
export async function sweepExpiredImpeachments(): Promise<number> {
  const due = await prisma.impeachment.findMany({
    where: { status: "open", expiresAt: { lte: new Date() } },
    select: { id: true },
    take: 200,
  });

  for (const proceeding of due) {
    await evaluate(proceeding.id).catch((error) =>
      console.error(`[impeachment] closing ${proceeding.id} failed:`, error)
    );
  }
  return due.length;
}

/** Start the sweep. Called once at boot from index.ts. */
export function startImpeachmentSweep(): void {
  schedule({
    name: "impeachment-sweep",
    firstRunAfterMs: FIRST_RUN.impeachment,
    // Hourly. The window is a week, so the cost of closing a proceeding up to
    // an hour late is a day counter that reads one hour long — and the page
    // computes "closed" from expiresAt anyway, so nobody can vote in the gap.
    everyMs: 60 * 60 * 1000,
    run: sweepExpiredImpeachments,
  });
}

function displayName(user: { name: string; username: string | null }): string {
  return user.username ? `@${user.username}` : user.name;
}
