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
      const response = await api.get<{ notifications: Notification[]; unreadCount: number }>(
        '/api/notifications'
      );
      set({
        notifications: response.notifications,
        unreadCount: response.unreadCount,
        isLoading: false,
      });
    } catch (cause) {
      // NO FALLBACK. This used to hold seven invented notifications from seven
      // invented people — "Sarah Chen liked your post" — and hand them over
      // whenever the API did not answer. A citizen cannot tell a fabricated
      // notification from a real one, so the failure was invisible and the
      // content was a lie. An unreachable server is an error, and it says so.
      set({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error:
          cause instanceof Error
            ? cause.message
            : 'Notifications could not be loaded.',
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
