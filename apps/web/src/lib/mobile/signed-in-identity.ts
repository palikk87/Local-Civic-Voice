/**
 * The signed-in person, in the shape the ported mobile components expect.
 *
 * Those components were written against `currentUser` from mock-data.ts — a
 * fixed fictional person with a fixed avatar and handle. Whatever was signed in,
 * the composer, the comment box and the share sheet all showed that person's
 * name and face back to the user as if it were theirs. That is not cosmetic
 * mock content like a placeholder colour; it is the app telling you that you are
 * somebody else.
 *
 * This resolves the real session instead, and keeps the same field names so the
 * components did not have to be rewritten around a new shape.
 *
 * `null` when nobody is signed in. Callers must handle that rather than
 * substituting a stand-in — showing a fictional identity to a signed-out visitor
 * is the same bug in a different coat.
 */
import { useCurrentUser } from "@/hooks/use-civic-auth";

export interface SignedInIdentity {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

/**
 * A deterministic avatar for an account with no uploaded image.
 *
 * Seeded on the account id, so the same person keeps the same face across
 * sessions and devices rather than being reshuffled on every render.
 */
export function fallbackAvatarFor(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(seed)}`;
}

export function useSignedInIdentity(): SignedInIdentity | null {
  const { user } = useCurrentUser();
  if (!user) return null;

  // Better Auth returns username/image as additional session fields — the same
  // ones both clients read, which is what makes one account render identically
  // on web and on the phone.
  const username =
    (user as { username?: string | null }).username ?? user.email?.split("@")[0] ?? "user";

  return {
    id: user.id,
    username,
    displayName: user.name || username,
    avatar: (user as { image?: string | null }).image || fallbackAvatarFor(user.id),
  };
}
