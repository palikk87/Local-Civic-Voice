/**
 * ARTICLE V — the System-Wide Reset, over HTTP.
 *
 * As with impeachment there is no route here that stops, pauses or overturns a
 * proceeding. The only thing resembling one is the owner's undo of an EXECUTED
 * reset, and that lives in routes/admin.ts where every other consequential
 * owner action lives, so nothing on this router can be mistaken for a veto.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { createRateLimiter } from "../middleware/rate-limit";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import {
  castBallot,
  currentReset,
  openSystemReset,
  restorableFor,
  restoreMyPositions,
  resetPasses,
  tallyOf,
  withdrawBallot,
  MAX_ARTICLE_LENGTH,
  MIN_ARTICLE_LENGTH,
  RESET_APPROVAL_THRESHOLD,
  RESET_DISCLOSURE,
  RESET_DISCLOSURE_HOURS,
  RESET_PARTICIPATION_FLOOR,
  RESET_WINDOW_DAYS,
} from "../services/system-reset";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const systemResetRouter = new Hono<{ Variables: AuthVariables }>();

/** One filing a day. It notifies every account on the platform. */
const openLimit = createRateLimiter({
  name: "system-reset-file",
  maxRequests: 1,
  windowMs: 24 * 60 * 60 * 1000,
  message:
    "Filing Articles of System Reset sends a notification to every account on the platform. " +
    "One a day.",
});

/**
 * GET /api/system-reset
 *
 * The current proceeding if there is one, the rules, and the full disclosure of
 * what a reset costs.
 *
 * THE DISCLOSURE IS IN EVERY RESPONSE, including when nothing is open. It is
 * the same list the 48-hour notice sends, from one exported constant, so
 * nobody can be shown terms at voting time that differ from the terms at
 * execution time.
 */
systemResetRouter.get("/", async (c) => {
  const viewer = c.get("user");
  const reset = await currentReset();

  const rules = {
    windowDays: RESET_WINDOW_DAYS,
    participationFloor: RESET_PARTICIPATION_FLOOR,
    approvalThreshold: RESET_APPROVAL_THRESHOLD,
    disclosureHours: RESET_DISCLOSURE_HOURS,
    minArticleLength: MIN_ARTICLE_LENGTH,
    maxArticleLength: MAX_ARTICLE_LENGTH,
  };

  if (!reset) {
    return c.json({ proceeding: null, rules, disclosure: RESET_DISCLOSURE });
  }

  const tally = await tallyOf(reset.id);
  // Null once the filer has closed their account. Not a gap to paper over — the
  // reset stands on its articles, and "we no longer know who brought it" is the
  // true answer rather than an invented one.
  const filedBy = reset.filedById
    ? await prisma.user.findUnique({
        where: { id: reset.filedById },
        select: { id: true, name: true, username: true, image: true },
      })
    : null;

  const ballot = viewer
    ? await prisma.systemResetBallot.findUnique({
        where: { resetId_voterId: { resetId: reset.id, voterId: viewer.id } },
        select: { support: true },
      })
    : null;

  const turnout = tally.support + tally.oppose;

  return c.json({
    proceeding: {
      id: reset.id,
      status: reset.status,
      grounds: reset.grounds,
      evidence: reset.evidence,
      // Null when the filer's account is gone. There is no foreign key here on
      // purpose — a vote affecting every account must not vanish with the
      // person who brought it — so the honest answer is that we no longer know.
      filedBy,
      openedAt: reset.openedAt.toISOString(),
      expiresAt: reset.expiresAt.toISOString(),
      decidedAt: reset.decidedAt?.toISOString() ?? null,
      executeAfter: reset.executeAfter?.toISOString() ?? null,
      support: tally.support,
      oppose: tally.oppose,
      turnout,
      eligibleCount: reset.eligibleCount,
      participation: reset.eligibleCount > 0 ? turnout / reset.eligibleCount : 0,
      approval: turnout > 0 ? tally.support / turnout : 0,
      // Where it stands right now, on today's numbers. Not a prediction.
      wouldPassOnCurrentNumbers: resetPasses({ ...tally, eligibleCount: reset.eligibleCount }),
      viewerHasVoted: ballot !== null,
      viewerSupported: ballot?.support ?? null,
    },
    rules,
    disclosure: RESET_DISCLOSURE,
  });
});

/** POST /api/system-reset — file Articles of System Reset. */
systemResetRouter.post(
  "/",
  openLimit,
  zValidator(
    "json",
    z.object({
      grounds: z.string().min(MIN_ARTICLE_LENGTH).max(MAX_ARTICLE_LENGTH),
      evidence: z.string().min(MIN_ARTICLE_LENGTH).max(MAX_ARTICLE_LENGTH),
    })
  ),
  async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json({ error: "Authentication required" }, 401);
    if (!(await isVerified(viewer))) return c.json(VERIFICATION_REQUIRED, 403);

    const filing = c.req.valid("json");
    const result = await openSystemReset({
      filedById: viewer.id,
      grounds: filing.grounds,
      evidence: filing.evidence,
    });

    if (!result.ok) {
      return c.json(
        { error: result.message, code: result.code },
        result.code === "already_open" ? 409 : 400
      );
    }

    return c.json(
      {
        resetId: result.resetId,
        eligibleCount: result.eligibleCount,
        expiresAt: result.expiresAt.toISOString(),
      },
      201
    );
  }
);

/** POST /api/system-reset/:id/vote — { support: boolean }. */
systemResetRouter.post(
  "/:id/vote",
  zValidator("json", z.object({ support: z.boolean() })),
  async (c) => {
    const viewer = c.get("user");
    if (!viewer) return c.json({ error: "Authentication required" }, 401);
    // A vote to wipe every tally on the platform, cast by an account nobody
    // had confirmed was a person. Opening a reset already required
    // verification; deciding one did not.
    if (!(await isVerified(viewer))) return c.json(VERIFICATION_REQUIRED, 403);

    const result = await castBallot(
      c.req.param("id"),
      viewer.id,
      c.req.valid("json").support
    );
    if (!result.ok) {
      const status =
        result.code === "not_found" ? 404 : result.code === "not_eligible" ? 403 : 400;
      return c.json({ error: result.message, code: result.code }, status);
    }
    return c.json({
      support: result.support,
      oppose: result.oppose,
      eligibleCount: result.eligibleCount,
    });
  }
);

/** DELETE /api/system-reset/:id/vote */
systemResetRouter.delete("/:id/vote", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "Authentication required" }, 401);

  const result = await withdrawBallot(c.req.param("id"), viewer.id);
  if (!result.ok) {
    return c.json(
      { error: result.message, code: result.code },
      result.code === "not_found" ? 404 : 400
    );
  }
  return c.json({
    support: result.support,
    oppose: result.oppose,
    eligibleCount: result.eligibleCount,
  });
});

/**
 * GET /api/system-reset/my-restorable
 *
 * How many of your own positions you could put back after the last reset.
 */
systemResetRouter.get("/my-restorable", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "Authentication required" }, 401);

  const restorable = await restorableFor(viewer.id);
  if (!restorable) {
    // No reset has ever run. An honest nothing, not a zero dressed as a result.
    return c.json({ reset: null, available: 0, restored: 0 });
  }

  return c.json({
    reset: { id: restorable.resetId, executedAt: restorable.executedAt?.toISOString() ?? null },
    available: restorable.available,
    restored: restorable.restored,
  });
});

/**
 * POST /api/system-reset/restore-my-positions
 *
 * Opt in. Yours alone. Every journaled vote is a direct one — delegated voice
 * is computed and never stored — so nothing a delegate cast in your name can
 * come back through here.
 */
systemResetRouter.post("/restore-my-positions", async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: "Authentication required" }, 401);

  const result = await restoreMyPositions(viewer.id);
  return c.json({
    restored: result.restored,
    // Positions you have already cast again since the reset. The newer act is
    // the truer one, so it is left alone.
    skipped: result.skipped,
  });
});

export { systemResetRouter };
