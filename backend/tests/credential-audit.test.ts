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
