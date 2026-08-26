/**
 * Signing in while the API host is gone.
 *
 *   node scripts/backend-down-signin.mjs [dist]
 *
 * The route check reads pages that only fetch. This one presses the button.
 * A person whose session could not be checked is shown "Sign in to continue",
 * so the very next thing they do is type their password into a form whose
 * server is not there — and what that form says back is the last thing standing
 * between them and "this app is broken and I don't know why".
 *
 * Nothing is listening on the port the bundle points at. Real refusal.
 */
import { launchChromium } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const API_PORT = 59999;   // the port the bundle was built against, and nothing is on it
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const site = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  let file = join(DIST, path === "/" ? "index.html" : path.slice(1));
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); }
  catch { file = join(DIST, "index.html"); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;

const browser = await launchChromium();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
// Counted so a silent screen cannot be confused with a click that never landed.
const api = { attempted: 0, failed: 0 };
page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0]));
const apiUrls = [];
page.on("request", (r) => {
  if (!r.url().includes(`:${API_PORT}`)) return;
  api.attempted++;
  apiUrls.push(`${r.method()} ${new URL(r.url()).pathname}`);
});
page.on("requestfailed", (r) => { if (r.url().includes(`:${API_PORT}`)) api.failed++; });

await page.goto(`${base}/auth`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const before = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();

// Fill by position rather than by a guessed name: this page's identifier field
// accepts a username too, so it is not necessarily type=email. A silent fill
// failure would leave the form empty and make client-side validation look like
// a broken button, so both values are read back and the run aborts if either
// did not land.
const textInputs = page.locator('input:not([type="hidden"])');
const count = await textInputs.count();
if (count < 2) throw new Error(`expected an identifier and a password field, found ${count} inputs`);
await textInputs.nth(0).fill("reader@example.com");
await textInputs.nth(1).fill("correct-horse-battery-staple");

const filled = [await textInputs.nth(0).inputValue(), await textInputs.nth(1).inputValue()];
if (!filled[0] || !filled[1]) throw new Error(`the form did not accept input: ${JSON.stringify(filled)}`);
console.log(`FORM FILLED: identifier=${filled[0]}, password=${filled[1].length} chars`);
// Everything the page asked for before the button was pressed, so a request
// fired by the click cannot be confused with the session check on page load.
const beforeClick = api.attempted;

const seenToasts = new Set();
const collect = async () => {
  const texts = await page
    .locator('[role="status"], [data-sonner-toast], [role="alert"], .toast')
    .allInnerTexts()
    .catch(() => []);
  for (const t of texts) if (t.trim()) seenToasts.add(t.replace(/\s+/g, " ").trim());
};

await page.getByRole("button", { name: /sign in/i }).first().click().catch((e) => errors.push(`click: ${e.message.split("\n")[0]}`));
// Toasts appear and vanish; watch the whole window rather than sampling the end.
for (let i = 0; i < 32; i++) { await collect(); await page.waitForTimeout(250); }

const after = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ").trim();
const buttonState = await page
  .getByRole("button", { name: /sign in|signing/i })
  .first()
  .innerText()
  .catch(() => "(gone)");

console.log(`\nBEFORE SUBMIT:\n  ${before.slice(0, 300)}\n`);
console.log(`AFTER SUBMIT (6s later):\n  ${after.slice(0, 500)}\n`);
console.log(`SUBMIT BUTTON NOW READS: "${buttonState}"`);
console.log(`CHANGED: ${before !== after}`);
console.log(`API REQUESTS BEFORE THE CLICK: ${beforeClick}`);
console.log(`API REQUESTS CAUSED BY THE CLICK: ${api.attempted - beforeClick}`);
console.log(`ALL API REQUESTS: ${apiUrls.join(", ") || "(none)"}`);
console.log(`API REQUESTS THAT FAILED: ${api.failed}`);
console.log(`JS ERRORS: ${errors.length}${errors.length ? " — " + errors[0] : ""}`);

// A toast may have come and gone; capture whatever is in the live DOM too.
console.log(`ANYTHING THE APP SAID (toasts seen over 8s): ${JSON.stringify([...seenToasts])}`);

await browser.close();
site.close();
