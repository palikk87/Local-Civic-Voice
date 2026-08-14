/**
 * Object storage for user-uploaded media.
 *
 * Two backends, one interface:
 *
 *   local  — writes under UPLOADS_DIR. The default, and correct for a local
 *            checkout. NOT correct for a deployment: on any host with an
 *            ephemeral filesystem, every image, video and audio clip a user has
 *            posted 404s after the next deploy while the Media rows still point
 *            at them.
 *
 *   s3     — any S3-compatible bucket. Signed with SigV4 over plain fetch
 *            (aws4fetch, ~5 KB) rather than the AWS SDK, because the SDK is
 *            ~20 MB of dependency to issue three request types.
 *
 * "S3-compatible" is the whole point. The same code and the same env vars run
 * against Cloudflare R2, Backblaze B2, MinIO on a VPS, AWS S3, DigitalOcean
 * Spaces, Wasabi, or Supabase Storage's S3 endpoint. Nothing here knows or
 * cares which — switching providers is editing environment variables, not code.
 * That is deliberate: media is the one thing in this app that cannot be
 * regenerated from an upstream source, so it must never be locked to a vendor.
 *
 * Provider-specific quirks worth knowing when filling in the env vars:
 *   - R2 has no meaningful region; use `auto`, and take the endpoint from the
 *     bucket's S3 API URL.
 *   - MinIO and most self-hosted gateways need S3_FORCE_PATH_STYLE=true.
 *   - Buckets must be publicly readable, or MEDIA_PUBLIC_URL must front them
 *     with a CDN that is. This module does not issue signed read URLs.
 */

import { AwsClient } from "aws4fetch";
import { mkdir, writeFile, unlink } from "fs/promises";
import { dirname, join } from "path";

export type StorageDriver = "local" | "s3";

export interface StoredObject {
  /** Key within the bucket / path within UPLOADS_DIR, e.g. "images/abc.jpg". */
  key: string;
  /** Absolute URL the clients should load. */
  url: string;
}

function envDriver(): StorageDriver {
  const raw = (process.env.MEDIA_STORAGE ?? "local").toLowerCase();
  if (raw === "s3" || raw === "local") return raw;
  throw new Error(`MEDIA_STORAGE must be "local" or "s3", got "${raw}"`);
}

export const storageDriver: StorageDriver = envDriver();

// ---------------------------------------------------------------- local disk

export const UPLOADS_DIR = process.env.UPLOADS_DIR || join(process.cwd(), "uploads");

// --------------------------------------------------------------------- S3

interface S3Config {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  publicUrl: string;
}

let cachedS3: { config: S3Config; client: AwsClient } | null = null;

function s3(): { config: S3Config; client: AwsClient } {
  if (cachedS3) return cachedS3;

  const required = {
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    // Loud, not silent. The alternative — quietly falling back to local disk —
    // is how uploads get written to a container that is about to be replaced.
    throw new Error(
      `MEDIA_STORAGE=s3 but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        `Set them, or set MEDIA_STORAGE=local for a local checkout.`,
    );
  }

  const endpoint = required.S3_ENDPOINT!.replace(/\/+$/, "");
  const bucket = required.S3_BUCKET!;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true";

  const config: S3Config = {
    bucket,
    endpoint,
    region: process.env.S3_REGION || "auto",
    accessKeyId: required.S3_ACCESS_KEY_ID!,
    secretAccessKey: required.S3_SECRET_ACCESS_KEY!,
    forcePathStyle,
    // Where browsers fetch the object. Defaults to the API endpoint, which is
    // right for R2/MinIO with public buckets; set MEDIA_PUBLIC_URL when a CDN
    // or custom domain fronts the bucket.
    publicUrl: (process.env.MEDIA_PUBLIC_URL || (forcePathStyle ? `${endpoint}/${bucket}` : endpoint)).replace(/\/+$/, ""),
  };

  cachedS3 = {
    config,
    client: new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: "s3",
    }),
  };
  return cachedS3;
}

function s3ObjectUrl(config: S3Config, key: string): string {
  return config.forcePathStyle
    ? `${config.endpoint}/${config.bucket}/${key}`
    : `${config.endpoint}/${key}`;
}

// ------------------------------------------------------------------ public API

/** Absolute URL for a stored key, without touching the network. */
export function publicUrlFor(key: string): string {
  const clean = key.replace(/^\/+/, "");
  if (storageDriver === "s3") {
    return `${s3().config.publicUrl}/${clean}`;
  }
  const base = (process.env.MEDIA_PUBLIC_URL || process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/uploads/${clean}`;
}

/** Store bytes and return the key plus the URL clients should load. */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<StoredObject> {
  const clean = key.replace(/^\/+/, "");

  if (storageDriver === "local") {
    const path = join(UPLOADS_DIR, clean);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key: clean, url: publicUrlFor(clean) };
  }

  const { config, client } = s3();
  const response = await client.fetch(s3ObjectUrl(config, clean), {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
  });
  if (!response.ok) {
    // Include the body: S3-compatible services put the actionable part of the
    // failure (SignatureDoesNotMatch, NoSuchBucket, AccessDenied) in the XML,
    // not the status line.
    const detail = await response.text().catch(() => "");
    throw new Error(`S3 PUT ${clean} failed: ${response.status} ${response.statusText} ${detail}`.trim());
  }
  return { key: clean, url: publicUrlFor(clean) };
}

/** Delete a stored object. Missing objects are not an error. */
export async function deleteObject(key: string): Promise<void> {
  const clean = key.replace(/^\/+/, "");

  if (storageDriver === "local") {
    await unlink(join(UPLOADS_DIR, clean)).catch(() => undefined);
    return;
  }

  const { config, client } = s3();
  const response = await client.fetch(s3ObjectUrl(config, clean), { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error(`S3 DELETE ${clean} failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Check the configuration is usable, at boot, before a user finds out.
 *
 * Returns a human-readable status rather than throwing so the caller can decide
 * whether a misconfiguration should be fatal.
 */
export async function checkStorage(): Promise<{ ok: boolean; driver: StorageDriver; detail: string }> {
  if (storageDriver === "local") {
    try {
      await mkdir(UPLOADS_DIR, { recursive: true });
      return {
        ok: true,
        driver: "local",
        detail:
          `writing to ${UPLOADS_DIR}. This survives a redeploy only if it is a persistent volume — ` +
          `set MEDIA_STORAGE=s3 for a deployment.`,
      };
    } catch (error) {
      return { ok: false, driver: "local", detail: `cannot create ${UPLOADS_DIR}: ${String(error)}` };
    }
  }

  try {
    const { config, client } = s3();
    // HEAD the bucket: cheap, and fails distinctly for bad credentials (403)
    // versus a bucket that does not exist (404).
    const url = config.forcePathStyle ? `${config.endpoint}/${config.bucket}` : config.endpoint;
    const response = await client.fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return {
        ok: false,
        driver: "s3",
        detail: `bucket ${config.bucket} returned ${response.status} ${response.statusText}`,
      };
    }
    return { ok: true, driver: "s3", detail: `bucket ${config.bucket} at ${config.endpoint}` };
  } catch (error) {
    return { ok: false, driver: "s3", detail: error instanceof Error ? error.message : String(error) };
  }
}
