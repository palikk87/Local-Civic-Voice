import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { corsOriginPatterns } from "./env";
import { auth } from "./auth";
import { governmentRouter } from "./routes/government";
import { usersRouter } from "./routes/users";
import { timelineRouter } from "./routes/timeline";
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
import { representativesRouter } from "./routes/representatives";
import { delegationsRouter } from "./routes/delegations";
import { aiRouter } from "./routes/ai";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { basename, dirname } from "node:path";
import { storageDriver, UPLOADS_DIR, checkStorage } from "./services/storage";

// Import rate limiters
import {
  generalRateLimit,
  authRateLimit,
  feedRateLimit,
  interactionRateLimit,
  rateLimiter,
} from "./middleware/rate-limit";

// Import job queue and processors
import { jobQueue, enqueueGovernmentSync } from "./services/job-queue";
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
app.get("/health", (c) => {
  const cacheStats = getCacheStats();
  const queueStats = jobQueue.getStats();

  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    // Surfaced because an unsent one-time code is otherwise invisible: sign-in
    // and password reset both fail at the moment a user needs them, not at boot.
    email: { configured: isEmailConfigured() },
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
app.route("/api/timeline", timelineRouter);
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

// Serve user uploads — only when storage is local disk.
//
// With MEDIA_STORAGE=s3 the bucket serves the bytes directly and this mount is
// dead weight, so it is not registered at all. Keeping it registered would be
// worse than useless: it would answer /uploads/* with 404s from an empty
// directory instead of letting the absence be obvious.
if (storageDriver === "local") {
  const uploadsRoot = dirname(UPLOADS_DIR);
  const uploadsLeaf = basename(UPLOADS_DIR);

  app.use(
    "/uploads/*",
    serveStatic({
      root: uploadsRoot,
      rewriteRequestPath: (path) => path.replace(/^\/uploads/, `/${uploadsLeaf}`),
    })
  );
}

const port = Number(process.env.PORT) || 3000;

// Initialize job processors and start the queue
initializeProcessors();
jobQueue.start();
console.log(`[Server] Job queue started`);

// Government data refresh protocol: pull fresh bills, executive orders, and
// SCOTUS cases at boot, then once every 24 hours. The sync itself skips if it
// ran successfully within the last 6 hours, so restarts don't hammer the APIs.
const GOVERNMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
enqueueGovernmentSync("startup");
setInterval(() => enqueueGovernmentSync("daily"), GOVERNMENT_SYNC_INTERVAL_MS);

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
};
