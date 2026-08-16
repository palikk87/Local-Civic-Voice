/**
 * Password verification that takes the same time whether or not the account
 * exists.
 *
 * THE PROBLEM. The obvious shape of a login handler is:
 *
 *   const user = await findUser(name);
 *   if (!user) return 401;              // returns in microseconds
 *   if (!await verify(user.hash, pw)) return 401;   // returns in ~100ms
 *
 * Both answers are "invalid credentials", but they do not cost the same. The
 * first skips the key-derivation function entirely; the second runs scrypt. The
 * gap is three orders of magnitude and is trivially measurable over a network,
 * so response time answers a question the status code deliberately refuses to:
 * does this account exist?
 *
 * For a consumer sign-up flow that is a known trade-off. For an ADMIN console
 * it is worse, because the answer tells an attacker which of your users hold
 * elevated roles — that is, exactly which accounts are worth attacking. The
 * same applies to the B2B portal, whose two accounts read every citizen's
 * aggregated sentiment.
 *
 * THE FIX. Always run the KDF. When there is no stored hash to check against,
 * check against a real one that nobody has. The work is identical, the answer
 * is always false, and the timing says nothing.
 *
 * The dummy hash is built once, lazily. At import it would add a scrypt run to
 * every boot including the boots that never see a failed login; the first bad
 * username after a restart pays for it instead, and every one after that does
 * not.
 */
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";

let dummyHash: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyHash;
}

/**
 * True only if `hash` exists and `password` matches it.
 *
 * Pass the stored hash, or null/undefined when the account was not found or has
 * no password on file. Both of those cases still pay for a verification, which
 * is the entire point — do NOT short-circuit them at the call site.
 *
 * `label` names the caller in the log if a stored hash turns out to be
 * unparseable, which is an operator problem (a corrupted or foreign-format row)
 * rather than a caller problem, and should not surface as an opaque 500.
 */
export async function verifyPasswordOrDummy(
  hash: string | null | undefined,
  password: string,
  label: string,
): Promise<boolean> {
  try {
    return await verifyPassword({ hash: hash ?? (await getDummyHash()), password });
  } catch (error) {
    console.error(`[${label}] Password verification failed:`, error);
    return false;
  }
}
