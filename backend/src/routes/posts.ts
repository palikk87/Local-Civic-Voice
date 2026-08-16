import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { purgeMediaObjects } from "../services/media-objects";
import type { auth } from "../auth";
import {
  notifyPostLike,
  notifyPostComment,
  notifyCommentReply,
  notifyMentions,
} from "../services/notification-service";
import { resolvePostReference } from "../services/reference-resolver";
import {
  loadPostReferenceView,
  loadPostReferenceViews,
} from "../services/post-reference-view";
import { JobPriority, JobType, jobQueue } from "../services/job-queue";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const postsRouter = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const createPostSchema = z
  .object({
    // May be empty when the post carries media instead of text — see the refine below.
    content: z.string().max(5000),
    billId: z.string().optional(),
    // Current contract: the GovernmentReference.id the picker selected.
    governmentReferenceId: z.string().min(1).optional(),
    // Legacy fields from deployed mobile builds. referenceId carried the
    // GovernmentReference.id as free text; type/title are ignored in favour of
    // the stored row. Remove once clients have adopted governmentReferenceId.
    referenceType: z.enum(["bill", "executive_order", "scotus_case"]).optional(),
    referenceId: z.string().min(1).optional(),
    referenceTitle: z.string().min(1).optional(),
    mediaIds: z.array(z.string()).optional(),
  })
  .refine((data) => Boolean(data.governmentReferenceId ?? data.referenceId), {
    message: "governmentReferenceId is required",
    path: ["governmentReferenceId"],
  })
  // A post needs something in it. The composers allow text or media, so accept
  // either — but never both empty.
  .refine((data) => data.content.trim().length > 0 || (data.mediaIds?.length ?? 0) > 0, {
    message: "Post must have text or media",
    path: ["content"],
  });

const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
  // "me" resolves to the signed-in user — a user's personal timeline shows
  // ONLY their own posts. Any user id is also accepted (public profiles).
  authorId: z.string().optional(),
});

/**
 * GET /api/posts
 * Get posts feed (paginated). Pass authorId=me for the caller's own timeline.
 */
postsRouter.get("/", zValidator("query", paginationSchema), async (c) => {
  const { limit, cursor, authorId } = c.req.valid("query");
  const user = c.get("user");

  const resolvedAuthorId = authorId === "me" ? user?.id : authorId;
  if (authorId === "me" && !user) {
    return c.json({ posts: [], nextCursor: undefined, hasMore: false });
  }

  const posts = await prisma.post.findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    ...(resolvedAuthorId ? { where: { authorId: resolvedAuthorId } } : {}),
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      bill: {
        select: {
          id: true,
          title: true,
          category: true,
        },
      },
      media: {
        select: {
          id: true,
          type: true,
          url: true,
          thumbnailUrl: true,
          mimeType: true,
          sizeBytes: true,
          durationMs: true,
          width: true,
          height: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
        },
      },
    },
  });

  const hasMore = posts.length > limit;
  const results = hasMore ? posts.slice(0, -1) : posts;
  const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

  // Batch-load the attached law for the whole page so each card can render as a
  // full reference card (status, category, source, live tally, caller's vote).
  const referenceViews = await loadPostReferenceViews(
    results.map((post) => post.governmentReferenceId),
    user?.id ?? null
  );

  return c.json({
    posts: results.map((post) => ({
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: post.author.email.split("@")[0],
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      // The law as it stands, not the copy frozen when the post was written.
      // The record is shared; the post frames it to one person's timeline.
      referenceTitle:
        (post.governmentReferenceId
          ? referenceViews.get(post.governmentReferenceId)?.title
          : null) ?? post.referenceTitle,
      reference: post.governmentReferenceId
        ? referenceViews.get(post.governmentReferenceId) ?? null
        : null,
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: `/uploads${m.url}`,
        thumbnailUrl: m.thumbnailUrl ? `/uploads${m.thumbnailUrl}` : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
      })),
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      createdAt: post.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
});

/**
 * POST /api/posts
 * Create a new post (requires auth)
 */
postsRouter.post("/", zValidator("json", createPostSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { content, billId, governmentReferenceId, referenceType, referenceId, mediaIds } =
    c.req.valid("json");

  // Resolve the selected reference to its active canonical row before writing.
  // The stored row — not the client payload — supplies type and title.
  const resolved = await resolvePostReference({ governmentReferenceId, referenceType, referenceId });

  if (!resolved.ok) {
    if (resolved.reason === "conflicting_ids") {
      return c.json(
        { error: "governmentReferenceId and referenceId refer to different references" },
        400
      );
    }
    if (resolved.reason === "merge_cycle") {
      return c.json({ error: "Reference has a corrupt merge chain and cannot be used" }, 409);
    }
    return c.json({ error: "Government reference not found" }, 404);
  }

  const reference = resolved.reference;

  // Verify bill exists if provided
  if (billId) {
    const bill = await prisma.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      return c.json({ error: "Bill not found" }, 404);
    }
  }

  // Verify media IDs exist and belong to the user
  if (mediaIds && mediaIds.length > 0) {
    const media = await prisma.media.findMany({
      where: {
        id: { in: mediaIds },
        userId: user.id,
      },
    });

    if (media.length !== mediaIds.length) {
      return c.json({ error: "One or more media IDs are invalid or do not belong to you" }, 400);
    }
  }

  const post = await prisma.post.create({
    data: {
      content,
      authorId: user.id,
      billId,
      // The canonical link that pulse queries join on.
      governmentReferenceId: reference.id,
      // Legacy display fields, filled from the stored row rather than the client.
      referenceType: reference.referenceType,
      referenceId: reference.id,
      referenceTitle: reference.title,
      ...(mediaIds && mediaIds.length > 0 ? {
        media: {
          connect: mediaIds.map((id) => ({ id })),
        },
      } : {}),
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      bill: {
        select: {
          id: true,
          title: true,
          category: true,
        },
      },
      media: {
        select: {
          id: true,
          type: true,
          url: true,
          thumbnailUrl: true,
          mimeType: true,
          sizeBytes: true,
          durationMs: true,
          width: true,
          height: true,
        },
      },
    },
  });

  // Sharing a law counts as pulling it: if this is the first time anyone has
  // touched this reference, queue the official-text pull and citizen brief so the
  // master reference is populated for everyone who arrives later. Fire-and-forget —
  // the composer never waits on it.
  jobQueue.enqueue(
    JobType.GENERATE_REFERENCE_BRIEF,
    { referenceId: reference.id },
    JobPriority.NORMAL
  );

  // The composer renders the new post immediately, so ship the same law-card
  // payload the feed sends rather than making it wait for a refetch.
  const referenceView = await loadPostReferenceView(post.governmentReferenceId, user.id);

  return c.json({
    post: {
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: post.author.email.split("@")[0],
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      // The law as it stands, not the copy frozen when the post was written.
      referenceTitle: referenceView?.title ?? post.referenceTitle,
      reference: referenceView,
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: `/uploads${m.url}`,
        thumbnailUrl: m.thumbnailUrl ? `/uploads${m.thumbnailUrl}` : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
      })),
      commentsCount: 0,
      likesCount: 0,
      createdAt: post.createdAt.toISOString(),
    },
  }, 201);
});

/**
 * GET /api/posts/:id
 * Get a single post
 */
postsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const post = await prisma.post.findUnique({
    where: { id },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      bill: {
        select: {
          id: true,
          title: true,
          category: true,
        },
      },
      media: {
        select: {
          id: true,
          type: true,
          url: true,
          thumbnailUrl: true,
          mimeType: true,
          sizeBytes: true,
          durationMs: true,
          width: true,
          height: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
        },
      },
    },
  });

  if (!post) {
    return c.json({ error: "Post not found" }, 404);
  }

  const referenceView = await loadPostReferenceView(post.governmentReferenceId, user?.id ?? null);

  return c.json({
    post: {
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: post.author.email.split("@")[0],
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      // The law as it stands, not the copy frozen when the post was written.
      referenceTitle: referenceView?.title ?? post.referenceTitle,
      reference: referenceView,
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: `/uploads${m.url}`,
        thumbnailUrl: m.thumbnailUrl ? `/uploads${m.thumbnailUrl}` : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
      })),
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      createdAt: post.createdAt.toISOString(),
    },
  });
});

/**
 * DELETE /api/posts/:id
 * Delete a post (owner only)
 */
postsRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");

  const post = await prisma.post.findUnique({ where: { id }, include: { media: true } });
  if (!post) {
    return c.json({ error: "Post not found" }, 404);
  }

  if (post.authorId !== user.id) {
    return c.json({ error: "Not authorized" }, 403);
  }

  // Bytes before row; see services/media-objects.ts for why that order and why
  // a storage failure has to stop this rather than be logged and ignored.
  //
  // This used to be `prisma.post.delete` alone. Media.postId is `onDelete:
  // Cascade`, so the Media rows went with the post while the objects stayed in
  // the bucket — still readable, and with the only record of their keys
  // destroyed in the same statement.
  const purge = await purgeMediaObjects(post.media, `post ${id}`);
  if (!purge.ok) {
    return c.json({ error: purge.message }, 500);
  }

  await prisma.post.delete({ where: { id } });

  return c.json({ success: true });
});

/**
 * POST /api/posts/:id/like
 * Like a post
 */
postsRouter.post("/:id/like", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const postId = c.req.param("id");

  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      author: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  if (!post) {
    return c.json({ error: "Post not found" }, 404);
  }

  try {
    await prisma.postLike.create({
      data: {
        postId,
        userId: user.id,
      },
    });

    // Send notification to post author (async, don't block response)
    notifyPostLike(
      post.authorId,
      user.id,
      user.name,
      postId,
      post.content
    ).catch((err) => console.error("Failed to send like notification:", err));

    return c.json({ success: true, liked: true });
  } catch {
    // Already liked - unlike
    await prisma.postLike.delete({
      where: {
        postId_userId: {
          postId,
          userId: user.id,
        },
      },
    });
    return c.json({ success: true, liked: false });
  }
});

/**
 * GET /api/posts/:id/comments
 * Get comments for a post
 */
postsRouter.get("/:id/comments", zValidator("query", paginationSchema), async (c) => {
  const postId = c.req.param("id");
  const { limit, cursor } = c.req.valid("query");

  const comments = await prisma.comment.findMany({
    where: { postId, parentId: null },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      _count: {
        select: {
          replies: true,
        },
      },
    },
  });

  const hasMore = comments.length > limit;
  const results = hasMore ? comments.slice(0, -1) : comments;
  const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

  return c.json({
    comments: results.map((comment) => ({
      id: comment.id,
      content: comment.content,
      author: {
        id: comment.author.id,
        displayName: comment.author.name,
        username: comment.author.email.split("@")[0],
        avatar: comment.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.author.id}`,
      },
      repliesCount: comment._count.replies,
      createdAt: comment.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
});

/**
 * GET /api/posts/:id/comments/:commentId/replies
 * Get the replies to a comment.
 *
 * The clients have called this since the threaded-comments UI shipped, but it
 * was never implemented, so expanding a thread always 404'd. Same response
 * shape as GET /:id/comments so the two can share a renderer.
 */
postsRouter.get(
  "/:id/comments/:commentId/replies",
  zValidator("query", paginationSchema),
  async (c) => {
    const postId = c.req.param("id");
    const commentId = c.req.param("commentId");
    const { limit, cursor } = c.req.valid("query");

    // Scope by postId too: a comment id from another post must not resolve here.
    const parent = await prisma.comment.findFirst({
      where: { id: commentId, postId },
      select: { id: true },
    });
    if (!parent) {
      return c.json({ error: "Comment not found" }, 404);
    }

    const replies = await prisma.comment.findMany({
      where: { postId, parentId: commentId },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "asc" },
      include: {
        author: { select: { id: true, name: true, email: true, image: true } },
        _count: { select: { replies: true } },
      },
    });

    const hasMore = replies.length > limit;
    const results = hasMore ? replies.slice(0, -1) : replies;
    const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

    return c.json({
      comments: results.map((comment) => ({
        id: comment.id,
        content: comment.content,
        author: {
          id: comment.author.id,
          displayName: comment.author.name,
          username: comment.author.email.split("@")[0],
          avatar: comment.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.author.id}`,
        },
        repliesCount: comment._count.replies,
        createdAt: comment.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    });
  }
);

/**
 * DELETE /api/posts/:id/comments/:commentId
 * Delete your own comment.
 *
 * Also never implemented, so the delete button in the web client 404'd.
 * Authorization mirrors DELETE /api/posts/:id — author only.
 */
postsRouter.delete("/:id/comments/:commentId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const postId = c.req.param("id");
  const commentId = c.req.param("commentId");

  const comment = await prisma.comment.findFirst({
    where: { id: commentId, postId },
    select: { id: true, authorId: true },
  });
  if (!comment) {
    return c.json({ error: "Comment not found" }, 404);
  }

  if (comment.authorId !== user.id) {
    return c.json({ error: "Not authorized" }, 403);
  }

  // Remove the replies with the comment. Comment.parentId is an optional
  // relation, so Prisma's default onDelete would set it to null instead —
  // silently promoting every reply to a top-level comment on the post.
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { parentId: commentId } }),
    prisma.comment.delete({ where: { id: commentId } }),
  ]);

  return c.json({ success: true });
});

/**
 * POST /api/posts/:id/comments
 * Add a comment to a post
 */
postsRouter.post(
  "/:id/comments",
  zValidator("json", z.object({ content: z.string().min(1).max(2000), parentId: z.string().optional() })),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const postId = c.req.param("id");
    const { content, parentId } = c.req.valid("json");

    const post = await prisma.post.findUnique({
      where: { id: postId },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    if (!post) {
      return c.json({ error: "Post not found" }, 404);
    }

    // If this is a reply, get the parent comment author
    let parentComment: { authorId: string; author: { name: string } } | null = null;
    if (parentId) {
      parentComment = await prisma.comment.findUnique({
        where: { id: parentId },
        select: {
          authorId: true,
          author: {
            select: { name: true },
          },
        },
      });
    }

    const comment = await prisma.comment.create({
      data: {
        content,
        postId,
        authorId: user.id,
        parentId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
      },
    });

    // Send notifications asynchronously (don't block response)
    const notificationPromises: Promise<unknown>[] = [];

    // Notify post author about the comment (if not replying to a specific comment)
    if (!parentId) {
      notificationPromises.push(
        notifyPostComment(
          post.authorId,
          user.id,
          user.name,
          postId,
          comment.id,
          content
        ).catch((err) => console.error("Failed to send comment notification:", err))
      );
    }

    // Notify parent comment author about the reply
    if (parentId && parentComment) {
      notificationPromises.push(
        notifyCommentReply(
          parentComment.authorId,
          user.id,
          user.name,
          postId,
          comment.id,
          content
        ).catch((err) => console.error("Failed to send reply notification:", err))
      );
    }

    // Check for @mentions in the comment and notify mentioned users
    notificationPromises.push(
      notifyMentions(
        content,
        user.id,
        user.name,
        postId,
        comment.id
      ).catch((err) => console.error("Failed to send mention notifications:", err))
    );

    // Fire and forget - don't await these
    Promise.all(notificationPromises).catch(() => {});

    return c.json({
      comment: {
        id: comment.id,
        content: comment.content,
        author: {
          id: comment.author.id,
          displayName: comment.author.name,
          username: comment.author.email.split("@")[0],
          avatar: comment.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.author.id}`,
        },
        repliesCount: 0,
        createdAt: comment.createdAt.toISOString(),
      },
    }, 201);
  }
);

export { postsRouter };
