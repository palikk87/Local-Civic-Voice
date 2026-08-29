/**
 * THE BUG QUEUE CAN LEAVE THE BUG QUEUE.
 *
 *   bun run bug-report-export-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Reports were readable one card at a time and nowhere else.
 * Getting the list to somebody who could act on it meant retyping it, so in
 * practice nobody did, and the queue became a place reports went rather than a
 * place they came from. One button now puts every report in the current filter
 * on the clipboard as plain text.
 *
 * WHAT THIS CHECKS, and why a string match on the source would not do: that
 * clicking the real button in a real browser puts the real text on the real
 * clipboard, with the fields that make a report actionable — where they were,
 * what they pointed at and what it actually was, both of their answers, the
 * viewport and the commit. A button that renders and does nothing is the exact
 * failure this is here to catch.
 *
 * The reports below are invented, and that is correct HERE and only here: they
 * are the input to a formatter, not content shown to anybody as fact. Nothing
 * in this file reaches a database or a screen a reader will see.
 */
import { launchChromium, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const REPORTS = [
  {
    id: "rep_one",
    username: "khalid",
    pageUrl: "https://ayeandnay.com/reference/abc123",
    pagePath: "/reference/abc123",
    elementLabel: "the Aye button",
    elementPath: "main > div > button:nth-of-type(1)",
    elementDetail: {
      component: "VotePanel",
      control: "button",
      action: "castVote",
      tag: "button",
      selector: "[data-testid='vote-aye']",
      data: { referenceId: "abc123", stance: "support" },
    },
    problem: "Pressing it sent me back to the top of the page",
    wanted: "Stay where I was",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    viewport: "390x844",
    appCommit: "4d889bfaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "open",
    adminNote: null,
    resolvedBy: null,
    createdAt: "2026-08-29T12:00:00.000Z",
  },
  {
    id: "rep_two",
    username: null,
    pageUrl: "https://ayeandnay.com/library",
    pagePath: "/library",
    elementLabel: null,
    elementPath: null,
    elementDetail: null,
    problem: "Search found nothing for a bill I know exists",
    // Deliberately unanswered: the export has to say so rather than leave a
    // blank somebody has to interpret.
    wanted: null,
    userAgent: null,
    viewport: "1440x900",
    appCommit: null,
    status: "open",
    adminNote: null,
    resolvedBy: null,
    createdAt: "2026-08-29T13:30:00.000Z",
  },
];

const ADMIN = {
  session: {
    token: "test-admin-token",
    role: "superadmin",
    username: "tester",
    capabilities: ["bugReports.manage"],
  },
  isAdminAuthenticated: true,
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(null);
  if (path === "/api/admin/bug-reports") {
    return json({ reports: REPORTS, total: REPORTS.length, openCount: REPORTS.length });
  }
  if (path.startsWith("/api/")) {
    return json({ results: [], reports: [], data: [], items: [], count: 0, hasMore: false, nextCursor: null });
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
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
const failures = [];

await acceptTermsBeforeLoad(page);
await page.addInitScript((admin) => {
  try {
    localStorage.setItem("admin-store", JSON.stringify({ state: admin, version: 0 }));
  } catch { /* a browser with storage disabled is not what this is testing */ }
}, ADMIN);

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.host === new URL(base).host) return route.continue();
  try {
    const response = await page.request.fetch(`${base}${url.pathname}${url.search}`, {
      method: route.request().method(),
      headers: route.request().headers(),
      failOnStatusCode: false,
    });
    return await route.fulfill({ response });
  } catch {
    try { return await route.abort(); } catch { /* page gone */ }
  }
});

await page.goto(`${base}/admin/bug-reports`, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(2000);

// The queue has to be on screen before the button means anything.
const listed = await page.getByText("Pressing it sent me back to the top").count();
if (!listed) failures.push("the bug queue did not render, so the export could not be exercised");

const button = page.getByRole("button", { name: /copy all/i });
if (!(await button.count())) {
  failures.push("no Copy all button on the bug reports tab");
} else {
  await button.first().click();
  await page.waitForTimeout(700);

  const copied = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText(); } catch { return ""; }
  });

  if (!copied) {
    failures.push("Copy all put nothing on the clipboard");
  } else {
    // Every field a report needs to be actionable without a round trip.
    const required = [
      ["both reports", "rep_one"],
      ["the second report too", "rep_two"],
      ["the page path", "/reference/abc123"],
      ["what they pointed at", "the Aye button"],
      ["the component that rendered it", "VotePanel"],
      ["the record it was showing", "abc123"],
      ["their complaint", "Pressing it sent me back to the top"],
      ["what they wanted", "Stay where I was"],
      ["an unanswered second question, said plainly", "(not answered)"],
      ["the viewport", "390x844"],
      ["the commit", "4d889bf"],
      ["a signed-out reporter, named as such", "signed-out visitor"],
    ];
    for (const [what, needle] of required) {
      if (!copied.includes(needle)) failures.push(`the export is missing ${what} (${JSON.stringify(needle)})`);
    }
    // A full sha in an export is noise; the short one is what gets pasted.
    if (copied.includes("4d889bfaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")) {
      failures.push("the export prints the full commit sha rather than the short one");
    }
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} problem(s) with the bug report export:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("Copy all exports every report in the filter, with the fields that make one actionable.");
