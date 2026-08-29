/**
 * A LINK THAT READS THE BUG QUEUE, AND CANNOT DO ANYTHING ELSE.
 *
 * WHY THIS EXISTS. The owner writes bugs down in the reporter and somebody else
 * fixes them. That handoff was a person signing into the admin panel and
 * copying the list out by hand, every time, so reports sat.
 *
 * The shortcut everybody reaches for is to share the admin login. It is the
 * wrong trade by a wide margin — everything, forever, to solve "read one
 * table" — and it cannot be withdrawn without changing the password for
 * everybody. A capability can: it reads one thing, it expires on its own, and
 * it can be revoked by itself.
 *
 * That argument is only worth anything if the limits are real, so this file
 * tests the limits rather than the happy path. Every way a link should stop
 * working is exercised against the running server, over HTTP.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { BASE_URL, prisma, resetData, freshClientHeaders, startServer, stopServer } from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
  // Neither table hangs off User, so TRUNCATE ... CASCADE cannot reach them.
  // Cleaned here rather than in the shared reset, which is how bug-reports.test
  // already handles it — changing shared teardown to suit one file is how a
  // test starts failing in company and passing alone.
  await prisma.bugReport.deleteMany({});
  await prisma.bugReportReadLink.deleteMany({});
});

async function adminHeaders(): Promise<Record<string, string>> {
  const token = `admin_readlink_${Math.random().toString(36).slice(2)}`;
  await prisma.adminSession.create({
    data: {
      token,
      adminId: "test-superadmin",
      username: "test-superadmin",
      role: "superadmin",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function fileAReport(problem: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/bug-reports`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      pageUrl: "https://ayeandnay.com/feed",
      pagePath: "/feed",
      problem,
      wanted: "It should not do that",
    }),
  });
  expect(response.status).toBeLessThan(300);
}

async function mintLink(label = "for whoever is fixing things"): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links`, {
    method: "POST",
    headers: await adminHeaders(),
    body: JSON.stringify({ label }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { token: string } };
  return body.data.token;
}

const readWith = (token: string | null, query = "") =>
  fetch(`${BASE_URL}/api/bug-reports/export${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

describe("the link reads the queue", () => {
  test("a live link returns the reports somebody filed", async () => {
    await fileAReport("The Aye button sent me to the top of the page");
    const token = await mintLink();

    const response = await readWith(token);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { count: number; reports: Array<{ problem: string }> };
    expect(body.count).toBe(1);
    expect(body.reports[0]?.problem).toBe("The Aye button sent me to the top of the page");
  });

  test("the token is returned once and never stored", async () => {
    const token = await mintLink();
    const rows = await prisma.bugReportReadLink.findMany();
    expect(rows).toHaveLength(1);

    // What is kept is the digest. The plaintext appears nowhere in the row, so
    // this table leaking does not hand anybody a working link.
    expect(rows[0]?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  test("every read is counted, so an unexpected one is visible", async () => {
    const token = await mintLink();
    await readWith(token);
    await readWith(token);

    const row = await prisma.bugReportReadLink.findFirst();
    expect(row?.useCount).toBe(2);
    expect(row?.lastUsedAt).not.toBeNull();
  });
});

describe("the link cannot do anything else", () => {
  test("it does not open the admin panel", async () => {
    const token = await mintLink();
    // The same string, offered where an admin token goes. A capability that is
    // accidentally also a session is the failure this whole design avoids.
    const response = await fetch(`${BASE_URL}/api/admin/bug-reports`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  });

  test("it cannot file, triage, or change a report", async () => {
    await fileAReport("something");
    const report = await prisma.bugReport.findFirst();
    const token = await mintLink();

    const triage = await fetch(`${BASE_URL}/api/admin/bug-reports/${report?.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "fixed" }),
    });
    expect(triage.status).toBe(401);

    const after = await prisma.bugReport.findFirst();
    expect(after?.status).toBe("open");
  });
});

describe("every way a link stops working", () => {
  test("no token at all", async () => {
    await fileAReport("something");
    expect((await readWith(null)).status).toBe(401);
  });

  test("a token nobody issued", async () => {
    await fileAReport("something");
    expect((await readWith("not-a-real-token-at-all")).status).toBe(401);
  });

  test("a revoked link", async () => {
    await fileAReport("something");
    const token = await mintLink();
    const row = await prisma.bugReportReadLink.findFirst();

    const revoked = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links/${row?.id}`, {
      method: "DELETE",
      headers: await adminHeaders(),
    });
    expect(revoked.status).toBe(200);

    expect((await readWith(token)).status).toBe(401);
  });

  test("an expired link", async () => {
    await fileAReport("something");
    const token = await mintLink();
    // Moved into the past rather than slept past: a test that waits out a real
    // expiry is a test that times out.
    await prisma.bugReportReadLink.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await readWith(token)).status).toBe(401);
  });

  test("every rejection says the same thing", async () => {
    // No such link, revoked and expired are one answer, because the difference
    // between them is only useful to somebody guessing.
    const missing = await readWith("not-a-real-token-at-all");
    const token = await mintLink();
    await prisma.bugReportReadLink.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await readWith(token);

    expect(await missing.json()).toEqual(await expired.json());
  });
});

describe("a link can be recognised without being usable", () => {
  test("the list shows what it is and when it was used, never the token", async () => {
    const token = await mintLink("Claude, for the redesign");
    await readWith(token);

    const response = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links`, {
      headers: await adminHeaders(),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      links: Array<{ label: string; fingerprint: string; state: string; useCount: number }>;
    };
    expect(body.links).toHaveLength(1);
    expect(body.links[0]?.label).toBe("Claude, for the redesign");
    expect(body.links[0]?.state).toBe("live");
    expect(body.links[0]?.useCount).toBe(1);
    // Enough to tell two links apart, not enough to use either.
    expect(body.links[0]?.fingerprint).toHaveLength(12);
    expect(JSON.stringify(body.links)).not.toContain(token);
  });

  test("a revoked link stays listed, with its history", async () => {
    const token = await mintLink();
    await readWith(token);
    const row = await prisma.bugReportReadLink.findFirst();
    await fetch(`${BASE_URL}/api/admin/bug-reports/read-links/${row?.id}`, {
      method: "DELETE",
      headers: await adminHeaders(),
    });

    const response = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links`, {
      headers: await adminHeaders(),
    });
    const body = (await response.json()) as {
      links: Array<{ state: string; useCount: number; revokedBy: string | null }>;
    };
    // Kept rather than deleted: "was this ever used, and when" is asked
    // precisely when a link has gone wrong, and a deleted row cannot answer.
    expect(body.links[0]?.state).toBe("revoked");
    expect(body.links[0]?.useCount).toBe(1);
    expect(body.links[0]?.revokedBy).toBe("test-superadmin");
  });
});

describe("only an admin can issue one", () => {
  test("minting a link requires an admin session", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ label: "mine now" }),
    });
    expect(response.status).toBe(401);
    expect(await prisma.bugReportReadLink.count()).toBe(0);
  });

  test("a link needs a label, so it can be revoked with confidence", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/bug-reports/read-links`, {
      method: "POST",
      headers: await adminHeaders(),
      body: JSON.stringify({ label: "" }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.bugReportReadLink.count()).toBe(0);
  });
});
