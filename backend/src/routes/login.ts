import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { auth } from "../auth";

/**
 * Flexible login: accepts either an email address or a username as the
 * `identifier`, resolves it to the account email, then signs in via Better
 * Auth. The Better Auth response (including the Set-Cookie session header) is
 * forwarded verbatim so the browser session is established exactly as it would
 * be for a normal /api/auth/sign-in/email call.
 */
const loginRouter = new Hono();

loginRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      identifier: z.string().min(1, "Enter your email or username."),
      password: z.string().min(1, "Enter your password."),
    })
  ),
  async (c) => {
    const { identifier, password } = c.req.valid("json");
    const cleaned = identifier.trim();

    let email = cleaned.toLowerCase();

    // No "@" → treat it as a username and look up the matching email (case-insensitive).
    if (!cleaned.includes("@")) {
      // Try exact match first (fast path)
      let user = await prisma.user.findUnique({
        where: { username: cleaned },
        select: { email: true },
      });

      // If not found, search case-insensitively
      if (!user) {
        const allUsers = await prisma.user.findMany({
          where: {},
          select: { email: true, username: true },
        });
        const found = allUsers.find((u) => u.username?.toLowerCase() === cleaned.toLowerCase());
        if (!found) {
          return c.json(
            { error: { message: "No account found with that username." } },
            401
          );
        }
        user = found;
      }

      email = user.email;
    }

    // Delegate to Better Auth and forward its response (cookies included).
    return auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
  }
);

export { loginRouter };
