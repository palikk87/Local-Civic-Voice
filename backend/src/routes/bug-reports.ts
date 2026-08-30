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
import { Prisma } from "@prisma/client";
import { createRateLimiter } from "../middleware/rate-limit";
import { verifyReadLink, recordUse } from "../services/bug-report-read-link";
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
/**
 * Sixty an hour on the read link. A person reading the queue makes a handful of
 * requests; this is high enough never to be felt and low enough that a leaked
 * link cannot be used to hammer the database.
 */
const exportLimit = createRateLimiter({
  name: "bug-report-export",
  maxRequests: 60,
  windowMs: 60 * 60 * 1000,
  message: "Too many reads of the bug queue from this address. Try again shortly.",
});

const submitLimit = createRateLimiter({
  name: "bug-report-submit",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
  message: "That is a lot of reports in one hour. Take a breath, then try again.",
});

const submitSchema = z.object({
  pageUrl: z.string().max(2000),
  pagePath: z.string().max(500),
  elementLabel: z.string().max(200).optional(),
  elementPath: z.string().max(500).optional(),
  /**
   * What the element actually is — component, record, selector, markup.
   *
   * Shaped rather than a free-form blob, so a client cannot quietly turn this
   * into a place to post whatever it likes, and capped hard: a report is a
   * paragraph of evidence, not a page dump. Unknown keys are stripped.
   *
   * Every field optional, because a page that does not say is a real answer.
   * The web fills most of them; mobile has no DOM and fills almost none.
   */
  elementDetail: z
    .object({
      selector: z.string().max(500).optional(),
      tag: z.string().max(50).optional(),
      component: z.string().max(200).optional(),
      control: z.string().max(200).optional(),
      action: z.string().max(500).optional(),
      attributes: z.record(z.string().max(60), z.string().max(300)).optional(),
      data: z.record(z.string().max(60), z.string().max(300)).optional(),
      html: z.string().max(1200).optional(),
      screen: z.string().max(200).optional(),
      params: z.record(z.string().max(60), z.string().max(300)).optional(),
      tap: z.string().max(200).optional(),
    })
    .strict()
    .optional(),
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
      elementDetail: body.elementDetail ?? Prisma.DbNull,
      problem: body.problem,
      wanted: body.wanted ?? null,
      userAgent: body.userAgent ?? null,
      viewport: body.viewport ?? null,
      appCommit: body.appCommit ?? null,
    },
    select: { id: true, createdAt: true },
  });

  // The operator line names the component, not just the word, for the same
  // reason the stored report does.
  console.log(
    `[BugReport] ${report.id} on ${body.pagePath}` +
      (body.elementLabel ? ` — "${body.elementLabel}"` : "") +
      (body.elementDetail?.component ? ` [${body.elementDetail.component}]` : ""),
  );

  return c.json({ success: true, id: report.id, createdAt: report.createdAt }, 201);
});

/**
 * GET /api/bug-reports/export
 *
 * THE QUEUE, READ BY WHOEVER IS FIXING IT.
 *
 * The owner writes bugs down here and somebody else fixes them. Until now that
 * handoff was a person signing into the admin panel and copying the list out by
 * hand, every time, which is why reports sat.
 *
 * Authenticated by a read link — a capability minted in the admin panel, held
 * as a digest, scoped to this one endpoint, expiring and revocable. Explicitly
 * NOT an admin session: handing over an admin password to solve "read one
 * table" grants everything forever and cannot be taken back without changing it
 * for everybody.
 *
 * READ ONLY, and structurally so. This handler has no write path and reaches no
 * other model. The only mutation anywhere near it is the use counter, which
 * exists so the owner can audit the link they issued.
 *
 * The token goes in the Authorization header rather than the query string,
 * because a query string is written to every access log it passes through.
 * `?token=` is accepted as well, since a link somebody pastes into a browser
 * has nowhere else to put it — that is a deliberate convenience with a real
 * cost, and it is why these expire.
 */
bugReportsRouter.get("/export", exportLimit, async (c) => {
  const header = c.req.header("Authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  const token = bearer || c.req.query("token") || null;

  const linkId = await verifyReadLink(token);
  if (!linkId) {
    // One answer for every rejection. No such link, revoked and expired are
    // the same 401, because the difference only helps somebody guessing.
    return c.json(
      { error: "This link is not valid. It may have expired or been revoked; the admin panel can issue another." },
      { status: 401 },
    );
  }

  // Awaited, not fired and forgotten. A capability whose use is not recorded is
  // one nobody can audit, and shaving a few milliseconds is not worth that.
  await recordUse(linkId);

  const status = c.req.query("status") ?? "open";
  const where = status === "all" ? {} : { status };

  const reports = await prisma.bugReport.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return c.json({
    status,
    count: reports.length,
    openCount: await prisma.bugReport.count({ where: { status: "open" } }),
    reports,
  });
});

export { bugReportsRouter };
