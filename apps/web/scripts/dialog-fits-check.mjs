/**
 * No dialog hangs off the screen, on the short display it was reported on.
 *
 *   bun run dialog-fits-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Two reports, one minute apart, on a 1476x661 display:
 * "brings up a screen to large for display and unable to scroll to navigate
 * it", and the same about Edit profile.
 *
 * The cause was in the shared dialog primitive, which had no height cap and no
 * overflow: a dialog taller than the viewport was centred with both ends
 * hanging off the screen and no way to reach either. Twenty-one files use that
 * primitive, so it was every dialog in the app — and it only appears on a
 * SHORT viewport, which is why it survived this long. Every other check in this
 * folder runs tall enough to hide it.
 *
 * So this one runs short on purpose.
 *
 * WHAT IT PROVES, for each dialog it can open without a session:
 *   - The dialog's top and bottom are both inside the viewport.
 *   - If its content is taller than that, IT SCROLLS.
 *   - The primary action is reachable — on the two that were reported, without
 *     scrolling at all, because their head and foot are pinned.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

/** The display the bug was reported on. */
const VIEWPORT = { width: 1476, height: 661 };
/** Shorter still, because a laptop with a big toolbar is not exotic. */
const CRAMPED = { width: 1024, height: 500 };

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const SIGNED_IN = {
  user: { id: "u1", name: "Test Reader", email: "reader@example.com", username: "reader" },
  session: { id: "s1" },
};

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);
  if (path === "/api/me") return json(SIGNED_IN);
  if (path.startsWith("/api/users/")) {
    return json({
      id: "them",
      username: "someone",
      displayName: "Someone Else",
      avatar: "",
      bio: "",
      location: "",
      joinedDate: new Date().toISOString(),
      followers: 0,
      following: 0,
      votesCount: 0,
      isFollowing: false,
    });
  }
  if (path.startsWith("/api/")) {
    return json({
      results: [], posts: [], bills: [], data: [], items: [], comments: [], votes: [],
      notifications: [], references: [], conversations: [], delegations: [], requirements: [],
      count: 0, hasMore: false, nextCursor: null,
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

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launchChromium();

/**
 * The one question that matters: can a person see and reach all of it?
 *
 * A dialog passes if its box is inside the viewport AND, where its content is
 * taller than its box, that box actually scrolls. Measured off the rendered
 * element rather than inferred from class names, because a class that is
 * overridden by another class is exactly how this shipped.
 */
async function measure(page, selector) {
  return page.evaluate((sel) => {
    const dialog = document.querySelector(sel);
    if (!dialog) return null;
    const box = dialog.getBoundingClientRect();

    // Anything inside it that scrolls, including the dialog itself.
    const scrollers = [dialog, ...dialog.querySelectorAll("*")].filter((el) => {
      const style = getComputedStyle(el);
      return (
        /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
      );
    });

    const overflowing = dialog.scrollHeight > dialog.clientHeight + 1;

    return {
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      height: Math.round(box.height),
      viewport: window.innerHeight,
      overflowing,
      scrollers: scrollers.length,
    };
  }, selector);
}

async function open(viewport, path, openIt) {
  const context = await browser.newContext({ viewport });
  await acceptTermsBeforeLoad(context);
  const page = await context.newPage();
  await routeApiToLocal(page, base);
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(1_500);
  await openIt(page);
  await page.waitForTimeout(900);
  return { context, page };
}

const CASES = [
  {
    name: "Report",
    path: "/user/them",
    selector: '[data-testid="report-dialog"]',
    action: (page) => page.locator('[data-testid="report-user"]').click(),
    /** The button that files it must be on screen without scrolling. */
    primary: '[data-testid="report-send"]',
  },
  {
    name: "Edit profile",
    path: "/profile",
    selector: '[role="dialog"]',
    action: (page) => page.getByLabel("Edit profile").click(),
    primary: null,
  },
];

for (const viewport of [VIEWPORT, CRAMPED]) {
  const label = `${viewport.width}x${viewport.height}`;
  for (const testCase of CASES) {
    let context;
    try {
      const opened = await open(viewport, testCase.path, testCase.action);
      context = opened.context;
      const seen = await measure(opened.page, testCase.selector);

      if (!seen) {
        check(`${label} · ${testCase.name} opens`, false, "the dialog never appeared");
        await context.close();
        continue;
      }

      check(
        `${label} · ${testCase.name}: the top of it is on screen`,
        seen.top >= -1,
        `top=${seen.top}`,
      );
      check(
        `${label} · ${testCase.name}: THE BOTTOM OF IT IS ON SCREEN`,
        seen.bottom <= seen.viewport + 1,
        `bottom=${seen.bottom} viewport=${seen.viewport}`,
      );
      check(
        `${label} · ${testCase.name}: and if it does not fit, IT SCROLLS`,
        seen.height < seen.viewport ? true : seen.scrollers > 0,
        `height=${seen.height} scrollers=${seen.scrollers}`,
      );

      if (testCase.primary) {
        const reachable = await opened.page.evaluate((sel) => {
          const button = document.querySelector(sel);
          if (!button) return null;
          const box = button.getBoundingClientRect();
          return box.bottom <= window.innerHeight + 1 && box.top >= -1;
        }, testCase.primary);
        check(
          `${label} · ${testCase.name}: the button that files it is reachable without scrolling`,
          reachable === true,
          String(reachable),
        );
      }

      await context.close();
    } catch (error) {
      check(`${label} · ${testCase.name}`, false, error.message);
      try { await context?.close(); } catch { /* already gone */ }
    }
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nEvery dialog fits the screen, or scrolls inside it.");
