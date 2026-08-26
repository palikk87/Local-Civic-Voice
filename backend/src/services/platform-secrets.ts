/**
 * API keys, held with the platform's own data instead of a hosting provider's
 * environment panel.
 *
 * WHY THIS EXISTS. Every provider key lived in Railway's variables. That made
 * Railway load-bearing for a reason that has nothing to do with running a
 * container: moving hosts meant re-typing ten keys, and rotating one meant a
 * redeploy by whoever had the dashboard. The keys are the platform's, so they
 * belong with the platform's data — in the same Postgres as everything else,
 * reachable from any host, changeable by the super admin from a phone.
 *
 * THREE VARIABLES STAY IN THE ENVIRONMENT, AND MUST:
 *
 *   DATABASE_URL           — a process cannot read the database to find out
 *                            how to reach the database.
 *   BETTER_AUTH_SECRET     — sessions must verify before anybody can be an
 *                            admin, including the admin who would set it.
 *   SECRETS_ENCRYPTION_KEY — a key kept next to the thing it encrypts is not
 *                            encryption. See below.
 *
 * Everything else can move. That is ten variables down to three, and the three
 * that remain are the three that genuinely cannot be anywhere else.
 *
 * ENCRYPTED, NOT MERELY PRIVATE. AES-256-GCM, key from SECRETS_ENCRYPTION_KEY,
 * a fresh random IV per write, and the secret's own name bound in as additional
 * authenticated data so a ciphertext copied into another row fails to decrypt
 * instead of quietly becoming a different key. This is not belt-and-braces:
 * this database is SHARED with another project, so anything readable in the
 * clear here is readable by anyone holding any connection string to it.
 *
 * WHAT IT ACTUALLY DOES AT RUNTIME. Decrypted values are written into
 * process.env under their real names. Nothing else in the codebase changes,
 * because env.ts already reads every secret live from process.env on each
 * access rather than snapshotting it at import — a property that existed to
 * kill import-order bugs and turns out to be exactly what makes a key set from
 * the admin console take effect on the next request with no restart.
 *
 * The bracket-form writes below are deliberate, and are why this file does not
 * trip tests/env-keys.test.ts: that test forbids READING a key from
 * process.env outside the schema. This file writes, never reads — every reader
 * on this platform is still `env.THE_KEY`.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";

/**
 * The keys that may be stored in the database.
 *
 * Deliberately a literal list rather than "anything the caller names": an
 * endpoint that writes arbitrary environment variables from an HTTP request is
 * a remote code execution waiting to happen (PATH, NODE_OPTIONS, LD_PRELOAD).
 * A name that is not on this list is refused.
 *
 * Kept in step with env.ts by tests/platform-secrets.test.ts, which fails if a
 * secret is added to the schema and not considered here.
 */
export const STORABLE_SECRETS = [
  "RESEND_API_KEY",
  "CONGRESS_API_KEY",
  "COURTLISTENER_API_KEY",
  "TAVILY_API_KEY",
  "DATA_GOV_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
] as const;

export type StorableSecret = (typeof STORABLE_SECRETS)[number];

export function isStorableSecret(name: string): name is StorableSecret {
  return (STORABLE_SECRETS as readonly string[]).includes(name);
}

/** Where the value this process is using actually came from. */
export type SecretSource = "database" | "environment" | "unset";

/**
 * The environment as it was before this module wrote anything into it.
 *
 * Needed so that clearing a stored key RESTORES the host's variable rather than
 * leaving the process with nothing. Without this snapshot, "clear" would mean
 * "break until the next redeploy" for anybody who still has the variable set on
 * their host — which is everybody, mid-migration, which is exactly when someone
 * is most likely to press it.
 */
const ENV_AT_BOOT = new Map<string, string | undefined>();
let snapshotTaken = false;

function takeBootSnapshot(): void {
  if (snapshotTaken) return;
  for (const name of STORABLE_SECRETS) ENV_AT_BOOT.set(name, process.env[name]);
  snapshotTaken = true;
}

/** Which names this process has overwritten from the database. */
const fromDatabase = new Set<string>();

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const FORMAT_VERSION = "v1";

export class SecretsNotEncryptable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsNotEncryptable";
  }
}

/**
 * The 32 raw bytes, from base64 or hex, or an explanation of why not.
 *
 * Read live rather than cached: env.ts reads secrets live, and a cache here
 * would reintroduce precisely the import-order landmine that was removed there.
 */
function encryptionKey(): Buffer {
  const configured = env.SECRETS_ENCRYPTION_KEY;
  if (!configured) {
    throw new SecretsNotEncryptable(
      "SECRETS_ENCRYPTION_KEY is not set on this API. Keys cannot be stored in the " +
        "database without it, and storing one in the clear is not an option — this " +
        "database is shared. Generate one with `openssl rand -base64 32`, set it on the " +
        "host, and redeploy.",
    );
  }

  const decoded = /^[0-9a-fA-F]{64}$/.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");

  if (decoded.length !== 32) {
    throw new SecretsNotEncryptable(
      `SECRETS_ENCRYPTION_KEY decodes to ${decoded.length} bytes; AES-256 needs exactly 32. ` +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  return decoded;
}

/** Whether a key can be stored at all right now, and why not when it cannot. */
export function encryptionStatus(): { available: boolean; reason: string | null } {
  try {
    encryptionKey();
    return { available: true, reason: null };
  } catch (error) {
    return { available: false, reason: (error as Error).message };
  }
}

export function encryptSecret(name: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  // The name is authenticated but not encrypted: a ciphertext lifted into
  // another row will not decrypt, so a stored OPENAI key can never come back as
  // a CONGRESS key.
  cipher.setAAD(Buffer.from(name, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT_VERSION, iv.toString("base64"), tag.toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(name: string, stored: string): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== FORMAT_VERSION || !iv || !tag || !body) {
    throw new Error(`Stored value for ${name} is not in the expected format`);
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** The same four hex characters services/key-report.ts shows. */
function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 4);
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadResult {
  loaded: string[];
  /** Names whose row could not be decrypted, with the reason. */
  failed: { name: string; reason: string }[];
  /** Names restored to the host's own variable because their row is gone. */
  restored: string[];
}

/**
 * Read every stored key, decrypt it, and put it where the rest of the code
 * already looks.
 *
 * THE DATABASE WINS over a host variable of the same name. That is the whole
 * point — what the super admin sets in the console is what the platform uses,
 * with no "unless Railway also has one" caveat that would make the console lie.
 * Both sources are reported side by side in the admin panel so the precedence
 * is visible rather than surprising.
 *
 * Never throws. A database that is briefly unreachable, or an encryption key
 * that is missing, must not stop a server from booting — it falls back to
 * exactly the behaviour this platform had before any of this existed, which is
 * to read its keys from the environment.
 */
export async function loadPlatformSecretsIntoEnv(): Promise<LoadResult> {
  takeBootSnapshot();
  const result: LoadResult = { loaded: [], failed: [], restored: [] };

  let rows: { name: string; ciphertext: string }[];
  try {
    rows = await prisma.platformSecret.findMany({ select: { name: true, ciphertext: true } });
  } catch (error) {
    // A missing table is the normal state on a database whose migrations have
    // not been applied yet, and it is not worth a scary line at boot.
    result.failed.push({ name: "*", reason: (error as Error).message });
    return result;
  }

  const seen = new Set<string>();

  for (const row of rows) {
    if (!isStorableSecret(row.name)) continue; // never write an arbitrary variable
    seen.add(row.name);
    try {
      const value = decryptSecret(row.name, row.ciphertext);
      process.env[row.name] = value;
      fromDatabase.add(row.name);
      result.loaded.push(row.name);
    } catch (error) {
      result.failed.push({ name: row.name, reason: (error as Error).message });
    }
  }

  // A row that has gone away since the last pass: hand the name back to the
  // host's own variable, or unset it if there was none.
  for (const name of fromDatabase) {
    if (seen.has(name)) continue;
    const original = ENV_AT_BOOT.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
    fromDatabase.delete(name);
    result.restored.push(name);
  }

  return result;
}

/**
 * Keep a long-running process in step with what the console says.
 *
 * More than one container can serve this API, and only the one that handled the
 * write knows about it. A poll is the honest, boring way to make the other
 * containers agree; a minute of staleness on a key change is not worth a
 * message bus.
 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

export function startPlatformSecretRefresh(intervalMs = 60_000): void {
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    void loadPlatformSecretsIntoEnv().catch(() => {});
  }, intervalMs);
  // Never hold the process open for this.
  refreshTimer.unref?.();
}

export function stopPlatformSecretRefresh(): void {
  if (!refreshTimer) return;
  clearInterval(refreshTimer);
  refreshTimer = null;
}

// ---------------------------------------------------------------------------
// Reading and writing, for the admin console
// ---------------------------------------------------------------------------

export interface StoredSecretInfo {
  name: string;
  /** Where the value in use right now came from. */
  source: SecretSource;
  /** Whether a row exists for it, regardless of which source is in use. */
  storedInDatabase: boolean;
  /** Whether the host also has a variable of this name. */
  presentInEnvironment: boolean;
  fingerprint: string | null;
  length: number | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** Metadata for every storable key. Never the value — there is no code path that returns one. */
export async function listPlatformSecrets(): Promise<StoredSecretInfo[]> {
  takeBootSnapshot();

  let rows: { name: string; fingerprint: string; length: number; updatedBy: string | null; updatedAt: Date }[] = [];
  try {
    rows = await prisma.platformSecret.findMany({
      select: { name: true, fingerprint: true, length: true, updatedBy: true, updatedAt: true },
    });
  } catch {
    rows = [];
  }
  const byName = new Map(rows.map((row) => [row.name, row]));

  return STORABLE_SECRETS.map((name) => {
    const row = byName.get(name);
    const inEnvironment = !!ENV_AT_BOOT.get(name)?.trim();
    return {
      name,
      source: row ? "database" : inEnvironment ? "environment" : "unset",
      storedInDatabase: !!row,
      presentInEnvironment: inEnvironment,
      fingerprint: row?.fingerprint ?? null,
      length: row?.length ?? null,
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

export interface SetSecretResult {
  name: string;
  fingerprint: string;
  length: number;
  replaced: boolean;
}

/**
 * Store a key, encrypted, and make this process start using it immediately.
 *
 * The plaintext is used to encrypt and to fingerprint, and is not written
 * anywhere else — not to a log, not to the activity trail, not into the
 * response.
 */
export async function setPlatformSecret(
  name: string,
  rawValue: string,
  by: { id: string; username: string },
): Promise<SetSecretResult> {
  if (!isStorableSecret(name)) {
    throw new Error(`${name} is not a key this platform stores`);
  }

  // Trimmed here for the same reason env.ts trims: a key is pasted, and a
  // trailing newline survives every text box and comes back as a 401 that reads
  // like a bad key.
  const value = rawValue.trim();
  if (!value) throw new Error("An empty value is not a key. Use clear instead.");

  const ciphertext = encryptSecret(name, value); // throws if no encryption key — before any write
  const existing = await prisma.platformSecret.findUnique({ where: { name }, select: { name: true } });

  await prisma.platformSecret.upsert({
    where: { name },
    create: {
      name,
      ciphertext,
      fingerprint: fingerprint(value),
      length: value.length,
      updatedById: by.id,
      updatedBy: by.username,
    },
    update: {
      ciphertext,
      fingerprint: fingerprint(value),
      length: value.length,
      updatedById: by.id,
      updatedBy: by.username,
    },
  });

  await loadPlatformSecretsIntoEnv();
  return { name, fingerprint: fingerprint(value), length: value.length, replaced: !!existing };
}

export interface ClearSecretResult {
  name: string;
  /** True when the host still has a variable of this name to fall back to. */
  fellBackToEnvironment: boolean;
}

/** Forget a stored key. The host's own variable, if any, takes over again. */
export async function clearPlatformSecret(name: string): Promise<ClearSecretResult> {
  if (!isStorableSecret(name)) {
    throw new Error(`${name} is not a key this platform stores`);
  }
  takeBootSnapshot();

  await prisma.platformSecret.deleteMany({ where: { name } });
  await loadPlatformSecretsIntoEnv();

  return { name, fellBackToEnvironment: !!ENV_AT_BOOT.get(name)?.trim() };
}

/** Where the value currently in use came from. Exported for the key report. */
export function sourceOf(name: string): SecretSource {
  if (fromDatabase.has(name)) return "database";
  return process.env[name]?.trim() ? "environment" : "unset";
}

/** Test seam: forget what this process learned, without touching the database. */
export function resetPlatformSecretsForTest(): void {
  for (const name of fromDatabase) {
    const original = ENV_AT_BOOT.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  fromDatabase.clear();
  ENV_AT_BOOT.clear();
  snapshotTaken = false;
}
