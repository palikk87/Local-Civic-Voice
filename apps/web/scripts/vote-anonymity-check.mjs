/**
 * The question is asked once, at the vote, and the answer is honoured.
 *
 *   bun run vote-anonymity-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Voting under your own name was the default, the only switch
 * was in Settings, and nothing near a vote button mentioned it. Somebody who
 * never opened Settings had been putting their name on public positions
 * without being told. The fix is a question at the moment of the vote — which
 * means the failure mode is a dialog that never appears, or one that appears
 * every single time, and neither is visible to a unit test.
 *
 * WHAT IT PROVES, on the rendered page:
 *   - A citizen who has never been asked IS ASKED, on their first vote.
 *   - Answering "keep my name off it" records the position anonymously.
 *   - THEY ARE NOT ASKED AGAIN. The second vote goes straight through.
 *   - Closing the question CANCELS THE VOTE rather than publishing a name
 *     nobody agreed to.
 *   - The detail page says which way this one is going, and can depart from it.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL. Two citizens, records prefixed
 * "anoncheck", all removed on the way out.
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

const API_PORT = Number(process.env.ANON_CHECK_PORT ?? 3984);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";
const REF_PREFIX = "anoncheck";

const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return {
    id: `pop-${padded}`,
    username: `citizen${padded}`,
    email: `citizen-${padded}@population.invalid`,
  };
};

/** Answers the question, then votes again. */
const ASKED = citizen(81);
/** Closes the question without answering. */
const REFUSER = citizen(82);
const EVERYONE = [ASKED, REFUSER];

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
  BETTER_AUTH_SECRET: "anon-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".anon-check-uploads"),
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

function restorePopulation() {
  db(`
    const ids = ${JSON.stringify(EVERYONE.map((p) => p.id))};
    const refs = await prisma.governmentReference.findMany({
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } }, select: { id: true },
    });
    const refIds = refs.map((r) => r.id);
    await prisma.positionEvent.deleteMany({ where: { userId: { in: ids } } });
    await prisma.governmentReferenceVote.deleteMany({ where: { userId: { in: ids } } });
    await prisma.governmentReference.deleteMany({ where: { id: { in: refIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  `);
}

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  try {
    restorePopulation();
    const left = db(`
      const p = await prisma.positionEvent.count({ where: { userId: { in: ${JSON.stringify(EVERYONE.map((x) => x.id))} } } });
      const r = await prisma.governmentReference.count({ where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } } });
      const u = await prisma.user.count();
      console.log(JSON.stringify({ p, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no positions left", state.p === 0, left);
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
      "X-Forwarded-For": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify({ email: who.email, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`${who.username} could not sign in: ${response.status} ${await response.text()}`);
  }
  return (response.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0]).join("; ");
}

try {
  await waitForApi();
  restorePopulation();

  const ids = JSON.parse(db(`
    const out = {};
    for (const n of ["one", "two", "three"]) {
      const row = await prisma.governmentReference.create({
        data: {
          masterReferenceId: "${REF_PREFIX}-" + n,
          referenceType: "bill",
          title: "A law to vote on, " + n,
          status: "introduced",
          lawVersion: 1,
        },
      });
      out[n] = row.id;
    }
    console.log(JSON.stringify(out));
  `));

  const cookies = {};
  for (const who of EVERYONE) cookies[who.id] = await signIn(who);

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

  async function open(who, path) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    await acceptTermsBeforeLoad(context);
    const [name, ...rest] = cookies[who.id].split("=");
    await context.addCookies([
      { name, value: rest.join("="), domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await routeApiToLocal(page, API);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });
    await page.waitForTimeout(1_500);
    return { context, page };
  }

  const positionsOf = (id) =>
    JSON.parse(db(`
      const rows = await prisma.positionEvent.findMany({
        where: { userId: "${id}" }, select: { isAnonymous: true },
      });
      console.log(JSON.stringify(rows));
    `));

  // -------------------------------------------- asked once, and the answer sticks
  {
    const { context, page } = await open(ASKED, `/reference/${ids.one}`);

    await page.getByRole("button", { name: /^Support$/ }).click();
    const asked = await page
      .waitForSelector('[data-testid="vote-anonymity-dialog"]', { timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check("A FIRST-TIME VOTER IS ASKED, at the vote and not in Settings", asked);

    if (asked) {
      const text = await page.locator('[data-testid="vote-anonymity-dialog"]').innerText();
      check(
        "…and told plainly what public means here",
        /public/i.test(text) && /forever|permanently/i.test(text),
        text.slice(0, 120).replace(/\n/g, " | "),
      );
      check(
        "…and that the vote counts either way",
        /counts exactly the same|counts the same/i.test(text),
      );

      await page.locator('[data-testid="vote-anonymously"]').click();
      await page.waitForTimeout(2_500);
    }

    const afterFirst = positionsOf(ASKED.id);
    check("THE ANSWER IS HONOURED — the position went in without their name", afterFirst.length === 1 && afterFirst[0].isAnonymous === true, JSON.stringify(afterFirst));
    await context.close();
  }

  {
    // Second vote, different law. The question must not come back.
    const { context, page } = await open(ASKED, `/reference/${ids.two}`);
    await page.getByRole("button", { name: /^Support$/ }).click();
    await page.waitForTimeout(2_500);

    const askedAgain = await page.locator('[data-testid="vote-anonymity-dialog"]').count();
    check("THEY ARE NOT ASKED AGAIN — asked once means once", askedAgain === 0);

    const after = positionsOf(ASKED.id);
    check("…and the second vote followed the same choice", after.length === 2 && after.every((r) => r.isAnonymous), JSON.stringify(after));
    await context.close();
  }

  // ---------------------------------------- closing it cancels rather than publishes
  {
    const { context, page } = await open(REFUSER, `/reference/${ids.three}`);
    await page.getByRole("button", { name: /^Oppose$/ }).click();
    await page.waitForSelector('[data-testid="vote-anonymity-dialog"]', { timeout: 10_000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2_500);

    const positions = positionsOf(REFUSER.id);
    check(
      "CLOSING THE QUESTION CANCELS THE VOTE — no name is published by somebody hitting Escape",
      positions.length === 0,
      JSON.stringify(positions),
    );
    await context.close();
  }

  // ------------------------------- the detail page says which way this one is going
  {
    const { context, page } = await open(ASKED, `/reference/${ids.three}`);
    const box = page.locator('[data-testid="vote-without-my-name"]');
    check("the detail page shows the choice beside the buttons", (await box.count()) === 1);
    check(
      "…set to what they chose",
      (await box.getAttribute("data-state")) === "checked",
      String(await box.getAttribute("data-state")),
    );
    const text = await page.evaluate(() => document.getElementById("root")?.innerText ?? "");
    check("…and offers a way to change the default", /Change your default/i.test(text));
    await context.close();
  }
} catch (error) {
  console.error(`\nThe check could not run: ${error.message}`);
  failures.push("the check ran");
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nAsked once, at the vote, and the answer is honoured everywhere after.");
