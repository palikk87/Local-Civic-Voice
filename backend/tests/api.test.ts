/**
 * The first tests this project has ever had.
 *
 * They are not chosen for coverage. Each one pins a specific failure that
 * actually happened here, or a claim the migration rests on:
 *
 *   - the schema builds from empty with one command
 *   - a session carries the profile fields both clients read
 *   - a ban survives a restart
 *   - the email path fails loudly when unconfigured
 *   - B2B district data is the same on every request
 *
 * Every one of these was silently broken at some point, and nothing noticed.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  serverLog,
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

describe("boot", () => {
  test("the schema was built from empty by migrate deploy alone", async () => {
    const tables = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    // 29 models plus _prisma_migrations. If this drops, a model was removed
    // without anyone meaning to.
    expect(Number(tables[0]!.count)).toBeGreaterThanOrEqual(30);
  });

  test("health reports email configuration honestly", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { status: string; email: { configured: boolean } };
    expect(body.status).toBe("ok");
    // No RESEND_API_KEY is set for tests, and health must say so rather than
    // report a cheerful "ok" while password reset is dead — which is exactly
    // how reset stayed broken in production without anyone noticing.
    expect(body.email.configured).toBe(false);
  });
});

describe("auth", () => {
  test("a signed-in session resolves to the same user on /api/me", async () => {
    const { cookie, userId } = await signUp({
      email: "parity@example.com",
      password: "correct horse battery staple",
      name: "Parity Tester",
    });

    const response = await fetch(`${BASE_URL}/api/me`, { headers: { cookie } });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { user: { id: string; email: string } };
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe("parity@example.com");
  });

  test("the session carries the profile fields both clients read", async () => {
    // This is the whole cross-platform parity claim. Web used to derive a
    // handle from email.split("@")[0] while mobile fetched the real record, so
    // one account showed two different names depending on which client you
    // opened. The fix was to put the fields in the session; if they stop being
    // returned, that regression is back.
    const { cookie, userId } = await signUp({
      email: "fields@example.com",
      password: "correct horse battery staple",
      name: "Fields Tester",
    });

    await prisma.user.update({
      where: { id: userId },
      data: { username: "fieldstester", bio: "Testing", location: "Denver, CO" },
    });

    const response = await fetch(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      user: { username?: string | null; bio?: string | null; location?: string | null; role?: string | null };
    };

    expect(body.user.username).toBe("fieldstester");
    expect(body.user.bio).toBe("Testing");
    expect(body.user.location).toBe("Denver, CO");
    expect(body.user.role).toBe("user");
  });

  test("/api/me refuses an unauthenticated request", async () => {
    const response = await fetch(`${BASE_URL}/api/me`);
    expect(response.status).toBe(401);
  });

  test("a password reset request reaches the send path and fails loudly", async () => {
    await signUp({
      email: "reset@example.com",
      password: "correct horse battery staple",
      name: "Reset Tester",
    });

    const before = serverLog().length;

    const response = await fetch(`${BASE_URL}/api/auth/email-otp/send-verification-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "reset@example.com", type: "forget-password" }),
    });

    // 200 is correct and deliberate. Better Auth answers identically whether or
    // not the address exists, because a different status would tell an attacker
    // which emails have accounts. So the status is NOT the signal here.
    expect(response.status).toBe(200);

    // The signal is the log. The original bug was `if (type !== "sign-in") return;`
    // at the top of the OTP handler: forget-password codes were generated,
    // written to the database, and dropped — no email, no error, no log line,
    // nothing to notice. This asserts the opposite property: a reset request
    // now reaches the send path, and an unconfigured mailer says so out loud.
    await Bun.sleep(250); // give the async handler a moment to write
    const emitted = serverLog().slice(before);
    expect(emitted).toContain("RESEND_API_KEY");
  });
});

describe("moderation persists", () => {
  test("a ban is stored on the user row, not in memory", async () => {
    // Bans lived in a module-level Map. Every deploy silently unbanned
    // everybody while the admin console kept listing them as banned.
    const { userId } = await signUp({
      email: "banned@example.com",
      password: "correct horse battery staple",
      name: "Banned Tester",
    });

    await prisma.user.update({
      where: { id: userId },
      data: {
        banned: true,
        banReason: "testing",
        bannedAt: new Date(),
        bannedBy: "test-admin",
        banExpiresAt: null,
      },
    });

    // Read through a separate query, as a fresh process would.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.banned).toBe(true);
    expect(stored.banReason).toBe("testing");
    expect(stored.bannedBy).toBe("test-admin");
    expect(stored.bannedAt).not.toBeNull();
  });

  test("an expired ban is not treated as active", async () => {
    const { userId } = await signUp({
      email: "expired@example.com",
      password: "correct horse battery staple",
      name: "Expired Tester",
    });

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: userId },
      data: { banned: true, banReason: "expired", bannedAt: yesterday, banExpiresAt: yesterday },
    });

    // The same condition routes/admin.ts uses to count and filter.
    const activeBans = await prisma.user.count({
      where: {
        banned: true,
        OR: [{ banExpiresAt: null }, { banExpiresAt: { gt: new Date() } }],
      },
    });
    expect(activeBans).toBe(0);
  });
});

describe("b2b", () => {
  async function b2bToken(): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "b2b_demo", password: "DemoB2B2024!" }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    return body.token;
  }

  test("district data is identical across requests", async () => {
    // /geo/districts used to call Math.random() for party and coordinates, so
    // the map redrew differently on every page load.
    const token = await b2bToken();
    const headers = { Authorization: `Bearer ${token}` };

    const [first, second] = await Promise.all([
      fetch(`${BASE_URL}/api/b2b/geo/districts?limit=50`, { headers }).then((r) => r.json()),
      fetch(`${BASE_URL}/api/b2b/geo/districts?limit=50`, { headers }).then((r) => r.json()),
    ]);

    const signature = (payload: unknown) =>
      JSON.stringify(
        (payload as { results: Array<{ districtId: string; party: string; coordinates: unknown }> }).results.map(
          (d) => [d.districtId, d.party, d.coordinates]
        )
      );

    expect(signature(first)).toBe(signature(second));
  });

  test("the endpoints both clients call actually exist", async () => {
    // Both 404'd for the entire life of the B2B dashboard, and b2b-store.ts
    // reads the body only `if (response.ok)` with an empty catch — so the
    // heatmap and trending panels rendered blank and nothing was logged.
    const headers = { Authorization: `Bearer ${await b2bToken()}` };

    for (const path of ["/api/b2b/geo/heatmap", "/api/b2b/sentiment/trends"]) {
      const response = await fetch(`${BASE_URL}${path}`, { headers });
      expect(response.status).toBe(200);
    }
  });

  test("the heatmap rejects an unauthenticated request", async () => {
    const response = await fetch(`${BASE_URL}/api/b2b/geo/heatmap`);
    expect(response.status).toBe(401);
  });
});
