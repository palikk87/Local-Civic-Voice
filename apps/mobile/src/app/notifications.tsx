import React, { useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Heart,
  MessageCircle,
  Reply,
  AtSign,
  UserPlus,
  Repeat2,
  FileText,
  Bell,
  Settings,
  CheckCheck,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import {
  useNotificationStore,
  selectNotifications,
  selectUnreadCount,
  selectIsLoading,
  type Notification,
  type NotificationType,
} from '@/lib/notification-store';
import { cn } from '@/lib/cn';
import { AuthGate } from '@/components/auth/AuthGate';

// Time ago helper
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Icon mapping for notification types
const notificationIcons: Record<NotificationType, { icon: typeof Heart; color: string }> = {
  like: { icon: Heart, color: '#EF4444' },
  comment: { icon: MessageCircle, color: '#3B82F6' },
  reply: { icon: Reply, color: '#8B5CF6' },
  mention: { icon: AtSign, color: '#F59E0B' },
  follow: { icon: UserPlus, color: '#22C55E' },
  repost: { icon: Repeat2, color: '#06B6D4' },
  new_follower_post: { icon: FileText, color: '#EC4899' },
};

// Single notification item
function NotificationItem({
  notification,
  index,
  onPress,
}: {
  notification: Notification;
  index: number;
  onPress: () => void;
}) {
  const iconConfig = notificationIcons[notification.type];
  const IconComponent = iconConfig.icon;

  return (
    <Animated.View entering={FadeInDown.delay(index * 30).springify()}>
      <Pressable
        onPress={onPress}
        className={cn(
          'flex-row items-start px-4 py-4 border-b border-slate-800',
          !notification.isRead && 'bg-slate-800/40'
        )}
      >
        {/* Icon */}
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${iconConfig.color}20` }}
        >
          <IconComponent
            size={20}
            color={iconConfig.color}
            fill={notification.type === 'like' ? iconConfig.color : 'transparent'}
          />
        </View>

        {/* Content */}
        <View className="flex-1">
          {/* Actor avatar and title row */}
          <View className="flex-row items-center mb-1">
            {notification.actor && (
              <Image
                source={{ uri: notification.actor.avatar }}
                className="w-6 h-6 rounded-full mr-2"
              />
            )}
            <Text className="text-white font-semibold flex-1" numberOfLines={1}>
              {notification.title}
            </Text>
            {/* Unread indicator */}
            {!notification.isRead && (
              <View className="w-2.5 h-2.5 rounded-full bg-amber-500 ml-2" />
            )}
          </View>

          {/* Body */}
          <Text className="text-slate-400 text-sm leading-5" numberOfLines={2}>
            {notification.body}
          </Text>

          {/* Time */}
          <Text className="text-slate-500 text-xs mt-1.5">
            {getTimeAgo(notification.createdAt)}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Empty state component
function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-20">
      <Animated.View entering={FadeIn.delay(100)}>
        <View className="w-24 h-24 rounded-full bg-slate-800 items-center justify-center mb-4">
          <Bell size={48} color="#64748B" />
        </View>
        <Text className="text-white font-semibold text-lg text-center">
          No notifications yet
        </Text>
        <Text className="text-slate-400 text-sm mt-2 text-center px-8">
          When you get likes, comments, follows, and more, they will show up here.
        </Text>
      </Animated.View>
    </View>
  );
}

export default function NotificationsScreen() {
  return (
    <AuthGate capability="viewNotifications" reason="Sign in to see your notifications.">
      <NotificationsContent />
    </AuthGate>
  );
}

function NotificationsContent() {
  const router = useRouter();

  // Zustand selectors
  const notifications = useNotificationStore(selectNotifications);
  const unreadCount = useNotificationStore(selectUnreadCount);
  const isLoading = useNotificationStore(selectIsLoading);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
  const markAsRead = useNotificationStore((s) => s.markAsRead);
  const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const onRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchNotifications(true);
  }, [fetchNotifications]);

  const handleNotificationPress = (notification: Notification) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Mark as read
    if (!notification.isRead) {
      markAsRead(notification.id);
    }

    // Navigate based on reference type
    if (notification.referenceType === 'user' && notification.referenceId) {
      router.push(`/user/${notification.referenceId}`);
    } else if (notification.referenceType === 'post' && notification.referenceId) {
      // For now, navigate to timeline - could add post detail screen later
      router.push('/(tabs)/timeline');
    } else if (notification.referenceType === 'bill' && notification.referenceId) {
      router.push(`/bill/${notification.referenceId}`);
    }
  };

  const handleMarkAllAsRead = () => {
    if (unreadCount > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      markAllAsRead();
    }
  };

  const handleSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/notification-settings');
  };

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
          <View className="flex-row items-center">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mr-3"
            >
              <ArrowLeft size={20} color="#F59E0B" />
            </Pressable>
            <View>
              <Text className="text-xl font-bold text-white">Notifications</Text>
              {unreadCount > 0 && (
                <Text className="text-amber-500 text-sm">
                  {unreadCount} unread
                </Text>
              )}
            </View>
          </View>

          <View className="flex-row items-center">
            {/* Mark all as read */}
            {unreadCount > 0 && (
              <Pressable
                onPress={handleMarkAllAsRead}
                className="flex-row items-center bg-amber-500/20 px-3 py-2 rounded-full mr-2"
              >
                <CheckCheck size={16} color="#F59E0B" />
                <Text className="text-amber-500 text-xs font-medium ml-1.5">
                  Mark all read
                </Text>
              </Pressable>
            )}

            {/* Settings */}
            <Pressable
              onPress={handleSettings}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center"
            >
              <Settings size={20} color="#94A3B8" />
            </Pressable>
          </View>
        </View>

        {/* Notification list */}
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
              colors={['#F59E0B']}
            />
          }
          renderItem={({ item, index }) => (
            <NotificationItem
              notification={item}
              index={index}
              onPress={() => handleNotificationPress(item)}
            />
          )}
          ListEmptyComponent={!isLoading ? <EmptyState /> : null}
        />
      </SafeAreaView>
    </View>
  );
}
