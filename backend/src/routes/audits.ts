/**
 * THE RIGHT TO AUDIT, over HTTP — Constitution Article III §2.
 *
 * READING IS PUBLIC AND UNAUTHENTICATED. An audit only staff can read is not a
 * remedy, and an audit only the person who paid for it can read is a receipt.
 * There is nothing in an audit that needs guarding: it holds counts and
 * sentences and never a name.
 *
 * ASKING FOR ONE NEEDS AN ACCOUNT, because it is work — a leader audit walks
 * the whole active delegation graph — and because one audit per subject per
 * hour has to be attributable to somebody to mean anything.
 *
 * THERE IS NO ROUTE THAT DELETES ONE, at any permission level. A record that
 * the subject of it can have removed is worth nothing to the person reading it.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { auth } from "../auth";
import { createRateLimiter } from "../middleware/rate-limit";
import { MIN_COHORT } from "../services/jurisdiction";
import {
  auditById,
  auditHistory,
  runAudit,
  AUDIT_COOLDOWN_MS,
  SUBJECT_TYPES,
  type SubjectType,
} from "../services/integrity-audit";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const auditsRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * Twenty audits an hour per account.
 *
 * The per-subject cooldown already stops the same audit being re-run, so this
 * is only there to stop one account walking every record on the platform in a
 * loop. Twenty is far above anything a person reading results would do.
 */
const requestLimit = createRateLimiter({
  name: "audit-request",
  maxRequests: 20,
  windowMs: 60 * 60 * 1000,
  message: "That is a lot of audits at once. Try again shortly.",
});

/** The rules, so no client hardcodes them. */
auditsRouter.get("/rules", (c) =>
  c.json({
    subjectTypes: SUBJECT_TYPES,
    cooldownMs: AUDIT_COOLDOWN_MS,
    /**
     * Published so a screen can explain a withheld finding in the same words
     * the server used to withhold it, rather than inventing its own number.
     */
    privacyFloor: MIN_COHORT,
  })
);

const subjectSchema = z.object({
  subjectType: z.enum(["reference", "leader", "impeachment", "reset"]),
  subjectId: z.string().min(1),
});

/**
 * POST /api/audits
 *
 * Demand an audit. Article III's word is "demand", and it is honoured: no
 * approval, no queue, no administrator in the way. The only thing that can turn
 * a request away is the cooldown, and that hands back the audit that already
 * exists rather than refusing.
 */
auditsRouter.post("/", requestLimit, zValidator("json", subjectSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { subjectType, subjectId } = c.req.valid("json");

  const result = await runAudit({
    subjectType: subjectType as SubjectType,
    subjectId,
    requestedById: user.id,
  });

  if (!result.ok) {
    return c.json({ error: result.message, code: result.code }, 404);
  }

  return c.json({ audit: result.audit, reused: result.reused }, result.reused ? 200 : 201);
});

/**
 * GET /api/audits/:id — one audit, in full. Public.
 *
 * Registered before the subject listing so an id is never read as a subject
 * type; the two shapes are different enough that Hono would not confuse them,
 * but the ordering says the intent out loud.
 */
auditsRouter.get("/:id", async (c) => {
  const audit = await auditById(c.req.param("id"));
  if (!audit) {
    return c.json({ error: "No such audit" }, 404);
  }
  return c.json({ audit });
});

/**
 * GET /api/audits/subject/:subjectType/:subjectId — every audit ever run on a
 * subject, newest first. Public.
 *
 * The history is the point of keeping them. A leader who has audited their own
 * support every month has something to point at, and it is only worth anything
 * if the bad months are in the same list as the good ones.
 */
auditsRouter.get("/subject/:subjectType/:subjectId", async (c) => {
  const subjectType = c.req.param("subjectType");
  if (!SUBJECT_TYPES.includes(subjectType as SubjectType)) {
    return c.json({ error: `An audit can be run on ${SUBJECT_TYPES.join(", ")}.` }, 400);
  }

  const audits = await auditHistory(subjectType as SubjectType, c.req.param("subjectId"));
  return c.json({ audits });
});

export { auditsRouter };
