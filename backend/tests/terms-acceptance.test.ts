/**
 * ACCEPTING THE TERMS IS A FACT ABOUT A PERSON, NOT ABOUT A BROWSER.
 *
 * It was written to localStorage and nowhere else. Three consequences, all of
 * them real: agreeing on a phone left a computer asking again; clearing a
 * browser erased the agreement entirely; and the platform held no record of who
 * had accepted which version — which, for an agreement, is the only part worth
 * keeping.
 *
 * The owner's rule: "nothing on the device… all user input is on the server."
 * An acceptance is the plainest user input there is.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  freshClientHeaders,
  prisma,
  resetData,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";

const PASSWORD = "test-password-not-a-real-one";

let seq = 0;
async function citizen() {
  seq += 1;
  return signUp({
    email: `terms-${seq}@example.com`,
    password: PASSWORD,
    name: `Terms Person ${seq}`,
  });
}

async function readTerms(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/users/me/terms`, {
    headers: { Cookie: cookie, ...freshClientHeaders() },
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function acceptTerms(cookie: string, version: string) {
  return fetch(`${BASE_URL}/api/users/me/terms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, ...freshClientHeaders() },
    body: JSON.stringify({ version }),
  });
}

beforeAll(async () => {
  await startServer();
});

beforeEach(async () => {
  await resetData();
});

afterAll(async () => {
  await stopServer();
});

describe("the record follows the person", () => {
  test("a new account has accepted nothing", async () => {
    const person = await citizen();
    const { body } = await readTerms(person.cookie);
    // Null, not false. "Never asked" and "declined" are different facts.
    expect(body.acceptedVersion).toBeNull();
    expect(body.acceptedAt).toBeNull();
  });

  test("ACCEPTING IS WRITTEN TO THE PROFILE", async () => {
    const person = await citizen();

    const response = await acceptTerms(person.cookie, "2026-08-28");
    expect(response.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: person.userId },
      select: { termsAcceptedVersion: true, termsAcceptedAt: true },
    });
    expect(row.termsAcceptedVersion).toBe("2026-08-28");
    expect(row.termsAcceptedAt).not.toBeNull();
  });

  test("AND READS BACK FROM A DIFFERENT SESSION — the whole point", async () => {
    /*
     * The second device. Same account, a session that has never seen the modal
     * and has no storage of its own, and it must not be asked again.
     */
    const person = await citizen();
    await acceptTerms(person.cookie, "2026-08-28");

    const elsewhere = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...freshClientHeaders() },
      body: JSON.stringify({ email: `terms-${seq}@example.com`, password: PASSWORD }),
    });
    const secondCookie = elsewhere.headers.get("set-cookie") ?? "";
    expect(secondCookie.length).toBeGreaterThan(0);

    const { body } = await readTerms(secondCookie);
    expect(body.acceptedVersion).toBe("2026-08-28");
  });

  test("A NEW VERSION RE-PROMPTS, because the old yes answered a different document", async () => {
    const person = await citizen();
    await acceptTerms(person.cookie, "2026-08-28");

    const { body } = await readTerms(person.cookie);
    // The client compares against the version it is displaying. An older
    // recorded version is not a match, so the modal comes back.
    expect(body.acceptedVersion).not.toBe("2027-01-01");
  });

  test("and accepting the new one moves the date", async () => {
    const person = await citizen();
    await acceptTerms(person.cookie, "2026-08-28");
    const first = (
      await prisma.user.findUniqueOrThrow({
        where: { id: person.userId },
        select: { termsAcceptedAt: true },
      })
    ).termsAcceptedAt;

    await new Promise((resolve) => setTimeout(resolve, 20));
    await acceptTerms(person.cookie, "2027-01-01");

    const row = await prisma.user.findUniqueOrThrow({
      where: { id: person.userId },
      select: { termsAcceptedVersion: true, termsAcceptedAt: true },
    });
    expect(row.termsAcceptedVersion).toBe("2027-01-01");
    // Somebody agreeing to a new version agreed to it today, not on the day
    // they agreed to the last one.
    expect(row.termsAcceptedAt!.getTime()).toBeGreaterThan(first!.getTime());
  });
});

describe("who may write it", () => {
  test("a signed-out visitor cannot record an acceptance", async () => {
    const response = await fetch(`${BASE_URL}/api/users/me/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...freshClientHeaders() },
      body: JSON.stringify({ version: "2026-08-28" }),
    });
    expect(response.status).toBe(401);
  });

  test("and reading as a signed-out visitor says 'nothing recorded', not an error", async () => {
    // They have no profile to keep it on yet. The modal asks them, the browser
    // remembers for the session, and the server takes over once they sign up.
    const response = await fetch(`${BASE_URL}/api/users/me/terms`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.acceptedVersion).toBeNull();
  });

  test("an empty version is refused", async () => {
    const person = await citizen();
    const response = await acceptTerms(person.cookie, "");
    expect(response.status).toBe(400);
  });
});
