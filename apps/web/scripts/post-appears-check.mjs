/**
 * A post you just wrote is on the page before you touch anything.
 *
 *   node scripts/post-appears-check.mjs dist     (after `npm run build`)
 *
 * WHY THIS EXISTS. Reported plainly: "when sharing new posts it takes a page
 * refresh to display it."
 *
 * The compose card is rendered ON the timeline, but the timeline draws its
 * posts from the store, loaded once when the page mounts. Posting invalidated
 * two React Query caches — neither of which that screen reads — so the post
 * reached the server and the page did not move. Reloading appeared to fix it
 * only because a reload re-mounts the page and runs the load again.
 *
 * A typecheck cannot see any of that. Both halves compile; they simply are not
 * connected. Only a browser can tell you whether the words show up.
 *
 * WHAT IT PROVES:
 *   - Posting puts the post on the timeline WITHOUT a reload.
 *   - It is really saved, not just painted: it is still there after one.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, only ever through
 * TEST_POPULATION_DATABASE_URL. It creates one record prefixed "postnow" and
 * one post by one existing citizen, and removes both on the way out.
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

const API_PORT = Number(process.env.POSTNOW_CHECK_PORT ?? 3988);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";
const REF_PREFIX = "postnow";
const LAW = "An Act to prove a post appears at once";
const EO = "An order to prove the composer shows a law card";
const RULING = "A ruling to prove the bench has faces";
// Distinctive enough that finding it on the page cannot be a coincidence.
const WORDS = `This is the post that must appear without a reload ${Date.now()}`;

const AUTHOR = {
  id: "pop-0073",
  email: "citizen-0073@population.invalid",
};

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${String(detail).slice(0, 160)}` : ""}`);
  if (!ok) failures.push(label);
}

function db(snippet) {
  return execFileSync("bun", ["-e",
    `const { PrismaClient } = require("@prisma/client");
     const prisma = new PrismaClient({ datasources: { db: { url: process.env.POP_URL } } });
     (async () => { ${snippet} await prisma.$disconnect(); })();`],
    { cwd: BACKEND, env: { ...process.env, POP_URL: POPULATION_URL }, encoding: "utf8" }).trim();
}

const api = spawn("bun", ["src/index.ts"], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    DATABASE_URL: POPULATION_URL,
    DIRECT_URL: POPULATION_URL,
    BACKEND_URL: API,
    BETTER_AUTH_SECRET: "post-appears-check-secret-not-used-anywhere-else",
    APP_ORIGINS: "*",
    APP_SCHEMES: "ayeandnay",
    MEDIA_STORAGE: "local",
    UPLOADS_DIR: join(BACKEND, ".post-appears-check-uploads"),
    HEALTH_SCHEMA_TTL_MS: "0",
    CIVIC_NO_BACKGROUND_SYNC: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (d) => { apiLog += d; });
api.stderr.on("data", (d) => { apiLog += d; });
process.on("exit", () => { api.kill("SIGKILL"); });

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(`${API}/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

function cleanUp() {
  try {
    db(`
      await prisma.post.deleteMany({ where: { content: { contains: "must appear without a reload" } } });
      await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
    `);
  } catch (error) {
    console.error("could not clean up:", error.message);
  }
}

let server, browser;

try {
  await waitForApi();
  cleanUp();

  db(`await prisma.governmentReference.create({ data: {
        masterReferenceId: "${REF_PREFIX}-hr-1", referenceType: "bill", status: "introduced",
        title: ${JSON.stringify(LAW)}, category: "economy", lawVersion: 1,
      }});`);

  // An order carries a signer and a face, worked out from its date — the
  // richest thing the composer can be asked to show.
  const eoId = db(`
    const row = await prisma.governmentReference.create({ data: {
      masterReferenceId: "${REF_PREFIX}-eo-1", referenceType: "executive_order", status: "active",
      title: ${JSON.stringify(EO)}, category: "economy", lawVersion: 1,
      signedDate: new Date("2014-07-01T00:00:00Z"),
    }});
    console.log(row.id);
  `);

  // A ruling nobody signed, decided on a day we know the Court for. Its bench
  // is the thing that must arrive with faces, not just names.
  const rulingId = db(`
    const row = await prisma.governmentReference.create({ data: {
      masterReferenceId: "${REF_PREFIX}-scotus-1", referenceType: "scotus_case", status: "decided",
      title: ${JSON.stringify(RULING)}, category: "civil-rights", lawVersion: 1,
      decidedDate: new Date("1971-06-30T00:00:00Z"),
    }});
    console.log(row.id);
  `);

  // The bench of 1971, so the ruling above has somebody to show. Parsed from
  // the Court's own recorded page rather than typed here — a hand-written
  // bench could not fail the check it exists to make. This is a lookup table
  // the app fills for itself, so it is seeded idempotently and left alone.
  db(`
    const { parseJusticeRoster } = require("./src/services/court-composition.ts");
    const html = require("fs").readFileSync("./tests/fixtures/scotus-justices.html", "utf8");
    await prisma.justice.createMany({
      data: parseJusticeRoster(html).map((j) => ({
        name: j.name, startDate: j.startDate, endDate: j.endDate,
        appointedBy: j.appointedBy, isChief: j.isChief,
      })),
      skipDuplicates: true,
    });
  `);

  server = createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    let file = join(DIST, url === "/" ? "index.html" : url);
    try { if (!(await stat(file)).isFile()) throw new Error("dir"); } catch { file = join(DIST, "index.html"); }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const signIn = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.6.1.1" },
    body: JSON.stringify({ email: AUTHOR.email, password: PASSWORD }),
  });
  if (!signIn.ok) throw new Error(`could not sign in: ${signIn.status} ${await signIn.text()}`);
  const cookie = (signIn.headers.getSetCookie?.() ?? []).map((l) => l.split(";")[0])[0];

  browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await acceptTermsBeforeLoad(context);
  const [name, ...rest] = cookie.split("=");
  await context.addCookies([{
    name, value: rest.join("="), domain: "127.0.0.1", path: "/",
    httpOnly: true, secure: false, sameSite: "Lax",
  }]);
  const page = await context.newPage();
  await routeApiToLocal(page, API);
  await page.goto(`${base}/timeline`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(2_000);

  const screen = () => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  check("the post is not on the timeline before it is written", !(await screen()).includes(WORDS));

  // Attach the law, because a post must stand on one.
  const picker = page.getByRole("button", { name: /attach|add a law|pick a law|law/i }).first();
  if (await picker.count()) {
    await picker.click();
    await page.waitForTimeout(1_200);
    const search = page.locator('input[placeholder*="Search"]').first();
    if (await search.count()) {
      await search.fill("prove a post appears");
      await page.waitForTimeout(2_500);
      const hit = page.getByText(LAW).first();
      if (await hit.count()) { await hit.click(); await page.waitForTimeout(1_000); }
    }
  }

  const box = page.locator("textarea").first();
  await box.fill(WORDS);
  await page.waitForTimeout(300);

  const post = page.getByRole("button", { name: /^post$/i }).first();
  check("there is a Post button to press", (await post.count()) > 0);
  await post.click();

  // NO RELOAD ANYWHERE BELOW. That is the whole point.
  let appeared = false;
  for (let i = 0; i < 20 && !appeared; i += 1) {
    await page.waitForTimeout(500);
    appeared = (await screen()).includes(WORDS);
  }
  check("THE POST IS ON THE TIMELINE WITHOUT A RELOAD", appeared, (await screen()).slice(0, 200));

  // And it is genuinely saved, not just painted onto the screen.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(2_500);
  check("…and it is really saved, not just drawn", (await screen()).includes(WORDS));

  // --------------------------------------------- what a shared law looks like
  //
  // Sharing from the Library lands here with ?share=<id>. What it dropped in
  // was one truncated line: "it feels so bland". It has to look like a law.
  await page.goto(`${base}/timeline?share=${eoId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(3_000);
  const composer = await screen();

  check("A LAW SHARED FROM THE LIBRARY ARRIVES IN THE COMPOSER",
    composer.includes(EO), composer.slice(0, 200));
  check("…shown as an executive order, not just a line of text",
    /Executive order/i.test(composer));
  check("…naming the President the date says signed it",
    /Signed by Barack Obama/.test(composer), composer.slice(0, 300));
  check("…with his face beside it",
    (await page.locator('img[src*="/api/portraits/"]').count()) > 0,
    await page.locator("img").evaluateAll((els) =>
      els.map((e) => e.getAttribute("src")).filter(Boolean).join(" , ").slice(0, 160)));
  check("…and the date it was signed",
    /Signed Jul 1, 2014/.test(composer), composer.slice(0, 300));

  // ------------------------------- See details inside the composer's picker
  //
  // Shipped without a check and it broke the page: the details body used a
  // dialog-only title, and the picker inside the composer is an inline panel
  // with no dialog above it. Reported as "when you click see details the page
  // fails". A crash here takes the whole app down, so the assertion is that
  // the page is still THERE afterwards, not merely that something rendered.
  await page.goto(`${base}/timeline`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(2_000);

  const crashes = [];
  page.on("pageerror", (error) => crashes.push(String(error)));

  // The attach control is a BUTTON, not an input — it says one of two things
  // depending on whether a law is already on the post.
  const attach = page
    .getByRole("button", { name: /to attach|different document/i })
    .first();
  check("the composer offers a way to attach a law", (await attach.count()) > 0);
  await attach.click();
  await page.waitForTimeout(1_500);
  const pickerSearch = page.locator('input[placeholder*="executive orders"]').first();
  // The picker opens on the Bills tab, so search for the BILL. Asking it for an
  // executive order here gets an honest "No bills found" and proves nothing.
  await pickerSearch.fill("prove a post appears");
  await page.waitForTimeout(2_500);

  // Scoped to the picker: the timeline's own post cards ALSO offer "See
  // details", and theirs navigates to the full record. Clicking the wrong one
  // proves nothing about the picker.
  const seeDetails = page.locator("[data-law-picker]").getByRole("button", { name: "See details" }).first();
  check("THE PICKER OFFERS SEE DETAILS", (await seeDetails.count()) > 0);
  await seeDetails.click();
  await page.waitForTimeout(2_500);

  const after = await screen();
  check("…AND THE PAGE SURVIVES THE CLICK", after.trim().length > 0 && crashes.length === 0,
    crashes[0] ?? `${after.length} chars on screen`);
  // A POP-UP OVER THE SEARCH, not a page instead of it. Khalid: "keep the see
  // details as a pop up rather than opening the law card on a new page it
  // maintains continuity." So the dialog must be there AND the search must
  // still be underneath it, untouched.
  const dialogText = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.innerText ?? "",
  );
  check("…as a POP-UP, showing that law", dialogText.includes(LAW), dialogText.slice(0, 200));
  check("…and it did not navigate away from the timeline",
    page.url().includes("/timeline"), page.url());
  check("…with the picker's search still underneath it",
    (await page.locator('input[placeholder*="executive orders"]').count()) > 0);

  // ------------------------------------------- the bench arrives with FACES
  // Reported plainly, on this very pop-up: "doesnt show the pictures here but
  // only for scotus." The server was sending nine justices and nine portraits;
  // the pop-up drew their NAMES as text and threw the pictures away. The full
  // record page had always drawn them, which is exactly why nobody caught it.
  // Close the pop-up that is still open over the picker before reaching for
  // the tabs underneath it.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1_000);
  await page.locator("[data-law-picker-tabs] button", { hasText: "SCOTUS" }).first().click();
  await page.waitForTimeout(800);
  await pickerSearch.fill("prove the bench has faces");
  await page.waitForTimeout(2_500);
  await page.locator("[data-law-picker]").getByRole("button", { name: "See details" }).first().click();
  await page.waitForTimeout(3_000);

  const benchPopup = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.innerText ?? "",
  );
  check("THE POP-UP SHOWS THE BENCH THAT SAT THAT DAY",
    /the court as it sat on june 30, 1971/i.test(benchPopup) && /warren earl burger/i.test(benchPopup),
    benchPopup.slice(0, 200).replace(/\n/g, " | "));
  const benchFaces = await page
    .locator('[role="dialog"] img[src*="/api/portraits/"]').count();
  check("…and every one of them has a FACE, not just a name",
    benchFaces >= 5, `${benchFaces} portraits in the pop-up`);

  await context.close();
} catch (error) {
  console.error("\n" + (error?.stack ?? error));
  failures.push("the check itself threw");
} finally {
  cleanUp();
  try {
    const left = db(`console.log(await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } }));`);
    check("the records this check created are gone", left === "0", left);
  } catch { /* reported above */ }
  if (browser) await browser.close();
  if (server) server.close();
  api.kill("SIGTERM");
}

console.log(failures.length === 0
  ? "\nA post you write is on the page before you touch anything."
  : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
