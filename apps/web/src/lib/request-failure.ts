/**
 * "It is gone" and "I could not ask" are different sentences.
 *
 * WHY THIS EXISTS, measured rather than assumed. With the API host switched off
 * and every one of the fifty routes opened in a browser
 * (apps/web/scripts/backend-down-check.mjs), forty-two pages said nothing about
 * the outage and several said something untrue: a profile read "This account
 * isn't here — the profile may have been deleted", a post read "It may have
 * been deleted, or it may never have existed", a hashtag read "Nothing under
 * this tag yet". None of that had happened. The server was simply unreachable.
 *
 * The cause was one expression, repeated: `isError || !data`. React Query
 * reports a 404 and a dead socket through the same flag, so the copy written
 * for the first was shown for both — and a platform whose whole promise is that
 * it never states what it does not know was telling readers that real things
 * had been deleted.
 *
 * `api.ts` already carries what is needed to tell them apart: a response the
 * server answered throws ApiError with its status, and a request that never
 * arrived throws the browser's own TypeError with no status at all. This is
 * that distinction, named once, so no page has to make it by hand.
 */

import { ApiError } from "./api";

/** The server answered, and said this does not exist. */
export function isMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** We could not ask, or the server could not answer. Says nothing about the thing itself. */
export function isUnreachable(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ApiError) {
    // 5xx is the server failing, not the record being absent. 0 should not
    // happen through api.ts, but a proxy can produce one and it is not a 404.
    return error.status >= 500 || error.status === 0;
  }
  // fetch() rejects with a TypeError when the request never completed: DNS
  // failure, refused connection, dropped socket, offline device.
  return true;
}

/**
 * What to tell somebody, given a failed query and what they were looking for.
 *
 * One sentence for the thing being gone, one for the service being gone, and
 * never the first when the second is true. `subject` is the noun as it should
 * read mid-sentence: "this post", "this account", "this bill".
 */
export function failureMessage(
  error: unknown,
  subject: string,
): { title: string; detail: string; canRetry: boolean } {
  if (isMissing(error)) {
    return {
      title: `${subject[0]!.toUpperCase()}${subject.slice(1)} isn't here`,
      detail: "It may have been deleted, or the link may be wrong.",
      canRetry: false,
    };
  }
  return {
    title: `Couldn't load ${subject}`,
    detail: "We can't reach the server right now. Nothing has been lost — try again in a moment.",
    canRetry: true,
  };
}
