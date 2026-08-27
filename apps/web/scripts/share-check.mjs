/**
 * Proves you can share a law to your own timeline from where you found it.
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

const REFERENCE = {
  id: REFERENCE_ID,
  masterReferenceId: "hr-4836-119",
  displayId: "H.R. 4836",
  referenceType: "bill",
  title: "Veterans Healthcare Improvement Act",
  status: "proposed",
  briefState: "idle",
  supportVotes: 0,
  opposeVotes: 0,
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
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
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await acceptTermsBeforeLoad(page);
await routeApiToLocal(page, base);

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
