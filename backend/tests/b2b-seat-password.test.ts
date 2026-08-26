/**
 * Setting a seat's password answers, whichever way it goes.
 *
 * REPORTED AS "it doesn't actually allow the admin to submit", and the button
 * was never the problem. The endpoint works; the page rendered every answer it
 * could give at the top of a long scrolling list, while the form that produced
 * the answer sat inside a member's card far below. Success closed the form and
 * put the new password off-screen. Failure left the form open and put the
 * reason off-screen. Both read, from the seat of whoever pressed the button, as
 * a button that does nothing — and a "shown once" password painted where nobody
 * is looking is a password lost.
 *
 * The rendering fix is in the two clients. What is pinned here is the contract
 * they depend on: that this endpoint always answers, that the answer carries
 * the credential exactly once, that a refusal says why in words a person can
 * act on, and that it can never be a silent success.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { B2B_TEST, BASE_URL, prisma, startServer, stopServer } from "./helpers/server";

let ownerToken = "";
let seatId = "";
const SEAT_USERNAME = "seatpw.test.analyst";

async function b2bLogin(username: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = (await response.json()) as { token?: string; data?: { token?: string } };
  return body.token ?? body.data?.token ?? "";
}

function setSeatPassword(id: string, token: string, payload: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/b2b/admin/members/${id}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await startServer();
  await prisma.b2BMember.deleteMany({ where: { username: SEAT_USERNAME } });

  ownerToken = await b2bLogin(B2B_TEST.adminUsername, B2B_TEST.adminPassword);
  expect(ownerToken).toBeTruthy();

  const created = await fetch(`${BASE_URL}/api/b2b/admin/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ username: SEAT_USERNAME, name: "Seat Password Test", role: "analyst" }),
  });
  const body = (await created.json()) as { member?: { id: string }; error?: string };
  expect([200, 201]).toContain(created.status);
  seatId = body.member!.id;
});

afterAll(async () => {
  await prisma.b2BMember.deleteMany({ where: { username: SEAT_USERNAME } }).catch(() => {});
  await stopServer();
});

describe("an administrator sets a seat's password", () => {
  test("a typed password is accepted and handed back exactly once", async () => {
    const typed = "a-typed-password-long-enough";
    const response = await setSeatPassword(seatId, ownerToken, { password: typed });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      credentials: { username: string; password: string };
      warning: string;
    };
    // The client shows this and cannot get it again — the column holds a hash.
    expect(body.credentials.password).toBe(typed);
    expect(body.credentials.username).toBe(SEAT_USERNAME);
    expect(body.warning).toContain("once");

    // And it is the password that now works.
    expect(await b2bLogin(SEAT_USERNAME, typed)).toBeTruthy();
  });

  test("an omitted password generates one, rather than failing on an empty body", async () => {
    // The form posts `{}` when the box is left blank. If that were rejected,
    // the most common path through this screen would be the broken one.
    const response = await setSeatPassword(seatId, ownerToken, {});
    expect(response.status).toBe(200);

    const body = (await response.json()) as { credentials: { password: string } };
    expect(body.credentials.password.length).toBeGreaterThanOrEqual(12);
    expect(await b2bLogin(SEAT_USERNAME, body.credentials.password)).toBeTruthy();
  });

  test("a refusal says why, in a sentence the client can show", async () => {
    const response = await setSeatPassword(seatId, ownerToken, { password: "short" });
    expect(response.ok).toBe(false);

    const body = (await response.json()) as { error?: unknown };
    // Something renderable, not an empty object the UI would turn into "".
    expect(JSON.stringify(body).length).toBeGreaterThan(2);
  });

  test("a seat on another account is not found, rather than silently changed", async () => {
    const otherToken = await b2bLogin(B2B_TEST.demoUsername, B2B_TEST.demoPassword);
    const response = await setSeatPassword(seatId, otherToken, { password: "another-long-password" });
    expect([403, 404]).toContain(response.status);

    const body = (await response.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("no token at all is refused", async () => {
    const response = await fetch(`${BASE_URL}/api/b2b/admin/members/${seatId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  test("every answer is JSON with something in it — none of them is silence", async () => {
    // The failure mode being guarded is a screen that shows nothing. A response
    // the client cannot render is indistinguishable from a button that did not
    // fire, and that is exactly what was reported.
    for (const payload of [{}, { password: "short" }, { password: "a-valid-long-password" }]) {
      const response = await setSeatPassword(seatId, ownerToken, payload);
      const text = await response.text();
      expect(text.length).toBeGreaterThan(2);
      expect(() => JSON.parse(text)).not.toThrow();
    }
  });
});

describe("the settings endpoint stops handing out the credential log", () => {
  test("/account/security answers whether anything moved, without naming who", async () => {
    const response = await fetch(`${BASE_URL}/api/b2b/account/security`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    // The question that went unanswered once, and still gets an answer.
    expect(body.credentials).toBeDefined();

    // The audit trail does not leave through this door. Hiding the card in the
    // client would have left it one devtools tab away.
    expect(body.history).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("changedBy");
  });
});
