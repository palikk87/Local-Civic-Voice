import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { aiGenerateRequestSchema } from "../types";
import { aiAvailability, generateAI } from "../services/ai-generate";

const aiRouter = new Hono();

// Keeps provider API keys server-side. Mobile and web both send prompts here
// instead of embedding an API key in client code (no client-side key is ever provisioned).
// The provider chain itself lives in services/ai-generate.ts so the citizen brief
// pipeline runs through the identical path.
aiRouter.get("/availability", (c) => {
  return c.json(aiAvailability());
});

aiRouter.post("/generate", zValidator("json", aiGenerateRequestSchema), async (c) => {
  const result = await generateAI(c.req.valid("json"));

  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }

  return c.json({ content: result.content });
});

export { aiRouter };
