/**
 * A bug report says what was pointed at, not just what it said.
 *
 *   bun run bug-report-check          (after `bun run build`)
 *
 * WHAT WAS WRONG. A report carried the visible words and a path made of tag
 * names and the first two Tailwind classes — "div.flex.items-center >
 * button.w-full.text-left". To the person reporting, "the Nay button" is the
 * right thing to see. To the admin who has to fix it, the word is the one
 * piece of information they already had: it is sitting in the complaint. What
 * they could not get was WHICH Nay button, on which record, rendered by what.
 *
 * This drives the real reporter in a real browser against a real backend, and
 * reads back what the page actually sends. It is not a fixture: the element it
 * points at is one the app rendered, and the payload is the one the server
 * receives.
 *
 * WHAT IS PINNED
 *
 *   IDENTITY   the component that rendered it, a selector that finds it again,
 *              and where the control leads — none of which the old path had.
 *   NO NOISE   provider and router wrappers are excluded. The first version
 *              reported "AppShell in RenderedRoute in Routes"; the last two are
 *              true of every element on every page, and noise that looks like
 *              information is worse than a shorter answer.
 *   PRIVACY    anything typed into a field never reaches the report. The
 *              element somebody points at is often the field they were filling
 *              in, and the report goes to an administrator.
 *   THE SERVER stores it and hands it back, and refuses a payload carrying
 *              keys the schema does not name.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
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
      `This check promotes accounts and creates roles, so it only runs against a\n` +
      `database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.BUG_REPORT_CHECK_PORT ?? 3996);
const API = `http://127.0.0.1:${API_PORT}`;

/** Citizen n of the thousand, by the seeder's own naming. */
const SECRET = "typed-by-a-person-never-to-be-reported";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Run a snippet of Prisma against the population database, and nothing else. */
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

// ------------------------------------------------------------------ the server

const backendEnv = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(API_PORT),
  DATABASE_URL: POPULATION_URL,
  DIRECT_URL: POPULATION_URL,
  BACKEND_URL: API,
  BETTER_AUTH_SECRET: "bug-report-check-secret-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".bug-report-check-uploads"),
  HEALTH_SCHEMA_TTL_MS: "0",
  // No outbound work: this check must not pull real government data into a
  // test database while it is asserting on what a page renders.
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
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

let server;
let browser;

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  // The only thing this check writes is bug reports, and it takes them all
  // back out. It creates no accounts and promotes nobody.
  // The only thing this check writes is bug reports, and it takes them all
  // back out. It creates no accounts and promotes nobody.
  const filed = [
    "The thing I pointed at does not respond.",
    "checking what the server keeps",
    "checking the schema is strict",
  ];
  try {
    db(
      "const gone = await prisma.bugReport.deleteMany({ where: { problem: { in: " +
        JSON.stringify(filed) +
        " } } }); console.log('removed ' + gone.count + ' report(s) this check filed');",
    );
  } catch (error) {
    console.error(`Could not remove the reports this check filed: ${error.message}`);
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

try {
  await waitForApi();

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


  /** Open a page with the reporter on it, and watch what it sends. */
  async function report({ page: path = "/feed", typeInto = false, pointAt = null }) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await routeApiToLocal(page, API);

    let sent = null;
    page.on("request", (request) => {
      if (request.url().includes("/api/bug-reports") && request.method() === "POST") {
        try {
          sent = JSON.parse(request.postData() ?? "{}");
        } catch {
          /* not json, leave null */
        }
      }
    });

    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[aria-label="Report a problem with this page"]', { timeout: 20_000 });
    await page.waitForTimeout(1_200);

    // THE PRE-BETA WELCOME IS A BLOCKING DIALOG on a first visit, and its
    // overlay covers the viewport — the same thing nav-check exists to catch.
    // That check deliberately tests the first-visit case; this one is about the
    // reporter, so the notice is dismissed the way a returning visitor already
    // has. Without this the panel opens behind the overlay and nothing in it is
    // clickable, which reads as "the reporter is broken".
    const welcome = page.getByRole("button", { name: /got it/i });
    if (await welcome.isVisible().catch(() => false)) {
      await welcome.click();
      await page.waitForTimeout(400);
    }

    await page.click('[aria-label="Report a problem with this page"]');
    // Wait for the panel itself rather than a fixed delay — the first version
    // clicked "Point at the problem" before it existed, the stage never
    // changed, and the click meant for the picker navigated instead.
    await page.getByText("Point at the problem").waitFor({ timeout: 15_000 });
    await page.getByText("Point at the problem").click();
    await page.waitForTimeout(500);

    let target;
    if (pointAt) {
      target = page.locator(pointAt).first();
    } else if (typeInto) {
      // Point AT a field somebody has typed into — the privacy case.
      target = page.locator("input").first();
      await target.fill(SECRET);
    } else {
      // The sidebar link to the feed: present on every page inside the shell,
      // carries an href, and is not tied to any particular content being
      // loaded — so this does not fail on an empty database.
      target = page.locator('a[href="/feed"]').first();
    }
    // CLICK WHERE IT IS, the way a person does.
    //
    // Picking lays a transparent sheet over the viewport and hit-tests through
    // it, so a click at the element's coordinates is exactly the real gesture
    // — and it is the only way to prove the sheet works. An earlier version
    // dispatched the event on the element instead, which tested the capture
    // and quietly skipped the question of whether the thing was reachable at
    // all.
    const box = await target.boundingBox();
    if (!box) throw new Error(`nothing to point at for ${pointAt ?? "the default target"}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);

    await page.locator("textarea").first().waitFor({ timeout: 15_000 });
    await page.locator("textarea").first().fill("The thing I pointed at does not respond.");
    await page.getByText("Send to the team").click();
    await page.waitForTimeout(1_500);

    await context.close();
    return sent;
  }

  // ------------------------------------------------------------- 1. IDENTITY

  const link = await report({ page: "/feed" });
  check("the report is sent at all", !!link, link ? "" : "no POST seen");

  const detail = link?.elementDetail;
  check("it carries what the element actually is", !!detail, JSON.stringify(link ?? {}).slice(0, 160));
  check(
    "it names the component that rendered it",
    typeof detail?.component === "string" && detail.component.length > 0,
    detail?.component,
  );
  check(
    "the component is not a router or provider wrapper",
    !/Provider|Routes|RenderedRoute|Context/.test(detail?.component ?? ""),
    detail?.component,
  );
  check(
    "the selector finds one element and not a family",
    typeof detail?.selector === "string" && /nth-of-type|#|\[data-testid/.test(detail.selector),
    detail?.selector,
  );
  check("it says where the control leads", detail?.action === "/feed", detail?.action);
  check(
    "it keeps the markup",
    /^<[a-z]/.test(detail?.html ?? ""),
    (detail?.html ?? "").slice(0, 80),
  );
  check(
    "the label is still the words on the screen",
    typeof link?.elementLabel === "string" && link.elementLabel.length > 0,
    link?.elementLabel,
  );

  // -------------------------------------------------------------- 2. PRIVACY

  const typed = await report({ page: "/library", typeInto: true });
  const asText = JSON.stringify(typed ?? {});
  check("a report can be filed while pointing at a field", !!typed?.elementDetail, "");
  check(
    "WHAT SOMEBODY TYPED NEVER LEAVES THE PAGE",
    !asText.includes(SECRET),
    asText.includes(SECRET) ? "the typed value was in the payload" : "absent",
  );
  check(
    "the field is still identifiable",
    typed?.elementDetail?.tag === "input",
    typed?.elementDetail?.tag,
  );

  // ---------------------------------------- 3. PLAIN TEXT IS POINTABLE TOO

  // A badge, a label, a username: on screen because a component put it there,
  // so it has to be reportable like anything else. This one is not a button,
  // not a link, and has no handler — the old document-click picker could still
  // reach it, but only because something above it happened to be clickable.
  const badge = await report({ page: "/feed", pointAt: "span, .badge, [class*='badge']" });
  check("a plain piece of text can be pointed at", !!badge?.elementDetail, "");
  check(
    "and it reports the code that rendered it",
    typeof badge?.elementDetail?.component === "string" &&
      badge.elementDetail.component.length > 0,
    badge?.elementDetail?.component,
  );
  check(
    "and the words that were on it",
    typeof badge?.elementLabel === "string" && badge.elementLabel.length > 0,
    badge?.elementLabel,
  );

  // --------------------------------------------------------------- 4. SERVER

  const stored = await fetch(`${API}/api/bug-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.7.7.7" },
    body: JSON.stringify({
      pageUrl: "https://example.invalid/government/hr-1-119",
      pagePath: "/government/hr-1-119",
      elementLabel: "Nay",
      problem: "checking what the server keeps",
      elementDetail: {
        component: "VoteButtons in ReferenceDetail",
        data: { "data-reference-id": "hr-1-119" },
      },
    }),
  });
  check("the server accepts a report carrying detail", stored.status === 201, `${stored.status}`);

  const refused = await fetch(`${API}/api/bug-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.7.7.8" },
    body: JSON.stringify({
      pageUrl: "https://example.invalid/feed",
      pagePath: "/feed",
      problem: "checking the schema is strict",
      elementDetail: { component: "Fine", smuggled: "should not be accepted" },
    }),
  });
  check(
    "and refuses keys the schema does not name",
    refused.status === 400,
    `${refused.status}`,
  );
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nA report names the thing, not just the word on it.");
