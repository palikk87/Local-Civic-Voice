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
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const PORT = Number(process.env.TEST_PORT ?? 3999);
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";

let server: Subprocess | null = null;

/**
 * Where the test server writes uploads.
 *
 * Exported so a test can put a file there directly. That is how "media stored
 * under the old key format still resolves" is checked: write the bytes at a key
 * of the old shape, then fetch it over HTTP the way a browser would.
 *
 * ABSOLUTE on purpose. This used to be relative, because hono/bun's serveStatic
 * resolved `root` against process.cwd() and served nothing for an absolute
 * path — so the harness had to avoid the shape every deployment guide tells you
 * to use, which meant the media tests exercised a configuration no operator
 * runs. /uploads/* is served by hand now and takes a real path, so the suite
 * uses the same shape production does.
 *
 * TEST_UPLOADS_PATH is an alias kept for the tests that write into it.
 */
export const TEST_UPLOADS_DIR = resolve(process.cwd(), ".test-uploads");
export const TEST_UPLOADS_PATH = TEST_UPLOADS_DIR;

/**
 * Throwaway B2B credentials for the test server.
 *
 * Exported so the tests log in with these rather than repeating literals — the
 * whole point of this change is that no credential is hardcoded anywhere a
 * reader can reach, and a test file is exactly such a place.
 *
 * These are no longer environment variables the server reads. They are what
 * seedB2BClients() writes into B2BClient, the same way scripts/seed-b2b.ts does
 * in production — so the tests exercise the real credential store rather than a
 * test-only shortcut into it.
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

/**
 * The same database, visible to code imported directly into the test process.
 *
 * Almost everything here is exercised over HTTP against the real server, which
 * is where its own DATABASE_URL comes from. A few things have no endpoint —
 * "tell everyone who shared this law that it changed" is triggered by the daily
 * sync, not by a request — and testing those means importing the service. Those
 * imports build their own Prisma client from the environment, so it has to name
 * the same throwaway database the server is using, or they fail on a missing
 * variable and the guarantee goes untested.
 *
 * Set before any service import is evaluated.
 */
process.env.DATABASE_URL ??= DATABASE_URL;
process.env.DIRECT_URL ??= DATABASE_URL;

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
    UPLOADS_DIR: TEST_UPLOADS_DIR,
    // No caching of the schema-state read: a test changes Prisma's ledger and
    // has to see the next /health reflect it. Production keeps the 30s default,
    // because the platform polls that endpoint.
    HEALTH_SCHEMA_TTL_MS: "0",
    // No outbound background work from the test server.
    //
    // The boot sequence enqueues a government sync, and the Federal Register
    // needs no key — so every server this harness starts began pulling real
    // executive orders into the test database, asynchronously, while other
    // files were asserting on row counts. One of those assertions is "a bill
    // nobody here has stored is left where it is", which fails the moment a
    // record arrives from anywhere at all.
    //
    // It went unnoticed while the counts happened to win the race, and surfaced
    // in CI as soon as another test file booted another server. A suite whose
    // result depends on a third-party API being up, and on which side of a
    // network round-trip an assertion lands, is not measuring the code.
    //
    // The boot still runs for real; only the outbound work is held back, and
    // the tests that cover it call it directly.
    CIVIC_NO_BACKGROUND_SYNC: "1",
    // No RESEND_API_KEY on purpose: the send path must throw rather than
    // silently succeed, and one of the tests asserts exactly that.
    //
    // No B2B_* either. The server does not read them any more — B2B accounts
    // are rows, written by seedB2BClients() below.
  };
}

/**
 * The two seeded accounts' database ids, available after startServer().
 *
 * They are cuids now rather than the fixture array's "b2b-1" and
 * "b2b-superadmin", so a test that needs to write a B2BSession row has to ask
 * rather than assume.
 */
export const b2bClientIds = { demo: "", admin: "" };

/**
 * Create the two B2B accounts, the same way scripts/seed-b2b.ts does.
 *
 * Deliberately the real code path — hashPassword for the password, a SHA-256
 * digest for the API key — rather than inserting a row the server would never
 * have written. A test that seeded its own hash format would pass while the
 * production seed script produced rows nobody could log in to.
 *
 * Runs once per startServer(), not per test. See resetData() for why these rows
 * are not truncated between tests.
 */
async function seedB2BClients(): Promise<void> {
  const accounts = [
    {
      key: "demo" as const,
      username: B2B_TEST.demoUsername,
      password: B2B_TEST.demoPassword,
      apiKey: B2B_TEST.demoApiKey,
      name: "Test Demo Analytics",
    },
    {
      key: "admin" as const,
      username: B2B_TEST.adminUsername,
      password: B2B_TEST.adminPassword,
      apiKey: B2B_TEST.adminApiKey,
      name: "Test Civic Platform Admin",
    },
  ];

  for (const account of accounts) {
    const data = {
      name: account.name,
      type: "research",
      tier: "enterprise",
      passwordHash: await hashPassword(account.password),
      apiKeyHash: createHash("sha256").update(account.apiKey).digest("hex"),
    };

    // Upsert, because a re-run finds last run's rows still there.
    const row = await prisma.b2BClient.upsert({
      where: { username: account.username },
      update: data,
      create: { username: account.username, ...data },
    });

    b2bClientIds[account.key] = row.id;
  }
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

  await seedB2BClients();

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

  // Disconnect the OTHER client too.
  //
  // A test that imports a service directly — the notification helper, the
  // lineage matchmaker — pulls in src/prisma, which builds its own client from
  // the environment and holds an open pool. Left connected, it keeps the
  // process from going idle after the suite is done.
  const appPrisma = (await import("../../src/prisma")).prisma;
  await appPrisma.$disconnect();
  if (server) {
    // SIGKILL, not the default SIGTERM.
    //
    // The server installs no signal handler, and a Bun.serve() loop does not
    // stop for SIGTERM on its own, so `await server.exited` hung until bun's
    // 5-second hook timeout fired and force-killed it. That showed up on every
    // run as an unnamed failing test with no assertions and no test body —
    // "a beforeEach/afterEach hook timed out" — which looked like a flake and
    // was in fact this teardown, every time.
    //
    // Waiting for it to actually exit still matters: kill() only sends the
    // signal, and returning early leaves the port held for the next run.
    server.kill("SIGKILL");
    await server.exited;
    server = null;
  }
}

/** Wipe rows between tests without touching the schema. */
export async function resetData(): Promise<void> {
  // Order matters only where cascades do not cover it; truncating together with
  // CASCADE keeps this from becoming a dependency puzzle every time a model is
  // added.
  //
  // B2BClient is deliberately NOT in this list. It holds the two accounts, not
  // test data — truncating it would delete the credentials every test logs in
  // with, so every test would have to pay for two scrypt hashes to put them
  // back. Nothing here creates a B2BClient row, and seedB2BClients() upserts,
  // so a re-run does not collide on the unique username the way B2BSession
  // once collided on its primary key.
  //
  // The one thing tests do change is lastAccessAt, written on each login. No
  // test reads it, and it is overwritten rather than accumulated.
  // RETRIED, BECAUSE THE SERVER IS STILL WORKING.
  //
  // Several writes are deliberately fire-and-forget — a notification, a
  // hashtag, a record of the position somebody just took — so a request can
  // return while its side effects are still in flight. TRUNCATE wants a lock
  // nobody else holds, and one of those writes holding a row lock is a
  // deadlock: Postgres kills one of the two, and the loser is whichever this
  // test happened to be.
  //
  // Not a product bug. In production nothing truncates. It is a consequence of
  // resetting a live server's database between tests, and the fix belongs here.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE
          "Session", "Account", "Verification",
          "GovernmentReferenceVote", "ReferenceMergeCandidate", "ReferenceName", "GovernmentReference",
          "Message", "ConversationParticipant", "Conversation",
          "AdminSession", "B2BSession", "AdminActivityLog", "Announcement",
          "User"
        RESTART IDENTITY CASCADE
      `);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      // 40P01 deadlock, 40001 serialization failure, P2010 raw-query wrapper.
      const contended =
        code === "P2010" || code === "40P01" || code === "40001" || String(error).includes("deadlock");
      if (!contended || attempt === 4) throw error;
      await Bun.sleep(100 * (attempt + 1));
    }
  }
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

/**
 * Create an account and sign in.
 *
 * VERIFIED BY DEFAULT. Constitution Article I, Section 3 gates every write to
 * the public record on a verified account, and almost every test in this suite
 * is about what happens AFTER somebody has finished signing up. Leaving them
 * unverified would make four hundred tests assert the same 403 instead of the
 * thing they were written for.
 *
 * Pass `verified: false` to get an account that has not entered its code —
 * that is how the gate itself is tested, and there is a test that fails if
 * this default silently stops applying.
 */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  verified?: boolean;
}): Promise<{ cookie: string; userId: string }> {
  signUpCount += 1;
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      name: input.name,
    }),
  });

  if (!response.ok) {
    throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("sign-up returned no session cookie");

  const body = (await response.json()) as { user?: { id: string } };
  const userId = body.user?.id;
  if (!userId) throw new Error("sign-up returned no user id");

  // Straight into the row rather than through the OTP endpoint: the code is
  // emailed, and no test should depend on an email provider being reachable.
  if (input.verified !== false) {
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  }

  return { cookie: setCookie.split(";")[0]!, userId };
}
