/**
 * The sign-up code: ask for one, and find out where you stand.
 *
 * Better Auth already owns *checking* a code — `/api/auth/email-otp/verify-email`
 * flips `emailVerified` and refreshes the session cookie, and nothing here
 * should reimplement that. What it does not own is telling anybody the truth
 * about the *send*, because its endpoint answers `{ success: true }` even when
 * no mail provider is configured. That is the gap these two routes close.
 *
 * Both require a session. That is not a security decision — the gate itself is
 * enforced on every write by services/verification.ts — it is what lets these
 * routes be honest. An endpoint that takes an arbitrary email address has to
 * answer identically for an address that exists and one that does not, or it
 * becomes an account-enumeration oracle; an endpoint that only ever acts on the
 * caller's own address has nothing to leak, and can therefore say plainly "we
 * could not send that".
 */

import { Hono } from "hono";
import type { auth as authInstance } from "../auth";
import { createRateLimiter } from "../middleware/rate-limit";
import { sendVerificationCode } from "../services/email-verification";
import { isEmailConfigured } from "../services/email";
import { prisma } from "../prisma";

type AuthVariables = {
  user: typeof authInstance.$Infer.Session.user | null;
  session: typeof authInstance.$Infer.Session.session | null;
};

const verificationRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * Five a minute. Enough for "it didn't arrive, send another" pressed a few
 * times in frustration, tight enough that the address cannot be used as a free
 * mail cannon. Keyed on the session by getClientIdentifier, so it is per
 * account rather than per network.
 */
const sendCodeRateLimit = createRateLimiter({
  name: "verification-send-code",
  maxRequests: 5,
  windowMs: 60 * 1000,
  message: "Too many codes requested. Wait a minute, then try again.",
});

/**
 * GET /api/verification/email
 *
 * Where this account stands, and whether a code can be delivered at all.
 *
 * `deliverable` is reported to the signed-in citizen on purpose. A screen that
 * says "check your email" when the server knows no email can be sent is a lie,
 * and the person it lies to is the only one who can act on the truth by using a
 * different route in. It reveals nothing about anybody else's account.
 */
verificationRouter.get("/email", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, emailVerified: true },
  });
  if (!row) return c.json({ error: "Account not found" }, 404);

  return c.json({
    email: row.email,
    verified: row.emailVerified === true,
    deliverable: isEmailConfigured(),
  });
});

/**
 * POST /api/verification/email/send
 *
 * Sends a fresh code and reports what actually happened.
 *
 * 200 { sent: true }               — the provider accepted the message
 * 200 { sent: false, verified }    — already verified; nothing to do
 * 503 email_not_configured         — this deployment cannot send email
 * 502 email_send_failed            — the provider refused or was unreachable
 * 429                              — too many in a minute
 */
verificationRouter.post("/email/send", sendCodeRateLimit, async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);

  // Read the row, not the session. A session minted at sign-up says
  // emailVerified:false forever, so trusting it would keep mailing codes to
  // somebody who finished ten minutes ago.
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true, emailVerified: true },
  });
  if (!row) return c.json({ error: "Account not found" }, 404);

  if (row.emailVerified === true) {
    return c.json({ sent: false, verified: true });
  }

  const result = await sendVerificationCode(row.email);

  if (result.sent) {
    return c.json({ sent: true, verified: false, email: row.email });
  }

  const status = result.code === "email_not_configured" ? 503 : 502;
  return c.json(
    {
      sent: false,
      verified: false,
      code: result.code,
      error:
        result.code === "email_not_configured"
          ? "This server cannot send email yet, so no code can reach you."
          : "We could not send the code. The mail provider refused the message.",
      // The provider's own words, for whoever has to fix it. Nothing in here is
      // a credential — services/email.ts sends the key in a header and this is
      // the response body.
      detail: result.detail,
    },
    status
  );
});

export { verificationRouter };
