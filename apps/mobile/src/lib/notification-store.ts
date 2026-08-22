/**
 * Notification Store - Manages notifications state
 *
 * This store handles:
 * - Fetching notifications from the backend API
 * - Managing read/unread status
 * - User notification preferences
 */

import { create } from 'zustand';
import { api } from './api/api';

// Notification types
export type NotificationType =
  | 'like'
  | 'comment'
  | 'reply'
  | 'mention'
  | 'follow'
  | 'repost'
  | 'new_follower_post'
  // The backend has been sending these three for a while and this union did
  // not know about them, which is how the notifications screen came to look up
  // an icon that was not there and crash on a plain direct message.
  | 'message'
  | 'law_updated'
  | 'voice_used';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  /**
   * What the notification points at.
   *
   * THIS IS WHAT THE SERVER ACTUALLY SENDS. The two fields below it were
   * invented by an early mock and the backend has never set either of them,
   * which is why tapping a notification on this phone went nowhere at all.
   */
  data?: {
    conversationId?: string;
    postId?: string;
    commentId?: string;
    governmentReferenceId?: string;
    fromUserId?: string;
  } | null;
  // Legacy shape, still read as a fallback so an older payload is not dropped.
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
  messages: boolean;
  lawUpdates: boolean;
  voiceUsed: boolean;
  /** Not a notification — Bill of Rights Article II, the reader's own switch. */
  showOtherSide: boolean;
  /** Not a notification — Bill of Rights Article IV. */
  voteAnonymously: boolean;
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
  messages: true,
  lawUpdates: true,
  voiceUsed: true,
  showOtherSide: true,
  voteAnonymously: false,
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
    } catch {
      // AN UNREACHABLE BACKEND SHOWS NOTHING, NOT SOMETHING.
      //
      // This used to fall back to seven invented notifications — named
      // strangers who had liked posts that do not exist, with an unread badge
      // to match. On a platform whose whole claim is that everything traces to
      // a real record, a fabricated bell is the worst possible failure state:
      // it is indistinguishable from the truth to the person reading it.
      set({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: 'Could not load notifications',
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
