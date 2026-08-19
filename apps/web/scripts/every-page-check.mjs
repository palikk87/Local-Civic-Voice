/**
 * Every page in the app, opened in a browser, signed out and signed in.
 *
 *   bun run every-page-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. There are forty-odd routes and five of them had a check. A
 * page that white-screens is the worst thing a launch can ship: it is not a
 * degraded experience, it is nothing at all, and the person who hits it has no
 * way to tell whether the site is broken or they are. It compiles green, it
 * builds green, and it only shows up when somebody navigates there.
 *
 * Most first-time visitors are SIGNED OUT, so every page is opened that way
 * first. A page that assumes a session — reads `user.id` without checking —
 * throws during render and paints nothing, and that is exactly the shape of
 * bug that reaches a stranger before it reaches anybody who could report it.
 *
 * WHAT COUNTS AS PASSING, deliberately low: the page painted something, and it
 * did not throw. Not "looks right" — this cannot know what right looks like,
 * and a check that guesses would be noise nobody trusts. It answers one
 * question only, for every route, which is the one nothing else answers.
 *
 * The API is stubbed empty on purpose. Empty is the hardest case for a UI —
 * no posts, no results, no reference — and it is what a brand-new account and
 * an unreachable backend both look like.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

/**
 * Every route the app mounts, with a real-looking id where one is needed.
 * Read from App.tsx so a new page is covered the moment it is added.
 */
async function routes() {
  const src = await readFile("src/App.tsx", "utf8");
  const found = [...src.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(found)]
    .filter((p) => p !== "*")
    .map((p) =>
      p
        .replace(/:tab\b/g, "overview")
        .replace(/:id\b/g, "e2e-nonexistent-id")
        .replace(/:[A-Za-z]+/g, "e2e-nonexistent"),
    );
}

const SIGNED_IN = { user: { id: "u1", name: "Test Reader", email: "reader@example.com" }, session: { id: "s1" } };

let signedIn = false;

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(signedIn ? SIGNED_IN : null);
  if (path === "/api/me") return signedIn ? json(SIGNED_IN) : json(null, 401);

  // A MADE-UP ID IS A 404, NOT AN EMPTY OBJECT.
  //
  // This stub used to answer every endpoint with the same generic bag of empty
  // arrays, which meant a detail page received a truthy record whose every
  // field was missing — a shape the real backend cannot return. Pages "failed"
  // on a state that does not exist, and the fix would have been to armour them
  // against fiction. The routes are built with an id that is deliberately not
  // in any database, so the honest answer is the one the backend gives: gone.
  //
  // Scoped to /api/ deliberately: the routes themselves contain that id, and an
  // unscoped check answered the PAGE navigation with a 404 too. Every detail
  // page then reported a white screen, which was this stub refusing to serve
  // the app at all.
  if (path.startsWith("/api/") && path.includes("e2e-nonexistent")) {
    return json({ error: "Not found" }, 404);
  }

  // Everything else: a shape-correct empty answer, including the paging fields
  // an infinite list reads. Empty is the hard case — it is what a brand-new
  // account and an unreachable backend both look like.
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

const browser = await launchChromium();
const paths = await routes();
const failures = [];

/**
 * Open one route and answer one question: did it paint, and did it throw.
 * Returns the problem as a string, or null when the page is fine.
 */
async function visit(page, state, path) {
  // Errors are attributed to the route that was open when they fired. A shared
  // list plus a reset per visit blames the NEXT page for the previous page's
  // late exception, which is how this check first reported failures on routes
  // that were fine.
  state.path = path;
  state.errors = [];

  try {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch {
    // A navigation timeout is itself a finding, and the check below still runs
    // against whatever did paint.
  }

  // WAIT FOR CONTENT, DO NOT GUESS A DELAY.
  //
  // Two earlier attempts measured at a fixed moment and both were wrong in
  // opposite directions: one raced the app's own view swap and called fourteen
  // healthy pages blank, the other measured before React had mounted and called
  // all of them blank. A fixed wait long enough for the slowest page would make
  // this take twenty minutes.
  //
  // So it waits for the thing it is actually asking about — anything at all in
  // the root — and gives up after a bounded time. A page that never paints
  // fails here, which is exactly the question.
  const painted = await page
    .waitForFunction(
      () => {
        const root = document.getElementById("root");
        if (!root) return 0;
        const score =
          root.innerText.trim().length +
          root.querySelectorAll("svg, img, input, button").length;
        return score > 0 ? score : false;
      },
      { timeout: 12_000 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => 0);

  if (state.errors.length > 0) return state.errors[0];
  if (painted === 0) return "painted nothing";

  // LET THE DATA LAND BEFORE JUDGING.
  //
  // Painting is not the end of the story. The Government page painted its
  // skeleton, passed, and then crashed a moment later when the query resolved —
  // it was only caught at all because /reps redirects there and the redirect
  // bought enough time for the crash to land first. So the check waits for the
  // network to go quiet, which is when a page has finished becoming itself.
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  // A CRASHED PAGE STILL PAINTS.
  //
  // React catches a render-time throw at the error boundary and puts "Something
  // went wrong" on the screen. No page-level error fires, text is present, and
  // "did it paint" answers yes. A planted page that read straight through a null
  // passed this check twice before the boundary was given a marker to find.
  const crashed = await page
    .locator("[data-error-boundary]")
    .count()
    .catch(() => 0);
  if (crashed > 0) return "crashed into the error boundary";

  return null;
}

/**
 * A page that takes the browser down with it must not end the run.
 *
 * One route crashed the renderer outright — "Target page, context or browser
 * has been closed" — and a crash is the most serious thing this check can
 * find, so it has to be recorded and stepped over rather than allowed to hide
 * every route behind it.
 */
async function freshPage(state) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => {
    if (state.path) state.errors.push(String(e).slice(0, 160));
  });
  await routeApiToLocal(page, base);
  return page;
}

/**
 * A FRESH PAGE FOR EVERY ROUTE, and it had to be.
 *
 * Reusing one page across forty routes is faster and it lies. Measured with a
 * fixed delay it called fourteen healthy pages blank; measured by WAITING for
 * content — which should have fixed it — it called forty-one of them blank.
 * The race is the design and not the timing: the single-page app tears down the
 * execution context mid-navigation and the measurement goes with it. Reuse is a
 * closed question here, tried twice and wrong twice.
 *
 * Speed comes from opening several pages AT ONCE instead. Each route still gets
 * its own page and its own verdict; only the wall clock is shared. Results are
 * collected and printed in route order, so the output reads identically to a
 * serial run — a log that shuffles itself is one nobody can compare to the last.
 */
const CONCURRENCY = 6;

async function pass(label) {
  const verdicts = new Array(paths.length);
  let next = 0;

  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= paths.length) return;
      const path = paths[index];
      const state = { path: null, errors: [] };
      let page;
      try {
        page = await freshPage(state);
        verdicts[index] = await visit(page, state, path);
      } catch (error) {
        verdicts[index] = String(error).slice(0, 120);
      } finally {
        try {
          if (page) await page.close();
        } catch {
          // Already gone; that is usually why we are here.
        }
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  paths.forEach((path, index) => {
    const problem = verdicts[index];
    console.log(`${problem ? "FAIL" : "ok  "} ${label.padEnd(10)} ${path}${problem ? `  — ${problem}` : ""}`);
    if (problem) failures.push(`${label} ${path} — ${problem}`);
  });
}

console.log(`Opening ${paths.length} pages, signed out then signed in.\n`);

signedIn = false;
await pass("signed-out");

console.log("");
signedIn = true;
await pass("signed-in");

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} page failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(`\nAll ${paths.length} pages render, signed out and signed in.`);
