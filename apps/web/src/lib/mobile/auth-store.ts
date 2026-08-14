// Web port of mobile/src/lib/auth-store.ts
// zustand persist uses localStorage instead of AsyncStorage.
// On mobile, login.tsx signs in via Better Auth (email OTP) and then calls
// setUser() with an AuthUser derived from the Better Auth user — the same
// mapping is exported here as authUserFromSession() so the web auth flow can
// populate the store identically.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  location: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signUp: (email: string, password: string, username: string, displayName: string) => Promise<{ success: boolean; error?: string }>;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => void;
  setUser: (user: AuthUser) => void;
  updateProfile: (updates: Partial<AuthUser>) => void;
}

/**
 * Build the local AuthUser from a Better Auth session.
 *
 * `username`, `bio` and `location` come from the session itself — the backend
 * returns them via `user.additionalFields` (see backend/src/auth.ts).
 *
 * They used to be invented here: username was `email.split('@')[0]` and bio and
 * location were hardcoded. Mobile meanwhile fetched the real record from
 * /api/users/:id, so the same account displayed a different handle depending on
 * which client you opened. The email fallback remains only for a session issued
 * before those fields were added, and for accounts that genuinely have no
 * username set.
 */
export function authUserFromSession(sessionUser: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  createdAt?: Date | string;
  username?: string | null;
  displayUsername?: string | null;
  bio?: string | null;
  location?: string | null;
}): AuthUser {
  const handle =
    sessionUser.displayUsername || sessionUser.username || sessionUser.email.split('@')[0];

  return {
    id: sessionUser.id,
    email: sessionUser.email,
    username: handle,
    displayName: sessionUser.name || handle,
    avatar:
      sessionUser.image ??
      `https://api.dicebear.com/7.x/avataaars/png?seed=${sessionUser.email}`,
    bio: sessionUser.bio ?? '',
    location: sessionUser.location ?? 'United States',
    joinedDate: sessionUser.createdAt
      ? new Date(sessionUser.createdAt).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0],
    followers: 0,
    following: 0,
    votesCount: 0,
  };
}

// Simple mock user database (in a real app, this would be a backend)
const mockUserDb: Map<string, { password: string; user: AuthUser }> = new Map();

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      // DO NOT IMPLEMENT ACCOUNT CREATION HERE.
      //
      // These two used to create accounts in an in-memory Map and report success,
      // which meant a person could "sign up", appear logged in, and have no account
      // anywhere on the server. Real auth goes through Better Auth via
      // `authClient.signUp.email` / `authClient.signIn.email` (see
      // components/auth/AuthForm.tsx), which persists to the database.
      //
      // They now fail loudly instead of silently faking a signup. This store is
      // only for holding the current user's profile in the UI.
      signUp: async () => {
        set({ isLoading: false });
        console.error(
          '[auth-store] signUp() is not a real signup. Use authClient.signUp.email instead.',
        );
        return {
          success: false,
          error: 'Sign-up is unavailable through this path. Please try again.',
        };
      },

      signIn: async () => {
        set({ isLoading: false });
        console.error(
          '[auth-store] signIn() is not a real login. Use authClient.signIn.email instead.',
        );
        return {
          success: false,
          error: 'Sign-in is unavailable through this path. Please try again.',
        };
      },

      signOut: () => {
        set({ user: null, isAuthenticated: false });
      },

      setUser: (user: AuthUser) => {
        set({ user, isAuthenticated: true });
      },

      updateProfile: (updates) => {
        const currentUser = get().user;
        if (currentUser) {
          const updatedUser = { ...currentUser, ...updates };
          set({ user: updatedUser });

          // Update mock db
          const userData = mockUserDb.get(currentUser.email);
          if (userData) {
            mockUserDb.set(currentUser.email, { ...userData, user: updatedUser });
          }
        }
      },
    }),
    {
      name: 'civic-auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
