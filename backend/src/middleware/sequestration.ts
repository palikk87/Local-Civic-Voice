/**
 * SEQUESTRATION — Constitution Article IV, enforced where it has to be.
 *
 * The moment a juror accepts a summons, the platform closes around the case:
 * no feed, no timeline, no messages, until they have cast their vote. You said
 * yes; you decide now.
 *
 * THIS IS THE SERVER'S JOB, NOT THE SCREEN'S. A client that hides the rest of
 * the app is a suggestion, and a suggestion is bypassed by anybody who opens a
 * second tab or points curl at the API. If the rule only holds in the app then
 * the rule does not hold, and the whole duty is theatre.
 *
 * THREE THINGS STAY OPEN, AND EACH FOR A REASON:
 *
 *   - signing out and everything under /api/auth. Nobody may be held inside a
 *     session they want to leave, and a person who cannot sign out of an app is
 *     not a juror, they are a hostage.
 *   - account settings. Changing a password or an email address while
 *     sequestered has to stay possible; those are the controls somebody reaches
 *     for when something has gone wrong.
 *   - the bug reporter. If the decision page itself is broken, they have to be
 *     able to say so — otherwise the one failure that traps somebody is the one
 *     they cannot report.
 *
 * And of course the case itself, or the duty could not be discharged.
 *
 * THE RELEASE VALVE IS NOT HERE. It is in the seat row: `sequesteredBy` only
 * counts an acceptance from the last twenty-four hours, so somebody who accepts
 * and then loses their phone has their account back the next day whether or not
 * any sweep ran. A middleware that depended on a background job having fired
 * would be a lockout waiting for an outage.
 */

import type { MiddlewareHandler } from "hono";
import { sequesteredBy } from "../services/jury";

/**
 * Paths a sequestered juror may still reach.
 *
 * Prefixes, matched against the request path. Deliberately short: every entry
 * is a hole in a duty, so each one earns its place in the comment above.
 */
const ALWAYS_OPEN = [
  // Sign out, session checks, password and email changes.
  "/api/auth/",
  // The case they are sitting on, and the summons list that leads to it.
  "/api/juries",
  // "Who am I", plus account settings — changing a password or an email address
  // lives under here (PATCH /api/users/me, POST /api/users/me/password), and
  // those are the controls somebody reaches for when something has gone wrong.
  "/api/users/me",
  // "The decision page is broken."
  "/api/bug-reports",
  // Health and version, which are not user data at all.
  "/health",
];

export const sequestration: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as { id: string } | null;
  if (!user) return next();

  const path = c.req.path;
  if (ALWAYS_OPEN.some((prefix) => path.startsWith(prefix))) return next();

  const juryId = await sequesteredBy(user.id);
  if (!juryId) return next();

  // 423 Locked, not 403. This is not a permission the account lacks — it is a
  // duty it is currently discharging, and the difference matters to a client
  // deciding what to show.
  return c.json(
    {
      error:
        "You accepted a jury summons. The platform is waiting on your decision — everything " +
        "else is closed until you have cast your vote or stepped aside.",
      sequestered: true,
      juryId,
    },
    423,
  );
};
