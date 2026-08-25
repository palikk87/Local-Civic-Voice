import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BACKEND_URL } from './config';

export interface AdminUser {
  id: string;
  username: string;
  role: 'admin' | 'moderator' | 'superadmin';
  createdAt: string;
  lastLogin?: string;
}

export interface AdminSession {
  token: string;
  adminId: string;
  username: string;
  role: 'admin' | 'moderator' | 'superadmin';
  expiresAt: string;
}

export interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  bio: string;
  location: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
  postsCount: number;
  role: 'user' | 'admin' | 'moderator' | 'superadmin';
  status: 'active' | 'banned' | 'suspended';
  lastActive?: string;
  banReason?: string;
  banExpiresAt?: string;
}

export interface ManagedPost {
  id: string;
  content: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: string;
  likes: number;
  comments: number;
  status: 'active' | 'flagged' | 'removed';
  flagReason?: string;
  flaggedBy?: string;
  flaggedAt?: string;
}

export interface DashboardStats {
  totalUsers: number;
  totalPosts: number;
  totalComments: number;
  totalVotes: number;
  bannedUsers: number;
  flaggedPosts: number;
  activeToday: number;
  newUsersToday: number;
  postsToday: number;
}

export interface ActivityLog {
  id: string;
  adminId: string;
  adminUsername: string;
  action: string;
  targetType: 'user' | 'post' | 'comment' | 'system';
  targetId?: string;
  details?: string;
  timestamp: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'info' | 'warning' | 'alert';
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  isActive: boolean;
}

interface AdminState {
  session: AdminSession | null;
  isAdminAuthenticated: boolean;
  isLoading: boolean;
  stats: DashboardStats | null;
  users: ManagedUser[];
  posts: ManagedPost[];
  logs: ActivityLog[];
  announcements: Announcement[];

  // Auth actions
  adminLogin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  adminLogout: () => Promise<void>;
  verifySession: () => Promise<boolean>;

  // User management
  fetchUsers: (params?: { search?: string; status?: string; role?: string; page?: number; limit?: number }) => Promise<void>;
  fetchUserById: (id: string) => Promise<ManagedUser | null>;
  updateUser: (id: string, updates: Partial<ManagedUser>) => Promise<{ success: boolean; error?: string }>;
  banUser: (id: string, reason: string, duration?: number) => Promise<{ success: boolean; error?: string }>;
  unbanUser: (id: string) => Promise<{ success: boolean; error?: string }>;
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>;
  makeAdmin: (id: string, role: 'admin' | 'moderator') => Promise<{ success: boolean; error?: string }>;

  // Content moderation
  fetchPosts: (params?: { search?: string; status?: string; reported?: boolean; page?: number; limit?: number }) => Promise<void>;
  deletePost: (id: string) => Promise<{ success: boolean; error?: string }>;
  flagPost: (id: string, reason: string) => Promise<{ success: boolean; error?: string }>;

  // Analytics
  fetchStats: () => Promise<void>;

  // Logs
  fetchLogs: (params?: { action?: string; adminId?: string; page?: number; limit?: number }) => Promise<void>;

  // Announcements
  fetchAnnouncements: () => Promise<void>;
  createAnnouncement: (title: string, content: string, type: 'info' | 'warning' | 'alert', expiresAt?: string) => Promise<{ success: boolean; error?: string }>;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set, get) => ({
      session: null,
      isAdminAuthenticated: false,
      isLoading: false,
      stats: null,
      users: [],
      posts: [],
      logs: [],
      announcements: [],

      adminLogin: async (username, password) => {
        set({ isLoading: true });

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/login`, {
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

          set({
            session,
            isAdminAuthenticated: true,
            isLoading: false,
          });

          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          return { success: false, error: 'Network error. Please try again.' };
        }
      },

      adminLogout: async () => {
        const { session } = get();

        if (session?.token) {
          try {
            await fetch(`${BACKEND_URL}/api/admin/logout`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.token}`,
              },
            });
          } catch {
            // Ignore logout errors
          }
        }

        set({
          session: null,
          isAdminAuthenticated: false,
          stats: null,
          users: [],
          posts: [],
          logs: [],
        });
      },

      verifySession: async () => {
        const { session } = get();

        if (!session?.token) {
          set({ isAdminAuthenticated: false });
          return false;
        }

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/verify`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
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

      fetchUsers: async (params = {}) => {
        const { session } = get();
        if (!session?.token) return;

        set({ isLoading: true });

        try {
          const queryParams = new URLSearchParams();
          if (params.search) queryParams.set('search', params.search);
          if (params.status) queryParams.set('status', params.status);
          if (params.role) queryParams.set('role', params.role);
          if (params.page) queryParams.set('page', params.page.toString());
          if (params.limit) queryParams.set('limit', params.limit.toString());

          const response = await fetch(`${BACKEND_URL}/api/admin/users?${queryParams}`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns { results: [...] } format
            const users = data.users || data.results || [];
            // Map to ManagedUser format
            const mappedUsers: ManagedUser[] = users.map((u: {
              id: string;
              username: string;
              displayName: string;
              email?: string;
              avatar: string;
              bio: string;
              location: string;
              joinedDate: string;
              followers: number;
              following: number;
              votesCount: number;
              postsCount?: number;
              role?: string;
              status?: string;
              isBanned?: boolean;
              banInfo?: { reason?: string; expiresAt?: string } | null;
            }) => ({
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              email: u.email || '',
              avatar: u.avatar,
              bio: u.bio,
              location: u.location,
              joinedDate: u.joinedDate,
              followers: u.followers,
              following: u.following,
              votesCount: u.votesCount,
              postsCount: u.postsCount || 0,
              role: (u.role || 'user') as 'user' | 'admin' | 'moderator' | 'superadmin',
              status: (u.isBanned ? 'banned' : (u.status || 'active')) as 'active' | 'banned' | 'suspended',
              lastActive: undefined,
              banReason: u.banInfo?.reason,
              banExpiresAt: u.banInfo?.expiresAt,
            }));
            set({ users: mappedUsers, isLoading: false });
          } else {
            set({ isLoading: false });
          }
        } catch {
          set({ isLoading: false });
        }
      },

      fetchUserById: async (id) => {
        const { session } = get();
        if (!session?.token) return null;

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns user directly (not wrapped in { user: ... })
            const u = data.user || data;
            const user: ManagedUser = {
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              email: u.email || '',
              avatar: u.avatar,
              bio: u.bio,
              location: u.location,
              joinedDate: u.joinedDate,
              followers: u.followers,
              following: u.following,
              votesCount: u.votesCount,
              postsCount: u.stats?.postsCount || u.postsCount || 0,
              role: (u.role || 'user') as 'user' | 'admin' | 'moderator' | 'superadmin',
              status: (u.isBanned ? 'banned' : (u.status || 'active')) as 'active' | 'banned' | 'suspended',
              lastActive: undefined,
              banReason: u.banInfo?.reason,
              banExpiresAt: u.banInfo?.expiresAt,
            };
            return user;
          }
          return null;
        } catch {
          return null;
        }
      },

      updateUser: async (id, updates) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify(updates),
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Update failed' };
          }

          // Refresh users list
          await get().fetchUsers();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      banUser: async (id, reason, duration) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}/ban`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify({ reason, duration }),
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Ban failed' };
          }

          await get().fetchUsers();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      unbanUser: async (id) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}/ban`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Unban failed' };
          }

          await get().fetchUsers();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      deleteUser: async (id) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Delete failed' };
          }

          await get().fetchUsers();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      makeAdmin: async (id, role) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/users/${id}/make-admin`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify({ role }),
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Failed to grant admin privileges' };
          }

          await get().fetchUsers();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      fetchPosts: async (params = {}) => {
        const { session } = get();
        if (!session?.token) return;

        set({ isLoading: true });

        try {
          const queryParams = new URLSearchParams();
          if (params.search) queryParams.set('search', params.search);
          if (params.status) queryParams.set('status', params.status);
          if (params.reported !== undefined) queryParams.set('reported', params.reported.toString());
          if (params.page) queryParams.set('page', params.page.toString());
          if (params.limit) queryParams.set('limit', params.limit.toString());

          const response = await fetch(`${BACKEND_URL}/api/admin/posts?${queryParams}`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns { results: [...] } format
            const posts = data.posts || data.results || [];
            // Map to ManagedPost format
            const mappedPosts: ManagedPost[] = posts.map((p: {
              id: string;
              content: string;
              authorId?: string;
              author: { id: string; username: string; displayName: string };
              createdAt: string;
              likes: number;
              commentsCount?: number;
              status?: string;
              reportCount?: number;
              flags?: Array<{ reason: string; flaggedBy: string; flaggedAt: string }>;
            }) => ({
              id: p.id,
              content: p.content,
              authorId: p.authorId || p.author.id,
              authorUsername: p.author.username,
              authorDisplayName: p.author.displayName,
              createdAt: p.createdAt,
              likes: p.likes,
              comments: p.commentsCount || 0,
              status: (p.status || 'active') as 'active' | 'flagged' | 'removed',
              flagReason: p.flags?.[0]?.reason,
              flaggedBy: p.flags?.[0]?.flaggedBy,
              flaggedAt: p.flags?.[0]?.flaggedAt,
            }));
            set({ posts: mappedPosts, isLoading: false });
          } else {
            set({ isLoading: false });
          }
        } catch {
          set({ isLoading: false });
        }
      },

      deletePost: async (id) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/posts/${id}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Delete failed' };
          }

          await get().fetchPosts();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      flagPost: async (id, reason) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/posts/${id}/flag`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify({ reason }),
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Flag failed' };
          }

          await get().fetchPosts();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },

      fetchStats: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/stats`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns nested structure, map to flat DashboardStats format
            const stats: DashboardStats = {
              totalUsers: data.overview?.totalUsers ?? 0,
              totalPosts: data.overview?.totalPosts ?? 0,
              totalComments: data.overview?.totalComments ?? 0,
              totalVotes: data.overview?.totalVotes ?? 0,
              bannedUsers: data.moderation?.bannedUsers ?? 0,
              flaggedPosts: data.moderation?.flaggedContent ?? 0,
              activeToday: data.overview?.dailyActiveUsers ?? 0,
              newUsersToday: 0, // Not provided by backend
              postsToday: 0, // Not provided by backend
            };
            set({ stats });
          }
        } catch {
          // Ignore errors
        }
      },

      fetchLogs: async (params = {}) => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const queryParams = new URLSearchParams();
          if (params.action) queryParams.set('action', params.action);
          if (params.adminId) queryParams.set('adminId', params.adminId);
          if (params.page) queryParams.set('page', params.page.toString());
          if (params.limit) queryParams.set('limit', params.limit.toString());

          const response = await fetch(`${BACKEND_URL}/api/admin/logs?${queryParams}`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns { results: [...] } format
            const logsData = data.logs || data.results || [];
            // Map to ActivityLog format
            const mappedLogs: ActivityLog[] = logsData.map((l: {
              id: string;
              adminId: string;
              adminUsername: string;
              action: string;
              targetType: 'user' | 'post' | 'comment' | 'system';
              targetId?: string;
              details?: string;
              createdAt: string;
            }) => ({
              id: l.id,
              adminId: l.adminId,
              adminUsername: l.adminUsername,
              action: l.action,
              targetType: l.targetType,
              targetId: l.targetId,
              details: l.details,
              timestamp: l.createdAt,
            }));
            set({ logs: mappedLogs });
          }
        } catch {
          // Ignore errors
        }
      },

      fetchAnnouncements: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/admin/announcements`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns { results: [...] } format
            const announcementsData = data.announcements || data.results || [];
            // Map to Announcement format
            const mappedAnnouncements: Announcement[] = announcementsData.map((a: {
              id: string;
              title: string;
              content: string;
              priority?: 'low' | 'medium' | 'high' | 'critical';
              createdBy: string;
              createdAt: string;
              expiresAt?: string;
              isActive: boolean;
            }) => ({
              id: a.id,
              title: a.title,
              content: a.content,
              type: (a.priority === 'critical' || a.priority === 'high') ? 'alert' :
                    (a.priority === 'medium') ? 'warning' : 'info' as 'info' | 'warning' | 'alert',
              createdBy: a.createdBy,
              createdAt: a.createdAt,
              expiresAt: a.expiresAt,
              isActive: a.isActive,
            }));
            set({ announcements: mappedAnnouncements });
          }
        } catch {
          // Ignore errors
        }
      },

      createAnnouncement: async (title, content, type, expiresAt) => {
        const { session } = get();
        if (!session?.token) return { success: false, error: 'Not authenticated' };

        try {
          // Map type to priority for backend
          const priority = type === 'alert' ? 'critical' :
                          type === 'warning' ? 'medium' : 'low';

          const response = await fetch(`${BACKEND_URL}/api/admin/announce`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.token}`,
            },
            body: JSON.stringify({ title, content, priority, expiresAt }),
          });

          if (!response.ok) {
            const data = await response.json();
            return { success: false, error: data.error || 'Failed to create announcement' };
          }

          await get().fetchAnnouncements();
          return { success: true };
        } catch {
          return { success: false, error: 'Network error' };
        }
      },
    }),
    {
      name: 'civic-admin-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        session: state.session,
        isAdminAuthenticated: state.isAdminAuthenticated,
      }),
    }
  )
);

/**
 * Authorization header for /api/admin/* calls, or {} when not signed in as admin.
 *
 * Web twin: apps/web/src/lib/mobile/admin-store.ts. Added so a component can
 * make an admin request without reaching into the store's shape itself — the
 * five call sites above each build this header by hand, which is how they came
 * to differ in the first place.
 */
export function adminAuthHeader(): Record<string, string> {
  const token = useAdminStore.getState().session?.token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
