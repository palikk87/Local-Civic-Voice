/**
 * A name on this platform reaches the person, and a profile shows their record.
 *
 *   bun run profile-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Two findings from walking the live app, and they are the
 * same finding twice.
 *
 * First: nothing was clickable. A post showed an author's name and avatar and
 * both were plain text — in the feed, in a comment, on a repost attribution, in
 * search results. The only route to anybody's profile was the People page. So
 * on a platform whose premise is that positions are public and attributable,
 * you could read somebody's argument and have no way to find out what they had
 * ever voted for.
 *
 * Second: even having got there, the profile did not tell you. It showed a bio,
 * follower counts and a list of posts — everything a generic social profile
 * shows, and nothing this platform exists for. The record lived at /record,
 * behind its own sidebar item, and mostly for yourself.
 *
 * Both are the sort of gap a typecheck cannot see: the markup is valid, the
 * page renders, and the thing simply is not a link. Only a click finds it.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const ME = { id: "u1", name: "Test Reader", username: "reader", email: "reader@example.com" };
const OTHER = { id: "u2", displayName: "Dolores Herrera", username: "dolores" };

const SIGNED_IN = { user: ME, session: { id: "s1" } };

/** Conversations the page asked us to start. */
const started = [];

const POST = {
  id: "post_1",
  content: "This one matters.",
  author: { id: OTHER.id, displayName: OTHER.displayName, username: OTHER.username, avatar: "" },
  referenceType: null,
  referenceId: null,
  referenceTitle: null,
  commentsCount: 0,
  likesCount: 0,
  createdAt: new Date().toISOString(),
  media: [],
  isLiked: false,
};

const POSITIONS = {
  results: [
    {
      id: "pe_1",
      position: "support",
      reason: null,
      isChange: false,
      lawVersion: 1,
      isAnonymous: false,
      createdAt: new Date().toISOString(),
      lawMovedSince: false,
      reference: {
        id: "ref_1",
        masterReferenceId: "hr-4836-119",
        title: "Veterans Healthcare Improvement Act",
        referenceType: "bill",
        lawVersion: 1,
      },
    },
  ],
  nextCursor: null,
  summary: { total: 1, support: 1, oppose: 0, withdrawn: 0, changesOfMind: 0, standingOnOldText: 0 },
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/api/me") return json(SIGNED_IN);
  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);

  if (path === `/api/users/${OTHER.id}/positions`) return json(POSITIONS);
  if (path === `/api/users/${ME.id}/positions`) return json(POSITIONS);

  if (path === `/api/users/${OTHER.id}`) {
    return json({
      id: OTHER.id,
      username: OTHER.username,
      displayName: OTHER.displayName,
      avatar: "",
      bio: "",
      location: "",
      joinedDate: new Date().toISOString(),
      followers: 3,
      following: 2,
      votesCount: 1,
      isFollowing: false,
    });
  }

  if (path === "/api/messages/conversations" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    started.push(JSON.parse(raw || "{}"));
    return json({ conversation: { id: "conv_1", participants: [] }, message: null, isNew: true });
  }

  if (path === "/api/posts" || path.startsWith("/api/posts")) {
    return json({ posts: [POST], results: [POST], hasMore: false, nextCursor: null });
  }

  if (path.startsWith("/api/")) {
    return json({
      results: [], posts: [], bills: [], items: [], comments: [], references: [],
      conversations: [], delegations: [], count: 0, hasMore: false, nextCursor: null,
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
const failures = [];

function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await routeApiToLocal(page, base);

// ------------------------------------------------- 1. a name reaches a person

await page.goto(`${base}/timeline`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const nameLink = page.getByRole("link", { name: OTHER.displayName }).first();
let landed = "(not clicked)";
try {
  await nameLink.click({ timeout: 5000 });
  await page.waitForTimeout(600);
  landed = new URL(page.url()).pathname;
} catch (error) {
  landed = `(${String(error).split("\n")[0].slice(0, 70)})`;
}
check("an author's name in a timeline reaches their profile", landed === `/user/${OTHER.id}`,
  `-> ${landed}`);

// ------------------------------------------- 2. the profile shows their record

await page.goto(`${base}/user/${OTHER.id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

const recordHeading = await page.getByText("Their record", { exact: false }).count();
check("a public profile shows their record", recordHeading > 0, `matches=${recordHeading}`);

const position = await page.getByText("Veterans Healthcare Improvement Act").count();
check("with the positions they have taken on it", position > 0, `matches=${position}`);

// The two private sections must NOT be on somebody else's profile.
const alone = await page.getByText("Where you stand alone").count();
const spoken = await page.getByText("Spoken in your name").count();
check("and not the two sections that are only for its owner", alone === 0 && spoken === 0,
  `alone=${alone} spoken=${spoken}`);

// ------------------------------------------------- 3. you can start a message

let messaged = "(not clicked)";
try {
  await page.getByRole("button", { name: "Message", exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(800);
  messaged = new URL(page.url()).pathname;
} catch (error) {
  messaged = `(${String(error).split("\n")[0].slice(0, 70)})`;
}
check("Message opens a conversation with them", messaged === "/conversation/conv_1",
  `-> ${messaged}`);
check("addressed to the person whose profile it is",
  started.length === 1 && started[0]?.participantId === OTHER.id,
  `started=${JSON.stringify(started)}`);

await context.close();
await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} profile check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nA name reaches the person, their profile shows their record, and you can write to them.");
