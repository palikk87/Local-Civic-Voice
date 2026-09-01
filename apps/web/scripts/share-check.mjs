/**
 * Proves you can share a law to My Voice — your own timeline, which is what the
 * route is still called — from wherever you found it.
 *
 *   bun run share-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Sharing lived in exactly one place: inside the Citizen's
 * Brief panel, behind a brief. Seeing a law in Discover or Trending there was
 * no way to say "that one matters to me" — the only route was to open it,
 * generate a brief, and share from there. The thing a person most wants to do
 * at the moment they feel something took four steps and a wait.
 *
 * Three things are pinned here, and the second is the one that matters most:
 *
 *   1. The share control exists on a law where a person actually finds one.
 *   2. It RESOLVES to the master reference before sharing. Cards carry two
 *      different kinds of id on this platform, and a post pointing at the wrong
 *      one joins nobody's vote count.
 *   3. It does not post for you. It opens the composer with the law attached
 *      and waits — the post is theirs, so the words are too.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const REFERENCE_ID = "ref_master_0001";

/** Everything the page asked the server to do, in order. */
const resolves = [];
const posts = [];

/**
 * Every API path the page asked for, in the order it asked.
 *
 * The law page used to fire all ten of its requests at once, so the brief a
 * reader came for queued behind five panels 1,500px down the screen. Nothing
 * was dropped in the fix and nothing should be: this records the ORDER, and
 * the assertion at the bottom is that the top of the page is asked for before
 * the bottom of it — not that the bottom is skipped.
 */
const askedFor = [];

const REFERENCE = {
  id: REFERENCE_ID,
  masterReferenceId: "hr-4836-119",
  displayId: "H.R. 4836",
  referenceType: "bill",
  title: "Veterans Healthcare Improvement Act",
  status: "proposed",
  // A real record has both. Without them the page's metadata row does not
  // render at all, which is not what a law looks like — and it is the row the
  // styling comparison below measures against.
  introducedDate: "2026-08-24T00:00:00.000Z",
  lastActionDate: "2026-08-24T00:00:00.000Z",
  briefState: "idle",
  supportVotes: 0,
  opposeVotes: 0,
  // The two shapes the page reads straight off the record without guarding:
  // votes.total (the vote panel) and engagement.comments (the counts row).
  // Neither was in this fixture, so the record page threw into its error
  // boundary and this check spent its whole run asserting against "Something
  // went wrong". A stub gap rather than a product bug — but a stub gap that
  // made the check unable to see the button it exists to press, which is
  // exactly the failure mode it was written to catch.
  votes: { support: 0, oppose: 0, total: 0 },
  engagement: { comments: 0, shares: 0, posts: 0 },
};

/** One person, already talking about this law. */
const CONVERSATION_POST = {
  id: "post_conversation_1",
  content: "This one changes what my VA clinic can bill for. Worth reading past the title.",
  author: { id: "u2", displayName: "Dana Whitfield", username: "dwhitfield", avatar: null },
  referenceType: "bill",
  referenceId: REFERENCE_ID,
  referenceTitle: "Veterans Healthcare Improvement Act",
  media: [],
  commentsCount: 2,
  likesCount: 4,
  isLiked: false,
  repostsCount: 1,
  isRepostedByMe: false,
  repostOf: null,
  createdAt: new Date().toISOString(),
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  if (path.startsWith("/api/")) askedFor.push({ path, at: performance.now() });
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/api/government-references/resolve" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    resolves.push(JSON.parse(raw || "{}"));
    return json({ reference: REFERENCE });
  }
  if (path === `/api/government-references/${REFERENCE_ID}`) {
    return json({ reference: REFERENCE });
  }
  if (path === "/api/posts" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    posts.push(JSON.parse(raw || "{}"));
    return json({ post: { id: "post_1" } }, 201);
  }
  // A signed-in reader, so the share control is live rather than an auth prompt.
  if (path === "/api/me") {
    return json({ user: { id: "u1", name: "Test Reader", email: "reader@example.com" } });
  }
  if (path.startsWith("/api/auth/get-session")) {
    return json({ user: { id: "u1", name: "Test Reader", email: "reader@example.com" }, session: { id: "s1" } });
  }
  // The law page fans out to several endpoints on load. A generic
  // {results,bills,posts} answered them all and crashed the page into its error
  // boundary, so the share button was never on screen to be clicked — which is
  // how a check meant to press it ended up proving nothing.
  if (/\/api\/government-references\/[^/]+\/vote-details$/.test(path)) {
    return json({
      support: { total: 0, direct: 0, delegated: 0 },
      oppose: { total: 0, direct: 0, delegated: 0 },
      total: 0,
    });
  }
  if (/\/api\/government-references\/[^/]+\/(pulse-history|turning-points)$/.test(path)) {
    return json({ points: [], history: [] });
  }
  if (/\/api\/government-references\/[^/]+\/other-side$/.test(path)) {
    return json({ posts: [] });
  }
  // The conversation under the record. One post, because the thing being
  // proved is not that a list renders — it is that what renders is a post you
  // can reply to and like. An empty list would pass a "the section exists"
  // check while the section itself did nothing.
  if (/\/api\/government-references\/[^/]+\/posts$/.test(path)) {
    return json({ posts: [CONVERSATION_POST] });
  }
  if (/\/api\/government-references\/[^/]+\/representation-gap$/.test(path)) {
    return json({ gap: null });
  }
  if (path.startsWith("/api/audits")) return json({ audits: [], audit: null });
  if (path.startsWith("/api/juries")) return json({ juries: [], seat: null });
  if (path.startsWith("/api/notifications")) return json({ preferences: {}, notifications: [], unread: 0 });
  if (path.startsWith("/api/delegations")) return json({ receipts: [], delegations: [] });

  if (path.startsWith("/api/")) return json({ results: [], bills: [], posts: [] });

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
  // The detail is the diagnosis of a failure, so it only prints on one. Printed
  // beside a pass it reads as a contradiction — "ok ... — no share button".
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
page.on("requestfailed", (r) => pageErrors.push(`failed: ${r.url().slice(-70)} ${r.failure()?.errorText}`));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console: ${m.text().slice(0, 300)}`);
});
await acceptTermsBeforeLoad(page);
await routeApiToLocal(page, base);

// ---------------------------------------------------------------------------
// THE HALF THIS CHECK WAS MISSING, AND IT IS THE HALF THAT BROKE.
//
// Everything below used to start here, by navigating STRAIGHT to
// /timeline?share=<id>. That proves the destination works and proves nothing
// about whether anything gets you there — so when the share button on the law
// page stopped doing anything at all, this check went on passing.
//
// Reported from the live site and confirmed with a real coordinate click: the
// control is present, enabled, correctly labelled, wired to a handler, and
// pressing it produced no navigation, no network request and no error. A test
// asserting the button exists passes that. A test asserting the URL changes
// after clicking it does not.
// ---------------------------------------------------------------------------

await page.goto(`${base}/reference/${REFERENCE_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const shareButton = page.getByRole("button", { name: /share .* to my voice/i }).first();
if ((await shareButton.count()) === 0 && process.env.SHARE_CHECK_DEBUG) {
  console.log("PAGE TEXT:", (await page.evaluate(() => document.body.innerText)).slice(0, 600));
  console.log("ERRORS:", pageErrors.filter((e) => !/display=swap|ERR_CONNECTION_RESET/.test(e)).slice(0, 8));
  console.log("BUTTONS:", await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.innerText.trim()).slice(0, 25)));
}
check("the law page offers a share control", (await shareButton.count()) > 0, "no share button");

const resolvesBefore = resolves.length;
const postsBefore = posts.length;
await shareButton.click();

// The whole point: the address has to change. Polled rather than asserted once,
// because the handler resolves the law before it navigates.
//
// It waits for /timeline and NOT for share= in the address. The parameter is
// deliberately consumed on arrival — the last check in this file is the one
// that pins that — so testing for it here is a race the product wins about half
// the time. What matters is where the reader ends up, and what is waiting for
// them when they get there.
let arrived = false;
for (let i = 0; i < 40 && !arrived; i += 1) {
  arrived = page.url().includes("/timeline");
  if (!arrived) await page.waitForTimeout(250);
}

check(
  "PRESSING IT ACTUALLY GOES SOMEWHERE",
  arrived,
  `after clicking, the address was still ${page.url()}`,
);

check(
  "and it resolved the law to its master record on the way",
  resolves.length > resolvesBefore,
  `resolve calls: ${resolves.length - resolvesBefore}`,
);

// AND WHAT IT WENT THERE FOR IS ON THE SCREEN.
//
// Arriving at /timeline is not the outcome; arriving with the law already
// attached to a composer is. A share that navigates and drops the law is a
// button that "works" and does nothing, which is the exact failure this file
// was rewritten to stop passing.
let landedWithTheLaw = 0;
for (let i = 0; i < 24 && landedWithTheLaw === 0; i += 1) {
  landedWithTheLaw = await page.getByText(REFERENCE.title).count();
  if (landedWithTheLaw === 0) await page.waitForTimeout(250);
}

check(
  "AND THE LAW IS WAITING IN THE COMPOSER WHEN IT GETS THERE",
  landedWithTheLaw > 0,
  "landed on the timeline with nothing attached",
);

check(
  "pressing share still did not post anything for the reader",
  posts.length === postsBefore,
  `posts=${JSON.stringify(posts.slice(postsBefore))}`,
);

// ---------------------------------------------------------------------------
// PRESENT IS NOT THE SAME AS FINDABLE.
//
// The control was there the whole time and the owner of the product could not
// see it. Measured on the live site: colour rgb(143,168,156), 12px, no
// background, no outline — the same colour and the same size as the "0
// comments" and "0 shares" counts sitting beside it. Nothing separated the one
// item you can press from the two you cannot.
//
// "The button exists" passed that. So this asserts the thing that was actually
// wrong: an action has to look different from the passive text printed near it.
//
// IT COMPARES AGAINST THE METADATA NOW, not against those counts. The counts
// are gone — two dead numbers stacked on two live buttons, and "comments" was
// untrue of a law besides. Which quietly hollowed this check out: the compare
// target disappeared, the evaluate returned "share only", and the distinctness
// assertion stopped running while the line above it went on printing ok. A
// check that cannot fail is worse than no check, because it is trusted.
//
// The muted metadata line ("Introduced …") is the better comparison anyway. It
// is the passive grey text this page is full of, and the exact register the
// share control must not sit in.
// ---------------------------------------------------------------------------

await page.goto(`${base}/reference/${REFERENCE_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

const looks = await page.evaluate(() => {
  const share = [...document.querySelectorAll("button")].find((b) =>
    /to my voice/i.test(b.getAttribute("aria-label") ?? ""),
  );
  if (!share) return { missing: "share" };

  // Passive page text, in the muted register: the record's own metadata.
  const quiet = [...document.querySelectorAll("span, p, div")].find((n) => {
    const text = (n.textContent ?? "").trim();
    if (!/^(Introduced|Last action)\b/i.test(text)) return false;
    // The line wraps an icon, so it is never childless — but it must be the
    // line itself rather than a container that happens to start with it.
    return [...n.children].every((child) => child.tagName.toLowerCase() === "svg");
  });
  if (!quiet) return { missing: "metadata" };

  const s = getComputedStyle(share);
  const c = getComputedStyle(quiet);
  const opaque = (v) => v && v !== "transparent" && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(v);

  return {
    sameColour: s.color === c.color,
    sameSize: s.fontSize === c.fontSize,
    filled: opaque(s.backgroundColor),
    outlined: s.borderTopWidth !== "0px",
    heavier: parseInt(s.fontWeight, 10) > parseInt(c.fontWeight, 10),
    share: { color: s.color, fontSize: s.fontSize, background: s.backgroundColor },
    quiet: { color: c.color, fontSize: c.fontSize, text: (quiet.textContent ?? "").trim().slice(0, 40) },
  };
});

// No "shareOnly" escape hatch. If either half is missing, that is a failure —
// not a reason to skip the comparison.
check(
  "the share control and the page's quiet text are both there to compare",
  looks && !looks.missing,
  `missing: ${looks?.missing ?? "both"}`,
);

// And the dead counts row is gone for good.
const deadCounts = await page.evaluate(() =>
  /\d+\s+comments|\d+\s+shares/i.test(document.body.innerText),
);
check("the law page prints no comment or share count", !deadCounts, "a counts row is back");

if (looks && !looks.missing) {
  check(
    "THE SHARE CONTROL DOES NOT LOOK LIKE A DEAD COUNT",
    looks.filled || looks.outlined || !looks.sameColour || looks.heavier,
    `share ${JSON.stringify(looks.share)} vs count ${JSON.stringify(looks.count)} — ` +
      `same colour: ${looks.sameColour}, same size: ${looks.sameSize}, ` +
      `filled: ${looks.filled}, outlined: ${looks.outlined}`,
  );
}

// ---------------------------------------------------------------------------
// THE CONVERSATION THE COUNT HAD BEEN ADVERTISING WITH NO WAY IN.
//
// "0 comments" sat on this page as a number with nowhere to go. The posts
// existed — the endpoint had always returned them — but the record page never
// asked for them, so the count was pointing at something the reader could not
// reach. The section below is that something, and these checks are about what
// a reader can DO once they are in it, not that a heading rendered.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE PAGE ASKS FOR THE TOP OF ITSELF FIRST.
//
// Ten requests used to leave together. Five of them paint panels far below the
// fold — the representation gap, the pulse history, the turning points, the
// other side, the integrity audit — and the browser opened them before it had
// finished painting the top of the screen, so the brief landed at about four
// seconds behind things nobody had scrolled to.
//
// ALL TEN STILL RUN. This asserts the order, and separately asserts that the
// bottom ones happen at all, because "faster because it stopped asking" is the
// wrong fix and would otherwise pass an ordering test trivially.
// ---------------------------------------------------------------------------
{
  const when = (re) => askedFor.find((r) => re.test(r.path))?.at ?? null;

  const record = when(new RegExp(`^/api/government-references/${REFERENCE_ID}$`));
  const belowTheFold = [
    ["representation gap", /\/representation-gap$/],
    ["pulse history", /\/pulse-history$/],
    ["turning points", /\/turning-points$/],
    ["the other side", /\/other-side$/],
  ];

  const summary = askedFor
    .map((r) => `${r.path.replace("/api/government-references/", "…/")}@${Math.round(r.at - record)}ms`)
    .join(" ");

  check("the record itself is asked for", record !== null, summary);
  if (process.env.SHARE_CHECK_TIMELINE) console.log("TIMELINE:", summary);

  /**
   * MEASURED AGAINST THE VOTE PANEL, IN TIME, BECAUSE THAT IS WHERE THE BURST
   * ACTUALLY WAS.
   *
   * Two earlier versions of this check passed with the fix turned off, and both
   * failures are worth recording because both looked reasonable.
   *
   * Comparing LIST POSITION was meaningless: React renders the top of the tree
   * before the bottom, so the record request always left first anyway.
   *
   * Comparing against THE RECORD in time was meaningless too, for a subtler
   * reason — none of these panels exist until the record resolves, because they
   * live inside the branch that renders once the reference has loaded. So every
   * one of them was already ~55ms behind the record, fix or no fix. The premise
   * that ten requests leave together at page load was simply wrong.
   *
   * Measured, with the fix off:
   *   record @0  posts @53  vote-details @55  gap @56  pulse @57
   *   turning @62  other-side @64
   * Eight requests inside an eleven-millisecond window, all released the
   * instant the record came back. THAT was the burst.
   *
   * With the fix on:
   *   vote-details @51  posts @79  gap @125  pulse @130  turning @130
   *   other-side @130
   * Three waves — the vote panel, then the conversation, then the sidebar.
   *
   * So the anchor is vote-details, the first thing asked for after the record
   * and the top of what a reader sees. 30ms sits between a 1-9ms burst and a
   * 74-79ms stagger, nowhere near either edge.
   */
  const anchor = when(/\/vote-details$/);
  /*
   * FAR ENOUGH APART TO BE A SEPARATE WAVE, not far enough to measure jitter.
   *
   * This was 30ms and flaked: three runs of the same build gave 27ms, and two
   * passes. Nothing about the page had changed — that is the browser's frame
   * scheduler, and a check that fails on it teaches people to re-run rather
   * than to look.
   *
   * What "one burst" actually looks like, from the dumps: every request in a
   * wave carries the SAME millisecond (…/posts@54ms, …/vote-details@54ms,
   * …/preferences@54ms). Before the load-order fix all eight went out inside an
   * 11ms window. So a regression to one burst shows single-digit gaps, and 15ms
   * still catches it with room to spare while sitting clear of the noise.
   */
  const STAGGER_MS = 15;

  check("the vote panel is asked for", anchor !== null, summary);

  for (const [name, pattern] of belowTheFold) {
    const at = when(pattern);
    check(
      `${name} is still requested — nothing was dropped`,
      at !== null,
      `never asked for. ${summary}`,
    );
    check(
      `THE VOTE PANEL IS ASKED FOR BEFORE ${name.toUpperCase()}, WITH ROOM TO BREATHE`,
      anchor !== null && at !== null && at - anchor >= STAGGER_MS,
      `${name} left ${at === null || anchor === null ? "never" : `${Math.round(at - anchor)}ms`} ` +
        `after the vote panel — under ${STAGGER_MS}ms means they went out in one burst. ${summary}`,
    );
  }
}

const conversation = await page.evaluate(() => !!document.querySelector("#conversation"));
check("the page carries the conversation itself, not a count of it", conversation, "no #conversation section");

const inside = await page.evaluate(() => {
  const section = document.querySelector("#conversation");
  if (!section) return null;
  const named = (label) =>
    [...section.querySelectorAll("button, a")].filter(
      (n) => (n.getAttribute("aria-label") ?? "").toLowerCase() === label,
    ).length;
  return {
    showsThePost: /Dana Whitfield/.test(section.textContent ?? ""),
    like: named("like"),
    comment: named("comment"),
    repost: named("repost"),
  };
});

check("a post about this law shows up under it", inside?.showsThePost, JSON.stringify(inside));
check("and it can be liked from here", (inside?.like ?? 0) > 0, `like controls: ${inside?.like}`);
check("and replied to from here", (inside?.comment ?? 0) > 0, `comment controls: ${inside?.comment}`);
check("and passed on from here", (inside?.repost ?? 0) > 0, `repost controls: ${inside?.repost}`);

// Sharing to a PERSON, which is the other half of what share means and had no
// control anywhere on this page.
const toSomeone = await page
  .getByRole("button", { name: /^send .+ to someone$/i })
  .count();
check("the law can also be sent to a person, not only to a timeline", toSomeone > 0, `matches=${toSomeone}`);

// The composer, reached the way a share arrives: with a law already resolved.
await page.goto(`${base}/timeline?share=${REFERENCE_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const attached = await page.getByText("Veterans Healthcare Improvement Act").count();
check("a shared law arrives attached to the composer", attached > 0, `matches=${attached}`);

check(
  "and nothing was posted on the reader's behalf",
  posts.length === 0,
  `posts=${JSON.stringify(posts)}`,
);

// The share parameter is consumed, so a refresh does not silently re-attach a
// law the reader may have just taken off the post.
check(
  "the share parameter is cleared once used",
  !page.url().includes("share="),
  `url=${page.url()}`,
);

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} share check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nA law shared from anywhere reaches the composer, attached, unposted.");
