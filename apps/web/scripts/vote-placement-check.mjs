/**
 * THE VOTE PANEL IS WHERE THE READER CAN REACH IT, AND THERE IS ONLY ONE.
 *
 *   bun run vote-placement-check          (after `bun run build`)
 *
 * WHAT THIS IS ABOUT. Above xl the law page is two columns and the vote panel
 * lives in the right one, visible the whole way down. Below xl that column
 * stacks underneath the article — after the brief, after the full official text
 * of the bill — so on a phone the thing the page exists for sat several screens
 * below the fold. Somebody who had just read the brief and decided how they
 * felt had to scroll past an entire statute to say so.
 *
 * On a narrow screen it now renders directly above the brief instead.
 *
 * THE FAILURE THIS GUARDS. The lazy way to move a thing between two layouts is
 * to render it twice and hide one with a media query. Two vote panels on one
 * page is two controls that can disagree about the tally, two optimistic
 * updates, and a fix that lands in one of them — which is a bug this codebase
 * has shipped before in three copies of a pulse bar. So the count is asserted
 * as exactly one at every width, not merely "present".
 */
import { devices } from "playwright";
import { launchChromium, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = process.argv[2] ?? "dist";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const BILL = JSON.parse(await readFile(join(HERE, "fixtures", "reference-bill.json"), "utf8"));

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (path.startsWith("/api/auth/get-session")) return json(null);
  if (path === "/api/me") return json(null, 401);
  if (path === `/api/government-references/${BILL.reference.id}`) return json(BILL);
  if (path.startsWith("/api/")) {
    return json({ results: [], posts: [], data: [], items: [], comments: [], votes: [],
                  references: [], count: 0, hasMore: false, nextCursor: null });
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

/**
 * Where the Aye button sits relative to the Citizen's Brief heading, measured
 * in the rendered page rather than inferred from class names.
 */
async function placement(page) {
  return page.evaluate(() => {
    const ayeButtons = [...document.querySelectorAll("button")].filter(
      (b) => (b.textContent || "").trim().toLowerCase() === "aye",
    );
    // The card titles itself with a <p>, not a heading element, and the
    // apostrophe may be typographic. Matched on the element whose OWN text is
    // the title, so the surrounding card (which also contains the words) is not
    // what gets measured.
    const brief = [...document.querySelectorAll("p,h1,h2,h3,h4,span,div")].find(
      (el) => /^citizen[\u2019']s brief$/i.test((el.textContent || "").trim()),
    );
    return {
      ayeCount: ayeButtons.length,
      briefFound: !!brief,
      ayeTop: ayeButtons[0] ? Math.round(ayeButtons[0].getBoundingClientRect().top + window.scrollY) : null,
      briefTop: brief ? Math.round(brief.getBoundingClientRect().top + window.scrollY) : null,
      // Which column it is in, on a wide screen: an element inside <aside> is
      // in the rail, one inside <article> is in the body.
      inAside: ayeButtons[0] ? !!ayeButtons[0].closest("aside") : null,
      inArticle: ayeButtons[0] ? !!ayeButtons[0].closest("article") : null,
    };
  });
}

async function open(context) {
  const page = await context.newPage();
  await acceptTermsBeforeLoad(page);
  await page.goto(`${base}/reference/${BILL.reference.id}`, { waitUntil: "load", timeout: 30000 });
  await page.waitForTimeout(1500);
  // A blank page satisfies "there is exactly one of nothing". Guard it.
  const painted = await page.evaluate(() => document.body.innerText.trim().length);
  if (painted < 40) throw new Error(`the page painted nothing (${painted} chars)`);
  return page;
}

// ---------------------------------------------------------------------------
// A phone: above the brief, in the article
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  try {
    const page = await open(context);
    const seen = await placement(page);

    if (seen.ayeCount !== 1) failures.push(`phone: expected exactly one Aye button, found ${seen.ayeCount}`);
    if (!seen.briefFound) failures.push("phone: the Citizen's Brief heading is not on the page, so placement cannot be judged");
    else if (seen.ayeTop === null) failures.push("phone: no Aye button to place");
    else if (seen.ayeTop >= seen.briefTop) {
      failures.push(`phone: the vote panel is BELOW the brief (Aye at ${seen.ayeTop}px, brief at ${seen.briefTop}px)`);
    }
    if (seen.inAside) failures.push("phone: the vote panel is still in the stacked sidebar, which is the whole problem");
  } catch (error) {
    failures.push(`phone: ${String(error).slice(0, 120)}`);
  }
  await context.close();
}

// ---------------------------------------------------------------------------
// A desktop: unchanged — in the rail beside the article
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await open(context);
    const seen = await placement(page);

    if (seen.ayeCount !== 1) failures.push(`desktop: expected exactly one Aye button, found ${seen.ayeCount}`);
    if (!seen.inAside) failures.push("desktop: the vote panel left the right rail — this layout was not meant to change");
    if (seen.inArticle) failures.push("desktop: the vote panel moved into the article column");
  } catch (error) {
    failures.push(`desktop: ${String(error).slice(0, 120)}`);
  }
  await context.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} problem(s) with where the vote panel sits:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("One vote panel: above the brief on a phone, in the right rail on a desktop.");
