/**
 * THE BOT TEST ON SIGN-UP — Constitution Article I §3.
 *
 * "Only verified humans may vote."
 *
 * What stood behind that was a confirmed email address, which proves somebody
 * can read an inbox. An inbox is not a person: they are free, scriptable, and
 * available a thousand at a time. Every other guarantee this platform makes
 * rests on the Pulse being a count of citizens rather than of accounts, so this
 * is the gate under all of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT SILENTLY OPTIONAL.
 *
 * The obvious way to write this is "if no key is configured, let everybody
 * through" — and then the platform claims verified humans while checking
 * nothing, forever, because nobody is ever told. That is the exact failure this
 * project keeps finding in its own past: a feature that reports success while
 * doing nothing.
 *
 * So when no key is configured the state has a NAME — `unconfigured` — it is
 * returned by the health endpoint and shown in the admin key panel, and the
 * sign-up route says which of the two it did. Sign-up still works, because
 * refusing every new citizen until an operator pastes a key would be a worse
 * failure than the one being fixed. But nothing anywhere reports that a bot
 * test happened when it did not.
 *
 * WHY CLOUDFLARE TURNSTILE. It was the owner's choice. It also needs no account
 * from the visitor, sets no advertising cookie and requires no puzzle from most
 * people, which matters for a platform whose whole argument is that taking part
 * should be easy.
 *
 * FAIL CLOSED ON A BAD TOKEN, OPEN ON A BROKEN PROVIDER. A token that is
 * present and rejected is refused: that is the check working. A configured
 * check whose provider is unreachable lets the person through and says so in
 * the logs, because Cloudflare having a bad afternoon must not stop a country
 * signing up — and an outage is loud, whereas a permanently disabled gate is
 * not.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { env } from "../env";

/** Cloudflare's verification endpoint. */
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** How long to wait on the provider before letting the person through. */
const TIMEOUT_MS = 5_000;

export type HumanCheckOutcome =
  /** A challenge was solved and Cloudflare confirmed it. */
  | { ok: true; checked: true; state: "passed" }
  /** No key is configured. Nothing was checked, and this says so. */
  | { ok: true; checked: false; state: "unconfigured" }
  /** The check is configured but the provider could not be reached. */
  | { ok: true; checked: false; state: "provider_unreachable"; detail: string }
  /** A token was required and was missing, or Cloudflare rejected it. */
  | { ok: false; checked: true; state: "failed"; detail: string };

/** True when both halves of the key pair are present. */
export function humanCheckConfigured(): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY);
}

/**
 * The site key, for the page. Public by design — it is printed into the HTML
 * of every sign-up form Cloudflare has ever served.
 */
export function humanCheckSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY ?? null;
}

/**
 * Check one token.
 *
 * `remoteIp` is passed through when known because Cloudflare uses it to score
 * the challenge; it is never stored here.
 */
export async function checkHuman(
  token: string | undefined | null,
  remoteIp?: string | null,
): Promise<HumanCheckOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || !env.TURNSTILE_SITE_KEY) {
    return { ok: true, checked: false, state: "unconfigured" };
  }

  if (!token) {
    return {
      ok: false,
      checked: true,
      state: "failed",
      detail: "No challenge was completed.",
    };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  let response: Response;
  try {
    response = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // The provider is down or slow. Let them in, and be loud about it.
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[human-check] could not reach Cloudflare, letting sign-up through: ${detail}`);
    return { ok: true, checked: false, state: "provider_unreachable", detail };
  }

  if (!response.ok) {
    const detail = `siteverify returned ${response.status}`;
    console.error(`[human-check] ${detail}, letting sign-up through`);
    return { ok: true, checked: false, state: "provider_unreachable", detail };
  }

  const verdict = (await response.json().catch(() => null)) as
    | { success?: boolean; "error-codes"?: string[] }
    | null;

  if (verdict?.success === true) {
    return { ok: true, checked: true, state: "passed" };
  }

  return {
    ok: false,
    checked: true,
    state: "failed",
    detail: (verdict?.["error-codes"] ?? []).join(", ") || "the challenge was not accepted",
  };
}

/** What the sign-up route says when a challenge is required and not passed. */
export const HUMAN_CHECK_REQUIRED = {
  error: "Complete the check that you are a person",
  code: "human_check_required",
  reason:
    "This platform counts citizens, not accounts. Every guarantee it makes about the Pulse " +
    "depends on one person being one voice, so a sign-up has to prove a person is here.",
} as const;
