/**
 * The first click works, and the tab you are on is in the URL.
 *
 *   bun run nav-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The report was "the Timeline sidebar item does not
 * navigate." The link was never broken. The pre-beta welcome notice was a
 * blocking Dialog, and its overlay — `fixed inset-0 z-50 bg-black/80` — covered
 * the whole viewport on a first visit. The first click anywhere landed on the
 * overlay, dismissed it, and went nowhere. Press again and it works, which is
 * precisely why nobody could reproduce it: the bug only exists for a person who
 * has never been here before, and that is every new visitor exactly once.
 *
 * Nothing in a typecheck, a lint, a build, or a render check can see that. The
 * markup is correct; a different element is on top of it. Only a real click in
 * a real browser, from a first-visit profile with empty storage, can tell.
 *
 * Three things are pinned:
 *
 *   1. On a first visit, no element covers the viewport. Any full-bleed
 *      overlay eats the first click no matter which component drew it, so this
 *      is written against the geometry rather than against one component.
 *   2. Every sidebar destination is reached on the FIRST click. Not "reachable"
 *      — first click, because a second one is a bug report.
 *   3. The feed tab lives in the URL and survives a reload. A tab in component
 *      state cannot be linked to, shared, or returned to with Back, and a
 *      person who reloads on Gaps and lands on For You reads it as data loss.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const SIGNED_IN = {
  user: { id: "u1", name: "Test Reader", email: "reader@example.com" },
  session: { id: "s1" },
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/api/me") return json(SIGNED_IN);
  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);
  // Empty everywhere else: an empty app is the hardest case for navigation,
  // because there is no content to accidentally click on instead.
  if (path.startsWith("/api/")) {
    return json({ results: [], bills: [], posts: [], items: [], conversations: [], references: [] });
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

/**
 * A brand-new visitor every time. A fresh context means empty localStorage,
 * which means the pre-beta notice is showing — the exact state the bug needed.
 */
async function firstVisit(path = "/feed") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await routeApiToLocal(page, base);
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return { context, page };
}

// ---------------------------------------------------------------- 1. geometry

{
  const { context, page } = await firstVisit();

  // Anything covering most of the viewport at a raised z-index will swallow a
  // click meant for something underneath it, whatever component drew it.
  const covering = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return [...document.querySelectorAll("body *")]
      .filter((el) => {
        const style = getComputedStyle(el);
        if (style.pointerEvents === "none") return false;
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (style.position !== "fixed" && style.position !== "absolute") return false;
        const r = el.getBoundingClientRect();
        return r.width >= vw * 0.9 && r.height >= vh * 0.9;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 90));
  });

  check(
    "a first visit puts nothing over the whole viewport",
    covering.length === 0,
    covering.length ? covering.join(" | ") : "none",
  );

  // The notice still has to be READ, or the fix traded one bug for another.
  const notice = await page.getByText("still in pre-beta", { exact: false }).count();
  check("and the pre-beta notice is still visible", notice > 0, `matches=${notice}`);

  await context.close();
}

// ------------------------------------------------------------ 2. first clicks

const DESTINATIONS = [
  ["Timeline", "/timeline"],
  ["Library", "/library"],
  ["Discover", "/discover"],
  ["People", "/people"],
  ["Messages", "/messages"],
  ["Government", "/government"],
  ["My record", "/record"],
];

for (const [label, expected] of DESTINATIONS) {
  const { context, page } = await firstVisit();
  const link = page.getByRole("link", { name: label, exact: true }).first();

  let landed = "(not clicked)";
  try {
    // No force: the point is whether a real click reaches the link. A forced
    // click would dispatch through whatever is on top and hide the bug.
    await link.click({ timeout: 4000 });
    await page.waitForTimeout(500);
    landed = new URL(page.url()).pathname;
  } catch (error) {
    landed = `(${String(error).split("\n")[0].slice(0, 70)})`;
  }

  check(`${label} navigates on the first click`, landed === expected, `-> ${landed}`);
  await context.close();
}

// -------------------------------------------------------------- 3. feed tabs

{
  const { context, page } = await firstVisit();

  for (const [label, expected] of [["Trending", "trending"], ["Gaps", "gaps"], ["Local", "local"]]) {
    let search = "(not clicked)";
    try {
      await page.getByRole("tab", { name: label, exact: true }).first().click({ timeout: 4000 });
      await page.waitForTimeout(400);
      search = new URL(page.url()).searchParams.get("tab") ?? "(absent)";
    } catch (error) {
      search = `(${String(error).split("\n")[0].slice(0, 70)})`;
    }
    check(`the ${label} tab is written to the URL`, search === expected, `tab=${search}`);
  }

  // The one that matters: a reload has to come back to the same tab.
  await page.goto(`${base}/feed?tab=gaps`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const after = new URL(page.url()).searchParams.get("tab");
  check("and a reload comes back to the same tab", after === "gaps", `tab=${after}`);

  await context.close();
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} navigation check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nNothing covers the first click, and the tab you are on is in the URL.");
