/**
 * A law can be found, followed, previewed and read without JavaScript.
 *
 *   node scripts/findable-check.mjs dist     (after `npm run build`)
 *
 * WHY THIS EXISTS. Measured on production before any of it was built: Google
 * had one indexable page for the whole platform. No sitemap, one site-wide
 * title, and — the mechanism nobody had spotted — no crawlable link to any
 * record, because "See details" was a <button> and a crawler follows hrefs.
 *
 * Every one of those failures compiles and typechecks perfectly. A test that
 * loads the app in a browser and asserts the words appear would pass on all of
 * them too, because the app itself was never broken. The only way to catch
 * these is to look at what a crawler is actually handed, which is what this
 * does: the HTML as served, with JavaScript switched off.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, only through
 * TEST_POPULATION_DATABASE_URL. It creates two records prefixed "findable" and
 * removes them on the way out.
 */
import { launchChromium, acceptTermsBeforeLoad, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat, rm } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const DIST = resolve(process.argv[2] ?? "dist");
const BACKEND = resolve(process.cwd(), "..", "..", "backend");

const POPULATION_URL =
  process.env.TEST_POPULATION_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_population";

if (!/population/i.test(new URL(POPULATION_URL).pathname)) {
  console.error(`Refusing to run against "${new URL(POPULATION_URL).pathname}".`);
  process.exit(1);
}

const API_PORT = Number(process.env.FINDABLE_CHECK_PORT ?? 3991);
const API = `http://127.0.0.1:${API_PORT}`;
/*
 * REAL-SHAPED IDS, in a range no real order occupies.
 *
 * The first version of this prefixed them ("findable-eo-99001") and the slug
 * came out as the prefix — correctly, because that is not an executive order
 * number and reference-slug refuses to pretend otherwise. Cleanup keys off
 * these two exact ids instead.
 */
const IDS = ["eo-99001", "eo-99002", "hr-99001-119"];
const LISTED_TITLE = "An order that has something on it worth reading";
const UNLISTED_TITLE = "An order nobody has touched or written about";
const BILL_TITLE = "A bill the Docket opens on";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${String(detail).slice(0, 170)}` : ""}`);
  if (!ok) failures.push(label);
}

function db(snippet) {
  return execFileSync("bun", ["-e",
    `const { PrismaClient } = require("@prisma/client");
     const prisma = new PrismaClient({ datasources: { db: { url: process.env.POP_URL } } });
     (async () => { ${snippet} await prisma.$disconnect(); })();`],
    {
      cwd: BACKEND,
      // DATABASE_URL as well as POP_URL: a snippet that requires one of the
      // backend's services pulls in src/prisma.ts, which builds its own client
      // from DATABASE_URL at import. Without it that client points at nothing
      // and every call through the service fails.
      env: {
        ...process.env,
        POP_URL: POPULATION_URL,
        DATABASE_URL: POPULATION_URL,
        DIRECT_URL: POPULATION_URL,
      },
      encoding: "utf8",
    }).trim();
}

function cleanUp() {
  try {
    db(`await prisma.governmentReference.deleteMany({ where: { masterReferenceId: { in: ${JSON.stringify(IDS)} } } });`);
  } catch { /* reported by the caller */ }
}

const api = spawn("bun", ["src/index.ts"], {
  cwd: BACKEND,
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(API_PORT),
    DATABASE_URL: POPULATION_URL,
    DIRECT_URL: POPULATION_URL,
    BACKEND_URL: API,
    BETTER_AUTH_SECRET: "findable-check-secret-not-used-anywhere-else",
    APP_ORIGINS: "http://127.0.0.1:4173",
    APP_SCHEMES: "ayeandnay",
    MEDIA_STORAGE: "local",
    UPLOADS_DIR: join(BACKEND, ".findable-check-uploads"),
    HEALTH_SCHEMA_TTL_MS: "0",
    CIVIC_NO_BACKGROUND_SYNC: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (d) => { apiLog += d; });
api.stderr.on("data", (d) => { apiLog += d; });
process.on("exit", () => { api.kill("SIGKILL"); });

async function waitForApi() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the API never came up on ${API}\n${apiLog.slice(-2000)}`);
}

let server, browser;

try {
  await waitForApi();
  cleanUp();

  // One record with something on it, one with nothing. The rule under test is
  // that the first is advertised and the second is not.
  const listedId = db(`
    const row = await prisma.governmentReference.create({ data: {
      masterReferenceId: "eo-99001", referenceType: "executive_order",
      title: ${JSON.stringify(LISTED_TITLE)}, status: "active", category: "economy",
      citizenBrief: "In plain English: this order directs an agency to do a specific thing by a specific date.",
      signedDate: new Date("2025-03-04T00:00:00Z"),
    }});
    console.log(row.id);
  `);
  db(`
    await prisma.governmentReference.create({ data: {
      masterReferenceId: "eo-99002", referenceType: "executive_order",
      title: ${JSON.stringify(UNLISTED_TITLE)}, status: "active", category: "economy",
    }});
  `);

  /*
   * AND A BILL, because the Docket opens on Legislation.
   *
   * The anchor assertion at the bottom of this file loads /discover and looks
   * for a link to a record. Its first version seeded executive orders only, so
   * the page it landed on said "0 bills" and it reported "no anchor to any
   * record anywhere on the page" — a sentence that reads like the links had
   * been deleted, when what had happened is that this check never gave the tab
   * it was looking at anything to list.
   *
   * It passed for a while on a database that still held records other checks
   * had left behind. A check that only works when somebody else's leftovers are
   * present is not a check; it seeds what it intends to look at.
   */
  db(`
    await prisma.governmentReference.create({ data: {
      masterReferenceId: "hr-99001-119", referenceType: "bill",
      title: ${JSON.stringify(BILL_TITLE)}, status: "active", category: "economy", chamber: "house",
      congress: 119,
      citizenBrief: "In plain English: this bill sets a deadline and names who has to meet it.",
      introducedDate: new Date("2025-03-04T00:00:00Z"),
      lastActionDate: new Date("2025-03-06T00:00:00Z"),
    }});
  `);

  // ------------------------------------------------------- a readable address
  const slug = db(`
    const { ensureSlug } = require("${BACKEND}/src/services/reference-slug.ts");
    console.log(await ensureSlug("${listedId}"));
  `);
  check("A RECORD GETS AN ADDRESS A PERSON COULD HAVE TYPED", slug === "eo-99001", slug);

  const bySlug = await fetch(`${API}/api/government-references/${slug}`);
  const byId = await fetch(`${API}/api/government-references/${listedId}`);
  check("…and it answers on that address", bySlug.status === 200, `HTTP ${bySlug.status}`);
  check("…and still on the one every old link uses", byId.status === 200, `HTTP ${byId.status}`);

  // ------------------------------------------------------------- the sitemap
  const sitemap = await fetch(`${API}/api/sitemap`);
  const xml = await sitemap.text();
  check("THE SITEMAP IS XML, not the app's shell",
    (sitemap.headers.get("content-type") ?? "").includes("xml") && xml.startsWith("<?xml"),
    xml.slice(0, 60));
  check("…and holds the record that has something on it",
    xml.includes("/executive-order/eo-99001"));
  check("…AND NOT THE ONE THAT HAS NOTHING",
    !xml.includes("eo-99002"),
    "a bare record is a .gov page's duplicate with an empty tally on it");

  // -------------------------------------------------- what a crawler is given
  //
  // The whole point. Everything above this line can be true while the file a
  // crawler receives still says "AYE & NAY — Your voice on every bill".
  await rm(join(DIST, "executive-order"), { recursive: true, force: true });
  execFileSync("node", ["scripts/prerender.mjs", DIST], {
    env: { ...process.env, PRERENDER_API_URL: API, PRERENDER_SITE_URL: "http://127.0.0.1:4173" },
    encoding: "utf8",
  });

  const page = await readFile(join(DIST, "executive-order", "eo-99001", "index.html"), "utf8")
    .catch(() => "");
  check("THE FILE A CRAWLER IS HANDED EXISTS", page.length > 0);
  check("…and its title is the law, not the website",
    page.includes(LISTED_TITLE) && /<title>[^<]*Executive Order 99001/.test(page),
    (/<title>([^<]*)<\/title>/.exec(page) ?? [])[1]);
  check("…with the record's own description, not the site's",
    /<meta name="description" content="In plain English/.test(page));
  check("…a canonical pointing at the readable address",
    page.includes('rel="canonical" href="http://127.0.0.1:4173/executive-order/eo-99001"'));
  check("…a share preview that names the law",
    new RegExp(`og:title" content="[^"]*${LISTED_TITLE.slice(0, 20)}`).test(page));
  check("…and structured data describing the record",
    page.includes('application/ld+json') && page.includes('"@type":"Legislation"'));

  // ------------------------------------------ and a picture OF THIS LAW with it
  //
  // A link pasted into a text message or onto Facebook is judged on its
  // picture. Every record used to share one house banner, so the preview said
  // nothing about which law had been sent. These assert the card exists, is a
  // real PNG, and that the shell's generic image was REPLACED rather than
  // joined — two og:image tags is a coin toss, and the generic one winning is
  // the whole bug.
  const cardBytes = await readFile(join(DIST, "og", "eo-99001.png")).catch(() => null);
  check("THE RECORD HAS A SHARE CARD OF ITS OWN", cardBytes !== null && cardBytes.length > 1000,
    cardBytes ? `${cardBytes.length} bytes` : "no file");
  check("…and it is a real PNG, not an empty file",
    cardBytes !== null && cardBytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    cardBytes ? cardBytes.subarray(0, 8).toString("hex") : "none");
  check("…which the page points a preview bot at",
    page.includes('og:image" content="http://127.0.0.1:4173/og/eo-99001.png"'),
    (/og:image" content="([^"]*)"/.exec(page) ?? [])[1]);
  check("…INSTEAD OF the site's banner, not as well as it",
    (page.match(/property="og:image"/g) ?? []).length === 1 && !page.includes("og-aye-and-nay.png"),
    `${(page.match(/property="og:image"/g) ?? []).length} og:image tags`);

  // ------------------------------------- and it reads without any JavaScript
  server = createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    let file = join(DIST, url === "/" ? "index.html" : url);
    try {
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    } catch { file = join(DIST, "index.html"); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/html" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise((r) => server.listen(4173, "127.0.0.1", r));

  browser = await launchChromium();
  const context = await browser.newContext({ javaScriptEnabled: false });
  await acceptTermsBeforeLoad(context).catch(() => undefined);
  const noJs = await context.newPage();
  await noJs.goto("http://127.0.0.1:4173/executive-order/eo-99001", {
    waitUntil: "domcontentloaded",
  });
  const noJsTitle = await noJs.title();
  const noJsText = await noJs.evaluate(() => document.body.innerText ?? "");
  check("A READER WITH NO JAVASCRIPT STILL LEARNS WHAT THIS IS",
    noJsTitle.includes("99001") && noJsText.includes(LISTED_TITLE),
    `${noJsTitle} | ${noJsText.slice(0, 80)}`);
  await context.close();

  // ---------------------------------------------- and a crawler can follow it
  const withJs = await browser.newContext();
  await acceptTermsBeforeLoad(withJs);
  const feed = await withJs.newPage();
  // The same helper every other check uses, rather than a hand-rolled rewrite.
  await routeApiToLocal(feed, API);
  // Discover is the public index of the records we hold — the natural way in
  // for a crawler. (The Library searches congress.gov and CourtListener
  // directly, so its results are not our records and have no page here.)
  await feed.goto("http://127.0.0.1:4173/discover", { waitUntil: "domcontentloaded" });
  await feed.waitForSelector("#root", { timeout: 25_000 });

  // Any anchor to a record at all. A crawler follows hrefs and clicks nothing,
  // so a <button onClick={navigate}> leaves a page unreachable however well it
  // works for a person — which is what put one page of this site in Google.
  //
  // POLLED, NOT SLEPT ON. Discover fetches its records after the shell paints,
  // so a fixed pause is a guess about how fast the machine is — and when the
  // guess ran out this reported "no anchor to any record anywhere on the page",
  // which is the sentence you would write if the links had been deleted.
  const findAnchors = () =>
    feed.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => a.getAttribute("href"))
        .filter((href) => /^\/(bill|executive-order|scotus|reference)\//.test(href ?? "")),
    );
  const seen = [];
  feed.on("response", (r) => {
    if (r.url().includes("/api/")) seen.push(`${r.status()} ${r.url().split("/api/")[1]?.slice(0, 70)}`);
  });
  let anchors = [];
  for (let attempt = 0; attempt < 40 && anchors.length === 0; attempt += 1) {
    anchors = await findAnchors();
    if (anchors.length === 0) await feed.waitForTimeout(500);
  }
  if (anchors.length === 0 && process.env.FINDABLE_CHECK_DEBUG) {
    // What the page actually showed. "No anchors" has several causes and they
    // are indistinguishable without this — the first time it fired, the answer
    // was "0 bills", not a missing link.
    console.log("DEBUG api calls:", JSON.stringify(seen.slice(0, 12)));
    console.log("DEBUG every href:", JSON.stringify(
      await feed.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"))),
    ));
    console.log("DEBUG buttons:", JSON.stringify(
      await feed.evaluate(() => Array.from(document.querySelectorAll("button")).map((b) => (b.innerText || "").trim().slice(0, 40)).slice(0, 20)),
    ));
    console.log("DEBUG page text:", (await feed.evaluate(() => document.body.innerText ?? "")).slice(0, 500).replace(/\n/g, " | "));
  }
  check("THE APP LINKS TO RECORDS WITH ANCHORS A CRAWLER CAN FOLLOW",
    anchors.length > 0,
    anchors.slice(0, 3).join(" ") || "no <a href> to any record anywhere on the page");
  await withJs.close();
} catch (error) {
  console.error("\n" + (error?.stack ?? error));
  failures.push("the check itself threw");
} finally {
  cleanUp();
  try {
    const left = db(`console.log(await prisma.governmentReference.count({ where: { masterReferenceId: { in: ${JSON.stringify(IDS)} } } }));`);
    check("the records this check created are gone", left === "0", left);
  } catch { /* reported above */ }
  await rm(join(DIST, "executive-order"), { recursive: true, force: true }).catch(() => undefined);
  if (browser) await browser.close();
  if (server) server.close();
  api.kill("SIGTERM");
}

console.log(failures.length === 0
  ? "\nA law can be found, followed, previewed and read without JavaScript."
  : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
