/**
 * Measures the reference-detail page at the widths where it broke.
 *
 *   bun run layout-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. A responsive break is invisible to typecheck, lint and
 * build, and it is invisible to render-check too — that one serves /api as 503
 * on purpose, so the page renders its error state and the vote panel is never
 * laid out at all.
 *
 * The defect this was written for: between the `lg` and `xl` breakpoints the
 * sidebar, the article and the vote aside stopped fitting. At 1097px the
 * document was 1109px wide, the aside's right edge sat past the viewport, and
 * the Support and Oppose buttons overlapped by 13 pixels with Oppose clipped
 * off the screen. It was correct at 1568px, which is why it survived review.
 *
 * Two things are asserted at every width:
 *
 *   1. No horizontal overflow — scrollWidth <= innerWidth.
 *   2. Support ends before Oppose begins — supportRect.right <= opposeRect.left.
 *
 * The second is deliberately a side-by-side check rather than "they do not
 * overlap": these two buttons are a pair, and a fix that stacked them would
 * pass an overlap test while changing what the panel is.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const WIDTHS = [1024, 1097, 1180, 1280, 1440, 1568];

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

/**
 * One reference, answered from memory.
 *
 * The percentages are deliberately two digits each, and the vote counts
 * deliberately long, because the collision was between the widest plausible
 * labels — a panel that fits "5%" and "95%" says nothing about one that has to
 * fit "67%" beside "1,284,003 votes".
 */
const REFERENCE = {
  id: "layout-check",
  masterReferenceId: "hr-4836-119",
  displayId: "H.R. 4836",
  referenceType: "bill",
  title:
    "A bill to amend title 38, United States Code, to improve the provision of " +
    "health care and benefits, and for other purposes",
  shortTitle: "Veterans Health Improvement Act",
  status: "committee",
  category: "healthcare",
  chamber: "house",
  congress: 119,
  sourceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/4836",
  description: "Reported out of committee with amendments.",
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
  votes: { support: 1284003, oppose: 632117, total: 1916120 },
  engagement: { comments: 412, shares: 88, posts: 37 },
  userVote: null,
  createdAt: new Date().toISOString(),
};

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  if (/^\/api\/government-references\/[^/]+$/.test(url)) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ reference: REFERENCE }));
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

const browser = await launchChromium();
const failures = [];

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await acceptTermsBeforeLoad(page);
  await routeApiToLocal(page, base);
  await page.goto(`${base}/reference/layout-check`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Support", { timeout: 10_000 });

  const measured = await page.evaluate(() => {
    const buttonWithText = (text) =>
      [...document.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").trim().startsWith(text),
      );

    const support = buttonWithText("Support") ?? buttonWithText("Supported");
    const oppose = buttonWithText("Oppose") ?? buttonWithText("Opposed");

    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      support: support ? support.getBoundingClientRect().right : null,
      oppose: oppose ? oppose.getBoundingClientRect().left : null,
    };
  });

  await page.close();

  const problems = [];
  if (measured.scrollWidth > measured.innerWidth) {
    problems.push(`overflows by ${measured.scrollWidth - measured.innerWidth}px`);
  }
  if (measured.support === null || measured.oppose === null) {
    problems.push("could not find the Support/Oppose buttons");
  } else if (measured.support > measured.oppose) {
    problems.push(`Support/Oppose overlap by ${Math.round(measured.support - measured.oppose)}px`);
  }

  const status = problems.length === 0 ? "ok  " : "FAIL";
  console.log(
    `${status} ${String(width).padStart(4)}px  ` +
      `scrollWidth=${measured.scrollWidth} innerWidth=${measured.innerWidth}  ` +
      `support.right=${measured.support === null ? "?" : Math.round(measured.support)} ` +
      `oppose.left=${measured.oppose === null ? "?" : Math.round(measured.oppose)}` +
      (problems.length ? `  — ${problems.join("; ")}` : ""),
  );
  if (problems.length) failures.push(`${width}px: ${problems.join("; ")}`);
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} width(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nNo overflow and no overlap at any measured width.");
