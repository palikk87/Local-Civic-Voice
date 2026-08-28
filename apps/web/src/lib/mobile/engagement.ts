// Engagement & Notifications System - Keep users coming back
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Web port: zustand persist uses localStorage instead of AsyncStorage
// Web port: expo-notifications shim backed by the browser Notification API
const Notifications = {
  async getPermissionsAsync() {
    if (typeof Notification === 'undefined') return { status: 'denied' };
    return { status: Notification.permission === 'granted' ? 'granted' : 'denied' };
  },
  async requestPermissionsAsync() {
    if (typeof Notification === 'undefined') return { status: 'denied' };
    const p = await Notification.requestPermission();
    return { status: p === 'granted' ? 'granted' : 'denied' };
  },
  async scheduleNotificationAsync({ content }: { content: { title: string; body: string; data?: unknown; sound?: boolean }; trigger: null }) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(content.title, { body: content.body });
    }
  },
  async getExpoPushTokenAsync() {
    return { data: '' };
  },
};
import type { Bill, BillCategory } from './types';

// ==========================================
// NOTIFICATION TYPES
// ==========================================

export type NotificationType =
  | 'bill_update' // Bill status changed
  | 'gap_alert' // New significant representation gap
  | 'local_bill' // Bill affecting user's state/district
  | 'trending' // Bill is trending
  | 'vote_reminder' // Reminder to vote on active bills
  | 'streak_risk' // About to lose streak
  | 'streak_milestone' // Hit a streak milestone
  | 'badge_earned' // New badge unlocked
  | 'followed_activity' // Someone you follow voted
  | 'your_rep_voted' // Your representative voted
  | 'outcome_update'; // Bill passed/failed

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: {
    billId?: string;
    badgeId?: string;
    repId?: string;
    gapPct?: number;
    [key: string]: unknown;
  };
  timestamp: string;
  read: boolean;
  actionUrl?: string;
}

// ==========================================
// USER PREFERENCES
// ==========================================

export interface NotificationPreferences {
  // Master toggle
  enabled: boolean;

  // Notification types
  billUpdates: boolean;
  gapAlerts: boolean;
  localBills: boolean;
  trending: boolean;
  voteReminders: boolean;
  streakAlerts: boolean;
  badges: boolean;
  followedActivity: boolean;
  repVotes: boolean;

  // Timing
  quietHoursStart: number; // 0-23
  quietHoursEnd: number;
  reminderTime: number; // hour of day for daily reminder

  // Frequency limits
  maxDailyNotifications: number;
  minTimeBetweenNotifications: number; // minutes
}

export interface LocationPreferences {
  state: string;
  district?: string;
  zipCode?: string;
  enabled: boolean;
}

// ==========================================
// ENGAGEMENT TRIGGERS
// ==========================================

export interface EngagementTrigger {
  id: string;
  type: 'push' | 'in_app' | 'email';
  condition: TriggerCondition;
  template: NotificationTemplate;
  cooldown: number; // minutes before can trigger again
  lastTriggered?: string;
}

export type TriggerCondition =
  | { type: 'gap_threshold'; minGap: number }
  | { type: 'local_bill'; states: string[] }
  | { type: 'category_match'; categories: BillCategory[] }
  | { type: 'inactivity'; days: number }
  | { type: 'streak_at_risk'; hoursRemaining: number }
  | { type: 'bill_deadline'; hoursUntil: number }
  | { type: 'viral_content'; minEngagement: number };

export interface NotificationTemplate {
  title: string;
  bodyTemplate: string; // Uses {{variable}} syntax
  actionLabel?: string;
  actionUrl?: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

// Default engagement triggers (like FB/IG/TikTok)
export const DEFAULT_TRIGGERS: EngagementTrigger[] = [
  // Gap alerts (moral reward driver)
  {
    id: 'gap-alert-30',
    type: 'push',
    condition: { type: 'gap_threshold', minGap: 30 },
    template: {
      title: 'Representation Gap Found!',
      bodyTemplate: '{{gapPct}}% gap on "{{billTitle}}" - Congress disagrees with citizens',
      actionLabel: 'See the Gap',
      urgency: 'high',
    },
    cooldown: 120,
  },

  // Local relevance (drive engagement)
  {
    id: 'local-bill',
    type: 'push',
    condition: { type: 'local_bill', states: [] }, // Filled from user prefs
    template: {
      title: 'Bill Affecting {{state}}',
      bodyTemplate: '"{{billTitle}}" could impact your community. Make your voice heard!',
      actionLabel: 'Vote Now',
      urgency: 'high',
    },
    cooldown: 240,
  },

  // Streak protection (retention)
  {
    id: 'streak-risk',
    type: 'push',
    condition: { type: 'streak_at_risk', hoursRemaining: 4 },
    template: {
      title: 'Save Your {{streak}}-Day Streak!',
      bodyTemplate: 'Vote on a bill in the next {{hours}} hours to keep your streak alive',
      actionLabel: 'Quick Vote',
      urgency: 'high',
    },
    cooldown: 1440, // Once per day max
  },

  // Re-engagement
  {
    id: 'inactivity-3d',
    type: 'push',
    condition: { type: 'inactivity', days: 3 },
    template: {
      title: 'Democracy Needs You!',
      bodyTemplate: '{{newBills}} new bills since your last visit. Your vote matters!',
      actionLabel: 'Catch Up',
      urgency: 'medium',
    },
    cooldown: 4320, // 3 days
  },

  // Viral/trending (FOMO)
  {
    id: 'viral-bill',
    type: 'push',
    condition: { type: 'viral_content', minEngagement: 1000 },
    template: {
      title: 'Trending: {{billTitle}}',
      bodyTemplate: '{{votes}} people have voted. Join the conversation!',
      actionLabel: 'See Why',
      urgency: 'medium',
    },
    cooldown: 360,
  },

  // Urgency (time-sensitive)
  {
    id: 'bill-deadline',
    type: 'push',
    condition: { type: 'bill_deadline', hoursUntil: 24 },
    template: {
      title: 'Vote Closes in {{hours}} Hours',
      bodyTemplate: '"{{billTitle}}" is heading to a final vote. Make your opinion count!',
      actionLabel: 'Vote Now',
      urgency: 'critical',
    },
    cooldown: 720,
  },
];

// ==========================================
// ENGAGEMENT STORE
// ==========================================

interface EngagementState {
  // Notifications
  notifications: AppNotification[];
  unreadCount: number;

  // Preferences
  notificationPrefs: NotificationPreferences;
  locationPrefs: LocationPreferences;

  // Triggers
  activeTriggers: EngagementTrigger[];
  triggerCooldowns: Record<string, string>; // triggerId -> lastTriggered ISO

  // Session tracking
  sessionCount: number;
  lastSessionStart: string;
  totalTimeSpent: number; // minutes
  currentSessionStart?: string;

  // Actions
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  markAsRead: (notificationId: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;

  updateNotificationPrefs: (prefs: Partial<NotificationPreferences>) => void;
  updateLocationPrefs: (prefs: Partial<LocationPreferences>) => void;

  checkTrigger: (triggerId: string) => boolean;
  recordTriggerFired: (triggerId: string) => void;

  startSession: () => void;
  endSession: () => void;

  // Getters
  getUnreadNotifications: () => AppNotification[];
  shouldSendNotification: (type: NotificationType) => boolean;
}

export const useEngagementStore = create<EngagementState>()(
  persist(
    (set, get) => ({
      notifications: [],
      unreadCount: 0,

      notificationPrefs: {
        enabled: true,
        billUpdates: true,
        gapAlerts: true,
        localBills: true,
        trending: true,
        voteReminders: true,
        streakAlerts: true,
        badges: true,
        followedActivity: true,
        repVotes: true,
        quietHoursStart: 22,
        quietHoursEnd: 8,
        reminderTime: 12,
        maxDailyNotifications: 10,
        minTimeBetweenNotifications: 30,
      },

      locationPrefs: {
        state: '',
        district: undefined,
        zipCode: undefined,
        enabled: false,
      },

      activeTriggers: DEFAULT_TRIGGERS,
      triggerCooldowns: {},

      sessionCount: 0,
      lastSessionStart: '',
      totalTimeSpent: 0,
      currentSessionStart: undefined,

      // Add a notification
      addNotification: (notification) => {
        const state = get();

        // Check if we should send this notification
        if (!state.shouldSendNotification(notification.type)) return;

        const newNotification: AppNotification = {
          ...notification,
          id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          read: false,
        };

        set({
          notifications: [newNotification, ...state.notifications].slice(0, 100), // Keep last 100
          unreadCount: state.unreadCount + 1,
        });

        // Schedule push notification if enabled
        if (state.notificationPrefs.enabled) {
          schedulePushNotification(newNotification);
        }
      },

      markAsRead: (notificationId) => {
        const state = get();
        const notification = state.notifications.find(n => n.id === notificationId);

        if (notification && !notification.read) {
          set({
            notifications: state.notifications.map(n =>
              n.id === notificationId ? { ...n, read: true } : n
            ),
            unreadCount: Math.max(0, state.unreadCount - 1),
          });
        }
      },

      markAllAsRead: () => {
        const state = get();
        set({
          notifications: state.notifications.map(n => ({ ...n, read: true })),
          unreadCount: 0,
        });
      },

      clearNotifications: () => {
        set({ notifications: [], unreadCount: 0 });
      },

      updateNotificationPrefs: (prefs) => {
        const state = get();
        set({
          notificationPrefs: { ...state.notificationPrefs, ...prefs },
        });
      },

      updateLocationPrefs: (prefs) => {
        const state = get();
        set({
          locationPrefs: { ...state.locationPrefs, ...prefs },
        });
      },

      checkTrigger: (triggerId) => {
        const state = get();
        const lastTriggered = state.triggerCooldowns[triggerId];
        const trigger = state.activeTriggers.find(t => t.id === triggerId);

        if (!trigger) return false;
        if (!lastTriggered) return true;

        const cooldownMs = trigger.cooldown * 60 * 1000;
        const timeSince = Date.now() - new Date(lastTriggered).getTime();

        return timeSince >= cooldownMs;
      },

      recordTriggerFired: (triggerId) => {
        const state = get();
        set({
          triggerCooldowns: {
            ...state.triggerCooldowns,
            [triggerId]: new Date().toISOString(),
          },
        });
      },

      startSession: () => {
        const state = get();
        set({
          sessionCount: state.sessionCount + 1,
          currentSessionStart: new Date().toISOString(),
          lastSessionStart: new Date().toISOString(),
        });
      },

      endSession: () => {
        const state = get();
        if (state.currentSessionStart) {
          const duration = (Date.now() - new Date(state.currentSessionStart).getTime()) / 60000;
          set({
            totalTimeSpent: state.totalTimeSpent + duration,
            currentSessionStart: undefined,
          });
        }
      },

      getUnreadNotifications: () => {
        return get().notifications.filter(n => !n.read);
      },

      shouldSendNotification: (type) => {
        const state = get();
        const prefs = state.notificationPrefs;

        if (!prefs.enabled) return false;

        // Check quiet hours
        const hour = new Date().getHours();
        if (prefs.quietHoursStart < prefs.quietHoursEnd) {
          if (hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd) return false;
        } else {
          if (hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd) return false;
        }

        // Check daily limit
        const today = new Date().toISOString().split('T')[0];
        const todayCount = state.notifications.filter(n =>
          n.timestamp.startsWith(today)
        ).length;
        if (todayCount >= prefs.maxDailyNotifications) return false;

        // Check time between notifications
        if (state.notifications.length > 0) {
          const lastNotif = state.notifications[0];
          const minsSince = (Date.now() - new Date(lastNotif.timestamp).getTime()) / 60000;
          if (minsSince < prefs.minTimeBetweenNotifications) return false;
        }

        // Check type-specific preference
        const typePrefs: Record<NotificationType, boolean> = {
          bill_update: prefs.billUpdates,
          gap_alert: prefs.gapAlerts,
          local_bill: prefs.localBills,
          trending: prefs.trending,
          vote_reminder: prefs.voteReminders,
          streak_risk: prefs.streakAlerts,
          streak_milestone: prefs.streakAlerts,
          badge_earned: prefs.badges,
          followed_activity: prefs.followedActivity,
          your_rep_voted: prefs.repVotes,
          outcome_update: prefs.billUpdates,
        };

        return typePrefs[type] ?? true;
      },
    }),
    {
      name: 'civic-engagement-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        notifications: state.notifications.slice(0, 50), // Only persist last 50
        unreadCount: state.unreadCount,
        notificationPrefs: state.notificationPrefs,
        locationPrefs: state.locationPrefs,
        triggerCooldowns: state.triggerCooldowns,
        sessionCount: state.sessionCount,
        lastSessionStart: state.lastSessionStart,
        totalTimeSpent: state.totalTimeSpent,
      }),
    }
  )
);

// ==========================================
// PUSH NOTIFICATION HELPERS
// ==========================================

async function schedulePushNotification(notification: AppNotification) {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sound: true,
      },
      trigger: null, // Immediate
    });
  } catch (error) {
    console.log('Failed to schedule notification:', error);
  }
}

export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  } catch {
    return false;
  }
}

export async function registerForPushNotifications(): Promise<string | null> {
  try {
    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch {
    return null;
  }
}

// ==========================================
// NOTIFICATION GENERATORS
// ==========================================

export function createGapNotification(bill: Bill, gapPct: number): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'gap_alert',
    title: 'Representation Gap Found!',
    body: `${Math.round(gapPct)}% gap on "${bill.shortTitle}" - See how Congress differs from citizens`,
    data: { billId: bill.id, gapPct },
    actionUrl: `/reference/${bill.id}`,
  };
}

export function createLocalBillNotification(bill: Bill, state: string): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'local_bill',
    title: `Bill Affecting ${state}`,
    body: `"${bill.shortTitle}" could impact your community. Make your voice heard!`,
    data: { billId: bill.id },
    actionUrl: `/reference/${bill.id}`,
  };
}

export function createStreakRiskNotification(streakDays: number, hoursRemaining: number): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'streak_risk',
    title: `Save Your ${streakDays}-Day Streak!`,
    body: `Vote on a bill in the next ${hoursRemaining} hours to keep your streak alive`,
    data: { streakDays, hoursRemaining },
    actionUrl: '/',
  };
}

export function createBadgeNotification(badgeName: string, badgeIcon: string): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'badge_earned',
    title: `${badgeIcon} Badge Earned!`,
    body: `You've unlocked "${badgeName}". Keep up the civic engagement!`,
    data: { badgeName },
    actionUrl: '/profile',
  };
}

export function createTrendingNotification(bill: Bill, voteCount: number): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'trending',
    title: `Trending: ${bill.shortTitle}`,
    body: `${voteCount.toLocaleString()} people have voted. Join the conversation!`,
    data: { billId: bill.id, voteCount },
    actionUrl: `/reference/${bill.id}`,
  };
}

export function createRepVotedNotification(
  repName: string,
  bill: Bill,
  vote: 'yea' | 'nay'
): Omit<AppNotification, 'id' | 'timestamp' | 'read'> {
  return {
    type: 'your_rep_voted',
    title: `${repName} Voted ${vote.toUpperCase()}`,
    body: `Your representative voted on "${bill.shortTitle}". Do you agree?`,
    data: { billId: bill.id, repName, vote },
    actionUrl: `/reference/${bill.id}`,
  };
}

// Selectors
export const selectUnreadCount = (state: EngagementState | undefined) => state?.unreadCount ?? 0;
export const selectNotificationPrefs = (state: EngagementState | undefined) => state?.notificationPrefs ?? { enabled: true, billUpdates: true, gapAlerts: true, localBills: true, trending: true, voteReminders: true, streakAlerts: true, badges: true, followedActivity: true, repVotes: true, quietHoursStart: 22, quietHoursEnd: 8, reminderTime: 12, maxDailyNotifications: 10, minTimeBetweenNotifications: 30 };
export const selectLocationPrefs = (state: EngagementState | undefined) => state?.locationPrefs ?? { state: '', district: undefined, zipCode: undefined, enabled: false };
