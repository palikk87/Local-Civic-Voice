/**
 * The Trust Score is on the page, with its working — and it ranks nobody.
 *
 *   bun run trust-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. What this feature is for is a sentence about a screen:
 * "trust scores are not meant to rank anyone, they are meant to inform people
 * when delegating votes." A number computed correctly and shown nowhere near
 * the decision informs nobody, and a number shown without its parts is
 * something a reader can only believe or not. Neither of those failures is
 * visible from a test that calls a function.
 *
 * WHAT IT PROVES:
 *   - A NEW ACCOUNT IS NOT GIVEN A NUMBER. Its profile says "not enough yet".
 *   - An established account shows a score AND every part that produced it.
 *   - The score is on the delegate card, where the choice is actually made.
 *   - The page says out loud that it ranks nobody and changes nothing.
 *   - A finding pulls the number down, visibly.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL. It removes every
 * row it created on the way out.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const DIST = process.argv[2] ?? "dist";
const BACKEND = resolve(process.cwd(), "..", "..", "backend");

const POPULATION_URL =
  process.env.TEST_POPULATION_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_population";

if (!/population/i.test(new URL(POPULATION_URL).pathname)) {
  console.error(
    `Refusing to run against "${new URL(POPULATION_URL).pathname}".\n` +
      `This check writes posts, votes and a jury finding, so it only runs\n` +
      `against a database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.TRUST_CHECK_PORT ?? 3990);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";

const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return {
    id: `pop-${padded}`,
    username: `citizen${padded}`,
    name: `Citizen ${padded}`,
    email: `citizen-${padded}@population.invalid`,
  };
};

/** Built up into a real record. */
const ESTABLISHED = citizen(61);
/** Left exactly as the seeder made them: no age, no votes, no posts. */
const NEWCOMER = citizen(62);
/** Reads the pages. */
const READER = citizen(63);

const EVERYONE = [ESTABLISHED, NEWCOMER, READER];
const REF_PREFIX = "trustcheck";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function db(snippet) {
  return execFileSync(
    "bun",
    [
      "-e",
      `const { PrismaClient } = require("@prisma/client");
       const prisma = new PrismaClient({ datasources: { db: { url: process.env.POP_URL } } });
       (async () => { ${snippet} await prisma.$disconnect(); })();`,
    ],
    { cwd: BACKEND, env: { ...process.env, POP_URL: POPULATION_URL }, encoding: "utf8" },
  ).trim();
}

const backendEnv = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(API_PORT),
  DATABASE_URL: POPULATION_URL,
  DIRECT_URL: POPULATION_URL,
  BACKEND_URL: API,
  BETTER_AUTH_SECRET: "trust-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".trust-check-uploads"),
  HEALTH_SCHEMA_TTL_MS: "0",
  CIVIC_NO_BACKGROUND_SYNC: "1",
};

const api = spawn("bun", ["src/index.ts"], { cwd: BACKEND, env: backendEnv, stdio: ["ignore", "pipe", "pipe"] });
let apiLog = "";
api.stdout.on("data", (d) => { apiLog += d; });
api.stderr.on("data", (d) => { apiLog += d; });

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

let server;
let browser;

function restorePopulation() {
  db(`
    const ids = ${JSON.stringify(EVERYONE.map((p) => p.id))};
    const refs = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
      select: { id: true },
    });
    const refIds = refs.map((r) => r.id);
    await prisma.jurySeat.deleteMany({ where: { jurorId: { in: ids } } });
    await prisma.jury.deleteMany({ where: { accusedId: { in: ids } } });
    await prisma.report.deleteMany({ where: { reporterId: { in: ids } } });
    await prisma.report.deleteMany({ where: { reportedUserId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { toUserId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { fromUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: { in: refIds } } });
    await prisma.positionEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.governmentReference.deleteMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date() } });
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    restorePopulation();
    const left = db(`
      const j = await prisma.jury.count();
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ j, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no juries left", state.j === 0, left);
    check("…no records this check created left", state.r === 0, left);
    check("…and all thousand citizens still there", state.u >= 1000, left);
  } catch (error) {
    console.error(`Could not restore the population rows: ${error.message}`);
    failures.push("population restored");
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

async function signIn(who) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({ email: who.email, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`${who.username} could not sign in: ${response.status} ${await response.text()}`);
  }
  return (response.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0]).join("; ");
}

try {
  await waitForApi();
  restorePopulation();

  // A real record for one citizen: old enough, twenty votes, three posts, and a
  // position revisited after the law under it moved.
  db(`
    await prisma.user.update({
      where: { id: "${ESTABLISHED.id}" },
      data: { createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.post.create({
        data: { authorId: "${ESTABLISHED.id}", content: "A position worth putting a name to, " + i + "." },
      });
    }
    for (let i = 0; i < 20; i += 1) {
      const row = await prisma.governmentReference.create({
        data: {
          masterReferenceId: "${REF_PREFIX}-" + i,
          referenceType: "bill",
          title: "A law worth a position, " + i,
          status: "proposed",
          category: "healthcare",
          lawVersion: i === 0 ? 3 : 1,
        },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: row.id, userId: "${ESTABLISHED.id}", position: "support" },
      });
      if (i === 0) {
        // Went back and looked again after the text changed.
        await prisma.positionEvent.create({
          data: {
            userId: "${ESTABLISHED.id}",
            governmentReferenceId: row.id,
            position: "support",
            lawVersion: 3,
          },
        });
      }
    }
  `);

  const cookies = {};
  for (const person of EVERYONE) cookies[person.id] = await signIn(person);

  server = createServer(async (req, res) => {
    const [path] = req.url.split("?");
    let file = join(DIST, path === "/" ? "index.html" : path);
    try {
      if (!(await stat(file)).isFile()) throw new Error("dir");
    } catch {
      file = join(DIST, "index.html");
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  browser = await launchChromium();

  async function open(who, path) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    await acceptTermsBeforeLoad(context);
    if (who) {
      const [name, ...rest] = cookies[who.id].split("=");
      await context.addCookies([
        { name, value: rest.join("="), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
      ]);
    }
    const page = await context.newPage();
    await routeApiToLocal(page, API);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });
    await page.waitForTimeout(1_200);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  {
    // A NEW ACCOUNT IS NOT GIVEN A NUMBER.
    const { context, page } = await open(READER, `/user/${NEWCOMER.id}`);
    await page.waitForSelector('[data-testid="trust-panel"]', { timeout: 20_000 }).catch(() => undefined);
    const text = await screen(page);

    check(
      "A NEW ACCOUNT IS NOT GIVEN A NUMBER — the page says there is not enough yet",
      /Not enough of a record yet/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    check(
      "…and no meter or score is drawn for them",
      (await page.locator('[data-testid="trust-part"]').count()) === 0,
    );
    await context.close();
  }

  {
    const { context, page } = await open(READER, `/user/${ESTABLISHED.id}`);
    await page.waitForSelector('[data-testid="trust-part"]', { timeout: 20_000 }).catch(() => undefined);
    const text = await screen(page);

    check("an established account has a score", /Trust Score/i.test(text));
    check(
      "IT SHOWS ITS WORKING — every part is on the page",
      (await page.locator('[data-testid="trust-part"]').count()) === 7,
      String(await page.locator('[data-testid="trust-part"]').count()),
    );
    check(
      "…including the position they revisited after the law changed",
      /went back and looked again at 1 record/i.test(text),
      text.slice(0, 800).replace(/\n/g, " | "),
    );
    check(
      "…and it says out loud that it ranks nobody",
      /ranks nobody/i.test(text) && /not a judgement of a\s*person/i.test(text.replace(/\n/g, " ")),
      text.slice(-500).replace(/\n/g, " | "),
    );

    // THE NUMBER AND ITS PARTS HAVE TO AGREE, on the page, in front of a
    // reader. Read out of the DOM rather than scraped from the page text: a
    // part contributing zero renders as "0" with no sign, and a regex looking
    // for signs silently drops it — which would have passed while proving
    // nothing.
    const shown = Number(
      await page.evaluate(() => {
        const node = document.querySelector('[data-testid="trust-panel"]');
        const big = node?.querySelector(".text-2xl");
        return big ? big.textContent : "";
      }),
    );
    const parts = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="trust-part"]')].map((node) =>
        Number((node.textContent ?? "").trim().match(/^[+-]?\d+/)?.[0] ?? NaN),
      ),
    );
    const summed = parts.reduce((a, b) => a + b, 0);
    check(
      "…and the number is exactly its parts added up",
      Number.isFinite(shown) &&
        parts.length === 7 &&
        parts.every((n) => Number.isFinite(n)) &&
        Math.max(0, Math.min(100, summed)) === shown,
      `shown ${shown}, parts ${parts.join(" ")} = ${summed}`,
    );
    await context.close();
  }

  {
    // WHERE THE DECISION IS MADE.
    const { context, page } = await open(READER, "/delegates");
    await page.waitForSelector('[data-testid="trust-compact"]', { timeout: 20_000 }).catch(() => undefined);
    check(
      "THE SCORE IS ON THE DELEGATE CARD, where the choice is actually made",
      (await page.locator('[data-testid="trust-compact"]').count()) > 0,
      String(await page.locator('[data-testid="trust-compact"]').count()),
    );
    const text = await screen(page);
    check(
      "…and nothing on that page claims a ranking",
      !/\btop\s+delegate|ranked|leaderboard|best\s+delegate/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    await context.close();
  }

  {
    // A FINDING PULLS IT DOWN, VISIBLY.
    const before = JSON.parse(
      db(`
        const r = await fetch("${API}/api/users/${ESTABLISHED.id}/trust").then((x) => x.json());
        console.log(JSON.stringify({ score: r.trust.score }));
      `).split("\n").filter(Boolean).pop(),
    );

    db(`
      const written = await prisma.post.create({
        data: { authorId: "${ESTABLISHED.id}", content: "A claim about a law." },
      });
      const filed = await prisma.report.create({
        data: {
          reporterId: "${READER.id}",
          postId: written.id,
          reason: "misinformation",
          status: "actioned",
        },
      });
      await prisma.jury.create({
        data: {
          reportId: filed.id,
          accusedId: "${ESTABLISHED.id}",
          panelKind: "post",
          seats: 5,
          votesToDecide: 3,
          status: "decided",
          verdict: "upheld",
          decidedAt: new Date(),
        },
      });
    `);

    const { context, page } = await open(READER, `/user/${ESTABLISHED.id}`);
    await page.waitForSelector('[data-testid="trust-part"]', { timeout: 20_000 }).catch(() => undefined);
    const text = await screen(page);

    check(
      "A FINDING PULLS THE NUMBER DOWN, and says so in words",
      /1 jury finding in the last year that they misrepresented a law/i.test(text),
      text.slice(0, 900).replace(/\n/g, " | "),
    );

    const after = JSON.parse(
      db(`
        const r = await fetch("${API}/api/users/${ESTABLISHED.id}/trust").then((x) => x.json());
        console.log(JSON.stringify({ score: r.trust.score }));
      `).split("\n").filter(Boolean).pop(),
    );
    check(
      "…and the number actually moved",
      after.score < before.score,
      `${before.score} → ${after.score}`,
    );
    await context.close();
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe Trust Score is on the page with its working, where a delegation is decided — and it ranks nobody.");
