import { prisma } from "../prisma";

// Notification types enum for type safety
export const NotificationType = {
  LIKE: "like",
  COMMENT: "comment",
  REPLY: "reply",
  MENTION: "mention",
  FOLLOW: "follow",
  REPOST: "repost",
  NEW_FOLLOWER_POST: "new_follower_post",
  LAW_UPDATED: "law_updated",
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

// Data structure for notification metadata
export interface NotificationData {
  postId?: string;
  commentId?: string;
  fromUserId?: string;
  fromUserName?: string;
  postContent?: string;
  commentContent?: string;
  /** The master reference whose law moved, for a law_updated notification. */
  governmentReferenceId?: string;
  masterReferenceId?: string;
}

// Preference field mapping for notification types
const preferenceFieldMap: Record<NotificationTypeValue, string> = {
  [NotificationType.LIKE]: "likes",
  [NotificationType.COMMENT]: "comments",
  [NotificationType.REPLY]: "replies",
  [NotificationType.MENTION]: "mentions",
  [NotificationType.FOLLOW]: "follows",
  [NotificationType.REPOST]: "reposts",
  [NotificationType.NEW_FOLLOWER_POST]: "newFollowerPosts",
  [NotificationType.LAW_UPDATED]: "lawUpdates",
};

/**
 * Get user's notification preferences, creating defaults if they don't exist
 */
export async function getUserNotificationPreferences(userId: string) {
  let preferences = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (!preferences) {
    preferences = await prisma.notificationPreference.create({
      data: { userId },
    });
  }

  return preferences;
}

/**
 * Check if a user has enabled notifications for a specific type
 */
export async function shouldSendNotification(
  userId: string,
  type: NotificationTypeValue
): Promise<boolean> {
  const preferences = await getUserNotificationPreferences(userId);
  const fieldName = preferenceFieldMap[type];

  // Type assertion needed due to dynamic field access
  return (preferences as Record<string, unknown>)[fieldName] as boolean;
}

/**
 * Create a notification for a user
 */
export async function createNotification(
  userId: string,
  type: NotificationTypeValue,
  title: string,
  body: string,
  data?: NotificationData
): Promise<{ created: boolean; notification?: { id: string } }> {
  // Don't notify yourself
  if (data?.fromUserId === userId) {
    return { created: false };
  }

  // Check if user wants this type of notification
  const shouldNotify = await shouldSendNotification(userId, type);
  if (!shouldNotify) {
    return { created: false };
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data ? JSON.stringify(data) : null,
    },
  });

  return { created: true, notification: { id: notification.id } };
}

/**
 * Helper function: Create a like notification
 */
export async function notifyPostLike(
  postAuthorId: string,
  likerUserId: string,
  likerName: string,
  postId: string,
  postContentPreview: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  const truncatedContent = postContentPreview.length > 50
    ? postContentPreview.substring(0, 50) + "..."
    : postContentPreview;

  return createNotification(
    postAuthorId,
    NotificationType.LIKE,
    "New like on your post",
    `${likerName} liked your post: "${truncatedContent}"`,
    {
      postId,
      fromUserId: likerUserId,
      fromUserName: likerName,
      postContent: truncatedContent,
    }
  );
}

/**
 * Helper function: Create a comment notification
 */
export async function notifyPostComment(
  postAuthorId: string,
  commenterUserId: string,
  commenterName: string,
  postId: string,
  commentId: string,
  commentContent: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  const truncatedComment = commentContent.length > 100
    ? commentContent.substring(0, 100) + "..."
    : commentContent;

  return createNotification(
    postAuthorId,
    NotificationType.COMMENT,
    "New comment on your post",
    `${commenterName} commented: "${truncatedComment}"`,
    {
      postId,
      commentId,
      fromUserId: commenterUserId,
      fromUserName: commenterName,
      commentContent: truncatedComment,
    }
  );
}

/**
 * Helper function: Create a reply notification
 */
export async function notifyCommentReply(
  parentCommentAuthorId: string,
  replierUserId: string,
  replierName: string,
  postId: string,
  commentId: string,
  replyContent: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  const truncatedReply = replyContent.length > 100
    ? replyContent.substring(0, 100) + "..."
    : replyContent;

  return createNotification(
    parentCommentAuthorId,
    NotificationType.REPLY,
    "New reply to your comment",
    `${replierName} replied: "${truncatedReply}"`,
    {
      postId,
      commentId,
      fromUserId: replierUserId,
      fromUserName: replierName,
      commentContent: truncatedReply,
    }
  );
}

/**
 * Helper function: Create mention notifications
 * Parses content for @username mentions and creates notifications
 */
export async function notifyMentions(
  content: string,
  mentionerUserId: string,
  mentionerName: string,
  postId: string,
  commentId?: string
): Promise<{ notifiedCount: number }> {
  // Extract @mentions from content (matches @username format)
  const mentionRegex = /@([a-zA-Z0-9_]+)/g;
  const matches = content.matchAll(mentionRegex);
  const usernames = [...matches].map((m) => m[1]);

  if (usernames.length === 0) {
    return { notifiedCount: 0 };
  }

  // Find users by username (email prefix for this app)
  const users = await prisma.user.findMany({
    where: {
      OR: usernames.map((username) => ({
        email: { startsWith: username + "@" },
      })),
    },
    select: { id: true, email: true },
  });

  let notifiedCount = 0;

  for (const user of users) {
    // Don't notify yourself
    if (user.id === mentionerUserId) continue;

    const truncatedContent = content.length > 100
      ? content.substring(0, 100) + "..."
      : content;

    const result = await createNotification(
      user.id,
      NotificationType.MENTION,
      "You were mentioned",
      `${mentionerName} mentioned you: "${truncatedContent}"`,
      {
        postId,
        commentId,
        fromUserId: mentionerUserId,
        fromUserName: mentionerName,
        commentContent: truncatedContent,
      }
    );

    if (result.created) {
      // Also create a Mention record for tracking
      await prisma.mention.create({
        data: {
          mentionedUserId: user.id,
          mentionedByUserId: mentionerUserId,
          postId,
          commentId,
        },
      });
      notifiedCount++;
    }
  }

  return { notifiedCount };
}

/**
 * Helper function: Create a follow notification
 */
export async function notifyFollow(
  followedUserId: string,
  followerUserId: string,
  followerName: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  return createNotification(
    followedUserId,
    NotificationType.FOLLOW,
    "New follower",
    `${followerName} started following you`,
    {
      fromUserId: followerUserId,
      fromUserName: followerName,
    }
  );
}

/**
 * Helper function: Create a repost notification
 */
export async function notifyRepost(
  originalAuthorId: string,
  reposterUserId: string,
  reposterName: string,
  originalPostId: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  return createNotification(
    originalAuthorId,
    NotificationType.REPOST,
    "Your post was reposted",
    `${reposterName} reposted your post`,
    {
      postId: originalPostId,
      fromUserId: reposterUserId,
      fromUserName: reposterName,
    }
  );
}

/**
 * Helper function: Notify followers of a new post
 * This should be used sparingly to avoid notification fatigue
 */
export async function notifyFollowersOfNewPost(
  authorId: string,
  authorName: string,
  postId: string,
  postContentPreview: string
): Promise<{ notifiedCount: number }> {
  // Get all followers of the author
  const followers = await prisma.follow.findMany({
    where: { followingId: authorId },
    select: { followerId: true },
  });

  const truncatedContent = postContentPreview.length > 50
    ? postContentPreview.substring(0, 50) + "..."
    : postContentPreview;

  let notifiedCount = 0;

  for (const follower of followers) {
    const result = await createNotification(
      follower.followerId,
      NotificationType.NEW_FOLLOWER_POST,
      "New post from someone you follow",
      `${authorName} posted: "${truncatedContent}"`,
      {
        postId,
        fromUserId: authorId,
        fromUserName: authorName,
        postContent: truncatedContent,
      }
    );

    if (result.created) {
      notifiedCount++;
    }
  }

  return { notifiedCount };
}

/**
 * Mark a single notification as read
 */
export async function markNotificationAsRead(
  notificationId: string,
  userId: string
): Promise<{ success: boolean }> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });

  if (!notification || notification.userId !== userId) {
    return { success: false };
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true },
  });

  return { success: true };
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(
  userId: string
): Promise<{ count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });

  return { count: result.count };
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(
  userId: string
): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false },
  });
}

/**
 * Get notifications for a user with pagination
 */
export async function getUserNotifications(
  userId: string,
  limit: number = 20,
  cursor?: string
): Promise<{
  notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    data: NotificationData | null;
    isRead: boolean;
    createdAt: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
  });

  const hasMore = notifications.length > limit;
  const results = hasMore ? notifications.slice(0, -1) : notifications;
  const nextCursor = hasMore && results.length > 0
    ? results[results.length - 1]?.id ?? null
    : null;

  return {
    notifications: results.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: n.data ? (JSON.parse(n.data) as NotificationData) : null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  };
}

/**
 * Update user notification preferences
 */
export async function updateNotificationPreferences(
  userId: string,
  preferences: Partial<{
    likes: boolean;
    comments: boolean;
    replies: boolean;
    mentions: boolean;
    follows: boolean;
    reposts: boolean;
    newFollowerPosts: boolean;
  }>
): Promise<{
  id: string;
  userId: string;
  likes: boolean;
  comments: boolean;
  replies: boolean;
  mentions: boolean;
  follows: boolean;
  reposts: boolean;
  newFollowerPosts: boolean;
}> {
  const updated = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      ...preferences,
    },
    update: preferences,
  });

  return updated;
}

/**
 * Tell everyone who shared a law that the law has changed.
 *
 * Their post is not edited. Their words stay their words; only the law
 * underneath moves forward, and the card on the post carries a badge saying so.
 * This is the other half of that: somebody who put their name to a position on
 * a bill should not have to re-read it every week to find out it was amended.
 *
 * One notification per person, not per post. A prolific poster who wrote about
 * the same bill six times gets told once, and the notification points at their
 * most recent post about it.
 */
export async function notifyLawUpdate(
  governmentReferenceId: string,
  masterReferenceId: string,
  displayTitle: string
): Promise<{ notified: number }> {
  const posts = await prisma.post.findMany({
    where: { governmentReferenceId },
    select: { id: true, authorId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // First post per author wins, and the list is newest-first, so each author's
  // notification points at what they most recently said about this law.
  const mostRecentByAuthor = new Map<string, string>();
  for (const post of posts) {
    if (!mostRecentByAuthor.has(post.authorId)) {
      mostRecentByAuthor.set(post.authorId, post.id);
    }
  }

  let notified = 0;
  for (const [authorId, postId] of mostRecentByAuthor) {
    const result = await createNotification(
      authorId,
      NotificationType.LAW_UPDATED,
      "A law you shared has been updated",
      `${displayTitle} has changed since you posted about it. Your post is unchanged \u2014 the law it points to has moved.`,
      { postId, governmentReferenceId, masterReferenceId }
    );
    if (result.created) notified += 1;
  }

  return { notified };
}
