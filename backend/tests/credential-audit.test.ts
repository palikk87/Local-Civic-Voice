/**
 * A credential cannot change without leaving a name behind.
 *
 * The source guard next door (credential-writes.test.ts) proves only one file
 * is allowed to write a credential. This proves what that file actually does
 * when it writes one: records who asked and why, waits for the record to land,
 * ends the sessions the old password opened, and makes the whole history
 * readable by the account it is about.
 *
 * The reason both exist is that the failure being prevented was not a crash.
 * It was a B2B password that changed, worked differently afterwards, and left
 * nothing anywhere to say what had happened — which from the paying client's
 * side is indistinguishable from having been broken into.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  B2B_TEST,
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import {
  createB2BClient,
  generateApiKey,
  generatePassword,
  rotateB2BCredentials,
  setUserPassword,
} from "../src/services/credentials";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

let seq = 0;
function uniqueUsername(): string {
  seq += 1;
  return `audit-client-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

async function newClient() {
  const username = uniqueUsername();
  const password = generatePassword();
  const apiKey = generateApiKey();
  const client = await createB2BClient(
    { username, name: "Audit Co", type: "research", tier: "professional", password, apiKey },
    { actor: { kind: "cli", script: "tests/credential-audit.test.ts" }, reason: "Test fixture" },
  );
  return { client, username, password, apiKey };
}

function credentialEvents(clientId: string) {
  return prisma.adminActivityLog.findMany({
    where: { targetType: "system", targetId: clientId },
    orderBy: { createdAt: "asc" },
  });
}

describe("every credential change records who and why", () => {
  test("creating an account is recorded before it is reported", async () => {
    const { client } = await newClient();

    // Not polled. createB2BClient awaits the log write, because a command-line
    // script calls process.exit the instant main() resolves and an unawaited
    // insert dies with the process — leaving exactly the kind of unexplained
    // change this whole mechanism exists to prevent.
    const events = await credentialEvents(client.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe("create_b2b_client");
    expect(events[0]!.details).toContain("Test fixture");
  });

  test("a rotation names the actor and the reason", async () => {
    const { client } = await newClient();

    await rotateB2BCredentials(
      client.id,
      { password: generatePassword() },
      {
        actor: { kind: "admin", adminId: "admin-7", username: "rosa" },
        reason: "Key was pasted into a support ticket",
      },
    );

    const events = await credentialEvents(client.id);
    const rotation = events.find((e) => e.action === "rotate_b2b_client");
    expect(rotation).toBeDefined();
    expect(rotation!.adminUsername).toBe("rosa");
    expect(rotation!.adminId).toBe("admin-7");
    expect(rotation!.details).toContain("Key was pasted into a support ticket");
    expect(rotation!.details).toContain("password");
  });

  test("a change made from a shell says so rather than borrowing an admin's name", async () => {
    const { client } = await newClient();

    await rotateB2BCredentials(
      client.id,
      { apiKey: generateApiKey() },
      {
        actor: { kind: "cli", script: "scripts/seed-b2b.ts" },
        reason: "B2B_ROTATE named the demo account",
      },
    );

    const rotation = (await credentialEvents(client.id)).find(
      (e) => e.action === "rotate_b2b_client",
    );
    // The log must not imply a person did this. "cli:scripts/seed-b2b.ts" is
    // the honest answer to "who changed my password".
    expect(rotation!.adminUsername).toBe("cli:scripts/seed-b2b.ts");
    expect(rotation!.adminId).toBe("cli");
  });

  test("a change with no reason is refused", async () => {
    const { client } = await newClient();

    await expect(
      rotateB2BCredentials(
        client.id,
        { password: generatePassword() },
        { actor: { kind: "cli", script: "somewhere.ts" }, reason: "   " },
      ),
    ).rejects.toThrow(/reason/i);

    // And nothing moved.
    const events = await credentialEvents(client.id);
    expect(events.filter((e) => e.action === "rotate_b2b_client")).toHaveLength(0);
  });

  test("rotating a password ends the sessions it opened", async () => {
    const { client, username, password } = await newClient();

    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username, password }),
    });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as { token: string };

    const before = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(before.status).toBe(200);

    const { revokedSessions } = await rotateB2BCredentials(
      client.id,
      { password: generatePassword() },
      { actor: { kind: "admin", adminId: "a1", username: "rosa" }, reason: "Suspected leak" },
    );
    expect(revokedSessions).toBe(1);

    // The whole reason to rotate after a leak. Leaving the session alive would
    // mean the rotation changed nothing for as long as the stolen token lasted.
    const after = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(after.status).toBe(401);
  });

  test("rotating only the API key leaves live sessions alone", async () => {
    const { client } = await newClient();
    const { revokedSessions, passwordChanged, apiKeyChanged } = await rotateB2BCredentials(
      client.id,
      { apiKey: generateApiKey() },
      { actor: { kind: "admin", adminId: "a1", username: "rosa" }, reason: "Scheduled rotation" },
    );

    expect(passwordChanged).toBe(false);
    expect(apiKeyChanged).toBe(true);
    expect(revokedSessions).toBe(0);
  });

  test("a person's password change is recorded too", async () => {
    const person = await prisma.user.create({
      data: { name: "Operator", email: `operator-${seq++}@example.invalid` },
    });

    const { created } = await setUserPassword(person.id, generatePassword(), {
      actor: { kind: "cli", script: "scripts/seed-admin.ts" },
      reason: "The account had no credential row",
    });
    expect(created).toBe(true);

    const first = await prisma.adminActivityLog.findFirst({
      where: { targetId: person.id },
      orderBy: { createdAt: "desc" },
    });
    expect(first!.action).toBe("set_user_password");

    await setUserPassword(person.id, generatePassword(), {
      actor: { kind: "cli", script: "scripts/seed-admin.ts" },
      reason: "ADMIN_ROTATE was set on a seed run",
    });

    const second = await prisma.adminActivityLog.findFirst({
      where: { targetId: person.id },
      orderBy: { createdAt: "desc" },
    });
    // Setting a password on an account nobody could sign in to takes nothing
    // away; replacing a working one does. The log tells them apart.
    expect(second!.action).toBe("rotate_user_password");
    expect(second!.details).toContain("ADMIN_ROTATE");
  });
});

describe("a person controls their own password", () => {
  const PASSWORD = "original-password-not-a-real-one";

  async function person(): Promise<{ cookie: string; userId: string; email: string }> {
    seq += 1;
    const email = `holder${seq}@example.com`;
    const account = await signUp({ email, password: PASSWORD, name: `Holder ${seq}` });
    return { ...account, email };
  }

  function withCookie(cookie: string) {
    return freshClientHeaders({ "Content-Type": "application/json", cookie });
  }

  async function changePassword(
    cookie: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${BASE_URL}/api/users/me/password`, {
      method: "POST",
      headers: withCookie(cookie),
      body: JSON.stringify(body),
    });
  }

  async function canSignIn(email: string, password: string): Promise<boolean> {
    const response = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ identifier: email, password }),
    });
    return response.ok;
  }

  test("they can change it, and the new one works", async () => {
    const holder = await person();

    const response = await changePassword(holder.cookie, {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });
    expect(response.status).toBe(200);

    expect(await canSignIn(holder.email, "a-brand-new-password")).toBe(true);
    expect(await canSignIn(holder.email, PASSWORD)).toBe(false);
  });

  test("a session cookie alone is not enough — the old password is required", async () => {
    const holder = await person();

    const response = await changePassword(holder.cookie, {
      currentPassword: "not-the-right-one",
      newPassword: "a-brand-new-password",
    });

    // Somebody who reaches an unlocked laptop must not be able to take the
    // account permanently.
    expect(response.status).toBe(403);
    expect(await canSignIn(holder.email, PASSWORD)).toBe(true);
  });

  test("changing it does not sign them out of the device they did it on", async () => {
    const holder = await person();

    await changePassword(holder.cookie, {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });

    // Being signed out by the act of securing your account reads as the change
    // having broken something. /me/standing is used rather than /me because
    // GET /api/users/:id answers a signed-out caller with 404 rather than 401 —
    // it reads "me" as an id — so it cannot tell the two apart.
    const stillHere = await fetch(`${BASE_URL}/api/users/me/standing`, {
      headers: withCookie(holder.cookie),
    });
    expect(stillHere.status).toBe(200);
  });

  test("but it does end the other sessions", async () => {
    const holder = await person();

    const elsewhere = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ identifier: holder.email, password: PASSWORD }),
    });
    expect(elsewhere.ok).toBe(true);
    const otherCookie = elsewhere.headers.get("set-cookie")!.split(";")[0]!;

    const response = await changePassword(holder.cookie, {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });
    expect(((await response.json()) as { signedOutOtherDevices: number }).signedOutOtherDevices)
      .toBeGreaterThanOrEqual(1);

    const otherDevice = await fetch(`${BASE_URL}/api/users/me/standing`, {
      headers: freshClientHeaders({ cookie: otherCookie }),
    });
    expect(otherDevice.status).toBe(401);
  });

  test("the change is recorded as theirs, not as an administrator's", async () => {
    const holder = await person();

    await changePassword(holder.cookie, {
      currentPassword: PASSWORD,
      newPassword: "a-brand-new-password",
    });

    const event = await prisma.adminActivityLog.findFirst({
      where: { targetId: holder.userId },
      orderBy: { createdAt: "desc" },
    });
    // "I changed my password" and "somebody changed my password" are different
    // events, and only one of them should alarm anybody.
    expect(event!.action).toBe("rotate_user_password");
    expect(event!.adminUsername.startsWith("self:")).toBe(true);
  });

  test("a stranger cannot change anybody's password", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me/password`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: "whatever-it-is" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("a super admin can reset somebody's password", () => {
  async function adminHeaders(role: "admin" | "superadmin"): Promise<Record<string, string>> {
    const token = `admin_reset_${Math.random().toString(36).slice(2)}`;
    await prisma.adminSession.create({
      data: {
        token,
        adminId: `test-${role}`,
        username: `test-${role}`,
        role,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return freshClientHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
  }

  async function reset(
    headers: Record<string, string>,
    userId: string,
    body: Record<string, unknown> = { reason: "They called support and proved who they were" },
  ): Promise<Response> {
    return fetch(`${BASE_URL}/api/admin/users/${userId}/reset-password`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  test("the new password is returned once and it works", async () => {
    seq += 1;
    const email = `locked-out${seq}@example.com`;
    const account = await signUp({ email, password: "forgotten-password", name: "Locked Out" });

    const response = await reset(await adminHeaders("superadmin"), account.userId);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { password: string; revokedSessions: number };

    const signIn = await fetch(`${BASE_URL}/api/login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ identifier: email, password: body.password }),
    });
    expect(signIn.ok).toBe(true);
  });

  test("it ends every session that account had", async () => {
    seq += 1;
    const account = await signUp({
      email: `compromised${seq}@example.com`,
      password: "the-leaked-one",
      name: "Compromised",
    });

    const response = await reset(await adminHeaders("superadmin"), account.userId);
    expect(((await response.json()) as { revokedSessions: number }).revokedSessions)
      .toBeGreaterThanOrEqual(1);

    // A reset prompted by a compromise is pointless if the intruder's session
    // outlives it.
    const stale = await fetch(`${BASE_URL}/api/users/me/standing`, {
      headers: freshClientHeaders({ cookie: account.cookie }),
    });
    expect(stale.status).toBe(401);
  });

  test("it needs a reason, and records who did it", async () => {
    seq += 1;
    const account = await signUp({
      email: `reasoned${seq}@example.com`,
      password: "something",
      name: "Reasoned",
    });

    const noReason = await reset(await adminHeaders("superadmin"), account.userId, {});
    expect(noReason.status).toBe(400);

    await reset(await adminHeaders("superadmin"), account.userId, {
      reason: "Lost their phone and their laptop",
    });

    const event = await prisma.adminActivityLog.findFirst({
      where: { targetId: account.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(event!.adminUsername).toBe("test-superadmin");
    expect(event!.details).toContain("Lost their phone and their laptop");
  });

  test("an ordinary admin cannot", async () => {
    seq += 1;
    const account = await signUp({
      email: `protected${seq}@example.com`,
      password: "something",
      name: "Protected",
    });

    const response = await reset(await adminHeaders("admin"), account.userId);
    expect(response.status).toBe(403);
  });
});

describe("the client can read its own credential history", () => {
  async function b2bToken(): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        username: B2B_TEST.demoUsername,
        password: B2B_TEST.demoPassword,
      }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  }

  async function security(token: string) {
    const response = await fetch(`${BASE_URL}/api/b2b/account/security`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      account: { username: string };
      credentials: { lastRotatedAt: string | null; rotationCount: number };
      history: Array<{ action: string; changedBy: string; details: string }>;
    };
  }

  test("an untouched account reports nothing has been rotated", async () => {
    const body = await security(await b2bToken());
    expect(body.account.username).toBe(B2B_TEST.demoUsername);
    expect(body.credentials.lastRotatedAt).toBeNull();
    expect(body.credentials.rotationCount).toBe(0);
  });

  test("after a rotation the client can see when, and by whom", async () => {
    const client = await prisma.b2BClient.findUniqueOrThrow({
      where: { username: B2B_TEST.demoUsername },
      select: { id: true },
    });

    await rotateB2BCredentials(
      client.id,
      { apiKey: generateApiKey() },
      { actor: { kind: "admin", adminId: "a1", username: "rosa" }, reason: "Scheduled rotation" },
    );

    const body = await security(await b2bToken());
    expect(body.credentials.rotationCount).toBe(1);
    expect(body.credentials.lastRotatedAt).not.toBeNull();
    expect(body.history[0]!.changedBy).toBe("rosa");
    expect(body.history[0]!.details).toContain("Scheduled rotation");
  });

  test("a stranger cannot read it", async () => {
    const response = await fetch(`${BASE_URL}/api/b2b/account/security`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(401);
  });

  test("it shows this account's history and no one else's", async () => {
    const other = await newClient();
    await rotateB2BCredentials(
      other.client.id,
      { password: generatePassword() },
      { actor: { kind: "admin", adminId: "a1", username: "rosa" }, reason: "Someone else's business" },
    );

    const body = await security(await b2bToken());
    expect(body.credentials.rotationCount).toBe(0);
    expect(body.history.some((e) => e.details.includes("Someone else's business"))).toBe(false);
  });
});
