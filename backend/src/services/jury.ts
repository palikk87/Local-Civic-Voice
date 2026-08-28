/**
 * THE JUDICIARY — Community Juries. Constitution Article IV.
 *
 * "Disputes are settled by randomly chosen trusted users."
 *
 * The report button has existed since the first build. Its reports went into a
 * queue NO SCREEN ANYWHERE SHOWED — written down, and then nothing happened to
 * them, for anybody, ever. This file is the branch of government that clause
 * promised, and those reports are what it hears.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CIVIL LEADER IS SOMEBODY HOLDING FIFTY DELEGATIONS OR MORE.
 *
 * The platform has used the phrase since the beginning without ever defining
 * it, which meant it could be stretched to fit whatever anybody wanted it to
 * mean. It is a number now. Below it you carry every one of the same duties and
 * are just as accountable — you simply do not hold the title. The number buys a
 * bigger jury and the name, and nothing else: impeachment still reaches anybody
 * holding a single delegation, because borrowed power is borrowed at any size.
 *
 * THE PANEL SCALES WITH REACH. A comment and a civil leader's post do not carry
 * the same weight, so they do not get the same jury.
 *
 * A CIVIL LEADER'S JURORS CANNOT BE THEIR OWN DELEGATORS, and this is the exact
 * opposite of impeachment on purpose. Impeachment asks "should we take our loan
 * back", so only the people who lent get a say. A jury asks "did this person
 * break the rules", so the people who lent are precisely the ones who must not
 * sit — they have already declared an interest in the answer.
 *
 * ACCEPTING IS A DUTY, NOT A MAYBE. The moment a juror accepts, the platform
 * closes around the case: every screen goes to the decision until they vote.
 * That is enforced on the server (middleware/sequestration.ts), not in the app,
 * because a rule the client enforces is theatre somebody bypasses with a
 * browser tab.
 *
 * AND THERE ARE TWO WAYS OUT, because an account nobody can leave is a trap:
 * recusal with a reason, and an automatic release after a day. Nobody gets
 * locked out of their own account because they lost their phone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { prisma } from "../prisma";
import { createNotification, NotificationType } from "./notification-service";
import { checkDelegateEligibility } from "./delegation-service";
import { schedule, FIRST_RUN } from "./scheduled-work";

/**
 * The line the word "civil leader" now means.
 *
 * Fifty is a judgement, not a derivation: high enough that it marks somebody
 * genuinely carrying a constituency rather than a handful of friends, low
 * enough that it is reachable by an ordinary person people trust. What matters
 * far more than the exact number is that there IS one.
 */
export const CIVIL_LEADER_DELEGATIONS = 50;

/** How long a summons stands before the seat is redrawn. */
export const SUMMONS_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long an accepted juror has before the platform lets them go.
 *
 * This is the release valve on sequestration, and it is why sequestration is
 * safe to build at all. Somebody who accepts and then loses their phone gets
 * their account back after a day whatever happens.
 */
export const DELIBERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PanelKind = "comment" | "post" | "leader";

/**
 * Panel size by what was reported. Held as a literal table so a test can read
 * it rather than re-deriving the rule and agreeing with itself.
 */
export const PANELS: Record<PanelKind, { seats: number; votesToDecide: number }> = {
  /** A comment. */
  comment: { seats: 5, votesToDecide: 3 },
  /** A post by an ordinary member. */
  post: { seats: 5, votesToDecide: 3 },
  /** A post by a civil leader, or their account. */
  leader: { seats: 7, votesToDecide: 4 },
};

export type Verdict = "upheld" | "dismissed";
export type Ballot = "uphold" | "dismiss";

/** A juror must say why. A verdict nobody had to explain is one nobody can answer. */
export const MIN_REASONING_LENGTH = 20;
export const MAX_REASONING_LENGTH = 2000;
export const MAX_RECUSAL_LENGTH = 500;

// ---------------------------------------------------------------------------
// Who is who
// ---------------------------------------------------------------------------

/** How many people currently lend this person their vote. */
export async function delegationsHeld(userId: string): Promise<number> {
  const rows = await prisma.delegation.findMany({
    where: { toUserId: userId, isActive: true },
    select: { fromUserId: true },
    distinct: ["fromUserId"],
  });
  return rows.length;
}

/** The title, read live from the delegations actually held. */
export async function isCivilLeader(userId: string): Promise<boolean> {
  return (await delegationsHeld(userId)) >= CIVIL_LEADER_DELEGATIONS;
}

/**
 * Who the report is actually about, and which panel hears it.
 *
 * A report names a post, a comment or an account. The accused is the author in
 * the first two cases and the account itself in the third — the jury is judging
 * a person's conduct either way, and pretending a post has no author would let
 * a civil leader's post be heard by a five-person panel.
 */
async function subjectOf(report: {
  postId: string | null;
  commentId: string | null;
  reportedUserId: string | null;
}): Promise<{ accusedId: string; kind: "comment" | "post" | "account" } | null> {
  if (report.commentId) {
    const comment = await prisma.comment.findUnique({
      where: { id: report.commentId },
      select: { authorId: true },
    });
    return comment ? { accusedId: comment.authorId, kind: "comment" } : null;
  }
  if (report.postId) {
    const post = await prisma.post.findUnique({
      where: { id: report.postId },
      select: { authorId: true },
    });
    return post ? { accusedId: post.authorId, kind: "post" } : null;
  }
  if (report.reportedUserId) {
    return { accusedId: report.reportedUserId, kind: "account" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

/**
 * Everybody who could sit on this jury.
 *
 * THE BAR IS THE ONE ALREADY EARNED. Delegate eligibility — a fortnight old,
 * twenty votes, three posts, active recently — rather than a new standard
 * invented for this. Somebody the platform already trusts to carry other
 * people's votes is somebody it can trust to weigh a report.
 *
 * EXCLUDED, AND WHY EACH:
 *   - the accused, who cannot judge themselves;
 *   - the reporter, who has already reached a conclusion;
 *   - anybody currently lending the accused their vote — they have declared an
 *     interest, and this is the rule that makes a civil leader's jury mean
 *     something. Applied at ONE delegation rather than fifty: the conflict is
 *     the loan, not its size;
 *   - anybody blocked in either direction, because a jury drawn from people who
 *     have already refused to be in a room together is not impartial;
 *   - anybody already sitting on this jury, however many times the draw comes
 *     round.
 */
async function eligibleJurors(args: {
  juryId: string;
  accusedId: string;
  reporterId: string;
}): Promise<string[]> {
  const [delegators, blocksMade, blocksReceived, alreadySeated] = await Promise.all([
    prisma.delegation.findMany({
      where: { toUserId: args.accusedId, isActive: true },
      select: { fromUserId: true },
    }),
    prisma.block.findMany({ where: { blockerId: args.accusedId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: args.accusedId }, select: { blockerId: true } }),
    prisma.jurySeat.findMany({ where: { juryId: args.juryId }, select: { jurorId: true } }),
  ]);

  const barred = new Set<string>([
    args.accusedId,
    args.reporterId,
    ...delegators.map((d) => d.fromUserId),
    ...blocksMade.map((b) => b.blockedId),
    ...blocksReceived.map((b) => b.blockerId),
    ...alreadySeated.map((s) => s.jurorId),
  ]);

  // Candidates are read broadly and then filtered by the real eligibility
  // check, rather than reimplementing that check as a query here. The rule
  // lives in one place; this reads it.
  const candidates = await prisma.user.findMany({
    where: { banned: false, id: { notIn: [...barred] } },
    select: { id: true },
  });

  const eligible: string[] = [];
  for (const candidate of candidates) {
    const result = await checkDelegateEligibility(candidate.id);
    if (result?.eligible) eligible.push(candidate.id);
  }
  return eligible;
}

/** Fisher–Yates, so a draw is a draw and not the first n rows of a table. */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

async function summon(juryId: string, jurorIds: string[], replaces?: string): Promise<void> {
  if (jurorIds.length === 0) return;

  await prisma.jurySeat.createMany({
    data: jurorIds.map((jurorId) => ({
      juryId,
      jurorId,
      replacesSeatId: replaces ?? null,
    })),
    skipDuplicates: true,
  });

  await Promise.all(
    jurorIds.map((jurorId) =>
      createNotification(
        jurorId,
        NotificationType.JURY_SUMMONS,
        "You have been called to a jury",
        "A report is waiting for a decision and you were drawn at random to help make it. " +
          "You have 24 hours to answer. Accepting sequesters your account until you have " +
          "cast your vote — everything else on the platform waits.",
        { juryId },
      ).catch((error) => {
        console.error("[jury] summons notification failed:", error);
        return { created: false };
      }),
    ),
  );
}

/**
 * Fill any empty seats on a jury, drawing fresh jurors at random.
 *
 * Idempotent, and safe to call at any point in a jury's life: it works out how
 * many live seats there are and tops up to the panel size. That is what makes
 * the same function serve the opening draw, a lapsed summons and a recusal.
 */
export async function fillSeats(juryId: string, replaces?: string): Promise<number> {
  const jury = await prisma.jury.findUnique({
    where: { id: juryId },
    select: {
      id: true,
      seats: true,
      status: true,
      accusedId: true,
      report: { select: { reporterId: true } },
      seatRows: { select: { state: true } },
    },
  });
  if (!jury || jury.status === "decided" || jury.status === "abandoned") return 0;

  const live = jury.seatRows.filter((s) => s.state !== "lapsed" && s.state !== "recused").length;
  const wanted = jury.seats - live;
  if (wanted <= 0) return 0;

  // The accused is read off the jury rather than re-resolved from the report:
  // a post can be deleted mid-case, and a redraw that then found nobody to
  // exclude would seat the accused's own delegators on their jury.
  const pool = await eligibleJurors({
    juryId,
    accusedId: jury.accusedId,
    reporterId: jury.report.reporterId,
  });

  const drawn = shuffle(pool).slice(0, wanted);
  await summon(juryId, drawn, replaces);
  return drawn.length;
}

export type EmpanelFailure = "already_empanelled" | "report_not_found" | "subject_gone";

export type EmpanelResult =
  | { ok: true; juryId: string; seats: number; summoned: number; panelKind: PanelKind }
  | { ok: false; code: EmpanelFailure; message: string };

/**
 * Draw a jury for a report.
 *
 * THE PANEL SIZE IS FROZEN HERE. It is decided from what the accused holds at
 * the moment of the draw and then written down, so somebody who crosses fifty
 * delegations mid-case does not change the size of the jury already hearing
 * them — in either direction.
 *
 * A JURY SHORT OF JURORS IS STILL A JURY. On a small platform the pool may not
 * fill every seat, and the honest answer is to seat who there is and say so on
 * the page, not to invent jurors or to refuse to hear the report. The threshold
 * is a count of votes, not a fraction of those seated, so a short panel simply
 * needs the same number of people to agree.
 */
export async function empanel(reportId: string): Promise<EmpanelResult> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      reporterId: true,
      postId: true,
      commentId: true,
      reportedUserId: true,
      jury: { select: { id: true } },
    },
  });
  if (!report) {
    return { ok: false, code: "report_not_found", message: "There is no such report." };
  }
  if (report.jury) {
    return {
      ok: false,
      code: "already_empanelled",
      message: "A jury is already hearing this report.",
    };
  }

  const subject = await subjectOf(report);
  if (!subject) {
    return {
      ok: false,
      code: "subject_gone",
      message: "What this report is about no longer exists.",
    };
  }

  const held = await delegationsHeld(subject.accusedId);
  const leader = held >= CIVIL_LEADER_DELEGATIONS;

  // A comment is a comment whoever wrote it. The bigger panel is for a civil
  // leader's POST or their ACCOUNT — the things that carry their reach.
  const panelKind: PanelKind =
    subject.kind === "comment" ? "comment" : leader ? "leader" : "post";
  const panel = PANELS[panelKind];

  const jury = await prisma.jury.create({
    data: {
      reportId: report.id,
      accusedId: subject.accusedId,
      panelKind,
      seats: panel.seats,
      votesToDecide: panel.votesToDecide,
      status: "drawing",
      accusedDelegations: held,
    },
    select: { id: true },
  });

  const summoned = await fillSeats(jury.id);
  return { ok: true, juryId: jury.id, seats: panel.seats, summoned, panelKind };
}

// ---------------------------------------------------------------------------
// Sitting
// ---------------------------------------------------------------------------

/**
 * The case this person is sequestered by, if any.
 *
 * READ LIVE, ALWAYS. There is no "isSequestered" column on the user: a flag
 * that a sweep forgets to clear is somebody locked out of their own account,
 * and this is the one place in the platform where a stale boolean would do real
 * harm. The seat row is the truth, and the release valve below is a query
 * against the same row.
 */
export async function sequesteredBy(userId: string): Promise<string | null> {
  const seat = await prisma.jurySeat.findFirst({
    where: {
      jurorId: userId,
      state: "accepted",
      acceptedAt: { gt: new Date(Date.now() - DELIBERATION_WINDOW_MS) },
    },
    select: { juryId: true },
  });
  return seat?.juryId ?? null;
}

export type SeatFailure =
  | "not_summoned"
  | "already_answered"
  | "not_accepted"
  | "jury_closed"
  | "reasoning_too_short"
  | "reasoning_too_long";

export type SeatResult = { ok: true } | { ok: false; code: SeatFailure; message: string };

/** Take the summons. This is the moment the platform closes around the case. */
export async function acceptSummons(juryId: string, jurorId: string): Promise<SeatResult> {
  // Claim-then-act: the update is the check, so two taps cannot seat somebody
  // twice or reopen a seat that has already lapsed.
  const claimed = await prisma.jurySeat.updateMany({
    where: { juryId, jurorId, state: "summoned" },
    data: { state: "accepted", acceptedAt: new Date() },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      code: "not_summoned",
      message: "There is no open summons for you on this case.",
    };
  }

  await prisma.jury.updateMany({
    where: { id: juryId, status: "drawing" },
    data: { status: "deliberating" },
  });
  return { ok: true };
}

/**
 * Step aside, with a reason.
 *
 * Sometimes a juror knows the person, or the case is distressing, or they
 * simply cannot be fair. Forcing a verdict out of somebody who should not give
 * one is worse for everybody than redrawing, so this is a right and not a
 * favour. It is recorded, and it releases them immediately.
 */
export async function recuse(
  juryId: string,
  jurorId: string,
  reason: string,
): Promise<SeatResult> {
  const trimmed = reason.trim();
  if (trimmed.length > MAX_RECUSAL_LENGTH) {
    return {
      ok: false,
      code: "reasoning_too_long",
      message: `A reason for stepping aside is limited to ${MAX_RECUSAL_LENGTH} characters.`,
    };
  }

  const seat = await prisma.jurySeat.findFirst({
    where: { juryId, jurorId, state: { in: ["summoned", "accepted"] } },
    select: { id: true },
  });

  const claimed = seat
    ? await prisma.jurySeat.updateMany({
        where: { id: seat.id, state: { in: ["summoned", "accepted"] } },
        data: { state: "recused", recusedReason: trimmed || null, closedAt: new Date() },
      })
    : { count: 0 };
  if (claimed.count === 0) {
    return { ok: false, code: "not_summoned", message: "You are not sitting on this case." };
  }

  // The replacement records which seat it replaced, so the whole draw can be
  // walked backwards afterwards. A redraw nobody can trace is a redraw nobody
  // can check.
  await fillSeats(juryId, seat!.id);
  return { ok: true };
}

export type VoteFailure = SeatFailure;

export type VoteResult =
  | { ok: true; decided: boolean; verdict: Verdict | null; uphold: number; dismiss: number }
  | { ok: false; code: VoteFailure; message: string };

/**
 * Cast a verdict, with the reasoning that has to come with it.
 *
 * The count is over CAST VOTES, not seats, and the threshold is an absolute
 * number rather than a majority of whoever turned up. Three of five means
 * three people, whether the other two answered or not.
 */
export async function castVerdict(args: {
  juryId: string;
  jurorId: string;
  ballot: Ballot;
  reasoning: string;
}): Promise<VoteResult> {
  const reasoning = args.reasoning.trim();
  if (reasoning.length < MIN_REASONING_LENGTH) {
    return {
      ok: false,
      code: "reasoning_too_short",
      message:
        `Say why, in at least ${MIN_REASONING_LENGTH} characters. A verdict nobody had to ` +
        `explain is a verdict nobody can answer.`,
    };
  }
  if (reasoning.length > MAX_REASONING_LENGTH) {
    return {
      ok: false,
      code: "reasoning_too_long",
      message: `Reasoning is limited to ${MAX_REASONING_LENGTH} characters.`,
    };
  }

  const jury = await prisma.jury.findUnique({
    where: { id: args.juryId },
    select: { id: true, status: true, votesToDecide: true, reportId: true },
  });
  if (!jury) {
    return { ok: false, code: "jury_closed", message: "There is no such case." };
  }
  if (jury.status === "decided" || jury.status === "abandoned") {
    return { ok: false, code: "jury_closed", message: "This case has already been decided." };
  }

  const claimed = await prisma.jurySeat.updateMany({
    where: { juryId: args.juryId, jurorId: args.jurorId, state: "accepted" },
    data: {
      state: "voted",
      vote: args.ballot,
      reasoning,
      votedAt: new Date(),
      closedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      code: "not_accepted",
      message: "You have to accept the summons before you can vote on the case.",
    };
  }

  return settle(args.juryId);
}

/**
 * Count the votes and close the case if either side has reached the threshold.
 *
 * Separate from casting so the sweeps can call it too, and idempotent: the
 * conditional update means two callers arriving together produce one verdict.
 */
export async function settle(juryId: string): Promise<VoteResult> {
  const jury = await prisma.jury.findUnique({
    where: { id: juryId },
    select: {
      id: true,
      votesToDecide: true,
      status: true,
      verdict: true,
      reportId: true,
      accusedId: true,
      seatRows: { select: { jurorId: true, vote: true, state: true } },
      report: { select: { reporterId: true } },
    },
  });
  if (!jury) {
    return { ok: false, code: "jury_closed", message: "There is no such case." };
  }

  const uphold = jury.seatRows.filter((s) => s.vote === "uphold").length;
  const dismiss = jury.seatRows.filter((s) => s.vote === "dismiss").length;

  const verdict: Verdict | null =
    uphold >= jury.votesToDecide ? "upheld" : dismiss >= jury.votesToDecide ? "dismissed" : null;

  if (!verdict || jury.status === "decided") {
    return {
      ok: true,
      decided: jury.status === "decided",
      verdict: (jury.verdict as Verdict | null) ?? null,
      uphold,
      dismiss,
    };
  }

  const closed = await prisma.jury.updateMany({
    where: { id: juryId, status: { in: ["drawing", "deliberating"] } },
    data: { status: "decided", verdict, decidedAt: new Date() },
  });

  if (closed.count > 0) {
    // The report is answered at last. This is the line that turns a queue
    // nobody read into a decision somebody made.
    await prisma.report.update({
      where: { id: jury.reportId },
      data: {
        status: verdict === "upheld" ? "actioned" : "dismissed",
        reviewedBy: "community jury",
        reviewedAt: new Date(),
      },
    });

    // Release anybody still sitting: the case is over and holding an account
    // hostage to a decision already reached would be indefensible.
    await prisma.jurySeat.updateMany({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
      data: { state: "lapsed", closedAt: new Date() },
    });

    const told = new Set<string>([
      jury.report.reporterId,
      jury.accusedId,
      ...jury.seatRows.filter((s) => s.vote !== null).map((s) => s.jurorId),
    ]);

    await Promise.all(
      [...told].map((userId) =>
        createNotification(
          userId,
          NotificationType.JURY_VERDICT,
          verdict === "upheld" ? "A jury upheld a report" : "A jury dismissed a report",
          verdict === "upheld"
            ? "A randomly drawn jury found that this broke the Code of Conduct. Their reasons " +
              "are on the case."
            : "A randomly drawn jury found that this did not break the Code of Conduct. Their " +
              "reasons are on the case.",
          { juryId },
        ).catch((error) => {
          console.error("[jury] verdict notification failed:", error);
          return { created: false };
        }),
      ),
    );
  }

  return { ok: true, decided: true, verdict, uphold, dismiss };
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/**
 * Replace jurors who never answered, and release jurors who have run out of
 * time.
 *
 * BOTH HALVES MATTER FOR DIFFERENT REASONS. The first keeps a case moving when
 * somebody ignores a summons — a jury that waits forever for one person is a
 * report that is never decided. The second is the safety valve on
 * sequestration: it is the reason an account can always be got back.
 *
 * A LAPSED SEAT IS KEPT, NEVER DELETED. That record is the platform's memory of
 * who showed up, and it is what the Trust Score reads.
 */
export async function sweepJuries(): Promise<{
  redrawn: number;
  released: number;
  decided: number;
}> {
  const now = Date.now();

  const unanswered = await prisma.jurySeat.findMany({
    where: { state: "summoned", summonedAt: { lt: new Date(now - SUMMONS_WINDOW_MS) } },
    select: { id: true, juryId: true },
  });

  const overdue = await prisma.jurySeat.findMany({
    where: { state: "accepted", acceptedAt: { lt: new Date(now - DELIBERATION_WINDOW_MS) } },
    select: { id: true, juryId: true },
  });

  let redrawn = 0;
  let released = 0;

  for (const seat of [...unanswered, ...overdue]) {
    const claimed = await prisma.jurySeat.updateMany({
      where: { id: seat.id, state: { in: ["summoned", "accepted"] } },
      data: { state: "lapsed", closedAt: new Date() },
    });
    if (claimed.count === 0) continue;
    released += 1;
    redrawn += await fillSeats(seat.juryId, seat.id);
  }

  // A case whose remaining jurors have already reached the threshold closes
  // here rather than waiting for somebody to press something.
  const open = await prisma.jury.findMany({
    where: { status: { in: ["drawing", "deliberating"] } },
    select: { id: true },
  });
  let decided = 0;
  for (const jury of open) {
    const result = await settle(jury.id);
    if (result.ok && result.decided) decided += 1;
  }

  return { redrawn, released, decided };
}

/**
 * Run the sweep on a schedule that survives a restart.
 *
 * Through `schedule()` rather than a bare setInterval, for the reason written
 * at the top of scheduled-work.ts: a container restarts several times an hour
 * on a day of active work, so an interval whose first run is hours away never
 * runs at all. Every deadline in this file is 24 hours, and hourly is fine
 * granularity for a 24-hour clock.
 */
export function scheduleJurySweeps(): void {
  schedule({
    name: "jury sweep",
    firstRunAfterMs: FIRST_RUN.jury,
    everyMs: 60 * 60 * 1000,
    run: async () => sweepJuries(),
  });
}
