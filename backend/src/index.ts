import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { corsOriginPatterns } from "./env";
import { auth } from "./auth";
import { governmentRouter } from "./routes/government";
import { usersRouter } from "./routes/users";
import { messagesRouter } from "./routes/messages";
import { adminRouter } from "./routes/admin";
import { b2bRouter } from "./routes/b2b";
import { postsRouter } from "./routes/posts";
import { billsRouter } from "./routes/bills";
import { feedRouter } from "./routes/feed";
import { notificationsRouter } from "./routes/notifications";
import { mediaRouter } from "./routes/media";
import { governmentReferencesRouter } from "./routes/government-references";
import { loginRouter } from "./routes/login";
import { safetyRouter } from "./routes/safety";
import { onboardingRouter } from "./routes/onboarding";
import { representativesRouter } from "./routes/representatives";
import { delegationsRouter } from "./routes/delegations";
import { aiRouter } from "./routes/ai";
import { verificationRouter } from "./routes/verification";
import { logger } from "hono/logger";
import { join, resolve, sep } from "node:path";
import { storageDriver, UPLOADS_DIR, checkStorage } from "./services/storage";
import { schemaState } from "./services/schema-state";
import { officialSources, repairStoredExtractions } from "./services/reference-content";
import { releaseAbandonedWork } from "./services/brief-state";

// Import rate limiters
import {
  generalRateLimit,
  authRateLimit,
  feedRateLimit,
  interactionRateLimit,
  rateLimiter,
} from "./middleware/rate-limit";

// Import job queue and processors
import { jobQueue, enqueueGovernmentSync, enqueueLineageSync } from "./services/job-queue";
import { initializeProcessors } from "./services/job-processors";

// Import cache stats
import { getCacheStats } from "./services/cache";
import { isEmailConfigured } from "./services/email";

// Type the Hono app with user/session variables
const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>();

// CORS — same source as Better Auth's trustedOrigins (see env.ts).
//
// These were two separately-maintained lists, and CORS was the narrower of the
// two, so an origin Better Auth accepted could still be refused here. That
// combination fails a login without producing a useful error anywhere.
app.use(
  "*",
  cors({
    origin: (origin) =>
      origin && corsOriginPatterns.some((re) => re.test(origin)) ? origin : null,
    credentials: true,
  })
);

// Logging
app.use("*", logger());

// Apply general rate limiting to all routes as fallback
app.use("*", generalRateLimit);

// Auth middleware - populates user/session for all routes
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.set("user", null);
    c.set("session", null);
    await next();
    return;
  }
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
});

// Apply auth rate limiting to auth routes
app.use("/api/auth/*", authRateLimit);

// Mount auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health check endpoint with cache and queue stats
app.get("/health", async (c) => {
  const cacheStats = getCacheStats();
  const queueStats = jobQueue.getStats();
  const schema = await schemaState();

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    // WHICH COMMIT IS ACTUALLY RUNNING.
    //
    // The failure this exists for: a fix is written, reviewed, tested and
    // pushed, and it lands on a branch nothing deploys. The code is perfect and
    // the product is unchanged, and from outside those look identical — the
    // only way anybody found out was by using the feature and seeing the old
    // behaviour. A backend change nobody clicks could sit undeployed forever.
    //
    // Baked in at image build where the builder supplies it (Dockerfile
    // ARG GIT_SHA), and otherwise taken from whatever the host says it
    // deployed.
    //
    // THE SECOND HALF IS NOT A NICETY. Railway does not pass
    // RAILWAY_GIT_COMMIT_SHA as a build argument — it sets it as a runtime
    // variable on the service — so the build arg stayed at its default and
    // this endpoint reported "unknown" on every deploy. Which meant
    // deploy-check, the whole point of which is to tell a shipped fix from an
    // unshipped one, could never answer. The tool built to close that blind
    // spot was blind, on the only host it actually runs on, and nobody noticed
    // because "unknown" reads like a minor gap rather than a broken check.
    //
    // Build arg first, because it describes the code in THIS container and
    // cannot be faked. The host variables are a statement of intent rather
    // than of fact — but a platform saying which commit it deployed is far
    // better than nothing at all, and it needs no configuration to work.
    version: buildVersion(),
    // WHETHER THE DATABASE MATCHES THE CODE.
    //
    // The commit above says the right code is running. This says the right
    // schema is under it, which can be false while everything else looks
    // healthy — a partially applied migration, a rolled-back one, a database
    // pointed somewhere else. Nobody clicks a migration, so without this the
    // first symptom is a 500 from whichever endpoint touches the missing
    // column.
    schema: {
      applied: schema.applied,
      expected: schema.expected,
      latest: schema.latest,
      pending: schema.pending,
      failed: schema.failed,
      inSync: schema.reachable && schema.pending.length === 0 && schema.failed.length === 0,
    },
    // Surfaced because an unsent one-time code is otherwise invisible: sign-in
    // and password reset both fail at the moment a user needs them, not at boot.
    email: { configured: isEmailConfigured() },
    // Which official sources this deployment can actually read. A Citizen's
    // Brief is written from the law's own text and nothing else, so a missing
    // key here means every brief for that branch reports "no official text" —
    // which reads to a user as "this law has nothing published", and is not
    // what happened.
    sources: officialSources(),
    cache: {
      caches: cacheStats.caches.map((cache) => ({
        name: cache.name,
        size: cache.currentSize,
        maxSize: cache.maxSize,
        hitRate: (cache.hitRate * 100).toFixed(2) + "%",
        hits: cache.hits,
        misses: cache.misses,
        evictions: cache.evictions,
      })),
      totals: {
        totalEntries: cacheStats.totals.totalEntries,
        overallHitRate: (cacheStats.totals.overallHitRate * 100).toFixed(2) + "%",
      },
    },
    queue: {
      isActive: jobQueue.isActive(),
      queueSize: queueStats.queueSize,
      processingCount: queueStats.processingCount,
      processedCount: queueStats.processedCount,
      failedCount: queueStats.failedCount,
      deadLetterCount: queueStats.deadLetterCount,
      jobsByType: queueStats.jobsByType,
    },
    rateLimiter: {
      trackedKeys: rateLimiter.size,
    },
  });
});

// Get current user
app.get("/api/me", (c) => {
  const user = c.get("user");
  if (!user) return c.body(null, 401);
  return c.json({ user });
});

// Apply feed rate limiting to feed routes
app.use("/api/feed/*", feedRateLimit);

// Apply interaction rate limiting to POST routes on feed interactions
app.use("/api/feed/interaction*", async (c, next) => {
  if (c.req.method === "POST") {
    return interactionRateLimit(c, next);
  }
  await next();
});

// Routes
app.route("/api/government", governmentRouter);
app.route("/api/users", usersRouter);
app.route("/api/safety", safetyRouter);
app.route("/api/onboarding", onboardingRouter);
app.route("/api/messages", messagesRouter);
app.route("/api/admin", adminRouter);
app.route("/api/b2b", b2bRouter);
app.route("/api/posts", postsRouter);
app.route("/api/bills", billsRouter);
app.route("/api/feed", feedRouter);
app.route("/api/notifications", notificationsRouter);
app.route("/api/media", mediaRouter);
app.route("/api/government-references", governmentReferencesRouter);
app.route("/api/login", loginRouter);
app.route("/api/representatives", representativesRouter);
app.route("/api/delegations", delegationsRouter);
app.route("/api/ai", aiRouter);
app.route("/api/verification", verificationRouter);

// Serve user uploads — only when storage is local disk.
//
// With MEDIA_STORAGE=s3 the bucket serves the bytes directly and this mount is
// dead weight, so it is not registered at all. Keeping it registered would be
// worse than useless: it would answer /uploads/* with 404s from an empty
// directory instead of letting the absence be obvious.
if (storageDriver === "local") {
  // Served by hand rather than with hono/bun's serveStatic.
  //
  // serveStatic resolves `root` against process.cwd(), so it silently serves
  // NOTHING when UPLOADS_DIR is an absolute path — which is the value every
  // deployment guide tells you to use. Verified by running the server both ways
  // against the same file: a relative UPLOADS_DIR returned 200 and the bytes, an
  // absolute one returned 404, with no error in either case. Media simply
  // vanished, and the database still claimed it was there.
  //
  // Bun.file takes a real path, so this works for absolute and relative alike.
  const uploadsRoot = resolve(UPLOADS_DIR);

  app.get("/uploads/*", async (c) => {
    // The path as requested, minus the mount prefix. decodeURIComponent because
    // filenames arrive percent-encoded; it is also the step that turns "%2e%2e"
    // back into "..", which is exactly why the containment check below happens
    // AFTER decoding rather than before.
    const requested = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/uploads\/?/, ""));
    const target = resolve(join(uploadsRoot, requested));

    // Refuse anything that escapes the uploads directory. `resolve` collapses
    // "..", so a traversal attempt lands outside uploadsRoot and is rejected
    // here. The trailing separator matters: without it, "/uploads-secret" would
    // pass a naive startsWith("/uploads") check.
    if (target !== uploadsRoot && !target.startsWith(uploadsRoot + sep)) {
      return c.json({ error: "Not found" }, 404);
    }

    const file = Bun.file(target);
    if (!(await file.exists())) {
      return c.json({ error: "Not found" }, 404);
    }

    return new Response(file, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        // Keys are content-addressed random values that are never reused, so a
        // stored object at a given key never changes. Cache hard.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  });
}

/**
 * Which commit is this container running?
 *
 * FOUR SOURCES, MOST TRUSTWORTHY FIRST, and every one exists because the ones
 * above it are not always available:
 *
 *   1. GIT_SHA — a build argument. Authoritative: it describes the code in this
 *      image and nothing at runtime can change it. Set only when the builder
 *      passes one.
 *
 *   2. The host's own variable. Present only when the platform genuinely knows,
 *      which means a deploy it made from a repository it is connected to.
 *
 *   3. BUILD_COMMIT — a file written into the upload by .github/workflows/
 *      deploy.yml immediately before `railway up`. This is what actually
 *      answers on this project's deploys: the CLI uploads a tarball with no git
 *      metadata (.dockerignore drops .git, and it is not a git client), so
 *      nothing in the build can discover its own commit and the host variable
 *      above is never set.
 *
 *      Checked AFTER the host variable on purpose. The file is not gitignored —
 *      it cannot be, or the CLI would refuse to upload it — so a stale one
 *      could in principle be committed by hand. Anything that actually knows
 *      the commit should outrank a file that might be left over.
 *
 *   4. "unknown" — said out loud rather than guessed at.
 *
 * WHY ANY OF THIS MATTERS. /health reported "unknown" on every deploy for the
 * life of this project, which left `deploy-check` unable to answer the one
 * question it exists for. Five finished commits then sat unshipped for hours
 * while the product looked broken, and nothing could say "you are running old
 * code" — the tool built to catch that was blind, and the fix for its blindness
 * was itself in the unshipped pile.
 */
function buildVersion(): { commit: string; builtAt: string | null } {
  const stamped = process.env.GIT_SHA?.trim();
  if (stamped) return { commit: stamped, builtAt: process.env.BUILD_TIME || null };

  const fromHost =
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.SOURCE_COMMIT;
  if (fromHost) return { commit: fromHost, builtAt: process.env.BUILD_TIME || null };

  try {
    const [commit, builtAt] = readFileSync(new URL("../BUILD_COMMIT", import.meta.url), "utf8")
      .split("\n")
      .map((line: string) => line.trim());
    if (commit) return { commit, builtAt: builtAt || null };
  } catch {
    // No file: this image was not built by the deploy workflow.
  }

  return { commit: "unknown", builtAt: process.env.BUILD_TIME || null };
}

const port = Number(process.env.PORT) || 3000;

// Initialize job processors and start the queue
initializeProcessors();
jobQueue.start();
console.log(`[Server] Job queue started`);

// Release briefs whose work this process's predecessor was doing when it went
// away. The job queue is in memory, so a restart or a deploy loses everything
// in it — and the rows those jobs were working on kept saying "in progress"
// with nothing left to finish them. Anyone opening one watched a spinner that
// no reload could clear, because the stuck state was in the database.
//
// The process that replaces the one that died is the right place to notice.
void releaseAbandonedWork()
  .then((released) => {
    if (released > 0) {
      console.log(`[Server] released ${released} brief(s) left mid-flight by a previous process`);
    }
  })
  .catch((error) => console.error("[Server] could not release abandoned brief work:", error));

// One-time repair, on the deploy that carries the extraction fix.
//
// Records stored before it hold text the old shared extractor produced: an
// executive order with the Federal Register's cover page above it, a bill at
// the version introduced rather than the one that passed, a Supreme Court case
// with no text at all. Re-pulling them says nothing about the law having
// changed — nobody is notified, no post is badged — because fixing our own
// extraction is not the government amending anything.
//
// Ahead of the government sync on purpose: the sync would otherwise reach some
// of these records first, through a path that has no idea a repair is due.
//
// Held back under CIVIC_NO_BACKGROUND_SYNC, which the test harness sets: the
// repair queues jobs that reach three government APIs, and a suite that starts
// a server per file would otherwise pull real records into the test database
// while other files assert on row counts.
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  void repairStoredExtractions()
    .then((queued) => {
      if (queued > 0) {
        console.log(
          `[Server] re-extracting official text for ${queued} record(s) stored before the ` +
            `retrieval fix — briefs will be rewritten, no law is marked as changed`
        );
      }
    })
    .catch((error) => console.error("[Server] could not queue the extraction repair:", error));
}

// Government data refresh protocol: pull fresh bills, executive orders, and
// SCOTUS cases at boot, then once every 24 hours. The sync itself skips if it
// ran successfully within the last 6 hours, so restarts don't hammer the APIs.
const GOVERNMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  enqueueGovernmentSync("startup");
  setInterval(() => enqueueGovernmentSync("daily"), GOVERNMENT_SYNC_INTERVAL_MS);
}

// Lineage: ask congress.gov which stored records are really the same law, so
// two filings of one bill stop splitting the vote count. Daily, and not at
// boot — the sweep is one request per record against the same key search uses,
// and a restart loop would spend the hourly budget on nothing.
const LINEAGE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  setInterval(() => enqueueLineageSync("daily"), LINEAGE_SYNC_INTERVAL_MS);
}

// Accounts live in Postgres, external to this container, so they survive
// restarts without any backup/restore protocol here.
//
// Media is the one thing that does not: it is bytes, it cannot be regenerated
// from an upstream source, and a misconfigured bucket is invisible until
// somebody's upload disappears. So check it at boot and say so out loud.
void checkStorage().then(({ ok, driver, detail }) => {
  console.log(`[Storage] driver=${driver} — ${detail}`);
  if (!ok) {
    console.error("[Storage] ⚠️  Uploads will fail until this is fixed.");
  } else if (driver === "local" && process.env.NODE_ENV === "production") {
    console.warn(
      "[Storage] ⚠️  MEDIA_STORAGE is local in production. Unless UPLOADS_DIR is a " +
        "persistent volume, every uploaded file is lost on the next deploy while the " +
        "database rows keep pointing at it. Set MEDIA_STORAGE=s3."
    );
  }
});

// Same reasoning, for mail.
//
// Without a provider, sign-up creates the account, shows "check your email",
// and no email exists anywhere — and the constitution's verification gate then
// locks that person out of voting, delegating and posting with no way through.
// It was invisible for exactly as long as it took somebody to try signing up,
// because Better Auth's own send path answers success either way. Now it says
// so at boot, and /health carries the same fact for whatever polls it.
if (!isEmailConfigured()) {
  console.warn(
    "[Email] ⚠️  RESEND_API_KEY is not set. Verification codes, sign-in codes and " +
      "password resets cannot be delivered, so nobody who signs up from here can " +
      "finish signing up. Reading still works."
  );
}

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`[Server] Received ${signal}, starting graceful shutdown...`);

  // Stop the job queue and wait for current jobs to complete
  await jobQueue.stop();
  console.log(`[Server] Job queue stopped`);

  // Stop the rate limiter cleanup timer
  rateLimiter.stopCleanupTimer();
  console.log(`[Server] Rate limiter cleanup timer stopped`);

  console.log(`[Server] Graceful shutdown complete`);
  process.exit(0);
}

// Register shutdown handlers
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default {
  port,
  fetch: app.fetch,
  /**
   * How long one request may take before Bun closes the connection.
   *
   * BUN'S DEFAULT IS TEN SECONDS, and that silently broke the Citizen's Brief.
   * The brief endpoint does its work inline — the reader pressed a button and
   * is watching, so handing it to a queue and asking them to poll adds a
   * failure mode without adding speed — and it is allowed 45 seconds to read a
   * law and write from it.
   *
   * Bun was cutting the connection at 10. The server carried on, finished the
   * brief, stored it and logged "200 in 13s"; the reader's connection had been
   * dead for three seconds by then. From the client it looks like the server
   * hung up. From the log it looks like a success. Nothing reports an error,
   * because from the server's point of view nothing failed.
   *
   *   [Bun.serve]: request timed out after 10 seconds
   *   --> POST /api/government-references/:id/brief 200 13s
   *
   * Set above the longest request the API deliberately makes: 45s for a brief,
   * 20s for a judicial search that may wait out a CourtListener throttle. 120
   * leaves room for a slow model on a long law without letting a genuinely
   * stuck request hold a connection forever.
   */
  idleTimeout: 120,
};
