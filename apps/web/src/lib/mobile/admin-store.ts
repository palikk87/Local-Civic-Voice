// Web port of mobile/src/lib/admin-store.ts (auth slice).
// zustand persist uses localStorage instead of AsyncStorage.
//
// The admin console is a SEPARATE login from the citizen session: it posts
// username/password to /api/admin/login and gets back its own bearer token.
// Roles are admin | moderator | superadmin, checked server-side on every
// /api/admin/* call. A normal signed-in citizen is NOT an admin.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || '';

export type AdminRole = 'admin' | 'moderator' | 'superadmin';

export interface AdminSession {
  token: string;
  adminId: string;
  username: string;
  role: AdminRole;
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

          // Backend returns { success, token, admin: { id, username, role }, expiresAt }
          const session: AdminSession = {
            token: data.token,
            adminId: data.admin.id,
            username: data.admin.username,
            role: data.admin.role,
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

/** Authorization header for /api/admin/* calls, or {} when not signed in as admin. */
export function adminAuthHeader(): Record<string, string> {
  const token = useAdminStore.getState().session?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
