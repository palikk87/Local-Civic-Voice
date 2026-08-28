import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";
import {
  checkDelegateEligibility,
  listEligibleDelegates,
  republishTalliesAfterDelegationChange,
  resolveDelegationChain,
  voiceReceipts,
  DELEGATE_REQUIREMENTS,
} from "../services/delegation-service";
import { alignmentWith } from "../services/common-ground";
import { trustScores } from "../services/trust-score";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import { suspensionState } from "../services/impeachment";

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

  // Where each lent voice actually ends up. A delegate may have lent their own
  // voice onward, so the person a citizen chose is not always the person who
  // ends up speaking for them — and they are entitled to know that.
  const withChains = await Promise.all(
    delegations.map(async (delegation) => ({
      ...formatDelegation(delegation),
      chain: delegation.isActive
        ? await resolveDelegationChain(delegation.toUserId, delegation.category)
        : [],
    })),
  );

  return c.json({
    delegations: withChains,
    activeCount: delegations.filter((d) => d.isActive).length,
  });
});

/**
 * GET /api/delegations/delegates
 * The delegate directory — every user who has EARNED eligibility through
 * routine activity. Serves the Delegates screen on both faucets.
 */
delegationsRouter.get("/delegates", async (c) => {
  const currentUser = c.get("user");
  const delegates = await listEligibleDelegates();

  // HOW OFTEN EACH OF THEM HAS AGREED WITH THE READER, on the records where
  // both actually voted. Every delegation UI ever built asks somebody to hand
  // their vote to a stranger on the strength of a follower count and a bio,
  // because none of them have a shared record to measure against. This one
  // does, so the directory can answer the only question that matters: when I
  // have had an opinion, has this person shared it?
  //
  // Computed in one pass for the whole list rather than per card.
  const alignment = currentUser
    ? await alignmentWith(
        currentUser.id,
        delegates.map((d) => d.id),
      )
    : [];
  const byUser = new Map(alignment.map((a) => [a.userId, a]));

  // THE TRUST SCORE, ON THE CARD. "Trust scores are not meant to rank anyone.
  // They are meant to inform people when delegating votes." This list is where
  // that decision is actually made, so a score that only appeared on a profile
  // would inform nobody at the moment it mattered.
  //
  // NOTHING IS SORTED OR FILTERED BY IT. The order of this list is unchanged.
  const trust = await trustScores(delegates.map((d) => d.id));

  return c.json({
    delegates: delegates.map((delegate) => ({
      ...delegate,
      alignment: byUser.get(delegate.id) ?? null,
      trust: trust.get(delegate.id) ?? null,
    })),
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

    // CONSTITUTION ARTICLE I, SECTION 3. A delegation moves published tallies
    // the moment the delegate votes, so lending a voice is contributing to the
    // Pulse and needs the same verified account that voting does.
    if (!(await isVerified(currentUser))) {
      return c.json(VERIFICATION_REQUIRED, 403);
    }

    const { toUserId, category } = c.req.valid("json");

    if (toUserId === currentUser.id) {
      return c.json({ error: "Cannot delegate to yourself" }, 400);
    }

    const toUser = await prisma.user.findUnique({ where: { id: toUserId } });
    if (!toUser) {
      return c.json({ error: "User not found" }, 404);
    }

    // ARTICLE V. An impeached leader is suspended from RECEIVING delegations,
    // and this is the one place that means anything. Checked before eligibility
    // so the reason given is the true one — a suspended leader usually still
    // meets every activity requirement, and "not an eligible delegate" would be
    // both wrong and impossible to act on.
    //
    // Nothing else about them is blocked. They post, comment, share, follow,
    // keep their followers, and may still delegate their own vote away. The
    // penalty is the loan being called in, not the citizen being silenced.
    const suspension = await suspensionState(toUserId);
    if (suspension.suspended) {
      return c.json(
        {
          error:
            "This person was impeached by their delegators and cannot receive delegations " +
            "until the suspension lifts.",
          impeachment: {
            suspendedUntil: suspension.until?.toISOString() ?? null,
            impeachmentId: suspension.impeachmentId,
          },
        },
        403
      );
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

      // The lent voice counts from this moment, not from the next time a
      // stranger happens to vote on the same record.
      await republishTalliesAfterDelegationChange(toUserId);

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

  // Bill of Rights I: "instantly revoke ... without delay or penalty". The
  // published Pulse has to stop counting the borrowed voice before this
  // request returns.
  await republishTalliesAfterDelegationChange(delegation.toUserId);

  return c.json({ success: true });
});

export { delegationsRouter };

/**
 * GET /api/delegations/receipts
 *
 * Every time somebody else spoke in your name.
 *
 * Liquid democracy is normally sold as convenience and then goes quiet: you are
 * told how many delegations you have made, never what was done with them. This
 * platform's Constitution says political power here is "never won, only
 * borrowed" — and borrowed means you get the receipts.
 *
 * Each row names the record, the position taken, and who actually cast it,
 * which is not always the person you chose: a voice travels the chain, so it
 * can land with somebody you have never heard of. That is exactly the case
 * worth showing, and the reason to show it.
 */
delegationsRouter.get("/receipts", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const results = await voiceReceipts(currentUser.id, limit);

  return c.json({
    results,
    // How many of these were cast by somebody other than the person they chose.
    carriedOnward: results.filter((r) => r.lentTo !== null).length,
  });
});
