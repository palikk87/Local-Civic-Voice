/**
 * The maintenance jobs are reachable without a shell, and only by a superadmin.
 *
 * WHY THESE EXIST AS ENDPOINTS. Both were scripts, and a script needs somebody
 * with a terminal on the production service. The person who NOTICES that a
 * law's text is really a captcha is whoever is reading the app, usually on a
 * phone. Making them find a terminal is how a known problem stays live while
 * everybody waits for the one person who can run it.
 *
 * What is pinned here is the part that could go quietly wrong: that the
 * destructive half never happens by accident, that it clears exactly what the
 * script clears and nothing else, and that the door is shut to everybody but a
 * superadmin.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, prisma, signUp, startServer, stopServer } from "./helpers/server";

const BLOCK_PAGE = readFileSync(
  join(import.meta.dir, "fixtures/federal-register-request-access.txt"),
  "utf8",
);

/** Long enough and plain enough to be unmistakably a law. */
const REAL_TEXT =
  "Executive Order 14417 of August 3, 2026. Establishing the President's Military Spouse " +
  "Commission. By the authority vested in me as President by the Constitution and the laws of " +
  "the United States of America, it is hereby ordered as follows: Section 1. Purpose. ".repeat(12);

const POISONED = "eo-test-poisoned";
const HEALTHY = "eo-test-healthy";

let superadminToken = "";
let plainAdminToken = "";

async function loginAdmin(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: email, password }),
  });
  const body = (await response.json()) as { token?: string; data?: { token?: string } };
  return body.token ?? body.data?.token ?? "";
}

beforeAll(async () => {
  await startServer();

  const password = "correct horse battery staple";

  const superadmin = await signUp({
    email: "maint-super@example.com",
    password,
    name: "Maint Super",
  });
  await prisma.user.update({ where: { id: superadmin.userId }, data: { role: "superadmin" } });
  superadminToken = await loginAdmin("maint-super@example.com", password);

  const plain = await signUp({ email: "maint-plain@example.com", password, name: "Maint Plain" });
  await prisma.user.update({ where: { id: plain.userId }, data: { role: "admin" } });
  plainAdminToken = await loginAdmin("maint-plain@example.com", password);

  await prisma.governmentReference.createMany({
    data: [
      {
        masterReferenceId: POISONED,
        referenceType: "executive_order",
        title: "An order whose stored text is the Request Access page",
        status: "active",
        category: "other",
        fullText: BLOCK_PAGE,
        fullTextHash: "poisoned",
        citizenBrief: "This page says access is limited because of aggressive automated scraping.",
        citizenBriefVersion: 1,
      },
      {
        masterReferenceId: HEALTHY,
        referenceType: "executive_order",
        title: "An order whose stored text is the order",
        status: "active",
        category: "defense",
        fullText: REAL_TEXT,
        fullTextHash: "healthy",
        citizenBrief: "A real brief about a real order.",
        citizenBriefVersion: 1,
      },
    ],
    skipDuplicates: true,
  });
});

afterAll(async () => {
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { in: [POISONED, HEALTHY] } },
  });
  await stopServer();
});

function purge(token: string, apply: boolean) {
  return fetch(`${BASE_URL}/api/admin/maintenance/purge-blocked-text?apply=${apply}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
}

describe("the maintenance door is shut to everybody but a superadmin", () => {
  test("no token at all is 401", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/maintenance/purge-blocked-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
  });

  test("an ordinary admin is 403, not merely unlucky", async () => {
    const response = await purge(plainAdminToken, false);
    expect(response.status).toBe(403);
  });

  test("and the backfill is guarded the same way", async () => {
    const response = await fetch(
      `${BASE_URL}/api/admin/maintenance/backfill-executive-orders?maxNew=1`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${plainAdminToken}`, "Content-Type": "application/json" },
        body: "{}",
      },
    );
    expect(response.status).toBe(403);
  });
});

describe("purging a block page from the admin panel", () => {
  test("reporting finds it and writes NOTHING", async () => {
    const response = await purge(superadminToken, false);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { applied: boolean; cleared: number; found: Array<{ masterReferenceId: string }> };
    };
    expect(body.data.applied).toBe(false);
    expect(body.data.cleared).toBe(0);
    expect(body.data.found.map((f) => f.masterReferenceId)).toContain(POISONED);

    // The whole point of a dry run: the row is untouched.
    const row = await prisma.governmentReference.findUniqueOrThrow({
      where: { masterReferenceId: POISONED },
      select: { fullText: true, citizenBrief: true },
    });
    expect(row.fullText).not.toBeNull();
    expect(row.citizenBrief).not.toBeNull();
  });

  test("and it does not mistake a real order for a block page", async () => {
    const response = await purge(superadminToken, false);
    const body = (await response.json()) as {
      data: { found: Array<{ masterReferenceId: string }> };
    };
    expect(body.data.found.map((f) => f.masterReferenceId)).not.toContain(HEALTHY);
  });

  test("applying clears the text, the hash AND the brief written from it", async () => {
    const response = await purge(superadminToken, true);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { applied: boolean; cleared: number } };
    expect(body.data.applied).toBe(true);
    expect(body.data.cleared).toBeGreaterThan(0);

    const cleared = await prisma.governmentReference.findUniqueOrThrow({
      where: { masterReferenceId: POISONED },
      select: { fullText: true, fullTextHash: true, citizenBrief: true, citizenBriefVersion: true },
    });
    expect(cleared.fullText).toBeNull();
    expect(cleared.fullTextHash).toBeNull();
    // The brief was written FROM the block page, so it described the block page.
    expect(cleared.citizenBrief).toBeNull();
    expect(cleared.citizenBriefVersion).toBeNull();
  });

  test("and the real order beside it is untouched", async () => {
    const healthy = await prisma.governmentReference.findUniqueOrThrow({
      where: { masterReferenceId: HEALTHY },
      select: { fullText: true, fullTextHash: true, citizenBrief: true },
    });
    expect(healthy.fullText).toBe(REAL_TEXT);
    expect(healthy.fullTextHash).toBe("healthy");
    expect(healthy.citizenBrief).not.toBeNull();
  });

  test("running it again finds nothing left to do", async () => {
    const response = await purge(superadminToken, false);
    const body = (await response.json()) as {
      data: { found: Array<{ masterReferenceId: string }> };
    };
    expect(body.data.found.map((f) => f.masterReferenceId)).not.toContain(POISONED);
  });
});
