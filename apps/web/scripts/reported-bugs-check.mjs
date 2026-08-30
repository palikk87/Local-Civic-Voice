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
let commentPosts = 0;
let sentMessage = null;

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);
  if (path === "/api/me") return json(SIGNED_IN);
  if (path === "/api/feed") return json({ posts: [POST], hasMore: false, nextCursor: null });

  // A score with a shape a person could actually have.
  if (path === "/api/me/civic-score") {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    return json({
      score: {
        total: 137, level: "newcomer", levelTitle: "New here",
        intoLevel: 137, levelSpan: 250, toNextLevel: 113,
        counts: { votes: 9, posts: 4, comments: 6 },
        earned: { votes: 90, posts: 20, comments: 12 },
        streak: { current: 2, longest: 5, activeToday: true },
        activeDays: [today, yesterday],
        byCategory: [{ category: "economy", votes: 6 }, { category: "health", votes: 3 }],
        badges: [
          { id: "first_vote", name: "First Voice", description: "Cast your first vote on a law", requirement: 1, progress: 1, earned: true },
          { id: "ten_votes", name: "Active Voter", description: "Vote on 10 laws", requirement: 10, progress: 9, earned: false },
          { id: "thousand_votes", name: "Thousand Voices", description: "Cast 1,000 votes", requirement: 1000, progress: 9, earned: false },
        ],
        levels: [
          { id: "newcomer", title: "New here", min: 0, max: 249, reached: true },
          { id: "citizen", title: "Engaged Citizen", min: 250, max: 749, reached: false },
          { id: "leader", title: "Democracy Leader", min: 7750, max: 20000, reached: false },
        ],
      },
    });
  }

  // Somebody to share with, the send itself, and the thread it lands in.
  if (path === "/api/users/discover") {
    return json({ results: [{ id: "u2", username: "friend", displayName: "A Friend", avatar: null }] });
  }
  if (path === "/api/messages/conversations" && req.method === "POST") {
    let body = "";
    await new Promise((r) => { req.on("data", (c) => (body += c)); req.on("end", r); });
    try { sentMessage = JSON.parse(body).message ?? null; } catch { sentMessage = null; }
    return json({ conversation: { id: "conv1", participants: [] }, message: null, isNew: true });
  }
  if (path === "/api/messages/conversations/conv1") {
    return json({
      conversation: { id: "conv1", participants: [
        { id: "u1", username: "t", name: "Test Reader", image: null },
        { id: "u2", username: "friend", name: "A Friend", image: null },
      ] },
      messages: sentMessage
        ? [{ id: "m1", senderId: "u1", content: sentMessage, createdAt: new Date().toISOString() }]
        : [],
      hasMore: false,
    });
  }
  if (path === `/api/posts/${POST.id}`) return json({ post: { ...POST, commentsCount: 0, likesCount: 3 } });
  if (path.startsWith("/api/government-references/")) {
    return json({ reference: { id: "ref1", title: "Kids Off Social Media Act", displayId: "S. 278" } });
  }
  if (path === `/api/posts/${POST.id}/like` && req.method === "POST") {
    likeCalls += 1;
    return json({ liked: true });
  }
  if (path === `/api/posts/${POST.id}/comments` && req.method === "POST") {
    commentPosts += 1;
    return json({ comment: { id: "c1" } });
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

// --- "it takes me to my own timeline" and "there should be a comment section
//      to every post" -------------------------------------------------------
//
// Reply first went to the reader's own timeline, which contained neither the
// post nor anything to reply to. Sending it to the post's page fixed that and
// was still wrong: you had to leave whatever you were reading to write one
// sentence, then find your way back. The conversation opens in the card now,
// so this asserts the thread appears AND that the page did not change.
try {
  const p = await page("/feed");
  const before = p.url();
  const reply = p.getByRole("button", { name: /^reply$/i });
  if (!(await reply.count())) {
    failures.push("no Reply button on the feed, so it could not be exercised");
  } else {
    await reply.first().click();
    await p.waitForTimeout(900);

    if (p.url() !== before) {
      failures.push(`Reply navigated to ${p.url()} instead of opening the conversation in place`);
    }
    const box = p.getByPlaceholder(/write a comment/i);
    if (!(await box.count())) {
      failures.push("Reply did not open a comment box on the card");
    } else {
      // And it has to be the real one: writing here must reach the server.
      await box.first().fill("a comment written from the feed");
      await p.getByRole("button", { name: /post comment/i }).first().click();
      await p.waitForTimeout(900);
      if (commentPosts === 0) {
        failures.push("a comment written in the feed never reached the server");
      }
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

// --- "so does that mean you can send someone a message via sharing a post.
//      and that post lands in their inbox where they can click on it and be
//      guided to the post?" -----------------------------------------------
//
// It sent, and it arrived as a bare URL in a chat bubble that could not be
// tapped. The answer to that question was "half". This shares a post to a
// person, opens the thread, and requires that what arrived is something you
// can click that leads to the post.
try {
  const p = await page("/feed");

  await p.getByRole("button", { name: /^share$/i }).first().click();
  await p.waitForTimeout(700);
  await p.getByRole("button", { name: /message/i }).first().click();
  await p.waitForTimeout(500);

  const person = p.getByText("A Friend").first();
  if (!(await person.count())) {
    failures.push("nobody to share with, so sending could not be exercised");
  } else {
    await person.click();
    await p.getByRole("button", { name: /send message/i }).first().click();
    await p.waitForTimeout(900);

    if (!sentMessage) {
      failures.push("sharing to a person never reached the server");
    } else if (!/\/(post|reference)\//.test(sentMessage)) {
      failures.push(`the message sent carries no link to what was shared: ${sentMessage}`);
    }
  }
  await p.close();

  // And what it looks like when it arrives.
  const thread = await page("/conversation/conv1");
  // Something tappable, carrying the REAL title read from the server rather
  // than a copy pasted in when it was sent.
  const card = thread.locator('a[href^="/post/"], a[href^="/reference/"]');
  if (!(await card.count())) {
    failures.push("the shared post arrived with nothing to click");
  } else {
    const shown = await thread.evaluate(() => document.body.innerText);
    if (!/Kids Off Social Media Act/.test(shown)) {
      failures.push("the card does not show what it points at");
    }
    const href = await card.first().getAttribute("href");
    await card.first().click();
    await thread.waitForTimeout(900);
    if (!thread.url().includes(href)) {
      failures.push(`tapping the shared card went to ${thread.url()} rather than ${href}`);
    }
  }
  // A bare URL is not a summary of a message.
  const raw = await thread.evaluate(() => document.body.innerText);
  if (/https?:\/\/[^\s]*\/post\//.test(raw)) {
    failures.push("the raw URL is still printed in the thread");
  }
  await thread.close();
} catch (e) {
  failures.push(`share to a message: ${String(e).slice(0, 110)}`);
}

// --- "it just takes you to your profile rather opening up the feature
//      further" and "shows 1 thing on my computer but something else on my
//      phone" ----------------------------------------------------------------
//
// The plaque read a score kept in localStorage, so two devices disagreed, and
// pressing it opened the reader's profile rather than anything about the score.
try {
  const p = await page("/feed");

  // The number on the plaque is the server's, not a remembered one.
  const shown = await p.evaluate(() => document.body.innerText);
  if (!shown.includes("137")) {
    failures.push("the plaque does not show the score the server counted");
  }
  // The plaque is styled uppercase and innerText returns RENDERED text, so
  // this matches without regard to case rather than asserting a style.
  if (!/new here/i.test(shown)) {
    failures.push("the plaque does not show the level the server named");
  }

  const plaque = p.getByRole("button", { name: /civic score/i });
  if (!(await plaque.count())) {
    failures.push("no civic score plaque on the feed");
  } else {
    await plaque.first().click();
    await p.waitForTimeout(1200);
    if (p.url().includes("/profile")) {
      failures.push("the civic score plaque still opens the profile");
    } else if (!p.url().includes("/civic-score")) {
      failures.push(`the plaque opened ${p.url()} rather than the civic score page`);
    } else {
      // And the page has to explain the number rather than just repeat it.
      const page2 = await p.evaluate(() => document.body.innerText);
      for (const [what, needle] of [
        ["the score", "137"],
        ["where it came from", "Where it came from"],
        ["the vote count behind it", "9"],
        ["the streak", "longest ever"],
        ["that it is not a ranking", "not a ranking"],
        ["badges", "Badges"],
        ["a locked badge and what earns it", "Thousand Voices"],
        ["the whole ladder", "Levels"],
        ["where the votes go", "Where your votes go"],
        ["the activity history", "The last twelve weeks"],
      ]) {
        if (!page2.includes(needle)) {
          failures.push(`the civic score page does not show ${what}`);
        }
      }
    }
  }
  await p.close();
} catch (e) {
  failures.push(`civic score: ${String(e).slice(0, 110)}`);
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} reported bug(s) not actually fixed:\n`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("Every reported control does what it says: reply opens the post, copy link copies the post, the like reaches the server, notifications has a way out, and the Constitution has no version stamp.");
