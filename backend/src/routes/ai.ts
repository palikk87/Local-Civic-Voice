import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { aiGenerateRequestSchema } from "../types";
import { aiAvailability, generateAI } from "../services/ai-generate";
import { aiRateLimit } from "../middleware/rate-limit";
import type { auth } from "../auth";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const aiRouter = new Hono<{ Variables: AuthVariables }>();

// Keeps provider API keys server-side. Mobile and web both send prompts here
// instead of embedding an API key in client code (no client-side key is ever provisioned).
// The provider chain itself lives in services/ai-generate.ts so the citizen brief
// pipeline runs through the identical path.

// Reports which providers are configured, as booleans. Left unauthenticated
// because clients call it before sign-in to decide whether to show AI affordances
// at all, and it exposes no key material.
aiRouter.get("/availability", (c) => {
  return c.json(aiAvailability());
});

// Requires a signed-in user.
//
// This route spends the server's OPENAI_API_KEY / GEMINI_API_KEY on whatever
// prompt it is handed. It previously had no auth check at all, so anyone who
// knew the URL could bill generations to this project — the only thing standing
// in the way was the 100 req/min general limit. Authentication also gives the
// rate limiter a user id to key on instead of an IP.
aiRouter.post(
  "/generate",
  aiRateLimit,
  zValidator("json", aiGenerateRequestSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const result = await generateAI(c.req.valid("json"));

    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }

    return c.json({ content: result.content });
  }
);

export { aiRouter };
