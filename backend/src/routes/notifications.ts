import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { forgetCachedFeeds } from "../services/relationships";
import { z } from "zod";
import type { auth } from "../auth";
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadNotificationCount,
  getUserNotificationPreferences,
  updateNotificationPreferences,
} from "../services/notification-service";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
});

const preferencesSchema = z.object({
  likes: z.boolean().optional(),
  comments: z.boolean().optional(),
  replies: z.boolean().optional(),
  mentions: z.boolean().optional(),
  follows: z.boolean().optional(),
  reposts: z.boolean().optional(),
  messages: z.boolean().optional(),
  newFollowerPosts: z.boolean().optional(),
  // Both of these existed on the model and in the notification service and
  // could never be turned off, because they were missing from this schema and
  // from both handlers below. A preference the product writes to but nobody
  // can change is worse than no preference at all.
  lawUpdates: z.boolean().optional(),
  voiceUsed: z.boolean().optional(),
  /** Not a notification — the reader's own switch for the other-side floor. */
  showOtherSide: z.boolean().optional(),
  /** Not a notification either — Bill of Rights Article IV. */
  voteAnonymously: z.boolean().optional(),
  /**
   * Set once, the first time somebody is asked whether their positions carry
   * their name. It is what tells the apps to stop asking; it is not a thing a
   * screen offers to toggle.
   */
  voteAnonymityChosen: z.boolean().optional(),
});

/**
 * GET /api/notifications
 * Get user notifications with pagination
 */
notificationsRouter.get("/", zValidator("query", paginationSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { limit, cursor } = c.req.valid("query");

  try {
    const result = await getUserNotifications(user.id, limit, cursor);
    return c.json(result);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return c.json({ error: "Failed to fetch notifications" }, 500);
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read
 */
notificationsRouter.post("/:id/read", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const notificationId = c.req.param("id");

  try {
    const result = await markNotificationAsRead(notificationId, user.id);
    if (!result.success) {
      return c.json({ error: "Notification not found or not owned by user" }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    return c.json({ error: "Failed to mark notification as read" }, 500);
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read
 */
notificationsRouter.post("/read-all", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const result = await markAllNotificationsAsRead(user.id);
    return c.json({ success: true, count: result.count });
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    return c.json({ error: "Failed to mark notifications as read" }, 500);
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
notificationsRouter.get("/unread-count", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const count = await getUnreadNotificationCount(user.id);
    return c.json({ count });
  } catch (error) {
    console.error("Error fetching unread count:", error);
    return c.json({ error: "Failed to fetch unread count" }, 500);
  }
});

/**
 * GET /api/notifications/preferences
 * Get user notification preferences
 */
notificationsRouter.get("/preferences", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  try {
    const preferences = await getUserNotificationPreferences(user.id);
    return c.json({
      preferences: {
        likes: preferences.likes,
        comments: preferences.comments,
        replies: preferences.replies,
        mentions: preferences.mentions,
        follows: preferences.follows,
        reposts: preferences.reposts,
        messages: preferences.messages,
        newFollowerPosts: preferences.newFollowerPosts,
        lawUpdates: preferences.lawUpdates,
        voiceUsed: preferences.voiceUsed,
        showOtherSide: preferences.showOtherSide,
        voteAnonymously: preferences.voteAnonymously,
        voteAnonymityChosen: preferences.voteAnonymityChosen,
      },
    });
  } catch (error) {
    console.error("Error fetching notification preferences:", error);
    return c.json({ error: "Failed to fetch notification preferences" }, 500);
  }
});

/**
 * PUT /api/notifications/preferences
 * Update user notification preferences
 */
notificationsRouter.put("/preferences", zValidator("json", preferencesSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const preferences = c.req.valid("json");

  // Ensure at least one preference is being updated
  if (Object.keys(preferences).length === 0) {
    return c.json({ error: "No preferences provided" }, 400);
  }

  try {
    // SETTING IT IS ANSWERING IT. Somebody who reaches into Settings and moves
    // the anonymity switch has made the choice, so the app must not stop them
    // mid-vote later to ask a question they have already answered. Applied
    // here rather than in each client, for the same reason the preference
    // itself is applied on the server: so it holds from every surface.
    const updated = await updateNotificationPreferences(
      user.id,
      preferences.voteAnonymously === undefined
        ? preferences
        : { ...preferences, voteAnonymityChosen: true },
    );

    // showOtherSide changes how the feed is assembled, and the feed keeps a
    // per-reader cached response. Without this, turning it off left the
    // reserved slots in place until the cache expired — a setting that does
    // not appear to work is a setting nobody trusts.
    forgetCachedFeeds(user.id);
    return c.json({
      preferences: {
        likes: updated.likes,
        comments: updated.comments,
        replies: updated.replies,
        mentions: updated.mentions,
        follows: updated.follows,
        reposts: updated.reposts,
        messages: updated.messages,
        newFollowerPosts: updated.newFollowerPosts,
        lawUpdates: updated.lawUpdates,
        voiceUsed: updated.voiceUsed,
        showOtherSide: updated.showOtherSide,
        voteAnonymously: updated.voteAnonymously,
        voteAnonymityChosen: updated.voteAnonymityChosen,
      },
    });
  } catch (error) {
    console.error("Error updating notification preferences:", error);
    return c.json({ error: "Failed to update notification preferences" }, 500);
  }
});

export { notificationsRouter };
