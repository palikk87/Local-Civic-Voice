import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import type { auth } from "../auth";
import { publicHandle } from "../services/public-identity";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const billsRouter = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
});

const voteSchema = z.object({
  position: z.enum(["support", "oppose"]),
});

/**
 * GET /api/bills
 * Get bills list (paginated)
 */
billsRouter.get("/", zValidator("query", paginationSchema), async (c) => {
  const { limit, cursor, category, status } = c.req.valid("query");
  const user = c.get("user");

  const bills = await prisma.bill.findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    where: {
      ...(category ? { category } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          votes: true,
          posts: true,
        },
      },
      votes: user ? {
        where: { userId: user.id },
        select: { position: true },
      } : false,
    },
  });

  const hasMore = bills.length > limit;
  const results = hasMore ? bills.slice(0, -1) : bills;
  const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

  // Get vote counts for each bill
  const billsWithVotes = await Promise.all(
    results.map(async (bill) => {
      const voteCounts = await prisma.vote.groupBy({
        by: ["position"],
        where: { billId: bill.id },
        _count: true,
      });

      const support = voteCounts.find((v) => v.position === "support")?._count ?? 0;
      const oppose = voteCounts.find((v) => v.position === "oppose")?._count ?? 0;

      return {
        id: bill.id,
        title: bill.title,
        summary: bill.summary,
        category: bill.category,
        status: bill.status,
        chamber: bill.chamber,
        sponsor: bill.sponsor,
        introducedDate: bill.introducedDate?.toISOString(),
        lastActionDate: bill.lastActionDate?.toISOString(),
        lastAction: bill.lastAction,
        votes: {
          support,
          oppose,
          total: support + oppose,
        },
        postsCount: bill._count.posts,
        userVote: user && bill.votes && Array.isArray(bill.votes) && bill.votes.length > 0 ? bill.votes[0]?.position ?? null : null,
        createdAt: bill.createdAt.toISOString(),
      };
    })
  );

  return c.json({
    bills: billsWithVotes,
    nextCursor,
    hasMore,
  });
});

/**
 * GET /api/bills/:id
 * Get a single bill
 */
billsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          votes: true,
          posts: true,
        },
      },
      votes: user ? {
        where: { userId: user.id },
        select: { position: true },
      } : false,
    },
  });

  if (!bill) {
    return c.json({ error: "Bill not found" }, 404);
  }

  const voteCounts = await prisma.vote.groupBy({
    by: ["position"],
    where: { billId: bill.id },
    _count: true,
  });

  const support = voteCounts.find((v) => v.position === "support")?._count ?? 0;
  const oppose = voteCounts.find((v) => v.position === "oppose")?._count ?? 0;

  return c.json({
    bill: {
      id: bill.id,
      title: bill.title,
      summary: bill.summary,
      fullText: bill.fullText,
      category: bill.category,
      status: bill.status,
      chamber: bill.chamber,
      sponsor: bill.sponsor,
      cosponsors: bill.cosponsors ? JSON.parse(bill.cosponsors) : [],
      introducedDate: bill.introducedDate?.toISOString(),
      lastActionDate: bill.lastActionDate?.toISOString(),
      lastAction: bill.lastAction,
      sourceUrl: bill.sourceUrl,
      votes: {
        support,
        oppose,
        total: support + oppose,
      },
      postsCount: bill._count.posts,
      userVote: user && bill.votes && Array.isArray(bill.votes) && bill.votes.length > 0 ? bill.votes[0]?.position ?? null : null,
      createdAt: bill.createdAt.toISOString(),
    },
  });
});

/**
 * POST /api/bills/:id/vote
 * Vote on a bill
 */
billsRouter.post("/:id/vote", zValidator("json", voteSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }
  // The older bill-vote path. Every other vote on the platform asks whether
  // the account belongs to a confirmed person; this one never did, which made
  // it the way around all of them.
  if (!(await isVerified(user))) {
    return c.json(VERIFICATION_REQUIRED, 403);
  }

  const billId = c.req.param("id");
  const { position } = c.req.valid("json");

  const bill = await prisma.bill.findUnique({ where: { id: billId } });
  if (!bill) {
    return c.json({ error: "Bill not found" }, 404);
  }

  // Upsert vote
  const vote = await prisma.vote.upsert({
    where: {
      billId_userId: {
        billId,
        userId: user.id,
      },
    },
    update: { position },
    create: {
      billId,
      userId: user.id,
      position,
    },
  });

  // Get updated vote counts
  const voteCounts = await prisma.vote.groupBy({
    by: ["position"],
    where: { billId },
    _count: true,
  });

  const support = voteCounts.find((v) => v.position === "support")?._count ?? 0;
  const oppose = voteCounts.find((v) => v.position === "oppose")?._count ?? 0;

  return c.json({
    vote: {
      position: vote.position,
    },
    votes: {
      support,
      oppose,
      total: support + oppose,
    },
  });
});

/**
 * DELETE /api/bills/:id/vote
 * Remove vote from a bill
 */
billsRouter.delete("/:id/vote", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const billId = c.req.param("id");

  try {
    await prisma.vote.delete({
      where: {
        billId_userId: {
          billId,
          userId: user.id,
        },
      },
    });
  } catch {
    // Vote doesn't exist, that's okay
  }

  // Get updated vote counts
  const voteCounts = await prisma.vote.groupBy({
    by: ["position"],
    where: { billId },
    _count: true,
  });

  const support = voteCounts.find((v) => v.position === "support")?._count ?? 0;
  const oppose = voteCounts.find((v) => v.position === "oppose")?._count ?? 0;

  return c.json({
    votes: {
      support,
      oppose,
      total: support + oppose,
    },
  });
});

/**
 * GET /api/bills/:id/posts
 * Get posts related to a bill
 */
billsRouter.get("/:id/posts", zValidator("query", z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
})), async (c) => {
  const billId = c.req.param("id");
  const { limit, cursor } = c.req.valid("query");

  const posts = await prisma.post.findMany({
    where: { billId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
          image: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
        },
      },
    },
  });

  const hasMore = posts.length > limit;
  const results = hasMore ? posts.slice(0, -1) : posts;
  const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

  return c.json({
    posts: results.map((post) => ({
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: publicHandle(post.author),
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      createdAt: post.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
});

export { billsRouter };
