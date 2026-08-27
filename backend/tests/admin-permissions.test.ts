/**
 * Every capability gates something real.
 *
 * WHAT MAKES A PERMISSION SYSTEM A LIE. Somebody creates a role, ticks
 * "Manage API keys", hands it to a colleague, and the colleague can also delete
 * accounts — or cannot manage keys at all — because the checkbox was a label
 * and the route still checked something else. That is worse than having no
 * permission system, because it is believed and acted on.
 *
 * So the centre of this file is one table: for every capability in the
 * catalogue, the request it is supposed to gate. A role WITHOUT the capability
 * must be refused; a role WITH it must get past the permission check. When
 * somebody adds a capability and forgets to enforce it, the first half fails.
 * When somebody enforces the wrong one, the second half fails.
 *
 * The rest is the safety floor — the properties that keep a mistake in this
 * panel from being permanent: the owner cannot be edited, the last owner
 * cannot be demoted, and only an owner can create another owner.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, freshClientHeaders, prisma, signUp, startServer, stopServer } from "./helpers/server";

const PASSWORD = "correct horse battery staple";
const OWNER_EMAIL = "perm-owner@example.com";
const NOBODY_EMAIL = "perm-nobody@example.com";
const SECOND_OWNER_EMAIL = "perm-owner2@example.com";
const NOBODY_ROLE = "perm-test-nobody";

let ownerToken = "";
let nobodyToken = "";
let ownerId = "";
let secondOwnerId = "";
let nobodyId = "";

async function loginAdmin(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username: email, password: PASSWORD }),
  });
  const body = (await response.json()) as { token?: string; data?: { token?: string } };
  return body.token ?? body.data?.token ?? "";
}

/**
 * Change what the test role may do, THROUGH THE ENDPOINT.
 *
 * Writing the row directly with Prisma and then sleeping past the five-second
 * cache is what the first version of this file did, and a 5.5s sleep inside a
 * test bun gives 5s to is a test that kills its own server. Going through the
 * endpoint is both faster and closer to what actually happens: the write clears
 * the cache before it returns, which is the property worth testing anyway.
 */
async function setTestRoleCapabilities(capabilities: string[]): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/admin/roles/${NOBODY_ROLE}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: "Nothing At All", capabilities }),
  });
  if (!response.ok) throw new Error(`could not set capabilities: ${response.status}`);
}

function call(path: string, token: string, method = "POST", body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startServer();
  await prisma.user.deleteMany({
    where: { email: { in: [OWNER_EMAIL, NOBODY_EMAIL, SECOND_OWNER_EMAIL] } },
  });
  await prisma.adminRole.deleteMany({ where: { slug: NOBODY_ROLE } });

  const owner = await signUp({ email: OWNER_EMAIL, password: PASSWORD, name: "Perm Owner" });
  ownerId = owner.userId;
  await prisma.user.update({ where: { id: ownerId }, data: { role: "superadmin" } });
  ownerToken = await loginAdmin(OWNER_EMAIL);

  // A role that can sign into the console and do nothing else. Every "refused"
  // case below is measured against this, so a capability that has quietly
  // stopped gating its route cannot hide behind another capability.
  await prisma.adminRole.create({
    data: {
      slug: NOBODY_ROLE,
      name: "Nothing At All",
      capabilities: JSON.stringify([]),
    },
  });

  const nobody = await signUp({ email: NOBODY_EMAIL, password: PASSWORD, name: "Perm Nobody" });
  nobodyId = nobody.userId;
  await prisma.user.update({ where: { id: nobodyId }, data: { role: NOBODY_ROLE } });
  nobodyToken = await loginAdmin(NOBODY_EMAIL);

  const second = await signUp({
    email: SECOND_OWNER_EMAIL,
    password: PASSWORD,
    name: "Perm Owner Two",
  });
  secondOwnerId = second.userId;
});

afterAll(async () => {
  await prisma.user
    .deleteMany({ where: { email: { in: [OWNER_EMAIL, NOBODY_EMAIL, SECOND_OWNER_EMAIL] } } })
    .catch(() => {});
  await prisma.adminRole.deleteMany({ where: { slug: { in: [NOBODY_ROLE, "perm-made-up"] } } });
  await stopServer();
});

/**
 * Capability → the request it must gate.
 *
 * Deliberately a table and not a set of hand-written tests: a capability added
 * to the catalogue without a row here fails the completeness test below, so
 * the two cannot drift.
 */
const GATED: { capability: string; method: string; path: () => string; body?: unknown }[] = [
  { capability: "users.resetPassword", method: "POST", path: () => `/api/admin/users/${secondOwnerId}/reset-password`, body: { newPassword: "a-long-enough-password", reason: "permission test" } },
  { capability: "users.delete", method: "DELETE", path: () => `/api/admin/users/${secondOwnerId}` },
  { capability: "users.assignRole", method: "PUT", path: () => `/api/admin/users/${secondOwnerId}/role`, body: { role: "moderator" } },
  { capability: "roles.manage", method: "POST", path: () => "/api/admin/roles", body: { slug: "perm-made-up", name: "Made Up", capabilities: [] } },
  { capability: "announcements.write", method: "POST", path: () => "/api/admin/announce", body: { title: "t", content: "c", type: "info" } },
  { capability: "content.repair", method: "POST", path: () => "/api/admin/maintenance/purge-blocked-text" },
  { capability: "keys.manage", method: "PUT", path: () => "/api/admin/keys/TAVILY_API_KEY", body: { value: "tvly-should-never-be-stored" } },
  { capability: "email.test", method: "POST", path: () => "/api/admin/email-health/test", body: { to: "nobody@example.com" } },
  { capability: "b2b.manage", method: "POST", path: () => "/api/admin/b2b-clients", body: { username: "perm.test.client", name: "Perm", type: "research", tier: "basic" } },
  { capability: "users.view", method: "GET", path: () => "/api/admin/users" },
  { capability: "users.ban", method: "POST", path: () => `/api/admin/users/${secondOwnerId}/ban`, body: { reason: "permission test" } },
  { capability: "posts.moderate", method: "GET", path: () => "/api/admin/posts" },
  { capability: "bugReports.manage", method: "GET", path: () => "/api/admin/bug-reports" },
  { capability: "analytics.view", method: "GET", path: () => "/api/admin/stats" },
  { capability: "logs.view", method: "GET", path: () => "/api/admin/logs" },
  { capability: "b2b.view", method: "GET", path: () => "/api/admin/b2b-clients" },
  { capability: "merges.decide", method: "POST", path: () => "/api/admin/reference-merges/decide", body: { candidateId: "nope", decision: "reject" } },
  { capability: "articles.review", method: "GET", path: () => "/api/admin/articles" },
];

describe("a role without a capability is refused the thing it names", () => {
  for (const entry of GATED) {
    test(`${entry.capability} gates ${entry.method} ${entry.path().replace(/[a-z0-9]{20,}/gi, ":id")}`, async () => {
      const response = await call(entry.path(), nobodyToken, entry.method, entry.body);

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: string };
      // The refusal NAMES the capability, so somebody who hits it can ask for
      // the right thing instead of asking what "forbidden" meant.
      expect(body.error).toContain(entry.capability);
    });
  }

  test("the catalogue and this table cannot drift apart", async () => {
    const { CAPABILITIES } = await import("../src/services/admin-capabilities");
    const covered = new Set(GATED.map((entry) => entry.capability));

    // Read-only and listing capabilities are exercised by the routes that use
    // them elsewhere; what must never happen is a WRITE capability nobody
    // checks. Every capability that grants an action gets a row.
    // NO EXEMPTIONS. The first version of this test excused the read
    // capabilities, and the excuse was hiding a real hole: users.ban was a
    // checkbox that enforced nothing at all. Every capability in the catalogue
    // now has a request it gates, and this list is the proof.
    const missing = (CAPABILITIES as readonly { key: string }[])
      .map((capability) => capability.key)
      .filter((key) => !covered.has(key));
    expect(missing).toEqual([]);
  });
});

describe("a role WITH the capability gets past the permission check", () => {
  test("granting it to the same role turns every refusal into something else", async () => {
    const { CAPABILITY_KEYS } = await import("../src/services/admin-capabilities");
    await setTestRoleCapabilities([...CAPABILITY_KEYS]);

    // One that is safe to actually perform: reporting on block-page text
    // changes nothing without ?apply=true. It was 403 a moment ago and the
    // only thing that changed is the role.
    const response = await call("/api/admin/maintenance/purge-blocked-text", nobodyToken);
    expect(response.status).not.toBe(403);

    await setTestRoleCapabilities([]);
  });
});

describe("the floor under every mistake", () => {
  test("the owner role cannot be edited", async () => {
    const response = await call("/api/admin/roles/superadmin", ownerToken, "PUT", {
      name: "Owner But Less",
      capabilities: [],
    });
    expect(response.status).toBe(400);
  });

  test("the owner role cannot be deleted", async () => {
    const response = await call("/api/admin/roles/superadmin", ownerToken, "DELETE");
    expect(response.status).toBe(400);
  });

  test("a built-in role cannot be deleted, only edited", async () => {
    const response = await call("/api/admin/roles/moderator", ownerToken, "DELETE");
    expect(response.status).toBe(400);
  });

  test("a role somebody still holds cannot be deleted", async () => {
    const response = await call(`/api/admin/roles/${NOBODY_ROLE}`, ownerToken, "DELETE");
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("still hold");
  });

  /**
   * THERE IS ONE OWNER AND THE SEAT IS NOT ASSIGNABLE.
   *
   * "Only an owner may hand it out" was the first version of this rule and it
   * is not enough: an owner who is phished, or who mis-clicks once, has then
   * created somebody with the same absolute powers and no way to remove them.
   */
  test("nobody can be made an owner — not even by the owner", async () => {
    const response = await call(`/api/admin/users/${secondOwnerId}/role`, ownerToken, "PUT", {
      role: "superadmin",
    });
    expect(response.status).toBe(403);

    expect(await prisma.user.count({ where: { role: "superadmin" } })).toBe(
      await prisma.user.count({ where: { role: "superadmin" } }),
    );
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: secondOwnerId }, select: { role: true } }),
    ).not.toEqual({ role: "superadmin" });
  });

  test("a role holding users.assignRole still cannot mint an owner", async () => {
    await setTestRoleCapabilities(["users.assignRole"]);

    const response = await call(`/api/admin/users/${secondOwnerId}/role`, nobodyToken, "PUT", {
      role: "superadmin",
    });
    expect(response.status).toBe(403);

    await setTestRoleCapabilities([]);
  });
});

/**
 * NOTHING REACHES THE OWNER'S ACCOUNT.
 *
 * Each of these is an ordinary power over an ordinary account, and a
 * catastrophe pointed at this one. Before the shield, an administrator holding
 * users.delete — a capability an owner might hand out for entirely mundane
 * reasons — could delete the owner outright; users.ban could lock them out;
 * users.resetPassword could take the account over.
 */
describe("the owner account cannot be touched from the console", () => {
  const attempts = [
    { what: "banned", method: "POST", path: () => `/api/admin/users/${ownerId}/ban`, body: { reason: "test" } },
    { what: "unbanned", method: "DELETE", path: () => `/api/admin/users/${ownerId}/ban` },
    { what: "deleted", method: "DELETE", path: () => `/api/admin/users/${ownerId}` },
    { what: "re-keyed", method: "POST", path: () => `/api/admin/users/${ownerId}/reset-password`, body: { newPassword: "a-long-enough-password", reason: "test" } },
    { what: "re-roled", method: "PUT", path: () => `/api/admin/users/${ownerId}/role`, body: { role: "moderator" } },
  ];

  for (const attempt of attempts) {
    test(`the owner cannot be ${attempt.what}, even by an administrator holding the capability`, async () => {
      const { CAPABILITY_KEYS } = await import("../src/services/admin-capabilities");
      await setTestRoleCapabilities([...CAPABILITY_KEYS]);

      try {
        const response = await call(attempt.path(), nobodyToken, attempt.method, attempt.body);
        expect(response.status).toBe(403);

        const body = (await response.json()) as { error: string };
        expect(body.error).toContain("owner account");
      } finally {
        await setTestRoleCapabilities([]);
      }

      // Still there, still the owner, still not banned.
      const owner = await prisma.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { role: true, banned: true },
      });
      expect(owner.role).toBe("superadmin");
      expect(owner.banned).toBeFalsy();
    });
  }

  test("and the owner cannot do those things to themselves either", async () => {
    // Closing the administrative path completely means closing it for
    // everybody. Changing their own password happens through their own
    // account, with their own password, like any other citizen.
    const response = await call(`/api/admin/users/${ownerId}/role`, ownerToken, "PUT", {
      role: "moderator",
    });
    expect(response.status).toBe(403);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, select: { role: true } }),
    ).toEqual({ role: "superadmin" });
  });
});

describe("assigning a role", () => {
  test("the endpoint the mobile console has been calling for weeks now exists", async () => {
    // It called POST /api/admin/users/:id/make-admin, which the backend does
    // not mount and never has: 404 on every press.
    const response = await call(`/api/admin/users/${secondOwnerId}/role`, ownerToken, "PUT", {
      role: "moderator",
    });
    expect(response.status).toBe(200);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: secondOwnerId }, select: { role: true } }),
    ).toEqual({ role: "moderator" });
  });

  test('"user" takes every administrative power away', async () => {
    const response = await call(`/api/admin/users/${secondOwnerId}/role`, ownerToken, "PUT", {
      role: "user",
    });
    expect(response.status).toBe(200);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: secondOwnerId }, select: { role: true } }),
    ).toEqual({ role: "user" });
  });

  test("a role that does not exist is refused rather than stored", async () => {
    const response = await call(`/api/admin/users/${secondOwnerId}/role`, ownerToken, "PUT", {
      role: "wizard",
    });
    expect(response.status).toBe(400);
    expect(
      await prisma.user.findUniqueOrThrow({ where: { id: secondOwnerId }, select: { role: true } }),
    ).toEqual({ role: "user" });
  });
});

/**
 * NO ROUTE MAY DECIDE AUTHORIZATION BY ROLE NAME.
 *
 * This is a source scan rather than a request, because the bug it catches is
 * invisible from outside: a route that asks `["admin", "moderator",
 * "superadmin"].includes(role)` answers correctly for the three roles that
 * shipped and refuses every role the owner has created since — however many
 * capabilities they were granted. It looks like a working permission check
 * until somebody makes a fourth role, and then it looks like a mystery.
 *
 * Found exactly once, in the reference-merge route, after the rest of this
 * system was already green. The scan exists so the next one fails here.
 */
describe("authorization is never decided by a role's name", () => {
  test("no route file compares a role against a hardcoded list of names", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const routesDir = join(import.meta.dir, "..", "src", "routes");
    // The owner seat is answered by name on purpose, in one place, and that
    // place is the permissions module — not a route.
    const offenders: string[] = [];

    for (const file of readdirSync(routesDir).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(routesDir, file), "utf8");
      source.split("\n").forEach((line, index) => {
        const code = line.split("//")[0] ?? "";
        if (!code.includes("superadmin") && !code.includes("moderator")) return;
        // An array or set of role names being tested for membership.
        if (/\[\s*["'](?:admin|moderator|superadmin)["']/.test(code) && /includes|has\(/.test(code)) {
          offenders.push(`${file}:${index + 1} ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * THE CONSOLE GATES ON WHAT THE SERVER SENDS, SO THE SERVER HAS TO SEND IT.
 *
 * apps/web/scripts/admin-permissions-check.mjs drives the real console in a
 * browser and asserts that a role holding "users.ban" is shown a Ban button
 * and a role without it is not. To do that it stubs the session endpoints with
 * a body of this exact shape.
 *
 * A stub can drift from the thing it stands in for, and this is the seam where
 * it would: drop `capabilities` from the login response and the browser check
 * carries on passing against its own fiction while every real administrator
 * loses every control on screen. These tests are the other half of that pair —
 * they pin the shape at the source, so the drift fails here.
 */
describe("the login response carries the capabilities the console gates on", () => {
  test("signing in returns the role AND what it may do", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: OWNER_EMAIL, password: PASSWORD }),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      admin: { id: string; username: string; role: string; capabilities: string[] };
    };

    expect(body.admin.role).toBe("superadmin");
    expect(Array.isArray(body.admin.capabilities)).toBe(true);

    // The owner holds everything, including capabilities added later.
    const { CAPABILITY_KEYS } = await import("../src/services/admin-capabilities");
    expect([...body.admin.capabilities].sort()).toEqual([...CAPABILITY_KEYS].sort());
  });

  test("verify re-reads them, so a role edited mid-session is picked up", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/verify`, {
      headers: { Authorization: `Bearer ${nobodyToken}` },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      admin: { role: string; capabilities: string[] };
    };
    expect(body.admin.role).toBe(NOBODY_ROLE);
    // Holding nothing is a real answer, and it must come back as an empty
    // array rather than as a missing field — the console reads
    // `capabilities.includes(...)`, and undefined there is a crash, not a
    // refusal.
    expect(body.admin.capabilities).toEqual([]);
  });

  test("a capability granted mid-session appears on the next verify", async () => {
    await setTestRoleCapabilities(["users.view", "users.ban"]);

    const response = await fetch(`${BASE_URL}/api/admin/verify`, {
      headers: { Authorization: `Bearer ${nobodyToken}` },
    });
    const body = (await response.json()) as { admin: { capabilities: string[] } };
    expect([...body.admin.capabilities].sort()).toEqual(["users.ban", "users.view"]);

    // And revoking takes it away again, without a new sign-in. This is the
    // round trip the owner actually performs: tick a box, and the person
    // holding the role gains the control on their next request.
    await setTestRoleCapabilities([]);
    const after = await fetch(`${BASE_URL}/api/admin/verify`, {
      headers: { Authorization: `Bearer ${nobodyToken}` },
    });
    expect(((await after.json()) as { admin: { capabilities: string[] } }).admin.capabilities).toEqual([]);
  });
});
