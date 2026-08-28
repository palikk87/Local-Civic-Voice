/**
 * What to call a person on screen.
 *
 * Mirror of backend/src/services/public-identity.ts, and the same rule: the
 * name they chose, or a stand-in built from their account id. Never the email.
 *
 * The clients had their own copies of the bug. The sidebar greeted people with
 * the distinctive half of their email address — visible in every screenshot
 * and on every shared screen.
 */

export interface PublicIdentity {
  id?: string | null;
  username?: string | null;
  displayUsername?: string | null;
}

export function publicHandle(user: PublicIdentity | null | undefined): string {
  if (!user) return "";
  const chosen = user.username?.trim() || user.displayUsername?.trim();
  if (chosen) return chosen;
  if (!user.id) return "";
  return `citizen-${user.id.slice(-6)}`;
}
