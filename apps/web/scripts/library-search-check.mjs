/**
 * Proves the Library searches when you ask it to, and not before.
 *
 *   bun run library-search-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The search ran itself 450ms after you stopped typing. Four
 * complaints came out of that one decision: there was no submit button, Enter
 * did nothing, results appeared before anyone had asked for them, and because
 * the timer refired on every pause the list kept changing under the reader.
 *
 * Typing is not a request. These four cases pin that:
 *
 *   1. Typing a whole query fires NO request. Not one.
 *   2. Pressing Enter fires exactly one, for what was typed.
 *   3. Clicking Search does the same thing as Enter.
 *   4. Continuing to type after a search leaves the results alone.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

/** Every search the page asked for, in order, with the term it asked about. */
const searches = [];

function bill(title) {
  return {
    congress: 119,
    type: "HR",
    number: "4836",
    title,
    latestAction: { text: "Referred to committee.", actionDate: "2026-03-01" },
    sourceUrl: "https://www.congress.gov/",
  };
}

const server = createServer(async (req, res) => {
  const [path, rawQuery] = req.url.split("?");

  if (path === "/api/government/congress/search") {
    const term = new URLSearchParams(rawQuery ?? "").get("q") ?? "";
    searches.push(term);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ results: [bill(`Result for "${term}"`)] }));
  }
  if (path.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"results":[]}');
  }

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

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium();
const failures = [];

function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await routeApiToLocal(page, base);
await page.goto(`${base}/library`, { waitUntil: "networkidle" });

const box = page.getByPlaceholder(/Search bills/i);
await box.waitFor({ timeout: 15_000 });

// 1. Typing asks for nothing. The old build had already run two searches by here.
await box.pressSequentially("healthcare", { delay: 60 });
await page.waitForTimeout(1200); // comfortably past the old 450ms debounce
check("typing fires no search", searches.length === 0, `searches=${JSON.stringify(searches)}`);
check(
  "and nothing has pre-populated",
  !(await page.getByText(/Result for/).count()),
  "results visible before asking",
);

// 2. Enter submits.
await box.press("Enter");
await page.getByText('Result for "healthcare"').waitFor({ timeout: 15_000 });
check("Enter fires exactly one search", searches.length === 1, `searches=${JSON.stringify(searches)}`);
check("for what was typed", searches[0] === "healthcare", `got ${JSON.stringify(searches[0])}`);

// 3. Typing more does NOT disturb the results already on screen.
await box.pressSequentially(" reform", { delay: 60 });
await page.waitForTimeout(1200);
check("typing after a search leaves results alone", searches.length === 1,
  `searches=${JSON.stringify(searches)}`);
check(
  "the previous results are still the ones shown",
  await page.getByText('Result for "healthcare"').isVisible(),
);

// 4. The button does the same job as Enter.
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.getByText('Result for "healthcare reform"').waitFor({ timeout: 15_000 });
check("the Search button submits", searches.length === 2, `searches=${JSON.stringify(searches)}`);
check("with the current text", searches[1] === "healthcare reform", `got ${JSON.stringify(searches[1])}`);

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe Library searches when asked, and never on its own.");
