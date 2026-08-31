/**
 * The Discover search box finds a law, and each result opens it.
 *
 *   node scripts/discover-search-check.mjs dist     (after `npm run build`)
 *
 * WHY THIS EXISTS. Reported plainly: "the Discover search bar is not working."
 * It was not. The box filtered, in the browser, the handful of bills that page
 * had already loaded — and the list it filtered was rendered on ONE of the five
 * tabs. So on four tabs typing did nothing whatsoever, and on the fifth it could
 * not find a law that was not already on screen, while the placeholder promised
 * "bills, cases, officials".
 *
 * A typecheck cannot catch that: every line compiled. Only a browser can tell
 * you that typing a word changes what a reader sees.
 *
 * WHAT IT PROVES:
 *   - Typing a word asks the SERVER and finds a law that was never on screen.
 *   - It finds one on a tab other than the one the old filter lived on.
 *   - A word that matches nothing says so, rather than showing everything.
 *   - Every result carries "See details", and it opens the record over the
 *     results without leaving the search behind.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, only ever through
 * TEST_POPULATION_DATABASE_URL. It creates records prefixed "dsearch" and
 * removes them on the way out.
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

const API_PORT = Number(process.env.DSEARCH_CHECK_PORT ?? 3987);
const API = `http://127.0.0.1:${API_PORT}`;
const PREFIX = "dsearch";

// A word that appears in NOTHING else in the archive, so a hit is this record
// and not a coincidence.
const NEEDLE = "Zarquon";
const BILL_TITLE = `An Act concerning the ${NEEDLE} Waterway`;
const EO_TITLE = `Establishing the ${NEEDLE} Council`;

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${String(detail).slice(0, 180)}` : ""}`);
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
  BETTER_AUTH_SECRET: "discover-search-check-secret-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".discover-search-check-uploads"),
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
      if ((await fetch(`${API}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

function removeTheRecords() {
  try {
    db(`await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { startsWith: "${PREFIX}" } } });`);
  } catch (error) {
    console.error("could not clean up:", error.message);
  }
}

let server;
let browser;

try {
  await waitForApi();
  removeTheRecords();

  db(`
    await prisma.governmentReference.create({ data: {
      masterReferenceId: "${PREFIX}-hr-1", referenceType: "bill", status: "introduced",
      title: ${JSON.stringify(BILL_TITLE)}, category: "environment",
      sponsorName: "Jane Q. Lawmaker",
      introducedDate: new Date("2011-03-04T00:00:00Z"),
    }});
    await prisma.governmentReference.create({ data: {
      masterReferenceId: "${PREFIX}-eo-1", referenceType: "executive_order", status: "active",
      title: ${JSON.stringify(EO_TITLE)}, category: "economy",
      signedDate: new Date("2014-07-01T00:00:00Z"),
    }});
  `);

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await acceptTermsBeforeLoad(context);
  const page = await context.newPage();
  await routeApiToLocal(page, API);
  await page.goto(`${base}/discover`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(1_500);

  const screen = () => page.evaluate(() => document.getElementById("root")?.innerText ?? "");
  const box = page.locator('input[placeholder*="Search"]').first();

  // Neither record is on screen before anybody types — otherwise a "hit" below
  // would prove nothing at all.
  check("THERE ARE NO RESULTS BEFORE ANYBODY TYPES",
    (await page.locator("[data-search-results]").count()) === 0);

  await box.fill(NEEDLE);
  await page.waitForTimeout(2_500);
  const found = await screen();

  check("TYPING FINDS A LAW THAT WAS NEVER ON SCREEN", found.includes(BILL_TITLE), found.slice(0, 200));
  check("…AND FINDS THE EXECUTIVE ORDER TOO, NOT JUST BILLS", found.includes(EO_TITLE));
  check("…and says how many it found", /\b2 results\b/.test(found), found.slice(0, 120));

  // The old filter lived on the trending tab alone. Searching must not depend
  // on which tab a reader happened to be standing on.
  check("…and the tabs give way to the results", !/Trending Bills/i.test(found));

  // ------------------------------------------------------- see details
  const results = page.locator("[data-search-results]");
  // The real <button>, not the card wrapper around it — getByRole matches a
  // name as a SUBSTRING by default, and the card's own text contains it.
  const details = results.locator("button", { hasText: "See details" });
  const detailCount = await details.count();
  check("EVERY RESULT OFFERS SEE DETAILS", detailCount === 2, `${detailCount} buttons`);

  await details.first().click();
  await page.waitForTimeout(2_000);
  const dialog = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.innerText ?? "",
  );
  check("…WHICH OPENS THE RECORD IN A POPUP", dialog.length > 0, dialog.slice(0, 160));
  // The first result is the executive order, so that is the record that opened.
  check("…with THAT law's own title on it", dialog.includes(EO_TITLE), dialog.slice(0, 120));
  check("…and the President who signed it", /Signed by Barack Obama/.test(dialog));
  check("…and a way through to the full record", /Open the full record/i.test(dialog));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);
  const after = await screen();
  check("…and closing it leaves the search where it was", after.includes(BILL_TITLE), after.slice(0, 140));

  // --------------------------------------------------- a word that matches nothing
  await box.fill("Zzzyzyx");
  await page.waitForTimeout(2_500);
  const empty = await screen();
  check("A WORD THAT MATCHES NOTHING SAYS SO", /Nothing matches/i.test(empty), empty.slice(0, 160));
  check("…rather than quietly showing everything", !empty.includes(BILL_TITLE));

  await context.close();
} catch (error) {
  console.error("\n" + (error?.stack ?? error));
  failures.push("the check itself threw");
} finally {
  removeTheRecords();
  const left = db(`console.log(await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${PREFIX}" } } }));`);
  check("the records this check created are gone", left === "0", left);
  if (browser) await browser.close();
  if (server) server.close();
  api.kill("SIGTERM");
}

console.log(
  failures.length === 0
    ? "\nThe search bar searches, and every result opens."
    : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
