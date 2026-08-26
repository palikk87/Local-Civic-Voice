/**
 * What a person sees when the API host is gone.
 *
 *   node scripts/backend-down-check.mjs <mode> [dist]
 *
 *     gone       nothing is listening — the container was deleted or stopped
 *     suspended  the edge answers 404 HTML — the project is unpaid or unclaimed
 *     up         something real is listening — the container moved and works
 *
 * NOTHING IS MOCKED. The bundle is built pointing at a fixed local port and
 * that port is genuinely empty, genuinely serving a refusal page, or genuinely
 * serving the backend. The browser produces its own ECONNREFUSED. A test that
 * fakes the failure can only prove the fake was handled.
 *
 * It answers one question per route: with the API in this state, is there
 * anything on the screen, and does it say what is wrong. A blank page and a
 * page reading "we cannot reach the server" both "work" to a typecheck and are
 * completely different to the person holding the phone.
 */
import { launchChromium } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const MODE = process.argv[2] ?? "gone";
const DIST = process.argv[3] ?? "dist";
const API_PORT = 59999;                       // baked into the bundle at build time

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

async function routes() {
  const src = await readFile("src/App.tsx", "utf8");
  const found = [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(found)]
    .filter((p) => p !== "*")
    .map((p) => p.replace(/:tab\b/g, "overview").replace(/:id\b/g, "e2e-nonexistent-id").replace(/:[A-Za-z]+/g, "e2e-nonexistent"));
}

/** Static host for the built site. Stands in for Vercel, which does not go down with the API. */
const site = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  let file = join(DIST, path === "/" ? "index.html" : path.slice(1));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html");                 // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

/** Railway's edge when a project is suspended or the domain is unclaimed. */
const RAILWAY_404 = `<html><head><title>Application not found</title></head><body><h1>Application not found</h1><p>The requested application could not be found.</p></body></html>`;
let edge = null;
if (MODE === "suspended") {
  edge = createServer((req, res) => {
    res.writeHead(404, { "content-type": "text/html" });
    res.end(RAILWAY_404);
  });
  await new Promise((r) => edge.listen(API_PORT, "127.0.0.1", r));
}

await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;

const browser = await launchChromium();
const list = await routes();
const rows = [];

for (const route of list) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const errors = [];
  const apiCalls = { attempted: 0, failed: 0 };
  page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
  page.on("requestfailed", (r) => { if (r.url().includes(`:${API_PORT}`)) apiCalls.failed++; });
  page.on("request", (r) => { if (r.url().includes(`:${API_PORT}`)) apiCalls.attempted++; });

  let text = "";
  try {
    await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(3500);            // let queries run, retry, and settle
    text = (await page.evaluate(() => document.body.innerText || "")).replace(/\s+/g, " ").trim();
  } catch (e) {
    errors.push(`navigation: ${String(e.message).split("\n")[0]}`);
  }

  const lower = text.toLowerCase();
  const SAYS_SOMETHING_IS_WRONG = [
    "unable", "cannot reach", "can't reach", "couldn't", "could not", "failed",
    "try again", "offline", "something went wrong", "error", "unavailable",
    "no connection", "check your connection", "retry",
  ];
  rows.push({
    route,
    chars: text.length,
    errors: errors.length,
    firstError: errors[0] ?? "",
    apiAttempted: apiCalls.attempted,
    apiFailed: apiCalls.failed,
    explains: SAYS_SOMETHING_IS_WRONG.some((p) => lower.includes(p)),
    sample: text.slice(0, 140),
  });

  await context.close();
}

await browser.close();
site.close();
edge?.close();

const blank = rows.filter((r) => r.chars < 40);
const silent = rows.filter((r) => r.chars >= 40 && !r.explains);
const explains = rows.filter((r) => r.explains);
const threw = rows.filter((r) => r.errors > 0);

console.log(`\nMODE: ${MODE}   routes: ${rows.length}\n`);
for (const r of rows) {
  const verdict = r.chars < 40 ? "BLANK  " : r.explains ? "EXPLAINS" : "SILENT ";
  console.log(`${verdict} ${String(r.chars).padStart(5)}c  api ${String(r.apiFailed).padStart(2)}/${String(r.apiAttempted).padStart(2)} failed  ${r.errors ? "THREW " : "      "} ${r.route}`);
  if (r.errors) console.log(`         ↳ ${r.firstError}`);
  console.log(`         ↳ ${r.sample}`);
}
console.log(`\n  blank (nothing on screen):     ${blank.length}`);
console.log(`  silent (content, no warning):  ${silent.length}`);
console.log(`  explains (tells the user):     ${explains.length}`);
console.log(`  threw a javascript error:      ${threw.length}`);
console.log(JSON.stringify({ mode: MODE, rows }, null, 2).slice(0, 0));
await (await import("node:fs/promises")).writeFile(
  process.env.REPORT_JSON ?? `/tmp/backend-down-${MODE}.json`,
  JSON.stringify({ mode: MODE, rows }, null, 2),
);
