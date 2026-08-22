/**
 * Drive the real system, as the test citizens, in a real browser.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run system-check
 *
 * WHAT MAKES THIS DIFFERENT from the other browser checks. Those serve the
 * built site against a stub that answers every request from a fixture, which is
 * the right way to ask "does this page render". None of them touch a database,
 * so none of them can answer "does delegating actually move the number" — the
 * question that matters most here, and the one nothing was asking.
 *
 * This runs the whole stack: the real backend, a real Postgres, the real
 * built site, and a real browser clicking real buttons. The only thing that is
 * not real is who is doing the clicking.
 *
 * WHERE IT RUNS. The population database, never the live one. Same guard as the
 * seeding script, for the same reason — see backend/scripts/lib/test-population.ts.
 * The citizens vote, delegate and post in here, and none of it exists anywhere
 * the public can reach.
 *
 * WHY ONE ORIGIN. The site is served and the API is proxied from the same
 * server, so the session cookie behaves exactly as it does in production
 * behind Vercel's rewrite. Two origins would need CORS and SameSite exceptions
 * that production does not have, and a check that needs its own exceptions is
 * testing something nobody ships.
 */

import { spawn, type Subprocess } from "bun";
import { createServer, request as httpRequest } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
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

const BACKEND_PORT = Number(process.env.SYSTEM_CHECK_BACKEND_PORT ?? 4310);
const SITE_PORT = Number(process.env.SYSTEM_CHECK_SITE_PORT ?? 4311);
const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const WEB = resolve(import.meta.dir, "../../apps/web");
const DIST = join(WEB, "dist");

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

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
      APP_SCHEMES: "civicvoice",
      BETTER_AUTH_SECRET: "system-check-secret-not-used-anywhere-else",
      MEDIA_STORAGE: "local",
      UPLOADS_DIR: resolve(import.meta.dir, "../../.system-check-uploads"),
      // The boot sync reaches three government APIs. Content comes from
      // whatever is already stored; a check should not depend on a live
      // third party answering, and should not spend anybody's rate limit.
      CIVIC_NO_BACKGROUND_SYNC: "1",
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

// ------------------------------------------------------------------ the check

/**
 * Make a citizen eligible to receive delegations, the way the rules read:
 * old enough, enough votes, enough posts, active recently.
 *
 * Age is the one thing a check cannot earn honestly — it takes a fortnight — so
 * the creation date is moved back. Everything else is real rows of the real
 * kind the eligibility service counts.
 */
async function makeEligible(userId: string, seed: number): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
  });

  const posts = await prisma.post.count({ where: { authorId: userId } });
  for (let i = posts; i < 3; i += 1) {
    await prisma.post.create({
      data: { authorId: userId, content: `Something worth saying, number ${i + 1}.` },
    });
  }

  const votes = await prisma.governmentReferenceVote.count({ where: { userId } });
  for (let i = votes; i < 20; i += 1) {
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `sys-check-${seed}-${i}`,
        referenceType: "bill",
        title: `Track record ${i}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: row.id, userId, position: "support" },
    });
  }
}

/** The record the journeys act on. */
async function subject() {
  const existing = await prisma.governmentReference.findFirst({
    where: { masterReferenceId: { startsWith: "hr-" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  return prisma.governmentReference.create({
    data: {
      masterReferenceId: "hr-1-119",
      referenceType: "bill",
      title: "The record the system check votes on",
      status: "proposed",
      category: "healthcare",
    },
  });
}

async function main() {
  console.log(`System check against database "${databaseName}".`);
  console.log("Every action below happens here and nowhere else.\n");

  const size = await countPopulation(prisma);
  if (size < 10) {
    console.log("Building the population first…");
    await buildPopulation(prisma, 1_000);
  }
  ok("the population is present", `${await countPopulation(prisma)} citizens`);

  // BUILD THE SITE HERE, rather than using whatever is in dist.
  //
  // The bundle bakes its backend URL in at build time, and `bun run verify`
  // builds with https://ci.invalid on purpose so the other browser checks
  // exercise the shape CI ships. This check needs the same-origin build, and it
  // silently got the other one — every request left the page for a host that
  // does not exist, and the app reported it as "Failed to fetch" on the sign-in
  // form. A check that depends on who built last is a check that passes or
  // fails on the order somebody ran two commands in.
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

  await startBackend();
  ok("the backend is up", BACKEND_ORIGIN);

  await new Promise<void>((r) => site.listen(SITE_PORT, "127.0.0.1", () => r()));
  ok("the site is served", SITE_ORIGIN);

  const leader = citizen(1);
  const follower = citizen(2);
  await makeEligible(leader.id, Date.now());
  ok("citizen 1 has earned delegate eligibility");

  const bill = await subject();

  // START FROM THE SAME PLACE EVERY TIME.
  //
  // The journeys act on a database that is not reset between runs, so anything
  // they leave behind is state the next run starts in. A follow left over from
  // the previous run turned the profile's Follow button into Unfollow, and the
  // check reported a working feature as broken because it could not find a
  // button that was never going to be there.
  await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: bill.id } });
  await prisma.delegation.deleteMany({ where: { fromUserId: follower.id } });
  await prisma.follow.deleteMany({
    where: { OR: [{ followerId: follower.id }, { followerId: leader.id }] },
  });
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: follower.id }, { blockerId: leader.id }] },
  });
  await prisma.post.deleteMany({ where: { repostOfId: { not: null }, authorId: follower.id } });
  await prisma.governmentReference.update({
    where: { id: bill.id },
    data: { supportVotes: 0, opposeVotes: 0 },
  });

  // THE BROWSER RUNS IN ITS OWN PROCESS, from apps/web.
  //
  // Not a preference: Prisma's generated client lives in backend/node_modules
  // and Playwright's browser bindings live in apps/web/node_modules, and no
  // single working directory resolves both. Splitting them also forces the
  // journeys to assert on the public API rather than reaching into the
  // database — which is the stronger check anyway, since the API is what a
  // person actually sees.
  const journeys = spawn({
    cmd: [
      "node",
      "scripts/system-check-journeys.mjs",
      SITE_ORIGIN,
      bill.id,
      leader.email,
      follower.email,
      leader.name,
      POPULATION_PASSWORD,
      leader.id,
    ],
    cwd: WEB,
    stdout: "inherit",
    stderr: "inherit",
  });

  const code = await journeys.exited;
  if (code !== 0) {
    fail("the browser journeys", `the journey process exited ${code}`);
  }

  // One last read straight from the database, to be sure the API was not
  // telling the browser a story the stored tally disagrees with.
  const finalRow = await prisma.governmentReference.findUniqueOrThrow({
    where: { id: bill.id },
    select: { supportVotes: true, opposeVotes: true },
  });
  expect(
    "the stored tally agrees with what the site published",
    finalRow.supportVotes === 1 && finalRow.opposeVotes === 0,
    `database holds ${finalRow.supportVotes}/${finalRow.opposeVotes}`,
  );
}

try {
  await main();
} catch (error) {
  fail("the check ran to completion", String(error).slice(0, 300));
} finally {
  site.close();
  backend?.kill();
  await prisma.$disconnect();
}

console.log("");
if (failures.length > 0) {
  console.log(`${failures.length} of ${checked} checks failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`All ${checked} checks green. The citizens can drive the whole system.`);
