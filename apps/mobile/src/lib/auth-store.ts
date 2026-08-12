import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
