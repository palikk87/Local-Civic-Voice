/**
 * Only verified human beings may contribute to the Pulse.
 *
 * Constitution Article I, Section 3 says exactly that, and it was marked
 * `enforcedInCode: true` while nothing enforced it: `emailVerified` existed on
 * the User table, was never set by anything, and was never read by anything.
 * Bill of Rights Article III lists "Anti-bot verification" as a principle and
 * "No 'Dark Money' or bot-driven influence shall be permitted to obscure the
 * true will of the people" as the reason for it.
 *
 * WHAT THIS IS, HONESTLY. A code sent to an email address raises the cost of
 * running a thousand accounts from nothing to something. It does not make it
 * impossible — disposable inboxes exist, and anyone determined enough will get
 * through. It is a speed bump on the cheapest attack, not proof of personhood,
 * and it should not be described to citizens as more than that. Real proof of
 * personhood needs an identity provider and a decision about what counts as
 * citizenship here; both are the platform owner's to make.
 *
 * WHAT IS GATED: writing to the public record — voting, delegating, posting,
 * commenting, reposting. Everything else stays open. Somebody who has not
 * finished signing up can still read every law, every brief, every tally and
 * every argument, because a platform that hides the government's business
 * behind a verification wall has misunderstood which part is the public good.
 */

import { prisma } from "../prisma";

/** The shape every route already has from the session. */
interface SessionUser {
  id: string;
  emailVerified?: boolean | null;
}

export const VERIFICATION_REQUIRED = {
  error: "Verify your email before taking part",
  /**
   * A stable code, so the clients can tell this apart from every other 403 and
   * offer the "send me another code" button rather than a dead end.
   */
  code: "email_verification_required",
  reason:
    "Only verified people can vote, delegate, or post here — it is how the Pulse stays a count of citizens rather than of accounts. Reading stays open.",
} as const;

/**
 * True when this account may write to the public record.
 *
 * Reads the database rather than the session: a session minted before somebody
 * verified would otherwise keep them locked out until it expired, which is a
 * miserable way to be told the code worked.
 */
export async function isVerified(user: SessionUser | null | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.emailVerified === true) return true;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { emailVerified: true },
  });
  return row?.emailVerified === true;
}
