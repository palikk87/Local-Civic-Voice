/**
 * Every way into a law lands on the same page, and that page is the good one.
 *
 *   bun run one-law-page-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. There were four pages for one government record. Three were
 * ports of the phone app, one per branch, and between them they were what the
 * feed, the timeline, Discover, every card and every notification opened. The
 * fourth — /reference/:id — is the one with the Citizen's Brief, the Integrity
 * Audit, the Pulse history, the turning points, the other side and the
 * comments, and almost nothing sent anybody to it.
 *
 * Reported plainly: "when clicking see details from feed or timeline or really
 * anywhere the page should look like the new version… right now [it] is only
 * accessible thru the records portion in the profiles".
 *
 * A route-target scan proves every destination is a mounted route. It cannot
 * prove which page a reader actually arrives at, or that the pieces carried
 * over from the retired screens are on it. Only a browser can.
 *
 * WHAT IT PROVES, against a real record in the population database:
 *   - The three retired paths land on /reference/:id rather than 404ing, so
 *     every link already sent to somebody still works.
 *   - THE SPONSOR, THE DATES AND THE GAP ARE ON THE PAGE — the three things
 *     the old screen had that this one did not.
 *   - The page's own furniture is still there: the brief, the audit, the vote.
 *   - Sharing to your timeline is reachable from the page.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL. It creates one record prefixed
 * "onelaw" and removes it on the way out.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";

const DIST = process.argv[2] ?? "dist";
const BACKEND = resolve(process.cwd(), "..", "..", "backend");

const POPULATION_URL =
  process.env.TEST_POPULATION_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_population";

if (!/population/i.test(new URL(POPULATION_URL).pathname)) {
  console.error(`Refusing to run against "${new URL(POPULATION_URL).pathname}".`);
  process.exit(1);
}

const API_PORT = Number(process.env.ONELAW_CHECK_PORT ?? 3986);
const API = `http://127.0.0.1:${API_PORT}`;
const BACKEND_ESC = BACKEND.replace(/\\/g, "/");
const REF_PREFIX = "onelaw";
const TITLE = "An Act to prove one law has one page";
const SPONSOR = "Jane Q. Lawmaker";

// THE OTHER TWO BRANCHES, which had no person on them at all.
//
// "why isn't there a photo of the rep in every law card?" — and they were
// right that some had one and some did not. A bill carried its sponsor's face;
// an executive order and a Supreme Court ruling carried a title and a status,
// because nothing on either record named a human being.
//
// These two are people who have LEFT office, which is the case the roster of
// current officials cannot answer and the stored portrait exists for.
const PRESIDENT = "Barack Obama";
const JUSTICE = "Antonin Scalia";
const PORTRAIT = "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/portrait.jpg";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

function db(snippet) {
  return execFileSync(
    "bun",
    [
      "-e",
      `const { PrismaClient } = require("@prisma/client");
       const prisma = new PrismaClient({ datasources: { db: { url: process.env.POP_URL } } });
       (async () => { ${snippet} await prisma.$disconnect(); })();`,
    ],
    { cwd: BACKEND, env: { ...process.env, POP_URL: POPULATION_URL }, encoding: "utf8" },
  ).trim();
}

const backendEnv = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(API_PORT),
  DATABASE_URL: POPULATION_URL,
  DIRECT_URL: POPULATION_URL,
  BACKEND_URL: API,
  BETTER_AUTH_SECRET: "one-law-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".one-law-check-uploads"),
  HEALTH_SCHEMA_TTL_MS: "0",
  CIVIC_NO_BACKGROUND_SYNC: "1",
};

const api = spawn("bun", ["src/index.ts"], { cwd: BACKEND, env: backendEnv, stdio: ["ignore", "pipe", "pipe"] });
let apiLog = "";
api.stdout.on("data", (d) => { apiLog += d; });
api.stderr.on("data", (d) => { apiLog += d; });

async function waitForApi() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

let server;
let browser;

function removeTheRecord() {
  db(`
    const refs = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } }, select: { id: true },
    });
    const ids = refs.map((r) => r.id);
    await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: { in: ids } } });
    await prisma.positionEvent.deleteMany({ where: { governmentReferenceId: { in: ids } } });
    await prisma.governmentReference.deleteMany({ where: { id: { in: ids } } });
    await prisma.justice.deleteMany({});
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    removeTheRecord();
    const left = db(`
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ r, u }));
    `);
    const state = JSON.parse(left);
    check("the records this check created are gone", state.r === 0, left);
    check("…and all thousand citizens still there", state.u >= 1000, left);
  } catch (error) {
    console.error(`Could not clean up: ${error.message}`);
    failures.push("cleaned up");
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

try {
  await waitForApi();
  removeTheRecord();

  const id = db(`
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-1",
        referenceType: "bill",
        title: ${JSON.stringify(TITLE)},
        status: "introduced",
        chamber: "senate",
        congress: 119,
        lawVersion: 1,
        sponsorName: ${JSON.stringify(SPONSOR)},
        sponsorParty: "D",
        sponsorState: "AZ",
        introducedDate: new Date("2007-11-01T00:00:00Z"),
        lastActionDate: new Date("2007-11-02T00:00:00Z"),
      },
    });
    console.log(row.id);
  `);

  // An executive order and two rulings, so the page can be opened for each of
  // the three branches rather than for bills alone.
  const eoId = db(`
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-eo",
        referenceType: "executive_order",
        title: "An order to prove an order has a face",
        status: "active",
        lawVersion: 1,
        sponsorName: ${JSON.stringify(PRESIDENT)},
        sponsorPhotoUrl: ${JSON.stringify(PORTRAIT)},
        signedDate: new Date("2014-06-01T00:00:00Z"),
      },
    });
    console.log(row.id);
  `);

  const scotusId = db(`
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-scotus",
        referenceType: "scotus_case",
        title: "Proof v. Blankness",
        status: "decided",
        lawVersion: 1,
        sponsorName: ${JSON.stringify(JUSTICE)},
        sponsorPhotoUrl: ${JSON.stringify(PORTRAIT)},
        decidedDate: new Date("2015-06-01T00:00:00Z"),
      },
    });
    console.log(row.id);
  `);

  // The bench of 1971, so the per curiam ruling below has somebody to name.
  // Parsed from the Court's own recorded page rather than typed here — a
  // hand-written bench could not fail the check it exists to make.
  db(`
    const { parseJusticeRoster } = require("${BACKEND_ESC}/src/services/court-composition.ts");
    const html = require("fs").readFileSync("${BACKEND_ESC}/tests/fixtures/scotus-justices.html", "utf8");
    await prisma.justice.deleteMany({ where: { name: { contains: " " } } });
    await prisma.justice.createMany({
      data: parseJusticeRoster(html).map((j) => ({
        name: j.name, startDate: j.startDate, endDate: j.endDate,
        appointedBy: j.appointedBy, isChief: j.isChief,
      })),
      skipDuplicates: true,
    });
    console.log("court seeded");
  `);

  // The Court speaking as one body, with no individual author. Nothing may be
  // attributed here, and a stored portrait must not rescue it.
  const perCuriamId = db(`
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-percuriam",
        referenceType: "scotus_case",
        title: "Anonymous v. Court",
        status: "decided",
        lawVersion: 1,
        sponsorName: "Per Curiam",
        sponsorPhotoUrl: ${JSON.stringify(PORTRAIT)},
        // The Pentagon Papers date. That ruling was itself per curiam, which
        // is the case this whole path exists for.
        decidedDate: new Date("1971-06-30T00:00:00Z"),
      },
    });
    console.log(row.id);
  `);

  // The same ruling, but with a dissent on record. The row of faces must
  // narrow to the majority, and the dissenters must still be named.
  const narrowedId = db(`
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-narrowed",
        referenceType: "scotus_case",
        title: "Majority v. Dissent",
        status: "decided",
        lawVersion: 1,
        sponsorName: "Per Curiam",
        dissentedBy: ["Burger", "Harlan", "Blackmun"],
        dissentCheckedAt: new Date(),
        decidedDate: new Date("1971-06-30T00:00:00Z"),
      },
    });
    console.log(row.id);
  `);

  server = createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    let file = join(DIST, url === "/" ? "index.html" : url);
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

  browser = await launchChromium();

  async function open(path) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
    await acceptTermsBeforeLoad(context);
    const page = await context.newPage();
    await routeApiToLocal(page, API);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });
    await page.waitForTimeout(1_800);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  // ------------------------- the three retired paths still take people somewhere
  for (const old of [`/bill/${id}`, `/executive-order/${id}`, `/scotus/${id}`]) {
    const { context, page } = await open(old);
    check(
      `${old.split("/")[1]} links people have already been sent still work`,
      page.url().endsWith(`/reference/${id}`),
      page.url().replace(base, ""),
    );
    await context.close();
  }

  // ------------------------------------------------- the page they land on
  {
    const { context, page } = await open(`/reference/${id}`);
    const text = await screen(page);

    check("the law is there", text.includes(TITLE));

    // The three things the retired screen had that this one did not.
    check("THE SPONSOR CAME ACROSS", text.includes(`Sponsored by ${SPONSOR}`), text.slice(0, 200).replace(/\n/g, " | "));
    check("…with their party and state", /Democrat — AZ/.test(text));
    check("THE DATES CAME ACROSS", /Introduced .*2007/.test(text) && /Last action .*2007/.test(text));
    check("THE GAP CAME ACROSS", /Gap|Congress has not voted|not enough people/i.test(text));
    check("SHARING TO YOUR TIMELINE CAME ACROSS", /Share to your timeline/i.test(text));

    // And the page's own furniture, which is why it is the one being kept.
    check("the Citizen's Brief is still here", /Citizen's Brief|Brief/i.test(text));
    check("the Integrity Audit is still here", /Integrity Audit/i.test(text));
    check("the vote panel is still here", /Public Pulse/i.test(text));
    // NOT "the word comment appears". It used to be exactly that, and it was
    // passing on a dead counts row — "0 comments · 0 shares" — printed above
    // the share buttons. That row is gone: both numbers were inert, and a law
    // has no comments of its own. What is under this page is POSTS people
    // wrote about the law, each on its author's own timeline.
    //
    // So this asserts the conversation itself is on the page, which is what
    // the count had been pointing at with no way to reach it.
    check(
      "THE CONVERSATION IS STILL HERE",
      /What people are saying|Nobody has written about this one yet/i.test(text),
      text.slice(0, 200).replace(/\n/g, " | "),
    );
    check(
      "…and no dead count is printed above it",
      !/\d+\s+comments|\d+\s+shares/i.test(text),
      "a counts row is back",
    );

    // The old screens are gone, not hiding behind a different label.
    check("nothing on it is the retired screen", !/Community Vote/.test(text));

    // A bill's sponsor portrait is built by the client from their bioguide id.
    // This record has no bioguide id, so there is nothing to draw — and that is
    // a finished state, not a bug: the name is there, which is true.
    await context.close();
  }

  // ------------------- THE OTHER TWO BRANCHES CARRY A FACE, WHICH IS THE POINT
  //
  // Not "an attribution field is in the response". The reader's complaint was
  // about the page, so this asks the page: is the person named, is the role
  // right, and is there an <img> of them actually on screen.
  {
    const { context, page } = await open(`/reference/${eoId}`);
    const text = await screen(page);
    check("AN EXECUTIVE ORDER NAMES THE PRESIDENT WHO SIGNED IT",
      text.includes(`Signed by ${PRESIDENT}`), text.slice(0, 200).replace(/\n/g, " | "));
    check("…and his portrait is on the page",
      (await page.locator(`img[src="${PORTRAIT}"]`).count()) > 0);
    await context.close();
  }

  {
    const { context, page } = await open(`/reference/${scotusId}`);
    const text = await screen(page);
    check("A RULING NAMES THE JUSTICE WHO WROTE THE MAJORITY",
      text.includes(`Majority opinion by ${JUSTICE}`), text.slice(0, 200).replace(/\n/g, " | "));
    check("…and their portrait is on the page",
      (await page.locator(`img[src="${PORTRAIT}"]`).count()) > 0);
    await context.close();
  }

  {
    const { context, page } = await open(`/reference/${perCuriamId}`);
    const text = await screen(page);
    // A per curiam decision has no author. Naming one would invent a fact
    // about who decided a case, and the stored portrait must not leak a face
    // onto it either.
    check("A PER CURIAM DECISION NAMES NO JUSTICE AS ITS AUTHOR",
      !/Majority opinion by|Signed by|Sponsored by/.test(text),
      text.slice(0, 200).replace(/\n/g, " | "));
    check("…and the stored portrait is not used as its face",
      (await page.locator(`img[src="${PORTRAIT}"]`).count()) === 0);

    // "The app is about accountability so not posting the photo is not very
    // fair." No author does not mean nobody: nine people answered for it.
    check("BUT THE BENCH THAT SAT THAT DAY IS ON THE PAGE",
      /Warren Earl Burger/.test(text) && /Thurgood Marshall/.test(text) && /Harry A. Blackmun/.test(text),
      text.slice(0, 300).replace(/\n/g, " | "));
    check("…led by the Chief Justice",
      text.indexOf("Warren Earl Burger") < text.indexOf("Hugo Lafayette Black"));
    check("…labelled as the Court AS IT SAT, never as having agreed",
      /Court as it sat on June 30, 1971/.test(text) && !/decided by|all agreed/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "));
    await context.close();
  }

  // ------------------------------- and once the dissent is on record, it narrows
  {
    const { context, page } = await open(`/reference/${narrowedId}`);
    const text = await screen(page);
    check("A RECORDED DISSENT NARROWS THE ROW TO THE MAJORITY",
      /In the majority on June 30, 1971/.test(text) && /Hugo Lafayette Black/.test(text),
      text.slice(0, 300).replace(/\n/g, " | "));
    check("…and the dissenters are not on the page at all",
      !/Warren Earl Burger/.test(text) && !/Harry A. Blackmun/.test(text) && !/Dissenting/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "));
    await context.close();
  }
} catch (error) {
  console.error(`\nThe check could not run: ${error.message}`);
  failures.push("the check ran");
} finally {
  // ONELAW_DUMP_API=1 prints the spawned backend's own output on a failure.
  // Added after a run where every assertion failed with "We couldn't load this
  // reference" — which looks like a broken page and was actually an API that
  // could not be reached, because something else was saturating the machine.
  // The page's error text cannot tell those two apart; the backend log can.
  if (failures.length > 0 && process.env.ONELAW_DUMP_API) {
    console.error("\n---- backend log ----\n" + apiLog.slice(-4000));
  }
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nOne law, one page — and it is the one with the brief, the audit and the gap on it.");
