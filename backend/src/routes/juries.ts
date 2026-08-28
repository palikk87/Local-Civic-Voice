/**
 * THE JUDICIARY, over HTTP — Constitution Article IV.
 *
 * Four routes a juror uses and one anybody can read.
 *
 * THERE IS NO ROUTE THAT OVERTURNS A VERDICT, at any permission level, for
 * anybody. Article IV makes the juries a branch of government rather than a
 * moderation tool, and a branch whose decisions another branch can simply
 * reverse is not one. Admins still act on a bad-faith REPORTER through the
 * console; they do not sit as an appeal court.
 *
 * A DECIDED CASE IS PUBLIC — the verdict, the reasoning, and how the panel was
 * drawn. A jury nobody can check is a star chamber with a nicer name. What is
 * never published is which juror wrote which reason: a neighbour who judged
 * honestly must not be findable by the person they judged.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { publicHandle, PUBLIC_AUTHOR_SELECT } from "../services/public-identity";
import {
  acceptSummons,
  castVerdict,
  findingsAgainst,
  recuse,
  sequesteredBy,
  CIVIL_LEADER_DELEGATIONS,
  DELIBERATION_WINDOW_MS,
  MAX_REASONING_LENGTH,
  MAX_RECUSAL_LENGTH,
  MIN_REASONING_LENGTH,
  PANELS,
  SUMMONS_WINDOW_MS,
} from "../services/jury";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const juriesRouter = new Hono<{ Variables: AuthVariables }>();

/** The rules, so no client hardcodes them. */
juriesRouter.get("/rules", (c) =>
  c.json({
    panels: PANELS,
    civilLeaderDelegations: CIVIL_LEADER_DELEGATIONS,
    summonsWindowMs: SUMMONS_WINDOW_MS,
    deliberationWindowMs: DELIBERATION_WINDOW_MS,
    minReasoningLength: MIN_REASONING_LENGTH,
    maxReasoningLength: MAX_REASONING_LENGTH,
    maxRecusalLength: MAX_RECUSAL_LENGTH,
  })
);

/**
 * Everything the case can show a juror.
 *
 * JUDGING ON A SCREENSHOT IS NOT JUDGING. The post or comment itself, the law
 * it points at, that law's citizen brief, the reason it was reported and
 * whatever the reporter wrote — anything visible through that piece of content
 * is visible here, because a juror asked to decide whether something broke the
 * rules has to be able to see the thing.
 *
 * PRIOR FINDINGS AGAINST THE ACCUSED ARE WITHHELD UNTIL THE VERDICT IS IN, and
 * then shown. A jury that starts by reading somebody's record is not weighing
 * this case, it is weighing the person. Afterwards the record is exactly what a
 * reader needs to put the verdict in proportion, so it appears the moment the
 * decision can no longer be affected by it.
 */
async function caseFile(juryId: string, viewerId: string | null) {
  const jury = await prisma.jury.findUnique({
    where: { id: juryId },
    select: {
      id: true,
      panelKind: true,
      seats: true,
      votesToDecide: true,
      status: true,
      verdict: true,
      accusedDelegations: true,
      openedAt: true,
      decidedAt: true,
      accusedId: true,
      report: {
        select: {
          id: true,
          reason: true,
          detail: true,
          postId: true,
          commentId: true,
          reportedUserId: true,
        },
      },
      seatRows: {
        select: {
          id: true,
          jurorId: true,
          state: true,
          vote: true,
          reasoning: true,
          summonedAt: true,
          acceptedAt: true,
          votedAt: true,
          recusedReason: true,
          replacesSeatId: true,
        },
        orderBy: { summonedAt: "asc" },
      },
    },
  });
  if (!jury) return null;

  const decided = jury.status === "decided";

  // What was reported, in full.
  const post = jury.report.postId
    ? await prisma.post.findUnique({
        where: { id: jury.report.postId },
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: PUBLIC_AUTHOR_SELECT },
          governmentReference: {
            select: {
              id: true,
              masterReferenceId: true,
              title: true,
              status: true,
              citizenBrief: true,
            },
          },
        },
      })
    : null;

  const comment = jury.report.commentId
    ? await prisma.comment.findUnique({
        where: { id: jury.report.commentId },
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: PUBLIC_AUTHOR_SELECT },
          post: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: { select: PUBLIC_AUTHOR_SELECT },
              governmentReference: {
                select: {
                  id: true,
                  masterReferenceId: true,
                  title: true,
                  status: true,
                  citizenBrief: true,
                },
              },
            },
          },
        },
      })
    : null;

  // Read off the jury, not re-derived: a post can be deleted mid-case and the
  // person on trial does not stop being the person on trial.
  const accused = await prisma.user.findUnique({
    where: { id: jury.accusedId },
    select: PUBLIC_AUTHOR_SELECT,
  });

  const person = (u: { id: string; name: string; username: string | null; displayUsername: string | null; image: string | null } | null) =>
    u ? { id: u.id, name: u.name, handle: publicHandle(u), image: u.image } : null;

  const viewerSeat = viewerId
    ? jury.seatRows.find((s) => s.jurorId === viewerId) ?? null
    : null;

  // PRIOR FINDINGS. Only after the verdict, and only ever counts and dates —
  // the earlier cases are readable in their own right by anybody who wants
  // them.
  const priorFindings = decided
    ? await prisma.jury.count({
        where: { verdict: "upheld", accusedId: jury.accusedId, id: { not: jury.id } },
      })
    : null;

  return {
    id: jury.id,
    status: jury.status,
    verdict: jury.verdict,
    panelKind: jury.panelKind,
    seats: jury.seats,
    votesToDecide: jury.votesToDecide,
    /// Frozen at the draw, and published so the panel size is explicable.
    accusedDelegations: jury.accusedDelegations,
    accusedIsCivilLeader: jury.accusedDelegations >= CIVIL_LEADER_DELEGATIONS,
    openedAt: jury.openedAt.toISOString(),
    decidedAt: jury.decidedAt?.toISOString() ?? null,

    report: {
      reason: jury.report.reason,
      detail: jury.report.detail,
    },

    accused: person(accused),
    post,
    comment,

    /// HOW THE DRAW WENT, so it can be checked afterwards. Never who: a seat is
    /// a state and a timestamp, and only the viewer's own seat is named.
    draw: jury.seatRows.map((seat) => ({
      id: seat.id,
      state: seat.state,
      summonedAt: seat.summonedAt.toISOString(),
      answeredAt: seat.acceptedAt?.toISOString() ?? null,
      replacesSeatId: seat.replacesSeatId,
      isYou: viewerId !== null && seat.jurorId === viewerId,
    })),

    /// The votes and the reasons, once the case is closed. Unattributed.
    reasons: decided
      ? jury.seatRows
          .filter((s) => s.vote !== null)
          .map((s) => ({ vote: s.vote, reasoning: s.reasoning }))
      : [],

    tally: {
      uphold: jury.seatRows.filter((s) => s.vote === "uphold").length,
      dismiss: jury.seatRows.filter((s) => s.vote === "dismiss").length,
      seated: jury.seatRows.filter((s) => s.state !== "lapsed" && s.state !== "recused").length,
    },

    priorFindings,

    viewer: {
      seatState: viewerSeat?.state ?? null,
      hasVoted: viewerSeat?.state === "voted",
      /// When the platform will let them go if they do nothing.
      releasedAt:
        viewerSeat?.state === "accepted" && viewerSeat.acceptedAt
          ? new Date(viewerSeat.acceptedAt.getTime() + DELIBERATION_WINDOW_MS).toISOString()
          : null,
      answerBy:
        viewerSeat?.state === "summoned"
          ? new Date(viewerSeat.summonedAt.getTime() + SUMMONS_WINDOW_MS).toISOString()
          : null,
    },
  };
}

/**
 * GET /api/juries/me — the summonses waiting on this person, and whether they
 * are currently sequestered.
 *
 * The client polls this to know where it must send them. It is in the
 * sequestration allowlist for exactly that reason.
 */
juriesRouter.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const seats = await prisma.jurySeat.findMany({
    where: { jurorId: user.id, state: { in: ["summoned", "accepted"] } },
    select: { juryId: true, state: true, summonedAt: true, acceptedAt: true },
    orderBy: { summonedAt: "asc" },
  });

  return c.json({
    sequesteredBy: await sequesteredBy(user.id),
    summonses: seats.map((seat) => ({
      juryId: seat.juryId,
      state: seat.state,
      summonedAt: seat.summonedAt.toISOString(),
      answerBy: new Date(seat.summonedAt.getTime() + SUMMONS_WINDOW_MS).toISOString(),
      releasedAt: seat.acceptedAt
        ? new Date(seat.acceptedAt.getTime() + DELIBERATION_WINDOW_MS).toISOString()
        : null,
    })),
  });
});

/**
 * GET /api/juries/findings/:userId — every upheld misinformation finding
 * against one person. Public, and kept for good.
 *
 * Bill of Rights Article V. Registered before the `/:id` route so a user id is
 * never read as a case id.
 *
 * NOTHING HERE IS A SCORE. A finding is one jury's verdict on one specific
 * claim, with the reasons they gave, and it is shown as that. Turning it into a
 * number would let a reader skip the part that matters.
 */
juriesRouter.get("/findings/:userId", async (c) => {
  const findings = await findingsAgainst(c.req.param("userId"));
  return c.json({
    findings: findings.map((finding) => ({
      juryId: finding.juryId,
      decidedAt: finding.decidedAt?.toISOString() ?? null,
      detail: finding.detail,
      uphold: finding.uphold,
      dismiss: finding.dismiss,
      reasons: finding.reasons,
      delegationsAtTheTime: finding.delegationsAtTheTime,
    })),
  });
});

/** GET /api/juries/:id — the case file. Public once decided; jurors always. */
juriesRouter.get("/:id", async (c) => {
  const user = c.get("user");
  const file = await caseFile(c.req.param("id"), user?.id ?? null);
  if (!file) return c.json({ error: "No such case" }, 404);

  // While a case is live, only the people sitting on it and the two parties
  // read it. A live case published in full is a pile-on with a docket number.
  if (file.status !== "decided") {
    const seated = file.draw.some((seat) => seat.isYou);
    const party = user?.id === file.accused?.id;
    if (!seated && !party) {
      return c.json(
        {
          error: "This case is still being heard. It is published in full once it is decided.",
          status: file.status,
        },
        403,
      );
    }
  }

  return c.json({ case: file });
});

/** POST /api/juries/:id/accept — take the summons, and be sequestered. */
juriesRouter.post("/:id/accept", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const result = await acceptSummons(c.req.param("id"), user.id);
  if (!result.ok) return c.json({ error: result.message, code: result.code }, 400);

  return c.json({ accepted: true, case: await caseFile(c.req.param("id"), user.id) });
});

/** POST /api/juries/:id/recuse — step aside, with a reason, and be released. */
juriesRouter.post(
  "/:id/recuse",
  zValidator("json", z.object({ reason: z.string().max(MAX_RECUSAL_LENGTH).optional() })),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const { reason } = c.req.valid("json");
    const result = await recuse(c.req.param("id"), user.id, reason ?? "");
    if (!result.ok) return c.json({ error: result.message, code: result.code }, 400);

    return c.json({ recused: true });
  },
);

/** POST /api/juries/:id/verdict — decide, and say why. */
juriesRouter.post(
  "/:id/verdict",
  zValidator(
    "json",
    z.object({
      vote: z.enum(["uphold", "dismiss"]),
      reasoning: z.string().min(1).max(MAX_REASONING_LENGTH),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const { vote, reasoning } = c.req.valid("json");
    const result = await castVerdict({
      juryId: c.req.param("id"),
      jurorId: user.id,
      ballot: vote,
      reasoning,
    });
    if (!result.ok) return c.json({ error: result.message, code: result.code }, 400);

    return c.json({
      recorded: true,
      decided: result.decided,
      verdict: result.verdict,
      tally: { uphold: result.uphold, dismiss: result.dismiss },
    });
  },
);

export { juriesRouter };
