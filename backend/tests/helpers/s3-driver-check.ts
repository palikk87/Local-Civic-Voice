/**
 * Exercises the s3 branch of services/storage.ts against a stub bucket.
 *
 * WHY A SUBPROCESS. `storageDriver` is decided once, at module import, from
 * MEDIA_STORAGE. The rest of the suite runs with the local driver, so the only
 * way to reach the s3 branch in the same run is a fresh process with different
 * environment. Spawning one is honest about that; monkey-patching the module
 * would test the patch.
 *
 * WHY A STUB RATHER THAN A REAL BUCKET. Nothing here is mocked except the
 * bucket's storage: the requests are real HTTP, signed by the real aws4fetch
 * SigV4 path, handled by the real code in storage.ts. What the stub controls is
 * the response, which is the part a real bucket will not produce on demand — a
 * test cannot ask Cloudflare to fail a DELETE.
 *
 * Prints one JSON line and exits 0 on success, 1 on failure, so the caller can
 * assert on the result rather than parsing prose.
 */

const objects = new Map<string, Uint8Array>();

/** Keys the stub should refuse to delete, to exercise the failure path. */
const refuseDelete = new Set<string>();

const bucket = "test-bucket";

const stub = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    // Path style: /<bucket>/<key...>
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

    if (path === bucket || path === "") {
      // The bucket HEAD that checkStorage() uses.
      return new Response(null, { status: 200 });
    }

    const key = path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path;

    if (request.method === "PUT") {
      objects.set(key, new Uint8Array(await request.arrayBuffer()));
      return new Response(null, { status: 200 });
    }

    if (request.method === "DELETE") {
      if (refuseDelete.has(key)) {
        return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
      }
      if (!objects.has(key)) return new Response(null, { status: 404 });
      objects.delete(key);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" || request.method === "HEAD") {
      const body = objects.get(key);
      if (!body) return new Response(null, { status: 404 });
      return new Response(request.method === "HEAD" ? null : body, { status: 200 });
    }

    return new Response(null, { status: 405 });
  },
});

const endpoint = `http://127.0.0.1:${stub.port}`;

process.env.MEDIA_STORAGE = "s3";
process.env.S3_BUCKET = bucket;
process.env.S3_ENDPOINT = endpoint;
process.env.S3_REGION = "auto";
process.env.S3_ACCESS_KEY_ID = "stub-access-key";
process.env.S3_SECRET_ACCESS_KEY = "stub-secret-key";
process.env.S3_FORCE_PATH_STYLE = "true";

// Imported after the environment is set, because storageDriver is read at import.
const { storageDriver, putObject, deleteObjects, checkStorage } = await import(
  "../../src/services/storage"
);

const results: Record<string, unknown> = {};
const failures: string[] = [];

function check(name: string, condition: boolean, detail: unknown): void {
  results[name] = detail;
  if (!condition) failures.push(`${name}: ${JSON.stringify(detail)}`);
}

check("driver", storageDriver === "s3", storageDriver);

const health = await checkStorage();
check("checkStorage", health.ok && health.driver === "s3", health);

// Store, then confirm the stub really holds the bytes.
const key = "images/s3-driver-check.png";
const bytes = new Uint8Array([1, 2, 3, 4]);
const stored = await putObject(key, bytes, "image/png");
check("put.key", stored.key === key, stored.key);
check("put.landed", objects.has(key), Array.from(objects.keys()));

// Delete it, then confirm it is gone from the stub — the observation, not the
// return value.
const deleteOk = await deleteObjects([key]);
check("delete.reportedOk", deleteOk.failed.length === 0, deleteOk);
check("delete.objectGone", !objects.has(key), Array.from(objects.keys()));

// A key that is not there must not be an error: callers retry after a partial
// failure, and a retry has to be able to finish.
const deleteMissing = await deleteObjects(["images/never-existed.png"]);
check("deleteMissing.tolerated", deleteMissing.failed.length === 0, deleteMissing);

// A bucket that refuses must surface as a reported failure, not an exception
// and not a silent success.
const refusedKey = "images/s3-driver-refused.png";
await putObject(refusedKey, bytes, "image/png");
refuseDelete.add(refusedKey);
const deleteRefused = await deleteObjects([refusedKey]);
check("deleteRefused.reported", deleteRefused.failed.length === 1, deleteRefused);
check(
  "deleteRefused.namesKey",
  deleteRefused.failed[0]?.key === refusedKey && /403/.test(deleteRefused.failed[0]?.error ?? ""),
  deleteRefused.failed[0],
);
check("deleteRefused.objectRemains", objects.has(refusedKey), Array.from(objects.keys()));

// A mixed batch reports only the bad one, and still deletes the good one.
const goodKey = "images/s3-driver-good.png";
await putObject(goodKey, bytes, "image/png");
const mixed = await deleteObjects([goodKey, refusedKey]);
check("mixed.oneFailed", mixed.failed.length === 1 && mixed.deleted.length === 1, mixed);
check("mixed.goodGone", !objects.has(goodKey), Array.from(objects.keys()));

stub.stop(true);

console.log(JSON.stringify({ ok: failures.length === 0, failures, results }));
process.exit(failures.length === 0 ? 0 : 1);
