/**
 * A key set from the admin console is stored encrypted, used immediately, and
 * never given back.
 *
 * WHY THIS EXISTS. Every provider key lived in one hosting provider's variables,
 * which made that provider load-bearing for a reason unrelated to running a
 * container: moving hosts meant re-typing ten keys, and rotating one meant a
 * redeploy by whoever held the dashboard. Moving them into the platform's own
 * database fixes that — and introduces three ways to do real damage, which is
 * what these tests pin shut:
 *
 *   1. STORING A KEY IN THE CLEAR. This database is shared with another
 *      project. A plaintext key column would be readable by anyone holding any
 *      connection string to it. The test reads the raw column and fails if the
 *      key is findable in it.
 *
 *   2. WRITING AN ARBITRARY ENVIRONMENT VARIABLE. An endpoint that sets
 *      process.env from an HTTP body is a remote code execution as soon as
 *      somebody types PATH or NODE_OPTIONS. Only names on a literal list are
 *      accepted.
 *
 *   3. HANDING A KEY BACK. No response, log, or activity entry may contain one.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_URL,
  prisma,
  signUp,
  startServer,
  stopServer,
  TEST_SECRETS_ENCRYPTION_KEY,
} from "./helpers/server";

/** A value that could not plausibly appear in the database by accident. */
const SECRET = "tvly-platform-secret-test-8f3a2b1c9d4e";
const REPLACEMENT = "tvly-platform-secret-test-rotated-0000";

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

function setKey(name: string, value: string, token: string) {
  return fetch(`${BASE_URL}/api/admin/keys/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ value }),
  });
}

function clearKey(name: string, token: string) {
  return fetch(`${BASE_URL}/api/admin/keys/${name}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

function readKeys(token: string) {
  return fetch(`${BASE_URL}/api/admin/keys`, { headers: { Authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  await startServer();
  const password = "correct horse battery staple";

  // Repeatable against a database that is not thrown away between runs.
  await prisma.user.deleteMany({
    where: { email: { in: ["keys-super@example.com", "keys-plain@example.com"] } },
  });

  const superadmin = await signUp({
    email: "keys-super@example.com",
    password,
    name: "Keys Super",
  });
  await prisma.user.update({ where: { id: superadmin.userId }, data: { role: "superadmin" } });
  superadminToken = await loginAdmin("keys-super@example.com", password);

  const plain = await signUp({ email: "keys-plain@example.com", password, name: "Keys Plain" });
  await prisma.user.update({ where: { id: plain.userId }, data: { role: "admin" } });
  plainAdminToken = await loginAdmin("keys-plain@example.com", password);

  await prisma.platformSecret.deleteMany({});
});

afterAll(async () => {
  await prisma.platformSecret.deleteMany({}).catch(() => {});
  await stopServer();
});

describe("only a superadmin can change a platform key", () => {
  test("no token is refused", async () => {
    const response = await fetch(`${BASE_URL}/api/admin/keys/TAVILY_API_KEY`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: SECRET }),
    });
    expect(response.status).toBe(401);
    expect(await prisma.platformSecret.count()).toBe(0);
  });

  test("an ordinary admin is refused", async () => {
    const response = await setKey("TAVILY_API_KEY", SECRET, plainAdminToken);
    expect(response.status).toBe(403);
    expect(await prisma.platformSecret.count()).toBe(0);
  });

  test("an ordinary admin cannot clear one either", async () => {
    const response = await clearKey("TAVILY_API_KEY", plainAdminToken);
    expect(response.status).toBe(403);
  });
});

describe("a name that could be a system variable is refused", () => {
  // The panel now accepts a NEW provider's key, not only the seven built-ins —
  // but a name that could change how the process runs is still an RCE waiting
  // for someone to type it. Each of these must be refused. The first two carry
  // no credential suffix, so the naming rule excludes them; the last three end
  // in one and are caught by the explicit denylist.
  for (const name of [
    "PATH",
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "SECRETS_ENCRYPTION_KEY",
    // Shapes that must not sneak past the rule.
    "path_api_key", // lowercase
    "MY KEY", // a space
    "SOME_PROVIDER", // no credential suffix
  ]) {
    test(`${name} cannot be set`, async () => {
      const response = await setKey(name, "/tmp/evil", superadminToken);
      expect(response.status).toBe(400);
      expect(await prisma.platformSecret.findUnique({ where: { name } })).toBeNull();
    });
  }

  test("the process keeps its own PATH", async () => {
    // Belt and braces: the refusal above is only meaningful if nothing wrote it.
    expect(process.env.PATH).toBeTruthy();
    expect(process.env.PATH).not.toContain("/tmp/evil");
  });
});

describe("the custom-name rule, at the predicate that both layers share", () => {
  // The HTTP tests above cannot reach a name with a slash in it — the router
  // resolves the path before the handler sees it — so the predicate is checked
  // directly here, where path characters, casing and suffixes all matter.
  test("safe provider names pass", async () => {
    const { isSafeCustomSecretName } = await import("../src/services/platform-secrets");
    for (const name of ["ACLED_API_KEY", "PROPUBLICA_API_KEY", "SOME_SERVICE_TOKEN", "X_ACCESS_KEY"]) {
      expect(isSafeCustomSecretName(name)).toBe(true);
    }
  });

  test("anything that could be a system or protected variable fails", async () => {
    const { isSafeCustomSecretName } = await import("../src/services/platform-secrets");
    for (const name of [
      "PATH",
      "NODE_OPTIONS",
      "LD_PRELOAD",
      "SECRETS_ENCRYPTION_KEY",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "../../ETC_KEY",
      "a b_KEY",
      "lower_api_key",
      "NO_SUFFIX",
      "CONGRESS_API_KEY", // a built-in is not a custom name
    ]) {
      expect(isSafeCustomSecretName(name)).toBe(false);
    }
  });
});

describe("a new provider's key can be added, and it actually works", () => {
  // The panel is an on-ramp: an operator inserts the key, then the wiring is
  // written against it. ACLED is a real data source nobody here uses yet — the
  // point is exactly that no code reads it, and it can still be stored, loaded
  // and read back by name, ready to wire.
  const CUSTOM = "ACLED_API_KEY";
  const CUSTOM_VALUE = "acled-live-value-9f3b2c";

  test("a safe custom name is accepted and encrypted like a built-in", async () => {
    const response = await setKey(CUSTOM, CUSTOM_VALUE, superadminToken);
    expect(response.status).toBe(200);

    const row = await prisma.platformSecret.findUnique({ where: { name: CUSTOM } });
    expect(row).not.toBeNull();
    expect(row!.ciphertext).not.toContain(CUSTOM_VALUE);
    expect(row!.ciphertext.startsWith("v1:")).toBe(true);
    expect(await decrypt(CUSTOM)).toBe(CUSTOM_VALUE);
  });

  test("the server reports it as live, from the database", async () => {
    // The whole promise: once inserted, the running backend is using it, ready
    // for a consumer to be wired against it with no redeploy. The value is
    // never handed back, so what proves it is the server's own report that the
    // key in use for this name now comes from the database. (The test runs in a
    // different process from the server, so its own process.env cannot see the
    // server's — the server's report is the observable truth.)
    const body = (await (await readKeys(superadminToken)).json()) as {
      data: { storage: { stored: { name: string; source: string }[] } };
    };
    const row = body.data.storage.stored.find((entry) => entry.name === CUSTOM);
    expect(row?.source).toBe("database");
  });

  test("the panel lists it, marked as not built in", async () => {
    const body = (await (await readKeys(superadminToken)).json()) as {
      data: { storage: { stored: { name: string; builtIn: boolean; storedInDatabase: boolean }[] } };
    };
    const row = body.data.storage.stored.find((entry) => entry.name === CUSTOM);
    expect(row).toBeDefined();
    expect(row!.builtIn).toBe(false);
    expect(row!.storedInDatabase).toBe(true);
  });

  test("clearing it hands the name back and removes it from the process", async () => {
    expect((await clearKey(CUSTOM, superadminToken)).status).toBe(200);
    expect(await prisma.platformSecret.findUnique({ where: { name: CUSTOM } })).toBeNull();
    // Nothing had this on the host at boot, so clearing unsets it entirely.
    expect(process.env[CUSTOM]).toBeUndefined();
  });
});

describe("stored, encrypted, and in use", () => {
  test("a superadmin can store a key", async () => {
    const response = await setKey("TAVILY_API_KEY", SECRET, superadminToken);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: { fingerprint: string; length: number; replaced: boolean } };
    expect(body.data.length).toBe(SECRET.length);
    expect(body.data.replaced).toBe(false);
    // The response describes the key without containing it.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test("the database column is ciphertext, not the key", async () => {
    const row = await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } });
    expect(row).not.toBeNull();
    expect(row!.ciphertext).not.toContain(SECRET);
    // Nor any recognisable fragment of it.
    expect(row!.ciphertext).not.toContain("tvly-");
    expect(row!.ciphertext.startsWith("v1:")).toBe(true);

    // The whole row, every column, holds nothing that reveals the key.
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  test("the ciphertext decrypts back to the key, with the right key and name", async () => {
    expect(await decrypt("TAVILY_API_KEY")).toBe(SECRET);
  });

  test("the same ciphertext under another key's name does not decrypt", async () => {
    // The name is bound in as additional authenticated data, so a ciphertext
    // moved between rows fails rather than quietly becoming a different key.
    const row = await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } });
    expect(() => decryptWith("CONGRESS_API_KEY", row!.ciphertext, TEST_SECRETS_ENCRYPTION_KEY)).toThrow();
  });

  test("a different encryption key does not decrypt it", async () => {
    const row = await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } });
    const wrong = Buffer.alloc(32, 7).toString("base64");
    expect(() => decryptWith("TAVILY_API_KEY", row!.ciphertext, wrong)).toThrow();
  });

  test("the running server is using it", async () => {
    const response = await readKeys(superadminToken);
    const body = (await response.json()) as {
      data: { keys: { name: string; present: boolean; source: string; length: number | null }[] };
    };
    const tavily = body.data.keys.find((key) => key.name === "TAVILY_API_KEY")!;

    expect(tavily.present).toBe(true);
    expect(tavily.source).toBe("database");
    expect(tavily.length).toBe(SECRET.length);
    // And the report still refuses to name it.
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test("rotating replaces it, and the old ciphertext is gone", async () => {
    const before = await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } });

    const response = await setKey("TAVILY_API_KEY", REPLACEMENT, superadminToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { replaced: boolean } };
    expect(body.data.replaced).toBe(true);

    const after = await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } });
    expect(after!.ciphertext).not.toBe(before!.ciphertext);
    expect(await decrypt("TAVILY_API_KEY")).toBe(REPLACEMENT);

    // One row per key, always. A rotation must not leave the old one behind.
    expect(await prisma.platformSecret.count({ where: { name: "TAVILY_API_KEY" } })).toBe(1);
  });

  test("clearing it leaves the key unset, and says so", async () => {
    const response = await clearKey("TAVILY_API_KEY", superadminToken);
    expect(response.status).toBe(200);
    expect(await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } })).toBeNull();

    const body = (await (await readKeys(superadminToken)).json()) as {
      data: {
        keys: { name: string; present: boolean; source: string }[];
        storage: { stored: { name: string; presentInEnvironment: boolean }[] };
      };
    };
    const tavily = body.data.keys.find((key) => key.name === "TAVILY_API_KEY")!;
    const row = body.data.storage.stored.find((entry) => entry.name === "TAVILY_API_KEY")!;

    // WHETHER IT IS NOW UNSET DEPENDS ON THE HOST, and the endpoint says which.
    // This asserted a bare "unset" and passed alone while failing in the full
    // suite: bun runs every test file in one process, tests/env-keys.test.ts
    // puts a TAVILY_API_KEY in that process's environment, and every server
    // spawned afterwards inherits it. That is not a bug — it is the fallback
    // working — so the assertion follows the same fork the feature does.
    if (row.presentInEnvironment) {
      expect(tavily.source).toBe("environment");
      expect(tavily.present).toBe(true);
    } else {
      expect(tavily.source).toBe("unset");
      expect(tavily.present).toBe(false);
    }
  });

  test("an empty value is refused rather than stored as a key made of nothing", async () => {
    const response = await setKey("TAVILY_API_KEY", "   ", superadminToken);
    expect(response.status).toBe(400);
    expect(await prisma.platformSecret.findUnique({ where: { name: "TAVILY_API_KEY" } })).toBeNull();
  });

  test("a pasted key with a trailing newline is stored trimmed", async () => {
    // The failure this prevents: a newline survives every text box and comes
    // back from the provider as a 401 that reads like a bad key.
    await setKey("TAVILY_API_KEY", `${SECRET}\n`, superadminToken);
    expect(await decrypt("TAVILY_API_KEY")).toBe(SECRET);
    await clearKey("TAVILY_API_KEY", superadminToken);
  });
});

describe("storing a key needs no variable nobody has set", () => {
  /**
   * THE BUG THIS PINS SHUT. The first version required SECRETS_ENCRYPTION_KEY
   * before a single key could be stored — so the feature whose entire point was
   * "stop opening the hosting dashboard to change a key" could not be turned on
   * without opening the hosting dashboard and redeploying. The panel showed an
   * explanation where the input boxes should have been, and the person it was
   * built for could not use it.
   */
  test("with no SECRETS_ENCRYPTION_KEY, a key still stores and reads back", async () => {
    const secrets = await import("../src/services/platform-secrets");
    const saved = process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.SECRETS_ENCRYPTION_KEY;

    try {
      const status = secrets.encryptionStatus();
      expect(status.available).toBe(true);
      expect(status.source).toBe("derived-from-auth-secret");
      // The one way stored keys can be lost is said out loud, not discovered.
      expect(status.caveat).toContain("BETTER_AUTH_SECRET");

      const cipher = secrets.encryptSecret("TAVILY_API_KEY", "tvly-derived-key-path");
      expect(cipher).not.toContain("tvly-");
      expect(secrets.decryptSecret("TAVILY_API_KEY", cipher)).toBe("tvly-derived-key-path");
    } finally {
      if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = saved;
    }
  });

  test("the derived key is not the auth secret itself", async () => {
    const secrets = await import("../src/services/platform-secrets");
    const saved = process.env.SECRETS_ENCRYPTION_KEY;
    delete process.env.SECRETS_ENCRYPTION_KEY;

    try {
      // If the auth secret were used directly, a ciphertext would decrypt under
      // a key built from it verbatim. HKDF means it cannot, which is what stops
      // this from weakening the thing that signs every session.
      const cipher = secrets.encryptSecret("TAVILY_API_KEY", "tvly-derived-key-path");
      const naive = Buffer.alloc(32);
      Buffer.from(process.env.BETTER_AUTH_SECRET!, "utf8").copy(naive);
      const [, iv, tag, body] = cipher.split(":");
      const { createDecipheriv } = await import("node:crypto");
      expect(() => {
        const d = createDecipheriv("aes-256-gcm", naive, Buffer.from(iv!, "base64"));
        d.setAAD(Buffer.from("TAVILY_API_KEY", "utf8"));
        d.setAuthTag(Buffer.from(tag!, "base64"));
        Buffer.concat([d.update(Buffer.from(body!, "base64")), d.final()]);
      }).toThrow();
    } finally {
      if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = saved;
    }
  });

  test("an explicit SECRETS_ENCRYPTION_KEY still wins", async () => {
    const secrets = await import("../src/services/platform-secrets");
    const status = secrets.encryptionStatus();
    // The harness sets one, so this is the configured path.
    expect(status.available).toBe(true);
    expect(status.source).toBe("SECRETS_ENCRYPTION_KEY");
    expect(status.caveat).toBeNull();
  });

  test("a malformed explicit key is refused rather than silently derived around", async () => {
    const secrets = await import("../src/services/platform-secrets");
    const saved = process.env.SECRETS_ENCRYPTION_KEY;
    process.env.SECRETS_ENCRYPTION_KEY = "too-short";

    try {
      const status = secrets.encryptionStatus();
      expect(status.available).toBe(false);
      // Falling back to the derived key here would mean a typo silently changed
      // which key everything is encrypted under.
      expect(status.reason).toContain("32");
    } finally {
      if (saved === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
      else process.env.SECRETS_ENCRYPTION_KEY = saved;
    }
  });
});

describe("a stored key overrides the host's variable, and clearing gives it back", () => {
  /**
   * THE HALF THAT ONLY MATTERS MID-MIGRATION, which is exactly when somebody
   * presses it. While the keys are being moved, both places have a value. If
   * "clear" meant "unset", it would break the platform for anyone who still had
   * the host variable set — silently, until the next feature that needed it.
   *
   * Run in this process rather than through the server, because it needs a host
   * variable that exists before the module loads, and the server's environment
   * is fixed when it spawns.
   */
  test("database wins while stored, environment returns when cleared", async () => {
    process.env.CONGRESS_API_KEY = "from-the-host-environment";

    const secrets = await import("../src/services/platform-secrets");
    const { env } = await import("../src/env");
    secrets.resetPlatformSecretsForTest();
    process.env.CONGRESS_API_KEY = "from-the-host-environment";

    // Nothing stored: the host's variable is what the platform reads.
    await secrets.loadPlatformSecretsIntoEnv();
    expect(env.CONGRESS_API_KEY).toBe("from-the-host-environment");
    expect(secrets.sourceOf("CONGRESS_API_KEY")).toBe("environment");

    await secrets.setPlatformSecret("CONGRESS_API_KEY", "from-the-database", {
      id: "test",
      username: "test",
    });
    expect(env.CONGRESS_API_KEY).toBe("from-the-database");
    expect(secrets.sourceOf("CONGRESS_API_KEY")).toBe("database");

    const cleared = await secrets.clearPlatformSecret("CONGRESS_API_KEY");
    expect(cleared.fellBackToEnvironment).toBe(true);
    expect(env.CONGRESS_API_KEY).toBe("from-the-host-environment");
    expect(secrets.sourceOf("CONGRESS_API_KEY")).toBe("environment");

    delete process.env.CONGRESS_API_KEY;
    secrets.resetPlatformSecretsForTest();
  });

  test("a row that cannot be decrypted leaves the host's variable in place", async () => {
    // A wrong or rotated SECRETS_ENCRYPTION_KEY must degrade to the previous
    // behaviour, not to no key at all.
    const secrets = await import("../src/services/platform-secrets");
    secrets.resetPlatformSecretsForTest();
    process.env.CONGRESS_API_KEY = "from-the-host-environment";

    await prisma.platformSecret.create({
      data: {
        name: "CONGRESS_API_KEY",
        ciphertext: "v1:AAAA:AAAA:AAAA",
        fingerprint: "0000",
        length: 4,
      },
    });

    const result = await secrets.loadPlatformSecretsIntoEnv();
    expect(result.failed.map((f) => f.name)).toContain("CONGRESS_API_KEY");
    expect(process.env.CONGRESS_API_KEY).toBe("from-the-host-environment");

    await prisma.platformSecret.deleteMany({ where: { name: "CONGRESS_API_KEY" } });
    delete process.env.CONGRESS_API_KEY;
    secrets.resetPlatformSecretsForTest();
  });
});

describe("what the console reports", () => {
  test("every storable key is listed, with where its value comes from", async () => {
    const body = (await (await readKeys(superadminToken)).json()) as {
      data: {
        storage: {
          stored: { name: string; source: string }[];
          storable: string[];
          encryptionAvailable: boolean;
          cannotBeStored: { names: string[] };
        };
      };
    };

    expect(body.data.storage.encryptionAvailable).toBe(true);
    expect(body.data.storage.storable).toContain("CONGRESS_API_KEY");
    expect(body.data.storage.stored.map((s) => s.name).sort()).toEqual(
      [...body.data.storage.storable].sort(),
    );
    // The three that cannot move are named, so nobody goes looking for them.
    expect(body.data.storage.cannotBeStored.names).toContain("DATABASE_URL");
    expect(body.data.storage.cannotBeStored.names).toContain("BETTER_AUTH_SECRET");
    expect(body.data.storage.cannotBeStored.names).toContain("SECRETS_ENCRYPTION_KEY");
  });

  test("the storable list matches the secrets the schema declares", async () => {
    // A key added to env.ts and forgotten here would be un-storable with no
    // error anywhere — it would simply never appear in the console.
    const { STORABLE_SECRETS } = await import("../src/services/platform-secrets");
    const schema = readFileSync(join(import.meta.dir, "../src/env.ts"), "utf8");
    const declared = [...schema.matchAll(/^\s*([A-Z0-9_]*API_KEY)\s*:\s*secret\(\)/gm)].map(
      (match) => match[1]!,
    );
    expect(([...STORABLE_SECRETS] as string[]).sort()).toEqual(declared.sort());
  });
});

// ---------------------------------------------------------------------------

function decryptWith(name: string, stored: string, base64Key: string): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== "v1") throw new Error("unexpected format");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(base64Key, "base64"),
    Buffer.from(iv!, "base64"),
  );
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(Buffer.from(tag!, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body!, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Read the row and decrypt it exactly as an outsider holding the key would.
 *
 * Deliberately not calling the service's own decryptSecret: a round trip
 * through the code under test proves only that it agrees with itself. This
 * reimplements AES-256-GCM from the stored columns, so it fails if the format
 * silently changes.
 */
async function decrypt(name: string): Promise<string> {
  const row = await prisma.platformSecret.findUnique({ where: { name } });
  if (!row) throw new Error(`${name} is not stored`);
  return decryptWith(name, row.ciphertext, TEST_SECRETS_ENCRYPTION_KEY);
}
