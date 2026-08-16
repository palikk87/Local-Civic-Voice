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
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import type { User } from "./types";

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

/**
 * The signed-in identity, readable outside React.
 *
 * `useSignedInIdentity` covers components. The timeline store is a zustand
 * store — it writes optimistic local entries (a share, a comment, a reply) and
 * needs an author synchronously, outside any hook. It used to import
 * `currentUser` from mock-data for this, which is how a fictional person ended
 * up as the author of things real people wrote.
 *
 * `SyncSignedInIdentity` (rendered once, high in the tree) keeps this in step
 * with the session. Reading it before that has mounted, or while signed out,
 * yields a neutral placeholder rather than somebody else's name — the actions
 * that use it are behind an auth gate, so that path should not be reachable.
 */
let current: SignedInIdentity | null = null;

/**
 * Returns the full `User` shape the timeline store's entries are typed against.
 *
 * The counts are zero rather than invented. They are display-only on a local
 * optimistic entry, and the real values arrive with the record from the server
 * — putting plausible numbers here is how the mock data read as real in the
 * first place.
 */
export function currentIdentity(): User {
  const base = current ?? {
    id: "",
    username: "user",
    displayName: "User",
    avatar: fallbackAvatarFor("anonymous"),
  };
  return {
    ...base,
    joinedDate: new Date().toISOString(),
    followers: 0,
    following: 0,
    votesCount: 0,
  };
}

export function setCurrentIdentity(identity: SignedInIdentity | null): void {
  current = identity;
}

/** Mirrors the session into `currentIdentity()`. Render once, near the root. */
export function SyncSignedInIdentity(): null {
  const identity = useSignedInIdentity();
  useEffect(() => {
    setCurrentIdentity(identity);
  }, [identity]);
  return null;
}
