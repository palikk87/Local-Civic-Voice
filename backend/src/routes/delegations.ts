import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import {
  checkDelegateEligibility,
  listEligibleDelegates,
  DELEGATE_REQUIREMENTS,
} from "../services/delegation-service";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const delegationsRouter = new Hono<{ Variables: AuthVariables }>();

function formatDelegation(delegation: {
  id: string;
  category: string | null;
  isActive: boolean;
  createdAt: Date;
  toUser: { id: string; name: string; username: string | null; image: string | null };
}) {
  return {
    id: delegation.id,
    toUser: {
      id: delegation.toUser.id,
      name: delegation.toUser.name,
      username: delegation.toUser.username,
      image: delegation.toUser.image,
    },
    category: delegation.category,
    isActive: delegation.isActive,
    createdAt: delegation.createdAt.toISOString(),
  };
}

/**
 * GET /api/delegations/me
 * Get the current user's delegations (votes delegated to other users)
 */
delegationsRouter.get("/me", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const delegations = await prisma.delegation.findMany({
    where: { fromUserId: currentUser.id },
    orderBy: { createdAt: "desc" },
    include: {
      toUser: {
        select: { id: true, name: true, username: true, image: true },
      },
    },
  });

  return c.json({
    delegations: delegations.map(formatDelegation),
    activeCount: delegations.filter((d) => d.isActive).length,
  });
});

/**
 * GET /api/delegations/delegates
 * The delegate directory — every user who has EARNED eligibility through
 * routine activity. Serves the Delegates screen on both faucets.
 */
delegationsRouter.get("/delegates", async (c) => {
  const delegates = await listEligibleDelegates();
  return c.json({
    delegates,
    requirements: DELEGATE_REQUIREMENTS,
  });
});

/**
 * GET /api/delegations/eligibility
 * The current user's own progress toward delegate eligibility.
 */
delegationsRouter.get("/eligibility", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const result = await checkDelegateEligibility(currentUser.id);
  if (!result) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json(result);
});

/**
 * POST /api/delegations
 * Create a delegation to another user (optionally scoped to a category)
 */
delegationsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      toUserId: z.string().min(1),
      category: z.string().min(1).max(100).optional(),
    })
  ),
  async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const { toUserId, category } = c.req.valid("json");

    if (toUserId === currentUser.id) {
      return c.json({ error: "Cannot delegate to yourself" }, 400);
    }

    const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!toUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // Eligibility is EARNED — only routinely active accounts may receive
    // delegations. Enforced here so no client can bypass it.
    const eligibility = await checkDelegateEligibility(toUserId);
    if (!eligibility?.eligible) {
      return c.json(
        {
          error: "This user is not an eligible delegate",
          requirements: eligibility?.requirements ?? [],
        },
        400
      );
    }

    // Block direct circular delegation (they already delegate to you)
    const reverse = await prisma.delegation.findFirst({
      where: { fromUserId: toUserId, toUserId: currentUser.id, isActive: true },
    });
    if (reverse) {
      return c.json({ error: "Circular delegation is not allowed" }, 400);
    }

    try {
      const delegation = await prisma.delegation.create({
        data: {
          fromUserId: currentUser.id,
          toUserId,
          category: category ?? null,
        },
        include: {
          toUser: {
            select: { id: true, name: true, username: true, image: true },
          },
        },
      });

      return c.json({ delegation: formatDelegation(delegation) }, 201);
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return c.json({ error: "Delegation already exists" }, 409);
      }
      throw err;
    }
  }
);

/**
 * DELETE /api/delegations/:id
 * Revoke (delete) a delegation
 */
delegationsRouter.delete("/:id", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");

  const delegation = await prisma.delegation.findUnique({ where: { id } });
  if (!delegation || delegation.fromUserId !== currentUser.id) {
    return c.json({ error: "Delegation not found" }, 404);
  }

  await prisma.delegation.delete({ where: { id } });

  return c.json({ success: true });
});

export { delegationsRouter };
