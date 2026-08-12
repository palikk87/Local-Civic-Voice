import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useSession } from "@/lib/auth-client";
import { can, resolveRole, type Capability } from "@/lib/permissions";
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

/** Convenience wrapper around Better Auth's session. */
export function useCurrentUser() {
  const { data, isPending } = useSession();
  const user = data?.user ?? null;
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
 * The admin tier comes from the separate admin-console session, matching mobile.
 */
export function usePermissions() {
  const { isLoading, isAuthenticated, user } = useCurrentUser();
  const isAdmin = useAdminStore((s) => s.isAdminAuthenticated);

  const role = resolveRole({ isSignedIn: isAuthenticated, isAdmin });
  const check = useCallback((capability: Capability) => can(role, capability), [role]);

  return { role, can: check, isLoading, isAuthenticated, isAdmin, user };
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
