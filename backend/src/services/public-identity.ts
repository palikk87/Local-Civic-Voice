/**
 * What a citizen is called in public.
 *
 * WHAT THIS REPLACED, AND WHY IT MATTERED. Roughly a dozen endpoints published
 * `author.email.split("@")[0]` as a person's handle. Somebody who signed up as
 * jane.smith.1987@gmail.com was shown to every reader of every post as
 * "jane.smith.1987" — their real name and their birth year, taken from a field
 * they gave us to receive a sign-in code.
 *
 * Bill of Rights IV: "Personal identity shall remain shielded from the federal
 * government and third parties." An email address is the one identifier that
 * follows a person across every other service they use, and this platform was
 * printing the distinctive half of it under everything they said.
 *
 * NEVER THE EMAIL, AT ANY LAYER. The fallback for somebody who has not chosen
 * a username is derived from their account id, which identifies them here and
 * nowhere else. A person with no username is anonymous-ish rather than
 * exposed — that is the right way round, and it was the wrong way round.
 *
 * THE EMAIL SHOULD NOT BE IN THE QUERY EITHER. Every author projection that
 * used to `select: { email: true }` now does not. A string that is never loaded
 * cannot be spread into a response by somebody in a hurry.
 */

/** The minimum a caller must have loaded for a handle to be derivable. */
export interface PublicIdentity {
  id: string;
  username?: string | null;
  displayUsername?: string | null;
}

/**
 * The handle to print. Chosen name first, then the display variant, then a
 * stable stand-in built from the account id.
 *
 * The stand-in is deliberately recognisable as one. "citizen-4f2a91" reads as
 * an account that has not been named, which is true, rather than impersonating
 * a handle somebody picked.
 */
export function publicHandle(user: PublicIdentity): string {
  const chosen = user.username?.trim() || user.displayUsername?.trim();
  if (chosen) return chosen;
  return `citizen-${user.id.slice(-6)}`;
}

/**
 * The author block every feed, post, comment and timeline response returns.
 *
 * One shape in one place, so a new surface cannot invent a fourteenth variant
 * that quietly starts leaking something again.
 */
export function publicAuthor(user: {
  id: string;
  name: string;
  username?: string | null;
  displayUsername?: string | null;
  image?: string | null;
}): { id: string; displayName: string; username: string; avatar: string } {
  return {
    id: user.id,
    displayName: user.name,
    username: publicHandle(user),
    avatar: user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
  };
}

/** The Prisma `select` that feeds the two functions above. Note: no email. */
export const PUBLIC_AUTHOR_SELECT = {
  id: true,
  name: true,
  username: true,
  displayUsername: true,
  image: true,
} as const;
