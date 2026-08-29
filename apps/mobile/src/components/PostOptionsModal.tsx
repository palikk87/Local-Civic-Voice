import { useAuthStore } from '@/lib/auth-store';
import React from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Trash2,
  Edit3,
  Flag,
  UserMinus,
  Share2,
  Copy,
  Bookmark,
  VolumeX,
  AlertTriangle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { type TimelinePost } from '@/lib/timeline-store';

interface PostOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  post: TimelinePost | null;
  onDelete?: (postId: string) => void;
  onEdit?: (post: TimelinePost) => void;
  onShare?: (post: TimelinePost) => void;
  onReport?: (postId: string) => void;
  onBlock?: (userId: string) => void;
  onMute?: (userId: string) => void;
}

interface OptionItem {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  ownerOnly?: boolean;
  nonOwnerOnly?: boolean;
}

export default function PostOptionsModal({
  visible,
  onClose,
  post,
  onDelete,
  onEdit,
  onShare,
  onReport,
  onBlock,
  onMute,
}: PostOptionsModalProps) {
  // The real signed-in account, not the fictional `currentUser` from
  // mock-data. This decides whether "delete post" is offered, so reading a
  // fixed id meant the check was answering about somebody else.
  //
  // Above the early return: hooks must run in the same order on every render,
  // and `post` is null while the sheet is closed.
  const me = useAuthStore((s) => s.user);

  if (!post) return null;

  const isOwner = !!me && post.author.id === me.id;

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
  };

  const handleAction = (action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    action();
    onClose();
  };

  // Define all options
  const allOptions: OptionItem[] = [
    // Owner options
    {
      icon: <Edit3 size={20} color="#F59E0B" />,
      label: 'Edit Post',
      onPress: () => onEdit?.(post),
      ownerOnly: true,
    },
    {
      icon: <Trash2 size={20} color="#EF4444" />,
      label: 'Delete Post',
      onPress: () => onDelete?.(post.id),
      destructive: true,
      ownerOnly: true,
    },
    // Shared options (both owner and non-owner)
    {
      icon: <Share2 size={20} color="#3B82F6" />,
      label: 'Share Post',
      onPress: () => onShare?.(post),
    },
    {
      icon: <Copy size={20} color="#6E8A7C" />,
      label: 'Copy Link',
      onPress: () => {
        // Copy link logic would go here
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    },
    {
      icon: <Bookmark size={20} color="#6E8A7C" />,
      label: 'Save Post',
      onPress: () => {
        // Save post logic
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    },
    // Non-owner options
    {
      icon: <VolumeX size={20} color="#6E8A7C" />,
      label: `Mute @${post.author.username}`,
      onPress: () => onMute?.(post.author.id),
      nonOwnerOnly: true,
    },
    {
      icon: <UserMinus size={20} color="#F59E0B" />,
      label: `Unfollow @${post.author.username}`,
      onPress: () => {
        // Unfollow logic
      },
      nonOwnerOnly: true,
    },
    {
      icon: <Flag size={20} color="#EF4444" />,
      label: 'Report Post',
      onPress: () => onReport?.(post.id),
      destructive: true,
      nonOwnerOnly: true,
    },
    {
      icon: <AlertTriangle size={20} color="#EF4444" />,
      label: `Block @${post.author.username}`,
      onPress: () => onBlock?.(post.author.id),
      destructive: true,
      nonOwnerOnly: true,
    },
  ];

  // Filter options based on ownership
  const visibleOptions = allOptions.filter((option) => {
    if (option.ownerOnly && !isOwner) return false;
    if (option.nonOwnerOnly && isOwner) return false;
    return true;
  });

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-black/60 justify-end">
        <Pressable className="flex-1" onPress={handleClose} />

        <Animated.View
          entering={SlideInDown.springify().damping(20)}
          className="bg-slate-900 rounded-t-3xl overflow-hidden"
          // NEVER TALLER THAN THE PHONE. Reported on the web as "you cant
          // scroll on the pop up windows"; the same sheet here had the same
          // ceiling — none — so the top of a long one was simply gone.
          style={{ maxHeight: '85%' }}
        >
          <LinearGradient
            colors={['#17362A', '#0C1D18']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          />

          <SafeAreaView edges={['bottom']}>
            {/* Handle bar */}
            <View className="items-center pt-3 pb-2">
              <View className="w-10 h-1 rounded-full bg-slate-600" />
            </View>

            {/* Header */}
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
              <Text className="text-white font-semibold text-lg">
                {isOwner ? 'Manage Your Post' : 'Post Options'}
              </Text>
              <Pressable
                onPress={handleClose}
                className="w-8 h-8 items-center justify-center rounded-full bg-slate-800"
              >
                <X size={18} color="#8FA79A" />
              </Pressable>
            </View>

            {/* Options list — scrolls, so a long one is never cut off. */}
            <ScrollView className="px-4 py-2" showsVerticalScrollIndicator={false}>
              {visibleOptions.map((option, index) => (
                <Animated.View
                  key={option.label}
                  entering={FadeIn.delay(index * 50)}
                >
                  <Pressable
                    onPress={() => handleAction(option.onPress)}
                    className="flex-row items-center py-4 border-b border-slate-800/50"
                  >
                    <View className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mr-4">
                      {option.icon}
                    </View>
                    <Text
                      className={
                        option.destructive
                          ? 'text-red-400 font-medium text-base'
                          : 'text-white font-medium text-base'
                      }
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                </Animated.View>
              ))}
            </ScrollView>

            {/* Cancel button */}
            <View className="px-4 py-4">
              <Pressable
                onPress={handleClose}
                className="py-4 rounded-xl bg-slate-800 items-center"
              >
                <Text className="text-slate-300 font-semibold text-base">
                  Cancel
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}
