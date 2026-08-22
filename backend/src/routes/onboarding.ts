import { Hono } from "hono";
import type { auth } from "../auth";
import { neighbours, starterRecords } from "../services/onboarding";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const onboardingRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * GET /api/onboarding/records
 *
 * The records worth asking a newcomer about: the ones the room is most split
 * on, skipping anything they have already taken a position on.
 *
 * Open to a signed-out reader too — the first screen of this platform should
 * be legible before anybody has an account, and the answer is the same public
 * tally either way.
 */
onboardingRouter.get("/records", async (c) => {
  const user = c.get("user");
  const limit = Math.min(Number(c.req.query("limit") ?? 5), 20);

  const results = await starterRecords(user?.id ?? null, limit);
  return c.json({ results, count: results.length });
});

/**
 * GET /api/onboarding/neighbours
 *
 * The people whose record most resembles the reader's, and the people whose
 * record least resembles it. Both lists, always.
 */
onboardingRouter.get("/neighbours", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json(await neighbours(user.id));
});

export { onboardingRouter };
