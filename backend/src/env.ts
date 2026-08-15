import { z } from "zod";

/**
 * Environment variable schema.
 *
 * Nothing here has a fallback that points somewhere different from what was
 * asked for. A missing or malformed value fails the boot; it never resolves to
 * a quiet second choice. That rule is the scar tissue from this project's
 * history — a `file:` SQLite fallback once stood in for a missing Postgres URL,
 * so the server looked healthy while every account was written to disposable
 * container storage.
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),

  // The API's own public URL. Used to build absolute links (media URLs, email
  // deep links). Set it to the address the host serves this process on.
  BACKEND_URL: z.url("BACKEND_URL must be a valid URL").default("http://localhost:3000"),

  // Pooled Postgres connection. Any Postgres — Supabase, RDS, Neon, a VPS.
  // Nothing in this codebase depends on who runs it.
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required — the pooled Postgres connection string")
    .refine((url) => url.startsWith("postgres://") || url.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// connection string",
    }),

  // Unpooled Postgres connection, used by `prisma migrate`. Required in
  // production: transaction poolers reject the session-level statements
  // migrations issue, and discovering that during a deploy is worse than
  // discovering it at boot.
  DIRECT_URL: z
    .string()
    .optional()
    .refine((url) => !url || url.startsWith("postgres://") || url.startsWith("postgresql://"), {
      message: "DIRECT_URL must be a postgres:// or postgresql:// connection string",
    }),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),

  // Comma-separated list of web origins allowed to make credentialed requests,
  // e.g. "https://civicvoice.app,https://www.civicvoice.app".
  //
  // Both the CORS allowlist (index.ts) and Better Auth's trustedOrigins
  // (auth.ts) are derived from this. They used to be maintained as two separate
  // hardcoded lists where CORS was a strict subset of trustedOrigins — so a
  // domain added to one but not the other produced a login that failed with no
  // useful error. One variable, both lists.
  APP_ORIGINS: z.string().optional().default(""),

  // Comma-separated deep-link schemes for the native app, e.g. "civicvoice".
  // Must match expo.scheme in app.json and the scheme passed to expoClient().
  APP_SCHEMES: z.string().optional().default(""),

  // Transactional email (Resend). Carries the sign-in and password-reset
  // one-time codes.
  //
  // Optional at boot so a local checkout without a key still starts; the send
  // path throws instead. That split is deliberate — the implementation this
  // replaced returned silently when it could not send, which is how password
  // reset came to be broken in production without anyone noticing.
  RESEND_API_KEY: z.string().optional(),
  // Must be a verified sender on a domain you control in Resend, or delivery
  // fails even with a valid key.
  EMAIL_FROM: z.string().optional().default("Civic Voice <noreply@civicvoice.app>"),

  // Government API Keys
  CONGRESS_API_KEY: z.string().optional(),
  COURTLISTENER_API_KEY: z.string().optional(),

  // Live web-search grounding for legislative search (services/web-search.ts).
  // Optional — search falls back to unaided AI interpretation without it.
  TAVILY_API_KEY: z.string().optional(),

  // ---------------------------------------------------------------------------
  // NOT HERE ANY MORE: the six B2B_* variables
  // ---------------------------------------------------------------------------
  // B2B_DEMO_USERNAME / _PASSWORD / _API_KEY and B2B_ADMIN_USERNAME / _PASSWORD
  // / _API_KEY used to be required here, because routes/b2b.ts built its client
  // list out of them at import time.
  //
  // Accounts are rows in the B2BClient table now, with hashed credentials, so
  // the API reads none of them. They are input to scripts/seed-b2b.ts, in the
  // same way ADMIN_EMAIL and ADMIN_PASSWORD are input to scripts/seed-admin.ts
  // and are likewise absent from this file.
  //
  // Nothing validates them, on purpose: they are set in whatever shell runs the
  // seed, once, and a variable this process never reads has no business failing
  // this process's boot. Leaving them set on the host is harmless — extra
  // variables are ignored — but they can be deleted once the seed has run.
});

/**
 * Validate and parse environment variables
 */
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    console.log("✅ Environment variables validated successfully");
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("❌ Environment variable validation failed:");
      error.issues.forEach((err: any) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validated and typed environment variables
 */
export const env = validateEnv();

/**
 * Type of the validated environment variables
 */
export type Env = z.infer<typeof envSchema>;

const isProduction = env.NODE_ENV === "production";

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/**
 * Web origins permitted to make credentialed browser requests.
 *
 * Single source for the CORS allowlist and Better Auth's trustedOrigins. Those
 * were previously two hardcoded lists in different files, with CORS a strict
 * subset — so an origin present in one but not the other produced a login that
 * failed with no useful error. Adding a domain is now one env var.
 *
 * Localhost is included outside production so a local web build can talk to a
 * deployed API; production takes exactly what APP_ORIGINS lists.
 */
export const appOrigins: string[] = splitList(env.APP_ORIGINS);

export const corsOriginPatterns: RegExp[] = [
  ...appOrigins.map(
    (origin) => new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)
  ),
  ...(isProduction
    ? []
    : [/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/]),
];

/**
 * Origins Better Auth will accept, including the native app's deep-link scheme.
 * Expo's `exp://` is dev-only and deliberately absent in production.
 */
export const trustedOrigins: string[] = [
  ...appOrigins,
  ...splitList(env.APP_SCHEMES).map((scheme) => `${scheme}://*/*`),
  ...(isProduction ? [] : ["exp://*/*", "http://localhost:*", "http://127.0.0.1:*"]),
];

if (isProduction && appOrigins.length === 0) {
  console.warn(
    "⚠️  APP_ORIGINS is empty in production. No browser origin can complete a " +
      "credentialed login — set it to your web domain(s), comma-separated."
  );
}

/**
 * Extend process.env with our environment variables
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line import/namespace
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}
