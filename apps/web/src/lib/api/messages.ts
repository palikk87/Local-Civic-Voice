/**
 * Direct messaging API — web.
 *
 * Deliberately a near-copy of apps/mobile/src/lib/api/messages.ts. Both mirror
 * backend/src/routes/messages.ts, and the two files differ only where they must:
 * the mobile version imports TimelinePost from '../timeline-store', the web one
 * from '@/lib/mobile/timeline-store'. Everything else is identical, and when the
 * remaining lib/mobile duplication is resolved this should move into
 * packages/civic-core rather than be maintained twice.
 *
 * Until now the web app had no messaging client at all. The backend has been
 * Prisma-backed and working; pages/Timeline.tsx already linked to /messages,
 * which resolved to the 404 page.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TimelinePost } from "@/lib/mobile/timeline-store";

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
   * Share-a-post-to-DM. Both clients render this when present, but nothing
   * produces it — the Message table has no column for it. Kept so the render
   * paths stay typed; wiring it needs a sharedPostId on the backend model.
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
  conversations: ["conversations"] as const,
  conversation: (id: string) => ["conversation", id] as const,
};

export function useConversations() {
  return useQuery({
    queryKey: messageKeys.conversations,
    queryFn: () =>
      api.get<{ results: DirectConversation[]; pagination: Pagination }>(
        "/api/messages/conversations"
      ),
  });
}

export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: messageKeys.conversation(conversationId ?? ""),
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
        queryKey: messageKeys.conversation(conversationId ?? ""),
      });
      queryClient.invalidateQueries({ queryKey: messageKeys.conversations });
    },
  });
}

/**
 * Start a conversation with a user, or return the existing one. The backend
 * resolves an existing thread when there is one, so callers do not have to
 * check first.
 */
export function useStartConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ participantId, message }: { participantId: string; message?: string }) =>
      api.post<{
        conversation: DirectConversation;
        message: DirectMessage | null;
        isNew: boolean;
      }>("/api/messages/conversations", { participantId, ...(message ? { message } : {}) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: messageKeys.conversations });
      queryClient.invalidateQueries({
        queryKey: messageKeys.conversation(data.conversation.id),
      });
    },
  });
}

/**
 * The other participant in a one-to-one thread.
 *
 * Conversations include every participant, the current user among them, so a
 * list rendering `participants[0]` shows you your own name on half your threads
 * — which is exactly what it looked like before this was factored out.
 */
export function otherParticipant(
  conversation: DirectConversation,
  currentUserId: string | undefined
): MessageParticipant | undefined {
  return (
    conversation.participants.find((p) => p.id !== currentUserId) ?? conversation.participants[0]
  );
}
