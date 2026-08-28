/**
 * ARTICLE V — impeachment, over HTTP.
 *
 * Five routes and no admin route among them. That is deliberate: there is no
 * endpoint that cancels, pauses, or overrides a proceeding, for anybody, at any
 * permission level. Article V is the people's remedy against borrowed power,
 * and a remedy the platform can switch off is not a remedy. Admins read the
 * articles (routes/admin.ts) and act against a bad-faith FILER; the proceeding
 * itself runs to its own clock.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { createRateLimiter } from "../middleware/rate-limit";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import { auditForImpeachment } from "../services/integrity-audit";
import {
  castVote,
  evaluate,
  fileImpeachment,
  suspensionState,
  withdrawVote,
  IMPEACHMENT_THRESHOLD,
  IMPEACHMENT_WINDOW_DAYS,
  MAX_ARTICLE_LENGTH,
  MAX_SUSPENSION_DAYS,
  MIN_ARTICLE_LENGTH,
  MIN_SUSPENSION_DAYS,
} from "../services/impeachment";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const impeachmentsRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * Three filings a day.
 *
 * Filing is already narrow — you must be delegating to the person, and only one
 * proceeding can stand against them at a time — so this is not the main defence.
 * It is there because each filing sends an email and a notification to every
 * elector, and a script working through a list of delegates could otherwise
 * turn one account into a mailing campaign.
 */
const fileLimit = createRateLimiter({
  maxRequests: 3,
  windowMs: 24 * 60 * 60 * 1000,
  message:
    "Three filings a day. Articles of Impeachment are served on the person accused and " +
    "reviewed by administrators — they are not a way to make a point.",
});

/** The rules, so no client has to hardcode them. */
impeachmentsRouter.get("/rules", (c) =>
  c.json({
    windowDays: IMPEACHMENT_WINDOW_DAYS,
    threshold: IMPEACHMENT_THRESHOLD,
    minSuspensionDays: MIN_SUSPENSION_DAYS,
    maxSuspensionDays: MAX_SUSPENSION_DAYS,
    minArticleLength: MIN_ARTICLE_LENGTH,
    maxArticleLength: MAX_ARTICLE_LENGTH,
  })
);

function publicUser(user: { id: string; name: string; username: string | null; image: string | null }) {
  return { id: user.id, name: user.name, username: user.username, image: user.image };
}

const USER_FIELDS = { id: true, name: true, username: true, image: true } as const;

/**
 * GET /api/impeachments/leader/:userId
 *
 * Everything Article V can say about one person: whether proceedings are open,
 * the articles as filed, the tally against the frozen electorate, whether the
 * viewer may vote, and any suspension in force.
 *
 * THE ARTICLES ARE PUBLIC. A charge brought in secret, decided by a private
 * electorate, is exactly the concentration of power Article V exists to break.
 * The vote is restricted; the accusation is not.
 */
impeachmentsRouter.get("/leader/:userId", async (c) => {
  const viewer = c.get("user");
  const leaderId = c.req.param("userId");

  const leader = await prisma.user.findUnique({
    where: { id: leaderId },
    select: USER_FIELDS,
  });
  if (!leader) return c.json({ error: "User not found" }, 404);

  const delegatorCount = await prisma.delegation
    .findMany({
      where: { toUserId: leaderId, isActive: true },
      select: { fromUserId: true },
      distinct: ["fromUserId"],
    })
    .then((rows) => rows.length);

  const suspension = await suspensionState(leaderId);

  const open = await prisma.impeachment.findFirst({
    where: { leaderId, status: "open" },
    orderBy: { openedAt: "desc" },
    select: {
      id: true,
      grounds: true,
      evidence: true,
      openedAt: true,
      expiresAt: true,
      filedBy: { select: USER_FIELDS },
    },
  });

  let proceeding: Record<string, unknown> | null = null;
  if (open) {
    const outcome = await evaluate(open.id);
    const elector = viewer
      ? await prisma.impeachmentElector.findUnique({
          where: { impeachmentId_voterId: { impeachmentId: open.id, voterId: viewer.id } },
          select: { votedAt: true, proposedDays: true },
        })
      : null;

    proceeding = {
      id: open.id,
      status: outcome.status,
      grounds: open.grounds,
      evidence: open.evidence,
      filedBy: publicUser(open.filedBy),
      openedAt: open.openedAt.toISOString(),
      expiresAt: open.expiresAt.toISOString(),
      votes: outcome.votes,
      electorCount: outcome.electorCount,
      threshold: IMPEACHMENT_THRESHOLD,
      votesNeeded: Math.ceil(outcome.electorCount * IMPEACHMENT_THRESHOLD),
      // NULL WHEN SIGNED OUT, false when signed in and not an elector. The two
      // are different answers and the page says different things for each.
      viewerIsElector: viewer ? elector !== null : null,
      viewerHasVoted: elector?.votedAt ? true : false,
      viewerProposedDays: elector?.proposedDays ?? null,
      // THE AUDIT TAKEN WHEN THE ARTICLES WERE FILED — Article III §2 beside
      // Article V. Null when it could not be computed at the time, which the
      // page says plainly rather than showing an empty panel.
      audit: await auditForImpeachment(open.id),
    };
  }

  // THE RECORD, KEPT PERMANENTLY.
  //
  // Only proceedings that PASSED. An accusation that did not reach two thirds
  // is not a finding against anybody, and carrying it on a profile forever
  // would turn the right to bring a charge into a way to mark someone.
  //
  // A passed one stays for good, including after the suspension lifts. It is
  // the record of a constitutional act the person's own delegators took, and a
  // record that expires is one somebody can wait out.
  const record = await prisma.impeachment.findMany({
    where: { leaderId, status: "passed" },
    orderBy: { decidedAt: "desc" },
    select: {
      id: true,
      grounds: true,
      evidence: true,
      openedAt: true,
      decidedAt: true,
      suspendedUntil: true,
      filedBy: { select: USER_FIELDS },
      _count: { select: { electors: true } },
    },
  });

  const recordVotes = new Map<string, number>();
  if (record.length > 0) {
    const grouped = await prisma.impeachmentElector.groupBy({
      by: ["impeachmentId"],
      where: { impeachmentId: { in: record.map((r) => r.id) }, votedAt: { not: null } },
      _count: { _all: true },
    });
    for (const group of grouped) recordVotes.set(group.impeachmentId, group._count._all);
  }

  return c.json({
    leader: publicUser(leader),
    delegatorCount,
    /// Every impeachment this person has been through and lost, newest first.
    record: record.map((entry) => ({
      id: entry.id,
      grounds: entry.grounds,
      evidence: entry.evidence,
      filedBy: publicUser(entry.filedBy),
      openedAt: entry.openedAt.toISOString(),
      decidedAt: entry.decidedAt?.toISOString() ?? null,
      suspendedUntil: entry.suspendedUntil?.toISOString() ?? null,
      /// Whether this particular one is the suspension still in force.
      inForce: !!entry.suspendedUntil && entry.suspendedUntil > new Date(),
      votes: recordVotes.get(entry.id) ?? 0,
      electorCount: entry._count.electors,
    })),
    /// Article V applies to anyone holding borrowed power, and to nobody else.
    canBeImpeached: delegatorCount > 0,
    suspension: {
      suspended: suspension.suspended,
      until: suspension.until?.toISOString() ?? null,
      impeachmentId: suspension.impeachmentId,
    },
    proceeding,
  });
});

/**
 * GET /api/impeachments/me
 *
 * Proceedings the signed-in person is an elector in — the ballot box. Open ones
 * first, then what has already been decided, because a closed proceeding is
 * still something you were part of and may want to check.
 */
impeachmentsRouter.get("/me", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "Authentication required" }, 401);

  const rows = await prisma.impeachmentElector.findMany({
    where: { voterId: viewer.id },
    orderBy: { impeachment: { openedAt: "desc" } },
    take: 50,
    select: {
      votedAt: true,
      proposedDays: true,
      impeachment: {
        select: {
          id: true,
          status: true,
          // BOTH HALVES. This selected `grounds` only, and the page renders an
          // Evidence section from the same object — so the accusation showed
          // and what was said to support it came through as an empty block.
          // The article-v browser check found it; nothing that only reads the
          // API's status code could have.
          grounds: true,
          evidence: true,
          openedAt: true,
          expiresAt: true,
          suspendedUntil: true,
          leader: { select: USER_FIELDS },
          filedBy: { select: USER_FIELDS },
          _count: { select: { electors: true } },
        },
      },
    },
  });

  const votesById = new Map<string, number>();
  if (rows.length > 0) {
    const grouped = await prisma.impeachmentElector.groupBy({
      by: ["impeachmentId"],
      where: {
        impeachmentId: { in: rows.map((row) => row.impeachment.id) },
        votedAt: { not: null },
      },
      _count: { _all: true },
    });
    for (const group of grouped) votesById.set(group.impeachmentId, group._count._all);
  }

  const proceedings = rows.map((row) => ({
    id: row.impeachment.id,
    status: row.impeachment.status,
    grounds: row.impeachment.grounds,
    evidence: row.impeachment.evidence,
    leader: publicUser(row.impeachment.leader),
    filedBy: publicUser(row.impeachment.filedBy),
    openedAt: row.impeachment.openedAt.toISOString(),
    expiresAt: row.impeachment.expiresAt.toISOString(),
    suspendedUntil: row.impeachment.suspendedUntil?.toISOString() ?? null,
    votes: votesById.get(row.impeachment.id) ?? 0,
    electorCount: row.impeachment._count.electors,
    viewerHasVoted: row.votedAt !== null,
    viewerProposedDays: row.proposedDays,
  }));

  const rank = (status: string) => (status === "open" ? 0 : 1);
  proceedings.sort((a, b) => rank(a.status) - rank(b.status));

  return c.json({ proceedings });
});

/**
 * POST /api/impeachments — file Articles of Impeachment.
 */
impeachmentsRouter.post(
  "/",
  fileLimit,
  zValidator(
    "json",
    z.object({
      leaderId: z.string().min(1),
      grounds: z.string().min(MIN_ARTICLE_LENGTH).max(MAX_ARTICLE_LENGTH),
      evidence: z.string().min(MIN_ARTICLE_LENGTH).max(MAX_ARTICLE_LENGTH),
    })
  ),
  async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json({ error: "Authentication required" }, 401);

    // Same bar as delegating. Opening proceedings moves published tallies the
    // moment they pass, so it needs the verified account that voting does.
    if (!(await isVerified(viewer))) return c.json(VERIFICATION_REQUIRED, 403);

    const body = c.req.valid("json");
    const result = await fileImpeachment({
      leaderId: body.leaderId,
      filedById: viewer.id,
      grounds: body.grounds,
      evidence: body.evidence,
    });

    if (!result.ok) {
      const status = result.code === "leader_not_found" ? 404 : result.code === "already_open" ? 409 : 400;
      return c.json({ error: result.message, code: result.code }, status);
    }

    return c.json(
      {
        impeachmentId: result.impeachmentId,
        electorCount: result.electorCount,
        expiresAt: result.expiresAt.toISOString(),
        served: true,
      },
      201
    );
  }
);

/**
 * POST /api/impeachments/:id/vote — vote to impeach, and propose a length.
 */
impeachmentsRouter.post(
  "/:id/vote",
  zValidator(
    "json",
    z.object({
      proposedDays: z.number().int().min(MIN_SUSPENSION_DAYS).max(MAX_SUSPENSION_DAYS),
    })
  ),
  async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json({ error: "Authentication required" }, 401);
    // "Only verified humans may vote." This is a vote — the heaviest kind
    // there is — and it was the one Article V route that never asked.
    if (!(await isVerified(viewer))) return c.json(VERIFICATION_REQUIRED, 403);

    const result = await castVote(
      c.req.param("id"),
      viewer.id,
      c.req.valid("json").proposedDays
    );

    if (!result.ok) {
      const status =
        result.code === "not_found" ? 404 : result.code === "not_an_elector" ? 403 : 400;
      return c.json({ error: result.message, code: result.code }, status);
    }

    return c.json({
      votes: result.votes,
      electorCount: result.electorCount,
      passed: result.passed,
    });
  }
);

/** DELETE /api/impeachments/:id/vote — take it back while the window is open. */
impeachmentsRouter.delete("/:id/vote", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "Authentication required" }, 401);
  // Withdrawing is voting too — it moves the same tally the other way.
  if (!(await isVerified(viewer))) return c.json(VERIFICATION_REQUIRED, 403);

  const result = await withdrawVote(c.req.param("id"), viewer.id);
  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 : result.code === "not_an_elector" ? 403 : 400;
    return c.json({ error: result.message, code: result.code }, status);
  }

  return c.json({ votes: result.votes, electorCount: result.electorCount, passed: false });
});

export { impeachmentsRouter };
