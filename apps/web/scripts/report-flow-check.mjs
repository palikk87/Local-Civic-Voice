/**
 * Reporting somebody, end to end: the form, the queue, and the answer back.
 *
 *   bun run report-flow-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Reported plainly: "doesn't do anything just says a report
 * has been sent, checked on the admin side there is nothing there that shows
 * that report."
 *
 * Every layer of that was invisible to a unit test. The button DID call the
 * API; it just sent `reason: "other"` and nothing else. The queue endpoint DID
 * work; no screen had ever called it. A test of either layer alone passes while
 * the thing a person does still goes nowhere. Only a browser walks the whole
 * path.
 *
 * WHAT IT PROVES:
 *   - Pressing Report opens a FORM, rather than firing a report on the spot.
 *   - The reason and the words reach the database as chosen and written.
 *   - THE REPORT APPEARS IN THE ADMIN TAB, which is what could not be found.
 *   - The jury's true state is on the row: "0 of 5 seats" rather than a blank.
 *   - Closing it tells the person who filed it, and LEAVES THE JURY ALONE.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL. Three citizens and one report, all
 * removed on the way out. One of the thousand is made superadmin and put back.
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
  console.error(`Refusing to run against "${new URL(POPULATION_URL).pathname}".`);
  process.exit(1);
}

const API_PORT = Number(process.env.REPORT_CHECK_PORT ?? 3982);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";

const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return {
    id: `pop-${padded}`,
    username: `citizen${padded}`,
    email: `citizen-${padded}@population.invalid`,
  };
};

/** Files the report. */
const REPORTER = citizen(91);
/** Gets reported. */
const ACCUSED = citizen(92);
/** Reads the queue. */
const ADMIN = citizen(93);

const EVERYONE = [REPORTER, ACCUSED, ADMIN];
const WORDS = "They followed me across three threads calling me names.";

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
  BETTER_AUTH_SECRET: "report-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".report-check-uploads"),
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
    const reports = await prisma.report.findMany({
      where: { OR: [{ reporterId: { in: ids } }, { reportedUserId: { in: ids } }] },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);
    await prisma.jurySeat.deleteMany({ where: { jury: { reportId: { in: reportIds } } } });
    await prisma.jury.deleteMany({ where: { reportId: { in: reportIds } } });
    await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.adminSession.deleteMany({ where: { adminId: { in: ids } } });
    // The seat is put back. Nobody in the population keeps it.
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { role: "user", banned: false } });
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    restorePopulation();
    const left = db(`
      const ids = ${JSON.stringify(EVERYONE.map((p) => p.id))};
      const r = await prisma.report.count({ where: { reporterId: { in: ids } } });
      const a = await prisma.user.count({ where: { id: { in: ids }, role: "superadmin" } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ r, a, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no reports left", state.r === 0, left);
    check("…and nobody kept the owner's seat", state.a === 0, left);
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
      "X-Forwarded-For": `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
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

  // Somebody has to hold the seat before anybody can read the queue. The
  // console offers no way to assign it, deliberately.
  db(`await prisma.user.update({ where: { id: "${ADMIN.id}" }, data: { role: "superadmin" } });`);

  const cookies = {};
  for (const who of EVERYONE) cookies[who.id] = await signIn(who);

  const consoleSession = await fetch(`${API}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.4.9.9" },
    body: JSON.stringify({ username: ADMIN.username, password: PASSWORD }),
  }).then((r) => r.json());

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

  async function open(who, path, asAdmin = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
    await acceptTermsBeforeLoad(context);
    if (who) {
      const [name, ...rest] = cookies[who.id].split("=");
      await context.addCookies([
        { name, value: rest.join("="), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
      ]);
    }
    const page = await context.newPage();
    await routeApiToLocal(page, API);
    if (asAdmin) {
      await page.addInitScript((stored) => {
        localStorage.setItem("admin-store", JSON.stringify(stored));
      }, {
        state: {
          session: {
            token: consoleSession.token,
            adminId: consoleSession.admin.id,
            username: consoleSession.admin.username,
            role: consoleSession.admin.role,
            capabilities: consoleSession.admin.capabilities,
            expiresAt: consoleSession.expiresAt,
          },
          isAdminAuthenticated: true,
        },
        version: 0,
      });
    }
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });
    await page.waitForTimeout(1_800);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  // -------------------------------------------------- the form, from a profile
  {
    const { context, page } = await open(REPORTER, `/user/${ACCUSED.id}`);

    await page.locator('[data-testid="report-user"]').click();
    const opened = await page
      .waitForSelector('[data-testid="report-dialog"]', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("PRESSING REPORT OPENS A FORM — it used to fire on the spot", opened);

    if (opened) {
      const filedNothingYet = Number(
        db(`console.log(await prisma.report.count({ where: { reporterId: "${REPORTER.id}" } }));`),
      );
      check("…and nothing is filed until they say what is wrong", filedNothingYet === 0);

      await page.locator("#reason-harassment").click();
      await page.locator('[data-testid="report-detail"]').fill(WORDS);
      await page.locator('[data-testid="report-send"]').click();
      await page.waitForTimeout(2_500);
    }

    const filed = JSON.parse(
      db(`
        const rows = await prisma.report.findMany({
          where: { reporterId: "${REPORTER.id}" },
          select: { reason: true, detail: true, reportedUserId: true },
        });
        console.log(JSON.stringify(rows));
      `),
    );
    check("THE REASON THEY PICKED IS THE REASON STORED", filed[0]?.reason === "harassment", JSON.stringify(filed));
    check("AND THE WORDS THEY WROTE ARE STORED", filed[0]?.detail === WORDS);
    check("…against the person they were looking at", filed[0]?.reportedUserId === ACCUSED.id);
    await context.close();
  }

  // ------------------------------------------------------------ the admin queue
  {
    const { context, page } = await open(ADMIN, "/admin/reports", true);
    await page.waitForSelector('[data-testid="report-row"]', { timeout: 20_000 }).catch(() => undefined);
    const text = await screen(page);

    check("THE REPORT IS IN THE ADMIN TAB — this is what could not be found", /Harassment/.test(text));
    check("…with what the reporter actually wrote", text.includes(WORDS));
    check(
      "…and the jury's true state, rather than a blank",
      /seats filled/.test(text) && /nobody is eligible to sit yet/.test(text),
      (text.match(/Jury drawn[^\n]*/) ?? [""])[0],
    );
    check(
      "the page says an admin does not stop a jury",
      /closing a report here does not stop one/i.test(text),
    );

    // Close it, and prove the proceeding is untouched.
    const juryBefore = db(
      `const j = await prisma.jury.findFirst({ where: { report: { reporterId: "${REPORTER.id}" } }, select: { id: true, status: true, verdict: true } }); console.log(JSON.stringify(j));`,
    );
    await page.locator('[data-testid="mark-handled"]').first().click();
    await page.waitForTimeout(2_500);

    const juryAfter = db(
      `const j = await prisma.jury.findFirst({ where: { report: { reporterId: "${REPORTER.id}" } }, select: { id: true, status: true, verdict: true } }); console.log(JSON.stringify(j));`,
    );
    check("[art5-sec3] CLOSING THE REPORT LEAVES THE JURY EXACTLY AS IT WAS", juryBefore === juryAfter, juryAfter);

    const closed = db(
      `const r = await prisma.report.findFirst({ where: { reporterId: "${REPORTER.id}" }, select: { status: true, reviewedBy: true } }); console.log(JSON.stringify(r));`,
    );
    check("…and the report itself is closed, by a named admin", /actioned/.test(closed) && /reviewedBy":"[^"]/.test(closed), closed);
    await context.close();
  }

  // ------------------------------------------------------- the reporter is told
  {
    const told = Number(
      db(
        `console.log(await prisma.notification.count({ where: { userId: "${REPORTER.id}", type: "report_decided" } }));`,
      ),
    );
    check("THE PERSON WHO FILED IT IS TOLD — reporting into silence is why people stop", told === 1, String(told));
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
console.log("\nA report is filed with a reason and in their own words, it reaches the queue, and the jury is left alone.");
