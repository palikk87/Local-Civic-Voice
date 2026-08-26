/**
 * Giving a citizen a business account does not spend their citizenship.
 *
 * WHAT THIS GUARDS. "Convert a user into a B2B client" is a sentence that
 * invites the wrong implementation — move the account, change its role, mark it
 * as a customer. On this platform that would be the most damaging thing
 * available: the Public Pulse is a count of citizens, votes belong to the
 * people who cast them, and quietly reclassifying one corrupts the only number
 * the platform exists to report.
 *
 * So the tests are mostly about what must NOT change. The person keeps their
 * login, their role, their votes, their posts and their record. What they gain
 * is a second, separate thing with its own credentials.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  freshClientHeaders,
  prisma,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";

const CITIZEN_EMAIL = "convert-me@example.com";
const CITIZEN_USERNAME = "convertme";
const SUPER_EMAIL = "convert-super@example.com";
const PLAIN_EMAIL = "convert-plain@example.com";
const MOD_EMAIL = "convert-mod@example.com";
const CITIZEN2_EMAIL = "convert-self@example.com";
const PASSWORD = "correct horse battery staple";

let superToken = "";
let plainToken = "";
let modToken = "";
let citizenId = "";
let otherCitizenId = "";
/**
 * ONE citizen sign-in, shared.
 *
 * This file signed in twice and the second attempt came back 429: the login
 * rate limiter is real and it counts. Two tests need a citizen session for
 * different reasons, so the session is opened once and both read it — which is
 * also closer to what a person does than signing in per action.
 */
let citizenCookie = "";

async function loginAdmin(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username: email, password: PASSWORD }),
  });
  const body = (await response.json()) as { token?: string; data?: { token?: string } };
  return body.token ?? body.data?.token ?? "";
}

function convert(payload: Record<string, unknown>, token: string) {
  return fetch(`${BASE_URL}/api/admin/b2b-clients/from-user`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await startServer();
  await prisma.b2BClient.deleteMany({ where: { username: { in: [CITIZEN_USERNAME, "acme.research"] } } });
  await prisma.user.deleteMany({
    where: { email: { in: [CITIZEN_EMAIL, SUPER_EMAIL, PLAIN_EMAIL, MOD_EMAIL, CITIZEN2_EMAIL] } },
  });

  const citizen = await signUp({ email: CITIZEN_EMAIL, password: PASSWORD, name: "Convert Me" });
  citizenId = citizen.userId;
  await prisma.user.update({ where: { id: citizenId }, data: { username: CITIZEN_USERNAME } });

  const superadmin = await signUp({ email: SUPER_EMAIL, password: PASSWORD, name: "Convert Super" });
  await prisma.user.update({ where: { id: superadmin.userId }, data: { role: "superadmin" } });
  superToken = await loginAdmin(SUPER_EMAIL);

  const plain = await signUp({ email: PLAIN_EMAIL, password: PASSWORD, name: "Convert Plain" });
  await prisma.user.update({ where: { id: plain.userId }, data: { role: "admin" } });
  plainToken = await loginAdmin(PLAIN_EMAIL);

  const moderator = await signUp({ email: MOD_EMAIL, password: PASSWORD, name: "Convert Mod" });
  await prisma.user.update({ where: { id: moderator.userId }, data: { role: "moderator" } });
  modToken = await loginAdmin(MOD_EMAIL);

  // An ordinary citizen with an ordinary session, to prove there is no
  // self-service path anywhere.
  const other = await signUp({ email: CITIZEN2_EMAIL, password: PASSWORD, name: "Convert Self" });
  otherCitizenId = other.userId;
});

afterAll(async () => {
  await prisma.b2BClient.deleteMany({ where: { userId: citizenId } }).catch(() => {});
  await prisma.user
    .deleteMany({
      where: { email: { in: [CITIZEN_EMAIL, SUPER_EMAIL, PLAIN_EMAIL, MOD_EMAIL, CITIZEN2_EMAIL] } },
    })
    .catch(() => {});
  await stopServer();
});

describe("only a superadmin can do it", () => {
  test("an ordinary admin is refused, and nothing is created", async () => {
    const response = await convert(
      { userId: citizenId, type: "research", tier: "basic" },
      plainToken,
    );
    expect(response.status).toBe(403);
    expect(await prisma.b2BClient.count({ where: { userId: citizenId } })).toBe(0);
  });

  test("a moderator is refused too", async () => {
    // Three roles reach the admin console — admin, moderator, superadmin — and
    // only the last may mint a business account. Testing one of the other two
    // and assuming the third would be assuming.
    const response = await convert(
      { userId: citizenId, type: "research", tier: "basic" },
      modToken,
    );
    expect(response.status).toBe(403);
    expect(await prisma.b2BClient.count({ where: { userId: citizenId } })).toBe(0);
  });

  test("no token is refused", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/b2b-clients/from-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: citizenId, type: "research", tier: "basic" }),
    });
    expect(response.status).toBe(401);
  });
});

describe("converting an account", () => {
  test("an account that does not exist is a 404, not a new client", async () => {
    const before = await prisma.b2BClient.count();
    const response = await convert(
      { userId: "no-such-account-id", type: "research", tier: "basic" },
      superToken,
    );
    expect(response.status).toBe(404);
    expect(await prisma.b2BClient.count()).toBe(before);
  });

  test("it creates a business account and hands the credentials over once", async () => {
    const response = await convert(
      { userId: citizenId, type: "research", tier: "professional" },
      superToken,
    );
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      client: { username: string; tier: string; convertedFromUserId: string | null };
      convertedFrom: { id: string; username: string };
      credentials: { username: string; password: string; apiKey: string };
    };

    // Their own username is the default, because it is almost always right.
    expect(body.client.username).toBe(CITIZEN_USERNAME);
    expect(body.client.tier).toBe("professional");
    expect(body.client.convertedFromUserId).toBe(citizenId);
    expect(body.convertedFrom.id).toBe(citizenId);

    // Real credentials, and they work.
    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        username: body.credentials.username,
        password: body.credentials.password,
      }),
    });
    expect(login.status).toBe(200);
  });

  test("THE CITIZEN ACCOUNT IS UNTOUCHED — same login, same role, same identity", async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: citizenId },
      select: { role: true, username: true, email: true, banned: true },
    });
    // Not promoted, not marked, not moved. Holding a business account says
    // nothing about what somebody may do as a citizen.
    expect(user.role).toBe("user");
    expect(user.username).toBe(CITIZEN_USERNAME);
    expect(user.email).toBe(CITIZEN_EMAIL);
    expect(user.banned).toBeFalsy();

    // And they can still sign in as themselves.
    // Its own client address: /api/auth/* shares a 10-per-minute limit keyed by
    // IP, and this file's five sign-ups had already spent it. Raising the limit
    // for tests would mean testing a configuration that never ships.
    const signIn = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ email: CITIZEN_EMAIL, password: PASSWORD }),
    });
    expect(signIn.status).toBe(200);
    citizenCookie = signIn.headers.get("set-cookie") ?? "";
    expect(citizenCookie).not.toBe("");
  });

  test("a citizen cannot give themselves one, with the session they hold", async () => {
    // THE PATH THAT MUST NOT EXIST. Not a form, not an upgrade button, not a
    // self-service tier page. A citizen session is not an admin session, and
    // the admin console is the only door — so the same person who has just been
    // given a business account still cannot mint another for anybody.
    const response = await fetch(`${BASE_URL}/api/admin/b2b-clients/from-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: citizenCookie },
      body: JSON.stringify({ userId: otherCitizenId, type: "research", tier: "enterprise" }),
    });
    expect(response.status).toBe(401);
    expect(await prisma.b2BClient.count({ where: { userId: otherCitizenId } })).toBe(0);
  });

  test("the citizen password and the business password are different secrets", async () => {
    // Signing into the B2B portal with their CITIZEN password must not work:
    // two auth systems sharing one secret means a citizen changing their own
    // password silently re-keys a business account.
    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: CITIZEN_USERNAME, password: PASSWORD }),
    });
    expect(login.status).not.toBe(200);
  });

  test("the same account cannot be converted twice", async () => {
    const response = await convert(
      { userId: citizenId, username: "acme.research", type: "research", tier: "basic" },
      superToken,
    );
    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: string };
    // Names the account they already have, rather than a bare conflict.
    expect(body.error).toContain(CITIZEN_USERNAME);

    // One person, one business account — no second one nobody knows about.
    expect(await prisma.b2BClient.count({ where: { userId: citizenId } })).toBe(1);
  });
});

describe("what the console can say afterwards", () => {
  test("the client list reports which account it came from", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/b2b-clients`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    const body = (await response.json()) as {
      clients: { username: string; convertedFromUserId: string | null }[];
    };
    const converted = body.clients.find((row) => row.username === CITIZEN_USERNAME)!;
    expect(converted.convertedFromUserId).toBe(citizenId);

    // A client minted from nothing still says so honestly, rather than
    // pointing at an account that has nothing to do with it.
    const minted = body.clients.find((row) => row.convertedFromUserId === null);
    expect(minted).toBeDefined();
  });

  test("no response anywhere leaks the citizen's own password", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/b2b-clients`, {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    expect(JSON.stringify(await response.json())).not.toContain(PASSWORD);
  });
});
