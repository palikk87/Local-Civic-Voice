/**
 * The one way this codebase talks to CourtListener.
 *
 * MEASURED against the live API, because every rule below is one it enforces:
 *
 *   /api/rest/v4/search/      answers 200 with no token
 *   /api/rest/v4/opinions/…   answers 401 with no token
 *   the sixth call in a minute answers
 *     {"detail":"Request was throttled. Rate limit exceeded: 5/min.
 *                Expected available in 2 seconds."}
 *
 * FIVE REQUESTS A MINUTE is the fact that shapes everything here. It is not a
 * daily allowance that can be spent freely and recovered overnight; it is a
 * ceiling a single reader can hit by searching twice. So every caller budgets
 * its requests, and a 429 is waited out rather than reported as "nothing found"
 * — which is what it used to become, turning a published Supreme Court opinion
 * two seconds away into a document that does not exist.
 *
 * Shared rather than copied. Two implementations of a throttle policy is one
 * implementation and one bug.
 */

/** How many times to wait out a throttle before giving up. */
const THROTTLE_RETRIES = 2;
/** Never sleep longer than this on one throttle, whatever the API asks for. */
const MAX_WAIT_MS = 30_000;

export interface CourtListenerOptions {
  /** Wall-clock moment this work must stop by. */
  deadlineAt: number;
  /** Token. Search works without one; the opinion endpoints do not. */
  apiKey?: string | undefined;
  /** Named in the log so a throttle says which feature paid for it. */
  label: string;
}

export function courtListenerHeaders(apiKey?: string): Record<string, string> {
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Token ${apiKey}` } : {}),
  };
}

/**
 * One CourtListener request, with the throttle honoured and every failure named.
 *
 * Returns null for every failure. The caller's job is to have a next move, not
 * to distinguish a 500 from a 404 — but the log always says which it was,
 * because "no results" and "we were rate limited" look identical from outside
 * and mean completely different things.
 */
export async function fetchCourtListener<T>(
  url: string,
  { deadlineAt, apiKey, label }: CourtListenerOptions,
): Promise<T | null> {
  for (let attempt = 0; attempt <= THROTTLE_RETRIES; attempt++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) return null;

    try {
      const response = await fetch(url, {
        headers: courtListenerHeaders(apiKey),
        signal: AbortSignal.timeout(Math.min(remaining, 15_000)),
      });

      if (response.status === 429) {
        const detail = await response.text();
        const seconds = Number(detail.match(/available in ([\d.]+) second/i)?.[1] ?? 5);
        const waitMs = Math.ceil(Math.min(seconds, 30) * 1000) + 500;

        if (attempt === THROTTLE_RETRIES || deadlineAt - Date.now() < waitMs + 2_000) {
          console.warn(
            `[courtlistener] ${label}: throttled with no time left to wait — ${detail.slice(0, 120)}`,
          );
          return null;
        }
        console.warn(
          `[courtlistener] ${label}: throttled, waiting ${Math.round(waitMs / 1000)}s as instructed`,
        );
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, MAX_WAIT_MS)));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        console.error(
          `[courtlistener] ${label}: COURTLISTENER_API_KEY rejected with HTTP ${response.status}. ` +
            `The key is set but not accepted.`,
        );
        return null;
      }

      if (!response.ok) {
        console.warn(`[courtlistener] ${label}: HTTP ${response.status}`);
        return null;
      }

      return (await response.json()) as T;
    } catch (error) {
      console.warn(
        `[courtlistener] ${label}: request failed — ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
  return null;
}
