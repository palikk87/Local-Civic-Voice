/**
 * One policy for "delete the stored bytes, or do not delete the row".
 *
 * There are four places that destroy something owning media — a user deleting
 * their own post, a user deleting a single media item, an admin deleting a
 * post, and an admin deleting a user — and they had four different behaviours,
 * ranging from "delete the objects and swallow any error" to "do not delete the
 * objects at all". Two different answers to the same question is worse than
 * either answer, so the answer lives here once.
 *
 * THE POLICY: objects first, row second, and refuse to delete the row if the
 * objects will not go.
 *
 * The order is forced by where the key lives. A key exists in exactly one
 * place, the Media row, and Media.postId is `onDelete: Cascade` — so deleting
 * the owner destroys the only record of which objects existed. Do that before
 * the bytes are gone and nothing can ever find them again short of listing the
 * bucket and diffing it against the database.
 *
 * The direction is forced by what the bucket is. services/storage.ts issues no
 * signed URLs and the bucket is publicly readable, so the key IS the access
 * control: an object that outlives its row stays fetchable by anyone holding
 * the URL, while the app reports the thing deleted. Failing the other way — the
 * row survives, the caller sees an error — is visible and retryable, and retry
 * converges because deleteObject treats an already-missing object as success.
 */
import { deleteObjects } from "./storage";

/** The subset of a Media row that names stored bytes. */
export interface MediaObjectRef {
  url: string;
  thumbnailUrl: string | null;
}

/**
 * Every storage key a set of media rows points at.
 *
 * Two per row for a video (the file and its generated thumbnail), one
 * otherwise. Media is never shared — Media.postId is a single nullable FK, so a
 * row belongs to at most one post — so there is nothing to reference-count and
 * these keys are safe to delete outright.
 */
export function mediaObjectKeys(rows: MediaObjectRef[]): string[] {
  return rows.flatMap((row) => (row.thumbnailUrl ? [row.url, row.thumbnailUrl] : [row.url]));
}

export type PurgeResult = { ok: true; deleted: number } | { ok: false; message: string };

/**
 * Remove the stored bytes for these rows, or report why the caller must stop.
 *
 * `context` identifies what is being deleted, for the log line — a storage
 * failure is an operator problem (credentials, permissions, a bucket that
 * moved) and the log is the only place it can be diagnosed from, so every key
 * that failed is named there.
 *
 * On failure the caller must NOT delete its row. On success it must, because
 * the bytes are already gone.
 */
export async function purgeMediaObjects(
  rows: MediaObjectRef[],
  context: string,
): Promise<PurgeResult> {
  const keys = mediaObjectKeys(rows);
  if (keys.length === 0) return { ok: true, deleted: 0 };

  const { deleted, failed } = await deleteObjects(keys);

  if (failed.length > 0) {
    console.error(
      `[Media] Refusing to delete ${context}: ${failed.length} of ${keys.length} ` +
        `stored objects could not be removed. ` +
        failed.map((f) => `${f.key}: ${f.error}`).join("; "),
    );
    return {
      ok: false,
      message: `Could not remove ${failed.length} stored file(s). Nothing was deleted; please try again.`,
    };
  }

  return { ok: true, deleted: deleted.length };
}
