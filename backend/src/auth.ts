import { betterAuth } from "better-auth";
import { expo } from "@better-auth/expo";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "./prisma";
import { env } from "./env";
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

  trustedOrigins: [
    "vibecode://*/*",
    "exp://*/*",
    "http://localhost:*",
    "http://127.0.0.1:*",
    "https://*.dev.vibecode.run",
    "https://*.vibecode.run",
    "https://*.vibecodeapp.com",
    "https://*.vibecode.dev",
    "https://vibecode.dev",
  ],

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
       * hardcoded POST to Vibecode's own relay, which does not survive the
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
