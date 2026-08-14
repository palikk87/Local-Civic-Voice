import { z } from "zod";

/**
 * Resolve the database connection BEFORE validation, and before anything
 * imports ./prisma.
 *
 * Why this exists: `backend/scripts/env.sh` is regenerated from the Vibecode
 * backend template (see the "chore: upgrade backend scripts from template"
 * commits). In production that template unconditionally runs
 *
 *     export DATABASE_URL="file:/data/production.db"
 *
 * because it assumes every backend is local SQLite. This project is Supabase
 * Postgres. A real shell export outranks .env.production, so the genuine
 * connection string was being shadowed by a SQLite path, this file rejected the
 * `file:` URL, the process exited, and every /api/* call on the live site
 * returned 502. Patching the script worked for exactly one deploy — the next
 * template sync reverted it.
 *
 * So the real connection lives under SUPABASE_DATABASE_URL, a name the template
 * does not touch, and the template's leftover `file:` value is discarded here.
 * DATABASE_URL is then normalised to the resolved Postgres URL so that other
 * readers (e.g. the admin storage-health check) report the truth.
 */
function resolveDatabaseUrl(): void {
  const isUsablePostgres = (url: string | undefined): url is string =>
    !!url && (url.startsWith("postgres://") || url.startsWith("postgresql://"));

  const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
  const inheritedUrl = process.env.DATABASE_URL;

  if (isUsablePostgres(supabaseUrl)) {
    if (inheritedUrl && inheritedUrl.startsWith("file:")) {
      console.log(
        "[env] Ignoring DATABASE_URL=file:… injected by the backend script template; " +
          "using SUPABASE_DATABASE_URL (external Postgres) instead."
      );
    }
    process.env.DATABASE_URL = supabaseUrl;
  } else if (isUsablePostgres(inheritedUrl)) {
    // No SUPABASE_DATABASE_URL, but DATABASE_URL is a real Postgres string
    // (typical for a local checkout). Mirror it so Prisma, which reads
    // SUPABASE_DATABASE_URL per schema.prisma, still connects.
    process.env.SUPABASE_DATABASE_URL = inheritedUrl;
  }
  // Neither usable → leave both alone and let validation below fail loudly.

  const supabaseDirect = process.env.SUPABASE_DIRECT_URL;
  const inheritedDirect = process.env.DIRECT_URL;
  if (isUsablePostgres(supabaseDirect)) {
    process.env.DIRECT_URL = supabaseDirect;
  } else if (isUsablePostgres(inheritedDirect)) {
    process.env.SUPABASE_DIRECT_URL = inheritedDirect;
  }
}

resolveDatabaseUrl();

/**
 * Environment variable schema using Zod
 * This ensures all required environment variables are present and valid
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  BACKEND_URL: z.url("BACKEND_URL must be a valid URL").default("http://localhost:3000"), // Set via the Vibecode enviroment at run-time

  // Database — must be an external Postgres connection string (Supabase).
  //
  // Set this via SUPABASE_DATABASE_URL (see resolveDatabaseUrl above); by the
  // time validation runs, DATABASE_URL holds the resolved value.
  //
  // There is deliberately NO default. A `file:` fallback used to make a missing
  // connection string look like a working boot while every account went to a
  // SQLite file on disposable container storage, and real signups were lost that
  // way. Failing to start is the correct behaviour: loud, immediate, recoverable.
  DATABASE_URL: z
    .string()
    .min(1, "SUPABASE_DATABASE_URL is required — set the Supabase Postgres connection string")
    .refine((url) => !url.startsWith("file:"), {
      message:
        "No external Postgres connection found — SUPABASE_DATABASE_URL is missing or invalid, so " +
        "only the backend script template's SQLite path is left. Accounts must live in Supabase " +
        "Postgres, not on disposable container storage.",
    })
    .refine((url) => url.startsWith("postgres://") || url.startsWith("postgresql://"), {
      message: "SUPABASE_DATABASE_URL must be a postgresql:// connection string",
    }),

  // Resolved from SUPABASE_DIRECT_URL. Direct (non-pooled) connection, used by
  // Prisma for migrations.
  DIRECT_URL: z.string().optional(),
  SUPABASE_DATABASE_URL: z.string().optional(),
  SUPABASE_DIRECT_URL: z.string().optional(),

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
