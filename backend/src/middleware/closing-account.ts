/**
 * AN ACCOUNT THAT HAS ASKED TO BE CLOSED IS CLOSED, EVEN WHILE IT IS STILL HERE.
 *
 * When somebody with a live proceeding closes their account, the record is held
 * until that proceeding is decided (services/account-closure.ts). The holding is
 * for everyone else's benefit — the people voting on their articles, or being
 * judged alongside them, need somebody to look at. It is not a grace period.
 *
 * The owner was explicit: "the deletion cannot be undone just because the
 * proceedings are ongoing. The limbo profile is for the benefit of others, not
 * themselves. They chose to delete and that's a real lasting choice."
 *
 * So the account is over from the moment they confirm. This middleware is what
 * makes that true rather than merely stated: no acting, no writing, nothing
 * touching their record. Their history and Trust Score are frozen exactly where
 * they were, because nothing can happen that would move them.
 *
 * WHY IT IS DONE HERE AND NOT IN THE SCREENS. A client that hides the buttons is
 * a suggestion, and a suggestion is bypassed by anybody who opens curl. The same
 * reasoning as middleware/sequestration.ts next door, and for the same reason:
 * if the rule only holds in the app then the rule does not hold.
 *
 * READING IS NOT BLOCKED. The point of the hold is that the profile stays
 * legible, so GET requests pass. What is refused is anything that would write.
 */

import type { MiddlewareHandler } from "hono";
import { isClosing } from "../services/account-closure";

/**
 * The two things a closing account may still do.
 *
 * Deliberately shorter than sequestration's list. Somebody who has closed their
 * account has no settings left to change and nothing left to recover — the
 * account is gone as far as they are concerned, and offering a password form
 * would suggest otherwise.
 */
const STILL_OPEN = [
  // Signing out. Nobody may be held inside a session they have already ended,
  // and their sessions are deleted at the moment of closing anyway — this is
  // here so the sign-out call itself cannot 423 on the way past.
  "/api/auth/",
  // Health and version, which are not user data at all.
  "/health",
];

/** Methods that only read. Reading their own page back is not an action. */
const READS = ["GET", "HEAD", "OPTIONS"];

export const closingAccount: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as { id: string } | null;
  if (!user) return next();

  if (READS.includes(c.req.method)) return next();
  if (STILL_OPEN.some((prefix) => c.req.path.startsWith(prefix))) return next();

  const since = await isClosing(user.id);
  if (!since) return next();

  // 410 Gone, not 403 and not 423. This is not a permission the account lacks
  // and not a duty it is discharging — the account has ended, and the only
  // reason the record is still here is other people's business with it. A
  // client should say "this account is closed", never "try again later".
  return c.json(
    {
      error:
        "This account is closed. It is being kept visible only until the proceedings it is " +
        "part of have been decided, and it cannot be used or reopened.",
      closing: true,
      closedAt: since.toISOString(),
    },
    410,
  );
};
