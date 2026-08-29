/**
 * THE THINGS THAT WERE REPORTED, STAYING FIXED.
 *
 *   bun run reported-bugs-check          (after `bun run build`)
 *
 * Each assertion here is somebody's bug report, in their words, turned into a
 * question a browser can answer. They are grouped in one file because they have
 * one thing in common: every one of them was a control that looked right and
 * did the wrong thing, which is the kind of defect no amount of type checking
 * or rendering ever catches.
 *
 * "when you click copy link it just copies a link like this one
 *  https://ayeandnay.com/timeline"
 * "it takes me to my own timeline" (pressing Reply on somebody's post)
 * "there is no back button once your in the notifications"
 * "this line should not be here" (the Constitution's version stamp)
 */
import { launchChromium, acceptTermsBeforeLoad, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const SIGNED_IN = {
  user: { id: "u1", name: "Test Reader", email: "reader@example.com", username: "reader" },
  session: { id: "s1" },
};

/**
 * One post, shaped the way /api/feed shapes one. Invented, and that is correct
 * here: it is the INPUT to a control, not content shown to anybody as fact.
 */
const POST = {
  id: "post_under_test",
  author: { id: "a1", username: "someone", displayName: "Someone Else", avatar: null },
  content: "A position on a bill.",
  createdAt: new Date().toISOString(),
  metrics: { likes: 3, comments: 0, shares: 0, saves: 0, views: 0 },
  isLiked: false,
  reference: null,
  bill: null,
};

let likeCalls = 0;

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);
  if (path === "/api/me") return json(SIGNED_IN);
  if (path === "/api/feed") return json({ posts: [POST], hasMore: false, nextCursor: null });
  if (path === `/api/posts/${POST.id}/like` && req.method === "POST") {
    likeCalls += 1;
    return json({ liked: true });
  }
  if (path.startsWith("/api/")) {
    return json({ results: [], posts: [], data: [], items: [], comments: [], votes: [],
                  notifications: [], references: [], conversations: [], count: 0,
                  hasMore: false, nextCursor: null });
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
const context = await browser.newContext({
  viewport: { width: 1476, height: 661 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const failures = [];

async function page(path) {
  const p = await context.newPage();
  await acceptTermsBeforeLoad(p);
  await routeApiToLocal(p, base);
  await p.goto(`${base}${path}`, { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1200);
  const painted = await p.evaluate(() => document.body.innerText.trim().length);
  if (painted < 40) throw new Error(`${path} painted nothing`);
  return p;
}

// --- "this line should not be here" -----------------------------------------
try {
  const p = await page("/constitution");
  const text = await p.evaluate(() => document.body.innerText);
  if (/Effective\s+\d/.test(text) || /\bv\d+\.\d+\s*·/.test(text)) {
    failures.push("the Constitution still prints its version and effective date");
  }
  await p.close();
} catch (e) {
  failures.push(`constitution: ${String(e).slice(0, 110)}`);
}

// --- "there is no back button once your in the notifications" ---------------
try {
  const p = await page("/notifications");
  if (!(await p.getByRole("button", { name: /^back$/i }).count())) {
    failures.push("notifications has no Back button");
  }
  await p.close();
} catch (e) {
  failures.push(`notifications: ${String(e).slice(0, 110)}`);
}

// --- "it takes me to my own timeline" ---------------------------------------
try {
  const p = await page("/feed");
  const reply = p.getByRole("button", { name: /^reply$/i });
  if (!(await reply.count())) {
    failures.push("no Reply button on the feed, so it could not be exercised");
  } else {
    await reply.first().click();
    await p.waitForTimeout(900);
    const url = p.url();
    if (url.includes("/timeline")) {
      failures.push("Reply still goes to the reader's own timeline");
    } else if (!url.includes(`/post/${POST.id}`)) {
      failures.push(`Reply went to ${url} rather than the post it was pressed on`);
    }
  }
  await p.close();
} catch (e) {
  failures.push(`reply: ${String(e).slice(0, 110)}`);
}

// --- "copy link just copies a link like https://ayeandnay.com/timeline" -----
// --- and "the heart doesn't show up on the post in the timeline" ------------
try {
  const p = await page("/feed");

  const heart = p.locator("button").filter({ hasText: /^3$/ });
  if (await heart.count()) {
    await heart.first().click();
    await p.waitForTimeout(900);
    if (likeCalls === 0) failures.push("liking a post in the feed never reaches the server");
  } else {
    failures.push("could not find the like button on the feed card");
  }

  const share = p.getByRole("button", { name: /^share$/i });
  if (!(await share.count())) {
    failures.push("no Share button on the feed");
  } else {
    await share.first().click();
    await p.waitForTimeout(700);
    const copy = p.getByRole("button", { name: /copy link/i });
    if (!(await copy.count())) {
      failures.push("the share sheet has no Copy Link");
    } else {
      await copy.first().click();
      await p.waitForTimeout(500);
      const copied = await p.evaluate(async () => {
        try { return await navigator.clipboard.readText(); } catch { return ""; }
      });
      // The feed opens this sheet about the LAW behind the post, so the link
      // is the law's page. Opened from a timeline it is given the post and the
      // link is the post's permalink. Either is a link to the thing shared;
      // the page you were standing on is not.
      if (!copied) failures.push("Copy Link put nothing on the clipboard");
      else if (!/\/(post|reference)\//.test(copied)) {
        failures.push(`Copy Link copied ${copied} rather than a link to the thing being shared`);
      }
    }
  }
  await p.close();
} catch (e) {
  failures.push(`share and like: ${String(e).slice(0, 110)}`);
}

// --- "when you have a pop up come up the bug report doesn't allow you to type
//      in anything" ---------------------------------------------------------
//
// A modal dialog installs a focus trap that yanks focus back inside the moment
// anything outside it is focused, so the reporter's textarea took focus for one
// frame and lost it, forever. Nothing to do with z-index, which is why it
// survived. This types into it while a dialog is open and reads the value back.
try {
  const p = await page("/feed");

  await p.getByRole("button", { name: /^share$/i }).first().click();
  await p.waitForTimeout(700);
  const dialogOpen = await p.locator('[role="dialog"][data-state="open"]').count();
  if (!dialogOpen) {
    failures.push("could not open a dialog, so the focus trap case was not exercised");
  } else {
    await p.locator("[data-bug-reporter]").first().click();
    await p.waitForTimeout(500);

    const box = p.locator("[data-bug-reporter] textarea").first();
    if (!(await box.count())) {
      failures.push("the bug reporter did not open over the dialog");
    } else {
      await box.click();
      await box.type("typed while a dialog was open", { delay: 12 });
      await p.waitForTimeout(300);
      const value = await box.inputValue();
      if (value !== "typed while a dialog was open") {
        failures.push(`the bug reporter still cannot be typed into over a dialog (got ${JSON.stringify(value)})`);
      }
    }
  }
  await p.close();
} catch (e) {
  failures.push(`bug reporter over a dialog: ${String(e).slice(0, 110)}`);
}

// --- "bug reporter sometimes gets in the way" -------------------------------
//
// Dragged out of the way rather than hidden, and a drag must not count as a
// press — opening the panel every time you nudged it would be worse than not
// being able to move it.
try {
  const p = await page("/feed");
  const button = p.locator("[data-bug-reporter]").first();
  const before = await button.boundingBox();

  await p.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await p.mouse.down();
  await p.mouse.move(before.x - 200, before.y - 150, { steps: 12 });
  await p.mouse.up();
  await p.waitForTimeout(400);

  const after = await button.boundingBox();
  if (!after || Math.abs(after.x - before.x) < 50) {
    failures.push("the bug button cannot be dragged out of the way");
  }
  if (await p.locator("[data-bug-reporter] textarea").count()) {
    failures.push("dragging the bug button opened the report panel, so it cannot be moved without filing one");
  }
  await p.close();
} catch (e) {
  failures.push(`draggable bug button: ${String(e).slice(0, 110)}`);
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} reported bug(s) not actually fixed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("Every reported control does what it says: reply opens the post, copy link copies the post, the like reaches the server, notifications has a way out, and the Constitution has no version stamp.");
