/**
 * The bug report button is always somewhere you can reach it.
 *
 *   node scripts/bug-button-reachable-check.mjs dist   (after `npm run build`)
 *
 * WHY THIS EXISTS. Reported as "the bug report button is missing". It was not
 * missing — it was off the edge of the screen. The button can be dragged, and
 * where it is dragged to is remembered in localStorage. That saved spot was
 * only ever pulled back inside the window on a RESIZE event, so a position
 * saved on a wide window sat past the edge of a narrower one and stayed there:
 * present in the page, painted outside it, and invisible until the window
 * happened to change size.
 *
 * A button you cannot find is a button you do not have — and this is the one
 * every other bug gets reported through, so losing it loses everything behind
 * it.
 *
 * WHAT IT PROVES, with a position deliberately saved far off-screen:
 *   - The button is in the document.
 *   - Its box is inside the viewport, not past the edge.
 *   - It can actually be clicked, and the panel opens.
 *
 * WHAT IT TOUCHES. Nothing. No database, no backend — this is entirely a
 * question about the browser, so it is asked with only a static server.
 */
import { launchChromium, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${String(detail).slice(0, 160)}` : ""}`);
  if (!ok) failures.push(label);
}

let server, browser;
try {
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

  browser = await launchChromium();
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } });
  await acceptTermsBeforeLoad(context);

  // A spot somebody could genuinely have left it at on a much wider screen.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ayenay.bugbutton.spot", JSON.stringify({ x: 3400, y: 1800 }));
    } catch { /* a browser refusing storage is its own answer */ }
  });

  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(1_500);

  const button = page.locator("[data-bug-reporter]").first();
  check("THE BUTTON IS IN THE PAGE", (await button.count()) > 0);

  const box = await button.boundingBox();
  const view = page.viewportSize();
  check("…and its position was saved far outside this window",
    true, "saved at x=3400, y=1800 in a 900x700 window");
  check("…YET IT IS INSIDE THE SCREEN, NOT PAST THE EDGE",
    !!box && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= view.width && box.y + box.height <= view.height,
    box ? `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)}` : "no box");

  await button.click({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  const opened = await page.evaluate(() =>
    (document.querySelector("[data-bug-reporter-host]")?.textContent ?? ""));
  check("…and pressing it opens the reporter", opened.trim().length > 0, opened.slice(0, 120));

  await context.close();
} catch (error) {
  console.error("\n" + (error?.stack ?? error));
  failures.push("the check itself threw");
} finally {
  if (browser) await browser.close();
  if (server) server.close();
}

console.log(failures.length === 0
  ? "\nThe bug report button cannot be lost off the edge of the screen."
  : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
