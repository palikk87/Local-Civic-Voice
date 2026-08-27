/**
 * Article V is a real proceeding, on a real page, against the thousand.
 *
 *   bun run article-v-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The Article V page shipped with three hardcoded people on
 * it and a Vote to Impeach button that added a string to a Set inside the
 * component. It typechecked, it linted, it built, and it rendered beautifully.
 * The one thing it did not do was anything at all. No test in the suite could
 * see that, because there was nothing to test: no model, no route, no row.
 *
 * So the bar for this check is the bar that page failed. Not "does it render"
 * — does a citizen's vote reach the database and still be there after a
 * reload.
 *
 * NO STUBBED API. Real backend, real Postgres, real sign-in through the app's
 * own form, real proceedings. The only thing reached around the server for is
 * delegate eligibility, which takes fourteen days to earn honestly.
 *
 * WHAT IT PROVES:
 *   - A citizen with no proceedings sees an honest empty state, not a sample.
 *   - Articles filed by one delegator are on the page, in full, for another.
 *   - THE VOTE SURVIVES A RELOAD. The old button did not survive a re-render.
 *   - A non-elector is told plainly that they have no vote here.
 *   - The reset tab shows what a reset costs BEFORE any vote can be cast.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL. It backdates one
 * citizen, gives them the posts and votes a delegate has to earn, opens one
 * proceeding, and removes every row of it on the way out.
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
  console.error(
    `Refusing to run against "${new URL(POPULATION_URL).pathname}".\n` +
      `This check opens impeachment proceedings, so it only runs against a\n` +
      `database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.ARTICLE_V_CHECK_PORT ?? 3996);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";

/** Citizen n of the thousand, by the seeder's own naming. */
const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return {
    id: `pop-${padded}`,
    username: `citizen${padded}`,
    name: `Citizen ${padded}`,
    email: `citizen-${padded}@population.invalid`,
  };
};

const LEADER = citizen(11);
const FILER = citizen(12);
const ELECTOR = citizen(13);
const THIRD = citizen(14);
const OUTSIDER = citizen(15);

/** Every reference this check creates carries the prefix, so cleanup is exact. */
const REF_PREFIX = "avcheck";

const GROUNDS =
  "This delegate voted directly against the position they published and asked us to lend " +
  "them our votes for, on the record, twice in one week.";
const EVIDENCE =
  "Their posts of the third and the ninth, and the two roll-call positions recorded against " +
  "their account on the same bills, which contradict both posts.";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Run a snippet of Prisma against the population database, and nothing else. */
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

// ------------------------------------------------------------------ the server

const backendEnv = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(API_PORT),
  DATABASE_URL: POPULATION_URL,
  DIRECT_URL: POPULATION_URL,
  BACKEND_URL: API,
  BETTER_AUTH_SECRET: "article-v-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".article-v-check-uploads"),
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
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`The backend never answered on ${API}.\n\n${apiLog.slice(-2000)}`);
}

let server;
let browser;

/** Put the population back exactly as it was found. */
function restorePopulation() {
  db(`
    const ids = ${JSON.stringify([LEADER.id, FILER.id, ELECTOR.id, THIRD.id, OUTSIDER.id])};
    await prisma.impeachment.deleteMany({ where: { leaderId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { toUserId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { fromUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
    const refs = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
      select: { id: true },
    });
    await prisma.governmentReferenceVote.deleteMany({
      where: { governmentReferenceId: { in: refs.map((r) => r.id) } },
    });
    await prisma.positionEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.governmentReference.deleteMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date() } });
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    restorePopulation();
    const left = db(`
      const n = await prisma.impeachment.count();
      const d = await prisma.delegation.count();
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ n, d, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no proceedings left", state.n === 0, left);
    check("…no delegations left", state.d === 0, left);
    check("…no records this check created left", state.r === 0, left);
    check("…and all thousand citizens still there", state.u >= 1000, left);
  } catch (error) {
    console.error(`Could not restore the population rows: ${error.message}`);
    failures.push("population restored");
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

/** Sign in over HTTP and keep the cookie, so a citizen can act without a browser. */
async function signIn(who) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({ email: who.email, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`${who.username} could not sign in: ${response.status} ${await response.text()}`);
  }
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error(`${who.username} signed in but no session cookie came back.`);
  return cookie;
}

async function asCitizen(cookie, path, method = "GET", body) {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      cookie,
      "X-Forwarded-For": `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The proceeding this run opens, so later steps can carry it to a finding. */
let filedId = "";

try {
  await waitForApi();

  // ------------------------------------------------------- earning eligibility

  // The one thing that cannot go through an endpoint: a delegate has to be
  // fourteen days old with twenty votes and three posts behind them, and a
  // check cannot wait a fortnight. Everything else below is real HTTP.
  db(`
    await prisma.user.update({
      where: { id: "${LEADER.id}" },
      data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.post.create({
        data: { authorId: "${LEADER.id}", content: "A position worth putting a name to, number " + i + "." },
      });
    }
    for (let i = 0; i < 20; i += 1) {
      const row = await prisma.governmentReference.create({
        data: {
          masterReferenceId: "${REF_PREFIX}-" + i,
          referenceType: "bill",
          title: "Track record " + i,
          status: "proposed",
          category: "infrastructure",
        },
      });
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: row.id, userId: "${LEADER.id}", position: "support" },
      });
    }
  `);

  // ------------------------------------------------- three citizens delegate

  const cookies = {};
  for (const person of [FILER, ELECTOR, THIRD, OUTSIDER]) {
    cookies[person.id] = await signIn(person);
  }

  for (const person of [FILER, ELECTOR, THIRD]) {
    const response = await asCitizen(cookies[person.id], "/api/delegations", "POST", {
      toUserId: LEADER.id,
    });
    check(
      `${person.username} lends their vote to ${LEADER.username}`,
      response.status === 201,
      `${response.status} ${response.status === 201 ? "" : await response.text()}`,
    );
  }

  // ---------------------------------------------------------- the page, empty

  server = createServer(async (req, res) => {
    const [path] = req.url.split("?");
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

  browser = await launchChromium();

  /** A browser with one citizen signed in through the app's own form. */
  async function open(who, path = "/article-v") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await acceptTermsBeforeLoad(context);
    const page = await context.newPage();
    await routeApiToLocal(page, API);

    await page.goto(`${base}/auth`, { waitUntil: "domcontentloaded" });
    await page.locator("#civic-email").waitFor({ timeout: 25_000 });
    await page.locator("#civic-email").fill(who.email);
    await page.locator("#civic-password").fill(PASSWORD);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const signedIn = await page.evaluate(async () => {
        const r = await fetch("/api/auth/get-session", { credentials: "include" });
        const body = await r.json().catch(() => null);
        return Boolean(body && body.user);
      });
      if (signedIn) break;
      await page.waitForTimeout(300);
    }

    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    // Wait for something the page in question actually renders. Waiting for the
    // Article V tabs on a profile is a 25-second timeout dressed as a failure.
    await page.waitForSelector(
      path.startsWith("/article-v") ? '[data-testid="tab-impeachment"]' : "#root",
      { timeout: 25_000 },
    );
    await page.waitForTimeout(1_500);
    return { context, page };
  }

  const screen = (page) =>
    page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  {
    // Nobody has filed anything yet. This is the state the old page could never
    // reach, because it always had three people on it.
    const { context, page } = await open(ELECTOR);
    const text = await screen(page);

    check(
      "with nothing filed, the page says so instead of inventing a proceeding",
      /No proceedings are open that you can vote in/i.test(text),
      text.slice(0, 200).replace(/\n/g, " | "),
    );
    check(
      "…and the three invented characters are nowhere on it",
      !/Sarah Chen|Marcus Rivera|James Park/i.test(text),
      text.slice(0, 200).replace(/\n/g, " | "),
    );
    check(
      "…while offering to bring proceedings against the delegate they actually have",
      new RegExp(LEADER.username, "i").test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    await context.close();
  }

  // --------------------------------------------------------- articles are filed

  {
    const response = await asCitizen(cookies[FILER.id], "/api/impeachments", "POST", {
      leaderId: LEADER.id,
      grounds: GROUNDS,
      evidence: EVIDENCE,
    });
    const body = await response.json().catch(() => ({}));
    check("a delegator files Articles of Impeachment", response.status === 201, `${response.status} ${JSON.stringify(body).slice(0, 200)}`);
    check("…and the electorate is the three who were delegating", body.electorCount === 3, JSON.stringify(body));
    filedId = body.impeachmentId;
  }

  // ----------------------------------------------------- an elector reads and votes

  {
    const { context, page } = await open(ELECTOR);
    let text = await screen(page);

    check("the articles are on the page in full", text.includes(GROUNDS), text.slice(0, 300).replace(/\n/g, " | "));
    check("…including the evidence", text.includes(EVIDENCE), text.slice(0, 300).replace(/\n/g, " | "));
    check("…and the real tally against the frozen electorate", /0 of 3/.test(text), text.slice(0, 400).replace(/\n/g, " | "));

    // THE VOTE. This is the assertion the old page existed to fail.
    await page.locator('[data-testid="impeachment-vote"]').first().click();
    await page.waitForTimeout(2_000);

    text = await screen(page);
    check("the vote is acknowledged", /You voted to impeach/i.test(text), text.slice(0, 300).replace(/\n/g, " | "));
    check("…and the tally moved", /1 of 3/.test(text), text.slice(0, 400).replace(/\n/g, " | "));

    // RELOAD. The old button lost its vote to a re-render, never mind a reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="tab-impeachment"]', { timeout: 25_000 });
    await page.waitForTimeout(2_000);

    text = await screen(page);
    check("THE VOTE SURVIVES A RELOAD", /You voted to impeach/i.test(text), text.slice(0, 300).replace(/\n/g, " | "));
    check("…and so does the tally", /1 of 3/.test(text), text.slice(0, 400).replace(/\n/g, " | "));

    const stored = db(`
      const n = await prisma.impeachmentElector.count({ where: { votedAt: { not: null } } });
      console.log(String(n));
    `);
    check("…because it is a row in the database", stored === "1", `${stored} votes recorded`);

    await context.close();
  }

  // ------------------------------------------------------- somebody with no vote

  {
    const { context, page } = await open(OUTSIDER);
    const text = await screen(page);

    check(
      "somebody who never delegated is not shown a vote they do not have",
      !/Vote to impeach/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    check(
      "…and is told plainly why",
      /No proceedings are open that you can vote in/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    await context.close();
  }

  // ---------------------------------- the articles read as the document they are

  {
    const { context, page } = await open(ELECTOR);
    const text = await screen(page);

    check(
      "the filing is headed as Articles of Impeachment",
      /Articles of Impeachment/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    check(
      "…and says who filed it and when",
      new RegExp(`Filed by @?${FILER.username}`, "i").test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…as one block, not two loose paragraphs",
      (await page.locator('[data-testid="articles-of-impeachment"]').count()) === 1,
    );
    await context.close();
  }

  // ------------------------------------- the record lands on the leader's profile

  {
    // Carry it to a finding: the remaining two electors take it past two thirds.
    for (const person of [FILER, THIRD]) {
      const response = await asCitizen(
        cookies[person.id],
        `/api/impeachments/${filedId}/vote`,
        "POST",
        { proposedDays: 30 },
      );
      // One of these crosses the threshold; the one after it is correctly refused.
      if (!response.ok && response.status !== 400) {
        check(`${person.username} could vote`, false, `${response.status}`);
      }
    }

    const state = await (
      await fetch(`${API}/api/impeachments/leader/${LEADER.id}`)
    ).json();
    check("the proceeding passed", state.suspension.suspended === true, JSON.stringify(state.suspension));
    check("…and is on the leader's record", state.record.length === 1, JSON.stringify(state.record.length));

    const { context, page } = await open(ELECTOR, `/user/${LEADER.id}`);
    await page.waitForTimeout(2_000);
    const text = await screen(page);

    check(
      "THE PROFILE CARRIES THE IMPEACHMENT",
      /Article V record/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and says they are suspended from receiving delegated votes",
      /suspended from receiving delegated votes/i.test(text),
      text.slice(0, 600).replace(/\n/g, " | "),
    );

    // The articles are on the profile too, one click away.
    await page.locator('[data-testid="impeachment-record-entry"]').first().click();
    await page.waitForTimeout(500);
    const opened = await screen(page);
    check(
      "…and the articles can be read from the profile",
      opened.includes(GROUNDS) && opened.includes(EVIDENCE),
      opened.slice(0, 400).replace(/\n/g, " | "),
    );
    await context.close();
  }

  // --------------------------------------------------------------- the reset tab

  {
    const { context, page } = await open(ELECTOR);
    await page.locator('[data-testid="tab-reset"]').click();
    await page.waitForSelector('[data-testid="reset-disclosure"]', { timeout: 15_000 });
    await page.waitForTimeout(500);

    const text = await screen(page);

    // FULL DISCLOSURE BEFORE ANY VOTE. A vote to wipe the platform cast
    // without knowing what gets wiped is not consent.
    check(
      "the reset tab says every delegation ends, before anything else",
      /Every delegation ends/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and that every count returns to zero",
      /returns? to zero/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and that your own record survives",
      /record of every position you have ever taken is kept/i.test(text),
      text.slice(0, 600).replace(/\n/g, " | "),
    );
    check(
      "with no reset before the platform, it says so rather than showing a sample vote",
      /No System-Wide Reset is before the platform/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and the invented 12,450 for / 45,230 against is gone",
      !/12,?450|45,?230|94,?000/.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    await context.close();
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nArticle V is real: proceedings, votes and disclosure, all from the database.");
