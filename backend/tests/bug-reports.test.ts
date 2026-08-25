/**
 * A report somebody sends reaches the inbox somebody reads.
 *
 * The whole value of a bug reporter is that the loop closes. A form that
 * accepts a report and drops it is worse than no form, because it spends the
 * reporter's goodwill and tells them somebody is looking.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
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
  await prisma.bugReport.deleteMany({});
});

async function adminHeaders(): Promise<Record<string, string>> {
  const token = `admin_bugs_${Math.random().toString(36).slice(2)}`;
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

function report(extra: Record<string, unknown> = {}) {
  return {
    pageUrl: "https://ayeandnay.com/bill/abc",
    pagePath: "/bill/abc",
    problem: "I pressed Vote Nay and the bar stayed grey.",
    ...extra,
  };
}

async function send(body: Record<string, unknown>, cookie?: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/bug-reports`, {
    method: "POST",
    headers: freshClientHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    }),
    body: JSON.stringify(body),
  });
}

describe("anybody can report, and it lands in the inbox", () => {
  test("a signed-out visitor can report", async () => {
    // The people most likely to hit a blocking bug are the ones who could not
    // get past sign-up. A gate here would silence exactly them.
    const response = await send(report());
    expect(response.status).toBe(201);

    const stored = await prisma.bugReport.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.userId).toBeNull();
    expect(stored[0]!.status).toBe("open");
  });

  test("a signed-in report carries who sent it", async () => {
    const person = await signUp({
      email: "reporter@example.com",
      password: "test-password-not-a-real-one",
      name: "Reporter",
    });

    const response = await send(report(), person.cookie);
    expect(response.status).toBe(201);

    const stored = await prisma.bugReport.findFirstOrThrow();
    expect(stored.userId).toBe(person.userId);
  });

  test("what they pointed at is kept, in words and as a path", async () => {
    await send(
      report({
        elementLabel: "Vote Nay",
        elementPath: "div.flex > button.bg-red-600",
        wanted: "Filled the bar red and counted my vote.",
        viewport: "1920x1080",
        appCommit: "4458e8b",
      }),
    );

    const stored = await prisma.bugReport.findFirstOrThrow();
    // The label is what a person would say; the path is for whoever has to
    // find it. Reconstructing either from prose is the work this avoids.
    expect(stored.elementLabel).toBe("Vote Nay");
    expect(stored.elementPath).toContain("button");
    expect(stored.wanted).toContain("counted my vote");
    expect(stored.appCommit).toBe("4458e8b");
  });

  test("an empty problem is refused", async () => {
    const response = await send(report({ problem: "" }));
    expect(response.ok).toBe(false);
    expect(await prisma.bugReport.count()).toBe(0);
  });

  test("the admin inbox shows it, newest first, open by default", async () => {
    await send(report({ problem: "First problem" }));
    await send(report({ problem: "Second problem" }));

    const response = await fetch(`${BASE_URL}/api/admin/bug-reports`, {
      headers: await adminHeaders(),
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      reports: Array<{ problem: string; status: string }>;
      openCount: number;
    };
    expect(body.reports).toHaveLength(2);
    expect(body.reports[0]!.problem).toBe("Second problem");
    expect(body.openCount).toBe(2);
  });

  test("a stranger cannot read the inbox", async () => {
    await send(report());
    const response = await fetch(`${BASE_URL}/api/bug-reports`, { headers: freshClientHeaders() });
    // The submit route is POST-only; reading is admin-side and authenticated.
    expect(response.status).toBe(404);

    const asStranger = await fetch(`${BASE_URL}/api/admin/bug-reports`, {
      headers: freshClientHeaders(),
    });
    expect(asStranger.status).toBe(401);
  });

  test("triage records who closed it, and it leaves the open list", async () => {
    await send(report());
    const stored = await prisma.bugReport.findFirstOrThrow();

    const response = await fetch(`${BASE_URL}/api/admin/bug-reports/${stored.id}`, {
      method: "PATCH",
      headers: await adminHeaders(),
      body: JSON.stringify({ status: "fixed", adminNote: "The bar draws both sides now." }),
    });
    expect(response.status).toBe(200);

    const after = await prisma.bugReport.findUniqueOrThrow({ where: { id: stored.id } });
    expect(after.status).toBe("fixed");
    // A queue that changes state anonymously is a queue nobody trusts.
    expect(after.resolvedBy).toBe("test-superadmin");
    expect(after.resolvedAt).not.toBeNull();

    const open = await fetch(`${BASE_URL}/api/admin/bug-reports?status=open`, {
      headers: await adminHeaders(),
    });
    expect(((await open.json()) as { reports: unknown[] }).reports).toHaveLength(0);
  });
});
