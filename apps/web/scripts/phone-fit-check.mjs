/**
 * EVERY PAGE FITS A REAL PHONE, MEASURED THE WAY A PHONE MEASURES IT.
 *
 *   bun run phone-fit-check          (after `bun run build`)
 *
 * WHY THIS EXISTS, AND WHY every-page-check DID NOT CATCH IT.
 *
 * Reported with two screenshots: opening a law from the feed produced a page
 * wider than the screen, and pinching out to read it left the header bar and
 * the background painted across only part of the content. The header is
 * `width: 100%`, which resolves against the initial containing block — the
 * viewport — while an overflowing child stretches the SCROLLABLE area past it.
 * So the chrome stops at 390px and the article runs on. That mismatch is the
 * symptom people actually report; the overflow is the cause.
 *
 * every-page-check measured this and found nothing, twice, for two reasons
 * that both come down to testing something other than a phone:
 *
 *   1. IT WAS NOT A PHONE. It called `newPage({ viewport: { width: 390 } })`,
 *      which is a narrow DESKTOP window. Chromium only honours
 *      `<meta name="viewport">` under mobile emulation, so `isMobile`,
 *      the mobile user agent and the device pixel ratio all have to be set —
 *      which is exactly what Playwright's device descriptors carry. A narrow
 *      desktop window lays some things out differently from a phone and never
 *      exercises the meta viewport at all.
 *
 *   2. IT WAS NOT A PAGE WITH ANYTHING ON IT. The routes are built with an id
 *      that is deliberately not in any database, so every detail page renders
 *      "we couldn't load this reference" — an empty box that fits any screen
 *      trivially. The reported bug is on a POPULATED law page. An empty page
 *      cannot overflow, so the check was passing on the absence of content.
 *
 * Both are fixed here. Real device descriptors, and real captured API payloads
 * so the detail page renders the way it does for a reader.
 *
 * ABOUT THE FIXTURES. `scripts/fixtures/*.json` are verbatim responses from the
 * production API, captured with curl and committed unedited. Nothing in them is
 * invented — a made-up law with a made-up sponsor would prove nothing about
 * whether a real one fits, and this codebase does not fabricate records.
 *
 * WIDTHS. iPhone SE at 320px is the narrowest screen still worth supporting and
 * is where a fixed-width child shows up first; 375, 390 and 393 are the common
 * modern sizes; 430 is the largest Pro Max. If it fits 320 it fits all of them,
 * but they are all measured because a media query can break exactly one.
 */
import { devices } from "playwright";
import { launchChromium, acceptTermsBeforeLoad, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

/**
 * Real phones, by CSS width. Playwright's descriptors carry the user agent,
 * the device pixel ratio, touch and `isMobile` — the last of which is what
 * makes Chromium apply the meta viewport at all.
 */
const PHONES = ["iPhone SE", "iPhone 13 Mini", "iPhone 13", "iPhone 14 Pro", "iPhone 15 Pro Max"];

/**
 * THE FONTS HAVE TO BE THE REAL ONES.
 *
 * The display face is Bodoni Moda and the body is Public Sans, both from
 * Google Fonts. A sandbox that cannot reach fonts.googleapis.com falls back to
 * Georgia and a system sans, whose metrics are not the same — text measures a
 * different width, and a width bug is exactly what this is looking for. So the
 * stylesheet and the font files are fetched by NODE, which can reach them, and
 * served into the browser, which cannot.
 *
 * If they cannot be fetched the run says so loudly rather than quietly
 * measuring a page in the wrong typeface and calling it a pass.
 */
let fontsServed = 0;
let fontsFailed = 0;

async function serveRealFonts(page) {
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, async (route) => {
    try {
      const response = await fetch(route.request().url(), {
        headers: { "user-agent": await page.evaluate(() => navigator.userAgent) },
      });
      const body = Buffer.from(await response.arrayBuffer());
      fontsServed += 1;
      return await route.fulfill({
        status: response.status,
        contentType: response.headers.get("content-type") ?? "text/css",
        body,
      });
    } catch {
      fontsFailed += 1;
      // Best effort. A page whose route handler throws takes the run down.
      try { return await route.abort(); } catch { /* page already gone */ }
    }
  });
}

const FIXTURES = JSON.parse(
  await readFile(join(HERE, "fixtures", "reference-bill.json"), "utf8"),
);
const EO = JSON.parse(
  await readFile(join(HERE, "fixtures", "reference-executive-order.json"), "utf8"),
);

const BILL_ID = FIXTURES.reference.id;
const EO_ID = EO.reference.id;

/** Routes whose whole point is that they carry a real record, and the words that prove it. */
const POPULATED = new Map([
  [`/reference/${BILL_ID}`, FIXTURES.reference.title],
  [`/reference/${EO_ID}`, EO.reference.title],
]);

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(null);
  if (path === "/api/me") return json(null, 401);

  // The populated law pages, answered with the real captured records.
  if (path === `/api/government-references/${BILL_ID}`) return json(FIXTURES);
  if (path === `/api/government-references/${EO_ID}`) return json(EO);

  if (path.startsWith("/api/")) {
    return json({
      results: [], posts: [], bills: [], data: [], items: [], comments: [],
      votes: [], notifications: [], references: [], conversations: [],
      delegations: [], requirements: [], count: 0, hasMore: false, nextCursor: null,
    });
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

/** Read every route the app mounts, the same way every-page-check does. */
async function routes() {
  const src = await readFile("src/App.tsx", "utf8");
  const found = [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  const generic = [...new Set(found)]
    .filter((p) => p !== "*")
    .map((p) =>
      p
        .replace(/:tab\b/g, "overview")
        .replace(/:id\b/g, "e2e-nonexistent-id")
        .replace(/:[A-Za-z]+/g, "e2e-nonexistent"),
    );
  // Plus the two that actually have content, which is where the bug lives.
  return [...generic, `/reference/${BILL_ID}`, `/reference/${EO_ID}`];
}

/**
 * Measure the page the way the phone does, and NAME what is too wide.
 *
 * `documentElement.scrollWidth` past `clientWidth` is the overflow. Reporting
 * only the number sends somebody hunting through forty components, so the
 * widest element whose right edge sits past the viewport is named too — that
 * is nearly always the culprit or its direct parent.
 */
async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    const offenders = [];

    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      // Things a reader cannot see cannot be too wide FOR a reader. Closed
      // dialogs, collapsed menus and screen-reader text all park off-screen on
      // purpose, and counting them buries the real answer.
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (el.closest("[aria-hidden='true'],[hidden],[data-state='closed']")) continue;
      // A fixed element that is translated off-screen is a drawer, not overflow.
      if (style.position === "fixed" && style.transform !== "none") continue;

      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      const right = box.left + window.scrollX + box.width;
      if (right > width + 1) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || "").slice(0, 110),
          width: Math.round(box.width),
          right: Math.round(right),
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 45),
        });
      }
    }

    offenders.sort((a, b) => b.right - a.right || b.width - a.width);

    /**
     * TEXT THAT IS CUT OFF INSIDE SOMETHING THAT FITS.
     *
     * The check above measures the page overflowing the viewport, which is the
     * symptom people report as "it does not fit". It cannot see the other
     * shape of the same problem: a label inside a `truncate` box, where the
     * layout holds perfectly and the WORD is chopped. "Messa…" and "Govern…"
     * in the bottom navigation, reported from a real phone.
     *
     * That trade is deliberate in the navigation — the label gives way before
     * the layout does, because the alternative was Safari zooming the whole
     * page out. Deliberate does not make it finished: a signpost you cannot
     * read is not doing its job either.
     *
     * Only NAVIGATION and BUTTON labels. Truncating a headline or a law's title
     * in a list is normal and correct; truncating the word that tells somebody
     * where a control goes is not.
     */
    const clipped = [];
    for (const el of document.querySelectorAll("nav a, nav button, [role='tablist'] a, [role='tablist'] button")) {
      for (const node of [el, ...el.querySelectorAll("span")]) {
        const style = getComputedStyle(node);
        if (style.textOverflow !== "ellipsis" && style.overflow !== "hidden") continue;
        if (node.scrollWidth <= node.clientWidth + 1) continue;
        const text = (node.textContent || "").trim();
        if (!text) continue;
        clipped.push({
          text: text.slice(0, 30),
          shown: Math.round(node.clientWidth),
          needs: Math.round(node.scrollWidth),
        });
      }
    }

    return {
      viewport: width,
      scrollWidth: doc.scrollWidth,
      over: doc.scrollWidth - width,
      offenders: offenders.slice(0, 4),
      clipped,
    };
  });
}

const browser = await launchChromium();
const paths = await routes();
const failures = [];
/** Cut-off navigation labels, deduplicated by phone and word. */
const clippedLabels = new Map();
let checks = 0;

for (const phone of PHONES) {
  const context = await browser.newContext({ ...devices[phone] });
  const page = await context.newPage();
  await serveRealFonts(page);
  await acceptTermsBeforeLoad(page);
  // Same reason as the fonts above, and the same trap the vote placement check
  // fell into: CI bakes VITE_BACKEND_URL: https://ci.invalid into the bundle,
  // so without this the two populated law pages below quietly render their
  // error state and this check goes back to measuring empty boxes — the exact
  // hole it was written to close.
  await routeApiToLocal(page, base);

  for (const path of paths) {
    checks += 1;
    if (process.env.PHONE_FIT_VERBOSE) process.stdout.write(`  ${phone} ${path}\n`);
    try {
      // "load", not "domcontentloaded" and certainly not "commit". This is a
      // single-page app: the document commits before React has rendered a
      // single element, and an empty page is 0px over on any screen. An
      // earlier version of this check waited on "commit" and reported that
      // every page fit — it was measuring a blank document.
      await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(900);
    } catch (error) {
      failures.push(`${phone} ${path}: did not open — ${String(error).slice(0, 90)}`);
      continue;
    }

    /**
     * A PAGE THAT DID NOT PAINT CANNOT PASS.
     *
     * This is the guard that matters most in the whole file. Nothing is
     * narrower than nothing, so a white screen sails through a width check
     * and reports the best possible result. Every "fits" below is now backed
     * by the page having actually rendered something first.
     */
    const painted = await page.evaluate(() => document.body.innerText.trim().length);
    if (painted < 40) {
      failures.push(`${phone} ${path}: painted nothing (${painted} chars of text) — the width reading below it would be meaningless`);
      continue;
    }

    // A POPULATED PAGE HAS TO BE POPULATED.
    //
    // The two law pages are the entire reason this check exists: an empty
    // "couldn't load this reference" box fits any screen, so if they silently
    // degrade to the error state this check is back to proving nothing. It
    // already happened once, when the baked-in backend URL sent their API calls
    // to a host that does not exist.
    if (POPULATED.has(path)) {
      const title = POPULATED.get(path);
      const showsTheLaw = await page.evaluate((needle) => document.body.innerText.includes(needle), title);
      if (!showsTheLaw) {
        failures.push(`${phone} ${path}: rendered without the law on it — expected the title ${JSON.stringify(title)}. An empty page fits any screen, so the measurement below would prove nothing.`);
        continue;
      }
    }

    const result = await measure(page);
    if (result.over > 0) {
      const named = result.offenders
        .map((o) => `        ${o.width}px wide, right edge ${o.right} — <${o.tag} class="${o.cls}"> ${JSON.stringify(o.text)}`)
        .join("\n");
      failures.push(
        `${phone} (${result.viewport}px) ${path}: over by ${result.over}px\n${named || "        (no single element named — check a negative margin or a grid track)"}`,
      );
    }

    // A signpost you cannot read is not doing its job. Collected across every
    // page and phone, then reported once at the end — the navigation is the
    // same on all of them, so failing per page would print the same line
    // fifty-five times.
    for (const label of result.clipped) {
      clippedLabels.set(
        `${phone}|${label.text}`,
        `${phone} (${result.viewport}px): "${label.text}" is cut off — ${label.shown}px shown, needs ${label.needs}px`,
      );
    }
  }

  await context.close();
}

await browser.close();
server.close();

for (const line of [...clippedLabels.values()].sort()) failures.push(line);

if (fontsServed === 0) {
  console.error(
    "\nThe web fonts could not be fetched, so every page was measured in a fallback\n" +
    "typeface with different metrics. That is not a measurement of this app.\n",
  );
  process.exit(1);
}

if (failures.length) {
  console.error(`\n${failures.length} of ${checks} checks found content wider than the screen:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  process.exit(1);
}

console.log(
  `All ${paths.length} pages fit every phone — ${PHONES.join(", ")} (${checks} checks, ` +
  `real fonts served ${fontsServed}${fontsFailed ? `, ${fontsFailed} font requests failed` : ""}).`,
);
