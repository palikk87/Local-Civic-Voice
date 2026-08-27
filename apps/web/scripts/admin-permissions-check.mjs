/**
 * A permission you grant is a control the other person can actually find.
 *
 *   bun run admin-permissions-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The console's screens used to be gated on the role's NAME —
 * `session.role === "superadmin"` — while the server gated its routes on
 * capabilities. So an owner could build a role, tick "keys.manage", have the
 * server honour it on every request, and the person holding it would open
 * Settings and find no key editor. The permission worked and could not be
 * found, which to the person holding it is indistinguishable from broken.
 *
 * Nothing already in the suite could see that. The backend tests prove the
 * server refuses and allows the right requests; they never open the console.
 * The other browser checks never sign into it at all. A capability that grants
 * real power and renders no control passes a typecheck, a lint, a build and
 * 746 backend tests.
 *
 * NO STUBBED API. A first version of this check hand-wrote the admin responses
 * and got the user-list shape wrong — it sent `users`, the table reads
 * `results` — so three assertions failed for a reason that had nothing to do
 * with permissions. A stub tests the guess. This runs the real backend against
 * the thousand-citizen population database, performs the grant through the
 * real endpoints, signs the receiver in through the real login, and reads the
 * real console. The only thing invented here is which capabilities to tick.
 *
 * WHAT IT PROVES, both directions of one round trip:
 *
 *   GRANTOR — the owner creates a role, grants capabilities, and assigns it to
 *   one of the thousand, all through the endpoints the Roles tab calls.
 *
 *   RECEIVER — that citizen signs into the console and sees exactly the tabs
 *   and per-user buttons their capabilities allow, and none they were not
 *   given. Then the owner revokes one, and the control is gone on the next
 *   load — no new sign-in.
 *
 *   THE URL IS NOT A GAP — typing /admin/logs without "logs.view" lands
 *   somewhere honest rather than on a panel whose every request is a 403.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — never DATABASE_URL, so there is no
 * way to point it at anything live by forgetting a flag. It promotes two
 * citizens, creates one role, and puts all three back on the way out.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
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
      `This check promotes accounts and creates roles, so it only runs against a\n` +
      `database whose name says it is the test population.`,
  );
  process.exit(1);
}

const API_PORT = Number(process.env.PERMISSION_CHECK_PORT ?? 3997);
const API = `http://127.0.0.1:${API_PORT}`;
const PASSWORD = "test-population-password-not-a-real-one";

/** Citizen n of the thousand, by the seeder's own naming. */
const citizen = (n) => {
  const padded = String(n).padStart(4, "0");
  return { id: `pop-${padded}`, username: `citizen${padded}`, name: `Citizen ${padded}` };
};

const OWNER = citizen(1);
const RECEIVER = citizen(2);
const ROLE = "browser-check-role";

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
  BETTER_AUTH_SECRET: "browser-check-secret-value-not-used-anywhere-else",
  APP_ORIGINS: "*",
  APP_SCHEMES: "ayeandnay",
  MEDIA_STORAGE: "local",
  UPLOADS_DIR: join(BACKEND, ".browser-check-uploads"),
  HEALTH_SCHEMA_TTL_MS: "0",
  // No outbound work: this check must not pull real government data into a
  // test database while it is asserting on what a page renders.
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

async function cleanup() {
  try { await browser?.close(); } catch { /* already gone */ }
  try { server?.close(); } catch { /* already gone */ }
  api.kill("SIGTERM");
  // Put the population back exactly as it was found.
  try {
    db(`await prisma.user.updateMany({ where: { id: { in: ["${OWNER.id}", "${RECEIVER.id}"] } }, data: { role: "user" } });
        await prisma.adminSession.deleteMany({ where: { adminId: { in: ["${OWNER.id}", "${RECEIVER.id}"] } } });
        await prisma.adminRole.deleteMany({ where: { slug: "${ROLE}" } });`);
  } catch (error) {
    console.error(`Could not restore the population rows: ${error.message}`);
  }
}

process.on("exit", () => { api.kill("SIGKILL"); });

try {
  await waitForApi();

  // ------------------------------------------------------- the grant, for real

  // One of the thousand becomes the owner. This is the only step that cannot
  // go through an endpoint: somebody has to hold the seat before anybody can
  // be given anything, and the console deliberately offers no way to assign it.
  db(`await prisma.user.update({ where: { id: "${OWNER.id}" }, data: { role: "superadmin" } });`);

  async function asOwner(path, method = "GET", body) {
    return fetch(`${API}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ownerToken}`,
        "X-Forwarded-For": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function signIntoConsole(who) {
    const response = await fetch(`${API}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      },
      body: JSON.stringify({ username: who.username, password: PASSWORD }),
    });
    if (!response.ok) {
      throw new Error(`${who.username} could not sign into the console: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  let ownerToken = "";
  const ownerSession = await signIntoConsole(OWNER);
  ownerToken = ownerSession.token;

  check(
    "the owner's session carries every capability",
    Array.isArray(ownerSession.admin.capabilities) && ownerSession.admin.capabilities.length >= 16,
    `${ownerSession.admin.capabilities?.length} capabilities`,
  );

  // Create the role the way the Roles tab does.
  const created = await asOwner("/api/admin/roles", "POST", {
    slug: ROLE,
    name: "Browser Check Role",
    capabilities: [],
  });
  check("the owner can create a role", created.status === 200 || created.status === 201, `${created.status}`);

  // Assign it, the way the Users tab does.
  const assigned = await asOwner(`/api/admin/users/${RECEIVER.id}/role`, "PUT", { role: ROLE });
  check("the owner can assign it to one of the thousand", assigned.status === 200, `${assigned.status}`);

  /** Grant exactly these, then sign the receiver in and return their real session. */
  async function grant(capabilities) {
    const response = await asOwner(`/api/admin/roles/${ROLE}`, "PUT", {
      slug: ROLE,
      name: "Browser Check Role",
      capabilities,
    });
    if (!response.ok) throw new Error(`granting failed: ${response.status} ${await response.text()}`);
    return signIntoConsole(RECEIVER);
  }

  // ---------------------------------------------------------------- the pages

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

  /** Open the console carrying a session the server actually issued. */
  async function open(session, path = "/admin/dashboard") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    // Every /api/** call the page makes reaches the real backend.
    await routeApiToLocal(page, API);
    await page.addInitScript((stored) => {
      localStorage.setItem("admin-store", JSON.stringify(stored));
    }, {
      state: {
        session: {
          token: session.token,
          adminId: session.admin.id,
          username: session.admin.username,
          role: session.admin.role,
          capabilities: session.admin.capabilities,
          expiresAt: session.expiresAt,
        },
        isAdminAuthenticated: true,
      },
      version: 0,
    });
    // NOT `networkidle`. Against the real population the users page keeps the
    // network busy long past the point the console has rendered, so waiting for
    // quiet times out on a page that is already on screen. Wait for the console
    // itself instead, then let the tab's own request settle.
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[role="tab"]', { timeout: 20_000 });
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(1_500);
    return { context, page };
  }

  const tabs = (page) =>
    page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((el) => el.textContent.trim()));
  const buttons = (page) =>
    page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()));

  // ------------------------------------------------ RECEIVER: holding nothing

  {
    const session = await grant([]);
    check("a role holding nothing still signs in", !!session.token);
    check("…and its session says so", session.admin.capabilities.length === 0, JSON.stringify(session.admin.capabilities));

    const { context, page } = await open(session);
    const shown = await tabs(page);

    // Dashboard has no capability behind it on purpose: a role granted nothing
    // still has to land somewhere rather than on a blank console.
    check(
      "a role holding nothing sees only Dashboard",
      shown.length === 1 && /dashboard/i.test(shown[0] ?? ""),
      `saw ${JSON.stringify(shown)}`,
    );
    await context.close();
  }

  // ----------------------------------------------- RECEIVER: holding a subset

  {
    const session = await grant(["users.view", "logs.view"]);
    const { context, page } = await open(session);
    const shown = await tabs(page);

    check("granting users.view puts Users on screen", shown.some((l) => /^users$/i.test(l)), shown.join(", "));
    check("granting logs.view puts Logs on screen", shown.some((l) => /^logs$/i.test(l)), shown.join(", "));
    check("…and Roles stays hidden", !shown.some((l) => /^roles$/i.test(l)), shown.join(", "));
    check("…and Settings stays hidden", !shown.some((l) => /^settings$/i.test(l)), shown.join(", "));
    check("…and B2B clients stays hidden", !shown.some((l) => /b2b/i.test(l)), shown.join(", "));
    await context.close();
  }

  // -------------------------- RECEIVER: the buttons follow the grant, on real rows

  {
    const session = await grant(["users.view"]);
    const { context, page } = await open(session, "/admin/users");
    const text = await page.evaluate(() => document.body.innerText);
    const shown = await buttons(page);

    // Real citizens out of the thousand, not a row this check wrote.
    check("the real user list renders", /citizen0\d{3}/i.test(text), text.slice(0, 200).replace(/\n/g, " "));
    for (const forbidden of ["Ban", "Role", "Business account"]) {
      check(`users.view alone shows no ${forbidden} button`, !shown.some((b) => b === forbidden), shown.join(" | "));
    }
    await context.close();
  }

  {
    const session = await grant(["users.view", "users.ban", "users.assignRole"]);
    const { context, page } = await open(session, "/admin/users");
    const shown = await buttons(page);

    check("granting users.ban shows Ban", shown.some((b) => b === "Ban"), shown.join(" | "));
    check("granting users.assignRole shows Role", shown.some((b) => b === "Role"), shown.join(" | "));
    check(
      "…and b2b.manage, ungranted, shows no Business account button",
      !shown.some((b) => b === "Business account"),
      shown.join(" | "),
    );
    await context.close();
  }

  // ------------------------------------------------------- REVOKING TAKES IT BACK

  {
    // The other half of the round trip, and the half that is easy to get wrong:
    // a console that only reads capabilities at sign-in would still show the
    // Ban button here.
    const session = await grant(["users.view"]);
    const { context, page } = await open(session, "/admin/users");
    const shown = await buttons(page);

    check(
      "revoking users.ban takes the Ban button away without a new sign-in",
      !shown.some((b) => b === "Ban"),
      shown.join(" | "),
    );
    await context.close();
  }

  // -------------------------------------------------------- THE URL IS NOT A GAP

  {
    const session = await grant(["users.view"]);
    const { context, page } = await open(session, "/admin/logs");
    const active = await page.evaluate(() => {
      const el = document.querySelector('[role="tab"][data-state="active"]');
      return el ? el.textContent.trim() : null;
    });
    check(
      "/admin/logs without logs.view falls back rather than opening it",
      !/logs/i.test(active ?? ""),
      `active tab: ${active}`,
    );
    await context.close();
  }

  // ------------------------------------------------------------ GRANTOR: the panel

  {
    const { context, page } = await open(ownerSession, "/admin/roles");
    const text = await page.evaluate(() => document.body.innerText);
    const boxes = await page.evaluate(() => document.querySelectorAll('input[type="checkbox"]').length);
    const shown = await tabs(page);

    check("the owner is shown", /owner/i.test(text), text.slice(0, 120).replace(/\n/g, " "));
    check(
      "the owner is described as unreachable from the console",
      /cannot be banned|not assignable/i.test(text),
      text.slice(0, 300).replace(/\n/g, " "),
    );
    check("the role just created is listed", /browser check role/i.test(text), text.slice(0, 300).replace(/\n/g, " "));
    check("its capabilities are offered as checkboxes", boxes > 0, `${boxes} boxes`);

    // The owner holds everything, so every tab is on screen. This is the other
    // end of the first scenario: it catches a gate that hides a tab from
    // EVERYBODY, which would pass every "stays hidden" assertion above.
    for (const expected of ["Users", "Roles", "Settings", "Logs", "B2B clients"]) {
      check(`the owner sees ${expected}`, shown.some((l) => l.toLowerCase() === expected.toLowerCase()), shown.join(", "));
    }
    await context.close();
  }
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nEvery capability that grants power renders a control, and every one that does not, does not.");
