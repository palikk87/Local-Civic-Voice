// Web port of mobile/src/lib/admin-store.ts (auth slice).
// zustand persist uses localStorage instead of AsyncStorage.
//
// The admin console is a SEPARATE login from the citizen session: it posts
// username/password to /api/admin/login and gets back its own bearer token.
// Roles are configurable — "superadmin" is the owner seat and the rest are
// whatever the owner has created — and every /api/admin/* call is checked
// server-side against the CAPABILITIES that role holds, not against its name.
// A normal signed-in citizen is NOT an admin.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

/**
 * The owner seat plus whatever roles the owner has made. A union of three names
 * was wrong the moment roles became configurable, so this is a string — the
 * server decides what is valid, and this stops pretending it knows.
 */
export type AdminRole = string;

export interface AdminSession {
  token: string;
  adminId: string;
  username: string;
  role: AdminRole;
  /**
   * What this role may do, as the server sees it. Refreshed on every verify.
   *
   * GATE UI ON THIS, NEVER ON `role`. A screen hidden behind
   * `role === 'superadmin'` stays hidden from a custom role that holds the
   * capability, and the server would have allowed it — a permission that
   * works and cannot be found is not a permission that works.
   */
  capabilities: string[];
  expiresAt: string;
}

interface AdminState {
  session: AdminSession | null;
  isAdminAuthenticated: boolean;
  isLoading: boolean;

  adminLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  adminLogout: () => Promise<void>;
  verifySession: () => Promise<boolean>;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      session: null,
      isAdminAuthenticated: false,
      isLoading: false,

      adminLogin: async (username, password) => {
        set({ isLoading: true });

        try {
          const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });

          const data = await response.json();

          if (!response.ok) {
            set({ isLoading: false });
            return { success: false, error: data.error || 'Login failed' };
          }

          // Backend returns
          // { success, token, admin: { id, username, role, capabilities }, expiresAt }
          const session: AdminSession = {
            token: data.token,
            adminId: data.admin.id,
            username: data.admin.username,
            role: data.admin.role,
            capabilities: data.admin.capabilities ?? [],
            expiresAt: data.expiresAt,
          };

          set({ session, isAdminAuthenticated: true, isLoading: false });

          return { success: true };
        } catch {
          set({ isLoading: false });
          return { success: false, error: 'Network error. Please try again.' };
        }
      },

      adminLogout: async () => {
        const { session } = get();

        if (session?.token) {
          try {
            await fetch(`${API_BASE_URL}/api/admin/logout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session.token}`,
              },
            });
          } catch {
            // Ignore logout errors
          }
        }

        set({ session: null, isAdminAuthenticated: false });
      },

      verifySession: async () => {
        const { session } = get();

        if (!session?.token) {
          set({ isAdminAuthenticated: false });
          return false;
        }

        try {
          const response = await fetch(`${API_BASE_URL}/api/admin/verify`, {
            headers: { Authorization: `Bearer ${session.token}` },
          });

          if (!response.ok) {
            set({ session: null, isAdminAuthenticated: false });
            return false;
          }

          // Pick up a role edit made while this console was open, rather than
          // waiting for the next sign-in.
          const body = await response.json().catch(() => null);
          const fresh = body?.admin;
          if (fresh) {
            set({
              session: {
                ...session,
                role: fresh.role ?? session.role,
                capabilities: fresh.capabilities ?? session.capabilities,
              },
            });
          }

          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'admin-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        session: state.session,
        isAdminAuthenticated: state.isAdminAuthenticated,
      }),
    }
  )
);

/**
 * Whether the signed-in console session may do `capability`.
 *
 * The owner seat holds everything, including capabilities that do not exist
 * yet, so it is answered by name — that is the one place a name is the truth.
 */
export function adminCan(capability: string): boolean {
  const session = useAdminStore.getState().session;
  if (!session) return false;
  if (session.role === 'superadmin') return true;
  return session.capabilities.includes(capability);
}

/** Reactive form of `adminCan`, for gating what a component renders. */
export function useAdminCan(capability: string): boolean {
  return useAdminStore((state) => {
    const session = state.session;
    if (!session) return false;
    if (session.role === 'superadmin') return true;
    return session.capabilities.includes(capability);
  });
}

/** Authorization header for /api/admin/* calls, or {} when not signed in as admin. */
export function adminAuthHeader(): Record<string, string> {
  const token = useAdminStore.getState().session?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
