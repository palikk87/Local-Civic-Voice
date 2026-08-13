import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import {
  ArrowLeft,
  Send,
  FileText,
  MoreHorizontal,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeInDown, FadeInUp } from 'react-native-reanimated';
import { type TimelinePost } from '@/lib/timeline-store';
import {
  useConversation,
  useSendMessage,
  type DirectMessage,
} from '@/lib/api/messages';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';
import { cn } from '@/lib/cn';
import { AuthGate } from '@/components/auth/AuthGate';

// Message bubble component
function MessageBubble({
  message,
  isOwn,
  showAvatar,
}: {
  message: DirectMessage;
  isOwn: boolean;
  showAvatar: boolean;
}) {
  const router = useRouter();
  const timeString = new Date(message.createdAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Animated.View
      entering={isOwn ? FadeInUp.springify() : FadeInDown.springify()}
      className={cn('mb-2 px-4', isOwn ? 'items-end' : 'items-start')}
    >
      <View className={cn('flex-row items-end max-w-[80%]', isOwn && 'flex-row-reverse')}>
        {!isOwn && showAvatar ? (
          <Image
            source={{ uri: message.sender.avatar }}
            className="w-8 h-8 rounded-full mr-2"
          />
        ) : !isOwn ? (
          <View className="w-8 mr-2" />
        ) : null}

        <View>
          {/* Shared post preview */}
          {message.sharedPost && (
            <Pressable
              onPress={() => {
                // Navigate to post or content
                if (message.sharedPost?.sharedContent?.type === 'bill') {
                  router.push(`/bill/${message.sharedPost.sharedContent.id}`);
                }
              }}
              className={cn(
                'p-3 rounded-xl mb-1 border',
                isOwn
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-slate-700/60 border-slate-600/50'
              )}
            >
              <View className="flex-row items-center mb-2">
                <FileText size={14} color="#F59E0B" />
                <Text className="text-amber-500 text-xs ml-1 font-medium">
                  Shared Post
                </Text>
              </View>
              <Text className="text-white text-sm" numberOfLines={2}>
                {message.sharedPost.sharedContent?.title ??
                  message.sharedPost.content.slice(0, 80)}
              </Text>
            </Pressable>
          )}

          {/* Message content */}
          <View
            className={cn(
              'px-4 py-2.5 rounded-2xl',
              isOwn
                ? 'bg-amber-500 rounded-br-sm'
                : 'bg-slate-700 rounded-bl-sm'
            )}
          >
            <Text className={cn(isOwn ? 'text-slate-900' : 'text-white')}>
              {message.content}
            </Text>
          </View>

          {/* Time */}
          <Text
            className={cn(
              'text-xs mt-1',
              isOwn ? 'text-slate-500 text-right' : 'text-slate-500'
            )}
          >
            {timeString}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function ConversationScreen() {
  return (
    <AuthGate capability="viewMessages" reason="Sign in to read and send messages.">
      <ConversationContent />
    </AuthGate>
  );
}

function ConversationContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [messageText, setMessageText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const { user } = useCurrentUser();
  const { data, isLoading } = useConversation(id);
  const sendMessage = useSendMessage(id);

  const conversation = data?.conversation ?? null;
  // The API returns newest first for paging; the thread renders oldest at the
  // top, so reverse for display.
  const messages = useMemo(
    () => (data?.messages ? [...data.messages].reverse() : []),
    [data?.messages]
  );

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length]);

  const otherParticipant = conversation?.participants.find(
    (p) => p.id !== user?.id
  );

  const handleSend = () => {
    const content = messageText.trim();
    if (!content || !id) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Clear optimistically so the input frees up immediately; the mutation
    // refetches the thread on success.
    setMessageText('');
    sendMessage.mutate(content, {
      onError: () => setMessageText(content),
    });
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  if (!conversation || !otherParticipant) {
    return (
      <View className="flex-1 bg-slate-900 items-center justify-center">
        <Text className="text-slate-400">Conversation not found</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-slate-900">
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
          <Pressable
            onPress={handleBack}
            className="w-10 h-10 items-center justify-center -ml-2"
          >
            <ArrowLeft size={24} color="#94A3B8" />
          </Pressable>

          <Image
            source={{ uri: otherParticipant.avatar }}
            className="w-10 h-10 rounded-full ml-2"
          />

          <View className="flex-1 ml-3">
            <Text className="text-white font-semibold">
              {otherParticipant.displayName}
            </Text>
            <Text className="text-slate-400 text-sm">
              @{otherParticipant.username}
            </Text>
          </View>

          <Pressable className="w-10 h-10 items-center justify-center">
            <MoreHorizontal size={24} color="#64748B" />
          </Pressable>
        </View>

        {/* Messages */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingVertical: 16 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const prevMessage = messages[index - 1];
              const showAvatar =
                !prevMessage || prevMessage.sender.id !== item.sender.id;

              return (
                <MessageBubble
                  message={item}
                  isOwn={item.sender.id === user?.id}
                  showAvatar={showAvatar}
                />
              );
            }}
            ListEmptyComponent={
              <View className="flex-1 items-center justify-center py-20">
                <Image
                  source={{ uri: otherParticipant.avatar }}
                  className="w-20 h-20 rounded-full mb-4"
                />
                <Text className="text-white font-semibold text-lg">
                  {otherParticipant.displayName}
                </Text>
                <Text className="text-slate-400 text-sm mt-1">
                  Start a conversation with @{otherParticipant.username}
                </Text>
              </View>
            }
          />

          {/* Message Input */}
          <View className="flex-row items-end px-4 py-3 border-t border-slate-800">
            <View className="flex-1 flex-row items-end bg-slate-800 rounded-2xl px-4 py-2">
              <TextInput
                value={messageText}
                onChangeText={setMessageText}
                placeholder="Message..."
                placeholderTextColor="#64748B"
                multiline
                className="flex-1 text-white text-base max-h-24"
              />
            </View>

            <Pressable
              onPress={handleSend}
              disabled={!messageText.trim()}
              className={cn(
                'ml-3 w-10 h-10 rounded-full items-center justify-center',
                messageText.trim() ? 'bg-amber-500' : 'bg-slate-700'
              )}
            >
              <Send
                size={18}
                color={messageText.trim() ? '#0F172A' : '#64748B'}
              />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
