import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  Image,
  FlatList,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Share2,
  MessageCircle,
  Send,
  Copy,
  FileText,
  Check,
  AlertCircle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useTimelineStore, type TimelinePost } from '@/lib/timeline-store';
import { useAuthStore } from '@/lib/auth-store';
import { useDiscoverUsers } from '@/lib/api/hooks';
import type { User } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useRequireAuth } from '@/lib/auth/use-civic-auth';

type ShareTarget = 'timeline' | 'message';

interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  post?: TimelinePost;
  content?: {
    type: 'bill' | 'executive_order' | 'scotus_case';
    id: string;
    title: string;
  };
}

export default function ShareModal({
  visible,
  onClose,
  post,
  content,
}: ShareModalProps) {
  const requireAuth = useRequireAuth();
  const [shareTarget, setShareTarget] = useState<ShareTarget>('timeline');
  const [opinion, setOpinion] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Real people, from /api/users/discover. This list used to be `sampleUsers`
  // from mock-data — a fixed cast of invented accounts — so "share to message"
  // offered strangers who do not exist and sent nowhere.
  const me = useAuthStore((s) => s.user);
  const { data: people } = useDiscoverUsers();
  const shareTargets = (people?.results ?? []).filter((u) => u.id !== me?.id);
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const sharePost = useTimelineStore((s) => s.sharePost);
  const shareContent = useTimelineStore((s) => s.shareContent);
  const shareToMessage = useTimelineStore((s) => s.shareToMessage);

  const shareTitle = post
    ? post.sharedContent?.title ?? post.content.slice(0, 50) + '...'
    : content?.title ?? '';

  const shareType = post
    ? post.contentType
    : content?.type ?? 'text';

  const handleShareToTimeline = async () => {
    if (!requireAuth('Sign in to share to your timeline.')) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShareError(null);
    setIsSharing(true);

    try {
      if (post) {
        sharePost(post.id, opinion || undefined);
      } else if (content) {
        // Sharing a reference publishes a real post, so it can fail. Keep the
        // sheet open and say why rather than closing as if it worked.
        await shareContent(content.type, content.id, content.title, opinion || undefined);
      }
    } catch (error) {
      setIsSharing(false);
      setShareError(error instanceof Error ? error.message : 'Could not share. Please try again.');
      return;
    }

    setIsSharing(false);
    setOpinion('');
    onClose();
  };

  const handleShareToMessage = () => {
    if (!requireAuth('Sign in to send this in a message.')) return;

    if (!selectedUser || !post) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    shareToMessage(selectedUser.id, post);

    setSelectedUser(null);
    setOpinion('');
    onClose();
  };

  const handleCopyLink = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOpinion('');
    setSelectedUser(null);
    setShareTarget('timeline');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0F172A', '#1E293B', '#0F172A']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 items-center justify-center"
            >
              <X size={24} color="#94A3B8" />
            </Pressable>

            <Text className="text-white font-semibold text-lg">Share</Text>

            <View className="w-10" />
          </View>

          {/* Content Preview */}
          <Animated.View
            entering={FadeIn}
            className="mx-4 mt-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700/50"
          >
            <View className="flex-row items-start">
              <View className="w-10 h-10 rounded-lg bg-amber-500/20 items-center justify-center mr-3">
                <FileText size={20} color="#F59E0B" />
              </View>
              <View className="flex-1">
                <Text className="text-slate-400 text-xs mb-1">
                  {shareType === 'bill'
                    ? 'Bill'
                    : shareType === 'executive_order'
                    ? 'Executive Order'
                    : shareType === 'scotus_case'
                    ? 'Supreme Court Case'
                    : 'Post'}
                </Text>
                <Text className="text-white font-medium" numberOfLines={2}>
                  {shareTitle}
                </Text>
              </View>
            </View>
          </Animated.View>

          {/* Share Options */}
          <View className="flex-row px-4 mt-4">
            <Pressable
              onPress={() => setShareTarget('timeline')}
              className={cn(
                'flex-1 py-3 rounded-xl mr-2 items-center border',
                shareTarget === 'timeline'
                  ? 'bg-amber-500/20 border-amber-500/50'
                  : 'bg-slate-800/60 border-slate-700/50'
              )}
            >
              <Share2
                size={20}
                color={shareTarget === 'timeline' ? '#F59E0B' : '#64748B'}
              />
              <Text
                className={cn(
                  'mt-1 font-medium',
                  shareTarget === 'timeline' ? 'text-amber-500' : 'text-slate-400'
                )}
              >
                Timeline
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShareTarget('message')}
              className={cn(
                'flex-1 py-3 rounded-xl items-center border',
                shareTarget === 'message'
                  ? 'bg-amber-500/20 border-amber-500/50'
                  : 'bg-slate-800/60 border-slate-700/50'
              )}
            >
              <MessageCircle
                size={20}
                color={shareTarget === 'message' ? '#F59E0B' : '#64748B'}
              />
              <Text
                className={cn(
                  'mt-1 font-medium',
                  shareTarget === 'message' ? 'text-amber-500' : 'text-slate-400'
                )}
              >
                Message
              </Text>
            </Pressable>
          </View>

          {/* Share to Timeline */}
          {shareTarget === 'timeline' && (
            <Animated.View entering={FadeInDown} className="flex-1 px-4 mt-4">
              <Text className="text-slate-400 text-sm mb-2">
                Add your opinion (optional)
              </Text>
              <View className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                <View className="flex-row mb-3">
                  <Image
                    source={{ uri: me?.avatar }}
                    className="w-10 h-10 rounded-full"
                  />
                  <View className="ml-3">
                    <Text className="text-white font-semibold">
                      {me?.displayName ?? ""}
                    </Text>
                    <Text className="text-slate-400 text-sm">
                      @{me?.username ?? ""}
                    </Text>
                  </View>
                </View>

                <TextInput
                  value={opinion}
                  onChangeText={setOpinion}
                  placeholder="What do you think about this?"
                  placeholderTextColor="#64748B"
                  multiline
                  className="text-white text-base min-h-24"
                  textAlignVertical="top"
                />
              </View>

              {/* Sharing failure — nothing was published, so say so plainly */}
              {shareError ? (
                <Animated.View
                  entering={FadeIn}
                  className="mt-3 flex-row items-start bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2.5"
                >
                  <AlertCircle size={16} color="#F87171" style={{ marginTop: 2 }} />
                  <Text className="text-red-300 text-sm ml-2 flex-1">{shareError}</Text>
                </Animated.View>
              ) : null}

              <Pressable
                onPress={handleShareToTimeline}
                disabled={isSharing}
                className={cn(
                  'mt-4 py-4 rounded-xl items-center flex-row justify-center',
                  isSharing ? 'bg-slate-700' : 'bg-amber-500'
                )}
              >
                <Share2 size={20} color={isSharing ? '#94A3B8' : '#0F172A'} />
                <Text
                  className={cn(
                    'font-semibold text-lg ml-2',
                    isSharing ? 'text-slate-400' : 'text-slate-900'
                  )}
                >
                  {isSharing ? 'Sharing…' : 'Share to Timeline'}
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Share to Message */}
          {shareTarget === 'message' && (
            <Animated.View entering={FadeInDown} className="flex-1 px-4 mt-4">
              <Text className="text-slate-400 text-sm mb-2">
                Select a person to share with
              </Text>

              <FlatList
                data={shareTargets}
                keyExtractor={(item) => item.id}
                className="flex-1"
                renderItem={({ item, index }) => (
                  <Animated.View entering={FadeInDown.delay(index * 50)}>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        // /api/users/discover returns ApiUser, which omits the
                        // local counts. Zero rather than invented — they are
                        // display-only here and the real values come with the
                        // profile.
                        setSelectedUser({
                          ...item,
                          followers: 0,
                          following: 0,
                          votesCount: 0,
                        } as User);
                      }}
                      className={cn(
                        'flex-row items-center p-3 rounded-xl mb-2 border',
                        selectedUser?.id === item.id
                          ? 'bg-amber-500/20 border-amber-500/50'
                          : 'bg-slate-800/60 border-slate-700/50'
                      )}
                    >
                      <Image
                        source={{ uri: item.avatar }}
                        className="w-12 h-12 rounded-full"
                      />
                      <View className="flex-1 ml-3">
                        <Text className="text-white font-semibold">
                          {item.displayName}
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          @{item.username}
                        </Text>
                      </View>
                      {selectedUser?.id === item.id && (
                        <View className="w-6 h-6 rounded-full bg-amber-500 items-center justify-center">
                          <Check size={14} color="#0F172A" />
                        </View>
                      )}
                    </Pressable>
                  </Animated.View>
                )}
              />

              <Pressable
                onPress={handleShareToMessage}
                disabled={!selectedUser}
                className={cn(
                  'mt-4 py-4 rounded-xl items-center flex-row justify-center',
                  selectedUser ? 'bg-amber-500' : 'bg-slate-700'
                )}
              >
                <Send size={20} color={selectedUser ? '#0F172A' : '#64748B'} />
                <Text
                  className={cn(
                    'font-semibold text-lg ml-2',
                    selectedUser ? 'text-slate-900' : 'text-slate-500'
                  )}
                >
                  Send Message
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Copy Link */}
          <View className="px-4 pb-4 mt-4">
            <Pressable
              onPress={handleCopyLink}
              className="flex-row items-center justify-center py-3 bg-slate-800/60 rounded-xl border border-slate-700/50"
            >
              {copied ? (
                <>
                  <Check size={18} color="#22C55E" />
                  <Text className="text-emerald-500 font-medium ml-2">
                    Link Copied!
                  </Text>
                </>
              ) : (
                <>
                  <Copy size={18} color="#64748B" />
                  <Text className="text-slate-400 font-medium ml-2">
                    Copy Link
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
