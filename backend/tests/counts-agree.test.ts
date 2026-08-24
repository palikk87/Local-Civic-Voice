/**
 * One platform, one set of numbers.
 *
 * WHAT WENT WRONG. The business dashboard reported 51 users while the admin
 * portal reported 1, for the same platform at the same moment. Neither was
 * lying about its own query: B2B counted every row in the User table, and the
 * admin storage card counted accounts that have a credential to sign in with.
 * This database has been shared with another project, so the gap was fifty
 * rows that never signed up here — sold to a paying client as reach.
 *
 * The second half was quieter and worse. Both dashboards counted votes out of
 * the legacy Vote table, which has taken no new rows since both clients
 * dropped /api/bills/:id/vote. Every vote cast since then went to
 * GovernmentReferenceVote and was invisible to both — so a client's
 * "engagement" number was frozen, and the admin's "active today" showed nobody
 * on a day full of voting.
 *
 * These tests are written to fail if either definition drifts again. They do
 * not assert a hardcoded number; they build a known population and assert the
 * two dashboards agree with each other and with what was built.
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

/** Somebody who signed up here: they have a credential and can sign in. */
async function citizen(): Promise<{ cookie: string; userId: string }> {
  seq += 1;
  return signUp({
    email: `counted${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Counted ${seq}`,
  });
}

/**
 * A User row with no way to sign in.
 *
 * Stands in for the fifty rows that produced the disagreement — whatever their
 * origin, the platform cannot serve them and must not sell them.
 */
async function strandedRow(): Promise<string> {
  seq += 1;
  const row = await prisma.user.create({
    data: { name: `Stranded ${seq}`, email: `stranded${seq}@example.invalid` },
  });
  return row.id;
}

let refCounter = 0;
async function law() {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${8300 + refCounter}-119`,
      referenceType: "bill",
      title: "A bill about insulin pricing",
      status: "proposed",
      category: "healthcare",
    },
  });
}

async function b2bHeaders(): Promise<Record<string, string>> {
  const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      username: B2B_TEST.demoUsername,
      password: B2B_TEST.demoPassword,
    }),
  });
  if (!response.ok) throw new Error(`B2B login failed: ${response.status}`);
  const { token } = (await response.json()) as { token: string };
  return freshClientHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
}

async function adminHeaders(): Promise<Record<string, string>> {
  const token = `admin_counts_${Math.random().toString(36).slice(2)}`;
  await prisma.adminSession.create({
    data: {
      token,
      adminId: "test-superadmin",
      username: "test-superadmin",
      role: "superadmin",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return freshClientHeaders({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });
}

async function adminOverview() {
  const response = await fetch(`${BASE_URL}/api/admin/stats`, { headers: await adminHeaders() });
  expect(response.status).toBe(200);
  return ((await response.json()) as {
    overview: { totalUsers: number; totalVotes: number; dailyActiveUsers: number };
  }).overview;
}

async function b2bSummary(): Promise<{ totalUsers: number; totalVotes: number }> {
  const response = await fetch(`${BASE_URL}/api/b2b/reports/summary`, { headers: await b2bHeaders() });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    executiveSummary: { totalUsers: number; totalEngagements: number };
  };
  // "Engagements" is what this report calls votes cast — the same figure the
  // admin overview reports as totalVotes.
  return {
    totalUsers: body.executiveSummary.totalUsers,
    totalVotes: body.executiveSummary.totalEngagements,
  };
}

async function storageHealth() {
  const response = await fetch(`${BASE_URL}/api/admin/storage-health`, {
    headers: await adminHeaders(),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as {
    data: { totalUsers: number; realAccounts: number };
  }).data;
}

describe("the business dashboard and the admin portal count the same people", () => {
  test("a row nobody can sign in with is not sold as a user", async () => {
    await citizen();
    await citizen();
    await citizen();
    await strandedRow();
    await strandedRow();

    const b2b = await b2bSummary();
    const admin = await adminOverview();

    // Three people signed up. Two rows exist that nobody can sign in with.
    expect(b2b.totalUsers).toBe(3);
    expect(admin.totalUsers).toBe(3);
    expect(b2b.totalUsers).toBe(admin.totalUsers);
  });

  test("the raw row count is still visible where it means something", async () => {
    await citizen();
    await strandedRow();
    await strandedRow();

    // Storage health is about whether the database is durable, so the total
    // number of rows is the right question there — and seeing both numbers
    // side by side is how the disagreement was noticed in the first place.
    const health = await storageHealth();
    expect(health.realAccounts).toBe(1);
    expect(health.totalUsers).toBe(3);
  });
});

describe("both dashboards count the votes people actually cast", () => {
  test("a vote cast today reaches the business dashboard", async () => {
    const person = await citizen();
    const bill = await law();

    const before = await b2bSummary();
    expect(before.totalVotes).toBe(0);

    const vote = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect(vote.status).toBe(200);

    const after = await b2bSummary();
    // The whole defect in one assertion: this stayed at 0 because the count
    // read a table nothing writes to any more.
    expect(after.totalVotes).toBe(1);
  });

  test("and the admin portal sees the same vote, and the voter as active", async () => {
    const person = await citizen();
    const bill = await law();

    await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ position: "oppose" }),
    });

    const admin = await adminOverview();
    expect(admin.totalVotes).toBe(1);
    expect(admin.dailyActiveUsers).toBe(1);

    const b2b = await b2bSummary();
    expect(b2b.totalVotes).toBe(admin.totalVotes);
  });

  test("historical votes in the old table are not thrown away", async () => {
    const person = await citizen();
    const bill = await prisma.bill.create({
      data: {
        title: "An older bill",
        summary: "Recorded before the vote store moved.",
        category: "healthcare",
        chamber: "house",
        status: "proposed",
      },
    });
    await prisma.vote.create({
      data: { billId: bill.id, userId: person.userId, position: "support" },
    });

    const reference = await law();
    await fetch(`${BASE_URL}/api/government-references/${reference.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: person.cookie }),
      body: JSON.stringify({ position: "support" }),
    });

    // Both are votes real people really cast. Counting only the new table would
    // erase the platform's own history the moment it was fixed.
    const b2b = await b2bSummary();
    expect(b2b.totalVotes).toBe(2);
    expect((await adminOverview()).totalVotes).toBe(2);
  });
});
