/**
 * The Integrity Audit is a real remedy, on a real page — Article III §2.
 *
 *   bun run integrity-audit-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The bug that shipped a blank Evidence block on the Article V
 * page returned HTTP 200 on every call. Nothing reading status codes could see
 * it; a browser could. An audit is exactly the same shape of risk — a panel
 * whose numbers are computed correctly and rendered nowhere is worse than no
 * panel, because it looks like an answer.
 *
 * So the bar is: a citizen presses the button on the page, and the findings
 * they can read come from the database.
 *
 * WHAT IT PROVES:
 *   - With nothing audited, the page says so rather than showing an example.
 *   - A citizen demands an audit from the record page and the findings appear.
 *   - A TALLY THAT IS NOT WHAT THE VOTES ADD UP TO IS CAUGHT AND SHOWN.
 *   - A leader's own support is auditable from their profile.
 *   - Nothing on any audit panel is a name, a username or an email.
 *   - Under the floor, the page prints "withheld" rather than a small number.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL. It backdates one
 * citizen, creates records prefixed "audcheck", runs audits, and removes every
 * row of it on the way out.
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
      `This check writes delegations and audits, so it only runs against a\n` +
      `database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.AUDIT_CHECK_PORT ?? 3994);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";

const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return {
    id: `pop-${padded}`,
    username: `citizen${padded}`,
    name: `Citizen ${padded}`,
    email: `citizen-${padded}@population.invalid`,
  };
};

const LEADER = citizen(21);
/** Six lenders, one more than the privacy floor, so the leader panel reports. */
const LENDERS = [22, 23, 24, 25, 26, 27].map(citizen);
/** A record nobody has voted on much, to prove the floor withholds. */
const READER = citizen(28);

const EVERYONE = [LEADER, ...LENDERS, READER];
const REF_PREFIX = "audcheck";

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
  BETTER_AUTH_SECRET: "integrity-audit-check-secret-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".audit-check-uploads"),
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

function restorePopulation() {
  db(`
    const ids = ${JSON.stringify(EVERYONE.map((p) => p.id))};
    const refs = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
      select: { id: true },
    });
    const refIds = refs.map((r) => r.id);
    await prisma.integrityAudit.deleteMany({ where: { subjectId: { in: [...ids, ...refIds] } } });
    await prisma.integrityAudit.deleteMany({ where: { requestedById: { in: ids } } });
    await prisma.impeachment.deleteMany({ where: { leaderId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { toUserId: { in: ids } } });
    await prisma.delegation.deleteMany({ where: { fromUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
    await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: { in: refIds } } });
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
      const a = await prisma.integrityAudit.count();
      const d = await prisma.delegation.count();
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ a, d, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no audits left", state.a === 0, left);
    check("…no delegations left", state.d === 0, left);
    check("…no records this check created left", state.r === 0, left);
    check("…and all thousand citizens still there", state.u >= 1000, left);
  } catch (error) {
    console.error(`Could not restore the population rows: ${error.message}`);
    failures.push("population restored");
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

async function signIn(who) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
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
      "X-Forwarded-For": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The cooldown is an hour. Age the audits so the next demand really re-runs. */
function ageAudits() {
  db(`
    await prisma.integrityAudit.updateMany({
      data: { runAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
    });
  `);
}

let busyRefId = "";
let quietRefId = "";

try {
  await waitForApi();

  // START FROM A CLEAN POPULATION. A previous run that died before its own
  // cleanup leaves records behind, and the setup below would then fail on a
  // unique constraint — a crash in the harness reported as a broken feature.
  restorePopulation();

  // The one thing that cannot go through an endpoint: a delegate has to be
  // fourteen days old with twenty votes and three posts behind them.
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
          masterReferenceId: "${REF_PREFIX}-warmup-" + i,
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
    const busy = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-busy",
        referenceType: "bill",
        title: "A bill several people have voted on",
        status: "proposed",
        category: "healthcare",
      },
    });
    const quiet = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "${REF_PREFIX}-quiet",
        referenceType: "bill",
        title: "A bill almost nobody has voted on",
        status: "proposed",
        category: "healthcare",
      },
    });
    console.log(JSON.stringify({ busy: busy.id, quiet: quiet.id }));
  `).split("\n").forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed.busy) { busyRefId = parsed.busy; quietRefId = parsed.quiet; }
    } catch { /* not the line we want */ }
  });

  if (!busyRefId) throw new Error("could not create the records this check audits");

  const cookies = {};
  for (const person of EVERYONE) cookies[person.id] = await signIn(person);

  // Six citizens lend their vote, and six vote on the busy record. One votes on
  // the quiet one, which is what puts it under the floor.
  for (const lender of LENDERS) {
    const response = await asCitizen(cookies[lender.id], "/api/delegations", "POST", {
      toUserId: LEADER.id,
    });
    check(`${lender.username} lends their vote to ${LEADER.username}`, response.status === 201);
  }

  for (const voter of LENDERS) {
    await asCitizen(cookies[voter.id], `/api/government-references/${busyRefId}/vote`, "POST", {
      position: "support",
    });
  }
  await asCitizen(cookies[READER.id], `/api/government-references/${quietRefId}/vote`, "POST", {
    position: "oppose",
  });

  // ------------------------------------------------------------------ the page

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

  /**
   * A browser with one citizen already signed in.
   *
   * THE SESSION IS SEEDED RATHER THAN TYPED. Signing in through the app's own
   * form takes twenty-odd seconds per citizen, and this check opens five
   * sessions; the form path is already proven by article-v-check and
   * every-page-check, and nothing here is about sign-in. So the cookie comes
   * from a real sign-in over real HTTP — the same one the form would produce —
   * and is handed to the browser directly.
   *
   * Both servers are on 127.0.0.1, and cookies ignore port, so one cookie
   * covers the page and the API it calls.
   */
  async function open(who, path) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    await acceptTermsBeforeLoad(context);

    const [name, ...rest] = cookies[who.id].split("=");
    await context.addCookies([
      {
        name,
        value: rest.join("="),
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();
    await routeApiToLocal(page, API);

    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });

    // The panel is fetched after the page paints; wait for it rather than for a
    // fixed number of seconds.
    await page.waitForSelector('[data-testid="request-audit"], [data-testid="no-audit-yet"]', {
      timeout: 25_000,
    }).catch(() => undefined);
    await page.waitForTimeout(600);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  /**
   * Press the button on the page and wait for a NEW audit to render.
   *
   * Waiting for "any finding" is the trap: on a record that has been audited
   * before, findings are already on the screen and the wait returns instantly,
   * so the assertions that follow read the old audit. This waits for the panel
   * to actually change, which is the only thing that proves the button did
   * something.
   */
  async function demandOnPage(page) {
    const panelText = () =>
      page.evaluate(() => {
        const node = document.querySelector('[data-testid="integrity-audit"]');
        return node ? node.innerText.slice(0, 120) : "";
      });

    const before = await panelText();
    await page.locator('[data-testid="request-audit"]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-testid="request-audit"]').first().click();

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const now = await panelText();
      if (now && now !== before) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }

  /**
   * Close a context.
   *
   * The route handler in chromium.mjs drops requests whose page has gone away,
   * so nothing here has to drain them first. `unrouteAll` is deliberately not
   * used: it waits for handlers that are themselves waiting on a page that is
   * closing, which is a hang rather than a tidy-up.
   */
  async function close(context) {
    await context.close();
  }

  {
    const { context, page } = await open(READER, `/reference/${busyRefId}`);
    let text = await screen(page);

    check(
      "with nothing audited, the page says so instead of showing an example",
      /Nothing here has been audited yet/i.test(text),
      text.slice(0, 200).replace(/\n/g, " | "),
    );
    check(
      "…and says what an audit will and will not do",
      /never accuses/i.test(text) && /never names anybody/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );

    check("the button is on the page", (await page.locator('[data-testid="request-audit"]').count()) > 0);

    check("A CITIZEN DEMANDS AN AUDIT AND GETS ONE", await demandOnPage(page));

    text = await screen(page);
    check(
      "…the recount is on the page",
      /Recount/i.test(text),
      text.slice(text.indexOf("Integrity Audit"), text.indexOf("Integrity Audit") + 400).replace(/\n/g, " | "),
    );
    check(
      "…and it says the published tally is what the votes add up to",
      /what the votes add up to/i.test(text),
      text.slice(text.indexOf("Recount"), text.indexOf("Recount") + 300).replace(/\n/g, " | "),
    );
    check(
      "…with the numbers, not just the sentence",
      /Published in favour/i.test(text) && /Counted in favour/i.test(text),
      text.slice(text.indexOf("Recount"), text.indexOf("Recount") + 400).replace(/\n/g, " | "),
    );

    // NOT A NAME ANYWHERE ON THE PANEL. The whole feature rests on this.
    const panel = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="integrity-audit"]');
      return node ? node.innerText : "";
    });
    check("nothing on the audit panel is a person", panel.length > 0);
    for (const person of EVERYONE) {
      check(
        `…not ${person.username}`,
        !panel.includes(person.username) && !panel.includes(person.name) && !panel.includes(person.email),
      );
    }

    check(
      "…and the audit is kept, so a reload still shows it",
      await (async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2_500);
        return (await page.locator('[data-testid="audit-finding"]').count()) > 0;
      })(),
    );

    await close(context);
  }

  // ------------------------------------------------- the malfunction, caught

  {
    // Write a number nobody voted for, straight past every path that keeps the
    // tally honest. This is what Article III means by "system malfunction",
    // produced on purpose so the remedy can be seen catching it on a page.
    db(`
      await prisma.governmentReference.update({
        where: { id: "${busyRefId}" },
        data: { supportVotes: 8888 },
      });
    `);
    ageAudits();

    const { context, page } = await open(READER, `/reference/${busyRefId}`);
    check("the audit re-runs once the cooldown has passed", await demandOnPage(page));

    const panel = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="integrity-audit"]');
      return node ? node.innerText : "";
    });
    check(
      "A TALLY THAT IS NOT WHAT THE VOTES ADD UP TO IS CAUGHT",
      /is not what the votes add up to/i.test(panel),
      panel.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and the page shows both numbers so a reader can see the gap",
      /8888/.test(panel),
      panel.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…without calling it fraud",
      !/fraud|cheat|rigged/i.test(panel),
      panel.slice(0, 300).replace(/\n/g, " | "),
    );

    await close(context);

    db(`
      const counted = await prisma.governmentReferenceVote.count({
        where: { governmentReferenceId: "${busyRefId}", position: "support" },
      });
      await prisma.governmentReference.update({
        where: { id: "${busyRefId}" },
        data: { supportVotes: counted },
      });
    `);
  }

  // ------------------------------------------------------------- the floor

  {
    ageAudits();
    const { context, page } = await open(READER, `/reference/${quietRefId}`);
    check("an audit runs on a record almost nobody has voted on", await demandOnPage(page));

    const panel = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="integrity-audit"]');
      return node ? node.innerText : "";
    });
    check(
      "UNDER THE FLOOR IT WITHHOLDS RATHER THAN PUBLISHING A SMALL NUMBER",
      /cannot be reported without identifying them/i.test(panel),
      panel.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…while the recount still runs, because a tally is already public",
      /what the votes add up to/i.test(panel),
      panel.slice(0, 400).replace(/\n/g, " | "),
    );
    await close(context);
  }

  // ------------------------------------------ a leader's own support, audited

  {
    ageAudits();
    const { context, page } = await open(LEADER, "/profile");
    check(
      "a leader can audit their own support from their own profile",
      (await page.locator('[data-testid="request-audit"]').count()) > 0,
    );
    check("…and pressing it returns findings", await demandOnPage(page));

    const panel = await page.evaluate(() => {
      const node = document.querySelector('[data-testid="integrity-audit"]');
      return node ? node.innerText : "";
    });
    check(
      "…including how the support arrived",
      /How the support arrived/i.test(panel),
      panel.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and how much of it has gone quiet",
      /gone quiet/i.test(panel),
      panel.slice(0, 500).replace(/\n/g, " | "),
    );
    check(
      "…with no delegator named",
      LENDERS.every((l) => !panel.includes(l.username) && !panel.includes(l.name)),
      panel.slice(0, 300).replace(/\n/g, " | "),
    );
    await close(context);
  }

  // --------------------------------- filing articles brings an audit with them

  {
    const filed = await asCitizen(cookies[LENDERS[0].id], "/api/impeachments", "POST", {
      leaderId: LEADER.id,
      grounds:
        "This delegate voted directly against the position they published and asked us to lend " +
        "them our votes for, on the record, twice in one week.",
      evidence:
        "Their posts of the third and the ninth, and the two roll-call positions recorded " +
        "against their account on the same bills, which contradict both posts.",
    });
    check("a delegator files Articles of Impeachment", filed.status === 201, String(filed.status));

    const view = await (await asCitizen(cookies[LENDERS[1].id], `/api/impeachments/leader/${LEADER.id}`)).json();
    check(
      "AN AUDIT RAN THE MOMENT THEY WERE FILED",
      view.proceeding && view.proceeding.audit && view.proceeding.audit.automatic === true,
      JSON.stringify(view.proceeding?.audit?.findings?.map((f) => f.id) ?? null),
    );

    const { context, page } = await open(LENDERS[1], "/article-v");
    await page.waitForTimeout(2_500);
    const text = await screen(page);
    check(
      "…and an elector reads it beside the articles before voting",
      /Integrity Audit of this support/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…so nobody defends themselves blind",
      /How the support arrived/i.test(text),
      text.slice(text.indexOf("Integrity Audit"), text.indexOf("Integrity Audit") + 600).replace(/\n/g, " | "),
    );
    await close(context);
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe Integrity Audit is real: demanded on the page, computed from the database, and it names nobody.");
