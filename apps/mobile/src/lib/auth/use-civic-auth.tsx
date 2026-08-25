import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { useSession } from './use-session';
import { can, isStaffAccount, resolveRole, type Capability, type Role } from '@/lib/permissions';
import { useAdminStore } from '@/lib/admin-store';
import { useAuthStore, type AuthUser } from '@/lib/auth-store';
import { api } from '@/lib/api/api';

/**
 * Mobile twin of the web app's hooks/use-civic-auth.tsx.
 *
 * Same behaviour, phone idiom: guests browse everything public, and any action that
 * writes goes through `useRequireAuth`, which opens the auth bottom sheet instead of
 * the web dialog.
 */

interface AuthUIState {
  /** Whether the auth sheet is open */
  open: boolean;
  /** Optional context message, e.g. "Sign in to cast your vote" */
  reason: string | null;
  openAuth: (reason?: string) => void;
  closeAuth: () => void;
}

const AuthUIContext = createContext<AuthUIState | null>(null);

export function AuthUIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const openAuth = useCallback((r?: string) => {
    setReason(r ?? null);
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => setOpen(false), []);

  return (
    <AuthUIContext.Provider value={{ open, reason, openAuth, closeAuth }}>
      <SessionBridge />
      {children}
    </AuthUIContext.Provider>
  );
}

export function useAuthUI() {
  const ctx = useContext(AuthUIContext);
  if (!ctx) throw new Error('useAuthUI must be used within an AuthUIProvider');
  return ctx;
}

/** Convenience wrapper around Better Auth's session. */
export function useCurrentUser() {
  const { data, isPending } = useSession();
  const user = data ?? null;
  return {
    user,
    isAuthenticated: !!user,
    isLoading: isPending,
  };
}

/**
 * Current tier plus a capability check.
 *
 * `can("vote")` — is this visitor allowed to do it?
 * `isLoading`   — session still resolving; don't render a decision yet.
 *
 * The admin tier comes from the separate admin-console session, matching web.
 */
export function usePermissions(): {
  role: Role;
  can: (capability: Capability) => boolean;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  user: ReturnType<typeof useCurrentUser>['user'];
} {
  const { isLoading, isAuthenticated, user } = useCurrentUser();
  const isAdmin = useAdminStore((s) => s.isAdminAuthenticated);

  const role = resolveRole({ isSignedIn: isAuthenticated, isAdmin });
  const check = useCallback((capability: Capability) => can(role, capability), [role]);

  // Whether the signed-in ACCOUNT is staff — separate from `isAdmin`, which
  // only says a console session exists in this device's storage. Use this to
  // decide what to show a person; use `can()` for what a tier may do.
  const isStaff = isStaffAccount(user as { role?: string | null } | null);

  return { role, can: check, isLoading, isAuthenticated, isAdmin, isStaff, user };
}

/**
 * Gate for participation actions (vote, comment, share, post, follow).
 * Guests can read everything; anything that writes goes through this.
 *
 * Usage: `if (!requireAuth('Sign in to cast your vote')) return;`
 * Returns false and opens the auth sheet when the visitor isn't signed in.
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const { openAuth } = useAuthUI();

  return useCallback(
    (reason: string) => {
      // Session still resolving — don't fire the action or flash the sheet.
      if (isLoading) return false;
      if (!isAuthenticated) {
        openAuth(reason);
        return false;
      }
      return true;
    },
    [isAuthenticated, isLoading, openAuth],
  );
}

type ProfileResponse = Partial<Omit<AuthUser, 'email'>> & { data?: Partial<AuthUser> };

/**
 * Keeps the legacy `useAuthStore` mirror in step with the real Better Auth session,
 * so screens that already read `useAuthStore().user` show the signed-in citizen and
 * clear out on sign-out. The session is the source of truth; this is just a cache.
 */
function SessionBridge() {
  const { data: sessionUser, isPending } = useSession();
  const setUser = useAuthStore((s) => s.setUser);
  const clearUser = useAuthStore((s) => s.signOut);

  useEffect(() => {
    if (isPending) return;

    if (!sessionUser) {
      clearUser();
      return;
    }

    const fallbackUsername = sessionUser.email.split('@')[0];
    const base: AuthUser = {
      id: sessionUser.id,
      email: sessionUser.email,
      username: fallbackUsername,
      displayName: sessionUser.name || fallbackUsername,
      avatar:
        sessionUser.image ||
        `https://api.dicebear.com/7.x/avataaars/png?seed=${sessionUser.id}`,
      bio: '',
      location: '',
      joinedDate: new Date().toISOString().split('T')[0],
      followers: 0,
      following: 0,
      votesCount: 0,
    };

    setUser(base);

    // Fill in the civic profile (username, bio, counts) from the same endpoint the
    // rest of the app uses. Best-effort — the session alone is enough to sign in.
    let cancelled = false;
    api
      .get<ProfileResponse>(`/api/users/${sessionUser.id}`)
      .then((response) => {
        if (cancelled) return;
        const profile = response?.data ?? response;
        if (!profile) return;
        setUser({
          ...base,
          username: profile.username ?? base.username,
          displayName: profile.displayName ?? base.displayName,
          avatar: profile.avatar ?? base.avatar,
          bio: profile.bio ?? base.bio,
          location: profile.location ?? base.location,
          joinedDate: profile.joinedDate ?? base.joinedDate,
          followers: profile.followers ?? base.followers,
          following: profile.following ?? base.following,
          votesCount: profile.votesCount ?? base.votesCount,
        });
      })
      .catch(() => {
        // Offline or profile not readable — the base session user stands.
      });

    return () => {
      cancelled = true;
    };
  }, [sessionUser, isPending, setUser, clearUser]);

  return null;
}
