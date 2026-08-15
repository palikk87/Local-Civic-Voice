/**
 * Test harness: boot the real server, hit it over HTTP.
 *
 * Deliberately not importing `app` and calling `app.fetch` directly. Importing
 * src/index.ts has side effects that are part of what we want covered — env
 * validation, the storage check, the job queue, Prisma connecting — and every
 * production failure this project has actually suffered happened at boot, not
 * in a handler. A test that skips the boot would have caught none of them.
 *
 * Requires a Postgres. CI provides one as a service; locally, point
 * TEST_DATABASE_URL at any throwaway database. The schema is applied with
 * `prisma migrate deploy`, which is the same single command production runs.
 */

import { spawn, type Subprocess } from "bun";
import { PrismaClient } from "@prisma/client";

const PORT = Number(process.env.TEST_PORT ?? 3999);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";

let server: Subprocess | null = null;

/**
 * Throwaway B2B credentials for the test server.
 *
 * Exported so the tests log in with these rather than repeating literals — the
 * whole point of this change is that no credential is hardcoded anywhere a
 * reader can reach, and a test file is exactly such a place.
 */
export const B2B_TEST = {
  demoUsername: "test_demo_client",
  demoPassword: "test-demo-password-not-a-real-one",
  demoApiKey: "test-demo-api-key-not-a-real-one",
  adminUsername: "test_admin_client",
  adminPassword: "test-admin-password-not-a-real-one",
  adminApiKey: "test-admin-api-key-not-a-real-one",
} as const;

/**
 * Everything the server has written to stdout/stderr since boot.
 *
 * Needed because some failures are deliberately invisible over HTTP. Better
 * Auth returns 200 from the OTP endpoint whether or not the mail actually went
 * out — that is correct, since a different status for "no such account" hands
 * an attacker an account-enumeration oracle. The consequence is that the
 * operator-facing signal is the log, so a test that cares whether a failure was
 * loud has to read it.
 */
let serverOutput = "";

export function serverLog(): string {
  return serverOutput;
}

/**
 * Wait until the server logs something matching `needle`, or give up.
 *
 * Polling rather than sleeping a fixed interval: the handler that writes the
 * line is async, and a fixed wait is a race that passes on a fast machine and
 * fails on a loaded one. It did exactly that here before this was added.
 *
 * `from` is an offset into the accumulated log so a test only sees output
 * produced after it started.
 */
export async function waitForLog(needle: string, from = 0, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverOutput.slice(from).includes(needle)) return true;
    await Bun.sleep(50);
  }
  return false;
}

export const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

function env(): Record<string, string> {
  return {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATABASE_URL,
    DIRECT_URL: DATABASE_URL,
    BACKEND_URL: BASE_URL,
    // Long enough to satisfy Better Auth; this is a throwaway test value and
    // signs nothing that outlives the process.
    BETTER_AUTH_SECRET: "test-only-secret-value-not-used-anywhere-else",
    APP_ORIGINS: BASE_URL,
    APP_SCHEMES: "civicvoice",
    MEDIA_STORAGE: "local",
    UPLOADS_DIR: "/tmp/civicvoice-test-uploads",
    // No RESEND_API_KEY on purpose: the send path must throw rather than
    // silently succeed, and one of the tests asserts exactly that.

    // B2B portal accounts. Required with no defaults, so the harness must
    // supply them — which is itself the assertion that the boot fails without
    // them. Values are throwaway and exist only inside this process.
    B2B_DEMO_USERNAME: B2B_TEST.demoUsername,
    B2B_DEMO_PASSWORD: B2B_TEST.demoPassword,
    B2B_DEMO_API_KEY: B2B_TEST.demoApiKey,
    B2B_ADMIN_USERNAME: B2B_TEST.adminUsername,
    B2B_ADMIN_PASSWORD: B2B_TEST.adminPassword,
    B2B_ADMIN_API_KEY: B2B_TEST.adminApiKey,
  };
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never responded";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(250);
  }

  throw new Error(`Server did not become healthy within ${timeoutMs}ms: ${lastError}`);
}

export async function startServer(): Promise<void> {
  // Refuse to start on top of somebody else.
  //
  // stopServer() used to call kill() and return immediately, so a previous
  // run's process could still hold the port. This run's server then failed to
  // bind, waitForHealth() was answered by the DYING one, and the suite ran
  // against a server carrying the last run's rate-limiter state — which
  // produced a perfect alternating pass/fail across consecutive runs.
  const squatter = await fetch(`${BASE_URL}/health`).catch(() => null);
  if (squatter?.ok) {
    throw new Error(
      `Something is already serving ${BASE_URL}. Stop it before running the tests — ` +
        `otherwise they run against a process this suite does not control.`,
    );
  }

  // One command, empty database to full schema. If this ever needs a second
  // step, the clean-slate migration has regressed and the tests should say so.
  const migrate = spawn({
    cmd: ["bunx", "prisma", "migrate", "deploy"],
    env: env(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const migrateCode = await migrate.exited;
  if (migrateCode !== 0) {
    throw new Error(`prisma migrate deploy failed: ${await new Response(migrate.stderr).text()}`);
  }

  serverOutput = "";
  server = spawn({
    cmd: ["bun", "src/index.ts"],
    env: env(),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Drain both streams continuously. Reading them only at the end would let the
  // pipe buffer fill and block the server mid-test.
  for (const stream of [server.stdout, server.stderr]) {
    if (stream instanceof ReadableStream) {
      void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream) {
          serverOutput += decoder.decode(chunk);
        }
      })();
    }
  }

  await waitForHealth();
}

export async function stopServer(): Promise<void> {
  await prisma.$disconnect();
  if (server) {
    server.kill();
    // Wait for it to actually exit. kill() only sends the signal; returning
    // before the process is gone leaves the port held for the next run.
    await server.exited;
    server = null;
  }
}

/** Wipe rows between tests without touching the schema. */
export async function resetData(): Promise<void> {
  // Order matters only where cascades do not cover it; truncating together with
  // CASCADE keeps this from becoming a dependency puzzle every time a model is
  // added.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Session", "Account", "Verification",
      "GovernmentReferenceVote", "GovernmentReference",
      "Message", "ConversationParticipant", "Conversation",
      "AdminSession", "B2BSession", "AdminActivityLog", "Announcement",
      "User"
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Sign up and return the session cookie.
 *
 * Better Auth sets an httpOnly cookie; fetch does not keep a jar, so tests
 * carry it explicitly. Returning the raw header keeps this honest about what
 * the browser actually does.
 *
 * Each call presents a distinct X-Forwarded-For. The auth rate limiter is
 * per-IP, and a suite that signs up five accounts in three seconds looks
 * exactly like an attack from one address — which is the limiter working. The
 * alternative was raising the limit for tests, i.e. testing a configuration
 * that never ships. Distinct clients is what the real world looks like.
 */
let clientCounter = 0;

/**
 * A distinct client address for one request.
 *
 * Everything under /api/auth/* shares a 10-per-minute limit keyed by IP, and a
 * request with no X-Forwarded-For falls back to a single shared key — so
 * sign-up, get-session and the OTP endpoint all counted against each other and
 * the suite tripped its own limiter intermittently, depending on order and
 * timing. Giving each call its own address is what a real set of users looks
 * like; raising the limit for tests would mean testing a configuration that
 * never ships.
 */
export function freshClientHeaders(extra: Record<string, string> = {}): Record<string, string> {
  clientCounter += 1;
  return {
    "x-forwarded-for": `203.0.113.${clientCounter % 250}`,
    ...extra,
  };
}

let signUpCount = 0;

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ cookie: string; userId: string }> {
  signUpCount += 1;
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("sign-up returned no session cookie");

  const body = (await response.json()) as { user?: { id: string } };
  const userId = body.user?.id;
  if (!userId) throw new Error("sign-up returned no user id");

  return { cookie: setCookie.split(";")[0]!, userId };
}
