import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import { can, isStaffAccount, resolveRole, type Capability } from "@/lib/permissions";
import { useAdminStore } from "@/lib/mobile/admin-store";

interface AuthUIState {
  /** Whether the auth dialog is open */
  open: boolean;
  /** Optional context message, e.g. "Sign up to cast your vote" */
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
      {children}
    </AuthUIContext.Provider>
  );
}

export function useAuthUI() {
  const ctx = useContext(AuthUIContext);
  if (!ctx) throw new Error("useAuthUI must be used within AuthUIProvider");
  return ctx;
}

/**
 * Convenience wrapper around Better Auth's session.
 *
 * `sessionUnavailable` IS NOT A DETAIL. This used to drop `error` on the floor,
 * which made "this visitor is signed out" and "I could not ask whether they are
 * signed in" the same answer — and with the API unreachable, fifteen routes
 * showed a sign-in wall to people who were already signed in, whose sign-in
 * attempt could not have worked either. Measured with the API switched off; see
 * docs/IF_THE_API_HOST_GOES_AWAY.md.
 *
 * Nothing is assumed about the visitor when the session cannot be read. They
 * are not authenticated, because we do not know that they are — but callers can
 * see WHY, and say so instead of blaming them.
 */
export function useCurrentUser() {
  const { data, isPending, error } = useSession();
  const user = data?.user ?? null;
  return {
    user,
    isAuthenticated: !!user,
    isLoading: isPending,
    /** The session could not be read at all. Not the same as being signed out. */
    sessionUnavailable: !isPending && !user && !!error,
  };
}

/**
 * Current tier plus a capability check.
 *
 * `can("vote")` — is this visitor allowed to do it?
 * `isLoading`   — session still resolving; don't render a decision yet.
 *
 * The admin tier comes from the separate admin-console session, matching mobile.
 */
export function usePermissions() {
  const { isLoading, isAuthenticated, user, sessionUnavailable } = useCurrentUser();
  const isAdmin = useAdminStore((s) => s.isAdminAuthenticated);

  const role = resolveRole({ isSignedIn: isAuthenticated, isAdmin });
  const check = useCallback((capability: Capability) => can(role, capability), [role]);

  /**
   * Whether the signed-in ACCOUNT is staff — separate from `isAdmin`, which only
   * says a console session exists in this browser's storage. Use this to decide
   * what to show a person; use `can()` for what a tier may do.
   */
  const isStaff = isStaffAccount(user as { role?: string | null } | null);

  return { role, can: check, isLoading, isAuthenticated, isAdmin, isStaff, user, sessionUnavailable };
}

/**
 * Gate for participation actions (vote, comment, share, post, follow).
 * Guests can read everything; anything that writes goes through this.
 *
 * Usage: `if (!requireAuth("Sign in to cast your vote")) return;`
 * Returns false and opens the auth dialog when the visitor isn't signed in.
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const { openAuth } = useAuthUI();

  return useCallback(
    (reason: string) => {
      // Session still resolving — don't fire the action or flash the dialog.
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
