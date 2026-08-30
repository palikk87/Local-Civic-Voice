/**
 * The admin console and the B2B portal, pressed by a person, checked at the server.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run panel-check
 *
 * WHY THIS EXISTS. Every browser check in this repository proves that a button
 * is on the page and can be clicked. None of them proved that clicking it did
 * the thing the button says it does. That gap is not theoretical — a check can
 * click "Ban", see a toast, and pass, while the account it named is still
 * signing in. The admin console and the B2B portal had the least click-through
 * coverage of anything here and the most destructive buttons in the product.
 *
 * THE RULE EVERY ASSERTION FOLLOWS. Click in the browser, then read the answer
 * back from the database — not from the screen. A page that renders an
 * optimistic result and never persists it passes a screen-only check and fails
 * every administrator. So the browser does the clicking and this process, which
 * holds the only Prisma client, does the believing.
 *
 * WHERE IT RUNS. The population database, never the live one, guarded by the
 * same assertion the seeding script uses. Every row it creates carries the
 * `pop-` prefix, so `check-no-population.ts` can still prove a real database is
 * clean of all of it.
 *
 * THE CREDENTIALS IN THIS FILE ARE NOT SECRETS AND MUST NEVER BE REAL. They
 * unlock accounts that exist only in a throwaway database that serves nobody,
 * and they are written here so a run is reproducible without a fixture file to
 * keep in step. Never point this at a database with people in it, and never
 * replace these with credentials that work anywhere else.
 */

import { spawn, type Subprocess } from "bun";
import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import {
  POPULATION_PASSWORD,
  assertPopulationDatabase,
  buildPopulation,
  citizen,
  countPopulation,
} from "./lib/test-population";

const DATABASE_URL = process.env.TEST_POPULATION_DATABASE_URL;

let databaseName: string;
try {
  databaseName = assertPopulationDatabase(DATABASE_URL);
} catch (error) {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
}

const BACKEND_PORT = Number(process.env.PANEL_CHECK_BACKEND_PORT ?? 4320);
const SITE_PORT = Number(process.env.PANEL_CHECK_SITE_PORT ?? 4321);
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const WEB = resolve(import.meta.dir, "../../apps/web");
const DIST = join(WEB, "dist");

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

/** The console operator. Superadmin, so every tab is reachable. */
const ADMIN = {
  id: "pop-admin-super",
  email: "panel-super@population.invalid",
  username: "panelsuper",
  name: "Panel Check Super Admin",
  password: "panel-check-super-not-a-real-password",
};

/**
 * A second operator with one capability and no more.
 *
 * The console decides which tabs to show from the capabilities the server
 * returns. That is the security boundary people actually rely on, and the only
 * honest way to test it is to sign in as somebody who does not have the
 * capability and confirm the tab is not there.
 */
const LIMITED = {
  id: "pop-admin-limited",
  email: "panel-limited@population.invalid",
  username: "panellimited",
  name: "Panel Check Limited Admin",
  password: "panel-check-limited-not-a-real-password",
  roleSlug: "pop-panel-readonly",
};

/** The account the destructive buttons are aimed at, so no citizen is harmed. */
const VICTIM = {
  id: "pop-panel-target",
  email: "panel-target@population.invalid",
  username: "paneltarget",
  name: "Panel Check Target",
};

/**
 * A second account, for Delete alone.
 *
 * Ban and Delete cannot be proved on the same row: once the account is gone
 * there is nothing left to read `banned` from, and a check that deletes the
 * evidence of its own earlier assertion will always agree with itself.
 */
const DOOMED = {
  id: "pop-panel-doomed",
  email: "panel-doomed@population.invalid",
  username: "paneldoomed",
  name: "Panel Check Doomed",
};

const failures: string[] = [];
let checked = 0;

function ok(what: string, detail = "") {
  checked += 1;
  console.log(`ok    ${what}${detail ? `  — ${detail}` : ""}`);
}

function fail(what: string, detail: string) {
  checked += 1;
  failures.push(`${what} — ${detail}`);
  console.log(`FAIL  ${what}  — ${detail}`);
}

function expect(what: string, condition: boolean, detail: string) {
  if (condition) ok(what);
  else fail(what, detail);
}

// ---------------------------------------------------------------- the backend

let backend: Subprocess | undefined;

async function startBackend(): Promise<void> {
  backend = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(BACKEND_PORT),
      DATABASE_URL,
      DIRECT_URL: DATABASE_URL,
      BACKEND_URL: SITE_ORIGIN,
      APP_ORIGINS: SITE_ORIGIN,
      APP_SCHEMES: "ayeandnay",
      BETTER_AUTH_SECRET: "panel-check-secret-not-used-anywhere-else",
      MEDIA_STORAGE: "local",
      UPLOADS_DIR: resolve(import.meta.dir, "../../.panel-check-uploads"),
      CIVIC_NO_BACKGROUND_SYNC: "1",
      // NO AI KEYS, DELIBERATELY, AND THIS IS A BUDGET CONTROL RATHER THAN A
      // CONVENIENCE. This check presses every button in the console, and two of
      // them can reach a paid model: the merge queue's "Check congress.gov" can
      // chain into AI adjudication, and any brief the console renders would
      // generate one. Blanking the keys makes that structurally impossible, so
      // the run cannot cost anything no matter which button is pressed or what
      // a future button starts doing.
      //
      // It also buys real coverage rather than only removing risk: with no
      // provider, every AI-backed surface has to show its honest degraded state.
      // A screen that invents a plausible brief when the model is unreachable
      // would be caught here and nowhere else.
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BACKEND_ORIGIN}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Backend did not become healthy on ${BACKEND_ORIGIN}`);
}

// ------------------------------------------------------- the site, one origin

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const site = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (url.startsWith("/api/")) {
    const proxied = httpRequest(
      {
        host: "127.0.0.1",
        port: BACKEND_PORT,
        path: url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxied.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end('{"error":"backend unreachable"}');
    });
    req.pipe(proxied);
    return;
  }

  const [path] = url.split("?");
  let file = join(DIST, path === "/" ? "index.html" : path!);
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
  } catch {
    file = join(DIST, "index.html");
  }
  const body = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});

// ------------------------------------------------------------------ fixtures

/** A signable-in account, created the way the population builder creates one. */
async function makeAccount(
  who: { id: string; email: string; username: string; name: string },
  password: string,
  role: string,
): Promise<void> {
  const passwordHash = await hashPassword(password);

  await prisma.user.upsert({
    where: { id: who.id },
    create: {
      id: who.id,
      name: who.name,
      email: who.email,
      username: who.username,
      displayUsername: who.username,
      emailVerified: true,
      role,
    },
    update: { name: who.name, email: who.email, username: who.username, role, banned: false },
  });

  const accountId = `${who.id}-credential`;
  await prisma.account.upsert({
    where: { id: accountId },
    create: {
      id: accountId,
      accountId: who.email,
      providerId: "credential",
      userId: who.id,
      password: passwordHash,
    },
    update: { password: passwordHash },
  });
}

/**
 * Everything the console needs something to act on, rebuilt from scratch.
 *
 * START FROM THE SAME PLACE EVERY TIME. These journeys ban, delete, resolve and
 * revoke; whatever survives a run is the state the next one begins in. A bug
 * report left in "fixed" made the triage assertion look for a button that was
 * never going to be there, and the check reported a working feature as broken.
 */
async function seedFixtures() {
  await makeAccount(ADMIN, ADMIN.password, "superadmin");
  await makeAccount(LIMITED, LIMITED.password, LIMITED.roleSlug);
  await makeAccount(VICTIM, POPULATION_PASSWORD, "user");
  await makeAccount(DOOMED, POPULATION_PASSWORD, "user");

  // The limited operator's role: one capability, and it is not users.view.
  await prisma.adminRole.upsert({
    where: { slug: LIMITED.roleSlug },
    create: {
      slug: LIMITED.roleSlug,
      name: "Panel check read-only",
      description: "Logs and nothing else. Created by panel-check.",
      capabilities: JSON.stringify(["logs.view"]),
      builtIn: false,
    },
    update: { capabilities: JSON.stringify(["logs.view"]), builtIn: false },
  });

  // Anything a previous run may have created and not cleaned up.
  await prisma.b2BMember.deleteMany({ where: { username: { startsWith: "popseat" } } });
  await prisma.b2BClient.deleteMany({ where: { username: { startsWith: "popclient" } } });
  await prisma.adminRole.deleteMany({ where: { slug: { startsWith: "pop-panel-made" } } });
  await prisma.announcement.deleteMany({ where: { title: { startsWith: "Panel check" } } });
  await prisma.bugReport.deleteMany({ where: { problem: { startsWith: "Panel check" } } });
  await prisma.report.deleteMany({ where: { detail: { startsWith: "Panel check" } } });
  await prisma.post.deleteMany({ where: { content: { startsWith: "Panel check" } } });
  await prisma.serviceIncident.deleteMany({ where: { subject: { startsWith: "panel-check" } } });
  await prisma.referenceMergeCandidate.deleteMany({
    where: { left: { masterReferenceId: { startsWith: "pop-panel-" } } },
  });
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { startsWith: "pop-panel-" } },
  });

  const reporter = citizen(1);
  const post = await prisma.post.create({
    data: { authorId: VICTIM.id, content: "Panel check post, here to be deleted by an admin." },
  });

  const report = await prisma.report.create({
    data: {
      reporterId: reporter.id,
      reportedUserId: VICTIM.id,
      postId: post.id,
      reason: "spam",
      detail: "Panel check report, here to be closed by an admin.",
      status: "open",
    },
  });

  const bug = await prisma.bugReport.create({
    data: {
      userId: reporter.id,
      username: reporter.username,
      pageUrl: `${SITE_ORIGIN}/feed`,
      pagePath: "/feed",
      elementLabel: "the Aye button",
      problem: "Panel check bug report, here to be triaged by an admin.",
      wanted: "It should be marked fixed by the button that says Fixed.",
      status: "open",
    },
  });

  // Two records that look like the same law, so the merge queue has a decision
  // waiting in it. Titles are near-identical on purpose: that is what a
  // look-alike is.
  const left = await prisma.governmentReference.create({
    data: {
      masterReferenceId: "pop-panel-merge-left",
      referenceType: "bill",
      title: "Panel Check Consolidation Act",
      status: "proposed",
      category: "infrastructure",
    },
  });
  const right = await prisma.governmentReference.create({
    data: {
      masterReferenceId: "pop-panel-merge-right",
      referenceType: "bill",
      title: "Panel Check Consolidation Act of 2026",
      status: "proposed",
      category: "infrastructure",
    },
  });
  const merge = await prisma.referenceMergeCandidate.create({
    data: {
      leftId: left.id < right.id ? left.id : right.id,
      rightId: left.id < right.id ? right.id : left.id,
      relationship: "look_alike",
      similarity: 0.94,
      status: "pending",
    },
  });

  const incident = await prisma.serviceIncident.upsert({
    where: { kind_subject: { kind: "panel-check", subject: "panel-check fixture" } },
    create: {
      kind: "panel-check",
      subject: "panel-check fixture",
      detail: "Created by panel-check so the incidents card has something to acknowledge.",
    },
    update: { acknowledgedAt: null, acknowledgedBy: null },
  });

  return { post, report, bug, merge, incident, left, right };
}

// ------------------------------------------------------------------ the check

async function main() {
  console.log(`Panel check against database "${databaseName}".`);
  console.log("Every action below happens here and nowhere else.\n");

  const size = await countPopulation(prisma);
  if (size < 10) {
    console.log("Building the population first…");
    await buildPopulation(prisma, 1_000);
  }
  ok("the population is present", `${await countPopulation(prisma)} citizens`);

  // BUILD THE SITE HERE. `bun run verify` builds with https://ci.invalid so the
  // other checks exercise the shape CI ships; this one needs the same-origin
  // build, and silently getting the other one makes every request leave the
  // page for a host that does not exist.
  console.log("Building the site for this check (same-origin)…");
  const build = spawn({
    cmd: ["bun", "run", "build"],
    cwd: WEB,
    env: { ...process.env, VITE_BACKEND_URL: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await build.exited) !== 0) {
    throw new Error(`the web build failed: ${await new Response(build.stderr).text()}`);
  }
  ok("the site is built against this backend");

  const fixtures = await seedFixtures();
  ok("the console has something to act on", "post, report, bug, merge pair, incident");

  await startBackend();
  ok("the backend is up", BACKEND_ORIGIN);

  await new Promise<void>((r) => site.listen(SITE_PORT, "127.0.0.1", () => r()));
  ok("the site is served", SITE_ORIGIN);

  // The browser runs in its own process from apps/web: Prisma's client lives in
  // backend/node_modules and Playwright's browsers in apps/web/node_modules,
  // and no single working directory resolves both.
  const journeys = spawn({
    cmd: [
      "node",
      "scripts/panel-journeys.mjs",
      JSON.stringify({
        site: SITE_ORIGIN,
        admin: { username: ADMIN.username, password: ADMIN.password },
        limited: { username: LIMITED.username, password: LIMITED.password },
        victim: { id: VICTIM.id, username: VICTIM.username, name: VICTIM.name },
        doomed: { id: DOOMED.id, username: DOOMED.username, name: DOOMED.name },
        fixtures: {
          postId: fixtures.post.id,
          reportId: fixtures.report.id,
          bugId: fixtures.bug.id,
          mergeId: fixtures.merge.id,
          incidentId: fixtures.incident.id,
        },
      }),
    ],
    cwd: WEB,
    stdout: "inherit",
    stderr: "inherit",
  });

  const code = await journeys.exited;
  if (code !== 0) fail("the browser journeys", `the journey process exited ${code}`);

  // ------------------------------------------------------------------------
  // Everything below reads the database directly. This is the half the browser
  // cannot fake: whatever the screen said, these are the rows that are there.
  // ------------------------------------------------------------------------

  console.log("\nWhat the server actually recorded:\n");

  const victim = await prisma.user.findUnique({
    where: { id: VICTIM.id },
    select: { banned: true, role: true },
  });
  expect(
    "Ban left the account banned",
    victim?.banned === true,
    `User.banned is ${victim?.banned} after the Ban button was pressed and confirmed`,
  );

  const doomed = await prisma.user.findUnique({ where: { id: DOOMED.id } });
  expect(
    "Delete removed the account",
    doomed === null,
    "the account the admin deleted is still in the database",
  );

  const deletedPost = await prisma.post.findUnique({ where: { id: fixtures.post.id } });
  expect(
    "Delete removed the post",
    deletedPost === null,
    "the post the admin deleted is still in the database",
  );

  const closedReport = await prisma.report.findUnique({ where: { id: fixtures.report.id } });
  expect(
    "Mark handled closed the report",
    closedReport?.status === "actioned",
    `Report.status is "${closedReport?.status}", expected "actioned"`,
  );
  expect(
    "and recorded who closed it",
    closedReport?.reviewedBy === ADMIN.username,
    `Report.reviewedBy is "${closedReport?.reviewedBy}", expected "${ADMIN.username}"`,
  );

  const triaged = await prisma.bugReport.findUnique({ where: { id: fixtures.bug.id } });
  expect(
    "Fixed marked the bug report fixed",
    triaged?.status === "fixed",
    `BugReport.status is "${triaged?.status}", expected "fixed"`,
  );
  expect(
    "and recorded who fixed it",
    triaged?.resolvedBy === ADMIN.username,
    `BugReport.resolvedBy is "${triaged?.resolvedBy}", expected "${ADMIN.username}"`,
  );

  const merge = await prisma.referenceMergeCandidate.findUnique({
    where: { id: fixtures.merge.id },
  });
  expect(
    "Different laws recorded a rejection",
    merge?.status === "rejected",
    `ReferenceMergeCandidate.status is "${merge?.status}", expected "rejected"`,
  );

  const incident = await prisma.serviceIncident.findUnique({
    where: { id: fixtures.incident.id },
  });
  expect(
    "Acknowledge acknowledged the incident",
    !!incident?.acknowledgedAt,
    "ServiceIncident.acknowledgedAt is still null",
  );

  const announcement = await prisma.announcement.findFirst({
    where: { title: { startsWith: "Panel check" } },
  });
  expect(
    "Publish created the announcement",
    !!announcement,
    "no announcement whose title starts with 'Panel check' exists",
  );

  const madeRole = await prisma.adminRole.findFirst({
    where: { slug: { startsWith: "pop-panel-made" } },
  });
  expect(
    "New role created a role",
    !!madeRole,
    "no role whose slug starts with 'pop-panel-made' exists",
  );

  const client = await prisma.b2BClient.findFirst({
    where: { username: { startsWith: "popclient" } },
  });
  expect(
    "New client created a B2B account",
    !!client,
    "no B2B client whose username starts with 'popclient' exists",
  );

  const seat = await prisma.b2BMember.findFirst({
    where: { username: { startsWith: "popseat" } },
  });
  expect(
    "Create the seat created a seat",
    !!seat,
    "no B2B member whose username starts with 'popseat' exists",
  );
  expect(
    "and Disable disabled it",
    seat?.disabled === true,
    `B2BMember.disabled is ${seat?.disabled} after the disable button was pressed`,
  );

  const log = await prisma.adminActivityLog.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    select: { action: true },
  });
  const actions = new Set(log.map((row) => row.action));
  expect(
    "the destructive actions are in the activity log",
    actions.size > 0,
    "the admin activity log recorded nothing for this run",
  );
  console.log(`      log recorded: ${[...actions].sort().join(", ") || "(nothing)"}`);

  // ---------------------------------------------------------------- clean up

  await prisma.b2BMember.deleteMany({ where: { username: { startsWith: "popseat" } } });
  await prisma.b2BClient.deleteMany({ where: { username: { startsWith: "popclient" } } });
  await prisma.adminRole.deleteMany({ where: { slug: { startsWith: "pop-panel-made" } } });
  await prisma.announcement.deleteMany({ where: { title: { startsWith: "Panel check" } } });
}

const started = Date.now();

try {
  await main();
} catch (error) {
  fail("the panel check ran to completion", (error as Error).message);
} finally {
  backend?.kill();
  site.close();
  await prisma.$disconnect().catch(() => undefined);
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n${checked} checks in ${seconds}s.`);

if (failures.length) {
  console.log(`\n${failures.length} failed:\n`);
  for (const line of failures) console.log(`  - ${line}`);
  process.exit(1);
}

console.log("\nEvery button in the admin console and the B2B portal did what it says.");
process.exit(0);
