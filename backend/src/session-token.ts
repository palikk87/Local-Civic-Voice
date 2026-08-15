/**
 * Session tokens for the admin console and the B2B portal.
 *
 * Both routers used to build their own out of a timestamp and Math.random():
 *
 *   `admin_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
 *
 * Neither half of that is unpredictable.
 *
 * `Date.now()` is not secret at all. An attacker who can see when somebody
 * logged in — a support ticket, a deploy log, a "signed in just now" banner —
 * knows it to within a few milliseconds, and can simply enumerate a window of
 * a few thousand values.
 *
 * `Math.random()` is worse than it looks. V8 implements it with xorshift128+,
 * which is fast and well-distributed and completely non-cryptographic: the
 * generator's 128-bit internal state can be solved for from a handful of
 * consecutive outputs, after which every past and future value it produces is
 * known exactly. Published attacks do this with a few dozen samples. A
 * login endpoint that returns a token containing a fresh `Math.random()` on
 * demand is a machine for handing out those samples. And `.toString(36)`
 * then truncated to 13 characters keeps roughly 67 bits at absolute best —
 * but the bits are not independent of each other, so the real figure is the
 * state, not the length.
 *
 * The fix is not more entropy from the same source. It is a different source:
 * `randomBytes` is Node's CSPRNG, seeded from the operating system, and its
 * output cannot be extended backwards or forwards from previous outputs.
 *
 * 32 bytes, base64url. That is 256 bits, encoded in 43 characters with no
 * padding and nothing needing escaping in a header, a URL, or a database
 * column. There is no meaningful cost to being generous here, and 128 bits is
 * the usual floor for a bearer credential.
 *
 * The prefix carries no security weight and is not parsed by anything — it is
 * there so a token in a log line or a database row says what it opens. The
 * timestamp is deliberately NOT reinstated in any form: `createdAt` is a column
 * on both session tables, so putting the issue time in the token itself would
 * publish it to whoever holds the token while adding nothing.
 */
import { randomBytes } from "node:crypto";

/** 256 bits from the OS CSPRNG, base64url-encoded. */
function randomTokenSuffix(): string {
  return randomBytes(32).toString("base64url");
}

/** Token for an admin console session. Stored as AdminSession.token. */
export function generateAdminToken(): string {
  return `admin_${randomTokenSuffix()}`;
}

/** Token for a B2B portal session. Stored as B2BSession.token. */
export function generateB2BToken(): string {
  return `b2b_${randomTokenSuffix()}`;
}
