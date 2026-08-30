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
  MESSAGE: "message",
  VOICE_USED: "voice_used",

  // ARTICLE V. These four have no preference switch and cannot be turned off —
  // see preferenceFieldMap below for why.
  /// Proceedings have opened against a leader you delegate to. You are an elector.
  IMPEACHMENT_OPENED: "impeachment_opened",
  /// Proceedings have closed. Says what happened and, if it passed, until when.
  IMPEACHMENT_DECIDED: "impeachment_decided",
  /// Articles of Impeachment have been filed against you. Served on the accused.
  IMPEACHMENT_SERVED: "impeachment_served",
  /// The person who filed a proceeding you can vote in has closed their
  /// account. The proceeding stands; this says the filer is gone.
  ///
  /// Cannot be turned off, like the rest of Article V. Who brought a case is
  /// part of judging it, and an elector who is never told the origin vanished
  /// is voting on a different thing than they think they are.
  FILER_LEFT: "filer_left",
  /// A vote to restart the platform has opened. Sent to every account.
  SYSTEM_RESET_OPENED: "system_reset_opened",
  /// It passed, and runs in 48 hours. This is the disclosure notice.
  SYSTEM_RESET_SCHEDULED: "system_reset_scheduled",
  /// It has run, or it failed. Either way everybody is told.
  SYSTEM_RESET_SETTLED: "system_reset_settled",

  // ARTICLE IV — the Community Juries. These cannot be turned off either: a
  // summons somebody never saw is a duty they are then marked down for missing.
  /// You have been drawn for a jury. Twenty-four hours to answer.
  JURY_SUMMONS: "jury_summons",
  /// The jury you sat on, or were reported to, has reached a verdict.
  JURY_VERDICT: "jury_verdict",
  /// A jury found that somebody you lend your vote to misrepresented a law.
  /// Cannot be turned off: it is the notice that lets you decide whether to
  /// keep lending them your voice, and a right you were never told about is a
  /// right you do not have.
  LEADER_FINDING: "leader_finding",
  /// A report you filed was closed by an administrator. Not switchable off: it
  /// is the answer to something you did, and a report that vanishes into
  /// silence is why people stop filing them. A jury verdict already reaches
  /// the reporter through JURY_VERDICT; this is the other way a report ends.
  REPORT_DECIDED: "report_decided",
} as const;

export type NotificationTypeValue = (typeof NotificationType)[keyof typeof NotificationType];

// Data structure for notification metadata
export interface NotificationData {
  conversationId?: string;
  postId?: string;
  commentId?: string;
  fromUserId?: string;
  fromUserName?: string;
  postContent?: string;
  commentContent?: string;
  /** The master reference whose law moved, for a law_updated notification. */
  governmentReferenceId?: string;
  masterReferenceId?: string;
  /** The position cast in somebody's name, for a voice_used notification. */
  position?: string;
  /** The proceeding, for an Article V notification. Deep-links to Article V. */
  impeachmentId?: string;
  /// Article IV. Which case a summons or a verdict is about.
  juryId?: string;
  /** Who the proceeding is against, so the notification can name them. */
  leaderId?: string;
  /** The reset being voted on, for an Article V reset notification. */
  systemResetId?: string;
  /** The report an administrator closed, for the person who filed it. */
  reportId?: string;
}

// Preference field mapping for notification types.
//
// PARTIAL ON PURPOSE. A type with no entry here has no switch and is always
// delivered. That is not an oversight for the Article V types: an impeachment
// notice is not a social nicety, it is service of process. The whole design
// rests on the electorate being told the proceeding exists — a frozen
// electorate that never hears about the vote is a quorum you can silence by
// waiting — and on the accused being told what they are accused of. Neither
// survives a preference toggle, so neither gets one.
const preferenceFieldMap: Partial<Record<NotificationTypeValue, string>> = {
  [NotificationType.LIKE]: "likes",
  [NotificationType.COMMENT]: "comments",
  [NotificationType.REPLY]: "replies",
  [NotificationType.MENTION]: "mentions",
  [NotificationType.FOLLOW]: "follows",
  [NotificationType.REPOST]: "reposts",
  [NotificationType.NEW_FOLLOWER_POST]: "newFollowerPosts",
  [NotificationType.LAW_UPDATED]: "lawUpdates",
  [NotificationType.MESSAGE]: "messages",
  [NotificationType.VOICE_USED]: "voiceUsed",
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
  const fieldName = preferenceFieldMap[type];

  // No switch means no way to decline it. Checked BEFORE the preferences are
  // read, so an unmuteable notice never depends on a preference row existing.
  if (!fieldName) return true;

  const preferences = await getUserNotificationPreferences(userId);

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
    messages: boolean;
    newFollowerPosts: boolean;
    lawUpdates: boolean;
    voiceUsed: boolean;
    showOtherSide: boolean;
    voteAnonymously: boolean;
    voteAnonymityChosen: boolean;
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
  messages: boolean;
  newFollowerPosts: boolean;
  lawUpdates: boolean;
  voiceUsed: boolean;
  showOtherSide: boolean;
  voteAnonymously: boolean;
  voteAnonymityChosen: boolean;
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

/**
 * THE PERSON WHO FILED A PROCEEDING HAS DELETED THEIR PROFILE.
 *
 * WHY ANYBODY IS TOLD. Impeachment.filedById used to cascade from User, so a
 * filer deleting their profile deleted the entire proceeding — the grounds, the
 * evidence, and every elector's vote in it. One person leaving erased other
 * people's participation in a constitutional act they had nothing to do with.
 *
 * The proceeding survives now. But surviving quietly is its own problem: an
 * elector who read the articles, weighed who brought them, and voted, is
 * entitled to know that the person who brought them is gone. Who filed a case
 * is part of judging it. The decision, in the owner's words: "proceedings may
 * survive but everyone that's got a right to vote in the proceedings is
 * notified that the filer has deleted their profile."
 *
 * IT SAYS DELETED, NOT "left" OR "closed". Those are softer words for a
 * different thing. Deleting a profile on this platform is irreversible and
 * total, and an elector deciding what to make of it needs the accurate verb.
 *
 * AND IT NAMES THEM, WHEN THE FILING WAS PUBLIC. Article V's own rule, from
 * routes/impeachments.ts: "THE ARTICLES ARE PUBLIC. A charge brought in secret,
 * decided by a private electorate, is exactly the concentration of power
 * Article V exists to break. The vote is restricted; the accusation is not."
 * The electors could already see who filed. Withholding the name now would not
 * protect anything — it would only make the notice harder to place against the
 * articles they have been reading.
 *
 * Passed in by the caller rather than looked up here, because by the time this
 * runs the account may already be gone. When there is no name to give — a
 * filing that was never public — the notice says the filer without naming one.
 *
 * EVERYONE ENTITLED TO VOTE, not everyone who has voted. Somebody who has not
 * voted yet is exactly who this matters most to: they still have the decision
 * in front of them.
 */
export async function notifyFilerLeft(
  proceeding: "impeachment" | "system_reset",
  proceedingId: string,
  electorIds: string[],
  /** How the filer was publicly known, e.g. "@dwhitfield". Null if not public. */
  filerLabel: string | null,
  /** The accused, for an impeachment. Their profile is where the proceeding is. */
  leaderId?: string | null,
): Promise<{ notified: number }> {
  const what =
    proceeding === "impeachment"
      ? "The impeachment you can vote in"
      : "The system reset you can vote in";

  const who = filerLabel ? `${filerLabel}, who filed it,` : "The person who filed it";
  const title = filerLabel
    ? `${filerLabel} deleted their profile`
    : "The person who filed this deleted their profile";

  let notified = 0;
  for (const electorId of electorIds) {
    const result = await createNotification(
      electorId,
      NotificationType.FILER_LEFT,
      title,
      `${what} is unchanged \u2014 the articles, the evidence and your vote all ` +
        `stand. ${who} has deleted their profile, and it cannot be undone.`,
      // leaderId is what makes the row a link: the proceeding lives on the
      // accused person's profile. See destinationOf in the web Notifications
      // page — every Article V notice carried impeachmentId alone and led
      // nowhere.
      proceeding === "impeachment"
        ? { impeachmentId: proceedingId, ...(leaderId ? { leaderId } : {}) }
        : { systemResetId: proceedingId },
    );
    if (result.created) notified += 1;
  }

  return { notified };
}

/**
 * Somebody sent you a message.
 *
 * A direct message notified nobody, so it was only ever seen if the recipient
 * happened to open the inbox — which makes the inbox useless for anything that
 * matters today.
 *
 * The preview is short on purpose. A notification is a nudge to come and read
 * it, not a way to read it, and the full text lives behind the account it was
 * sent to.
 */
export async function notifyMessage(
  recipientId: string,
  senderId: string,
  senderName: string,
  conversationId: string,
  preview: string
): Promise<{ created: boolean; notification?: { id: string } }> {
  const trimmed = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;

  return createNotification(
    recipientId,
    NotificationType.MESSAGE,
    "New message",
    `${senderName}: ${trimmed}`,
    { conversationId, fromUserId: senderId, fromUserName: senderName }
  );
}

/**
 * Somebody voted in your name.
 *
 * THE HALF OF LIQUID DEMOCRACY THAT IS ALWAYS MISSING. Delegation is sold as
 * convenience — lend your vote to somebody who follows this more closely than
 * you do — and the lending is the last you ever hear of it. Every
 * implementation of this idea shows you a count of delegations you have made
 * and never once tells you what was done with them.
 *
 * A voice you are not told about is a voice you gave away rather than lent.
 * This platform's Constitution says political power here is "never won, only
 * borrowed", and borrowed means you find out at the moment it is used, while
 * you can still do something about it — a direct vote overrides a delegate, so
 * this notification is also the undo.
 *
 * One per person per record. A delegate who changes their mind twice does not
 * get to fill somebody's notifications; the newest one replaces the old.
 */
export async function notifyVoiceUsed(
  voterId: string,
  voterName: string,
  governmentReferenceId: string,
  referenceTitle: string,
  position: string
): Promise<{ notified: number }> {
  const { whoseVoiceLandedOn } = await import("./delegation-service");
  const lentTheirVoice = await whoseVoiceLandedOn(voterId, governmentReferenceId);
  if (lentTheirVoice.length === 0) return { notified: 0 };

  const verb = position === "support" ? "backed" : "opposed";
  const title = "Your voice was used";
  const body =
    `${voterName} ${verb} ${referenceTitle} in your name. ` +
    "Vote yourself and yours counts instead.";

  // Replace rather than stack. Somebody whose delegate is going back and forth
  // needs to know where the voice sits now, not to read the history of it in
  // their notifications.
  await prisma.notification.deleteMany({
    where: {
      userId: { in: lentTheirVoice },
      type: NotificationType.VOICE_USED,
      data: { contains: `"governmentReferenceId":"${governmentReferenceId}"` },
    },
  });

  let notified = 0;
  for (const userId of lentTheirVoice) {
    const result = await createNotification(userId, NotificationType.VOICE_USED, title, body, {
      governmentReferenceId,
      fromUserId: voterId,
      fromUserName: voterName,
      position,
    });
    if (result.created) notified += 1;
  }

  return { notified };
}
