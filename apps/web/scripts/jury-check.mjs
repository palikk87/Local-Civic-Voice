/**
 * A jury is real people deciding, on a real page — Article IV.
 *
 *   bun run jury-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The report button has existed since the first build and its
 * reports went into a queue no screen anywhere showed. The failure mode this
 * feature is most likely to repeat is exactly that one: machinery that works
 * and a screen nobody can act on. Every assertion here is something a person
 * does with a mouse.
 *
 * WHAT IT PROVES:
 *   - A drawn juror is TOLD, on the page, without reloading anything.
 *   - The case shows the post, the report, the law and its citizen's brief.
 *   - PRIOR FINDINGS ARE NOT ON THE PAGE before the verdict, and are after.
 *   - Accepting closes the platform: navigating away comes straight back.
 *   - A verdict cannot be cast without saying why.
 *   - Three jurors decide it, and the decided case is public to a stranger,
 *     with every reason and no juror's name against any of them.
 *   - Stepping aside releases the account immediately.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL. It removes every
 * row it created on the way out.
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
      `This check empanels juries and sequesters accounts, so it only runs\n` +
      `against a database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.JURY_CHECK_PORT ?? 3992);
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

const ACCUSED = citizen(41);
const REPORTER = citizen(42);
/** Eight people who have earned the standing to be drawn. */
const POOL = [43, 44, 45, 46, 47, 48, 49, 50].map(citizen);
const STRANGER = citizen(51);

const EVERYONE = [ACCUSED, REPORTER, ...POOL, STRANGER];
const REF_PREFIX = "jurycheck";

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
  BETTER_AUTH_SECRET: "jury-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".jury-check-uploads"),
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
      where: { masterReferenceId: { startsWith: "${REF_PREFIX}" } },
      select: { id: true },
    });
    const refIds = refs.map((r) => r.id);
    await prisma.jurySeat.deleteMany({ where: { jurorId: { in: ids } } });
    await prisma.jury.deleteMany({ where: { accusedId: { in: ids } } });
    await prisma.report.deleteMany({ where: { reporterId: { in: ids } } });
    await prisma.report.deleteMany({ where: { reportedUserId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.comment.deleteMany({ where: { authorId: { in: ids } } });
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
      const j = await prisma.jury.count();
      const s = await prisma.jurySeat.count();
      const r = await prisma.report.count();
      const u = await prisma.user.count();
      console.log(JSON.stringify({ j, s, r, u }));
    `);
    const state = JSON.parse(left);
    check("the population is put back — no juries left", state.j === 0, left);
    check("…no seats left", state.s === 0, left);
    check("…no reports left", state.r === 0, left);
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
      "X-Forwarded-For": `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
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
      "X-Forwarded-For": `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let postId = "";
let juryId = "";

try {
  await waitForApi();
  restorePopulation();

  // ---------------------------------------------------- earning the standing
  //
  // A juror has to be a fortnight old with twenty votes and three posts behind
  // them — the same bar as becoming a delegate. The date is the one thing a
  // check cannot earn honestly; the rest are real rows of the real kind.
  db(`
    const pool = ${JSON.stringify(POOL.map((p) => p.id))};
    const refs = [];
    for (let i = 0; i < 20; i += 1) {
      const row = await prisma.governmentReference.create({
        data: {
          masterReferenceId: "${REF_PREFIX}-" + i,
          referenceType: "bill",
          title: "A law with a plain-English brief, number " + i,
          status: "proposed",
          category: "healthcare",
          citizenBrief: i === 0
            ? "In plain terms: this bill changes who may apply and by when."
            : null,
        },
      });
      refs.push(row.id);
    }
    for (const id of pool) {
      await prisma.user.update({
        where: { id },
        data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      for (let i = 0; i < 3; i += 1) {
        await prisma.post.create({
          data: { authorId: id, content: "A position worth putting a name to, number " + i + "." },
        });
      }
      await prisma.governmentReferenceVote.createMany({
        data: refs.map((referenceId) => ({
          governmentReferenceId: referenceId,
          userId: id,
          position: "support",
        })),
        skipDuplicates: true,
      });
    }
    const reported = await prisma.post.create({
      data: {
        authorId: "${ACCUSED.id}",
        content: "This bill strips the protection in section four. Read it yourself.",
        governmentReferenceId: refs[0],
      },
    });
    console.log(JSON.stringify({ postId: reported.id }));
  `).split("\n").forEach((line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed.postId) postId = parsed.postId;
    } catch { /* not the line we want */ }
  });

  if (!postId) throw new Error("could not create the post this check reports");

  const cookies = {};
  for (const person of EVERYONE) cookies[person.id] = await signIn(person);

  // The report, through the real endpoint the button calls.
  const filed = await asCitizen(cookies[REPORTER.id], "/api/safety/reports", "POST", {
    postId,
    reason: "misinformation",
    detail: "Section four does the opposite of what this post says it does.",
  });
  const filedBody = await filed.json();
  juryId = filedBody.juryId;
  check("reporting a post draws a jury", filed.status === 201 && Boolean(juryId), String(filed.status));
  check("…of five, summoned at once", filedBody.jurorsSummoned === 5, String(filedBody.jurorsSummoned));

  const seatedIds = JSON.parse(
    db(`
      const seats = await prisma.jurySeat.findMany({
        where: { juryId: "${juryId}" },
        select: { jurorId: true },
      });
      console.log(JSON.stringify(seats.map((s) => s.jurorId)));
    `).split("\n").filter(Boolean).pop(),
  );
  const jurors = POOL.filter((p) => seatedIds.includes(p.id));
  check("the panel is drawn from the people who earned it", jurors.length === 5, seatedIds.join(", "));

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
   * The session is seeded rather than typed: the form path is proven by
   * article-v-check and every-page-check, and this check opens six sessions.
   * Both servers are on 127.0.0.1 and cookies ignore port, so one cookie covers
   * the page and the API it calls.
   */
  async function open(who, path) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
    await acceptTermsBeforeLoad(context);

    if (who) {
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
    }

    const page = await context.newPage();
    await routeApiToLocal(page, API);
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#root", { timeout: 25_000 });
    await page.waitForTimeout(700);
    return { context, page };
  }

  const screen = (page) => page.evaluate(() => document.getElementById("root")?.innerText ?? "");

  {
    // A JUROR IS TOLD, without going looking.
    const { context, page } = await open(jurors[0], "/feed");
    await page.waitForSelector('[data-testid="jury-summons-banner"]', { timeout: 20_000 }).catch(() => undefined);
    const text = await screen(page);
    check(
      "A DRAWN JUROR IS TOLD ON THE PAGE",
      /You have been called to a jury/i.test(text),
      text.slice(0, 200).replace(/\n/g, " | "),
    );
    await context.close();
  }

  {
    const { context, page } = await open(jurors[0], `/jury/${juryId}`);
    let text = await screen(page);

    check(
      "the case shows what was reported, in full",
      /strips the protection in section four/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    check(
      "…and why it was reported",
      /Misrepresents a law/i.test(text) && /Section four does the opposite/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "…and the law it points at, with its citizen's brief",
      /A law with a plain-English brief/i.test(text) && /this bill changes who may apply/i.test(text),
      text.slice(0, 600).replace(/\n/g, " | "),
    );
    check(
      "…and how the jury was drawn, so it can be checked",
      /How this jury was drawn/i.test(text) && /never from the accused's own delegators/i.test(text),
      text.slice(-400).replace(/\n/g, " | "),
    );
    check(
      "PRIOR FINDINGS ARE NOT ON THE PAGE BEFORE THE VERDICT",
      (await page.locator('[data-testid="jury-prior-findings"]').count()) === 0,
    );

    // ACCEPTING CLOSES THE PLATFORM.
    await page.locator('[data-testid="jury-accept"]').click();
    await page.waitForSelector('[data-testid="jury-submit"]', { timeout: 20_000 });
    check("accepting the summons opens the decision", true);

    await page.goto(`${base}/feed`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_500);
    check(
      "THE PLATFORM CLOSES AROUND THE CASE — going to the feed comes straight back",
      page.url().includes(`/jury/${juryId}`),
      page.url(),
    );

    // A VERDICT CANNOT BE CAST WITHOUT SAYING WHY.
    await page.locator('[data-testid="jury-uphold"]').click();
    await page.locator('[data-testid="jury-reasoning"]').fill("no");
    check(
      "a verdict cannot be cast without saying why",
      await page.locator('[data-testid="jury-submit"]').isDisabled(),
    );

    await page
      .locator('[data-testid="jury-reasoning"]')
      .fill("Section four plainly keeps the protection this post says it removes.");
    check(
      "…and can be once they have",
      !(await page.locator('[data-testid="jury-submit"]').isDisabled()),
    );

    await page.locator('[data-testid="jury-submit"]').click();
    await page.waitForSelector('[data-testid="jury-voted"]', { timeout: 20_000 }).catch(() => undefined);
    text = await screen(page);
    check(
      "voting releases them",
      /free to go/i.test(text),
      text.slice(0, 400).replace(/\n/g, " | "),
    );

    await page.goto(`${base}/feed`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_200);
    check("…and the rest of the platform is theirs again", !page.url().includes("/jury/"), page.url());
    await context.close();
  }

  {
    // STEPPING ASIDE. An account nobody can leave is a trap.
    const { context, page } = await open(jurors[4], `/jury/${juryId}`);
    await page.locator('[data-testid="jury-accept"]').click();
    await page.waitForSelector('[data-testid="jury-submit"]', { timeout: 20_000 });

    await page.locator('[data-testid="jury-step-aside"]').last().click();
    await page.locator('[data-testid="jury-recusal-reason"]').fill("I know the person this is about.");
    await page.locator('[data-testid="jury-recuse-confirm"]').click();
    await page.waitForURL((url) => !url.pathname.startsWith("/jury/"), { timeout: 20_000 }).catch(() => undefined);
    check(
      "STEPPING ASIDE RELEASES THEM IMMEDIATELY",
      !page.url().includes(`/jury/${juryId}`),
      page.url(),
    );
    await context.close();

    // …and it is on the record, with the reason, and a replacement is drawn.
    const seat = JSON.parse(
      db(`
        const row = await prisma.jurySeat.findFirst({
          where: { juryId: "${juryId}", jurorId: "${jurors[4].id}" },
          select: { state: true, recusedReason: true },
        });
        const live = await prisma.jurySeat.count({
          where: { juryId: "${juryId}", state: { in: ["summoned", "accepted"] } },
        });
        console.log(JSON.stringify({ ...row, live }));
      `).split("\n").filter(Boolean).pop(),
    );
    check("…the seat is kept, with the reason", seat.state === "recused" && /know the person/i.test(seat.recusedReason ?? ""), JSON.stringify(seat));
  }

  {
    // Two more verdicts close it. These go over HTTP rather than through the
    // browser: the screen path is proven above, juror by juror, and what these
    // two are for is reaching the threshold — not re-proving a button.
    for (const juror of [jurors[1], jurors[2]]) {
      await asCitizen(cookies[juror.id], `/api/juries/${juryId}/accept`, "POST");
      const cast = await asCitizen(cookies[juror.id], `/api/juries/${juryId}/verdict`, "POST", {
        vote: "uphold",
        reasoning: "Agreed. The section cited says the opposite of the claim made about it.",
      });
      check(`${juror.username} records a verdict`, cast.status === 200, String(cast.status));
    }

    const decided = JSON.parse(
      db(`
        const jury = await prisma.jury.findUnique({
          where: { id: "${juryId}" },
          select: { status: true, verdict: true },
        });
        const report = await prisma.report.findFirst({ select: { status: true } });
        console.log(JSON.stringify({ ...jury, report: report?.status }));
      `).split("\n").filter(Boolean).pop(),
    );
    check("THREE JURORS DECIDE IT", decided.status === "decided" && decided.verdict === "upheld", JSON.stringify(decided));
    check("…and the report stops being open", decided.report === "actioned", JSON.stringify(decided));
  }

  {
    // A DECIDED CASE IS PUBLIC — signed out, no cookie at all.
    const { context, page } = await open(null, `/jury/${juryId}`);
    const text = await screen(page);
    check(
      "a decided case is public to a stranger",
      /This report was upheld/i.test(text),
      text.slice(0, 300).replace(/\n/g, " | "),
    );
    check(
      "…with every juror's reasoning",
      (await page.locator('[data-testid="jury-reason"]').count()) === 3,
      String(await page.locator('[data-testid="jury-reason"]').count()),
    );
    check(
      "…and no juror named against any of them",
      !jurors.some((j) => text.includes(j.username) || text.includes(j.name)),
      text.slice(0, 400).replace(/\n/g, " | "),
    );
    check(
      "PRIOR FINDINGS APPEAR ONLY NOW",
      (await page.locator('[data-testid="jury-prior-findings"]').count()) === 1,
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
console.log("\nThe Judiciary is real: drawn at random, sequestered while deciding, and published when done.");
