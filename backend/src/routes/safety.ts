/**
 * Blocking, muting and reporting.
 *
 * The clients have had a menu offering all three since before this file
 * existed — Mute, Report Post, Block — wired to optional callbacks that nobody
 * passed. Pressing them did nothing at all, silently, which is worse than not
 * offering them: somebody being harassed pressed Block and believed it worked.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import { block, blockExistsBetween, forgetCachedFeeds } from "../services/relationships";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const safetyRouter = new Hono<{ Variables: AuthVariables }>();

const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "violence",
  "misinformation",
  "other",
] as const;

/**
 * GET /api/safety/blocks
 * Everyone you have blocked, so a settings screen can show and undo them.
 */
safetyRouter.get("/blocks", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const blocks = await prisma.block.findMany({
    where: { blockerId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      blocked: { select: { id: true, name: true, username: true, image: true } },
    },
  });

  return c.json({
    results: blocks.map((b) => ({
      id: b.id,
      user: b.blocked,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/safety/blocks/:id
 *
 * Severs follows and delegations in both directions — see
 * services/relationships.ts for why a block that leaves either in place is not
 * a block. Idempotent: blocking someone already blocked is a success, not a
 * conflict, because the caller's intent is already true.
 */
safetyRouter.post("/blocks/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  if (id === user.id) return c.json({ error: "You cannot block yourself" }, 400);

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return c.json({ error: "User not found" }, 404);

  await block(user.id, id);
  return c.json({ success: true, isBlocked: true });
});

/** DELETE /api/safety/blocks/:id — unblock. Follows are not restored. */
safetyRouter.delete("/blocks/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  await prisma.block.deleteMany({
    where: { blockerId: user.id, blockedId: c.req.param("id") },
  });
  return c.json({ success: true, isBlocked: false });
});

/** GET /api/safety/mutes — everyone you have muted. */
safetyRouter.get("/mutes", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const mutes = await prisma.mute.findMany({
    where: { muterId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      muted: { select: { id: true, name: true, username: true, image: true } },
    },
  });

  return c.json({
    results: mutes.map((m) => ({
      id: m.id,
      user: m.muted,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

/**
 * POST /api/safety/mutes/:id
 *
 * Quieter than a block: their posts leave your feed and nothing else changes.
 * They are never told, and they can still reach you.
 */
safetyRouter.post("/mutes/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  if (id === user.id) return c.json({ error: "You cannot mute yourself" }, 400);

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!target) return c.json({ error: "User not found" }, 404);

  await prisma.mute.upsert({
    where: { muterId_mutedId: { muterId: user.id, mutedId: id } },
    create: { muterId: user.id, mutedId: id },
    update: {},
  });

  // The feed keeps a per-reader cached response; without this the muted person
  // stays in it until the cache expires, which is the one thing muting is for.
  forgetCachedFeeds(user.id);

  return c.json({ success: true, isMuted: true });
});

/** DELETE /api/safety/mutes/:id — unmute. */
safetyRouter.delete("/mutes/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  await prisma.mute.deleteMany({
    where: { muterId: user.id, mutedId: c.req.param("id") },
  });
  return c.json({ success: true, isMuted: false });
});

/**
 * POST /api/safety/reports
 *
 * Exactly one target: a post, a comment, or a person.
 *
 * NOTHING IS HIDDEN ON REPORT. A report is evidence for a human to weigh, and a
 * platform that removes content the moment somebody complains has handed
 * anybody with a grudge a delete button. It goes in the queue and a moderator
 * decides.
 */
safetyRouter.post(
  "/reports",
  zValidator(
    "json",
    z
      .object({
        postId: z.string().optional(),
        commentId: z.string().optional(),
        userId: z.string().optional(),
        reason: z.enum(REPORT_REASONS),
        detail: z.string().max(2000).optional(),
      })
      .refine(
        (d) => [d.postId, d.commentId, d.userId].filter(Boolean).length === 1,
        { message: "Report exactly one of a post, a comment, or a user" },
      ),
  ),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Authentication required" }, 401);

    const { postId, commentId, userId, reason, detail } = c.req.valid("json");

    if (userId === user.id) {
      return c.json({ error: "You cannot report yourself" }, 400);
    }

    // Confirm the thing exists, so the queue never fills with reports about
    // records a moderator cannot open.
    if (postId && !(await prisma.post.findUnique({ where: { id: postId }, select: { id: true } }))) {
      return c.json({ error: "Post not found" }, 404);
    }
    if (
      commentId &&
      !(await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true } }))
    ) {
      return c.json({ error: "Comment not found" }, 404);
    }
    if (userId && !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      return c.json({ error: "User not found" }, 404);
    }

    // One open report per person per thing. Reporting twice is usually a second
    // tap, not a second grievance, and duplicates make a queue useless.
    const existing = await prisma.report.findFirst({
      where: {
        reporterId: user.id,
        status: "open",
        postId: postId ?? null,
        commentId: commentId ?? null,
        reportedUserId: userId ?? null,
      },
      select: { id: true },
    });
    if (existing) {
      return c.json({ success: true, reportId: existing.id, alreadyReported: true });
    }

    const report = await prisma.report.create({
      data: {
        reporterId: user.id,
        postId: postId ?? null,
        commentId: commentId ?? null,
        reportedUserId: userId ?? null,
        reason,
        detail: detail ?? null,
      },
    });

    return c.json({ success: true, reportId: report.id }, 201);
  },
);

/**
 * GET /api/safety/relationship/:id
 * What stands between you and one other person, for a profile screen.
 */
safetyRouter.get("/relationship/:id", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const id = c.req.param("id");
  const [blocked, muted, blockedEitherWay] = await Promise.all([
    prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: id } },
      select: { id: true },
    }),
    prisma.mute.findUnique({
      where: { muterId_mutedId: { muterId: user.id, mutedId: id } },
      select: { id: true },
    }),
    blockExistsBetween(user.id, id),
  ]);

  return c.json({
    isBlocked: blocked !== null,
    isMuted: muted !== null,
    // True when either of you has blocked the other. The client uses it to hide
    // the follow and message buttons without ever saying which way it runs.
    contactClosed: blockedEitherWay,
  });
});

export { safetyRouter, REPORT_REASONS };
