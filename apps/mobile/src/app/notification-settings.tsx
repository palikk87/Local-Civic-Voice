import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Switch,
  ActivityIndicator,
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
  MessageSquare,
  UserCheck,
  EyeOff,
  Scale,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { ChangePassword } from '@/components/settings/ChangePassword';
import { CloseAccount } from '@/components/settings/CloseAccount';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  useNotificationStore,
  selectPreferences,
  type NotificationPreferences,
} from '@/lib/notification-store';
import { AuthGate } from '@/components/auth/AuthGate';

// Preference item configuration
interface PreferenceConfig {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  icon: typeof Heart;
  color: string;
}

const preferenceItems: PreferenceConfig[] = [
  {
    key: 'likes',
    title: 'Likes',
    description: 'When someone likes your post',
    icon: Heart,
    color: '#EF4444',
  },
  {
    key: 'comments',
    title: 'Comments',
    description: 'When someone comments on your post',
    icon: MessageCircle,
    color: '#3B82F6',
  },
  {
    key: 'replies',
    title: 'Replies',
    description: 'When someone replies to your comment',
    icon: Reply,
    color: '#8B5CF6',
  },
  {
    key: 'mentions',
    title: 'Mentions',
    description: 'When someone mentions you',
    icon: AtSign,
    color: '#F59E0B',
  },
  {
    key: 'follows',
    title: 'Follows',
    description: 'When someone follows you',
    icon: UserPlus,
    color: '#22C55E',
  },
  {
    key: 'reposts',
    title: 'Reposts',
    description: 'When someone reposts your content',
    icon: Repeat2,
    color: '#06B6D4',
  },
  {
    key: 'newFollowerPosts',
    title: 'New Follower Posts',
    description: 'When someone you follow posts',
    icon: FileText,
    color: '#EC4899',
  },
  {
    key: 'messages',
    title: 'Messages',
    description: 'When someone sends you a message',
    icon: MessageSquare,
    color: '#0EA5E9',
  },
  // These two were written by the backend and could not be turned off by
  // anybody: they were missing from the request schema and from both settings
  // screens. A preference the product uses but nobody can change is worse than
  // no preference at all.
  {
    key: 'lawUpdates',
    title: 'A law you shared changed',
    description: 'When the government amends text you put your name to',
    icon: FileText,
    color: '#F59E0B',
  },
  {
    key: 'voiceUsed',
    title: 'Your voice was used',
    description:
      'When somebody you delegated to votes in your name. Leaving this on is how you find out in time to vote for yourself instead.',
    icon: UserCheck,
    color: '#F59E0B',
  },
  // BILL OF RIGHTS ARTICLE IV. The article lists an anonymous voting option as
  // a right of the people and there was no such thing until now.
  {
    key: 'voteAnonymously',
    title: 'Vote anonymously',
    description:
      'Your vote still counts in the Pulse exactly as it would otherwise, including through anyone who delegated to you. What is withheld is your name. You still see your own record in full.',
    icon: EyeOff,
    color: '#8B5CF6',
  },
  // BILL OF RIGHTS ARTICLE II. Reserving part of a feed by viewpoint is the
  // platform deciding prominence; a citizen choosing it for themselves is the
  // human intent Article II says the platform should be a conduit for.
  {
    key: 'showOtherSide',
    title: 'Show me the other side',
    description:
      'Keeps up to a fifth of your feed for people who voted the opposite way to you on a law you both voted on, marked so you know why. Added to your feed, never swapped in.',
    icon: Scale,
    color: '#EF4444',
  },
];

// Single toggle item
function PreferenceToggle({
  config,
  value,
  onToggle,
  index,
  isSaving,
}: {
  config: PreferenceConfig;
  value: boolean;
  onToggle: (key: keyof NotificationPreferences, value: boolean) => void;
  index: number;
  isSaving: boolean;
}) {
  const IconComponent = config.icon;

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
      <Pressable
        onPress={() => {
          if (!isSaving) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onToggle(config.key, !value);
          }
        }}
        className="flex-row items-center bg-slate-800/60 rounded-xl p-4 mb-3"
      >
        {/* Icon */}
        <View
          className="w-10 h-10 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${config.color}20` }}
        >
          <IconComponent
            size={20}
            color={config.color}
            fill={config.key === 'likes' ? config.color : 'transparent'}
          />
        </View>

        {/* Text */}
        <View className="flex-1">
          <Text className="text-white font-semibold text-base">{config.title}</Text>
          <Text className="text-slate-400 text-sm mt-0.5">{config.description}</Text>
        </View>

        {/* Toggle */}
        <Switch
          value={value}
          onValueChange={(newValue) => {
            if (!isSaving) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggle(config.key, newValue);
            }
          }}
          trackColor={{ false: '#2C4A3C', true: '#F59E0B50' }}
          thumbColor={value ? '#F59E0B' : '#6E8A7C'}
          ios_backgroundColor="#2C4A3C"
          disabled={isSaving}
        />
      </Pressable>
    </Animated.View>
  );
}

export default function NotificationSettingsScreen() {
  return (
    <AuthGate capability="viewSettings" reason="Sign in to manage your account settings.">
      <NotificationSettingsContent />
    </AuthGate>
  );
}

function NotificationSettingsContent() {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [localPreferences, setLocalPreferences] = useState<NotificationPreferences | null>(null);

  // Zustand selectors
  const preferences = useNotificationStore(selectPreferences);
  const fetchPreferences = useNotificationStore((s) => s.fetchPreferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);

  // Fetch preferences on mount
  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  // Sync local state with store
  useEffect(() => {
    setLocalPreferences(preferences);
  }, [preferences]);

  const handleToggle = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!localPreferences) return;

    // Update local state immediately
    const updatedPreferences = { ...localPreferences, [key]: value };
    setLocalPreferences(updatedPreferences);
    setIsSaving(true);

    try {
      await updatePreferences({ [key]: value });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Revert on error
      setLocalPreferences(localPreferences);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnableAll = async () => {
    if (!localPreferences) return;

    const allEnabled: NotificationPreferences = {
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
      // Deliberately NOT swept by enable-all / disable-all. A ranking choice
      // and a privacy right are not notification noise, and a button labelled
      // "turn everything off" must not silently anonymise somebody or reshape
      // their feed.
      showOtherSide: localPreferences.showOtherSide,
      voteAnonymously: localPreferences.voteAnonymously,
    };

    setLocalPreferences(allEnabled);
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updatePreferences(allEnabled);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setLocalPreferences(localPreferences);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisableAll = async () => {
    if (!localPreferences) return;

    const allDisabled: NotificationPreferences = {
      likes: false,
      comments: false,
      replies: false,
      mentions: false,
      follows: false,
      reposts: false,
      newFollowerPosts: false,
      messages: false,
      lawUpdates: false,
      voiceUsed: false,
      // Deliberately NOT swept by enable-all / disable-all. A ranking choice
      // and a privacy right are not notification noise, and a button labelled
      // "turn everything off" must not silently anonymise somebody or reshape
      // their feed.
      showOtherSide: localPreferences.showOtherSide,
      voteAnonymously: localPreferences.voteAnonymously,
    };

    setLocalPreferences(allDisabled);
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await updatePreferences(allDisabled);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setLocalPreferences(localPreferences);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSaving(false);
    }
  };

  // Check if all are enabled/disabled
  const allEnabled = localPreferences
    ? Object.values(localPreferences).every((v) => v === true)
    : false;
  const allDisabled = localPreferences
    ? Object.values(localPreferences).every((v) => v === false)
    : false;

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
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
            <Text className="text-xl font-bold text-white">Notification Settings</Text>
          </View>

          {isSaving && (
            <ActivityIndicator color="#F59E0B" size="small" />
          )}
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Header info */}
          <View className="flex-row items-center bg-slate-800/40 rounded-xl p-4 mb-6">
            <View className="w-12 h-12 rounded-full bg-amber-500/20 items-center justify-center mr-3">
              <Bell size={24} color="#F59E0B" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold">Manage Notifications</Text>
              <Text className="text-slate-400 text-sm mt-0.5">
                Choose what notifications you want to receive
              </Text>
            </View>
          </View>

          {/* The account holder's own control over their credential. Web twin
              puts the same card at the top of Settings. */}
          <ChangePassword />

          {/* Last, deliberately. It is the one thing on this screen that cannot
              be undone, and it should not sit next to a toggle. Web twin puts
              it at the bottom of Settings for the same reason. */}
          <CloseAccount />

          {/* Quick actions */}
          <View className="flex-row mb-6">
            <Pressable
              onPress={handleEnableAll}
              disabled={allEnabled || isSaving}
              className={`flex-1 py-3 rounded-xl mr-2 items-center ${
                allEnabled || isSaving ? 'bg-slate-800/40' : 'bg-amber-500/20'
              }`}
            >
              <Text
                className={`font-semibold ${
                  allEnabled || isSaving ? 'text-slate-500' : 'text-amber-500'
                }`}
              >
                Enable All
              </Text>
            </Pressable>
            <Pressable
              onPress={handleDisableAll}
              disabled={allDisabled || isSaving}
              className={`flex-1 py-3 rounded-xl ml-2 items-center ${
                allDisabled || isSaving ? 'bg-slate-800/40' : 'bg-slate-700'
              }`}
            >
              <Text
                className={`font-semibold ${
                  allDisabled || isSaving ? 'text-slate-500' : 'text-slate-300'
                }`}
              >
                Disable All
              </Text>
            </Pressable>
          </View>

          {/* Preference toggles */}
          {localPreferences &&
            preferenceItems.map((item, index) => (
              <PreferenceToggle
                key={item.key}
                config={item}
                value={localPreferences[item.key]}
                onToggle={handleToggle}
                index={index}
                isSaving={isSaving}
              />
            ))}

          {/* Footer note */}
          <View className="mt-4 p-4 bg-slate-800/30 rounded-xl">
            <Text className="text-slate-400 text-sm text-center leading-5">
              You can still see all your notifications in the notifications screen,
              but you won't receive push notifications for disabled types.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
