import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  FlatList,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, Stack } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Plus,
  MessageCircle,
  Check,
  CheckCheck,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  useConversations,
  useStartConversation,
  type DirectConversation,
} from '@/lib/api/messages';
import { useSearchUsers } from '@/lib/api/hooks';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';
import { cn } from '@/lib/cn';
import { AuthGate } from '@/components/auth/AuthGate';

// Get relative time
function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Conversation preview component
function ConversationItem({
  conversation,
  index,
  onPress,
  currentUserId,
}: {
  conversation: DirectConversation;
  index: number;
  onPress: () => void;
  currentUserId: string | undefined;
}) {
  const otherParticipant = conversation.participants.find(
    (p) => p.id !== currentUserId
  );

  if (!otherParticipant) return null;

  const lastMessage = conversation.lastMessage;
  const isOwn = lastMessage?.sender.id === currentUserId;
  const timeAgo = lastMessage
    ? getRelativeTime(lastMessage.createdAt)
    : getRelativeTime(conversation.createdAt);

  return (
    <Animated.View entering={FadeInDown.delay(index * 50).springify()}>
      <Pressable
        onPress={onPress}
        className={cn(
          'flex-row items-center p-4 mx-4 mb-2 rounded-xl border',
          conversation.unreadCount > 0
            ? 'bg-amber-500/10 border-amber-500/30'
            : 'bg-slate-800/60 border-slate-700/50'
        )}
      >
        <View className="relative">
          <Image
            source={{ uri: otherParticipant.avatar }}
            className="w-14 h-14 rounded-full"
          />
          {conversation.unreadCount > 0 && (
            <View className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 items-center justify-center">
              <Text className="text-slate-900 text-xs font-bold">
                {conversation.unreadCount}
              </Text>
            </View>
          )}
        </View>

        <View className="flex-1 ml-3">
          <View className="flex-row items-center justify-between">
            <Text
              className={cn(
                'font-semibold',
                conversation.unreadCount > 0 ? 'text-white' : 'text-slate-200'
              )}
            >
              {otherParticipant.displayName}
            </Text>
            <Text className="text-slate-500 text-xs">{timeAgo}</Text>
          </View>

          <Text className="text-slate-400 text-sm mt-0.5">
            @{otherParticipant.username}
          </Text>

          {lastMessage && (
            <View className="flex-row items-center mt-1">
              {isOwn && (
                <View className="mr-1">
                  {lastMessage.isRead ? (
                    <CheckCheck size={14} color="#F59E0B" />
                  ) : (
                    <Check size={14} color="#64748B" />
                  )}
                </View>
              )}
              <Text
                className={cn(
                  'text-sm flex-1',
                  conversation.unreadCount > 0
                    ? 'text-white font-medium'
                    : 'text-slate-400'
                )}
                numberOfLines={1}
              >
                {lastMessage.sharedPost
                  ? '📄 Shared a post'
                  : lastMessage.content}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// New conversation modal
function NewConversationSheet({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (userId: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const { user } = useCurrentUser();

  // Real user search. This used to filter a local sampleUsers array, so the
  // compose sheet could only ever offer fabricated people.
  const { data: searchData } = useSearchUsers(searchQuery);
  const filteredUsers = (searchData?.results ?? []).filter((u) => u.id !== user?.id);

  if (!visible) return null;

  return (
    <View className="absolute inset-0 bg-slate-900/95 z-50">
      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
          <Pressable
            onPress={onClose}
            className="w-10 h-10 items-center justify-center -ml-2"
          >
            <ArrowLeft size={24} color="#94A3B8" />
          </Pressable>
          <Text className="text-white font-semibold text-lg ml-2">
            New Message
          </Text>
        </View>

        {/* Search */}
        <View className="px-4 py-3">
          <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3">
            <Search size={20} color="#64748B" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search people..."
              placeholderTextColor="#64748B"
              className="flex-1 text-white ml-3"
              autoFocus
            />
          </View>
        </View>

        {/* Users list */}
        <FlatList
          data={filteredUsers}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 30)}>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onSelect(item.id);
                }}
                className="flex-row items-center py-3 border-b border-slate-800"
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
              </Pressable>
            </Animated.View>
          )}
          ListEmptyComponent={
            // Search runs server-side and is disabled until there is a query,
            // so an empty box means "type a name", not "nobody matched".
            <View className="items-center py-10">
              <Text className="text-slate-500">
                {searchQuery ? 'No users found' : 'Search for someone to message'}
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    </View>
  );
}

export default function MessagesScreen() {
  return (
    <AuthGate capability="viewMessages" reason="Sign in to read and send messages.">
      <MessagesContent />
    </AuthGate>
  );
}

function MessagesContent() {
  const router = useRouter();
  const [showNewConversation, setShowNewConversation] = useState(false);

  const { user } = useCurrentUser();
  const { data, isLoading } = useConversations();
  const conversations = data?.results ?? [];
  const startConversation = useStartConversation();

  const handleConversationPress = (conversationId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/conversation/${conversationId}`);
  };

  const handleNewConversation = async (userId: string) => {
    // The server resolves an existing thread with this person if there is one,
    // so picking the same person twice reopens the conversation instead of
    // creating a duplicate.
    const result = await startConversation.mutateAsync({ participantId: userId });
    setShowNewConversation(false);
    router.push(`/conversation/${result.conversation.id}`);
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  };

  return (
    <View className="flex-1 bg-slate-900">
      <Stack.Screen options={{ headerShown: false }} />
      <LinearGradient
        colors={['#0F172A', '#1E293B', '#0F172A']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
          <View className="flex-row items-center">
            <Pressable
              onPress={handleBack}
              className="w-10 h-10 items-center justify-center -ml-2"
            >
              <ArrowLeft size={24} color="#94A3B8" />
            </Pressable>
            <Text className="text-white font-bold text-2xl ml-2">Messages</Text>
          </View>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowNewConversation(true);
            }}
            className="w-10 h-10 rounded-full bg-amber-500 items-center justify-center"
          >
            <Plus size={22} color="#0F172A" />
          </Pressable>
        </View>

        {/* Conversations list */}
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <ConversationItem
              conversation={item}
              index={index}
              onPress={() => handleConversationPress(item.id)}
              currentUserId={user?.id}
            />
          )}
          ListEmptyComponent={
            // Conversations are fetched now rather than read from a local
            // store, so the first paint has nothing yet. Without this the
            // screen flashes "No messages yet" before the list arrives.
            isLoading ? (
              <View className="flex-1 items-center justify-center py-20">
                <ActivityIndicator color="#F59E0B" />
              </View>
            ) : (
              <View className="flex-1 items-center justify-center py-20">
                <View className="w-20 h-20 rounded-full bg-slate-800 items-center justify-center mb-4">
                  <MessageCircle size={36} color="#64748B" />
                </View>
                <Text className="text-white font-semibold text-lg">
                  No messages yet
                </Text>
                <Text className="text-slate-400 text-sm mt-1 text-center px-8">
                  Start a conversation by tapping the + button above
                </Text>
              </View>
            )
          }
        />
      </SafeAreaView>

      {/* New Conversation Sheet */}
      <NewConversationSheet
        visible={showNewConversation}
        onClose={() => setShowNewConversation(false)}
        onSelect={handleNewConversation}
      />
    </View>
  );
}
