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
    // 33 models plus _prisma_migrations. If this drops, a model was removed
    // without anyone meaning to. The number was stale at 30 and therefore no
    // longer a guard against anything — B2BSession and B2BClient had both been
    // added underneath it.
    expect(Number(tables[0]!.count)).toBeGreaterThanOrEqual(34);
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

  /** A reference row with a current name and a list of former ones. */
  async function reference(masterReferenceId: string, formerNames: string[] = []) {
    return prisma.governmentReference.create({
      data: {
        masterReferenceId,
        referenceType: "bill",
        title: `Record ${masterReferenceId}`,
        status: "proposed",
        aliases: formerNames.length > 0 ? JSON.stringify(formerNames) : null,
      },
    });
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

  test("the record that currently holds a name always wins over one that used to", async () => {
    // The dangerous case. If a former name could shadow a current one, a
    // repaired record would silently steal traffic from the record that now
    // legitimately owns that id — the exact opposite of the guarantee.
    const { cookie } = await poster();
    const formerOwner = await reference("hres-1443-119", ["hr-4836-119"]);
    const currentOwner = await reference("hr-4836-119");

    const response = await post(cookie, "hr-4836-119");
    expect(response.status).toBe(201);

    const body = (await response.json()) as { post: { id: string } };
    const written = await prisma.post.findUniqueOrThrow({ where: { id: body.post.id } });
    expect(written.governmentReferenceId).toBe(currentOwner.id);
    expect(written.governmentReferenceId).not.toBe(formerOwner.id);
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
    return prisma.governmentReference.create({
      data: {
        masterReferenceId: `hr-${9000 + counter}-119`,
        referenceType: "bill",
        title: `Record ${counter}`,
        status: "proposed",
        ...overrides,
      },
    });
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

  test("seed layers are not added together", async () => {
    // Seed votes are a display placeholder so a new card does not read 0-0.
    // They are not support anybody expressed, so summing two of them would
    // manufacture thousands of fake votes out of a bookkeeping event.
    const cookie = await staff();
    const target = await record({ seedSupport: 1000, seedOppose: 500, supportVotes: 1000, opposeVotes: 500 });
    const source = await record({ seedSupport: 4000, seedOppose: 3000, supportVotes: 4000, opposeVotes: 3000 });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.seedSupport).toBe(1000);
    expect(merged.seedOppose).toBe(500);
    // No real votes exist, so the public tally is the survivor's own seed and
    // nothing else.
    expect({ support: merged.supportVotes, oppose: merged.opposeVotes }).toEqual({
      support: 1000,
      oppose: 500,
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
      citizenBriefJson: '{"summary":"..."}',
      citizenBriefAt: writtenAt,
      citizenBriefModel: "some-model",
      fullText: "SECTION 1. SHORT TITLE.",
      fullTextHash: "abc123",
    });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.citizenBrief).toBe("What this law actually does.");
    expect(merged.citizenBriefJson).toBe('{"summary":"..."}');
    expect(merged.citizenBriefModel).toBe("some-model");
    expect(merged.fullText).toBe("SECTION 1. SHORT TITLE.");
    // The timestamp comes across intact. If it were reset, the freshness check
    // would treat an existing brief as new work and pay to write it again.
    expect(merged.citizenBriefAt?.toISOString()).toBe(writtenAt.toISOString());
  });

  test("a brief the survivor already has is left alone", async () => {
    const cookie = await staff();
    const target = await record({ citizenBrief: "The survivor's own brief." });
    const source = await record({ citizenBrief: "The other one's brief." });

    expect((await merge(cookie, source.id, target.id)).status).toBe(200);

    const merged = await prisma.governmentReference.findUniqueOrThrow({ where: { id: target.id } });
    expect(merged.citizenBrief).toBe("The survivor's own brief.");
  });

  test("the source's name still reaches the survivor", async () => {
    // No link dies. Whatever the source was called is now something the
    // survivor answers to, and the tombstone points the way as well.
    const cookie = await staff();
    const target = await record();
    const source = await record({ aliases: JSON.stringify(["an-even-older-name"]) });

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
