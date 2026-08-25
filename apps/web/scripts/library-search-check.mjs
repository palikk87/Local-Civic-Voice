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
 *
 * AND ONE MORE, added later for a different bug. The Library used to open with
 * Congress preselected and search only the selected branch, so a reader typing
 * "immigration" got no executive orders and no court cases — two thirds of the
 * platform's own subject matter, excluded by a default nobody chose and with
 * nothing on screen to say so. It now opens on All and asks all three sources.
 * "Exactly one search" therefore means one search PER BRANCH, and that is what
 * the counting below is written against.
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

function executiveOrder(title) {
  return {
    title,
    type: "Presidential Document",
    subtype: "Executive Order",
    abstract: "",
    publication_date: "2026-03-02",
    signing_date: "2026-03-01",
    executive_order_number: "14385",
    president: "",
    agencies: [],
    html_url: "https://www.federalregister.gov/",
    document_number: "2026-04001",
  };
}

function courtCase(caseName) {
  return {
    id: 900001,
    case_name: caseName,
    court: "Supreme Court of the United States",
    date_filed: "2026-02-20",
    docket_number: "24-101",
    absolute_url: "/opinion/900001/",
  };
}

const server = createServer(async (req, res) => {
  const [path, rawQuery] = req.url.split("?");

  if (path === "/api/government/congress/search") {
    const term = new URLSearchParams(rawQuery ?? "").get("q") ?? "";
    searches.push({ branch: "congress", term });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ results: [bill(`Result for "${term}"`)] }));
  }
  if (path === "/api/government/executive/search") {
    const term = new URLSearchParams(rawQuery ?? "").get("q") ?? "";
    searches.push({ branch: "executive", term });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ results: [executiveOrder(`Order about "${term}"`)] }));
  }
  if (path === "/api/government/judicial/search") {
    const term = new URLSearchParams(rawQuery ?? "").get("q") ?? "";
    searches.push({ branch: "judicial", term });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ results: [courtCase(`Case about "${term}"`)] }));
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

/** Which branches were asked about a given term, sorted so order does not matter. */
function branchesAskedAbout(term) {
  return [...new Set(searches.filter((s) => s.term === term).map((s) => s.branch))].sort();
}

const ALL_THREE = ["congress", "executive", "judicial"];

// The Library opens on All, so the placeholder says so. If this selector ever
// needs changing again, the default changed with it, and that is the thing to
// look at rather than the selector.
const box = page.getByPlaceholder(/Search all three branches/i);
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

// 2. Enter submits — once, to each of the three sources.
await box.press("Enter");
await page.getByText('Result for "healthcare"').waitFor({ timeout: 15_000 });
check(
  "Enter fires exactly one search per branch",
  searches.length === 3,
  `searches=${JSON.stringify(searches)}`,
);
check(
  "and it reaches all three branches, not just Congress",
  JSON.stringify(branchesAskedAbout("healthcare")) === JSON.stringify(ALL_THREE),
  `asked=${JSON.stringify(branchesAskedAbout("healthcare"))}`,
);

// The executive order and the court case have to be ON SCREEN, not merely
// requested. A search that fetches three branches and renders one is the same
// bug wearing a network tab.
await page.getByText('Order about "healthcare"').waitFor({ timeout: 15_000 });
await page.getByText('Case about "healthcare"').waitFor({ timeout: 15_000 });
check("the executive order is shown", true);
check("and so is the court case", true);

// 3. Typing more does NOT disturb the results already on screen.
await box.pressSequentially(" reform", { delay: 60 });
await page.waitForTimeout(1200);
check("typing after a search leaves results alone", searches.length === 3,
  `searches=${JSON.stringify(searches)}`);
check(
  "the previous results are still the ones shown",
  await page.getByText('Result for "healthcare"').isVisible(),
);

// 4. The button does the same job as Enter.
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.getByText('Result for "healthcare reform"').waitFor({ timeout: 15_000 });
check("the Search button submits", searches.length === 6, `searches=${JSON.stringify(searches)}`);
check(
  "with the current text, to all three again",
  JSON.stringify(branchesAskedAbout("healthcare reform")) === JSON.stringify(ALL_THREE),
  `asked=${JSON.stringify(branchesAskedAbout("healthcare reform"))}`,
);

// 5. Narrowing is still possible — a tab restricts the search to one source.
searches.length = 0;
await page.getByRole("button", { name: "Congress", exact: true }).click();
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.waitForTimeout(1500);
check(
  "choosing a branch narrows the search to that branch",
  searches.length === 1 && searches[0]?.branch === "congress",
  `searches=${JSON.stringify(searches)}`,
);

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe Library searches all three branches when asked, and never on its own.");
