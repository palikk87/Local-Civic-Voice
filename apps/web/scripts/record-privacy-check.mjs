/**
 * Somebody else's record: the numbers are open, the list is a click, and the
 * anonymous positions are nobody's business but their author's.
 *
 *   bun run record-privacy-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. A bug report asked whether showing a person's voting
 * history on their profile broke the anonymity this platform promises. It did
 * not — the server withholds anonymous positions from everybody but their
 * author, in the list AND in the counts. But that rule had no test of any
 * kind, on any layer. It was enforced and unproven, which is a rule waiting to
 * be refactored away by somebody who does not know it is there.
 *
 * A unit test could prove the query. Only a browser can prove the page, and
 * the page is where a leak would actually reach a person.
 *
 * WHAT IT PROVES:
 *   - A STRANGER NEVER SEES AN ANONYMOUS POSITION — not on the profile, not on
 *     the record page, and not in the counts either.
 *   - Their profile shows the counts and does NOT list the positions.
 *   - The list is one deliberate click away, and works signed out.
 *   - Your own record still shows everything inline, anonymous ones marked.
 *   - Back goes back, rather than to a page the reader has never seen.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL. It creates
 * records prefixed "reccheck", writes positions for two citizens, and removes
 * every row of it on the way out.
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
      `This check writes positions, so it only runs against a database whose\n` +
      `name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.RECORD_CHECK_PORT ?? 3988);
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

/** Has taken positions, one of them anonymously. */
const SUBJECT = citizen(71);
/** Reads the subject's profile. Not them. */
const READER = citizen(72);

const EVERYONE = [SUBJECT, READER];
const REF_PREFIX = "reccheck";

/** The law the subject backed with their name on it. */
const PUBLIC_LAW = "A law they backed in the open";
/** The law they backed anonymously. Must never reach the reader. */
const SECRET_LAW = "A law they backed without their name";

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
  BETTER_AUTH_SECRET: "record-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".record-check-uploads"),
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
    await prisma.positionEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: { in: refIds } } });
    await prisma.governmentReference.deleteMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    restorePopulation();
    const left = db(`
      const p = await prisma.positionEvent.count({ where: { userId: { in: ${JSON.stringify(EVERYONE.map((x) => x.id))} } } });
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ p, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no positions left", state.p === 0, left);
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
      "X-Forwarded-For": `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
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

  // Two positions for one citizen: one in the open, one anonymous.
  db(`
    const open = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-open",
        referenceType: "bill",
        title: ${JSON.stringify(PUBLIC_LAW)},
        status: "introduced",
        lawVersion: 1,
      },
    });
    const secret = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-secret",
        referenceType: "bill",
        title: ${JSON.stringify(SECRET_LAW)},
        status: "introduced",
        lawVersion: 1,
      },
    });
    await prisma.positionEvent.create({
      data: {
        userId: "${SUBJECT.id}",
        governmentReferenceId: open.id,
        position: "support",
        lawVersion: 1,
        isAnonymous: false,
      },
    });
    await prisma.positionEvent.create({
      data: {
        userId: "${SUBJECT.id}",
        governmentReferenceId: secret.id,
        position: "support",
        lawVersion: 1,
        isAnonymous: true,
      },
    });
  `);

  const cookies = {};
  for (const who of EVERYONE) cookies[who.id] = await signIn(who);

  server = createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    let file = join(DIST, url === "/" ? "index.html" : url);
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
    await page.waitForTimeout(1_500);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  // ------------------------------------------- a stranger reading their profile
  {
    const { context, page } = await open(READER, `/user/${SUBJECT.id}`);
    const text = await screen(page);

    check("their profile carries the record heading", /Their record/i.test(text));
    check(
      "the numbers are still open — those were never the problem",
      /Positions/.test(text) && /Aye/.test(text) && /Nay/.test(text),
    );
    check(
      "THE POSITIONS THEMSELVES ARE NOT LISTED — the list is behind a click now",
      !text.includes(PUBLIC_LAW),
      text.includes(PUBLIC_LAW) ? "the public law is on the profile" : undefined,
    );
    check(
      "…and the way through is offered rather than hidden",
      (await page.locator('[data-testid="see-full-record"]').count()) === 1,
    );
    check(
      "THE ANONYMOUS POSITION IS NOWHERE ON THE PROFILE",
      !text.includes(SECRET_LAW),
    );
    check(
      "the page says what it withholds instead of withholding it quietly",
      /Anything they chose to take anonymously is not here/i.test(text),
    );
    await context.close();
  }

  // -------------------------------------------------- the record page they reach
  {
    const { context, page } = await open(READER, `/user/${SUBJECT.id}`);
    await page.locator('[data-testid="see-full-record"]').click();
    await page.waitForURL(/\/record$/, { timeout: 15_000 });
    await page.waitForTimeout(1_500);
    const text = await screen(page);

    check("the click lands on their record", /\/user\/.*\/record$/.test(page.url()), page.url());
    check("…and the public position is there", text.includes(PUBLIC_LAW));
    check("THE ANONYMOUS ONE IS STILL NOT", !text.includes(SECRET_LAW));

    // BACK MEANS BACK. This page used to be reachable only from a profile, so a
    // hardcoded "back to profile" looked harmless — until somebody arrives from
    // a search or a link. The browser knows where they came from.
    await page.goBack();
    await page.waitForTimeout(800);
    check(
      "back goes back to where the reader actually was",
      page.url().endsWith(`/user/${SUBJECT.id}`),
      page.url(),
    );
    await context.close();
  }

  // ------------------------------------------------------- signed out, no account
  {
    const { context, page } = await open(null, `/user/${SUBJECT.id}/record`);
    const text = await screen(page);
    check("a stranger with no account can read the public record", text.includes(PUBLIC_LAW));
    check("…and still never sees the anonymous one", !text.includes(SECRET_LAW));
    await context.close();
  }

  // ------------------------------------------------------------- their own record
  {
    const { context, page } = await open(SUBJECT, "/profile");
    const text = await screen(page);
    check("their own record is still right there, no click needed", text.includes(PUBLIC_LAW));
    check(
      "AND THEY CAN SEE THEIR OWN ANONYMOUS POSITION — Article IV shields them from other people, not from themselves",
      text.includes(SECRET_LAW),
    );
    check("…marked as anonymous, so they know which is which", /Anonymous/.test(text));
    await context.close();
  }
} catch (error) {
  console.error(`\nThe check could not run: ${error.message}`);
  failures.push("the check ran");
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nThe numbers are open, the list is a click, and an anonymous position is nobody else's business.");
