/**
 * A REPORT GOES SOMEWHERE, AND SOMEBODY CAN SEE IT.
 *
 * Reported plainly: "doesn't do anything just says a report has been sent,
 * checked on the admin side there is nothing there that shows that report."
 *
 * Three separate failures behind that one sentence:
 *
 *   1. Every report button on the platform sent `reason: "other"` and no
 *      description. Six reasons and two thousand characters of detail were in
 *      the API from the day it was written; nothing ever used either, so every
 *      report arrived saying "other" about nothing in particular.
 *   2. `GET /api/admin/reports` existed and no screen in either app had ever
 *      called it. The queue was built and never given a door.
 *   3. The jury drawn for a report could seat nobody, and never be retried.
 *      That one is covered in community-juries.test.ts.
 *
 * The admin queue and the jury are two different bodies answering two different
 * questions — "is anybody in danger now" and "did this person break the rules".
 * The last test here is the one that keeps them apart, because an administrator
 * who could close a proceeding would be the thing Article V §3 forbids.
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

const PASSWORD = "test-password-not-a-real-one";
const ADMIN_EMAIL = "report-queue-admin@example.com";

let adminToken = "";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } }).catch(() => {});
  await stopServer();
});

beforeEach(async () => {
  await resetData();

  const owner = await signUp({ email: ADMIN_EMAIL, password: PASSWORD, name: "Queue Admin" });
  await prisma.user.update({ where: { id: owner.userId }, data: { role: "superadmin" } });

  const response = await fetch(`${BASE_URL}/api/admin/login`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ username: ADMIN_EMAIL, password: PASSWORD }),
  });
  const body = (await response.json()) as { token?: string; data?: { token?: string } };
  adminToken = body.token ?? body.data?.token ?? "";
});

let seq = 0;
async function citizen(label: string) {
  seq += 1;
  return signUp({
    email: `${label}-rq-${seq}@example.com`,
    password: PASSWORD,
    name: `${label} ${seq}`,
  });
}

function file(cookie: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/safety/reports`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(body),
  });
}

interface QueueRow {
  id: string;
  reason: string;
  detail: string | null;
  status: string;
  reporter: { id: string; name: string | null; username: string | null };
  reportedUser: { id: string } | null;
  jury: { id: string; seats: number; filled: number; status: string } | null;
}

async function queue(status = "open") {
  const response = await fetch(`${BASE_URL}/api/admin/reports?status=${status}`, {
    headers: freshClientHeaders({ Authorization: `Bearer ${adminToken}` }),
  });
  return (await response.json()) as { results: QueueRow[] };
}

function close(id: string, status: "actioned" | "dismissed") {
  return fetch(`${BASE_URL}/api/admin/reports/${id}`, {
    method: "POST",
    headers: freshClientHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    }),
    body: JSON.stringify({ status }),
  });
}

describe("what the reporter actually said reaches the queue", () => {
  test("THE REASON AND THE WORDS SURVIVE — not 'other' about nothing", async () => {
    const reporter = await citizen("reporter");
    const accused = await citizen("accused");

    const response = await file(reporter.cookie, {
      userId: accused.userId,
      reason: "harassment",
      detail: "They followed me across three threads calling me names.",
    });
    expect(response.status).toBe(201);

    const { results } = await queue();
    const row = results.find((r) => r.reportedUser?.id === accused.userId);
    expect(row?.reason).toBe("harassment");
    expect(row?.detail).toBe("They followed me across three threads calling me names.");
    // Who filed it, so a queue is never a list of anonymous accusations.
    // (Username is null on an account that never chose one — the queue falls
    // back to the name, which is what the screen renders.)
    expect(row?.reporter.id).toBe(reporter.userId);
  });

  test("the queue is reachable at all — it had no caller for months", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/reports?status=open`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${adminToken}` }),
    });
    expect(response.status).toBe(200);
  });

  test("and not without an admin token", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/reports?status=open`, {
      headers: freshClientHeaders({}),
    });
    expect(response.status).toBe(401);
  });

  test("THE JURY'S TRUE STATE IS ON THE ROW — 0 of 5 seats is a fact, not a blank", async () => {
    const reporter = await citizen("seer");
    const accused = await citizen("seen");

    // Nobody is eligible, so the draw seats nobody. This is what a young
    // platform looks like, and it is what could not be seen before.
    await file(reporter.cookie, {
      userId: accused.userId,
      reason: "spam",
      detail: "Posting the same link over and over.",
    });

    const { results } = await queue();
    const row = results.find((r) => r.reportedUser?.id === accused.userId);
    expect(row?.jury).not.toBeNull();
    expect(row?.jury?.filled).toBe(0);
    expect(row?.jury?.seats).toBeGreaterThan(0);
    expect(row?.jury?.status).toBe("drawing");
  });
});

describe("closing a report tells the reporter, and never stops the jury", () => {
  test("THE REPORTER IS TOLD — a report that vanishes is why people stop filing", async () => {
    const reporter = await citizen("told");
    const accused = await citizen("untold");

    await file(reporter.cookie, {
      userId: accused.userId,
      reason: "hate",
      detail: "Attacking people for who they are.",
    });
    const { results } = await queue();
    const row = results.find((r) => r.reportedUser?.id === accused.userId)!;

    expect(await close(row.id, "actioned")).toHaveProperty("status", 200);

    // Fire-and-forget on the route, so give it a moment to land.
    const deadline = Date.now() + 5_000;
    let told = 0;
    while (Date.now() < deadline) {
      told = await prisma.notification.count({
        where: { userId: reporter.userId, type: "report_decided" },
      });
      if (told > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(told).toBe(1);
  });

  test("[art5-sec3] AN ADMIN CLOSING A REPORT DOES NOT HALT ITS JURY", async () => {
    const reporter = await citizen("filer");
    const accused = await citizen("subject");

    await file(reporter.cookie, {
      userId: accused.userId,
      reason: "violence",
      detail: "Threatening somebody in a reply.",
    });

    const { results } = await queue();
    const row = results.find((r) => r.reportedUser?.id === accused.userId)!;
    const juryBefore = await prisma.jury.findUnique({ where: { reportId: row.id } });
    expect(juryBefore).not.toBeNull();

    await close(row.id, "dismissed");

    // The report is closed. The proceeding is untouched — same jury, same
    // status, still open to reach its own verdict. Article IV §3 gives conduct
    // to the jury; Article V §3 says no Officer may halt a proceeding.
    const juryAfter = await prisma.jury.findUnique({ where: { reportId: row.id } });
    expect(juryAfter?.id).toBe(juryBefore!.id);
    expect(juryAfter?.status).toBe(juryBefore!.status);
    expect(juryAfter?.verdict).toBeNull();

    const closed = await prisma.report.findUnique({ where: { id: row.id } });
    expect(closed?.status).toBe("dismissed");
    expect(closed?.reviewedBy).toBeTruthy();
  });

  test("a closed report leaves the open queue and can still be read", async () => {
    const reporter = await citizen("archivist");
    const accused = await citizen("archived");

    await file(reporter.cookie, {
      userId: accused.userId,
      reason: "other",
      detail: "Something the six reasons do not cover.",
    });
    const before = await queue();
    const row = before.results.find((r) => r.reportedUser?.id === accused.userId)!;

    await close(row.id, "dismissed");

    const stillOpen = await queue("open");
    expect(stillOpen.results.some((r) => r.id === row.id)).toBe(false);

    const everything = await queue("all");
    expect(everything.results.some((r) => r.id === row.id)).toBe(true);
  });
});
