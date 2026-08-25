/**
 * A business can run its own account.
 *
 * WHY THIS EXISTS. A B2BClient row used to be the whole account: one username,
 * one password, shared by everybody at the firm. There was nothing to
 * administer, no way to tell who signed in, and exactly one way to withdraw one
 * person's access — change the password on all of them. That is the same event
 * that started the credential audit work: a login that stopped working with no
 * explanation, which from the paying customer's side is indistinguishable from
 * a breach.
 *
 * What is proven here is the part a customer would otherwise have to trust:
 * that a seat is one person, that removing one removes one, that one company
 * cannot reach another's seats, and that no credential moves without the
 * current password and a row in the log naming who did it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { B2B_TEST, BASE_URL, prisma, resetData, startServer, stopServer } from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

/**
 * A response body, read loosely.
 *
 * Every assertion below names the field it cares about, so one shared shape
 * beats forty inline casts that all say the same thing — and a cast per call
 * site is how a test ends up asserting against a type it invented rather than
 * against what the server sent.
 */
type Json = Record<string, any>;
const asJson = (res: Response): Promise<Json> => res.json() as Promise<Json>;

const OWNER = { username: B2B_TEST.demoUsername, password: B2B_TEST.demoPassword };

async function login(username: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return { status: res.status, body: await asJson(res) };
}

async function ownerToken(): Promise<string> {
  const { body } = await login(OWNER.username, OWNER.password);
  return body.token as string;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Add a seat and return { id, username, password }. */
async function addSeat(
  token: string,
  overrides: Record<string, unknown> = {}
): Promise<{ id: string; username: string; password: string }> {
  const username = `seat_${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetch(`${BASE_URL}/api/b2b/admin/members`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({ username, name: "Test Seat", role: "analyst", ...overrides }),
  });
  const body = await asJson(res);
  expect(res.status).toBe(201);
  return { id: body.member.id, username: body.member.username, password: body.credentials.password };
}

describe("the account's own login is unchanged", () => {
  test("signing in with the account username is an owner with no seat", async () => {
    const { status, body } = await login(OWNER.username, OWNER.password);

    expect(status).toBe(200);
    expect(body.role).toBe("owner");
    expect(body.member).toBeNull();

    // The critical compatibility case: a session opened before seats existed
    // has memberRole NULL in the database, and NULL has to read as owner. If it
    // read as "no permission", this deploy would lock every existing customer
    // out of their own settings on the day it shipped.
    const verify = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    const verified = await asJson(verify);
    expect(verified.role).toBe("owner");
    expect(verified.canManageSeats).toBe(true);
  });

  test("a session row written without the seat columns still reads as owner", async () => {
    // Written by hand, exactly as it looked before this migration: the three
    // member columns absent. This is the row shape sitting in the live database
    // right now.
    const client = await prisma.b2BClient.findUnique({ where: { username: OWNER.username } });
    const token = `legacy_${Math.random().toString(36).slice(2)}`;
    await prisma.b2BSession.create({
      data: {
        token,
        clientId: client!.id,
        clientName: client!.name,
        tier: client!.tier,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const res = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await asJson(res);

    expect(res.status).toBe(200);
    expect(body.role).toBe("owner");
    expect(body.canManageSeats).toBe(true);
  });
});

describe("seats", () => {
  test("a seat is created, can sign in, and gets its password exactly once", async () => {
    const token = await ownerToken();
    const seat = await addSeat(token);

    const signedIn = await login(seat.username, seat.password);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.role).toBe("analyst");
    expect(signedIn.body.member.id).toBe(seat.id);

    // The password is not readable back from anywhere. The column holds a
    // scrypt hash, and the list endpoint has no field for it.
    const list = await fetch(`${BASE_URL}/api/b2b/admin/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await asJson(list);
    expect(JSON.stringify(body)).not.toContain(seat.password);
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  test("a password an administrator types is the password that works", async () => {
    // Not just a randomised refresh. Somebody sitting with a new analyst
    // wants to hand them a password out loud, and the generated one gets
    // pasted into a chat window to be readable, which is worse.
    const token = await ownerToken();
    const chosen = "a-password-somebody-typed-out";
    const seat = await addSeat(token, { password: chosen });

    expect(seat.password).toBe(chosen);
    expect((await login(seat.username, chosen)).status).toBe(200);
  });

  test("a short password is refused before it becomes anybody's credential", async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE_URL}/api/b2b/admin/members`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ username: "shortpw_seat", name: "X", password: "tooshort" }),
    });
    expect(res.status).toBe(400);
    expect(await prisma.b2BMember.count({ where: { username: "shortpw_seat" } })).toBe(0);
  });

  test("a seat cannot take a username that already signs in", async () => {
    const token = await ownerToken();

    // Against the account's own username, which lives in a different table and
    // therefore slips past the unique index — but goes in the same login box.
    const res = await fetch(`${BASE_URL}/api/b2b/admin/members`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ username: OWNER.username, name: "Impostor" }),
    });
    expect(res.status).toBe(409);
  });

  test("disabling a seat ends its sessions and refuses the same password", async () => {
    const token = await ownerToken();
    const seat = await addSeat(token);

    const seatSession = await login(seat.username, seat.password);
    expect(seatSession.status).toBe(200);

    const patch = await fetch(`${BASE_URL}/api/b2b/admin/members/${seat.id}`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ disabled: true }),
    });
    expect(patch.status).toBe(200);
    expect((await asJson(patch)).sessionsEnded).toBeGreaterThan(0);

    // The live token is gone, not merely marked.
    const stale = await fetch(`${BASE_URL}/api/b2b/sentiment/overview`, {
      headers: { Authorization: `Bearer ${seatSession.body.token}` },
    });
    expect(stale.status).toBe(401);

    // And the same 401 as a wrong password, with no hint that the account
    // exists — saying "disabled" confirms the username to anyone guessing.
    const again = await login(seat.username, seat.password);
    expect(again.status).toBe(401);
    expect(JSON.stringify(again.body)).not.toContain("disabled");
  });

  test("removing a seat removes that seat and nobody else", async () => {
    const token = await ownerToken();
    const kept = await addSeat(token);
    const removed = await addSeat(token);

    const res = await fetch(`${BASE_URL}/api/b2b/admin/members/${removed.id}`, {
      method: "DELETE",
      headers: auth(token),
    });
    expect(res.status).toBe(200);

    expect((await login(removed.username, removed.password)).status).toBe(401);
    expect((await login(kept.username, kept.password)).status).toBe(200);
    // And the account's own login, which can never be removed.
    expect((await login(OWNER.username, OWNER.password)).status).toBe(200);
  });
});

describe("who may do what", () => {
  test("an analyst can read the dashboards and cannot touch seats", async () => {
    const token = await ownerToken();
    const seat = await addSeat(token, { role: "analyst" });
    const analystToken = (await login(seat.username, seat.password)).body.token as string;

    const dashboard = await fetch(`${BASE_URL}/api/b2b/sentiment/overview`, {
      headers: { Authorization: `Bearer ${analystToken}` },
    });
    expect(dashboard.status).toBe(200);

    for (const [method, path] of [
      ["GET", "/api/b2b/admin/members"],
      ["POST", "/api/b2b/admin/members"],
      ["GET", "/api/b2b/admin/activity"],
    ] as const) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: auth(analystToken),
        body: method === "POST" ? JSON.stringify({ username: "sneaky_x", name: "X" }) : undefined,
      });
      expect(res.status).toBe(403);
    }

    expect(await prisma.b2BMember.count({ where: { username: "sneaky_x" } })).toBe(0);
  });

  test("promoting or demoting a seat takes effect immediately, not at expiry", async () => {
    // The session carries a copy of the role, so the only way to make that copy
    // wrong is to delete it. A demotion that waits 24 hours is not a demotion.
    const token = await ownerToken();
    const seat = await addSeat(token, { role: "admin" });
    const seatToken = (await login(seat.username, seat.password)).body.token as string;

    expect(
      (await fetch(`${BASE_URL}/api/b2b/admin/members`, { headers: auth(seatToken) })).status
    ).toBe(200);

    await fetch(`${BASE_URL}/api/b2b/admin/members/${seat.id}`, {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ role: "analyst" }),
    });

    const after = await fetch(`${BASE_URL}/api/b2b/admin/members`, { headers: auth(seatToken) });
    expect(after.status).toBe(401);
  });

  test("one company cannot reach another company's seats", async () => {
    const mine = await ownerToken();
    const seat = await addSeat(mine);

    const theirs = (await login(B2B_TEST.adminUsername, B2B_TEST.adminPassword)).body
      .token as string;

    // A guessed id from the other account. Scoped by clientId, so it is a 404
    // rather than an edit.
    for (const [method, path, body] of [
      ["PATCH", `/api/b2b/admin/members/${seat.id}`, { disabled: true }],
      ["POST", `/api/b2b/admin/members/${seat.id}/password`, {}],
      ["DELETE", `/api/b2b/admin/members/${seat.id}`, undefined],
    ] as const) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: auth(theirs),
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(404);
    }

    // Untouched, and still able to sign in.
    expect((await login(seat.username, seat.password)).status).toBe(200);
  });

  test("a seat list from one account never contains another account's seats", async () => {
    const mine = await ownerToken();
    const seat = await addSeat(mine);

    const theirs = (await login(B2B_TEST.adminUsername, B2B_TEST.adminPassword)).body
      .token as string;
    const res = await fetch(`${BASE_URL}/api/b2b/admin/members`, { headers: auth(theirs) });
    const body = await asJson(res);

    expect(res.status).toBe(200);
    expect(body.members).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(seat.username);
  });
});

describe("changing your own password", () => {
  test("the current password is required, and a live session is not enough", async () => {
    // A session left open on an unattended laptop must not be enough to lock
    // its owner out of their own account.
    const token = await ownerToken();

    const res = await fetch(`${BASE_URL}/api/b2b/account/password`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        currentPassword: "not-the-right-one",
        newPassword: "a-brand-new-password-here",
      }),
    });
    expect(res.status).toBe(401);

    // Nothing moved.
    expect((await login(OWNER.username, OWNER.password)).status).toBe(200);
  });

  test("a seat changes its own password, keeps this device, loses the others", async () => {
    const owner = await ownerToken();
    const seat = await addSeat(owner);

    // Two devices.
    const deviceA = (await login(seat.username, seat.password)).body.token as string;
    const deviceB = (await login(seat.username, seat.password)).body.token as string;

    const next = "a-password-of-my-own-choosing";
    const res = await fetch(`${BASE_URL}/api/b2b/account/password`, {
      method: "POST",
      headers: auth(deviceA),
      body: JSON.stringify({ currentPassword: seat.password, newPassword: next }),
    });
    const body = await asJson(res);
    expect(res.status).toBe(200);

    // Signing somebody out of the device they are standing at, on the change
    // they just made, is hostile. A replacement session comes back.
    expect(typeof body.token).toBe("string");
    const replacement = await fetch(`${BASE_URL}/api/b2b/account`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(replacement.status).toBe(200);

    // Every other device is signed out.
    const other = await fetch(`${BASE_URL}/api/b2b/account`, {
      headers: { Authorization: `Bearer ${deviceB}` },
    });
    expect(other.status).toBe(401);

    expect((await login(seat.username, next)).status).toBe(200);
    expect((await login(seat.username, seat.password)).status).toBe(401);
  });

  test("a seat's password change touches nobody else at the company", async () => {
    const owner = await ownerToken();
    const a = await addSeat(owner);
    const b = await addSeat(owner);
    const bToken = (await login(b.username, b.password)).body.token as string;
    const aToken = (await login(a.username, a.password)).body.token as string;

    await fetch(`${BASE_URL}/api/b2b/account/password`, {
      method: "POST",
      headers: auth(aToken),
      body: JSON.stringify({ currentPassword: a.password, newPassword: "changed-my-own-password" }),
    });

    // The other seat's session and password are exactly where they were. This
    // is the whole point of a seat: what happens to it happens to one person.
    expect(
      (await fetch(`${BASE_URL}/api/b2b/account`, { headers: auth(bToken) })).status
    ).toBe(200);
    expect((await login(b.username, b.password)).status).toBe(200);
    expect((await login(OWNER.username, OWNER.password)).status).toBe(200);
  });
});

describe("the API key", () => {
  test("only the account login can issue one, and it is shown once", async () => {
    const token = await ownerToken();

    const res = await fetch(`${BASE_URL}/api/b2b/account/api-key`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ currentPassword: OWNER.password }),
    });
    const body = await asJson(res);
    expect(res.status).toBe(200);
    expect(typeof body.apiKey).toBe("string");

    // The new one works.
    const used = await fetch(`${BASE_URL}/api/b2b/sentiment/overview`, {
      headers: { Authorization: `ApiKey ${body.apiKey}` },
    });
    expect(used.status).toBe(200);

    // The old one does not.
    const old = await fetch(`${BASE_URL}/api/b2b/sentiment/overview`, {
      headers: { Authorization: `ApiKey ${B2B_TEST.demoApiKey}` },
    });
    expect(old.status).toBe(401);
  });

  test("a seat cannot issue an API key", async () => {
    // The key authenticates as the whole company. Handing an analyst the
    // ability to mint one would make the seat distinction decorative.
    const owner = await ownerToken();
    const seat = await addSeat(owner, { role: "admin" });
    const seatToken = (await login(seat.username, seat.password)).body.token as string;

    const res = await fetch(`${BASE_URL}/api/b2b/account/api-key`, {
      method: "POST",
      headers: auth(seatToken),
      body: JSON.stringify({ currentPassword: seat.password }),
    });
    expect(res.status).toBe(403);
  });
});

describe("every change is on the record", () => {
  test("adding a seat, setting its password and removing it are all logged with a name", async () => {
    const token = await ownerToken();
    const seat = await addSeat(token);

    await fetch(`${BASE_URL}/api/b2b/admin/members/${seat.id}/password`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({}),
    });
    await fetch(`${BASE_URL}/api/b2b/admin/members/${seat.id}`, {
      method: "DELETE",
      headers: auth(token),
    });

    const res = await fetch(`${BASE_URL}/api/b2b/admin/activity`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await asJson(res);
    const actions = body.events.map((e: { action: string }) => e.action);

    expect(actions).toContain("create_b2b_member");
    expect(actions).toContain("set_b2b_member_password");
    expect(actions).toContain("delete_b2b_member");

    // Every row names somebody. An unattributed credential change is the exact
    // thing this whole subsystem exists to prevent.
    for (const event of body.events) {
      expect(typeof event.by).toBe("string");
      expect(event.by.length).toBeGreaterThan(0);
    }
  });

  test("the log records who changed a password, not what it was", async () => {
    const token = await ownerToken();
    const chosen = "a-password-that-must-not-be-logged";
    await addSeat(token, { password: chosen });

    const rows = await prisma.adminActivityLog.findMany({});
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(chosen);
  });
});

describe("the settings screen has something to show", () => {
  test("GET /account answers with the company, who you are, and what you may do", async () => {
    const owner = await ownerToken();
    const seat = await addSeat(owner, { role: "analyst", name: "Dana Analyst" });
    const seatToken = (await login(seat.username, seat.password)).body.token as string;

    const asOwner = await asJson(
      await fetch(`${BASE_URL}/api/b2b/account`, { headers: { Authorization: `Bearer ${owner}` } }),
    );
    expect(asOwner.signedInAs.kind).toBe("account");
    expect(asOwner.canManageSeats).toBe(true);
    expect(asOwner.canRotateApiKey).toBe(true);
    // The account's own login, plus the seat just added.
    expect(asOwner.account.activeSeats).toBe(2);

    const asSeat = await asJson(
      await fetch(`${BASE_URL}/api/b2b/account`, {
        headers: { Authorization: `Bearer ${seatToken}` },
      }),
    );
    expect(asSeat.signedInAs.kind).toBe("member");
    expect(asSeat.signedInAs.name).toBe("Dana Analyst");
    expect(asSeat.canManageSeats).toBe(false);
    expect(asSeat.canRotateApiKey).toBe(false);
    // Same company either way.
    expect(asSeat.account.id).toBe(asOwner.account.id);
  });

  test("nothing on the settings responses carries a secret", async () => {
    const owner = await ownerToken();
    await addSeat(owner);

    for (const path of ["/api/b2b/account", "/api/b2b/account/security", "/api/b2b/admin/members"]) {
      const text = await (
        await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${owner}` } })
      ).text();
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("apiKeyHash");
      expect(text).not.toContain(B2B_TEST.demoPassword);
      expect(text).not.toContain(B2B_TEST.demoApiKey);
    }
  });
});
