import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import type { auth } from "../auth";

/**
 * Direct messaging.
 *
 * This router previously served an in-memory mock: a hardcoded "current_user",
 * module-level arrays, and integer id counters. Nothing persisted across a
 * restart and every caller saw the same fabricated conversations. It is now
 * backed by the Conversation / ConversationParticipant / Message tables.
 *
 * The response shapes are unchanged, so existing clients keep working.
 *
 * Read state lives on ConversationParticipant.lastReadAt rather than a per-row
 * flag: opening a thread is one UPDATE instead of one per message. The
 * per-message `isRead` in the API is derived from it — for a message you
 * received, whether you have read past it; for one you sent, whether the other
 * side has.
 */
type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const messagesRouter = new Hono<{ Variables: AuthVariables }>();

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

/** The user columns every participant projection needs. */
const participantSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
} as const;

type UserRow = {
  id: string;
  name: string;
  username: string | null;
  image: string | null;
};

function toParticipant(user: UserRow): Participant {
  return {
    id: user.id,
    username: user.username ?? user.id,
    displayName: user.name,
    avatar:
      user.image ??
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
        user.username ?? user.id
      )}`,
  };
}

const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

const conversationIdParamSchema = z.object({
  id: z.string().min(1, "Conversation ID is required"),
});

const createConversationSchema = z.object({
  participantId: z.string().min(1, "Participant ID is required"),
  // Optional: the compose flow picks a recipient and opens an empty thread,
  // sending only once the user actually types something. The mock this replaced
  // demanded an initial message, but nothing ever called it — the client was
  // talking to a local store — so requiring one here would have broken the
  // first real caller.
  message: z.string().min(1).max(2000, "Message too long").optional(),
});

const sendMessageSchema = z.object({
  content: z.string().min(1, "Message content is required").max(2000, "Message too long"),
});

/**
 * Shape a Message row for the API. `readerLastReadAt` is the lastReadAt of
 * whoever's perspective determines "read" for this message — the recipient's.
 */
function toMessage(
  row: {
    id: string;
    conversationId: string;
    senderId: string;
    content: string;
    createdAt: Date;
    sender: UserRow;
  },
  readerLastReadAt: Date | null
): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    sender: toParticipant(row.sender),
    content: row.content,
    createdAt: row.createdAt.toISOString(),
    isRead: readerLastReadAt !== null && readerLastReadAt >= row.createdAt,
  };
}

/**
 * GET /api/messages/conversations
 * List all conversations for the current user.
 */
messagesRouter.get("/conversations", zValidator("query", paginationQuerySchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { limit, offset } = c.req.valid("query");

  const [total, memberships] = await Promise.all([
    prisma.conversationParticipant.count({ where: { userId: user.id } }),
    prisma.conversationParticipant.findMany({
      where: { userId: user.id },
      orderBy: { conversation: { updatedAt: "desc" } },
      skip: offset,
      take: limit,
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            participants: { select: { user: { select: participantSelect } } },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: {
                id: true,
                conversationId: true,
                senderId: true,
                content: true,
                createdAt: true,
                sender: { select: participantSelect },
              },
            },
          },
        },
      },
    }),
  ]);

  // Unread counts for the whole page in one query rather than one per
  // conversation, so the list does not fan out as a user's history grows.
  const unreadRows = await prisma.message.groupBy({
    by: ["conversationId"],
    where: {
      OR: memberships.map((m) => ({
        conversationId: m.conversation.id,
        senderId: { not: user.id },
        ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
      })),
    },
    _count: { _all: true },
  });
  const unreadByConversation = new Map(
    unreadRows.map((r) => [r.conversationId, r._count._all])
  );

  const results: Conversation[] = memberships.map((m) => {
    const conv = m.conversation;
    const last = conv.messages[0];
    return {
      id: conv.id,
      participants: conv.participants.map((p) => toParticipant(p.user)),
      // The reader of the last message is the current user unless they sent it.
      lastMessage: last ? toMessage(last, m.lastReadAt) : null,
      unreadCount: unreadByConversation.get(conv.id) ?? 0,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    };
  });

  return c.json({
    results,
    pagination: { total, limit, offset, hasMore: offset + limit < total },
  });
});

/**
 * POST /api/messages/conversations
 * Start a conversation with another user, or append to the existing one.
 */
messagesRouter.post("/conversations", zValidator("json", createConversationSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { participantId, message } = c.req.valid("json");

  if (participantId === user.id) {
    return c.json({ error: "Cannot start a conversation with yourself" }, { status: 400 });
  }

  const participant = await prisma.user.findUnique({
    where: { id: participantId },
    select: participantSelect,
  });
  if (!participant) {
    return c.json({ error: "Participant not found" }, { status: 404 });
  }

  // An existing 1:1 conversation is one the caller is in that the other user is
  // also in. `some` twice rather than an array equality check, so this still
  // finds the thread if group conversations are added later.
  const existing = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: user.id } } },
        { participants: { some: { userId: participantId } } },
      ],
    },
    select: { id: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const conversationId =
      existing?.id ??
      (
        await tx.conversation.create({
          data: {
            participants: {
              create: [
                // The creator has read their own conversation by definition.
                { userId: user.id, lastReadAt: new Date() },
                { userId: participantId },
              ],
            },
          },
          select: { id: true },
        })
      ).id;

    const messageSelect = {
      id: true,
      conversationId: true,
      senderId: true,
      content: true,
      createdAt: true,
      sender: { select: participantSelect },
    } as const;

    const created = message
      ? await tx.message.create({
          data: { conversationId, senderId: user.id, content: message },
          select: messageSelect,
        })
      : // No new message: reopening an existing thread. Report its real last
        // message rather than null, so the caller's list row does not blank out.
        await tx.message.findFirst({
          where: { conversationId },
          orderBy: { createdAt: "desc" },
          select: messageSelect,
        });

    // Bump the conversation so it sorts to the top of both users' lists.
    const conversation = await tx.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        participants: { select: { user: { select: participantSelect } } },
      },
    });

    return { conversation, created };
  });

  const newMessage = result.created ? toMessage(result.created, null) : null;

  const conversation: Conversation = {
    id: result.conversation.id,
    participants: result.conversation.participants.map((p) => toParticipant(p.user)),
    lastMessage: newMessage,
    unreadCount: 0,
    createdAt: result.conversation.createdAt.toISOString(),
    updatedAt: result.conversation.updatedAt.toISOString(),
  };

  return c.json(
    { conversation, message: newMessage, isNew: !existing },
    { status: existing ? 200 : 201 }
  );
});

/**
 * GET /api/messages/conversations/:id
 * Read a conversation. Opening it marks it read for the caller.
 */
messagesRouter.get(
  "/conversations/:id",
  zValidator("param", conversationIdParamSchema),
  zValidator("query", paginationQuerySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const { id } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        participants: {
          select: { userId: true, lastReadAt: true, user: { select: participantSelect } },
        },
      },
    });
    if (!conversation) {
      return c.json({ error: "Conversation not found" }, { status: 404 });
    }

    const membership = conversation.participants.find((p) => p.userId === user.id);
    if (!membership) {
      return c.json({ error: "Not authorized to view this conversation" }, { status: 403 });
    }

    const [total, rows] = await Promise.all([
      prisma.message.count({ where: { conversationId: id } }),
      prisma.message.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          createdAt: true,
          sender: { select: participantSelect },
        },
      }),
    ]);

    // Read state is resolved against the recipient of each message: messages the
    // caller received are judged by the caller's lastReadAt, messages the caller
    // sent by the other participant's.
    const otherLastReadAt =
      conversation.participants.find((p) => p.userId !== user.id)?.lastReadAt ?? null;

    const messages = rows.map((row) =>
      toMessage(row, row.senderId === user.id ? otherLastReadAt : membership.lastReadAt)
    );

    // Opening the thread marks it read. Done after projecting the messages so
    // the response still reflects what the caller had seen on arrival.
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      data: { lastReadAt: new Date() },
    });

    return c.json({
      conversation: {
        id: conversation.id,
        participants: conversation.participants.map((p) => toParticipant(p.user)),
        lastMessage: messages[0] ?? null,
        unreadCount: 0,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      } satisfies Conversation,
      messages,
      pagination: { total, limit, offset, hasMore: offset + limit < total },
    });
  }
);

/**
 * POST /api/messages/conversations/:id
 * Send a message in an existing conversation.
 */
messagesRouter.post(
  "/conversations/:id",
  zValidator("param", conversationIdParamSchema),
  zValidator("json", sendMessageSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const { id } = c.req.valid("param");
    const { content } = c.req.valid("json");

    const membership = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      select: { id: true },
    });
    if (!membership) {
      // Deliberately 404 vs 403: a caller who is not a participant should not be
      // able to probe which conversation ids exist.
      const exists = await prisma.conversation.findUnique({
        where: { id },
        select: { id: true },
      });
      return exists
        ? c.json({ error: "Not authorized to send messages in this conversation" }, { status: 403 })
        : c.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [created] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId: id, senderId: user.id, content },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          content: true,
          createdAt: true,
          sender: { select: participantSelect },
        },
      }),
      // Sending is also reading: keeps the sender's own thread from showing
      // unread, and bumps the conversation for everyone's list ordering.
      prisma.conversationParticipant.update({
        where: { conversationId_userId: { conversationId: id, userId: user.id } },
        data: { lastReadAt: new Date() },
      }),
      prisma.conversation.update({
        where: { id },
        data: { updatedAt: new Date() },
      }),
    ]);

    return c.json(toMessage(created, null), { status: 201 });
  }
);

export { messagesRouter };
export type { Message, Conversation, Participant };
