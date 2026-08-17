/**
 * Renders the PRODUCTION build in a real browser and fails on any console
 * error, page error, or empty #root.
 *
 *   bun run render-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. A chunking mistake does not fail the build. An earlier
 * `manualChunks` rule split React away from the libraries that depend on it,
 * which built perfectly green and then white-screened in production with
 * "Cannot read properties of undefined (reading 'forwardRef')". Nothing in
 * typecheck, lint or build catches that class of failure — only executing the
 * bundle does.
 *
 * It also prints the JS chunk count per route, which is the number that
 * mattered when ~40 single-icon chunks were stalling first paint by seconds.
 *
 * /api is answered with 503 on purpose: this checks that the app BOOTS, and an
 * unreachable API must not be mistaken for a broken bundle.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2];
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  // Never proxy /api — the point is to see the app boot, and an unreachable
  // API must not be mistaken for a bundle failure.
  if (url.startsWith("/api/")) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end('{"error":"api not served in this check"}');
  }
  let file = join(DIST, url === "/" ? "index.html" : url);
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
  } catch {
    file = join(DIST, "index.html"); // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium();
const problems = [];
const chunkRequests = new Set();

for (const path of ["/", "/discover", "/government", "/people"]) {
  const page = await browser.newPage();
  await routeApiToLocal(page, base);
  page.on("console", (m) => {
    if (m.type() === "error" && !/503|Failed to load resource|api not served/i.test(m.text())) {
      problems.push(`${path} console: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`${path} pageerror: ${e.message}`));
  page.on("request", (r) => { if (/\/assets\/.*\.js$/.test(r.url())) chunkRequests.add(`${path} ${r.url().split("/").pop()}`); });

  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  const text = (await page.locator("body").innerText()).trim();
  const rootChildren = await page.evaluate(() => document.getElementById("root")?.childElementCount ?? 0);

  if (rootChildren === 0) problems.push(`${path}: #root is empty (white screen)`);
  if (text.length < 20) problems.push(`${path}: rendered only ${text.length} chars of text`);
  if (/Loading Civic Voice/.test(text) && text.length < 40) problems.push(`${path}: stuck on the loading screen`);

  console.log(`${path.padEnd(12)} root children=${rootChildren} text=${text.length} chars  js chunks=${[...chunkRequests].filter(c=>c.startsWith(path+" ")).length}`);
  await page.close();
}

await browser.close();
server.close();

if (problems.length) {
  console.error("\nFAILURES:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log("\nAll routes rendered with no console or page errors.");
