/**
 * Proves the Related Laws tab renders, on both kinds of bill.
 *
 *   bun run related-laws-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. A parity audit reported the relatedLaws seed content as
 * missing. It was not — all 21 entries across 16 bills were in the repo the
 * whole time. What was missing was anything that could reach them, so the tab
 * rendered its empty state and the data looked absent from outside. That is a
 * failure mode no amount of grepping the source would have settled, and only
 * rendering the page does.
 *
 * Two cases, and both matter:
 *
 *   1. A bill the API does not have falls through to the local list, and its
 *      Related tab shows populated cards.
 *   2. A bill the API DOES have wins, and its empty relatedLaws renders the
 *      empty state without error — the live record must always beat the
 *      fallback. The version of this lookup that had to be deleted searched the
 *      local array first and disabled the real fetch, so a live record could
 *      never win. That is the regression this second case guards.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

/**
 * The id the API knows about. Everything else 404s, as it would in production.
 *
 * Deliberately an id that is ALSO in the local list. An id present in only one
 * place cannot tell you which one the page preferred — the first version of
 * this check used a made-up id here, and reversing the lookup order left it
 * passing. Serving hr-82 from the API means the two sources disagree, and the
 * assertions below say which must win.
 */
const LIVE_ID = "hr-82";

const LIVE_REFERENCE = {
  id: LIVE_ID,
  masterReferenceId: "hr-4836-119",
  displayId: "H.R. 4836",
  referenceType: "bill",
  title: "The API copy of this bill, which must win",
  shortTitle: "API Copy",
  status: "committee",
  category: "healthcare",
  chamber: "house",
  congress: 119,
  sourceUrl: "https://www.congress.gov/",
  description: "Reported out of committee.",
  citizenBrief: null,
  citizenBriefSections: null,
  citizenBriefLabels: { goal: "The Goal", wallet: "The Wallet", debate: "The Debate" },
  citizenBriefAt: null,
  citizenBriefVersion: null,
  lawVersion: 1,
  lawChangedAt: null,
  contentStatus: "ready",
  fullText: "SECTION 1. SHORT TITLE.",
  fullTextSource: "congress.gov/text",
  fullTextUrl: "https://www.congress.gov/",
  fullTextAt: new Date().toISOString(),
  sourceCheckedAt: new Date().toISOString(),
  signedDate: null,
  decidedDate: null,
  aliases: [],
  votes: { support: 0, oppose: 0, total: 0 },
  engagement: { comments: 0, shares: 0, posts: 0 },
  userVote: null,
  createdAt: new Date().toISOString(),
};

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  const ref = /^\/api\/government-references\/([^/]+)$/.exec(url);
  if (ref) {
    if (ref[1] === LIVE_ID) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ reference: LIVE_REFERENCE }));
    }
    res.writeHead(404, { "content-type": "application/json" });
    return res.end('{"error":"Reference not found"}');
  }
  if (url.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{}");
  }

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

await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const failures = [];

/** Open a bill, switch to Related, and report what the panel contains. */
async function inspect(id) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Uncaught exceptions only.
  //
  // Deliberately NOT every console error: the 404 in case 1 is the whole point
  // of case 1, and this harness has no outbound network, so avatar and font
  // requests reset. Counting those would make the check fail for reasons that
  // have nothing to do with what it is measuring.
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(`${base}/bill/${id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Related" }).click();
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      heading: text.includes("Related Laws"),
      empty: /No related laws|no related laws/i.test(text),
      // Relationship labels are rendered per card; count them as a proxy for
      // "cards are on screen" without coupling to class names.
      cards: (text.match(/\b(amends|references|supports)\b/gi) ?? []).length,
      notFound: text.includes("Bill not found"),
      // Which source won, readable from the page itself.
      apiTitle: text.includes("The API copy of this bill, which must win"),
    };
  });

  await page.close();
  return { ...result, consoleErrors };
}

// --- Case 1: a bill in the local list that the API does not have
const DEMO_ID = "hr-6234";
const demo = await inspect(DEMO_ID);
console.log(
  `${DEMO_ID} (404 from API)  heading=${demo.heading} cards=${demo.cards} empty=${demo.empty} notFound=${demo.notFound}`,
);
if (demo.notFound) failures.push(`${DEMO_ID}: rendered 'Bill not found' — the fallback did not apply`);
if (!demo.heading) failures.push(`${DEMO_ID}: no Related Laws panel`);
if (demo.cards < 1) failures.push(`${DEMO_ID}: Related Laws panel is empty — the seed data did not reach it`);
if (demo.consoleErrors.length) failures.push(`${DEMO_ID}: page errors ${demo.consoleErrors.join(" | ")}`);

// --- Case 2: the same id in BOTH places. The API must win.
const live = await inspect(LIVE_ID);
console.log(
  `${LIVE_ID} (in both)      heading=${live.heading} cards=${live.cards} empty=${live.empty} apiTitle=${live.apiTitle}`,
);
if (live.notFound) failures.push(`${LIVE_ID}: rendered 'Bill not found' — the live record did not win`);
if (!live.apiTitle) {
  failures.push(
    `${LIVE_ID}: the local list beat the API — this is the exact regression that made a live record unreachable`,
  );
}
if (!live.empty) failures.push(`${LIVE_ID}: expected the empty state for a record with no related laws`);
if (live.consoleErrors.length) failures.push(`${LIVE_ID}: page errors ${live.consoleErrors.join(" | ")}`);

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nRelated Laws populates from the local list and stays empty on a live record.");
