/**
 * A ban has to actually stop somebody.
 *
 * WHAT THIS EXISTS FOR. Banning wrote five columns — banned, banReason,
 * bannedAt, bannedBy, banExpiresAt — and NOTHING outside the admin console
 * ever read one of them. The console reported "User X has been banned", the
 * row said banned = true, the list filtered on it, and the account went on
 * signing in and voting exactly as before.
 *
 * Found by running the new permission work against the thousand test citizens
 * rather than against fixtures: a banned citizen signed in and cast a vote, and
 * the tally moved from 1 to 2. That is the worst shape this bug could take.
 * The Public Pulse is the one number this platform exists to report, and it was
 * countable by accounts the platform had already thrown out — while the
 * moderator who pressed Ban was told it worked.
 *
 * It also means "users.ban", one of the capabilities an owner can now grant,
 * was a permission to perform an act with no consequence.
 *
 * THE CASE THAT MATTERS MOST is the third one below: the session somebody is
 * ALREADY holding. A check only at sign-in leaves every open session working
 * until it expires, which here is a week — so the ban would not reach the
 * person it was aimed at until long after the reason for it had passed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, freshClientHeaders, prisma, signUp, startServer, stopServer } from "./helpers/server";

const PASSWORD = "correct horse battery staple";
const TARGET_EMAIL = "ban-target@example.com";
const ADMIN_EMAIL = "ban-admin@example.com";

let targetId = "";
let targetCookie = "";
let adminToken = "";
let referenceId = "";

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return response.ok ? (response.headers.get("set-cookie") ?? "") : "";
}

function vote(cookie: string, position: "support" | "oppose") {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", Cookie: cookie }),
    body: JSON.stringify({ position }),
  });
}

function ban(body: unknown) {
  return fetch(`${BASE_URL}/api/admin/users/${targetId}/ban`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body),
  });
}

function unban() {
  return fetch(`${BASE_URL}/api/admin/users/${targetId}/ban`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
}

beforeAll(async () => {
  await startServer();

  const target = await signUp({ email: TARGET_EMAIL, password: PASSWORD, name: "Ban Target" });
  targetId = target.userId;

  const admin = await signUp({ email: ADMIN_EMAIL, password: PASSWORD, name: "Ban Admin" });
  await prisma.user.update({ where: { id: admin.userId }, data: { role: "superadmin" } });

  const login = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username: ADMIN_EMAIL, password: PASSWORD }),
  });
  adminToken = ((await login.json()) as { token: string }).token;

  const reference = await prisma.governmentReference.create({
    data: {
      masterReferenceId: "ban-test-hr-1-119",
      referenceType: "bill",
      title: "Something a banned account must not be able to move",
      status: "proposed",
      category: "other",
    },
  });
  referenceId = reference.id;

  targetCookie = await signIn(TARGET_EMAIL);
});

afterAll(async () => {
  await prisma.governmentReferenceVote.deleteMany({ where: { governmentReferenceId: referenceId } });
  await prisma.governmentReference.deleteMany({ where: { id: referenceId } });
  await stopServer();
});

describe("a banned account cannot act", () => {
  test("before the ban, the account votes and the tally moves", async () => {
    const response = await vote(targetCookie, "support");
    expect(response.status).toBe(200);

    const row = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: referenceId },
      select: { supportVotes: true },
    });
    expect(row.supportVotes).toBe(1);
  });

  test("THE SESSION THEY ALREADY HOLD stops working the moment they are banned", async () => {
    expect((await ban({ reason: "enforcement test" })).status).toBe(200);

    // Same cookie as the vote above. No new sign-in, nothing re-issued.
    const response = await vote(targetCookie, "oppose");
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error: string; reason?: string };
    // The refusal says what happened, so somebody hitting it is not left
    // guessing at a generic Forbidden.
    expect(body.error).toContain("suspended");
    expect(body.reason).toBe("enforcement test");
  });

  test("and the tally did not move", async () => {
    const row = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: referenceId },
      select: { supportVotes: true, opposeVotes: true },
    });
    expect({ support: row.supportVotes, oppose: row.opposeVotes }).toEqual({ support: 1, oppose: 0 });
  });

  test("signing in fresh does not get around it", async () => {
    const cookie = await signIn(TARGET_EMAIL);
    // Better Auth may still hand out a session; what must not happen is that
    // the session can do anything.
    const response = await vote(cookie, "oppose");
    expect(response.status).toBe(403);
  });

  test("unbanning gives the voice back", async () => {
    expect((await unban()).status).toBe(200);

    const cookie = await signIn(TARGET_EMAIL);
    const response = await vote(cookie, "oppose");
    expect(response.status).toBe(200);
  });

  test("A LAPSED TEMPORARY BAN IS NOT A BAN", async () => {
    // The console offers timed bans, and an expiry that is never honoured is a
    // permanent ban wearing a promise. Written directly, because the endpoint
    // takes a duration in days and this needs one already in the past.
    await prisma.user.update({
      where: { id: targetId },
      data: {
        banned: true,
        banReason: "expired an hour ago",
        banExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    });

    const cookie = await signIn(TARGET_EMAIL);
    const response = await vote(cookie, "support");
    expect(response.status).toBe(200);

    await prisma.user.update({
      where: { id: targetId },
      data: { banned: false, banReason: null, banExpiresAt: null },
    });
  });

  test("a ban still in force blocks, expiry or not", async () => {
    await prisma.user.update({
      where: { id: targetId },
      data: {
        banned: true,
        banReason: "still running",
        banExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const cookie = await signIn(TARGET_EMAIL);
    expect((await vote(cookie, "oppose")).status).toBe(403);

    await prisma.user.update({
      where: { id: targetId },
      data: { banned: false, banReason: null, banExpiresAt: null },
    });
  });
});
