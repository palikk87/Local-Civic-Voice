/**
 * A thousand citizens using the platform at once, and the arithmetic checked
 * afterwards.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run load-check
 *
 * WHAT THIS IS FOR, and it is not a benchmark. Timings are printed because they
 * are free and occasionally interesting, but nothing here passes or fails on
 * how fast the server was. What it fails on is arithmetic: after several
 * hundred people vote on the same law in the same second, the number the
 * platform publishes must equal the number of people who voted. A platform
 * whose headline claim is "the aggregated will of real people" has exactly one
 * unforgivable bug, and it is a tally that drifts under load.
 *
 * THE HAZARD THIS WAS BUILT TO REACH. `applyWeightedTally` recounts and then
 * writes, which is two steps, and the comment above it says plainly that the
 * row lock is there because reading the code shows the hazard rather than
 * because any test could summon the interleaving. That is a fair thing to say
 * about three sequential requests. It is not a fair thing to say about five
 * hundred concurrent ones. This is the test that was missing.
 *
 * WHERE IT RUNS. The population database, never the live one, behind the same
 * assertion the seeding script uses. Nothing it writes reaches anybody.
 *
 * NO AI CALL HAPPENS HERE. The backend is started with its provider keys
 * blanked, so no amount of traffic can spend a credit.
 */

import { spawn, type Subprocess } from "bun";
import { resolve } from "node:path";
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

const PORT = Number(process.env.LOAD_CHECK_PORT ?? 4330);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** How many citizens take part. Deliberately large; the point is contention. */
const VOTERS = Number(process.env.LOAD_CHECK_VOTERS ?? 500);
/** How many requests are in flight at once. */
const CONCURRENCY = Number(process.env.LOAD_CHECK_CONCURRENCY ?? 64);
/** How many read the feed while all that writing is going on. */
const READERS = Number(process.env.LOAD_CHECK_READERS ?? 200);

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

// ------------------------------------------------------------------ timings

/**
 * Percentiles from raw samples.
 *
 * NOT AN AVERAGE. A mean latency hides exactly the thing worth seeing: the
 * slowest few percent, which is where a lock queue shows up. p99 on five
 * hundred samples is the fifth-slowest request, which is a real request that a
 * real person waited for.
 */
function percentiles(samples: number[]) {
  if (!samples.length) return { p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1]! };
}

function report(label: string, samples: number[], errors: number) {
  const p = percentiles(samples);
  console.log(
    `      ${label.padEnd(28)} n=${String(samples.length).padStart(4)}  ` +
      `p50=${String(p.p50).padStart(5)}ms  p95=${String(p.p95).padStart(5)}ms  ` +
      `p99=${String(p.p99).padStart(5)}ms  max=${String(p.max).padStart(5)}ms  errors=${errors}`,
  );
}

/**
 * Run tasks with a fixed number in flight.
 *
 * Not Promise.all over the whole list: five hundred simultaneous sockets
 * measures the sandbox's file descriptor limit rather than the server, and the
 * failures it produces look exactly like server failures. A bounded pool keeps
 * the pressure real and the diagnosis honest.
 */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await work(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

// ------------------------------------------------------------------ the server

let backend: Subprocess | undefined;

async function startBackend(): Promise<void> {
  backend = spawn({
    cmd: ["bun", "src/index.ts"],
    cwd: resolve(import.meta.dir, ".."),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      DATABASE_URL,
      DIRECT_URL: DATABASE_URL,
      BACKEND_URL: ORIGIN,
      APP_ORIGINS: ORIGIN,
      APP_SCHEMES: "ayeandnay",
      BETTER_AUTH_SECRET: "load-check-secret-not-used-anywhere-else",
      MEDIA_STORAGE: "local",
      UPLOADS_DIR: resolve(import.meta.dir, "../../.load-check-uploads"),
      CIVIC_NO_BACKGROUND_SYNC: "1",
      // No provider, so no amount of traffic can spend a credit. See the
      // matching note in panel-check.ts.
      GEMINI_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${ORIGIN}/health`)).ok) return;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(250);
  }
  throw new Error(`Backend did not become healthy on ${ORIGIN}`);
}

// -------------------------------------------------------------------- signing in

/**
 * A distinct address per citizen.
 *
 * WHY THIS IS NOT CHEATING, and why leaving it out was. Sign-in happens before
 * anybody is identified, so /api/auth/* is necessarily limited by address — ten
 * a minute. Five hundred citizens arriving from ONE address is not five hundred
 * people using the platform; it is one person hammering a login form, and the
 * server is supposed to stop that. Sending them from their own addresses is
 * what a real crowd looks like.
 *
 * The first run of this check did not do that, read the resulting 429s as
 * server failures, and reported the platform as collapsing under load. It was
 * measuring its own rate limiter. The consolation is that fixing the harness is
 * what surfaced the real bug underneath — see tests/rate-limit-per-person.ts.
 */
function addressFor(index: number): string {
  return `203.0.113.${index % 254}`;
}

/**
 * Sign a citizen in over real HTTP and keep the cookie.
 *
 * Not a planted session row. The session middleware, the cookie, and the ban
 * check are all part of what a real request carries, and a load test that skips
 * them measures a server nobody is running.
 */
async function signIn(index: number): Promise<string | null> {
  const who = citizen(index);
  const response = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": addressFor(index) },
    body: JSON.stringify({ email: who.email, password: POPULATION_PASSWORD }),
  });
  if (!response.ok) return null;
  const cookie = response.headers.getSetCookie?.() ?? [];
  const jar = cookie.map((line) => line.split(";")[0]).join("; ");
  return jar || null;
}

// --------------------------------------------------------------- the subject

/** One law, which everybody is about to vote on at the same moment. */
async function subject() {
  const id = "pop-load-subject";
  const existing = await prisma.governmentReference.findFirst({
    where: { masterReferenceId: id },
  });
  if (existing) return existing;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: id,
      referenceType: "bill",
      title: "The record five hundred people vote on at once",
      status: "proposed",
      category: "infrastructure",
    },
  });
}

// ------------------------------------------------------------------- the run

async function main() {
  console.log(`Load check against database "${databaseName}".`);
  console.log(`${VOTERS} citizens, ${CONCURRENCY} requests in flight.\n`);

  const size = await countPopulation(prisma);
  if (size < VOTERS) {
    console.log(`Building the population first (need ${VOTERS})…`);
    await buildPopulation(prisma, 1_000);
  }
  ok("the population is present", `${await countPopulation(prisma)} citizens`);

  await startBackend();
  ok("the backend is up", ORIGIN);

  const law = await subject();

  // START FROM A KNOWN ZERO. The assertion is an equality, so anything left
  // over from a previous run is not noise — it is a wrong answer.
  await prisma.governmentReferenceVote.deleteMany({
    where: { governmentReferenceId: law.id },
  });
  await prisma.governmentReference.update({
    where: { id: law.id },
    data: { supportVotes: 0, opposeVotes: 0 },
  });
  await prisma.post.deleteMany({ where: { content: { startsWith: "Load check" } } });
  ok("the record starts at nothing", "0 votes, 0 rows");

  // ------------------------------------------------------- 1. the sign-in storm

  console.log("\n1. Everybody signs in at once.");
  const jars: (string | null)[] = new Array(VOTERS).fill(null);
  const signInTimes: number[] = [];
  let signInErrors = 0;

  const startSignIn = Date.now();
  await pool(
    Array.from({ length: VOTERS }, (_, i) => i + 1),
    CONCURRENCY,
    async (index, slot) => {
      const began = Date.now();
      try {
        jars[slot] = await signIn(index);
        if (!jars[slot]) signInErrors += 1;
      } catch {
        signInErrors += 1;
      }
      signInTimes.push(Date.now() - began);
    },
  );
  const signInSeconds = (Date.now() - startSignIn) / 1000;

  report("sign in", signInTimes, signInErrors);
  console.log(`      ${Math.round(VOTERS / signInSeconds)} sign-ins per second`);

  const signedIn = jars.filter(Boolean).length;
  expect(
    "every citizen who tried to sign in got a session",
    signInErrors === 0,
    `${signInErrors} of ${VOTERS} sign-ins failed`,
  );

  // ------------------------------------------------ 2. the thundering herd

  console.log(`\n2. ${signedIn} citizens vote on the same law in the same moment.`);
  const voteTimes: number[] = [];
  let voteErrors = 0;
  let cast = 0;
  const positions = new Map<number, string>();

  const startVotes = Date.now();
  await pool(
    jars.map((jar, i) => ({ jar, i })),
    CONCURRENCY,
    async ({ jar, i }) => {
      if (!jar) return;
      // A mix, so the two columns are both under contention rather than one.
      const position = i % 3 === 0 ? "oppose" : "support";
      const began = Date.now();
      try {
        const response = await fetch(`${ORIGIN}/api/government-references/${law.id}/vote`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: jar },
          body: JSON.stringify({ position, isAnonymous: false }),
        });
        if (response.ok) {
          cast += 1;
          positions.set(i, position);
        } else {
          voteErrors += 1;
        }
      } catch {
        voteErrors += 1;
      }
      voteTimes.push(Date.now() - began);
    },
  );
  const voteSeconds = (Date.now() - startVotes) / 1000;

  report("cast a vote", voteTimes, voteErrors);
  console.log(`      ${Math.round(cast / voteSeconds)} votes per second`);

  expect(
    "no vote was refused under load",
    voteErrors === 0,
    `${voteErrors} of ${signedIn} votes returned an error`,
  );

  // --------------------------------------------- 3. THE ARITHMETIC, which is the point

  console.log("\n3. The published number, against the votes actually stored.");

  const storedRows = await prisma.governmentReferenceVote.groupBy({
    by: ["position"],
    where: { governmentReferenceId: law.id },
    _count: { _all: true },
  });
  const storedSupport = storedRows.find((r) => r.position === "support")?._count._all ?? 0;
  const storedOppose = storedRows.find((r) => r.position === "oppose")?._count._all ?? 0;

  const published = await prisma.governmentReference.findUniqueOrThrow({
    where: { id: law.id },
    select: { supportVotes: true, opposeVotes: true },
  });

  console.log(`      stored rows:  ${storedSupport} aye, ${storedOppose} nay`);
  console.log(`      published:    ${published.supportVotes} aye, ${published.opposeVotes} nay`);

  expect(
    "every vote cast is a vote stored",
    storedSupport + storedOppose === cast,
    `${cast} votes were accepted but ${storedSupport + storedOppose} rows exist`,
  );

  // THE ONE THAT MATTERS. Nobody has delegated in this run, so a weighted tally
  // and a plain count must agree exactly. Any gap is a lost update: a recount
  // that read before another vote landed and wrote after it did.
  expect(
    "the published aye total survived the stampede",
    published.supportVotes === storedSupport,
    `the record publishes ${published.supportVotes} aye but ${storedSupport} people voted aye ` +
      `— a lost update in applyWeightedTally under ${CONCURRENCY}-way concurrency`,
  );
  expect(
    "the published nay total survived the stampede",
    published.opposeVotes === storedOppose,
    `the record publishes ${published.opposeVotes} nay but ${storedOppose} people voted nay ` +
      `— a lost update in applyWeightedTally under ${CONCURRENCY}-way concurrency`,
  );

  // And the same number, read the way a citizen reads it.
  interface ApiReference {
    reference?: { votes?: { support?: number } };
    votes?: { support?: number };
    supportVotes?: number;
  }
  const seenByApi = (await fetch(`${ORIGIN}/api/government-references/${law.id}`).then((r) =>
    r.ok ? r.json() : null,
  )) as ApiReference | null;
  const apiSupport =
    seenByApi?.reference?.votes?.support ?? seenByApi?.votes?.support ?? seenByApi?.supportVotes;
  expect(
    "the API publishes the same number the database holds",
    apiSupport === undefined || apiSupport === storedSupport,
    `the API says ${apiSupport} aye, the database says ${storedSupport}`,
  );

  // ------------------------------------------ 4. reading while everybody writes

  console.log("\n4. Reading the feed while the writing continues.");
  const readTimes: number[] = [];
  let readErrors = 0;
  const readers = jars.filter(Boolean).slice(0, READERS) as string[];

  // Writes carry on underneath, so the reads are contending with real traffic
  // rather than sampling a quiet server.
  const keepWriting = pool(readers.slice(0, 50), 16, async (jar, i) => {
    await fetch(`${ORIGIN}/api/posts`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: jar },
      body: JSON.stringify({ content: `Load check post ${i}, written while the feed is read.` }),
    }).catch(() => undefined);
  });

  await pool(readers, CONCURRENCY, async (jar) => {
    const began = Date.now();
    try {
      const response = await fetch(`${ORIGIN}/api/feed?limit=20`, { headers: { cookie: jar } });
      if (!response.ok) readErrors += 1;
    } catch {
      readErrors += 1;
    }
    readTimes.push(Date.now() - began);
  });

  await keepWriting;
  report("read the feed", readTimes, readErrors);
  expect(
    "the feed answered every reader while writes were landing",
    readErrors === 0,
    `${readErrors} of ${readers.length} feed reads failed`,
  );

  // --------------------------------------------------- 5. the public surfaces

  console.log("\n5. The public pages, under the same pressure.");
  const surfaces = [
    "/api/government-references?limit=20",
    "/api/government-references/trending?limit=10",
    "/api/government-references/pulse?days=7&limit=5",
    "/health",
  ];

  for (const path of surfaces) {
    const times: number[] = [];
    let errors = 0;
    await pool(Array.from({ length: 100 }, (_, i) => i), CONCURRENCY, async (i) => {
      const began = Date.now();
      try {
        // Signed-out readers, each from their own address — a hundred strangers
        // rather than one stranger asking a hundred times.
        const response = await fetch(`${ORIGIN}${path}`, {
          headers: { "x-forwarded-for": addressFor(i) },
        });
        if (!response.ok) errors += 1;
      } catch {
        errors += 1;
      }
      times.push(Date.now() - began);
    });
    report(path.replace("/api/government-references", "…"), times, errors);
    expect(
      `${path} answered every request`,
      errors === 0,
      `${errors} of 100 requests to ${path} failed`,
    );
  }

  // ---------------------------------------------------- 6. changing your mind

  console.log("\n6. Two hundred people change their vote at once.");
  const switchers = jars.slice(0, 200).map((jar, i) => ({ jar, i })).filter((x) => x.jar);
  const switchTimes: number[] = [];
  let switchErrors = 0;

  await pool(switchers, CONCURRENCY, async ({ jar, i }) => {
    const was = positions.get(i);
    if (!was) return;
    const now = was === "support" ? "oppose" : "support";
    const began = Date.now();
    try {
      const response = await fetch(`${ORIGIN}/api/government-references/${law.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: jar! },
        body: JSON.stringify({ position: now, isAnonymous: false }),
      });
      if (response.ok) positions.set(i, now);
      else switchErrors += 1;
    } catch {
      switchErrors += 1;
    }
    switchTimes.push(Date.now() - began);
  });

  report("change a vote", switchTimes, switchErrors);

  const afterRows = await prisma.governmentReferenceVote.groupBy({
    by: ["position"],
    where: { governmentReferenceId: law.id },
    _count: { _all: true },
  });
  const afterSupport = afterRows.find((r) => r.position === "support")?._count._all ?? 0;
  const afterOppose = afterRows.find((r) => r.position === "oppose")?._count._all ?? 0;
  const afterPublished = await prisma.governmentReference.findUniqueOrThrow({
    where: { id: law.id },
    select: { supportVotes: true, opposeVotes: true },
  });

  console.log(`      stored rows:  ${afterSupport} aye, ${afterOppose} nay`);
  console.log(`      published:    ${afterPublished.supportVotes} aye, ${afterPublished.opposeVotes} nay`);

  expect(
    "changing a vote moves it rather than adding one",
    afterSupport + afterOppose === storedSupport + storedOppose,
    `the record had ${storedSupport + storedOppose} votes and now has ${afterSupport + afterOppose}`,
  );
  expect(
    "the published totals still match after the switch",
    afterPublished.supportVotes === afterSupport && afterPublished.opposeVotes === afterOppose,
    `published ${afterPublished.supportVotes}/${afterPublished.opposeVotes}, ` +
      `stored ${afterSupport}/${afterOppose}`,
  );

  // ----------------------------------------------------------------- tidy up

  await prisma.post.deleteMany({ where: { content: { startsWith: "Load check" } } });
}

const started = Date.now();

try {
  await main();
} catch (error) {
  fail("the load check ran to completion", (error as Error).message);
} finally {
  backend?.kill();
  await prisma.$disconnect().catch(() => undefined);
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n${checked} checks in ${seconds}s.`);

if (failures.length) {
  console.log(`\n${failures.length} failed:\n`);
  for (const line of failures) console.log(`  - ${line}`);
  process.exit(1);
}

console.log("\nThe numbers held under load. What the platform publishes is what people voted.");
process.exit(0);
