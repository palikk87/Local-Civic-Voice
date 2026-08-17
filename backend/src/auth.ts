import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env, trustedOrigins } from "./env";
import { sendOtpEmail } from "./services/email";

/** Seeded sample accounts, so signup logs only report real people. */
function isSampleAccount(user: { email: string }): boolean {
  return user.email.endsWith("@sample.civicvoice.app");
}

export const auth = betterAuth({
  // Postgres (Supabase) — the one durable source of truth for accounts.
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BACKEND_URL,

  /**
   * Profile fields carried in the session payload.
   *
   * Without these, each client had to reconstruct the profile itself and the
   * two did it differently: mobile's SessionBridge fetched /api/users/:id for
   * the real record, while web derived the handle from `email.split('@')[0]`.
   * The same account therefore displayed a different username depending on
   * which client you opened — the clearest symptom of "one account, two
   * experiences".
   *
   * Returning them here makes both clients read the same values from the same
   * place, so they agree by construction rather than by two hand-maintained
   * code paths staying in sync.
   */
  user: {
    additionalFields: {
      username: { type: "string", required: false },
      displayUsername: { type: "string", required: false },
      bio: { type: "string", required: false },
      location: { type: "string", required: false },
      role: { type: "string", required: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (isSampleAccount(user)) return;
          console.log(`[Signup] New account created: ${user.email}`);
        },
      },
    },
  },

  // Derived from APP_ORIGINS / APP_SCHEMES so this and the CORS allowlist in
  // index.ts can never drift apart again. The host platform's wildcards that
  // live here are gone: they granted login to domains this project does not
  // control, and they were a superset of what CORS actually permitted.
  trustedOrigins,

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    requireEmailVerification: false,
    autoSignIn: true,
  },

  plugins: [
    expo(),
    emailOTP({
      /**
       * Delivers every code type, not just sign-in.
       *
       * This handler used to open with `if (type !== "sign-in") return;`. The
       * forgot-password flow calls sendVerificationOtp({ type:
       * "forget-password" }), so reset codes were generated and recorded but
       * never sent — and the early return meant no error surfaced anywhere.
       * Password reset was broken in production for as long as that guard
       * existed, on both clients, with nothing in the logs.
       *
       * Transport is Resend (services/email.ts). The previous one was a
       * hardcoded POST to the old host platform's own relay, which does not
       * move off that platform.
       */
      async sendVerificationOTP({ email, otp, type }) {
        await sendOtpEmail(email, String(otp), type);
      },
    }),
  ],

  advanced: {
    trustedProxyHeaders: true,
    disableCSRFCheck: true,
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      partitioned: true,
    },
  },
});
