/**
 * Direct messaging API.
 *
 * The messaging screens used to read from timeline-store, whose conversations
 * came from generateMockConversations() — local, per-device, and wiped on every
 * reload. The backend behind these calls is now Prisma-backed, so a message sent
 * from one device actually reaches the other participant.
 *
 * Shapes mirror backend/src/routes/messages.ts.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { TimelinePost } from '../timeline-store';

export interface MessageParticipant {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderId: string;
  sender: MessageParticipant;
  content: string;
  createdAt: string;
  isRead: boolean;

  /**
   * Share-a-post-to-DM. The message list and thread both render this when
   * present, but nothing has ever produced it: the old store's sendMessage took
   * a sharedPost argument that no caller passed, and the Message table has no
   * column for it. Kept so the existing render paths stay typed and ready;
   * wiring it up needs a sharedPostId on the backend model.
   */
  sharedPost?: TimelinePost;
}

export interface DirectConversation {
  id: string;
  participants: MessageParticipant[];
  lastMessage: DirectMessage | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export const messageKeys = {
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: messageKeys.conversations,
    queryFn: () =>
      api.get<{ results: DirectConversation[]; pagination: Pagination }>(
        '/api/messages/conversations'
      ),
  });
}

export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.conversation(conversationId ?? ''),
    queryFn: () =>
      api.get<{
        conversation: DirectConversation;
        messages: DirectMessage[];
        pagination: Pagination;
      }>(`/api/messages/conversations/${conversationId}`),
    enabled: !!conversationId,
  });
}

export function useSendMessage(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) =>
      api.post<DirectMessage>(`/api/messages/conversations/${conversationId}`, { content }),
    onSuccess: () => {
      // The thread gains a message and the list reorders by recency, so both
      // need refetching.
      queryClient.invalidateQueries({
        queryKey: messageKeys.conversation(conversationId ?? ''),
      });
      queryClient.invalidateQueries({ queryKey: messageKeys.conversations });
    },
  });
}

/**
 * Start a conversation with a user, or return the existing one. The backend
 * resolves an existing thread when there is one, so callers do not have to
 * check first.
 *
 * `message` is optional: the compose flow opens an empty thread and only sends
 * once the user types something.
 */
export function useStartConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ participantId, message }: { participantId: string; message?: string }) =>
      api.post<{
        conversation: DirectConversation;
        message: DirectMessage | null;
        isNew: boolean;
      }>('/api/messages/conversations', { participantId, ...(message ? { message } : {}) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.conversations });
      queryClient.invalidateQueries({
        queryKey: messageKeys.conversation(data.conversation.id),
      });
    },
  });
}
