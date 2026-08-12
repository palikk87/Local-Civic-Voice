// Web port of mobile/src/lib/notification-store.ts
import { create } from 'zustand';
import { api } from '@/lib/api';

// Notification types
export type NotificationType =
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'follow'
  | 'repost'
  | 'new_follower_post';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  // Reference data for navigation
  referenceId?: string;
  referenceType?: 'post' | 'comment' | 'user' | 'bill';
  // Actor who triggered the notification
  actor?: {
    id: string;
    displayName: string;
    username: string;
    avatar: string;
  };
}

export interface NotificationPreferences {
  likes: boolean;
  comments: boolean;
  replies: boolean;
  mentions: boolean;
  follows: boolean;
  reposts: boolean;
  newFollowerPosts: boolean;
}

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchNotifications: (refresh?: boolean) => Promise<void>;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  fetchPreferences: () => Promise<void>;
  updatePreferences: (preferences: Partial<NotificationPreferences>) => Promise<void>;
  clearError: () => void;
}

// Default preferences - all ON
const defaultPreferences: NotificationPreferences = {
  likes: true,
  comments: true,
  replies: true,
  mentions: true,
  follows: true,
  reposts: true,
  newFollowerPosts: true,
};

// Mock notifications for development
const mockNotifications: Notification[] = [
  {
    id: '1',
    type: 'like',
    title: 'New Like',
    body: 'Sarah Chen liked your post about the Infrastructure Bill',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 min ago
    referenceId: 'post-1',
    referenceType: 'post',
    actor: {
      id: 'user-1',
      displayName: 'Sarah Chen',
      username: 'sarahchen',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    },
  },
  {
    id: '2',
    type: 'comment',
    title: 'New Comment',
    body: 'Marcus Johnson commented: "Great analysis on this bill!"',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 min ago
    referenceId: 'post-2',
    referenceType: 'post',
    actor: {
      id: 'user-2',
      displayName: 'Marcus Johnson',
      username: 'marcusj',
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    },
  },
  {
    id: '3',
    type: 'follow',
    title: 'New Follower',
    body: 'Emily Rodriguez started following you',
    isRead: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    referenceId: 'user-3',
    referenceType: 'user',
    actor: {
      id: 'user-3',
      displayName: 'Emily Rodriguez',
      username: 'emilyr',
      avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150',
    },
  },
  {
    id: '4',
    type: 'mention',
    title: 'You were mentioned',
    body: 'David Kim mentioned you in a comment',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), // 5 hours ago
    referenceId: 'post-3',
    referenceType: 'comment',
    actor: {
      id: 'user-4',
      displayName: 'David Kim',
      username: 'davidk',
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    },
  },
  {
    id: '5',
    type: 'repost',
    title: 'Your post was shared',
    body: 'Lisa Wang reposted your analysis of the Climate Bill',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), // 1 day ago
    referenceId: 'post-4',
    referenceType: 'post',
    actor: {
      id: 'user-5',
      displayName: 'Lisa Wang',
      username: 'lisaw',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    },
  },
  {
    id: '6',
    type: 'reply',
    title: 'New Reply',
    body: 'James Wilson replied to your comment',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(), // 2 days ago
    referenceId: 'post-5',
    referenceType: 'comment',
    actor: {
      id: 'user-6',
      displayName: 'James Wilson',
      username: 'jamesw',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
    },
  },
  {
    id: '7',
    type: 'new_follower_post',
    title: 'New Post',
    body: 'Anna Martinez posted about the Education Reform Act',
    isRead: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(), // 3 days ago
    referenceId: 'post-6',
    referenceType: 'post',
    actor: {
      id: 'user-7',
      displayName: 'Anna Martinez',
      username: 'annam',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    },
  },
];

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  preferences: defaultPreferences,
  isLoading: false,
  error: null,

  fetchNotifications: async (refresh = false) => {
    const { isLoading } = get();
    if (isLoading && !refresh) return;

    set({ isLoading: true, error: null });

    try {
      // Try API first, fall back to mock data
      const response = await api.get<{ notifications: Notification[]; unreadCount: number }>(
        '/api/notifications'
      );
      set({
        notifications: response.notifications,
        unreadCount: response.unreadCount,
        isLoading: false,
      });
    } catch {
      // Use mock data in development/when API unavailable
      const unreadCount = mockNotifications.filter((n) => !n.isRead).length;
      set({
        notifications: mockNotifications,
        unreadCount,
        isLoading: false,
      });
    }
  },

  markAsRead: async (notificationId: string) => {
    // Optimistic update
    set((state) => {
      const updatedNotifications = state.notifications.map((n) =>
        n.id === notificationId ? { ...n, isRead: true } : n
      );
      const unreadCount = updatedNotifications.filter((n) => !n.isRead).length;
      return { notifications: updatedNotifications, unreadCount };
    });

    try {
      await api.patch(`/api/notifications/${notificationId}/read`, {});
    } catch {
      // Silently fail - optimistic update remains
      console.warn('Failed to mark notification as read');
    }
  },

  markAllAsRead: async () => {
    // Optimistic update
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));

    try {
      await api.post('/api/notifications/read-all');
    } catch {
      console.warn('Failed to mark all notifications as read');
    }
  },

  fetchPreferences: async () => {
    try {
      const response = await api.get<{ preferences: NotificationPreferences }>(
        '/api/notifications/preferences'
      );
      set({ preferences: response.preferences });
    } catch {
      // Keep default preferences if fetch fails
      set({ preferences: defaultPreferences });
    }
  },

  updatePreferences: async (newPreferences: Partial<NotificationPreferences>) => {
    const currentPreferences = get().preferences;
    const updatedPreferences = { ...currentPreferences, ...newPreferences };

    // Optimistic update
    set({ preferences: updatedPreferences });

    try {
      await api.put('/api/notifications/preferences', updatedPreferences);
    } catch {
      // Revert on error
      set({ preferences: currentPreferences });
      throw new Error('Failed to update notification preferences');
    }
  },

  clearError: () => set({ error: null }),
}));

// Selectors
export const selectNotifications = (state: NotificationState) => state.notifications;
export const selectUnreadCount = (state: NotificationState) => state.unreadCount;
export const selectPreferences = (state: NotificationState) => state.preferences;
export const selectIsLoading = (state: NotificationState) => state.isLoading;
