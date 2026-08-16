/**
 * Identity helpers shared by the stores.
 *
 * Mobile already keeps the real signed-in account in `useAuthStore` — the
 * Better Auth session is mirrored into it on every change — so unlike web there
 * is no need for a second source of truth. What was missing is that several
 * stores imported `currentUser` from mock-data instead of reading it, which is
 * how a fictional person ended up authoring things real people wrote.
 *
 * These are the two pieces those stores need outside React.
 */
import { useAuthStore, type AuthUser } from './auth-store';

/**
 * A deterministic avatar for an account with no uploaded image.
 *
 * Seeded on the account id, so the same person keeps the same face across
 * sessions and devices rather than being reshuffled on every render.
 */
export function fallbackAvatarFor(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/png?seed=${encodeURIComponent(seed)}`;
}

/**
 * The signed-in account, readable synchronously outside React.
 *
 * A zustand action writing an optimistic local entry needs an author right
 * then. Signed out it returns a neutral placeholder rather than somebody else's
 * name — those actions sit behind an auth gate, so that path should not be
 * reachable.
 *
 * Counts are zero rather than plausible-looking. They are display-only on a
 * local entry and the real values arrive with the record from the server;
 * inventing numbers is what made the mock data read as real.
 */
export function currentIdentity(): AuthUser {
  const user = useAuthStore.getState().user;
  if (user) return user;

  return {
    id: '',
    email: '',
    username: 'user',
    displayName: 'User',
    avatar: fallbackAvatarFor('anonymous'),
    bio: '',
    location: '',
    joinedDate: new Date().toISOString().split('T')[0],
    followers: 0,
    following: 0,
    votesCount: 0,
  };
}
