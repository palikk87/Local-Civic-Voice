/**
 * "This is broken, and here is what I wanted it to do."
 *
 * WHY IT ASKS TWO QUESTIONS. "What went wrong" and "what should have happened"
 * are different, and the second is the one that turns a report into a change.
 * A queue full of "the button doesn't work" costs a round trip each before
 * anybody can act; "I pressed Vote Nay and the bar stayed grey — it should have
 * filled red" is a fix.
 *
 * WHY IT TAKES THE PAGE AND THE ELEMENT. Somebody describing a screen in words
 * is doing the app's job for it. The client sends where they were and what they
 * pointed at, so nobody has to reconstruct it.
 *
 * SIGNED OUT IS ALLOWED. A bug only strangers hit is still a bug, and the
 * people most likely to hit one are the people who could not get past sign-up.
 * Rate-limited rather than gated.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { createRateLimiter } from "../middleware/rate-limit";
import type { auth } from "../auth";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const bugReportsRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * Ten an hour. Generous for somebody having a genuinely bad session, and low
 * enough that the inbox cannot be filled from one browser.
 */
const submitLimit = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
  message: "That is a lot of reports in one hour. Take a breath, then try again.",
});

const submitSchema = z.object({
  pageUrl: z.string().max(2000),
  pagePath: z.string().max(500),
  elementLabel: z.string().max(200).optional(),
  elementPath: z.string().max(500).optional(),
  problem: z.string().min(3, "Say what happened").max(4000),
  wanted: z.string().max(4000).optional(),
  userAgent: z.string().max(500).optional(),
  viewport: z.string().max(50).optional(),
  appCommit: z.string().max(100).optional(),
});

/** POST /api/bug-reports — anybody, signed in or not. */
bugReportsRouter.post("/", submitLimit, zValidator("json", submitSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");

  const report = await prisma.bugReport.create({
    data: {
      userId: user?.id ?? null,
      // Copied in rather than joined: the report has to still make sense after
      // the account is gone, and it is the reporter's name at the time.
      username: (user as { username?: string | null } | null)?.username ?? null,
      pageUrl: body.pageUrl,
      pagePath: body.pagePath,
      elementLabel: body.elementLabel ?? null,
      elementPath: body.elementPath ?? null,
      problem: body.problem,
      wanted: body.wanted ?? null,
      userAgent: body.userAgent ?? null,
      viewport: body.viewport ?? null,
      appCommit: body.appCommit ?? null,
    },
    select: { id: true, createdAt: true },
  });

  console.log(
    `[BugReport] ${report.id} on ${body.pagePath}` +
      (body.elementLabel ? ` — "${body.elementLabel}"` : "")
  );

  return c.json({ success: true, id: report.id, createdAt: report.createdAt }, 201);
});

export { bugReportsRouter };
