import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env";
import { corsOriginPatterns } from "./env";
import { auth } from "./auth";
import { prisma } from "./prisma";
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
import { bugReportsRouter } from "./routes/bug-reports";
import { auditsRouter } from "./routes/audits";
import { impeachmentsRouter } from "./routes/impeachments";
import { systemResetRouter } from "./routes/system-reset";
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
import { emailConfiguration, isEmailConfigured } from "./services/email";
import { keySummary, keyWarnings } from "./services/key-report";
import {
  loadPlatformSecretsIntoEnv,
  startPlatformSecretRefresh,
} from "./services/platform-secrets";
import { fillBillProvenance } from "./services/bill-provenance";
import { runContentSelfHeal } from "./services/content-self-heal";
import { ensureBuiltInRoles } from "./services/admin-permissions";
import { runExecutiveOrderArchiveSweep } from "./services/executive-order-archive";
import { FIRST_RUN, schedule } from "./services/scheduled-work";
import { startImpeachmentSweep } from "./services/impeachment";
import { startSystemResetSweep } from "./services/system-reset";
import { syncRollCalls } from "./services/roll-call-sync";
import { adjudicatePending } from "./services/reference-lineage";

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

  // A BAN HAS TO ACTUALLY STOP SOMEBODY.
  //
  // Banning wrote five columns — banned, banReason, bannedAt, bannedBy,
  // banExpiresAt — and NOTHING outside the admin console ever read one of
  // them. The console said "User Citizen 0500 has been banned", the row said
  // banned = true, and the account went on signing in and voting. Found by
  // running the permission work against the thousand test citizens: a banned
  // account cast a vote and the tally moved from 1 to 2.
  //
  // That is the worst version of this bug the platform could have. The Public
  // Pulse is the one number AYE & NAY exists to report, and it was countable
  // by accounts the platform had already thrown out. The moderator pressing
  // Ban was told it worked.
  //
  // CHECKED ON EVERY REQUEST, not at sign-in. Banning somebody who is already
  // signed in has to end what they can do now — a check only at the door
  // leaves every open session untouched until it expires, which for a session
  // that lasts a week means a week.
  //
  // The definition of an ACTIVE ban is the one the console's own list filter
  // uses: banned, and either no expiry or an expiry still in the future. A
  // lapsed temporary ban is not a ban.
  const account = await prisma.user
    .findUnique({
      where: { id: session.user.id },
      select: { banned: true, banExpiresAt: true, banReason: true },
    })
    .catch(() => null);

  if (account?.banned && (!account.banExpiresAt || account.banExpiresAt > new Date())) {
    // The auth routes stay open so a banned person can still sign out, and so
    // the sign-in attempt itself is answered by Better Auth rather than here.
    if (!c.req.path.startsWith("/api/auth/")) {
      return c.json(
        {
          error: "This account is suspended.",
          reason: account.banReason ?? undefined,
          until: account.banExpiresAt?.toISOString(),
        },
        403,
      );
    }
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
app.route("/api/bug-reports", bugReportsRouter);
app.route("/api/impeachments", impeachmentsRouter);
app.route("/api/audits", auditsRouter);
app.route("/api/system-reset", systemResetRouter);

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

// The built-in roles, if this database has never had them.
//
// Only ever creates. A deployment that has decided its moderators may post
// announcements must not have that quietly taken back by a redeploy — a boot
// that silently rewrites authorization is the exact kind of surprise this
// codebase has a rule against. See services/admin-permissions.ts.
void ensureBuiltInRoles().catch((error) => {
  console.error("[Roles] could not ensure the built-in roles:", error);
});

// Government data refresh protocol: pull fresh bills, executive orders, and
// SCOTUS cases at boot, then once every 24 hours. The sync itself skips if it
// ran successfully within the last 6 hours, so restarts don't hammer the APIs.
const GOVERNMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  // The one job that was already correct — it enqueued at boot as well as on
  // its interval. Moved onto the same helper anyway, so that "no bare
  // setInterval" is a rule a test can enforce rather than a habit. The sync
  // itself skips when it ran successfully within the last six hours, so the
  // thirty-second stagger costs nothing and restarts do not hammer the APIs.
  schedule({
    name: "GovSync",
    firstRunAfterMs: FIRST_RUN.governmentSync,
    everyMs: GOVERNMENT_SYNC_INTERVAL_MS,
    run: async () => enqueueGovernmentSync("scheduled"),
  });
}

// Lineage: ask congress.gov which stored records are really the same law, so
// two filings of one bill stop splitting the vote count.
//
// "Daily, and not at boot" was the rule, for a good reason — the sweep is one
// request per record against the same key search uses, and a restart loop
// would spend the hourly budget on nothing. But a first run twenty-four hours
// out is a first run this container never reaches, so the sweep was not
// running daily. It was not running. The stagger keeps the restart-loop
// protection and drops the part that made the schedule fictional.
const LINEAGE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  schedule({
    name: "Lineage",
    firstRunAfterMs: FIRST_RUN.lineage,
    everyMs: LINEAGE_SYNC_INTERVAL_MS,
    run: async () => enqueueLineageSync("daily"),
  });
}

// Roll calls: how each chamber actually voted, from senate.gov and
// clerk.house.gov. Both publish plain XML with no key and no quota.
//
// THIS IS WHY THE GAP WAS INVISIBLE. The ingest existed and had tests, but it
// lived only in scripts/sync-roll-calls.ts, so it ran when somebody typed the
// command — which nobody ever did. `officialVotes` stayed empty on every
// record, every gap panel on both clients checks that field before rendering,
// and the platform's whole premise silently rendered nothing. An ingest with no
// schedule is an ingest that does not exist.
//
// Twice a day. The chambers vote on a sitting day and publish within hours, and
// a run costs a few hundred spaced requests against a courtesy that would be
// easy to abuse.
const ROLL_CALL_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  // WAS "not at boot", and that had a real concern behind it — a restart loop
  // must not spend the courtesy budget on nothing. But twelve hours is longer
  // than this container usually lives: it restarts on every deploy, so the
  // first run was never reached and this ingest was, again, not running. The
  // stagger answers the original concern without recreating the original bug —
  // a crash-looping container never survives five minutes.
  schedule({
    name: "RollCall",
    firstRunAfterMs: FIRST_RUN.rollCall,
    everyMs: ROLL_CALL_SYNC_INTERVAL_MS,
    run: syncRollCalls,
  });
}

/**
 * The whole executive-order archive, filling itself in behind everything else.
 *
 * The Federal Register publishes about 1,556 executive orders going back to
 * 1994 and this platform held 62. The nightly forward sync takes at most 50 new
 * ones and starts at the newest, which is right for catching up on a few days
 * and the wrong shape entirely for fetching the other 1,494.
 *
 * Every half hour, a hundred more, working backwards from the oldest order
 * held — so the corpus is complete in under a day and then this costs one cheap
 * request per sweep forever, which is what catches anything the Federal
 * Register adds retroactively.
 *
 * See services/executive-order-archive.ts for why it resumes from the data
 * rather than from a bookmark.
 */
const EO_ARCHIVE_INTERVAL_MS = 30 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  schedule({
    name: "EOArchive",
    firstRunAfterMs: FIRST_RUN.executiveOrderArchive,
    everyMs: EO_ARCHIVE_INTERVAL_MS,
    run: runExecutiveOrderArchiveSweep,
  });
}

/**
 * Records holding a lie clean themselves up.
 *
 * WHY THIS RUNS RATHER THAN WAITING TO BE RUN. The Federal Register's
 * anti-scraping page was stored as the text of an executive order, hashed as
 * that law's fingerprint, and summarised into a Citizen's Brief published under
 * Support and Oppose buttons. The guard stopped new ones arriving and the admin
 * console got a button to clear the old ones — but a button means the defect
 * sits there until somebody notices, finds the tab and presses it, and the
 * person who noticed was the one reading the app on his phone. Making the
 * reader the janitor is not a fix.
 *
 * AT BOOT, after a pause. The pause is not cosmetic: the job queue has to be
 * accepting work, and a container in a restart loop must not spend the
 * government's courtesy budget on the same sweep every ninety seconds.
 *
 * See services/content-self-heal.ts for what it will and will not touch.
 */
const SELF_HEAL_INTERVAL_MS = 6 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  schedule({
    name: "SelfHeal",
    firstRunAfterMs: FIRST_RUN.selfHeal,
    everyMs: SELF_HEAL_INTERVAL_MS,
    run: () => runContentSelfHeal("sweep"),
  });
}

/**
 * Dates and sponsors, filled in behind the sync.
 *
 * The bill list endpoint carries latestAction and nothing else about
 * provenance, so introducedDate and the sponsor need one detail call each. That
 * is too many calls to make while a sync is running and far too many to make
 * while a reader waits, so this converges quietly instead — a small batch every
 * few hours, oldest gaps first.
 *
 * Until a record is reached, its date and sponsor are null and the clients
 * render nothing. That is the point: the columns exist so that "we do not know"
 * has somewhere to live. Before them, the client filled the gap with
 * `ref.createdAt` and a chamber's name, and a 2007 law read as introduced
 * today, sponsored by the House of Representatives.
 */
const PROVENANCE_INTERVAL_MS = 4 * 60 * 60 * 1000;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  // THIS IS THE ONE WITH RECEIPTS. Four hours between runs on a container that
  // restarts several times a day meant the first run was never reached, so
  // this never ran once — and 205 of 255 stored bills still have no sponsor
  // and no introduced date, weeks after it shipped with tests.
  schedule({
    name: "Provenance",
    firstRunAfterMs: FIRST_RUN.provenance,
    everyMs: PROVENANCE_INTERVAL_MS,
    run: () => fillBillProvenance(25),
  });
}

// Duplicate laws: two filings of one bill split the vote count in half, and
// every citizen looking at either one sees a Pulse that is missing the other
// half. The adjudicator merges only on evidence — identical stored text, or a
// congress.gov "Identical bill" relationship an analyst confirmed — and every
// merge it makes is reversible from the admin console's journal.
//
// Same reason as above: this existed, was tested, and had never run.
const MERGE_ADJUDICATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MERGE_ADJUDICATION_BATCH = 25;
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  schedule({
    name: "Merge",
    firstRunAfterMs: FIRST_RUN.merge,
    everyMs: MERGE_ADJUDICATION_INTERVAL_MS,
    run: async () => {
      const sweep = await adjudicatePending(MERGE_ADJUDICATION_BATCH, { allowAI: true });
      if (sweep.considered > 0) {
        console.log(
          `[Merge] considered ${sweep.considered}: ${sweep.merged} merged, ` +
            `${sweep.rejected} ruled different, ${sweep.leftPending} left for a person.`
        );
      }
    },
  });
}

// ARTICLE V. Close impeachment proceedings whose week has run out.
//
// Local only — no external call, no courtesy budget. It exists because a
// proceeding that reaches two thirds closes itself on the vote that got it
// there, so the only ones left open are the ones that did NOT pass, and while
// one sits open nobody can bring another against the same person. A sweep that
// never runs turns "one proceeding at a time" into "one proceeding, ever".
if (!process.env.CIVIC_NO_BACKGROUND_SYNC) {
  startImpeachmentSweep();
  startSystemResetSweep();
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
// Keys stored in the platform's own database, decrypted into this process's
// environment before anything reports on them.
//
// WHY BEFORE THE REPORT. A key held in the database and announced as missing at
// boot is the same lie this project already paid for three times, only now with
// two places to look instead of one. Both blocks below wait for the load, so
// the boot log describes the keys this server is actually holding.
//
// It never rejects: an unreachable database or an absent SECRETS_ENCRYPTION_KEY
// leaves the server reading its keys from the environment, which is exactly how
// it behaved before any of this existed.
void loadPlatformSecretsIntoEnv().then((secrets) => {
  if (secrets.loaded.length > 0) {
    console.log(
      `[Keys] ${secrets.loaded.length} key(s) loaded from the database: ${secrets.loaded.join(", ")}`,
    );
  }
  for (const failure of secrets.failed) {
    // Naming the key and the reason, because "the stored key does not work" is
    // otherwise indistinguishable from "there is no stored key".
    if (failure.name === "*") continue; // no table yet, or the database is down
    console.error(
      `[Keys] ⚠️  ${failure.name} is stored but could not be decrypted: ${failure.reason}. ` +
        "The host's own variable, if any, is being used instead.",
    );
  }

  // Other containers serving this API only find out about a change by asking.
  startPlatformSecretRefresh();

  // One line naming every key this process actually holds, and one line per
  // thing that will not work. Printed at boot because the alternative — which
  // this project lived through with three separate keys — is somebody being sure
  // a key is set while the feature it powers fails silently, and no way to tell
  // which of the two is wrong without reading source code.
  console.log(`[Keys] ${keySummary()}`);
  for (const warning of keyWarnings()) {
    console.warn(`[Keys] ⚠️  ${warning}`);
  }

  const mail = emailConfiguration();
  if (!mail.configured) {
    console.warn(
      "[Email] ⚠️  RESEND_API_KEY is not set. Verification codes, sign-in codes and " +
        "password resets cannot be delivered, so nobody who signs up from here can " +
        "finish signing up. Reading still works."
    );
  } else {
    // Says the key is present AND names the thing that fails next. "No email
    // arrives" is far more often an unverified sending domain than a missing
    // key, and the two are indistinguishable from the provider's response —
    // which is how a deployment with a perfectly good key spends a week being
    // debugged as if it had none.
    console.log(
      `[Email] key present (fingerprint ${mail.keyFingerprint}), sending from ${mail.from}`
    );
    if (!mail.keyLooksLikeResend) {
      console.warn(
        '[Email] ⚠️  RESEND_API_KEY does not start with "re_". Resend keys do — this is ' +
          "usually another service's key in the right box."
      );
    }
    if (!mail.fromIsProviderTestSender) {
      console.warn(
        `[Email] ⚠️  Nothing will send unless ${mail.fromDomain ?? "that domain"} is a ` +
          "verified domain in this Resend account. Check with: POST /api/admin/email-health/test"
      );
    }
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
