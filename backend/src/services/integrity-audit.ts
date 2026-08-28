/**
 * THE INTEGRITY AUDIT — Constitution Article III §2.
 *
 * "Any user or group of users may demand an Integrity Audit of a specific vote
 * if there is evidence of bot interference or system malfunction."
 *
 * Until this file that clause described nothing at all. It is now the one place
 * an audit is computed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THE WHOLE FILE OBEYS: AN AUDIT COUNTS; IT NEVER NAMES.
 *
 * It may look at a record's vote, at a leader's own support, or at the
 * electorate of a proceeding, and it may report votes, timing and
 * distributions. It may never name a person, list accounts, or publish a figure
 * covering fewer than MIN_COHORT people.
 *
 * That floor is not reinvented here. `MIN_COHORT` in services/jurisdiction.ts
 * is five, is deliberately not settable from a deploy console, and is already
 * what stops the district maps identifying anybody. The same number, for the
 * same reason.
 *
 * NOTHING IN THIS FILE SELECTS A NAME. Every query asks for ids and timestamps.
 * tests/integrity-audit.test.ts reads this source and fails if a name, a
 * username or an email is ever selected, the same way public-identity.test.ts
 * guards the author payloads.
 *
 * ONE GATE, NOT A HABIT. Every finding is built by `report()` and nothing else
 * constructs one. Below the floor `report()` returns "withheld" and drops the
 * numbers on the floor with it, so a check cannot leak a small cohort by
 * forgetting a threshold. The same test asserts `status:` appears exactly once
 * in this file.
 *
 * IT REPORTS PATTERNS AND NEVER ACCUSES. "attention" means a person should
 * read this. It never means fraud, and no wording here says it does — a burst
 * of sign-ups is a campus in an election week as often as it is a bot farm.
 * The platform does not draw the conclusion.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { prisma } from "../prisma";
import { MIN_COHORT } from "./jurisdiction";
import { computeWeightedTally } from "./delegation-service";

/** What an audit can be run against. */
export type SubjectType = "reference" | "leader" | "impeachment" | "reset";

export const SUBJECT_TYPES: SubjectType[] = ["reference", "leader", "impeachment", "reset"];

/**
 * One audit per subject per hour. A second request inside the window is handed
 * the existing audit rather than re-running: the answer would be the same, and
 * an endpoint that recomputes a whole delegation graph on demand is a lever.
 */
export const AUDIT_COOLDOWN_MS = 60 * 60 * 1000;

/** Dormancy, and the window every "recently" in this file means. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * How long the recount waits before believing a mismatch.
 *
 * Every vote path recomputes the published tally inside the same request, so a
 * stale number is not ordinary traffic. But computing and writing are two
 * steps, and an audit that reads between them would report tampering over a
 * vote landing normally. So a gap is checked twice, and only a gap that
 * survives is a finding.
 */
const RECOUNT_SETTLE_MS = 400;

export type FindingStatus = "ok" | "attention" | "withheld";

export interface Finding {
  /** Stable machine name, e.g. "recount". Used by the screens and the tests. */
  id: string;
  title: string;
  status: FindingStatus;
  /** One plain sentence. Never a name, never an accusation. */
  summary: string;
  /** The numbers behind the sentence. Counts only, and empty when withheld. */
  detail: Record<string, number>;
}

/** What a check hands to the gate. It is not a finding until `report()` says so. */
interface Draft {
  id: string;
  title: string;
  /**
   * How many PEOPLE this figure covers. The floor is applied to this, and it is
   * the only thing that decides whether the numbers are publishable.
   */
  cohort: number;
  /** True when a person should read this. Never means fraud. */
  attention: boolean;
  summary: string;
  detail: Record<string, number>;
  /**
   * THE ONE DOCUMENTED EXCEPTION TO THE FLOOR, used by the recount and nothing
   * else. A record's tally is printed on its own card for anybody to read, so
   * withholding it inside an audit would be theatre rather than privacy — and
   * it would leave the one check that needs no inference at all unable to run
   * on a young record, which is exactly where a wrong number would sit longest.
   * It publishes two totals that are already public and no fact about a person.
   */
  alreadyPublic?: true;
}

/**
 * THE GATE. The only thing in this file that produces a Finding.
 *
 * Under the floor it returns "withheld" and no numbers — not the cohort size
 * rounded, not a share, nothing. A suppressed cell that still leaks its
 * magnitude is not suppressed.
 */
function report(draft: Draft): Finding {
  if (!draft.alreadyPublic && draft.cohort < MIN_COHORT) {
    return {
      id: draft.id,
      title: draft.title,
      status: "withheld",
      summary:
        `Fewer than ${MIN_COHORT} people are involved, so this cannot be reported ` +
        `without identifying them.`,
      detail: {},
    };
  }
  return {
    id: draft.id,
    title: draft.title,
    status: draft.attention ? "attention" : "ok",
    summary: draft.summary,
    detail: draft.detail,
  };
}

// ---------------------------------------------------------------------------
// Small shared arithmetic. All of it operates on timestamps and ids.
// ---------------------------------------------------------------------------

/** Whole percent, so nothing published is more precise than the cohort allows. */
function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/** The busiest calendar day in a set of timestamps, and how many fell in it. */
function busiestDay(dates: Date[]): number {
  const byDay = new Map<string, number>();
  for (const d of dates) {
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...byDay.values());
}

/** The busiest clock hour in a set of timestamps, and how many fell in it. */
function busiestHour(dates: Date[]): number {
  const byHour = new Map<number, number>();
  for (const d of dates) {
    const key = Math.floor(d.getTime() / HOUR_MS);
    byHour.set(key, (byHour.get(key) ?? 0) + 1);
  }
  return Math.max(0, ...byHour.values());
}

// ---------------------------------------------------------------------------
// The checks.
//
// Each one returns a Draft. None of them decides what is publishable; that is
// `report()`'s job and only `report()`'s job.
// ---------------------------------------------------------------------------

/**
 * THE RECOUNT — the backbone of the whole feature.
 *
 * Article III's own words are "bot interference or system malfunction", and an
 * arithmetic mismatch is the one finding that needs no inference whatsoever:
 * either the published number is what the votes add up to or it is not.
 *
 * It reuses `computeWeightedTally` — the same function `applyWeightedTally`
 * writes the published number from — rather than a second implementation.
 * A recount that does its own arithmetic is auditing itself.
 *
 * TWO THINGS ZERO A TALLY LEGITIMATELY and are not malfunctions: a System-Wide
 * Reset (services/system-reset.ts) and a merge, which recomputes onto the
 * master record and zeroes the source it merged away
 * (services/deduplication-service.ts). Both leave the published number equal to
 * a fresh recount of the votes that remain, so both pass this check on their
 * own merits. Nothing needs to be excused.
 */
async function checkRecount(referenceId: string): Promise<Draft> {
  const read = async () => {
    const reference = await prisma.governmentReference.findUnique({
      where: { id: referenceId },
      select: { supportVotes: true, opposeVotes: true },
    });
    const counted = await computeWeightedTally(referenceId);
    return { reference, counted };
  };

  let { reference, counted } = await read();
  let matched =
    (reference?.supportVotes ?? 0) === counted.support &&
    (reference?.opposeVotes ?? 0) === counted.oppose;

  if (!matched) {
    // A vote may have landed between the read and the count. Settle, look again.
    await new Promise((resolve) => setTimeout(resolve, RECOUNT_SETTLE_MS));
    ({ reference, counted } = await read());
    matched =
      (reference?.supportVotes ?? 0) === counted.support &&
      (reference?.opposeVotes ?? 0) === counted.oppose;
  }

  const voters = await prisma.governmentReferenceVote.count({
    where: { governmentReferenceId: referenceId },
  });

  return {
    id: "recount",
    title: "Recount",
    cohort: voters,
    alreadyPublic: true,
    attention: !matched,
    summary: matched
      ? "The published tally is exactly what the votes add up to."
      : "The published tally is not what the votes add up to.",
    detail: {
      publishedSupport: reference?.supportVotes ?? 0,
      publishedOppose: reference?.opposeVotes ?? 0,
      recountedSupport: counted.support,
      recountedOppose: counted.oppose,
      votesCast: voters,
    },
  };
}

/**
 * DIRECT VERSUS DELEGATED.
 *
 * A record carried mostly by lent voice is not wrong — that is what liquid
 * democracy is for — but it is a different thing from a record carried by
 * people who each turned up, and a citizen reading a tally deserves to know
 * which one they are looking at.
 *
 * Records only. In an impeachment or a reset every vote is cast by the person
 * themselves: delegated voice deliberately does not travel into a recall, so
 * there is no split to report and reporting one would invent a distinction.
 */
async function checkSplit(referenceId: string): Promise<Draft> {
  const votes = await prisma.governmentReferenceVote.findMany({
    where: { governmentReferenceId: referenceId },
    select: { position: true },
  });
  const counted = await computeWeightedTally(referenceId);

  const direct = votes.length;
  const weighted = counted.support + counted.oppose;
  const delegated = Math.max(0, weighted - direct);

  return {
    id: "split",
    title: "Direct and delegated",
    cohort: direct,
    attention: false,
    summary:
      delegated === 0
        ? "Every voice in this tally was cast by the person it belongs to."
        : `${share(delegated, weighted)}% of this tally is voice lent by somebody else.`,
    detail: { peopleWhoVoted: direct, delegatedVoice: delegated, totalVoice: weighted },
  };
}

/**
 * HOW OLD THE PARTICIPATING ACCOUNTS ARE.
 *
 * Buckets, never dates. A brand-new account is not a bot — everybody was new
 * once, and a law in the news brings people in — so this reports the shape and
 * says nothing about any of them.
 */
async function checkAccountAge(userIds: string[]): Promise<Draft> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { createdAt: true },
  });
  const now = Date.now();
  const total = users.length;

  const underWeek = users.filter((u) => now - u.createdAt.getTime() < SEVEN_DAYS_MS).length;
  const underMonth = users.filter(
    (u) =>
      now - u.createdAt.getTime() >= SEVEN_DAYS_MS && now - u.createdAt.getTime() < THIRTY_DAYS_MS,
  ).length;
  const underQuarter = users.filter(
    (u) =>
      now - u.createdAt.getTime() >= THIRTY_DAYS_MS && now - u.createdAt.getTime() < NINETY_DAYS_MS,
  ).length;
  const older = total - underWeek - underMonth - underQuarter;

  const newShare = share(underWeek, total);
  const attention = total >= MIN_COHORT && newShare >= 50;

  return {
    id: "account-age",
    title: "How old the accounts are",
    cohort: total,
    attention,
    summary: attention
      ? `${newShare}% of the accounts taking part are less than a week old.`
      : `${share(older, total)}% of the accounts taking part are more than three months old.`,
    detail: {
      people: total,
      underOneWeek: underWeek,
      underOneMonth: underMonth,
      underThreeMonths: underQuarter,
      olderThanThreeMonths: older,
    },
  };
}

/**
 * HOW MANY OF THEM JOINED ON THE SAME DAY.
 *
 * One number: the biggest single sign-up day among the people taking part.
 * Never which day, because a date plus a small cohort is a way of pointing at
 * somebody.
 */
async function checkSameDaySignups(userIds: string[]): Promise<Draft> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { createdAt: true },
  });
  const total = users.length;
  const peak = busiestDay(users.map((u) => u.createdAt));
  const peakShare = share(peak, total);
  const attention = total >= 10 && peakShare >= 30;

  return {
    id: "same-day-signups",
    title: "Joined on the same day",
    cohort: total,
    attention,
    summary: attention
      ? `${peakShare}% of the people taking part opened their account on one single day.`
      : "Sign-up dates are spread out rather than clustered on one day.",
    detail: { people: total, largestSingleDay: peak, shareOfPeople: peakShare },
  };
}

/**
 * WHEN THE VOTES ARRIVED.
 *
 * The busiest hour, as a count and a share. A burst is what a campaign looks
 * like and also what automation looks like; the audit reports the shape and
 * lets a person tell them apart.
 */
function checkTiming(id: string, castAt: Date[]): Draft {
  const total = castAt.length;
  const peak = busiestHour(castAt);
  const peakShare = share(peak, total);
  const attention = total >= 10 && peakShare >= 50;

  return {
    id,
    title: "When the votes arrived",
    cohort: total,
    attention,
    summary: attention
      ? `${peakShare}% of the votes were cast inside one hour.`
      : "Votes arrived spread over time rather than in a single burst.",
    detail: { votes: total, largestSingleHour: peak, shareOfVotes: peakShare },
  };
}

/**
 * HOW FAST SOMEBODY GAINED DELEGATORS.
 *
 * A leader's own early-warning light. Support arriving all at once is the shape
 * of both a good week and somebody stacking an account, and the person carrying
 * that voice is the one who most needs to know it happened.
 */
async function checkDelegationGrowth(leaderId: string): Promise<Draft> {
  const delegations = await prisma.delegation.findMany({
    where: { toUserId: leaderId, isActive: true },
    select: { createdAt: true },
  });
  const total = delegations.length;
  const dates = delegations.map((d) => d.createdAt);
  const peakDay = busiestDay(dates);
  const peakHour = busiestHour(dates);
  const hourShare = share(peakHour, total);
  const attention = total >= 10 && hourShare >= 50;

  return {
    id: "delegation-growth",
    title: "How the support arrived",
    cohort: total,
    attention,
    summary: attention
      ? `${hourShare}% of this support was lent inside one hour.`
      : "Support was lent gradually rather than all at once.",
    detail: {
      delegators: total,
      largestSingleDay: peakDay,
      largestSingleHour: peakHour,
      shareInLargestHour: hourShare,
    },
  };
}

/**
 * CIRCULAR DELEGATION.
 *
 * Voice that travels in a circle inflates nobody's tally — the tally code walks
 * each chain once and stops — but a ring is still worth surfacing, because a
 * ring nobody meant to build is a sign that people do not understand where
 * their voice is going, and a ring somebody did mean to build is an attempt at
 * something.
 *
 * Reported as a count and a length. Never as a route, because a route with
 * three people in it is three names.
 */
async function checkRings(leaderId: string): Promise<Draft> {
  const edges = await prisma.delegation.findMany({
    where: { isActive: true },
    select: { fromUserId: true, toUserId: true },
  });

  const onward = new Map<string, string[]>();
  for (const edge of edges) {
    const list = onward.get(edge.fromUserId);
    if (list) list.push(edge.toUserId);
    else onward.set(edge.fromUserId, [edge.toUserId]);
  }

  const delegators = edges.filter((e) => e.toUserId === leaderId).map((e) => e.fromUserId);

  // A depth-first walk that COLOURS each account as it goes: unvisited, on the
  // current path, or finished. An edge back onto the current path is a ring,
  // and its length is the difference in depth plus one.
  //
  // Deliberately not an enumeration of every path. Somebody delegating in
  // several categories has several onward edges, and walking every distinct
  // route through a graph like that is exponential — an audit endpoint anybody
  // can call is the last place to put a combinatorial explosion. This visits
  // each account once and each delegation once.
  const UNVISITED = 0;
  const ON_PATH = 1;
  const FINISHED = 2;
  const colour = new Map<string, number>();
  const depth = new Map<string, number>();

  let rings = 0;
  let shortest = 0;

  for (const start of [leaderId, ...delegators]) {
    if (colour.has(start)) continue;
    colour.set(start, ON_PATH);
    depth.set(start, 0);

    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = onward.get(frame.node) ?? [];

      if (frame.next >= children.length) {
        colour.set(frame.node, FINISHED);
        stack.pop();
        continue;
      }

      const child = children[frame.next]!;
      frame.next += 1;
      const seen = colour.get(child) ?? UNVISITED;

      if (seen === ON_PATH) {
        rings += 1;
        const length = (depth.get(frame.node) ?? 0) - (depth.get(child) ?? 0) + 1;
        if (shortest === 0 || length < shortest) shortest = length;
      } else if (seen === UNVISITED) {
        colour.set(child, ON_PATH);
        depth.set(child, (depth.get(frame.node) ?? 0) + 1);
        stack.push({ node: child, next: 0 });
      }
    }
  }

  return {
    id: "rings",
    title: "Circular delegation",
    cohort: delegators.length,
    attention: rings > 0,
    summary:
      rings > 0
        ? `Voice here travels in a circle: ${rings} circular chain${rings === 1 ? "" : "s"}, the shortest ${shortest} people long.`
        : "No voice here travels in a circle.",
    detail: { delegators: delegators.length, circularChains: rings, shortestChain: shortest },
  };
}

/**
 * HOW MUCH OF THE SUPPORT IS STILL AWAKE.
 *
 * A delegation nobody has revisited in a month still carries full weight, which
 * is correct — silence is not withdrawal — but a leader whose voice comes
 * almost entirely from dormant accounts is carrying something different from a
 * leader whose delegators vote alongside them, and both of them should be able
 * to see which they are.
 *
 * "Awake" means cast or changed a position in the last thirty days. Nothing
 * here reads a login, a session or a device.
 */
async function checkDormantSupport(leaderId: string): Promise<Draft> {
  const delegations = await prisma.delegation.findMany({
    where: { toUserId: leaderId, isActive: true },
    select: { fromUserId: true },
  });
  const delegatorIds = delegations.map((d) => d.fromUserId);
  const total = delegatorIds.length;

  const since = new Date(Date.now() - THIRTY_DAYS_MS);
  const active = await prisma.governmentReferenceVote.findMany({
    where: { userId: { in: delegatorIds }, updatedAt: { gte: since } },
    select: { userId: true },
    distinct: ["userId"],
  });

  const awake = active.length;
  const dormant = total - awake;
  const dormantShare = share(dormant, total);
  const attention = total >= MIN_COHORT && dormantShare >= 60;

  return {
    id: "dormant-support",
    title: "Support that has gone quiet",
    cohort: total,
    attention,
    summary: attention
      ? `${dormantShare}% of this support comes from people who have not voted in a month.`
      : `${share(awake, total)}% of this support comes from people who have voted in the last month.`,
    detail: { delegators: total, votedInLastMonth: awake, quietForAMonth: dormant, quietShare: dormantShare },
  };
}

// ---------------------------------------------------------------------------
// Running an audit.
// ---------------------------------------------------------------------------

export type AuditFailure = "unknown_subject" | "subject_not_found";

export interface AuditRecord {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  runAt: Date;
  flagged: boolean;
  findings: Finding[];
  /** True when this audit ran because articles of impeachment were filed. */
  automatic: boolean;
}

export type AuditResult =
  | { ok: true; audit: AuditRecord; reused: boolean }
  | { ok: false; code: AuditFailure; message: string };

/** Compute the findings for a subject. Reads only; writes nothing. */
async function computeFindings(
  subjectType: SubjectType,
  subjectId: string,
): Promise<Finding[] | null> {
  if (subjectType === "reference") {
    const reference = await prisma.governmentReference.findUnique({
      where: { id: subjectId },
      select: { id: true },
    });
    if (!reference) return null;

    const votes = await prisma.governmentReferenceVote.findMany({
      where: { governmentReferenceId: subjectId },
      select: { userId: true, createdAt: true },
    });

    return [
      report(await checkRecount(subjectId)),
      report(await checkSplit(subjectId)),
      report(await checkAccountAge(votes.map((v) => v.userId))),
      report(await checkSameDaySignups(votes.map((v) => v.userId))),
      report(checkTiming("timing", votes.map((v) => v.createdAt))),
    ];
  }

  if (subjectType === "leader") {
    const leader = await prisma.user.findUnique({ where: { id: subjectId }, select: { id: true } });
    if (!leader) return null;

    const delegations = await prisma.delegation.findMany({
      where: { toUserId: subjectId, isActive: true },
      select: { fromUserId: true },
    });
    const delegatorIds = delegations.map((d) => d.fromUserId);

    return [
      report(await checkAccountAge(delegatorIds)),
      report(await checkSameDaySignups(delegatorIds)),
      report(await checkDelegationGrowth(subjectId)),
      report(await checkRings(subjectId)),
      report(await checkDormantSupport(subjectId)),
    ];
  }

  if (subjectType === "impeachment") {
    const electors = await prisma.impeachmentElector.findMany({
      where: { impeachmentId: subjectId },
      select: { voterId: true, votedAt: true },
    });
    if (electors.length === 0) {
      const exists = await prisma.impeachment.findUnique({
        where: { id: subjectId },
        select: { id: true },
      });
      if (!exists) return null;
    }

    const cast = electors.map((e) => e.votedAt).filter((d): d is Date => d !== null);
    return [
      report(await checkAccountAge(electors.map((e) => e.voterId))),
      report(await checkSameDaySignups(electors.map((e) => e.voterId))),
      report(checkTiming("timing", cast)),
      report(checkTurnout("impeachment", cast.length, electors.length)),
    ];
  }

  // reset
  const reset = await prisma.systemReset.findUnique({
    where: { id: subjectId },
    select: { id: true, eligibleCount: true },
  });
  if (!reset) return null;

  const ballots = await prisma.systemResetBallot.findMany({
    where: { resetId: subjectId },
    select: { voterId: true, createdAt: true },
  });

  return [
    report(await checkAccountAge(ballots.map((b) => b.voterId))),
    report(await checkSameDaySignups(ballots.map((b) => b.voterId))),
    report(checkTiming("timing", ballots.map((b) => b.createdAt))),
    report(checkTurnout("reset", ballots.length, reset.eligibleCount)),
  ];
}

/**
 * HOW MANY OF THE PEOPLE ENTITLED ACTUALLY VOTED.
 *
 * Both Article V proceedings freeze their denominator at the moment they open,
 * so this is a real fraction rather than a moving one. It is reported because a
 * recall carried by a handful of a large electorate and a recall carried by
 * nearly all of it are different events, and the words "two thirds" hide that.
 */
function checkTurnout(kind: "impeachment" | "reset", cast: number, entitled: number): Draft {
  return {
    id: "turnout",
    title: "Turnout",
    cohort: entitled,
    attention: false,
    summary:
      entitled === 0
        ? "Nobody was entitled to vote in this proceeding."
        : `${share(cast, entitled)}% of the people entitled to vote in this ${kind === "reset" ? "reset" : "proceeding"} did.`,
    detail: { entitledToVote: entitled, voted: cast },
  };
}

function toRecord(row: {
  id: string;
  subjectType: string;
  subjectId: string;
  runAt: Date;
  flagged: boolean;
  findings: unknown;
  impeachmentId: string | null;
}): AuditRecord {
  return {
    id: row.id,
    subjectType: row.subjectType as SubjectType,
    subjectId: row.subjectId,
    runAt: row.runAt,
    flagged: row.flagged,
    findings: (row.findings as Finding[]) ?? [],
    automatic: row.impeachmentId !== null,
  };
}

/**
 * Run an audit and keep it.
 *
 * `requestedById` is null when the platform ran it itself. It is stored only so
 * the same person cannot re-run the same audit every second; it is never
 * published, and a citizen deleting their account leaves the audit standing
 * with the column nulled.
 */
export async function runAudit(args: {
  subjectType: SubjectType;
  subjectId: string;
  requestedById: string | null;
  /** Set when this audit is running because articles were filed. */
  impeachmentId?: string;
  /** Skip the cooldown. Only the automatic filing audit does this. */
  force?: boolean;
}): Promise<AuditResult> {
  if (!SUBJECT_TYPES.includes(args.subjectType)) {
    return {
      ok: false,
      code: "unknown_subject",
      message: `An audit can be run on ${SUBJECT_TYPES.join(", ")} and nothing else.`,
    };
  }

  if (!args.force) {
    const recent = await prisma.integrityAudit.findFirst({
      where: {
        subjectType: args.subjectType,
        subjectId: args.subjectId,
        runAt: { gte: new Date(Date.now() - AUDIT_COOLDOWN_MS) },
      },
      orderBy: { runAt: "desc" },
    });
    if (recent) return { ok: true, audit: toRecord(recent), reused: true };
  }

  const findings = await computeFindings(args.subjectType, args.subjectId);
  if (findings === null) {
    return {
      ok: false,
      code: "subject_not_found",
      message: "There is nothing here to audit.",
    };
  }

  const created = await prisma.integrityAudit.create({
    data: {
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      requestedById: args.requestedById,
      impeachmentId: args.impeachmentId ?? null,
      findings: findings as unknown as object,
      flagged: findings.some((f) => f.status === "attention"),
    },
  });

  return { ok: true, audit: toRecord(created), reused: false };
}

/** Every audit ever run on a subject, newest first. Public. */
export async function auditHistory(
  subjectType: SubjectType,
  subjectId: string,
  take = 20,
): Promise<AuditRecord[]> {
  const rows = await prisma.integrityAudit.findMany({
    where: { subjectType, subjectId },
    orderBy: { runAt: "desc" },
    take,
  });
  return rows.map(toRecord);
}

/** One audit by id. Public. */
export async function auditById(id: string): Promise<AuditRecord | null> {
  const row = await prisma.integrityAudit.findUnique({ where: { id } });
  return row ? toRecord(row) : null;
}

/** The audit that ran when a proceeding opened, if it did. */
export async function auditForImpeachment(impeachmentId: string): Promise<AuditRecord | null> {
  const row = await prisma.integrityAudit.findFirst({
    where: { impeachmentId },
    orderBy: { runAt: "asc" },
  });
  return row ? toRecord(row) : null;
}
