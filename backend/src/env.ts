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
/**
 * A secret, as it actually arrives: pasted.
 *
 * Trimmed, and an empty string treated as absent. A trailing newline survives
 * every dashboard that stores it and produces a 401 from the provider, which
 * reads to whoever set it as "the key I definitely set does not work" — and
 * sends everybody looking for a bug in the code instead of a space in the box.
 *
 * Every key on this platform goes through this, in one place, because the
 * alternative was the situation this replaced: half the keys read straight off
 * process.env with no trimming and no schema, and two of them
 * (OPENAI_API_KEY, GEMINI_API_KEY) named nowhere at all — not here, not in
 * .env.example — while every Citizen's Brief depended on one of them.
 */
const secret = () =>
  z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });

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
  // e.g. "https://ayeandnay.com,https://www.ayeandnay.com".
  //
  // Both the CORS allowlist (index.ts) and Better Auth's trustedOrigins
  // (auth.ts) are derived from this. They used to be maintained as two separate
  // hardcoded lists where CORS was a strict subset of trustedOrigins — so a
  // domain added to one but not the other produced a login that failed with no
  // useful error. One variable, both lists.
  APP_ORIGINS: z.string().optional().default(""),

  // Comma-separated deep-link schemes for the native app, e.g. "ayeandnay".
  // Must match expo.scheme in app.json and the scheme passed to expoClient().
  APP_SCHEMES: z.string().optional().default(""),

  // Transactional email (Resend). Carries the sign-in and password-reset
  // one-time codes.
  //
  // Optional at boot so a local checkout without a key still starts; the send
  // path throws instead. That split is deliberate — the implementation this
  // replaced returned silently when it could not send, which is how password
  // reset came to be broken in production without anyone noticing.
  // Trimmed, because a key is almost always pasted. A trailing newline or a
  // stray space survives every UI that stores it and produces a 401 from the
  // provider that reads, to whoever set it, as "the key I definitely set does
  // not work". An empty string after trimming is treated as unset rather than
  // as a key that happens to be blank.
  RESEND_API_KEY: secret(),
  // Must be a verified sender on a domain you control in Resend, or delivery
  // fails even with a valid key.
  //
  // THIS IS THE SECOND HALF OF "EMAIL DOESN'T WORK", and the half that looks
  // like a missing key when it is not one. Resend refuses any message whose
  // From address is on a domain the account has not verified — a correct key
  // and an unverified sender fail identically from outside. The default below
  // is a placeholder: unless ayeandnay.com is verified in the Resend account
  // this key belongs to, every send is refused. Use onboarding@resend.dev while
  // testing; it needs no DNS and delivers only to the address the account was
  // opened with.
  EMAIL_FROM: z
    .string()
    .optional()
    .default("AYE & NAY <noreply@ayeandnay.com>")
    .transform((value) => value.trim()),
  // Where the message is actually POSTed. Overridable for one reason: the test
  // suite points it at a local Bun.serve and reads the body, which is the only
  // way to prove the code a citizen is told to type is the code that leaves the
  // building. Never set in production.
  RESEND_ENDPOINT: z.url().optional().default("https://api.resend.com/emails"),

  // Government API Keys
  //
  // congress.gov: bills. Without it there is no legislative text at all.
  CONGRESS_API_KEY: secret(),
  // CourtListener: Supreme Court opinions. Not optional in practice — the
  // opinion endpoint answers 401 without a token.
  COURTLISTENER_API_KEY: secret(),

  // api.data.gov. ONE KEY, SEVERAL AGENCIES: api.data.gov is a shared gateway,
  // and the same key authenticates api.congress.gov, api.govinfo.gov and
  // api.regulations.gov. Measured, not assumed — the public DEMO_KEY answers
  // 200 from congress.gov, and govinfo and regulations.gov both accept it and
  // fail on their own terms (a rate limit and a parameter complaint) rather
  // than rejecting the key.
  //
  // So this IS a congress.gov key: congressGovKey() below falls back to it when
  // CONGRESS_API_KEY is unset, and the key report says which of the two a
  // request actually used. Nothing else reads it yet — govinfo and
  // regulations.gov are not wired up — and the report says that too rather than
  // implying a feature that does not exist.
  DATA_GOV_API_KEY: secret(),

  // Live web-search grounding for legislative search (services/web-search.ts).
  // Optional — search falls back to unaided AI interpretation without it.
  TAVILY_API_KEY: secret(),

  // ---------------------------------------------------------------------------
  // Model keys. At least one, or no Citizen's Brief can be written for any law.
  // ---------------------------------------------------------------------------
  //
  // THESE WERE NAMED NOWHERE. Not in this file, not in .env.example — the file
  // that is supposed to be the complete list of what to set. services/
  // ai-generate.ts read them straight off process.env, so anybody setting this
  // deployment up by following the documentation would never set one, and every
  // brief would fail with no indication that a variable was missing. That is
  // not a key that could not be found; that is a key nobody was told existed.
  GEMINI_API_KEY: secret(),
  OPENAI_API_KEY: secret(),

  // ---------------------------------------------------------------------------
  // The one key that unlocks the others.
  // ---------------------------------------------------------------------------
  //
  // 32 bytes, base64 or hex. Every key above can be stored in the database
  // instead of here — encrypted with this one, by the super admin, from the
  // admin console — which is what makes the container host replaceable rather
  // than load-bearing. See services/platform-secrets.ts.
  //
  // THIS ONE CANNOT MOVE INTO THE DATABASE, and neither can DATABASE_URL or
  // BETTER_AUTH_SECRET: a process needs the database before it can read
  // anything out of it, and a key kept next to the thing it encrypts is not
  // encryption. Three variables, then, wherever this container runs — not ten.
  //
  // Optional: without it the server runs exactly as it did before, reading
  // every key from this environment. Stored keys are refused rather than
  // written in the clear, and the admin console says so.
  //
  // Generate one with: openssl rand -base64 32
  SECRETS_ENCRYPTION_KEY: secret(),

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
 * Every secret this platform reads. Kept as a list so the live-read wrapper
 * below and the key report cannot drift apart from the schema.
 */
const SECRET_KEYS = [
  "SECRETS_ENCRYPTION_KEY",
  "RESEND_API_KEY",
  "CONGRESS_API_KEY",
  "COURTLISTENER_API_KEY",
  "TAVILY_API_KEY",
  "DATA_GOV_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
] as const;

/**
 * Validated and typed environment variables.
 *
 * SECRETS ARE READ LIVE, EVERYTHING ELSE IS THE BOOT SNAPSHOT.
 *
 * The distinction matters and it was learned the hard way. Parsing once at
 * import is right for DATABASE_URL: it must be present or the process has no
 * business starting, and it cannot meaningfully change afterwards. Applying the
 * same rule to keys made `env.CONGRESS_API_KEY` a value frozen at whatever
 * moment this module happened to be imported — which is an import-order
 * landmine, and import-order landmines are precisely the family of bug that
 * produced "the key is definitely set and it still does not work" three times
 * on this project.
 *
 * So a key is read from process.env on every access and trimmed on the way out.
 * Same one name, same one trimming rule, same schema documenting it — and no
 * dependence on when anything was imported.
 */
function liveSecrets<T extends object>(snapshot: T): T {
  const live = { ...snapshot };
  for (const key of SECRET_KEYS) {
    Object.defineProperty(live, key, {
      enumerable: true,
      get(): string | undefined {
        const raw = process.env[key];
        const trimmed = raw?.trim();
        return trimmed ? trimmed : undefined;
      },
    });
  }
  return live;
}

export const env = liveSecrets(validateEnv());

/**
 * The key to send to api.congress.gov.
 *
 * CONGRESS_API_KEY first, then DATA_GOV_API_KEY. They are the same kind of
 * credential — congress.gov is one of the agencies behind the api.data.gov
 * gateway, and a key issued there works on it — so somebody who has a data.gov
 * key already has a congress.gov key and should not have to discover that by
 * reading source code.
 *
 * A function rather than a second field on `env`, because the fallback is a
 * decision and decisions should be greppable. Six callers, one rule.
 */
export function congressGovKey(): string | undefined {
  return env.CONGRESS_API_KEY ?? env.DATA_GOV_API_KEY;
}

/** Which of the two names supplied the key a congress.gov call will use. */
export function congressGovKeySource(): "CONGRESS_API_KEY" | "DATA_GOV_API_KEY" | null {
  if (env.CONGRESS_API_KEY) return "CONGRESS_API_KEY";
  if (env.DATA_GOV_API_KEY) return "DATA_GOV_API_KEY";
  return null;
}

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
