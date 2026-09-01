import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
// The ONE place a stored key becomes a URL. media.url holds a storage key
// ("images/abc.jpg"), never a URL. Four handlers in this file used to build it
// by hand as `/uploads${key}` — which lost the separating slash, produced a
// relative path with no origin (nothing on a phone can resolve one, and on the
// web it points at the site rather than the API), and ignored the S3 driver
// completely. Every picture ever attached to a post was broken in every client.
import { publicUrlFor } from "../services/storage";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import { blockExistsBetween, hiddenFrom } from "../services/relationships";
import { purgeMediaObjects } from "../services/media-objects";
import type { auth } from "../auth";
import {
  notifyPostLike,
  notifyFollowersOfNewPost,
  notifyPostComment,
  notifyCommentReply,
  notifyMentions,
  notifyRepost,
} from "../services/notification-service";
import { resolvePostReference } from "../services/reference-resolver";
import { linkHashtags } from "../services/hashtags";
import {
  lawMovedSincePost,
  loadPostReferenceView,
  loadPostReferenceViews,
} from "../services/post-reference-view";
import { JobPriority, JobType, jobQueue } from "../services/job-queue";
import { invalidatePostCache } from "../services/cache";
import { publicHandle } from "../services/public-identity";

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
  /*
   * A POST NEEDS SOMETHING IN IT — AND THE LAW COUNTS.
   *
   * This required text or media, so sharing a law with no comment was refused.
   * That is wrong for this platform: putting a law in front of people, with
   * nothing added, IS the act. Khalid: "allow posts with out adding text to it
   * from all places."
   *
   * Every post here carries a government reference — the rule above makes that
   * mandatory — so a post is never empty. It is a law, with or without words.
   */
  .refine(
    (data) =>
      data.content.trim().length > 0 ||
      (data.mediaIds?.length ?? 0) > 0 ||
      Boolean(data.governmentReferenceId ?? data.referenceId),
    { message: "Post must have text, media, or a law", path: ["content"] },
  );

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

  // Blocked and muted people do not appear. Asking for one specific author is
  // still refused if they are hidden — otherwise a block is undone by anyone
  // who knows how to type a profile URL.
  const hidden = await hiddenFrom(user?.id);
  if (resolvedAuthorId && hidden.includes(resolvedAuthorId)) {
    return c.json({ posts: [], nextCursor: undefined, hasMore: false });
  }

  const posts = await prisma.post.findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    where: {
      ...(resolvedAuthorId ? { authorId: resolvedAuthorId } : {}),
      ...(!resolvedAuthorId && hidden.length > 0 ? { authorId: { notIn: hidden } } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
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
      // The post being passed on, so a card can render it inline rather than
      // making a second request per repost in the page.
      repostOf: {
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: { id: true, name: true, username: true, displayUsername: true, image: true } },
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
          reposts: true,
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

  // WHICH OF THESE YOU HAVE ALREADY LIKED.
  //
  // Only /api/feed returned this. Every other list of posts — your own profile,
  // somebody else's, the web feed, the mobile timeline — is served from here,
  // and without it every heart rendered empty however many you had pressed. The
  // first tap then read as a new like and the second took away a like you had
  // already made.
  const likedByMe = new Set<string>(
    user
      ? (
          await prisma.postLike.findMany({
            where: { userId: user.id, postId: { in: results.map((post) => post.id) } },
            select: { postId: true },
          })
        ).map((like) => like.postId)
      : [],
  );

  // Which of these you have already passed on. Keyed by the ORIGINAL, so a
  // repost and the post it came from both show the button as pressed.
  const repostedByMe = new Set<string>(
    user
      ? (
          await prisma.post.findMany({
            where: {
              authorId: user.id,
              content: "",
              repostOfId: { in: results.map((post) => post.repostOfId ?? post.id) },
            },
            select: { repostOfId: true },
          })
        ).flatMap((repost) => (repost.repostOfId ? [repost.repostOfId] : []))
      : [],
  );

  return c.json({
    posts: results.map((post) => ({
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: publicHandle(post.author),
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
      // The law under this post has moved since it was written. The post is
      // untouched; the card says so.
      lawUpdatedSincePosting: lawMovedSincePost(
        post.createdAt,
        post.governmentReferenceId ? referenceViews.get(post.governmentReferenceId) : null,
      ),
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: publicUrlFor(m.url),
        thumbnailUrl: m.thumbnailUrl ? publicUrlFor(m.thumbnailUrl) : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
      })),
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      isLiked: likedByMe.has(post.id),
      repostsCount: post._count.reposts,
      isRepostedByMe: repostedByMe.has(post.repostOfId ?? post.id),
      repostOf: post.repostOf
        ? {
            id: post.repostOf.id,
            content: post.repostOf.content,
            author: {
              id: post.repostOf.author.id,
              displayName: post.repostOf.author.name,
              username: publicHandle(post.repostOf.author),
              avatar:
                post.repostOf.author.image ||
                `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.repostOf.author.id}`,
            },
            createdAt: post.repostOf.createdAt.toISOString(),
          }
        : null,
      createdAt: post.createdAt.toISOString(),
      // NULL means never edited, which is true of every post that predates this.
      editedAt: post.editedAt?.toISOString() ?? null,
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

  // CONSTITUTION ARTICLE I, SECTION 3 / BILL OF RIGHTS ARTICLE III. Writing to
  // the public record needs a verified account, so a thousand throwaway
  // signups cannot manufacture a conversation around a bill.
  if (!(await isVerified(user))) {
    return c.json(VERIFICATION_REQUIRED, 403);
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
          username: true,
          displayUsername: true,
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

  // File the post's hashtags. Not awaited: the tables behind this are a
  // convenience for discovery, and the post is the thing that matters.
  void linkHashtags(post.id, post.content);

  // TELL THE PEOPLE WHO FOLLOW YOU.
  //
  // notifyFollowersOfNewPost was written, complete, and called from nowhere.
  // Following someone is a request to hear from them, and without this it was a
  // bookmark with extra steps: a follower learned about a post only if they
  // happened to scroll past it.
  //
  // Not awaited. The composer should not wait on a fan-out, and a notification
  // that fails is not a reason to lose somebody's post.
  void notifyFollowersOfNewPost(user.id, user.name, post.id, post.content).catch((error) => {
    console.error("[Notify] followers of new post:", error);
  });

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
        username: publicHandle(post.author),
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      // The law as it stands, not the copy frozen when the post was written.
      referenceTitle: referenceView?.title ?? post.referenceTitle,
      reference: referenceView,
      // The law under this post has moved since it was written. The post is
      // untouched; the card says so.
      lawUpdatedSincePosting: lawMovedSincePost(post.createdAt, referenceView),
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: publicUrlFor(m.url),
        thumbnailUrl: m.thumbnailUrl ? publicUrlFor(m.thumbnailUrl) : null,
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

// REGISTERED BEFORE "/:id", AND THAT IS LOAD-BEARING.
//
// "/api/posts/search" is one path segment, and so is "/api/posts/:id". Declared
// after it, the parameter route wins and every search is answered as a request
// for a post whose id is the word "search" — a 404 dressed up as an empty
// result. Both of these were written at the end of the file first, and both
// were swallowed exactly that way.

/**
 * GET /api/posts/search?q=…
 *
 * Find what people have said, not just who they are.
 *
 * Search found users and nothing else, so the only way to reach a conversation
 * about a bill was to already know which bill it was about. On a platform whose
 * subject matter arrives with names nobody uses in conversation — "H.R. 3194",
 * "Executive Order 14407" — that is a real gap: people search for what a law
 * DOES, and other people have already written that down.
 *
 * Matches the post's own words and the title of the law it is attached to, so
 * searching "insulin" finds both a post that says insulin and a post about the
 * bill whose title does.
 */
postsRouter.get(
  "/search",
  zValidator("query", z.object({ q: z.string().min(1).max(200), limit: z.coerce.number().min(1).max(50).default(20) })),
  async (c) => {
    const user = c.get("user");
    const { q, limit } = c.req.valid("query");
    const hidden = await hiddenFrom(user?.id);

    const posts = await prisma.post.findMany({
      where: {
        AND: [
          {
            OR: [
              { content: { contains: q, mode: "insensitive" } },
              { referenceTitle: { contains: q, mode: "insensitive" } },
              { governmentReference: { title: { contains: q, mode: "insensitive" } } },
              { governmentReference: { masterReferenceId: { contains: q, mode: "insensitive" } } },
            ],
          },
          ...(hidden.length > 0 ? [{ authorId: { notIn: hidden } }] : []),
        ],
      },
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, username: true, displayUsername: true, image: true } },
        governmentReference: { select: { id: true, title: true, masterReferenceId: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    return c.json({
      results: posts.map((post) => ({
        id: post.id,
        content: post.content,
        author: {
          id: post.author.id,
          displayName: post.author.name,
          username: publicHandle(post.author),
          avatar:
            post.author.image ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
        },
        referenceTitle: post.governmentReference?.title ?? post.referenceTitle,
        governmentReferenceId: post.governmentReferenceId,
        commentsCount: post._count.comments,
        likesCount: post._count.likes,
        createdAt: post.createdAt.toISOString(),
      })),
    });
  },
);

/**
 * GET /api/posts/hashtag/:tag
 *
 * The posts under one tag.
 *
 * Hashtags have been collected into their own table and ranked into a trending
 * list since long before this endpoint. There was nowhere for a tag to lead, so
 * the trending list was a row of words that could not be pressed.
 */
postsRouter.get(
  "/hashtag/:tag",
  zValidator("query", z.object({ limit: z.coerce.number().min(1).max(50).default(20) })),
  async (c) => {
    const user = c.get("user");
    const { limit } = c.req.valid("query");
    const tag = c.req.param("tag").replace(/^#/, "").toLowerCase();

    const hashtag = await prisma.hashtag.findUnique({ where: { tag }, select: { id: true } });
    if (!hashtag) {
      // An unused tag is not an error — it is a tag nobody has written under
      // yet, and the page for it should say so rather than break.
      return c.json({ tag, results: [], count: 0 });
    }

    const links = await prisma.postHashtag.findMany({
      where: { hashtagId: hashtag.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { postId: true },
    });

    const hidden = await hiddenFrom(user?.id);
    const posts = await prisma.post.findMany({
      where: {
        id: { in: links.map((l) => l.postId) },
        ...(hidden.length > 0 ? { authorId: { notIn: hidden } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, name: true, username: true, displayUsername: true, image: true } },
        governmentReference: { select: { id: true, title: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });

    return c.json({
      tag,
      count: posts.length,
      results: posts.map((post) => ({
        id: post.id,
        content: post.content,
        author: {
          id: post.author.id,
          displayName: post.author.name,
          username: publicHandle(post.author),
          avatar:
            post.author.image ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
        },
        referenceTitle: post.governmentReference?.title ?? post.referenceTitle,
        governmentReferenceId: post.governmentReferenceId,
        commentsCount: post._count.comments,
        likesCount: post._count.likes,
        createdAt: post.createdAt.toISOString(),
      })),
    });
  },
);

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
          username: true,
          displayUsername: true,
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

  // A blocked author's post is gone, not forbidden: "not found" is the same
  // answer a deleted post gives, and it never tells anybody they were blocked.
  if ((await hiddenFrom(user?.id)).includes(post.authorId)) {
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
        username: publicHandle(post.author),
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      bill: post.bill,
      governmentReferenceId: post.governmentReferenceId,
      referenceType: post.referenceType,
      referenceId: post.referenceId,
      // The law as it stands, not the copy frozen when the post was written.
      referenceTitle: referenceView?.title ?? post.referenceTitle,
      reference: referenceView,
      // The law under this post has moved since it was written. The post is
      // untouched; the card says so.
      lawUpdatedSincePosting: lawMovedSincePost(post.createdAt, referenceView),
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: publicUrlFor(m.url),
        thumbnailUrl: m.thumbnailUrl ? publicUrlFor(m.thumbnailUrl) : null,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        durationMs: m.durationMs,
        width: m.width,
        height: m.height,
      })),
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      isLiked: user
        ? (await prisma.postLike.findFirst({
            where: { postId: post.id, userId: user.id },
            select: { id: true },
          })) !== null
        : false,
      createdAt: post.createdAt.toISOString(),
    },
  });
});

/**
 * DELETE /api/posts/:id
 * Delete a post (owner only)
 */
/**
 * PATCH /api/posts/:id — the author changes their own words.
 *
 * Reported plainly: "The edit post button doesn't go anywhere ... It should
 * allow you to edit your post and its content. Not the original law posted but
 * the content that the poster added to it."
 *
 * THE LAW IS NOT EDITABLE HERE, AND THAT IS THE POINT. A post is somebody's
 * words ABOUT a record. Letting the author swap the record underneath would
 * turn every reply, vote and repost into a response to something that was
 * never said — so `content` is the only field this accepts, and the attachment
 * is fixed at the moment of posting.
 *
 * IT SAYS IT WAS EDITED. People reply to and pass on posts here, so rewriting
 * one silently is not an edit; it is a different post wearing the same replies.
 * editedAt is stamped and the card shows it.
 */
postsRouter.patch("/:id", zValidator("json", z.object({ content: z.string().max(5000) })), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");
  const { content } = c.req.valid("json");

  const post = await prisma.post.findUnique({
    where: { id },
    select: {
      authorId: true,
      governmentReferenceId: true,
      referenceId: true,
      _count: { select: { media: true } },
    },
  });
  if (!post) {
    return c.json({ error: "Post not found" }, 404);
  }
  if (post.authorId !== user.id) {
    return c.json({ error: "Not authorized" }, 403);
  }

  // The same rule the composer enforces: a post must still BE something. Words
  // may go if a law or a picture is carrying it, and may not if nothing is.
  const carriesSomethingElse =
    post._count.media > 0 || Boolean(post.governmentReferenceId ?? post.referenceId);
  if (content.trim().length === 0 && !carriesSomethingElse) {
    return c.json({ error: "Post must have text, media, or a law" }, 400);
  }

  const updated = await prisma.post.update({
    where: { id },
    data: { content: content.trim(), editedAt: new Date() },
    select: { id: true, content: true, editedAt: true },
  });

  // The feed serves from a cache. Without this the row says one thing and
  // /api/feed hands out the old words for up to two minutes, which reads as
  // the edit not having worked.
  invalidatePostCache(id, post.authorId);

  return c.json({ post: updated });
});

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

  // The feed serves from a cache. Without this the row is gone and /api/feed
  // still hands the post out for up to two minutes, which is indistinguishable
  // from the delete not having worked.
  invalidatePostCache(id, post.authorId);

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
  const user = c.get("user");

  const hidden = await hiddenFrom(user?.id);

  const comments = await prisma.comment.findMany({
    where: {
      postId,
      parentId: null,
      ...(hidden.length > 0 ? { authorId: { notIn: hidden } } : {}),
    },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayUsername: true,
          image: true,
        },
      },
      _count: {
        select: {
          replies: true,
          likes: true,
        },
      },
    },
  });

  const hasMore = comments.length > limit;
  const results = hasMore ? comments.slice(0, -1) : comments;
  const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

  // Which of these the reader has liked. The comment UI has drawn a filled or
  // empty heart from this since long before there was anything to fill it from.
  const likedComments = new Set<string>(
    user
      ? (
          await prisma.commentLike.findMany({
            where: { userId: user.id, commentId: { in: results.map((comment) => comment.id) } },
            select: { commentId: true },
          })
        ).map((like) => like.commentId)
      : [],
  );

  return c.json({
    comments: results.map((comment) => ({
      id: comment.id,
      content: comment.content,
      author: {
        id: comment.author.id,
        displayName: comment.author.name,
        username: publicHandle(comment.author),
        avatar: comment.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.author.id}`,
      },
      repliesCount: comment._count.replies,
      likesCount: comment._count.likes,
      isLiked: likedComments.has(comment.id),
      createdAt: comment.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
});

/**
 * POST /api/posts/:id/comments/:commentId/like
 *
 * Toggles, like the post heart. The comment UI has rendered `isLiked` since
 * before this endpoint existed, so pressing it changed a local variable and
 * nothing else — the heart was decoration.
 */
postsRouter.post("/:id/comments/:commentId/like", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const commentId = c.req.param("commentId");
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, authorId: true, postId: true },
  });
  if (!comment || comment.postId !== c.req.param("id")) {
    return c.json({ error: "Comment not found" }, 404);
  }

  if (await blockExistsBetween(user.id, comment.authorId)) {
    return c.json({ error: "Comment not found" }, 404);
  }

  const existing = await prisma.commentLike.findUnique({
    where: { commentId_userId: { commentId, userId: user.id } },
    select: { id: true },
  });

  if (existing) {
    await prisma.commentLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.commentLike.create({ data: { commentId, userId: user.id } });
  }

  const likesCount = await prisma.commentLike.count({ where: { commentId } });
  return c.json({ isLiked: !existing, likesCount });
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
        author: { select: { id: true, name: true, username: true, displayUsername: true, image: true } },
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
          username: publicHandle(comment.author),
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

    if (!(await isVerified(user))) {
      return c.json(VERIFICATION_REQUIRED, 403);
    }

    const postId = c.req.param("id");

    // You cannot talk to somebody who has blocked you, or to somebody you have
    // blocked. Silent on which: the reply simply cannot be posted.
    const postAuthor = await prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    });
    if (postAuthor && (await blockExistsBetween(user.id, postAuthor.authorId))) {
      return c.json({ error: "This post is not accepting replies from you" }, 403);
    }

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
            username: true,
            displayUsername: true,
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
          username: publicHandle(comment.author),
          avatar: comment.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${comment.author.id}`,
        },
        repliesCount: 0,
        createdAt: comment.createdAt.toISOString(),
      },
    }, 201);
  }
);

export { postsRouter };

/**
 * POST /api/posts/:id/repost
 *
 * Pass somebody else's post on. With `content`, it is a quote — your words
 * above theirs. Without, it is a plain "here, read this".
 *
 * WHY THIS MATTERS ON THIS PLATFORM in particular: the whole premise is getting
 * a law in front of people who have not seen it. Until now the only way to do
 * that was to write your own post about the same law, which starts a second
 * conversation rather than joining the one already happening. `notifyRepost`
 * has existed since long before this endpoint, called from nowhere.
 *
 * A repost inherits the original's law. It cannot be about a different one —
 * that would be a new post, not a repost.
 */
postsRouter.post("/:id/repost", async (c) => {
  {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    if (!(await isVerified(user))) {
      return c.json(VERIFICATION_REQUIRED, 403);
    }

    const targetId = c.req.param("id");
    const target = await prisma.post.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        authorId: true,
        repostOfId: true,
        governmentReferenceId: true,
        referenceType: true,
        referenceId: true,
        referenceTitle: true,
        billId: true,
      },
    });
    if (!target) {
      return c.json({ error: "Post not found" }, 404);
    }

    if ((await hiddenFrom(user.id)).includes(target.authorId)) {
      return c.json({ error: "Post not found" }, 404);
    }

    // NO CHAINS. Reposting a repost points at the original, so a post's repost
    // count is the number of people who passed it on rather than the depth of a
    // game of telephone — and the card always has one original to render.
    const originalId = target.repostOfId ?? target.id;
    const original =
      target.repostOfId === null
        ? target
        : await prisma.post.findUnique({
            where: { id: originalId },
            select: {
              id: true,
              authorId: true,
              governmentReferenceId: true,
              referenceType: true,
              referenceId: true,
              referenceTitle: true,
              billId: true,
            },
          });
    if (!original) {
      return c.json({ error: "Post not found" }, 404);
    }

    // THE BODY IS OPTIONAL. A plain repost is a button with nothing to say, so
    // it sends nothing — and a validator that demands a body turns that into a
    // 400 and a repost that silently did not happen. The same shape of bug was
    // already found once on the share endpoint.
    const raw = await c.req.json().catch(() => ({}));
    const parsed = z.object({ content: z.string().max(5000).optional() }).safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "content must be text, up to 5000 characters" }, 400);
    }
    const content = (parsed.data.content ?? "").trim();

    // One plain repost per person per post: pressing it again takes it back,
    // the way the like button does. A quote is a piece of writing, so several
    // are allowed — they say different things.
    if (content.length === 0) {
      const existing = await prisma.post.findFirst({
        where: { authorId: user.id, repostOfId: originalId, content: "" },
        select: { id: true },
      });
      if (existing) {
        await prisma.post.delete({ where: { id: existing.id } });
        const repostsCount = await prisma.post.count({ where: { repostOfId: originalId } });
        return c.json({ reposted: false, repostsCount });
      }
    }

    const created = await prisma.post.create({
      data: {
        authorId: user.id,
        content,
        repostOfId: originalId,
        // Inherited, not chosen: a repost is about the law the original is about.
        governmentReferenceId: original.governmentReferenceId,
        referenceType: original.referenceType,
        referenceId: original.referenceId,
        referenceTitle: original.referenceTitle,
        billId: original.billId,
      },
      select: { id: true },
    });

    if (original.authorId !== user.id) {
      void notifyRepost(original.authorId, user.id, user.name, originalId).catch((error) => {
        console.error("[Notify] repost:", error);
      });
    }

    const repostsCount = await prisma.post.count({ where: { repostOfId: originalId } });
    return c.json({ reposted: true, repostId: created.id, repostsCount }, 201);
  }
});
