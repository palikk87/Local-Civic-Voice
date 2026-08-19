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

import { readdirSync } from "node:fs";
import { parseBrief, serializeBrief } from "../src/services/citizen-brief";
import { briefState, isWorking } from "../src/services/brief-state";

/** A stored brief in the shape the card actually renders. */
function briefJson(summary: string): string {
  return serializeBrief({
    summary,
    argumentFor: "The text does the thing it says it does.",
    argumentAgainst: "The text commits money without naming a measure of success.",
  });
}
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  B2B_TEST,
  BASE_URL,
  b2bClientIds,
  TEST_UPLOADS_PATH,
  prisma,
  resetData,
  freshClientHeaders,
  serverLog,
  signUp,
  waitForLog,
  startServer,
  stopServer,
} from "./helpers/server";
import { generateAdminToken, generateB2BToken } from "../src/session-token";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * The commit stamp the deploy workflow writes into the upload.
 *
 * Written BEFORE the server boots, because that is when the real one is
 * written — into the tarball, before `railway up` sends it.
 */
const STAMPED_COMMIT = "abc123def4567890abc123def4567890abc123de";
const BUILD_COMMIT_FILE = join(process.cwd(), "BUILD_COMMIT");

beforeAll(async () => {
  await writeFile(BUILD_COMMIT_FILE, `${STAMPED_COMMIT}\n2026-08-19T06:00:00Z\n`);
  await startServer();
});

afterAll(async () => {
  await stopServer();
  await rm(BUILD_COMMIT_FILE, { force: true });
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
    // 34 models plus _prisma_migrations. If this drops, a model was removed
    // without anyone meaning to. The number was stale at 30 and therefore no
    // longer a guard against anything — B2BSession and B2BClient had both been
    // added underneath it. ReferenceName is the most recent addition.
    expect(Number(tables[0]!.count)).toBeGreaterThanOrEqual(35);
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

  test("health says which official sources it can actually read", async () => {
    // "No official text available" is the same sentence whether a law has
    // nothing published or the server has no key to ask with — and the second
    // is an operator problem wearing the first one's clothes. Without a
    // congress.gov key every bill reports no text and every Citizen's Brief is
    // unavailable, and until this existed nothing in the product said so.
    const response = await fetch(`${BASE_URL}/health`);
    const body = (await response.json()) as {
      sources: { congress: boolean; courtListener: boolean; federalRegister: boolean };
    };

    expect(typeof body.sources.congress).toBe("boolean");
    expect(typeof body.sources.courtListener).toBe("boolean");
    // The Federal Register needs no key, so there is none to be missing.
    expect(body.sources.federalRegister).toBe(true);

    // The test environment sets a congress key, so this reports it. The point
    // is that the answer tracks configuration rather than being decorative.
    expect(body.sources.congress).toBe(!!process.env.CONGRESS_API_KEY);
  });

  test("a request may take longer than ten seconds without the connection dying", async () => {
    // THE LAUNCH BLOCKER THIS PINS. Bun.serve closes a connection after ten
    // seconds by default. The Citizen's Brief endpoint does its work inline —
    // the reader pressed a button and is watching — and is allowed 45 seconds
    // to read a law and write from it.
    //
    // Observed against a real server before this was set:
    //
    //   [Bun.serve]: request timed out after 10 seconds
    //   --> POST /api/government-references/:id/brief 200 13s
    //
    // and, at the client, `curl: (52) Empty reply from server`. The server
    // finished the brief, stored it, and logged a success; the reader's
    // connection had been dead for three seconds. Nothing reported an error,
    // because from the server's side nothing failed. That is the whole shape
    // of the bug — the button simply never worked, silently.
    //
    // Asserted as configuration rather than by making a real request take
    // eleven seconds: the behaviour is Bun's, it is not ours to re-verify, and
    // an eleven-second test earns nothing over reading the number.
    // Read from the source rather than imported: importing src/index runs env
    // validation and boots a second server inside the test process. The risk
    // being guarded is somebody deleting the line, and reading it catches that.
    const source = await Bun.file(join(process.cwd(), "src", "index.ts")).text();
    const configured = source.match(/idleTimeout:\s*(\d+)/)?.[1];

    expect(configured).toBeDefined();
    // Above the longest request the API deliberately makes: 45s for a brief,
    // 20s for a judicial search waiting out a CourtListener throttle.
    expect(Number(configured)).toBeGreaterThanOrEqual(60);
  });

  test("health reports the commit the deploy stamped into the upload", async () => {
    // THE BLIND SPOT THIS CLOSES. Railway does not pass RAILWAY_GIT_COMMIT_SHA
    // as a build argument — it sets it as a runtime variable — so the
    // Dockerfile's GIT_SHA stayed at its default and /health answered
    // "unknown" on every single deploy.
    //
    // Which made deploy-check useless on the only host it runs against: the
    // one tool built to tell a shipped fix from an unshipped one could never
    // answer, and "unknown" reads like a small gap rather than a broken check.
    // It was found by asking the live API and seeing it there.
    const response = await fetch(`${BASE_URL}/health`);
    const body = (await response.json()) as { version: { commit: string; builtAt: string | null } };

    // Exactly the value written into the working directory before boot — which
    // is the only route by which a Railway CLI deploy can know its own commit.
    // `railway up` uploads a tarball with no git metadata (.dockerignore drops
    // .git, and the CLI is not a git client), so RAILWAY_GIT_COMMIT_SHA is
    // never set on these deploys and nothing inside the image can discover it.
    expect(body.version.commit).toBe(STAMPED_COMMIT);
    expect(body.version.builtAt).toBe("2026-08-19T06:00:00Z");
  });

  test("health reports whether the database matches the code", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const body = (await response.json()) as {
      schema: {
        applied: number;
        expected: number;
        latest: string | null;
        pending: string[];
        failed: string[];
        inSync: boolean;
      };
    };

    // The test server runs `migrate deploy` before it boots, so this is the
    // healthy shape: every migration in the build is recorded as finished.
    expect(body.schema.expected).toBeGreaterThan(0);
    expect(body.schema.applied).toBe(body.schema.expected);
    expect(body.schema.pending).toEqual([]);
    expect(body.schema.failed).toEqual([]);
    expect(body.schema.inSync).toBe(true);

    // And it names the newest one, so "which schema is this" has an answer
    // that does not require opening the database.
    expect(body.schema.latest).toBeTruthy();
    const onDisk = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(body.schema.latest).toBe(onDisk.at(-1) ?? null);
    expect(body.schema.expected).toBe(onDisk.length);
  });

  test("an unapplied migration shows up as pending rather than as ok", async () => {
    // The failure being pinned: a migration ships in the image and never runs.
    // Everything else — the commit stamp, the routes, the queue — still looks
    // perfect, and the first symptom is a 500 from whichever endpoint touches
    // the missing column.
    //
    // Simulated by removing one row from Prisma's ledger rather than by
    // reshaping the database, so nothing is destroyed and the check under test
    // is the one that runs in production.
    const before = await fetch(`${BASE_URL}/health`).then((r) => r.json() as Promise<{
      schema: { latest: string | null };
    }>);
    const victim = before.schema.latest!;

    const removed = await prisma.$queryRaw<{ migration_name: string }[]>`
      DELETE FROM "_prisma_migrations" WHERE migration_name = ${victim} RETURNING migration_name
    `;
    expect(removed.length).toBe(1);

    try {
      // HEALTH_SCHEMA_TTL_MS=0 in the test environment, so the next request
      // reads the ledger again rather than the 30s cache production wants.
      const after = (await fetch(`${BASE_URL}/health`).then((r) => r.json())) as {
        schema: { pending: string[]; inSync: boolean; applied: number; expected: number };
      };
      expect(after.schema.pending).toContain(victim);
      expect(after.schema.inSync).toBe(false);
      expect(after.schema.applied).toBe(after.schema.expected - 1);
    } finally {
      await prisma.$executeRaw`
        INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
        VALUES (gen_random_uuid()::text, 'restored-by-test', now(), ${victim}, NULL, NULL, now(), 1)
      `;
    }
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

    const response = await fetch(`${BASE_URL}/api/auth/get-session`, {
      headers: freshClientHeaders({ cookie }),
    });
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
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
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
    // Poll rather than sleep a fixed interval. The handler writes this line
    // asynchronously, so a fixed wait passes on a fast machine and fails on a
    // loaded one — which it did, intermittently, before this was changed.
    expect(await waitForLog("RESEND_API_KEY", before)).toBe(true);
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
      body: JSON.stringify({
        username: B2B_TEST.demoUsername,
        password: B2B_TEST.demoPassword,
      }),
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

  /**
   * Every endpoint that resolves a session must reject a token that is not one.
   *
   * This is the guard for a specific, silent failure mode. getClientFromToken
   * is async — sessions are rows in B2BSession — and an un-awaited call returns
   * a Promise. Every Promise is truthy, so `if (!session) return 401` passes for
   * any request, and the endpoint serves data to anyone.
   *
   * TypeScript does NOT catch that. Verified by deliberately removing one await
   * and running tsc: it exited 0, because the handler only tests the value for
   * truthiness and never reads a property off it. A grep proves the code is
   * correct today; this proves it stays correct.
   *
   * The list is every path that calls getClientFromToken, and its length is
   * asserted so that adding a protected endpoint without adding it here fails.
   */
  const PROTECTED_ENDPOINTS = [
    "/api/b2b/auth/verify",
    "/api/b2b/sentiment/overview",
    "/api/b2b/sentiment/issues",
    "/api/b2b/sentiment/bills/some-bill-id",
    "/api/b2b/geo/states",
    "/api/b2b/geo/states/CA",
    "/api/b2b/geo/districts",
    "/api/b2b/geo/heatmap",
    "/api/b2b/sentiment/trends",
    "/api/b2b/issues",
    "/api/b2b/issues/some-issue-id",
    "/api/b2b/reports/summary",
    "/api/b2b/forecast/bills/some-bill-id",
    "/api/b2b/forecast/issues/some-issue-id",
  ] as const;

  test("every protected endpoint rejects a bogus bearer token", async () => {
    expect(PROTECTED_ENDPOINTS.length).toBe(14);

    for (const path of PROTECTED_ENDPOINTS) {
      const response = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: "Bearer definitely-not-a-real-session-token" },
      });
      // 401 and nothing else. A 200 here means a call site lost its await.
      expect({ path, status: response.status }).toEqual({ path, status: 401 });
    }
  });

  test("a session survives a server restart", async () => {
    // The whole point of moving off the in-memory Map: a redeploy used to sign
    // out every business customer. Written directly to the table and then read
    // back through the HTTP layer, which is the path a restarted process takes.
    const token = "test-session-token-that-outlives-a-restart";
    await prisma.b2BSession.create({
      data: {
        token,
        clientId: b2bClientIds.demo,
        clientName: "Test Demo Analytics",
        tier: "enterprise",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const response = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
  });

  test("an expired session is rejected and cleaned up", async () => {
    const token = "test-session-token-that-has-expired";
    await prisma.b2BSession.create({
      data: {
        token,
        clientId: b2bClientIds.demo,
        clientName: "Test Demo Analytics",
        tier: "enterprise",
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const response = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);

    // Same opportunistic delete-on-read the admin console does.
    expect(await prisma.b2BSession.findUnique({ where: { token } })).toBeNull();
  });

  test("the heatmap rejects an unauthenticated request", async () => {
    const response = await fetch(`${BASE_URL}/api/b2b/geo/heatmap`);
    expect(response.status).toBe(401);
  });

  test("the stored account holds neither the password nor the API key", async () => {
    // The fixture array held both in cleartext, in a source file, in a public
    // repository. This asserts the property that replaced it: what is on disk
    // cannot be presented at the login endpoint.
    const row = await prisma.b2BClient.findUniqueOrThrow({
      where: { username: B2B_TEST.demoUsername },
    });

    expect(row.passwordHash).not.toBe(B2B_TEST.demoPassword);
    expect(row.passwordHash).not.toContain(B2B_TEST.demoPassword);
    expect(row.apiKeyHash).not.toBe(B2B_TEST.demoApiKey);
    expect(row.apiKeyHash).not.toContain(B2B_TEST.demoApiKey);

    // The API key is a digest and nothing else — deterministic, 64 hex chars,
    // which is what makes it a unique indexed column the lookup can use. If
    // this ever becomes a salted KDF hash, the ApiKey path silently degrades from
    // one index probe to a full scan with a KDF per row.
    expect(row.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a wrong password and an unknown username are both rejected", async () => {
    for (const body of [
      { username: B2B_TEST.demoUsername, password: "not the password" },
      { username: "nobody_by_that_name", password: B2B_TEST.demoPassword },
    ]) {
      const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect({ username: body.username, status: response.status }).toEqual({
        username: body.username,
        status: 401,
      });
    }
  });

  test("an API key authenticates, and a wrong one does not", async () => {
    // Authorization: ApiKey <value> is the machine path. It resolves the account
    // by the digest of the key, with no session row involved.
    const ok = await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, {
      headers: { Authorization: `ApiKey ${B2B_TEST.demoApiKey}` },
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, {
      headers: { Authorization: "ApiKey not-a-real-api-key" },
    });
    expect(bad.status).toBe(401);
  });

  test("logging in records lastAccessAt on the row", async () => {
    // It used to be `client.lastAccess = …` against a module-level array: lost
    // on every redeploy, invisible to any other process, and never actually
    // stored anywhere. Now it is a column, so this can be read back at all.
    await prisma.b2BClient.update({
      where: { username: B2B_TEST.demoUsername },
      data: { lastAccessAt: null },
    });

    await b2bToken();

    const row = await prisma.b2BClient.findUniqueOrThrow({
      where: { username: B2B_TEST.demoUsername },
    });
    expect(row.lastAccessAt).not.toBeNull();
  });
});

describe("session tokens", () => {
  /**
   * The shape of a token issued by the old generator, which both routers used:
   *
   *   admin_1786803117409_a6vx2j9y3wj
   *
   * A 13-digit millisecond timestamp between two underscores. Nothing about the
   * new format can produce that — base64url has no underscore-delimited runs of
   * digits of that length by construction, and the issue time is not in the
   * token at all. This is what fails if anyone reintroduces `Date.now()`.
   */
  const EMBEDS_A_TIMESTAMP = /_\d{13}_/;

  /** prefix, then 32 bytes of base64url. 32 bytes is 43 characters unpadded. */
  const NEW_FORMAT = /^(admin|b2b)_[A-Za-z0-9_-]{43}$/;

  test("neither generator embeds the issue time", () => {
    for (const token of [generateAdminToken(), generateB2BToken()]) {
      expect({ token, embedsTime: EMBEDS_A_TIMESTAMP.test(token) }).toEqual({
        token,
        embedsTime: false,
      });
      expect(token).toMatch(NEW_FORMAT);
    }
  });

  test("tokens carry 256 bits and do not repeat", () => {
    // Uniqueness alone would not distinguish the old generator from the new
    // one — the point of the count is the decoded width. 32 bytes is the claim
    // the format rests on, and it is checked here rather than assumed from the
    // string length, because base64url length and byte length are easy to get
    // one character apart.
    const tokens = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const token = generateB2BToken();
      expect(Buffer.from(token.slice("b2b_".length), "base64url")).toHaveLength(32);
      tokens.add(token);
    }
    expect(tokens.size).toBe(500);
  });

  test("the token a real login hands out has the new format", async () => {
    // The unit checks above prove the generator. This proves the login endpoint
    // actually calls it, which is the part a refactor can quietly undo.
    const response = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: B2B_TEST.demoUsername,
        password: B2B_TEST.demoPassword,
      }),
    });
    expect(response.status).toBe(200);

    const { token } = (await response.json()) as { token: string };
    expect(token).toMatch(NEW_FORMAT);
    expect(EMBEDS_A_TIMESTAMP.test(token)).toBe(false);

    // And it is the token that was stored, not a different one returned.
    const stored = await prisma.b2BSession.findUnique({ where: { token } });
    expect(stored).not.toBeNull();
  });
});

describe("media keys", () => {
  /** A 1x1 PNG. Small enough to inline, real enough that the handler accepts it. */
  const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  /**
   * A key in the format uploads used to get, written straight into the row:
   *
   *   images/${Date.now()}_${Math.random().toString(36)...}_${originalName}.jpg
   *
   * Nothing renames stored objects, so keys of this shape are still in the
   * database and still have to resolve.
   */
  const LEGACY_KEY = "images/1786803117409_a6vx2j9y3wj_IMG_1234.jpg";

  async function signedInCookie(): Promise<string> {
    const { cookie } = await signUp({
      email: `media-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Media Tester",
    });
    return cookie;
  }

  test("a key stored in the old format still resolves to its bytes", async () => {
    // Written to disk at the legacy path, exactly where a pre-change upload
    // would have put it, then fetched over HTTP the way a browser does. This is
    // the check that the change did not orphan existing media — asserting only
    // that the string round-trips would prove nothing about the bytes.
    const path = join(TEST_UPLOADS_PATH, LEGACY_KEY);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, ONE_PIXEL_PNG);

    const { userId } = await signUp({
      email: "legacy-media@example.com",
      password: "correct horse battery staple",
      name: "Legacy Media",
    });

    const media = await prisma.media.create({
      data: {
        userId,
        type: "image",
        url: LEGACY_KEY,
        mimeType: "image/png",
        sizeBytes: ONE_PIXEL_PNG.byteLength,
      },
    });

    // The API turns the stored key into a URL without parsing it.
    const api = await fetch(`${BASE_URL}/api/media/${media.id}`);
    expect(api.status).toBe(200);
    const body = (await api.json()) as { media: { url: string } };
    expect(body.media.url).toBe(`${BASE_URL}/uploads/${LEGACY_KEY}`);

    // And that URL actually serves the file.
    const fetched = await fetch(body.media.url);
    expect(fetched.status).toBe(200);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(
      new Uint8Array(ONE_PIXEL_PNG),
    );
  });

  test("a new upload gets an unguessable key with no timestamp and no filename", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File([ONE_PIXEL_PNG], "Screenshot_2026_03_14_private.png", { type: "image/png" }),
    );

    const response = await fetch(`${BASE_URL}/api/media/upload`, {
      method: "POST",
      headers: { cookie: await signedInCookie() },
      body: form,
    });
    // 201, not 200: the handler creates a resource.
    expect(response.status).toBe(201);

    const { media } = (await response.json()) as { media: { id: string; url: string } };
    const stored = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });

    // 16 bytes of base64url is 22 characters. The extension is kept because
    // CDNs sniff content type from it.
    expect(stored.url).toMatch(/^images\/[A-Za-z0-9_-]{22}\.png$/);

    // The two properties that made the old format guessable, asserted
    // separately so a failure says which one came back.
    expect({ key: stored.url, hasTimestamp: /\d{13}/.test(stored.url) }).toEqual({
      key: stored.url,
      hasTimestamp: false,
    });
    expect(stored.url).not.toContain("Screenshot");
    expect(stored.url).not.toContain("private");

    // And the object is really there under that key.
    const fetched = await fetch(media.url);
    expect(fetched.status).toBe(200);
  });

  test("two uploads of the same file get different keys", async () => {
    const cookie = await signedInCookie();
    const keys = new Set<string>();

    for (let i = 0; i < 3; i += 1) {
      const form = new FormData();
      form.append("file", new File([ONE_PIXEL_PNG], "same.png", { type: "image/png" }));
      const response = await fetch(`${BASE_URL}/api/media/upload`, {
        method: "POST",
        headers: { cookie },
        body: form,
      });
      expect(response.status).toBe(201);
      const { media } = (await response.json()) as { media: { id: string } };
      keys.add((await prisma.media.findUniqueOrThrow({ where: { id: media.id } })).url);
    }

    // Under the old format these would share a timestamp and differ only in the
    // Math.random() half. Now they share nothing.
    expect(keys.size).toBe(3);
  });
});

describe("deleting a post deletes its media", () => {
  const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  /** Whether a path exists, without caring why not. */
  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  async function newUser(): Promise<{ cookie: string; userId: string }> {
    return signUp({
      email: `del-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Delete Tester",
    });
  }

  /** Upload through the real endpoint and return the row's storage key. */
  async function upload(cookie: string): Promise<{ id: string; key: string }> {
    const form = new FormData();
    form.append("file", new File([ONE_PIXEL_PNG], "attach.png", { type: "image/png" }));

    const response = await fetch(`${BASE_URL}/api/media/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(response.status).toBe(201);

    const { media } = (await response.json()) as { media: { id: string } };
    const row = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    return { id: media.id, key: row.url };
  }

  test("upload, attach, delete — and the object is really gone", async () => {
    // The whole point is the last step. Asserting the handler returned 200
    // would prove nothing: that is exactly what it did before, while leaving
    // the bytes in place.
    const { cookie, userId } = await newUser();
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);

    // It is on disk before we start, and reachable over HTTP.
    expect(await exists(path)).toBe(true);
    expect((await fetch(`${BASE_URL}/uploads/${media.key}`)).status).toBe(200);

    const post = await prisma.post.create({
      data: { content: "post with an attachment", authorId: userId },
    });
    await prisma.media.update({ where: { id: media.id }, data: { postId: post.id } });

    const deleted = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);

    // Row gone (it always was — Media.postId cascades), object gone (it never
    // was), and the URL that used to serve it no longer does.
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect(await prisma.media.findUnique({ where: { id: media.id } })).toBeNull();
    expect(await exists(path)).toBe(false);
    expect((await fetch(`${BASE_URL}/uploads/${media.key}`)).status).toBe(404);
  });

  test("a post with several attachments loses all of them", async () => {
    const { cookie, userId } = await newUser();
    const uploads = [await upload(cookie), await upload(cookie), await upload(cookie)];

    const post = await prisma.post.create({
      data: { content: "three attachments", authorId: userId },
    });
    await prisma.media.updateMany({
      where: { id: { in: uploads.map((u) => u.id) } },
      data: { postId: post.id },
    });

    const deleted = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(deleted.status).toBe(200);

    for (const upload of uploads) {
      expect({ key: upload.key, onDisk: await exists(join(TEST_UPLOADS_PATH, upload.key)) }).toEqual({
        key: upload.key,
        onDisk: false,
      });
    }
  });

  test("a storage failure keeps the post rather than losing it silently", async () => {
    // The failure direction is the decision this change rests on. A post that
    // survives is visible and retryable; a post that vanishes while its objects
    // stay readable is neither — and is what happened before.
    //
    // The failure is provoked with a directory where the object should be, so
    // unlink raises EISDIR. Not ENOENT, which is deliberately tolerated: a
    // retry after a partial failure has to be able to finish.
    const { cookie, userId } = await newUser();
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);

    await rm(path);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "blocker"), "not a media object");

    const post = await prisma.post.create({
      data: { content: "undeletable attachment", authorId: userId },
    });
    await prisma.media.update({ where: { id: media.id }, data: { postId: post.id } });

    const logFrom = serverLog().length;
    const response = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(response.status).toBe(500);

    // Still there, both of them. Nothing was half-done.
    expect(await prisma.post.findUnique({ where: { id: post.id } })).not.toBeNull();
    expect(await prisma.media.findUnique({ where: { id: media.id } })).not.toBeNull();

    // And it is visible, not swallowed. The log names the key, because a
    // storage failure is diagnosed from the log or not at all.
    expect(await waitForLog("Refusing to delete post", logFrom)).toBe(true);
    expect(serverLog().slice(logFrom)).toContain(media.key);

    // Clearing the obstruction lets the same request succeed — the failure was
    // recoverable, which is the property that makes failing this way safe.
    await rm(path, { recursive: true });
    const retry = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(retry.status).toBe(200);
    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
  });

  test("DELETE /api/media/:id also removes the object", async () => {
    const { cookie } = await newUser();
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);
    expect(await exists(path)).toBe(true);

    const response = await fetch(`${BASE_URL}/api/media/${media.id}`, {
      method: "DELETE",
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await exists(path)).toBe(false);
  });

  test("DELETE /api/media/:id keeps the row when the object will not go", async () => {
    // Same policy as the post path, and it needs its own test because this
    // handler used to catch the storage error and delete the row anyway — which
    // left an unfindable, still-readable object behind and reported success.
    const { cookie } = await newUser();
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);

    await rm(path);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "blocker"), "not a media object");

    const logFrom = serverLog().length;
    const response = await fetch(`${BASE_URL}/api/media/${media.id}`, {
      method: "DELETE",
      headers: { cookie },
    });

    expect(response.status).toBe(500);
    expect(await prisma.media.findUnique({ where: { id: media.id } })).not.toBeNull();
    expect(await waitForLog("Refusing to delete media", logFrom)).toBe(true);

    await rm(path, { recursive: true });
  });

  test("the s3 driver deletes, tolerates missing, and reports refusals", async () => {
    // storageDriver is fixed at import, so the s3 branch cannot be reached in
    // this process. tests/helpers/s3-driver-check.ts runs it in a fresh one
    // against a stub bucket: real HTTP, real SigV4 signing, real code in
    // services/storage.ts, with only the bucket's responses under test control.
    const proc = Bun.spawn({
      cmd: ["bun", "tests/helpers/s3-driver-check.ts"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });

    const report = JSON.parse(stdout.trim()) as { ok: boolean; failures: string[] };
    expect(report).toEqual({ ...report, ok: true, failures: [] });
  });
});

describe("admin deletion removes stored objects", () => {
  const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false,
    );
  }

  /** A superadmin bearer token, written straight to the table the route reads. */
  async function superadminHeaders(): Promise<Record<string, string>> {
    const token = `admin_test_${Math.random().toString(36).slice(2)}`;
    await prisma.adminSession.create({
      data: {
        token,
        adminId: "test-superadmin",
        username: "test-superadmin",
        role: "superadmin",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { Authorization: `Bearer ${token}` };
  }

  async function upload(cookie: string): Promise<{ id: string; key: string }> {
    const form = new FormData();
    form.append("file", new File([ONE_PIXEL_PNG], "admin.png", { type: "image/png" }));
    const response = await fetch(`${BASE_URL}/api/media/upload`, {
      method: "POST",
      headers: { cookie },
      body: form,
    });
    expect(response.status).toBe(201);
    const { media } = (await response.json()) as { media: { id: string } };
    const row = await prisma.media.findUniqueOrThrow({ where: { id: media.id } });
    return { id: media.id, key: row.url };
  }

  test("deleting a user removes everything they uploaded, posted or not", async () => {
    // The unattached upload is the half nothing reached before. Media.userId has
    // no relation and no cascade, so a row that was never attached to a post
    // survived the user's deletion entirely — row and object both.
    const { cookie, userId } = await signUp({
      email: "admin-del-user@example.com",
      password: "correct horse battery staple",
      name: "Doomed User",
    });

    const attached = await upload(cookie);
    const unattached = await upload(cookie);

    const post = await prisma.post.create({
      data: { content: "a post that is about to go", authorId: userId },
    });
    await prisma.media.update({ where: { id: attached.id }, data: { postId: post.id } });

    for (const m of [attached, unattached]) {
      expect(await exists(join(TEST_UPLOADS_PATH, m.key))).toBe(true);
    }

    const response = await fetch(`${BASE_URL}/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: await superadminHeaders(),
    });
    expect(response.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.media.count({ where: { userId } })).toBe(0);

    for (const m of [attached, unattached]) {
      expect({ key: m.key, onDisk: await exists(join(TEST_UPLOADS_PATH, m.key)) }).toEqual({
        key: m.key,
        onDisk: false,
      });
    }
  });

  test("a storage failure keeps the user rather than deleting them anyway", async () => {
    const { cookie, userId } = await signUp({
      email: "admin-del-fails@example.com",
      password: "correct horse battery staple",
      name: "Survivor",
    });
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);

    await rm(path);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "blocker"), "not a media object");

    const logFrom = serverLog().length;
    const response = await fetch(`${BASE_URL}/api/admin/users/${userId}`, {
      method: "DELETE",
      headers: await superadminHeaders(),
    });

    expect(response.status).toBe(500);
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
    expect(await waitForLog("Refusing to delete user", logFrom)).toBe(true);
    expect(serverLog().slice(logFrom)).toContain(media.key);

    await rm(path, { recursive: true });
  });

  test("admin post deletion removes objects, like the author's own delete", async () => {
    const { cookie, userId } = await signUp({
      email: "admin-del-post@example.com",
      password: "correct horse battery staple",
      name: "Post Owner",
    });
    const media = await upload(cookie);
    const path = join(TEST_UPLOADS_PATH, media.key);

    const post = await prisma.post.create({
      data: { content: "moderated away", authorId: userId },
    });
    await prisma.media.update({ where: { id: media.id }, data: { postId: post.id } });
    expect(await exists(path)).toBe(true);

    const response = await fetch(`${BASE_URL}/api/admin/posts/${post.id}`, {
      method: "DELETE",
      headers: await superadminHeaders(),
    });
    expect(response.status).toBe(200);

    expect(await prisma.post.findUnique({ where: { id: post.id } })).toBeNull();
    expect(await exists(path)).toBe(false);
  });
});

describe("serving local uploads", () => {
  // The whole suite now runs with an ABSOLUTE UPLOADS_DIR, which is the shape
  // every deployment guide uses and the shape that used to serve nothing. Each
  // media test above is therefore already a regression test for it. These pin
  // the parts those do not reach.

  test("an absolute UPLOADS_DIR actually serves bytes", async () => {
    // hono/bun's serveStatic resolved `root` against process.cwd() and silently
    // 404'd for an absolute path, so media vanished while the database still
    // claimed it existed. Verified against the real server before the fix:
    // relative 200, absolute 404, no error either way.
    const key = "images/absolute-path-check.txt";
    const path = join(TEST_UPLOADS_PATH, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "served from an absolute root");

    const response = await fetch(`${BASE_URL}/uploads/${key}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("served from an absolute root");
  });

  test("a missing object is a clean 404", async () => {
    const response = await fetch(`${BASE_URL}/uploads/images/definitely-not-here.png`);
    expect(response.status).toBe(404);
  });

  test("path traversal cannot escape the uploads directory", async () => {
    // Serving by hand means owning this check. `resolve` collapses "..", so a
    // traversal lands outside the root and is rejected — including when it
    // arrives percent-encoded, which is why containment is checked after
    // decoding rather than before.
    const secret = join(TEST_UPLOADS_PATH, "..", "traversal-target.txt");
    await writeFile(secret, "must not be reachable");

    for (const attempt of [
      "/uploads/../traversal-target.txt",
      "/uploads/images/../../traversal-target.txt",
      "/uploads/%2e%2e/traversal-target.txt",
      "/uploads/..%2ftraversal-target.txt",
    ]) {
      const response = await fetch(`${BASE_URL}${attempt}`, { redirect: "manual" });
      expect({ attempt, status: response.status }).toEqual({ attempt, status: 404 });
    }

    await rm(secret, { force: true });
  });

  test("a sibling directory sharing the prefix is not reachable", async () => {
    // The trailing-separator half of the containment check: without it,
    // "<root>-secret" passes a naive startsWith("<root>").
    const sibling = `${TEST_UPLOADS_PATH}-secret`;
    await mkdir(sibling, { recursive: true });
    await writeFile(join(sibling, "leak.txt"), "must not be reachable");

    const response = await fetch(`${BASE_URL}/uploads/../${basename(sibling)}/leak.txt`);
    expect(response.status).toBe(404);

    await rm(sibling, { recursive: true, force: true });
  });
});

describe("login timing does not reveal which accounts exist", () => {
  /**
   * A behavioural test for a timing oracle, with a deliberately wide margin.
   *
   * The defect this guards is not subtle — an unknown username returned in
   * microseconds while a real one paid for a full scrypt verification. That is
   * three orders of magnitude, so a threshold anywhere near 1.0 would be
   * flaky while a threshold near 0 would prove nothing. 0.4 sits in the empty
   * space between "skipped the KDF entirely" (~0.01) and "ran it" (~1.0).
   *
   * Medians, not means: the suite shares a machine with a database and a
   * server, and one scheduling hiccup should not decide the result.
   */
  async function medianMs(request: () => Promise<unknown>, samples = 5): Promise<number> {
    const timings: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const started = performance.now();
      await request();
      timings.push(performance.now() - started);
    }
    timings.sort((a, b) => a - b);
    return timings[Math.floor(timings.length / 2)]!;
  }

  test("an unknown admin username costs the same as a wrong password", async () => {
    const { userId } = await signUp({
      email: "timing-admin@example.com",
      password: "correct horse battery staple",
      name: "Timing Admin",
    });
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });

    const post = (username: string) =>
      fetch(`${BASE_URL}/api/admin/login`, {
        method: "POST",
        headers: freshClientHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username, password: "not the right password" }),
      }).then((r) => {
        expect(r.status).toBe(401);
        return r.json();
      });

    const known = await medianMs(() => post("timing-admin@example.com"));
    const unknown = await medianMs(() => post("no-such-admin-anywhere@example.com"));

    // Before the fix this ratio was around 0.01: the unknown-user path returned
    // without ever running the key-derivation function.
    const ratio = unknown / known;
    expect({ ratio: ratio > 0.4, known, unknown }).toEqual({ ratio: true, known, unknown });
  });

  test("an unknown B2B username costs the same as a wrong password", async () => {
    const post = (username: string) =>
      fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "not the right password" }),
      }).then((r) => {
        expect(r.status).toBe(401);
        return r.json();
      });

    const known = await medianMs(() => post(B2B_TEST.demoUsername));
    const unknown = await medianMs(() => post("no_such_b2b_client_anywhere"));

    const ratio = unknown / known;
    expect({ ratio: ratio > 0.4, known, unknown }).toEqual({ ratio: true, known, unknown });
  });

  test("both answers are byte-identical", async () => {
    // Timing is the subtle channel; the response body is the obvious one. They
    // must not differ either.
    const bodies = await Promise.all(
      [B2B_TEST.demoUsername, "no_such_b2b_client_anywhere"].map((username) =>
        fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password: "wrong" }),
        }).then((r) => r.text()),
      ),
    );
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe("admin B2B client management", () => {
  /** An admin session at the given role, written straight to the table. */
  async function adminHeaders(role: "admin" | "superadmin" = "superadmin"): Promise<Record<string, string>> {
    const token = `admin_crud_${Math.random().toString(36).slice(2)}`;
    await prisma.adminSession.create({
      data: {
        token,
        adminId: `test-${role}`,
        username: `test-${role}`,
        role,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    // A distinct client address per session. generalRateLimit allows 100
    // requests a minute keyed by IP, and this block makes far more than that
    // across its tests — without this they trip the suite's own limiter and
    // fail as 429s that look like logic errors.
    return freshClientHeaders({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
  }

  /**
   * A username no previous run can have used.
   *
   * resetData() deliberately does not truncate B2BClient — it holds the two
   * seeded accounts every other test logs in with — so a fixed name here would
   * pass on a clean database and 409 on every run after it. That is exactly the
   * failure B2BSession had before it was added to the truncate list.
   */
  function uniqueUsername(base: string): string {
    return `${base}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function createClient(headers: Record<string, string>, username: string) {
    const response = await fetch(`${BASE_URL}/api/admin/b2b-clients`, {
      method: "POST",
      headers,
      body: JSON.stringify({ username, name: "Acme Research", type: "research", tier: "professional" }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      client: { id: string; username: string; tier: string };
      credentials: { username: string; password: string; apiKey: string };
    };
  }

  test("a created client can immediately sign in with the credentials returned once", async () => {
    // The point of the endpoint: it must mint credentials the portal actually
    // accepts. A create that produced a row nobody could log in to would pass
    // any test that only checked the status code.
    const headers = await adminHeaders();
    const { credentials } = await createClient(headers, uniqueUsername("AcmeResearch"));

    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    expect(login.status).toBe(200);

    // And the generated API key works on the machine path.
    const viaKey = await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, {
      headers: freshClientHeaders({ Authorization: `ApiKey ${credentials.apiKey}` }),
    });
    expect(viaKey.status).toBe(200);
  });

  test("neither secret is stored in recoverable form or ever listed", async () => {
    const headers = await adminHeaders();
    const { client, credentials } = await createClient(headers, uniqueUsername("SecretCheck"));

    const row = await prisma.b2BClient.findUniqueOrThrow({ where: { id: client.id } });
    expect(row.passwordHash).not.toContain(credentials.password);
    expect(row.apiKeyHash).not.toContain(credentials.apiKey);
    expect(row.apiKeyHash).toMatch(/^[0-9a-f]{64}$/);

    // The list endpoint must never carry a hash or a secret.
    const list = await fetch(`${BASE_URL}/api/admin/b2b-clients`, { headers });
    const body = await list.text();
    expect(list.status).toBe(200);
    for (const secret of [credentials.password, credentials.apiKey, row.passwordHash, row.apiKeyHash]) {
      expect(body).not.toContain(secret);
    }
  });

  test("rotating the password revokes the sessions it opened", async () => {
    // A rotation prompted by a leak that leaves the stolen session alive has
    // changed nothing for the next 24 hours.
    const headers = await adminHeaders();
    const { client, credentials } = await createClient(headers, uniqueUsername("RotateMe"));

    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    const { token } = (await login.json()) as { token: string };
    expect((await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    })).status).toBe(200);

    const rotate = await fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}/rotate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ password: true }),
    });
    expect(rotate.status).toBe(200);
    const rotated = (await rotate.json()) as {
      credentials: { password: string };
      revokedSessions: number;
    };
    expect(rotated.revokedSessions).toBe(1);

    // Old session dead, old password dead, new password works.
    expect((await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    })).status).toBe(401);

    const oldPassword = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    expect(oldPassword.status).toBe(401);

    const newPassword = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: rotated.credentials.password }),
    });
    expect(newPassword.status).toBe(200);
  });

  test("rotating the API key retires the old one", async () => {
    const headers = await adminHeaders();
    const { client, credentials } = await createClient(headers, uniqueUsername("RotateKey"));

    const rotate = await fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}/rotate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ apiKey: true }),
    });
    expect(rotate.status).toBe(200);
    const { credentials: next } = (await rotate.json()) as { credentials: { apiKey: string } };

    expect((await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, {
      headers: freshClientHeaders({ Authorization: `ApiKey ${credentials.apiKey}` }),
    })).status).toBe(401);
    expect((await fetch(`${BASE_URL}/api/b2b/geo/heatmap`, {
      headers: freshClientHeaders({ Authorization: `ApiKey ${next.apiKey}` }),
    })).status).toBe(200);
  });

  test("a tier change applies to sessions that are already open", async () => {
    // tier is copied onto the session row at login, so a downgrade that only
    // touched the client row would not take effect until the client signed out.
    const headers = await adminHeaders();
    const { client, credentials } = await createClient(headers, uniqueUsername("TierChange"));

    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    const { token } = (await login.json()) as { token: string };

    const patch = await fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ tier: "enterprise" }),
    });
    expect(patch.status).toBe(200);

    const verify = await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    });
    const body = (await verify.json()) as { client: { tier: string } };
    expect(body.client.tier).toBe("enterprise");
  });

  test("deleting a client revokes its live sessions", async () => {
    // B2BSession.clientId has no foreign key, so nothing cascades. Without an
    // explicit delete the account would be gone while its tokens kept reading
    // citizen sentiment for another 24 hours.
    const headers = await adminHeaders();
    const { client, credentials } = await createClient(headers, uniqueUsername("DeleteMe"));

    const login = await fetch(`${BASE_URL}/api/b2b/auth/credential-login`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ username: credentials.username, password: credentials.password }),
    });
    const { token } = (await login.json()) as { token: string };

    const deleted = await fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}`, {
      method: "DELETE",
      headers,
    });
    expect(deleted.status).toBe(200);
    expect((await deleted.json() as { revokedSessions: number }).revokedSessions).toBe(1);

    expect(await prisma.b2BClient.findUnique({ where: { id: client.id } })).toBeNull();
    expect((await fetch(`${BASE_URL}/api/b2b/auth/verify`, {
      headers: freshClientHeaders({ Authorization: `Bearer ${token}` }),
    })).status).toBe(401);
  });

  test("a duplicate username is refused rather than silently reassigned", async () => {
    const headers = await adminHeaders();
    const username = uniqueUsername("DupeCheck");
    await createClient(headers, username);

    const again = await fetch(`${BASE_URL}/api/admin/b2b-clients`, {
      method: "POST",
      headers,
      // Upper-cased: usernames are stored and matched lowercased, so this is the
      // same account and must be refused rather than silently reassigned.
      body: JSON.stringify({ username: username.toUpperCase(), name: "Other", type: "media", tier: "basic" }),
    });
    expect(again.status).toBe(409);
  });

  test("a plain admin can list but cannot create, modify, rotate or delete", async () => {
    // Creating one of these grants access to every citizen's aggregated
    // sentiment. That is closer to granting a role than to adding a record.
    const superadmin = await adminHeaders("superadmin");
    const { client } = await createClient(superadmin, uniqueUsername("PermCheck"));

    const admin = await adminHeaders("admin");
    const sneakyUsername = uniqueUsername("sneaky");

    expect((await fetch(`${BASE_URL}/api/admin/b2b-clients`, { headers: admin })).status).toBe(200);

    const forbidden = [
      fetch(`${BASE_URL}/api/admin/b2b-clients`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ username: sneakyUsername, name: "Sneaky", type: "media", tier: "enterprise" }),
      }),
      fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}`, {
        method: "PATCH",
        headers: admin,
        body: JSON.stringify({ tier: "enterprise" }),
      }),
      fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}/rotate`, {
        method: "POST",
        headers: admin,
        body: JSON.stringify({ apiKey: true }),
      }),
      fetch(`${BASE_URL}/api/admin/b2b-clients/${client.id}`, { method: "DELETE", headers: admin }),
    ];

    for (const response of await Promise.all(forbidden)) {
      expect(response.status).toBe(403);
    }

    // And nothing was created by the attempt.
    expect(await prisma.b2BClient.findUnique({ where: { username: sneakyUsername.toLowerCase() } })).toBeNull();
  });

  test("every endpoint rejects a request with no admin token", async () => {
    const paths: Array<[string, string]> = [
      ["GET", "/api/admin/b2b-clients"],
      ["POST", "/api/admin/b2b-clients"],
      ["PATCH", "/api/admin/b2b-clients/some-id"],
      ["POST", "/api/admin/b2b-clients/some-id/rotate"],
      ["DELETE", "/api/admin/b2b-clients/some-id"],
    ];

    for (const [method, path] of paths) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: freshClientHeaders({ "Content-Type": "application/json" }),
        body: method === "GET" || method === "DELETE" ? undefined : "{}",
      });
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 401 });
    }
  });
});

describe("a record answers to every name it has had", () => {
  /**
   * The master reference id is not immutable. A mangled id gets repaired, a
   * merge folds two records into one, Congress renumbers a measure. Every one
   * of those rewrites a name that is already out in the world — in a shared
   * link, a bookmark, a client that cached it.
   *
   * The system's promise is that no link dies. These tests are that promise,
   * exercised over HTTP through the one endpoint that resolves a
   * caller-supplied reference name: creating a post against it.
   */

  async function poster(): Promise<{ cookie: string; userId: string }> {
    return signUp({
      email: `alias-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Alias Tester",
    });
  }

  /**
   * A reference row with a current name and a list of former ones.
   *
   * The names go into the registry, because that is where every writer in the
   * app puts them — a row created without them models a record that cannot
   * exist, and a test built on one proves nothing about the real system.
   */
  async function reference(masterReferenceId: string, formerNames: string[] = []) {
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId,
        referenceType: "bill",
        title: `Record ${masterReferenceId}`,
        status: "proposed",
        aliases: formerNames.length > 0 ? JSON.stringify(formerNames) : null,
      },
    });
    await prisma.referenceName.create({
      data: { name: masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
    });
    for (const former of formerNames) {
      await prisma.referenceName.create({
        data: { name: former, referenceId: row.id, isCurrent: false, learnedFrom: "repaired" },
      });
    }
    return row;
  }

  async function post(cookie: string, governmentReferenceId: string): Promise<Response> {
    return fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ content: "linking by name", governmentReferenceId }),
    });
  }

  test("a link shared under the old, mangled name still resolves", async () => {
    // Exactly the shape the repair migration produces: the record now carries
    // its correct name, and the name it was written under before — the one
    // every existing link uses — is kept as an alias.
    const { cookie } = await poster();
    const record = await reference("sres-829-119", ["s-res-829-119"]);

    const response = await post(cookie, "s-res-829-119");
    expect(response.status).toBe(201);

    const body = (await response.json()) as { post: { id: string } };
    const written = await prisma.post.findUniqueOrThrow({ where: { id: body.post.id } });
    expect(written.governmentReferenceId).toBe(record.id);
  });

  test("a name already answered to never becomes a second record", async () => {
    // The dangerous case, and the one a tiebreak cannot fix. If a record held
    // "hr-4836-119" as a former name while a second record was actually called
    // that, every lookup of that name would have to guess, and the two would
    // split the vote pool for one law.
    //
    // So creation asks the registry first. A name somebody already answers to
    // does not mean "close enough to merge" — it means this IS that record.
    const { cookie } = await poster();
    const owner = await reference("hres-1443-119", ["hr-4836-119"]);

    const resolved = await fetch(`${BASE_URL}/api/government-references/resolve`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        branch: "legislative",
        title: "A bill by that number",
        billType: "hr",
        billNumber: "4836",
        congress: 119,
      }),
    });
    expect(resolved.status).toBe(200);
    const { reference: got } = (await resolved.json()) as {
      reference: { id: string; created: boolean };
    };
    expect(got.id).toBe(owner.id);
    expect(got.created).toBe(false);

    // Exactly one record answers to the name, and posting to it lands there.
    expect(await prisma.governmentReference.count({ where: { masterReferenceId: "hr-4836-119" } })).toBe(0);
    const response = await post(cookie, "hr-4836-119");
    expect(response.status).toBe(201);
    const body = (await response.json()) as { post: { id: string } };
    const written = await prisma.post.findUniqueOrThrow({ where: { id: body.post.id } });
    expect(written.governmentReferenceId).toBe(owner.id);
  });

  test("a name no record has ever held is still a 404", async () => {
    // The alias lookup must not turn "not found" into a guess. A substring of
    // a real alias is the way a sloppy match would leak: "hr-82" is inside
    // "hr-820-119", and matching on the quoted form is what stops it.
    const { cookie } = await poster();
    await reference("hr-820-119", ["hr-8200-118"]);

    const response = await post(cookie, "hr-82");
    expect(response.status).toBe(404);
  });
});

describe("merging two records loses nothing", () => {
  /**
   * Congress files the same law twice — a House bill and its identical Senate
   * companion — and until the two records are joined, the country's opinion on
   * that law is split across two counts and neither one is true. Joining them
   * is how the Public Pulse becomes a single number.
   *
   * It is also the single most destructive operation in the system: it rewrites
   * which record every affected post and vote belongs to. These tests are the
   * guarantee that it never costs anybody their vote, their words, or a brief
   * somebody already paid to generate.
   */

  async function staff(): Promise<string> {
    const { cookie, userId } = await signUp({
      email: `merge-admin-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Merge Admin",
    });
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
    return cookie;
  }

  async function voter(): Promise<string> {
    const { userId } = await signUp({
      email: `merge-voter-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Merge Voter",
    });
    return userId;
  }

  let counter = 0;
  async function record(overrides: Record<string, unknown> = {}) {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${9000 + counter}-119`,
        referenceType: "bill",
        title: `Record ${counter}`,
        status: "proposed",
        ...overrides,
      },
    });
    // Registered the way every writer in the app registers a name. A merge
    // moves rows in this table, so a fixture that skipped it would be testing
    // a record shape that cannot occur.
    await prisma.referenceName.create({
      data: {
        name: row.masterReferenceId,
        referenceId: row.id,
        isCurrent: true,
        learnedFrom: "created",
      },
    });
    return row;
  }

  async function vote(referenceId: string, userId: string, position: string, at: Date) {
    return prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: referenceId, userId, position, updatedAt: at },
    });
  }

  async function merge(cookie: string, sourceId: string, targetId: string) {
    const response = await fetch(`${BASE_URL}/api/government-references/merge`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ sourceId, targetId }),
    });
    const body = (await response.json()) as Record<string, never>;
    return { status: response.status, body };
  }

  test("every vote lands in one pool, and nobody is counted twice", async () => {
    // The old implementation read both records' counters first and then added
    // the source's numbers to the survivor's. Every vote it went on to discard
    // as a duplicate was still counted, so a merge inflated the pulse by exactly
    // the number of people who cared enough to vote on both records. Asserting
    // the exact tally is what catches that; asserting "it went up" would not.
    const cookie = await staff();
    const target = await record({ seedSupport: 0, seedOppose: 0 });
    const source = await record({ seedSupport: 0, seedOppose: 0 });

    const [onlyTarget, onlySource, both] = [await voter(), await voter(), await voter()];
    const early = new Date("2026-03-01T00:00:00Z");
    const late = new Date("2026-07-01T00:00:00Z");

    await vote(target.id, onlyTarget, "support", early);
    await vote(target.id, both, "support", early);
    await vote(source.id, onlySource, "support", early);
    await vote(source.id, both, "oppose", late); // the same person, later, other way

    const { status, body } = await merge(cookie, source.id, target.id);
    expect(status).toBe(200);

    const votes = await prisma.governmentReferenceVote.findMany({
      where: { governmentReferenceId: target.id },
    });
    // Three people voted, so there are three votes — not four.
    expect(votes.length).toBe(3);
    expect(await prisma.governmentReferenceVote.count({
      where: { governmentReferenceId: source.id },
    })).toBe(0);

    // The person who voted on both is a single voice, and the position that
    // stands is the one they stated last.
    const theirs = votes.filter((v) => v.userId === both);
    expect(theirs.length).toBe(1);
    expect(theirs[0]!.position).toBe("oppose");

    // Two support, one oppose. With the seed layer at zero the stored tally is
    // exactly the real one.
    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect({ support: merged.supportVotes, oppose: merged.opposeVotes }).toEqual({
      support: 2,
      oppose: 1,
    });
    expect((body as unknown as { merge: { tally: unknown } }).merge.tally).toEqual({
      support: 2,
      oppose: 1,
    });
  });

  test("a merge cannot conjure votes that nobody cast", async () => {
    // Both records once carried a fabricated "seed" tally — thousands of
    // invented supporters apiece — and a merge added the two together, turning
    // a bookkeeping event into several thousand new fake votes. The seed layer
    // is gone now, and this pins the consequence: whatever numbers a row is
    // carrying, a merge of two records nobody has voted on produces zero.
    const cookie = await staff();
    const target = await record({ seedSupport: 1000, seedOppose: 500, supportVotes: 1000, opposeVotes: 500 });
    const source = await record({ seedSupport: 4000, seedOppose: 3000, supportVotes: 4000, opposeVotes: 3000 });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect({ support: merged.supportVotes, oppose: merged.opposeVotes }).toEqual({
      support: 0,
      oppose: 0,
    });
  });

  test("posts move to the survivor and are not rewritten", async () => {
    // Speech does not merge. A post has to keep showing a law that exists, so
    // it follows the record — but the words, and the title the author saw when
    // they wrote them, are theirs.
    const cookie = await staff();
    const target = await record();
    const source = await record();
    const author = await voter();

    const written = await prisma.post.create({
      data: {
        content: "what I think about this law",
        authorId: author,
        governmentReferenceId: source.id,
        referenceType: "bill",
        referenceId: source.id,
        referenceTitle: source.title,
      },
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: written.id } });
    expect(after.governmentReferenceId).toBe(target.id);
    expect(after.referenceId).toBe(target.id); // the legacy copy follows too
    expect(after.content).toBe("what I think about this law");
    expect(after.referenceTitle).toBe(source.title); // untouched
    expect(after.authorId).toBe(author);
  });

  test("a brief is adopted rather than lost, and never regenerated", async () => {
    const cookie = await staff();
    const writtenAt = new Date("2026-05-05T00:00:00Z");
    const target = await record();
    const source = await record({
      citizenBrief: "What this law actually does.",
      citizenBriefJson: briefJson("What this law actually does."),
      citizenBriefAt: writtenAt,
      citizenBriefModel: "some-model",
      citizenBriefVersion: 1,
      fullText: "SECTION 1. SHORT TITLE.",
      fullTextHash: "abc123",
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.citizenBrief).toBe("What this law actually does.");
    expect(parseBrief(merged.citizenBriefJson)?.summary).toBe("What this law actually does.");
    expect(merged.citizenBriefModel).toBe("some-model");
    expect(merged.fullText).toBe("SECTION 1. SHORT TITLE.");
    // Pinned to the SURVIVOR's version, so the next reader reuses it instead of
    // paying to write the same brief again.
    expect(merged.citizenBriefVersion).toBe(merged.lawVersion);
    // The timestamp comes across intact. If it were reset, the freshness check
    // would treat an existing brief as new work and pay to write it again.
    expect(merged.citizenBriefAt?.toISOString()).toBe(writtenAt.toISOString());
  });

  test("a brief the survivor already has is left alone", async () => {
    const cookie = await staff();
    const target = await record({
      citizenBrief: "The survivor's own brief.",
      citizenBriefJson: briefJson("The survivor's own brief."),
      citizenBriefVersion: 1,
    });
    const source = await record({
      citizenBrief: "The other one's brief.",
      citizenBriefJson: briefJson("The other one's brief."),
      citizenBriefVersion: 1,
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(parseBrief(merged.citizenBriefJson)?.summary).toBe("The survivor's own brief.");
  });

  test("a brief the reader cannot see does not count as having one", async () => {
    // The survivor holds a brief written to an EARLIER definition of what a
    // Citizen's Brief is. Every reader sees an empty card for it, so treating
    // it as "already has one" would block the survivor from adopting the real
    // brief the source is holding — a brief lost by a merge, which is the one
    // thing merging is supposed to make impossible.
    const cookie = await staff();
    const target = await record({
      citizenBrief: "Goal / Wallet / Debate, from the old shape.",
      citizenBriefJson: JSON.stringify({
        theGoal: "…",
        theWallet: "…",
        theDebate: "…",
      }),
      citizenBriefVersion: 1,
    });
    const source = await record({
      citizenBrief: "A brief the card can actually render.",
      citizenBriefJson: briefJson("A brief the card can actually render."),
      citizenBriefVersion: 1,
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(parseBrief(merged.citizenBriefJson)?.summary).toBe(
      "A brief the card can actually render."
    );
  });

  test("a merge never hands the survivor a claim to be busy", async () => {
    // The source was mid-write when it was merged away. That job was running
    // against a record that is now a tombstone, so nothing is going to finish
    // it — copying its status across would give the survivor a spinner with no
    // end, which is the failure the whole brief-state design exists to prevent.
    const cookie = await staff();
    const target = await record();
    const source = await record({
      fullText: "SECTION 1. SHORT TITLE.",
      contentStatus: "brief_pending",
      contentStartedAt: new Date(),
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.fullText).toBe("SECTION 1. SHORT TITLE.");
    expect(isWorking(merged.contentStatus)).toBe(false);
    expect(briefState(merged)).not.toBe("working");
  });

  test("the source's name still reaches the survivor", async () => {
    // No link dies. Whatever the source was called is now something the
    // survivor answers to, and the tombstone points the way as well.
    const cookie = await staff();
    const target = await record();
    const source = await record();
    await prisma.referenceName.create({
      data: {
        name: "an-even-older-name",
        referenceId: source.id,
        isCurrent: false,
        learnedFrom: "repaired",
      },
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    const names = JSON.parse(merged.aliases ?? "[]") as string[];
    expect(names).toContain(source.masterReferenceId);
    expect(names).toContain("an-even-older-name");

    const tombstone = await prisma.governmentReference.findUniqueOrThrow({ where: { id: source.id } });
    expect(tombstone.mergedIntoId).toBe(target.id);
    expect(tombstone.supportVotes).toBe(0);
  });

  test("an earlier merge is flattened rather than chained", async () => {
    // Resolution follows these pointers, so a chain still works — but every hop
    // is a query and a chain that only grows eventually trips the cycle guard.
    const cookie = await staff();
    const a = await record();
    const b = await record();
    const c = await record();

    expect((await merge(cookie, c.id, b.id)).status).toBe(200);
    expect((await merge(cookie, b.id, a.id)).status).toBe(200);

    const flattened = await prisma.governmentReference.findUniqueOrThrow({ where: { id: c.id } });
    expect(flattened.mergedIntoId).toBe(a.id);
  });

  test("merges that would corrupt a record are refused", async () => {
    const cookie = await staff();
    const bill = await record();
    const order = await record({ referenceType: "executive_order", masterReferenceId: "eo-99999" });
    const merged = await record();
    const survivor = await record();
    expect((await merge(cookie, merged.id, survivor.id)).status).toBe(200);

    // A bill is not an executive order.
    expect((await merge(cookie, order.id, bill.id)).status).toBe(400);
    // Nothing merges into itself.
    expect((await merge(cookie, bill.id, bill.id)).status).toBe(400);
    // A tombstone cannot be merged again, in either direction.
    expect((await merge(cookie, merged.id, bill.id)).status).toBe(400);
    expect((await merge(cookie, bill.id, merged.id)).status).toBe(400);
  });
});

describe("the name registry", () => {
  /**
   * The registry is what makes "no link ever dies" true rather than
   * aspirational, and it is what stops two records claiming one name.
   */

  async function staff(): Promise<string> {
    const { cookie, userId } = await signUp({
      email: `names-admin-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Names Admin",
    });
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
    return cookie;
  }

  // Titles have to be genuinely unrelated, not "Record 1" and "Record 2":
  // findOrCreateReference does a fuzzy title match at 0.85 similarity, and two
  // titles differing by one character are well past that — the second call
  // would silently return the first record and the test would be comparing a
  // record to itself.
  const SUBJECTS = [
    "Honoring the centennial of the Grand Canyon",
    "Recognizing the contributions of merchant mariners",
    "Expressing support for wildfire response funding",
    "Relating to the reauthorization of coastal surveys",
    "Commemorating the anniversary of rural electrification",
    "Concerning the availability of insulin",
    "Establishing a select committee on water infrastructure",
    "Designating a national week of civic participation",
  ];

  let counter = 0;
  async function reference() {
    counter += 1;
    // Through the real creation path — findOrCreateReference — rather than a
    // direct row insert, because registering the name at creation is the thing
    // under test and a hand-written row would skip it.
    const response = await fetch(`${BASE_URL}/api/government-references/resolve`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        branch: "legislative",
        title: SUBJECTS[counter % SUBJECTS.length]!,
        billType: "hres",
        billNumber: String(7000 + counter),
        congress: 119,
      }),
    });
    expect(response.status).toBe(200);
    const { reference } = (await response.json()) as {
      reference: { id: string; masterReferenceId: string };
    };
    return reference;
  }

  test("a record created through the app is registered under its own name", async () => {
    // A record the registry does not know about is a record no former-name
    // lookup can ever reach, so registration has to happen at creation and not
    // as a later sweep.
    const created = await reference();

    // The name it was created with is the correctly-spelled one — this is also
    // the round trip the old normalizer broke, exercised end to end.
    expect(created.masterReferenceId).toMatch(/^hres-\d+-119$/);

    const registered = await prisma.referenceName.findUniqueOrThrow({
      where: { name: created.masterReferenceId },
    });
    expect(registered.referenceId).toBe(created.id);
    expect(registered.isCurrent).toBe(true);
    expect(registered.learnedFrom).toBe("created");
  });

  test("a merged record's names all move to the survivor and none stay current", async () => {
    const cookie = await staff();
    const target = await reference();
    const source = await reference();

    const merged = await fetch(`${BASE_URL}/api/government-references/merge`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ sourceId: source.id, targetId: target.id }),
    });
    expect(merged.status).toBe(200);

    const moved = await prisma.referenceName.findUniqueOrThrow({
      where: { name: source.masterReferenceId },
    });
    expect(moved.referenceId).toBe(target.id);
    expect(moved.isCurrent).toBe(false);

    // Exactly one name is what the survivor is called now.
    const current = await prisma.referenceName.findMany({
      where: { referenceId: target.id, isCurrent: true },
    });
    expect(current.length).toBe(1);
    expect(current[0]!.name).toBe(target.masterReferenceId);
  });

  test("two records cannot claim one name", async () => {
    // The invariant the whole system rests on. One name means one piece of
    // government business; a second claim is a duplicate to resolve, not an
    // alias to accept.
    const cookie = await staff();
    const first = await reference();
    const second = await reference();

    const response = await fetch(
      `${BASE_URL}/api/government-references/${second.id}/alias`,
      {
        method: "POST",
        headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
        body: JSON.stringify({ alias: first.masterReferenceId }),
      },
    );
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: expect.stringContaining("already belongs to another reference") as unknown as string,
    });

    // And nothing moved.
    const held = await prisma.referenceName.findUniqueOrThrow({
      where: { name: first.masterReferenceId },
    });
    expect(held.referenceId).toBe(first.id);
  });

  test("the detail response lists former names from the registry", async () => {
    const cookie = await staff();
    const record = await reference();

    const added = await fetch(`${BASE_URL}/api/government-references/${record.id}/alias`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ alias: "H.R. 99123" }),
    });
    expect(added.status).toBe(200);

    const detail = await fetch(`${BASE_URL}/api/government-references/${record.id}`);
    const { reference: body } = (await detail.json()) as { reference: { aliases: string[] } };
    // Normalized on the way in, so the stored name is the canonical spelling
    // rather than what was typed.
    expect(body.aliases).toContain("hr-99123");
    // The record's own name is never in its own alias list — that is how a
    // lookup ends up matching a record to itself.
    expect(body.aliases).not.toContain(record.masterReferenceId);
  });

  test("deleting a record takes its names with it", async () => {
    // A name left pointing at a deleted record is worse than no name: it holds
    // the unique claim, so the real owner can never take it.
    const record = await reference();
    await prisma.governmentReference.delete({ where: { id: record.id } });
    expect(
      await prisma.referenceName.findUnique({ where: { name: record.masterReferenceId } }),
    ).toBeNull();
  });
});

describe("the merge review queue", () => {
  /**
   * The matchmaker's whole value is what it refuses to do on its own.
   *
   * Congress.gov's "Identical bill" means a Library of Congress analyst read
   * both texts and confirmed they match — that, and only that, is good enough
   * to join two records without a person. Everything else is a question with the
   * government's page attached. "Related bill" is never even asked, because
   * related means a different law on the same subject.
   */

  async function adminHeaders(
    role: "admin" | "superadmin" = "superadmin",
  ): Promise<Record<string, string>> {
    const token = `merge_queue_${Math.random().toString(36).slice(2)}`;
    await prisma.adminSession.create({
      data: {
        token,
        adminId: `test-${role}`,
        username: `test-${role}`,
        role,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return freshClientHeaders({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    });
  }

  let counter = 0;
  async function record(title: string, overrides: Record<string, unknown> = {}) {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${6000 + counter}-119`,
        referenceType: "bill",
        title,
        status: "proposed",
        ...overrides,
      },
    });
    await prisma.referenceName.create({
      data: {
        name: row.masterReferenceId,
        referenceId: row.id,
        isCurrent: true,
        learnedFrom: "created",
      },
    });
    return row;
  }

  async function candidate(
    aId: string,
    bId: string,
    fields: Record<string, unknown> = {},
  ) {
    const [leftId, rightId] = aId < bId ? [aId, bId] : [bId, aId];
    return prisma.referenceMergeCandidate.create({
      data: {
        leftId,
        rightId,
        relationship: "Companion measure",
        identifiedBy: "CRS",
        evidenceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/1/related-bills",
        ...fields,
      },
    });
  }

  test("the queue shows the evidence and who assigned it", async () => {
    const headers = await adminHeaders("admin");
    const a = await record("A bill about the Colorado River");
    const b = await record("A bill about Colorado River allocations");
    await candidate(a.id, b.id);

    const response = await fetch(`${BASE_URL}/api/admin/reference-merges`, { headers });
    expect(response.status).toBe(200);

    const { candidates } = (await response.json()) as {
      candidates: Array<Record<string, unknown>>;
    };
    const row = candidates.find((c) => c.status === "pending");
    expect(row).toBeDefined();
    // Every one of these is what makes the question answerable rather than a
    // coin flip: what the government called it, who called it that, and the
    // page the reviewer can open to check.
    expect(row!.relationship).toBe("Companion measure");
    expect(row!.identifiedBy).toBe("CRS");
    expect(row!.evidenceUrl).toContain("congress.gov");
    expect(row!.isSuggestion).toBe(false);
  });

  test("a look-alike is marked as carrying no authority", async () => {
    const headers = await adminHeaders("admin");
    const a = await record("Concerning sanctions on Venezuela");
    const b = await record("Concerning Venezuela sanctions relief");
    await candidate(a.id, b.id, {
      relationship: "look_alike",
      identifiedBy: null,
      evidenceUrl: null,
      similarity: 0.92,
    });

    const response = await fetch(`${BASE_URL}/api/admin/reference-merges`, { headers });
    const { candidates } = (await response.json()) as {
      candidates: Array<Record<string, unknown>>;
    };
    const row = candidates.find((c) => c.relationship === "look_alike");
    expect(row).toBeDefined();
    expect(row!.isSuggestion).toBe(true);
    // The absence is the point. Nobody official stands behind this.
    expect(row!.identifiedBy).toBeNull();
    expect(row!.evidenceUrl).toBeNull();
    expect(row!.similarity).toBe(0.92);
  });

  test("approving merges, and the reviewer chooses which record survives", async () => {
    const headers = await adminHeaders();
    const keep = await record("A bill with the readers");
    const fold = await record("The same bill, filed twice");
    const pair = await candidate(keep.id, fold.id);

    const response = await fetch(
      `${BASE_URL}/api/admin/reference-merges/${pair.id}/approve`,
      { method: "POST", headers, body: JSON.stringify({ keepId: keep.id }) },
    );
    expect(response.status).toBe(200);

    const tombstone = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: fold.id },
    });
    expect(tombstone.mergedIntoId).toBe(keep.id);

    const decided = await prisma.referenceMergeCandidate.findUniqueOrThrow({
      where: { id: pair.id },
    });
    expect(decided.status).toBe("approved");
    expect(decided.decidedById).toBe("test-superadmin");
    expect(decided.decidedAt).not.toBeNull();
  });

  test("rejecting is recorded so the same pair is not asked again", async () => {
    // A reviewer's "no" is a decision, not a temporary state. A queue that
    // re-asks every night is a queue people stop reading.
    const headers = await adminHeaders();
    const a = await record("A bill about wildfire response");
    const b = await record("A bill about hurricane response");
    const pair = await candidate(a.id, b.id);

    const rejected = await fetch(
      `${BASE_URL}/api/admin/reference-merges/${pair.id}/reject`,
      { method: "POST", headers, body: JSON.stringify({ note: "Different disasters." }) },
    );
    expect(rejected.status).toBe(200);

    const decided = await prisma.referenceMergeCandidate.findUniqueOrThrow({
      where: { id: pair.id },
    });
    expect(decided.status).toBe("rejected");
    expect(decided.note).toBe("Different disasters.");

    // And it cannot be approved afterwards by anyone who missed the decision.
    const again = await fetch(
      `${BASE_URL}/api/admin/reference-merges/${pair.id}/approve`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(again.status).toBe(409);
  });

  test("a pair that stopped being two records cannot be approved", async () => {
    const headers = await adminHeaders();
    const a = await record("A bill on port infrastructure");
    const b = await record("A bill on inland waterways");
    const c = await record("A third, unrelated bill");
    const pair = await candidate(a.id, b.id);

    // b gets merged somewhere else first.
    await fetch(`${BASE_URL}/api/admin/reference-merges/${(await candidate(b.id, c.id)).id}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ keepId: c.id }),
    });

    const response = await fetch(
      `${BASE_URL}/api/admin/reference-merges/${pair.id}/approve`,
      { method: "POST", headers, body: JSON.stringify({}) },
    );
    expect(response.status).toBe(409);

    const closed = await prisma.referenceMergeCandidate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(closed.status).toBe("superseded");
  });

  test("a read-only admin can look but not decide", async () => {
    // Approving rewrites which record every affected post and vote belongs to.
    // Same bar as merging by hand.
    const readOnly = await adminHeaders("admin");
    const a = await record("A bill on rural broadband");
    const b = await record("A bill on satellite spectrum");
    const pair = await candidate(a.id, b.id);

    expect((await fetch(`${BASE_URL}/api/admin/reference-merges`, { headers: readOnly })).status).toBe(200);

    for (const action of ["approve", "reject"]) {
      const response = await fetch(
        `${BASE_URL}/api/admin/reference-merges/${pair.id}/${action}`,
        { method: "POST", headers: readOnly, body: JSON.stringify({}) },
      );
      expect({ action, status: response.status }).toEqual({ action, status: 403 });
    }
  });

  test("every queue endpoint rejects a request with no admin token", async () => {
    const paths: Array<[string, string]> = [
      ["GET", "/api/admin/reference-merges"],
      ["POST", "/api/admin/reference-merges/some-id/approve"],
      ["POST", "/api/admin/reference-merges/some-id/reject"],
      ["POST", "/api/admin/reference-merges/refresh"],
    ];

    for (const [method, path] of paths) {
      const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: freshClientHeaders({ "Content-Type": "application/json" }),
        body: method === "GET" ? undefined : "{}",
      });
      expect({ method, path, status: response.status }).toEqual({ method, path, status: 401 });
    }
  });
});

describe("what the matchmaker refuses to do", () => {
  /**
   * These are pure decision rules, tested without going near congress.gov —
   * the network is not what is under test here, the judgement is.
   */

  test("title similarity separates two Venezuela bills from two veterans bills", async () => {
    const { titleSimilarity } = await import("../src/services/reference-lineage");

    // The real pair from the load test: no published lineage, nearly the same
    // subject. This is why the suggestion list exists at all.
    expect(
      titleSimilarity(
        "A bill to impose sanctions with respect to Venezuela",
        "A bill to impose additional sanctions with respect to Venezuela",
      ),
    ).toBeGreaterThan(0.7);

    // Congressional titles are long and formulaic, so an edit-distance measure
    // scores nearly every pair as similar on boilerplate alone. These two share
    // every stock phrase and nothing that matters.
    expect(
      titleSimilarity(
        "A bill to amend title 38, United States Code, to improve health care for veterans",
        "A bill to amend title 38, United States Code, to improve burial benefits",
      ),
    ).toBeLessThan(0.7);
  });

  test("a pair a reviewer already answered is not put back in the queue", async () => {
    const { fileCandidate } = await import("../src/services/reference-lineage");
    // Runs against the same database the server uses, through the harness client.
    const a = await prisma.governmentReference.create({
      data: { masterReferenceId: "hr-8801-119", referenceType: "bill", title: "One", status: "proposed" },
    });
    const b = await prisma.governmentReference.create({
      data: { masterReferenceId: "hr-8802-119", referenceType: "bill", title: "Two", status: "proposed" },
    });
    const [leftId, rightId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await prisma.referenceMergeCandidate.create({
      data: { leftId, rightId, relationship: "Companion measure", status: "rejected" },
    });

    const refiled = await fileCandidate(
      { aId: a.id, bId: b.id, relationship: "Companion measure", identifiedBy: "CRS" },
      prisma,
    );
    expect(refiled).toEqual({ filed: false, reason: "already rejected" });
  });

  test("a rejected guess is asked again when the government publishes real lineage", async () => {
    // The one exception, and it is not the same question: a reviewer declining
    // this platform's title guess said nothing about what congress.gov would
    // later confirm.
    const { fileCandidate } = await import("../src/services/reference-lineage");
    const a = await prisma.governmentReference.create({
      data: { masterReferenceId: "hr-8803-119", referenceType: "bill", title: "Three", status: "proposed" },
    });
    const b = await prisma.governmentReference.create({
      data: { masterReferenceId: "hr-8804-119", referenceType: "bill", title: "Four", status: "proposed" },
    });
    const [leftId, rightId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const pair = await prisma.referenceMergeCandidate.create({
      data: { leftId, rightId, relationship: "look_alike", similarity: 0.91, status: "rejected" },
    });

    const refiled = await fileCandidate(
      {
        aId: a.id,
        bId: b.id,
        relationship: "Companion measure",
        identifiedBy: "House",
        evidenceUrl: "https://www.congress.gov/bill/119th-congress/house-bill/8803/related-bills",
      },
      prisma,
    );
    expect(refiled.filed).toBe(true);

    const reopened = await prisma.referenceMergeCandidate.findUniqueOrThrow({ where: { id: pair.id } });
    expect(reopened.status).toBe("pending");
    expect(reopened.relationship).toBe("Companion measure");
    expect(reopened.identifiedBy).toBe("House");
  });
});

describe("a post shows the law as it stands", () => {
  /**
   * The rule Khalid set: the law is shared and tied to the master reference; the
   * post frames it to that person's timeline. So when the government updates the
   * law, updating the record updates every post showing it. Nobody walks the
   * posts, and no post is ever edited.
   *
   * Post rows still carry a frozen copy of the title from the moment they were
   * written. These tests are that the copy never wins.
   */

  async function author(): Promise<{ cookie: string; userId: string }> {
    return signUp({
      email: `fresh-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Freshness Tester",
    });
  }

  let counter = 0;
  async function record(title: string) {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${4000 + counter}-119`,
        referenceType: "bill",
        title,
        status: "proposed",
      },
    });
    await prisma.referenceName.create({
      data: { name: row.masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
    });
    return row;
  }

  test("renaming the law changes every post about it, and edits none of them", async () => {
    const { cookie } = await author();
    const law = await record("A bill to do the original thing");

    const created = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ content: "I have views on this", governmentReferenceId: law.id }),
    });
    expect(created.status).toBe(201);
    const { post } = (await created.json()) as { post: { id: string } };

    // The government renames it. One row changes.
    await prisma.governmentReference.update({
      where: { id: law.id },
      data: { title: "A bill to do the amended thing" },
    });

    const fetched = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      headers: freshClientHeaders({ cookie }),
    });
    const body = (await fetched.json()) as {
      post: { content: string; referenceTitle: string; reference: { title: string } };
    };

    // Both the law card and the legacy field older clients read.
    expect(body.post.reference.title).toBe("A bill to do the amended thing");
    expect(body.post.referenceTitle).toBe("A bill to do the amended thing");
    // And the post itself was never touched — not its words, and not its own
    // frozen copy of the title.
    expect(body.post.content).toBe("I have views on this");
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.referenceTitle).toBe("A bill to do the original thing");
    expect(row.content).toBe("I have views on this");
  });

  test("voting does not make the law look like it changed", async () => {
    // The reason lawChangedAt exists at all. `updatedAt` on the record moves
    // every time somebody votes, because a vote writes the tally back to the
    // row — so using it to decide "has this law moved since I shared it" would
    // badge every post on the platform the moment anyone voted.
    const { cookie } = await author();
    const law = await record("A bill nobody has amended");

    const before = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(before.lawChangedAt).toBeNull();
    expect(before.lawVersion).toBe(1);

    const voted = await fetch(`${BASE_URL}/api/government-references/${law.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect(voted.status).toBe(200);

    const after = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect(after.lawChangedAt).toBeNull();
    expect(after.lawVersion).toBe(1);
  });

  test("the law card carries when the law last moved", async () => {
    const { cookie } = await author();
    const law = await record("A bill that has since been amended");
    const movedAt = new Date("2026-06-01T00:00:00Z");
    await prisma.governmentReference.update({
      where: { id: law.id },
      data: { lawChangedAt: movedAt, lawVersion: 3 },
    });

    const created = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ content: "written after the change", governmentReferenceId: law.id }),
    });
    const { post } = (await created.json()) as { post: { id: string } };

    const fetched = await fetch(`${BASE_URL}/api/posts/${post.id}`, {
      headers: freshClientHeaders({ cookie }),
    });
    const body = (await fetched.json()) as {
      post: { reference: { lawChangedAt: string; lawVersion: number } };
    };
    expect(body.post.reference.lawChangedAt).toBe(movedAt.toISOString());
    expect(body.post.reference.lawVersion).toBe(3);
  });
});

describe("one brief per version of the law", () => {
  /**
   * The citizen brief belongs to the record, not to the click.
   *
   * Open one → the record already has a brief for this version of the law →
   * loads instantly, no model call, no cost. Not there → generated once and
   * saved to the record, and everybody after that reads the same copy. When the
   * government changes the law, exactly one new brief is written for the new
   * version. Not per user, not per click, not per post.
   */

  let counter = 0;
  async function record(overrides: Record<string, unknown> = {}) {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${5000 + counter}-119`,
        referenceType: "bill",
        title: `Brief record ${counter}`,
        status: "proposed",
        ...overrides,
      },
    });
    await prisma.referenceName.create({
      data: { name: row.masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
    });
    return row;
  }

  const STORED_BRIEF = {
    citizenBrief: "What this law does, in plain language.",
    citizenBriefJson: briefJson("What this law does, in plain language."),
    citizenBriefAt: new Date("2026-04-01T00:00:00Z"),
    citizenBriefModel: "some-model",
    fullText: "SECTION 1. SHORT TITLE.",
    fullTextHash: "deadbeef",
    contentStatus: "ready",
    sourceCheckedAt: new Date(),
  };

  async function detail(id: string) {
    const response = await fetch(`${BASE_URL}/api/government-references/${id}`, {
      headers: freshClientHeaders(),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      reference: {
        citizenBrief: string | null;
        citizenBriefAt: string | null;
        citizenBriefVersion: number | null;
        lawVersion: number;
        lawChangedAt: string | null;
      };
    };
    return body.reference;
  }

  test("a brief that describes the current law is never rewritten", async () => {
    // Two readers, one brief. The second must not cost a model call — and the
    // way to see that from outside is that nothing about the stored brief moved.
    const law = await record({ ...STORED_BRIEF, lawVersion: 1, citizenBriefVersion: 1 });

    const first = await detail(law.id);
    expect(first.citizenBriefVersion).toBe(first.lawVersion);
    expect(first.citizenBrief).toBe(STORED_BRIEF.citizenBrief);

    const second = await detail(law.id);
    expect(second.citizenBriefAt).toBe(first.citizenBriefAt);

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    expect(row.citizenBriefAt?.toISOString()).toBe(STORED_BRIEF.citizenBriefAt.toISOString());
    expect(row.citizenBriefModel).toBe("some-model");
    // The strongest signal available without an AI key: this test server has
    // no model provider configured, so anything that DID try to regenerate
    // would fail and leave the record marked unavailable. Still "ready" means
    // generation was never attempted.
    expect(row.contentStatus).toBe("ready");
  });

  test("when the law moves, the stored brief stops being current", async () => {
    // The state that used to be unrepresentable. Before the version was
    // recorded, "is this brief still right" lived in a variable inside one
    // function call — so a regeneration that failed left a stale brief looking
    // current forever, and every later reader was served a summary of a law
    // that no longer existed.
    const law = await record({ ...STORED_BRIEF, lawVersion: 1, citizenBriefVersion: 1 });
    expect((await detail(law.id)).citizenBriefVersion).toBe(1);

    const movedAt = new Date("2026-07-04T00:00:00Z");
    await prisma.governmentReference.update({
      where: { id: law.id },
      data: { lawVersion: 2, lawChangedAt: movedAt },
    });

    const after = await detail(law.id);
    expect(after.lawVersion).toBe(2);
    expect(after.citizenBriefVersion).toBe(1);
    expect(after.lawChangedAt).toBe(movedAt.toISOString());
    // Still readable. A brief for the previous text beats a blank panel, and
    // the version numbers say plainly which one it describes.
    expect(after.citizenBrief).toBe(STORED_BRIEF.citizenBrief);
  });

  test("a merge adopts a brief and does not make it look stale", async () => {
    // A merge must never be the reason a brief gets rewritten. Carrying the
    // source's version number across would leave the survivor looking a version
    // behind and pay for a regeneration on the very next read.
    const { cookie, userId } = await signUp({
      email: `brief-admin-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Brief Admin",
    });
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });

    const target = await record({ lawVersion: 4 });
    const source = await record({ ...STORED_BRIEF, lawVersion: 9, citizenBriefVersion: 9 });

    const merged = await fetch(`${BASE_URL}/api/government-references/merge`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ sourceId: source.id, targetId: target.id }),
    });
    expect(merged.status).toBe(200);
    expect(((await merged.json()) as { merge: { brief: string } }).merge.brief).toBe(
      "adopted from source",
    );

    const survivor = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(survivor.citizenBrief).toBe(STORED_BRIEF.citizenBrief);
    // Pinned to the survivor's own version, so it reads as current.
    expect(survivor.citizenBriefVersion).toBe(4);
    expect(survivor.lawVersion).toBe(4);
    // And the timestamp came across intact rather than being reset.
    expect(survivor.citizenBriefAt?.toISOString()).toBe(STORED_BRIEF.citizenBriefAt.toISOString());
  });
});

describe("when a law moves, the people who shared it are told", () => {
  /**
   * The rule Khalid set: update the law in the post to keep the master
   * reference clean, but notify the user. The post is never edited — their
   * words stay their words — and a post written before the change carries a
   * badge saying the law beneath it has moved forward.
   */

  async function poster(): Promise<{ cookie: string; userId: string }> {
    return signUp({
      email: `signal-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Signal Tester",
    });
  }

  let counter = 0;
  async function law(overrides: Record<string, unknown> = {}) {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${3000 + counter}-119`,
        referenceType: "bill",
        title: `Signal record ${counter}`,
        status: "proposed",
        ...overrides,
      },
    });
    await prisma.referenceName.create({
      data: { name: row.masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
    });
    return row;
  }

  async function write(cookie: string, referenceId: string) {
    const response = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ content: "my position on this", governmentReferenceId: referenceId }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { post: { id: string } }).post.id;
  }

  async function read(cookie: string, postId: string) {
    const response = await fetch(`${BASE_URL}/api/posts/${postId}`, {
      headers: freshClientHeaders({ cookie }),
    });
    return ((await response.json()) as { post: { lawUpdatedSincePosting: boolean } }).post;
  }

  test("a post written before the change is badged; one written after is not", async () => {
    const { cookie } = await poster();
    const bill = await law();

    const before = await write(cookie, bill.id);
    expect((await read(cookie, before)).lawUpdatedSincePosting).toBe(false);

    // The government amends it.
    await prisma.governmentReference.update({
      where: { id: bill.id },
      data: { lawChangedAt: new Date(), lawVersion: 2 },
    });

    expect((await read(cookie, before)).lawUpdatedSincePosting).toBe(true);

    // Somebody writing about it now is arguing about the current text, so
    // there is nothing to warn them about.
    const after = await write(cookie, bill.id);
    expect((await read(cookie, after)).lawUpdatedSincePosting).toBe(false);
  });

  test("a post about a law that has never moved is never badged", async () => {
    // The failure that would make this feature worthless: badging everything.
    // `updatedAt` on the record moves on every vote, so anything keyed to it
    // would light up the whole feed the first time somebody voted.
    const { cookie } = await poster();
    const bill = await law();
    const postId = await write(cookie, bill.id);

    const voted = await fetch(`${BASE_URL}/api/government-references/${bill.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ position: "support" }),
    });
    expect(voted.status).toBe(200);

    expect((await read(cookie, postId)).lawUpdatedSincePosting).toBe(false);
  });

  test("everyone who shared the law is told once, whatever they wrote", async () => {
    const { notifyLawUpdate } = await import("../src/services/notification-service");

    const bill = await law();
    const first = await poster();
    const second = await poster();

    // One person wrote about it three times; the other once.
    await write(first.cookie, bill.id);
    await write(first.cookie, bill.id);
    const firstLatest = await write(first.cookie, bill.id);
    await write(second.cookie, bill.id);

    const { notified } = await notifyLawUpdate(bill.id, bill.masterReferenceId, bill.title);
    expect(notified).toBe(2);

    const sent = await prisma.notification.findMany({ where: { type: "law_updated" } });
    expect(sent.length).toBe(2);
    // Their words are theirs. The notification says the law moved, not that
    // anything of theirs was changed.
    expect(sent[0]!.body).toContain("Your post is unchanged");

    // The prolific poster's notification points at what they said most recently.
    const toFirst = sent.find((n) => n.userId === first.userId);
    expect(toFirst).toBeDefined();
    expect(JSON.parse(toFirst!.data ?? "{}")).toMatchObject({ postId: firstLatest });
  });

  test("somebody who turned law updates off is not told", async () => {
    const { notifyLawUpdate } = await import("../src/services/notification-service");

    const bill = await law();
    const { cookie, userId } = await poster();
    await write(cookie, bill.id);

    await prisma.notificationPreference.upsert({
      where: { userId },
      update: { lawUpdates: false },
      create: { userId, lawUpdates: false },
    });

    const { notified } = await notifyLawUpdate(bill.id, bill.masterReferenceId, bill.title);
    expect(notified).toBe(0);
    expect(await prisma.notification.count({ where: { type: "law_updated" } })).toBe(0);
  });
});

describe("nothing invents a vote", () => {
  /**
   * Article III of this platform's Bill of Rights promises the Public Pulse is
   * "the true will of the people", and Article III Section 3 of its
   * constitution requires every data point to trace back to an official source
   * so the digital government cannot drift into fiction.
   *
   * Every record used to carry between 400 and 4,999 invented supporters,
   * derived from a hash of its id, folded straight into that number. A live
   * check found all 33 stored records carrying them and not one carrying a real
   * vote: the entire published pulse was fabricated.
   */

  test("a brand-new record starts at nothing", async () => {
    // A card that says nobody has voted yet is telling the truth. A card that
    // says four thousand people support a bill nobody has read is not — and
    // that number flows into the trending list and the enterprise feed.
    const response = await fetch(`${BASE_URL}/api/government-references/resolve`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        branch: "legislative",
        title: "Providing for consideration of the annual maritime survey",
        billType: "sconres",
        billNumber: "77",
        congress: 119,
      }),
    });
    expect(response.status).toBe(200);
    const { reference } = (await response.json()) as { reference: { id: string } };

    const row = await prisma.governmentReference.findUniqueOrThrow({
      where: { id: reference.id },
    });
    expect({
      support: row.supportVotes,
      oppose: row.opposeVotes,
      seedSupport: row.seedSupport,
      seedOppose: row.seedOppose,
    }).toEqual({ support: 0, oppose: 0, seedSupport: 0, seedOppose: 0 });
  });

  test("the published tally is exactly the votes that were cast", async () => {
    const first = await signUp({
      email: `pulse-a-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Pulse A",
    });
    const second = await signUp({
      email: `pulse-b-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Pulse B",
    });

    const law = await prisma.governmentReference.create({
      data: {
        masterReferenceId: "hres-2222-119",
        referenceType: "bill",
        title: "A resolution nobody has voted on yet",
        status: "proposed",
      },
    });

    for (const [voter, position] of [
      [first, "support"],
      [second, "oppose"],
    ] as const) {
      const voted = await fetch(`${BASE_URL}/api/government-references/${law.id}/vote`, {
        method: "POST",
        headers: freshClientHeaders({ "Content-Type": "application/json", cookie: voter.cookie }),
        body: JSON.stringify({ position }),
      });
      expect(voted.status).toBe(200);
    }

    const row = await prisma.governmentReference.findUniqueOrThrow({ where: { id: law.id } });
    // Two people voted. The number says two people voted.
    expect({ support: row.supportVotes, oppose: row.opposeVotes }).toEqual({
      support: 1,
      oppose: 1,
    });
  });
});

describe("a deleted post is deleted", () => {
  /**
   * The defect this pins: the timeline removed the post from local state and
   * never called the server. It vanished from the screen, the author believed
   * it was gone, and it was still public — still returned by /api/posts and
   * /api/feed, still listed in the admin console, and back on screen after a
   * reload.
   *
   * The endpoint itself was always correct. What was missing was anybody
   * calling it, so what these check is the acceptance criterion rather than the
   * handler: after a delete, the post is not returned by anything.
   */

  async function author(): Promise<{ cookie: string; userId: string }> {
    return signUp({
      email: `del-persist-${Math.random().toString(36).slice(2)}@example.com`,
      password: "correct horse battery staple",
      name: "Delete Persist",
    });
  }

  let counter = 0;
  async function law() {
    counter += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${2000 + counter}-119`,
        referenceType: "bill",
        title: `Delete-path record ${counter}`,
        status: "proposed",
      },
    });
    await prisma.referenceName.create({
      data: { name: row.masterReferenceId, referenceId: row.id, isCurrent: true, learnedFrom: "created" },
    });
    return row;
  }

  async function write(cookie: string, referenceId: string, content: string): Promise<string> {
    const response = await fetch(`${BASE_URL}/api/posts`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
      body: JSON.stringify({ content, governmentReferenceId: referenceId }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { post: { id: string } }).post.id;
  }

  async function listedBy(path: string, cookie: string): Promise<string[]> {
    const response = await fetch(`${BASE_URL}${path}`, { headers: freshClientHeaders({ cookie }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { posts: Array<{ id: string }> };
    return body.posts.map((p) => p.id);
  }

  test("after a delete, no endpoint still returns the post", async () => {
    const { cookie } = await author();
    const bill = await law();
    const doomed = await write(cookie, bill.id, "this one goes");
    const kept = await write(cookie, bill.id, "this one stays");

    expect(await listedBy("/api/posts", cookie)).toContain(doomed);
    expect(await listedBy("/api/feed", cookie)).toContain(doomed);

    const deleted = await fetch(`${BASE_URL}/api/posts/${doomed}`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie }),
    });
    expect(deleted.status).toBe(200);

    // The three places the audit found it still alive.
    expect(await listedBy("/api/posts", cookie)).not.toContain(doomed);
    expect(await listedBy("/api/feed", cookie)).not.toContain(doomed);
    expect(await prisma.post.findUnique({ where: { id: doomed } })).toBeNull();

    // And only that one. A delete that took the neighbours with it would be a
    // different disaster passing the same assertions.
    expect(await listedBy("/api/posts", cookie)).toContain(kept);
  });

  test("somebody else's post cannot be deleted", async () => {
    const owner = await author();
    const stranger = await author();
    const bill = await law();
    const post = await write(owner.cookie, bill.id, "mine");

    const attempt = await fetch(`${BASE_URL}/api/posts/${post}`, {
      method: "DELETE",
      headers: freshClientHeaders({ cookie: stranger.cookie }),
    });
    expect(attempt.status).toBe(403);
    expect(await prisma.post.findUnique({ where: { id: post } })).not.toBeNull();
  });

  test("a page of posts carries the cursor for the next one", async () => {
    // The audit could not settle this because there were no posts: with a
    // single page, `nextCursor` is undefined and JSON drops the key entirely,
    // so the response looks like it has no cursor at all. With two posts and a
    // limit of one it either comes back or it does not.
    const { cookie } = await author();
    const bill = await law();
    await write(cookie, bill.id, "first");
    await write(cookie, bill.id, "second");

    const first = await fetch(`${BASE_URL}/api/posts?limit=1`, {
      headers: freshClientHeaders({ cookie }),
    });
    const page = (await first.json()) as {
      posts: Array<{ id: string }>;
      nextCursor?: string;
      hasMore: boolean;
    };

    expect(page.posts.length).toBe(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(page.posts[0]!.id);

    // And the cursor actually advances, which is the thing infinite scroll
    // depends on — a cursor that returns the same page forever would satisfy
    // every assertion above.
    const second = await fetch(`${BASE_URL}/api/posts?limit=1&cursor=${page.nextCursor}`, {
      headers: freshClientHeaders({ cookie }),
    });
    const nextPage = (await second.json()) as {
      posts: Array<{ id: string }>;
      nextCursor?: string;
      hasMore: boolean;
    };
    expect(nextPage.posts.length).toBe(1);
    expect(nextPage.posts[0]!.id).not.toBe(page.posts[0]!.id);
    expect(nextPage.hasMore).toBe(false);
    expect(nextPage.nextCursor).toBeUndefined();
  });
});
