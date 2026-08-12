import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const messagesRouter = new Hono();

// Type definitions
interface Participant {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  sender: Participant;
  content: string;
  createdAt: string;
  isRead: boolean;
}

interface Conversation {
  id: string;
  participants: Participant[];
  lastMessage: Message | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

// Mock participants data
const mockParticipants: Record<string, Participant> = {
  current_user: {
    id: "current_user",
    username: "current_user",
    displayName: "Current User",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=current_user",
  },
  "1": {
    id: "1",
    username: "civic_champion",
    displayName: "Civic Champion",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=civic_champion",
  },
  "2": {
    id: "2",
    username: "policy_watcher",
    displayName: "Policy Watcher",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=policy_watcher",
  },
  "3": {
    id: "3",
    username: "democracy_now",
    displayName: "Democracy Now",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=democracy_now",
  },
};

// Helper to get participant with fallback
const getParticipant = (id: string): Participant => {
  return mockParticipants[id] || {
    id,
    username: "unknown",
    displayName: "Unknown User",
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`,
  };
};

// In-memory mock data storage
const mockMessages: Message[] = [
  {
    id: "m1",
    conversationId: "conv1",
    senderId: "1",
    sender: getParticipant("1"),
    content: "Hey! Did you see the latest bill proposal on renewable energy?",
    createdAt: "2024-06-15T10:00:00Z",
    isRead: true,
  },
  {
    id: "m2",
    conversationId: "conv1",
    senderId: "current_user",
    sender: getParticipant("current_user"),
    content: "Yes! I think it has some promising provisions for solar subsidies.",
    createdAt: "2024-06-15T10:05:00Z",
    isRead: true,
  },
  {
    id: "m3",
    conversationId: "conv1",
    senderId: "1",
    sender: getParticipant("1"),
    content: "Agreed. Want to collaborate on an analysis post?",
    createdAt: "2024-06-15T10:10:00Z",
    isRead: false,
  },
  {
    id: "m4",
    conversationId: "conv2",
    senderId: "2",
    sender: getParticipant("2"),
    content: "Thanks for following my analysis! Let me know if you have questions.",
    createdAt: "2024-06-14T15:00:00Z",
    isRead: true,
  },
  {
    id: "m5",
    conversationId: "conv2",
    senderId: "current_user",
    sender: getParticipant("current_user"),
    content: "Great work on the climate policy breakdown. Very insightful!",
    createdAt: "2024-06-14T15:30:00Z",
    isRead: true,
  },
];

const mockConversations: Conversation[] = [
  {
    id: "conv1",
    participants: [getParticipant("current_user"), getParticipant("1")],
    lastMessage: mockMessages.find((m) => m.id === "m3") || null,
    unreadCount: 1,
    createdAt: "2024-06-15T10:00:00Z",
    updatedAt: "2024-06-15T10:10:00Z",
  },
  {
    id: "conv2",
    participants: [getParticipant("current_user"), getParticipant("2")],
    lastMessage: mockMessages.find((m) => m.id === "m5") || null,
    unreadCount: 0,
    createdAt: "2024-06-14T15:00:00Z",
    updatedAt: "2024-06-14T15:30:00Z",
  },
];

// Helper function to get current user ID (mock - in real app this would come from auth)
const getCurrentUserId = (): string => "current_user";

// ID generator
let nextMessageId = 6;
let nextConversationId = 3;

// Validation schemas
const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 20),
  offset: z.string().optional().transform((val) => val ? parseInt(val, 10) : 0),
});

const conversationIdParamSchema = z.object({
  id: z.string().min(1, "Conversation ID is required"),
});

const createConversationSchema = z.object({
  participantId: z.string().min(1, "Participant ID is required"),
  message: z.string().min(1, "Initial message is required").max(2000, "Message too long"),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Message content is required").max(2000, "Message too long"),
});

/**
 * GET /api/messages/conversations
 * List all conversations for the current user
 */
messagesRouter.get(
  "/conversations",
  zValidator("query", paginationQuerySchema),
  (c) => {
    const { limit, offset } = c.req.valid("query");
    const currentUserId = getCurrentUserId();

    // Filter conversations where current user is a participant
    const userConversations = mockConversations
      .filter((conv) => conv.participants.some((p) => p.id === currentUserId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const paginatedConversations = userConversations.slice(offset, offset + limit);

    return c.json({
      results: paginatedConversations,
      pagination: {
        total: userConversations.length,
        limit,
        offset,
        hasMore: offset + limit < userConversations.length,
      },
    });
  }
);

/**
 * POST /api/messages/conversations
 * Start a new conversation
 */
messagesRouter.post(
  "/conversations",
  zValidator("json", createConversationSchema),
  (c) => {
    const { participantId, message } = c.req.valid("json");
    const currentUserId = getCurrentUserId();

    // Check if participant exists
    const participant = mockParticipants[participantId];
    if (!participant) {
      return c.json({ error: "Participant not found" }, { status: 404 });
    }

    // Check if conversation already exists between these users
    const existingConversation = mockConversations.find((conv) =>
      conv.participants.some((p) => p.id === currentUserId) &&
      conv.participants.some((p) => p.id === participantId)
    );

    if (existingConversation) {
      // Add message to existing conversation
      const newMessage: Message = {
        id: `m${nextMessageId++}`,
        conversationId: existingConversation.id,
        senderId: currentUserId,
        sender: getParticipant(currentUserId),
        content: message,
        createdAt: new Date().toISOString(),
        isRead: false,
      };

      mockMessages.push(newMessage);
      existingConversation.lastMessage = newMessage;
      existingConversation.updatedAt = newMessage.createdAt;

      return c.json({
        conversation: existingConversation,
        message: newMessage,
        isNew: false,
      });
    }

    // Create new conversation
    const now = new Date().toISOString();
    const newConversationId = `conv${nextConversationId++}`;

    const newMessage: Message = {
      id: `m${nextMessageId++}`,
      conversationId: newConversationId,
      senderId: currentUserId,
      sender: getParticipant(currentUserId),
      content: message,
      createdAt: now,
      isRead: false,
    };

    const newConversation: Conversation = {
      id: newConversationId,
      participants: [getParticipant(currentUserId), getParticipant(participantId)],
      lastMessage: newMessage,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    mockMessages.push(newMessage);
    mockConversations.unshift(newConversation);

    return c.json(
      {
        conversation: newConversation,
        message: newMessage,
        isNew: true,
      },
      { status: 201 }
    );
  }
);

/**
 * GET /api/messages/conversations/:id
 * Get messages in a specific conversation
 */
messagesRouter.get(
  "/conversations/:id",
  zValidator("param", conversationIdParamSchema),
  zValidator("query", paginationQuerySchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");
    const currentUserId = getCurrentUserId();

    // Find conversation
    const conversation = mockConversations.find((conv) => conv.id === id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Check if current user is a participant
    if (!conversation.participants.some((p) => p.id === currentUserId)) {
      return c.json({ error: "Not authorized to view this conversation" }, { status: 403 });
    }

    // Get messages for this conversation
    const conversationMessages = mockMessages
      .filter((m) => m.conversationId === id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Mark messages as read
    conversationMessages.forEach((m) => {
      if (m.senderId !== currentUserId) {
        m.isRead = true;
      }
    });

    // Update unread count
    conversation.unreadCount = 0;

    const paginatedMessages = conversationMessages.slice(offset, offset + limit);

    return c.json({
      conversation,
      messages: paginatedMessages,
      pagination: {
        total: conversationMessages.length,
        limit,
        offset,
        hasMore: offset + limit < conversationMessages.length,
      },
    });
  }
);

/**
 * POST /api/messages/conversations/:id
 * Send a message in a conversation
 */
messagesRouter.post(
  "/conversations/:id",
  zValidator("param", conversationIdParamSchema),
  zValidator("json", sendMessageSchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { content } = c.req.valid("json");
    const currentUserId = getCurrentUserId();

    // Find conversation
    const conversation = mockConversations.find((conv) => conv.id === id);
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Check if current user is a participant
    if (!conversation.participants.some((p) => p.id === currentUserId)) {
      return c.json({ error: "Not authorized to send messages in this conversation" }, { status: 403 });
    }

    const newMessage: Message = {
      id: `m${nextMessageId++}`,
      conversationId: id,
      senderId: currentUserId,
      sender: getParticipant(currentUserId),
      content,
      createdAt: new Date().toISOString(),
      isRead: false,
    };

    mockMessages.push(newMessage);

    // Update conversation
    conversation.lastMessage = newMessage;
    conversation.updatedAt = newMessage.createdAt;

    // Increment unread count for other participants
    const otherParticipants = conversation.participants.filter((p) => p.id !== currentUserId);
    if (otherParticipants.length > 0) {
      conversation.unreadCount += 1;
    }

    return c.json(newMessage, { status: 201 });
  }
);

export { messagesRouter };
export type { Message, Conversation, Participant };
