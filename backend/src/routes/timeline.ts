import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const timelineRouter = new Hono();

// Type definitions
interface Author {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
}

interface Comment {
  id: string;
  authorId: string;
  author: Author;
  content: string;
  createdAt: string;
}

interface Post {
  id: string;
  authorId: string;
  author: Author;
  content: string;
  legislationRef?: {
    id: string;
    title: string;
    type: "bill" | "executive_order" | "court_case";
  };
  likes: number;
  supports: number;
  opposes: number;
  commentsCount: number;
  comments: Comment[];
  createdAt: string;
  isLiked: boolean;
  userVote: "support" | "oppose" | null;
}

// Mock authors data
const mockAuthors: Record<string, Author> = {
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

// Helper to get author with fallback
const getAuthor = (id: string): Author => {
  return mockAuthors[id] || {
    id,
    username: "unknown",
    displayName: "Unknown User",
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${id}`,
  };
};

// In-memory mock data storage
const mockPosts: Post[] = [
  {
    id: "1",
    authorId: "1",
    author: getAuthor("1"),
    content: "Just reviewed the new infrastructure bill. Some interesting provisions for public transit funding that could really help urban areas. What do you all think?",
    legislationRef: {
      id: "HR-1234",
      title: "Infrastructure Investment Act of 2024",
      type: "bill",
    },
    likes: 45,
    supports: 32,
    opposes: 8,
    commentsCount: 12,
    comments: [],
    createdAt: "2024-06-15T10:30:00Z",
    isLiked: false,
    userVote: null,
  },
  {
    id: "2",
    authorId: "2",
    author: getAuthor("2"),
    content: "The executive order on climate initiatives is a step in the right direction, but implementation details are still vague. Following up with my analysis soon.",
    legislationRef: {
      id: "EO-14008",
      title: "Executive Order on Climate Change",
      type: "executive_order",
    },
    likes: 89,
    supports: 67,
    opposes: 15,
    commentsCount: 28,
    comments: [],
    createdAt: "2024-06-14T15:45:00Z",
    isLiked: true,
    userVote: "support",
  },
  {
    id: "3",
    authorId: "3",
    author: getAuthor("3"),
    content: "Important Supreme Court ruling today on voting rights. This could have significant implications for upcoming elections. Thread incoming.",
    legislationRef: {
      id: "SCOTUS-2024-123",
      title: "Voting Rights Case Decision",
      type: "court_case",
    },
    likes: 156,
    supports: 89,
    opposes: 45,
    commentsCount: 67,
    comments: [],
    createdAt: "2024-06-13T09:15:00Z",
    isLiked: false,
    userVote: null,
  },
  {
    id: "4",
    authorId: "1",
    author: getAuthor("1"),
    content: "Attended the town hall meeting on local zoning changes. Great turnout! Civic engagement at its finest. Remember, local politics matters!",
    likes: 23,
    supports: 18,
    opposes: 2,
    commentsCount: 5,
    comments: [],
    createdAt: "2024-06-12T18:00:00Z",
    isLiked: false,
    userVote: "support",
  },
];

// Store for user interactions
const userLikes = new Set<string>(["2"]); // Post IDs that current user has liked
const userVotes = new Map<string, "support" | "oppose">([
  ["2", "support"],
  ["4", "support"],
]); // Post ID -> vote type

// Mock comments storage
const postComments = new Map<string, Comment[]>([
  ["1", [
    {
      id: "c1",
      authorId: "2",
      author: getAuthor("2"),
      content: "Great analysis! I particularly like the transit provisions.",
      createdAt: "2024-06-15T11:00:00Z",
    },
    {
      id: "c2",
      authorId: "3",
      author: getAuthor("3"),
      content: "Would love to see more details on rural infrastructure as well.",
      createdAt: "2024-06-15T11:30:00Z",
    },
  ]],
]);

// Helper function to get current user ID (mock - in real app this would come from auth)
const getCurrentUserId = (): string => "current_user";

// ID generator
let nextPostId = 5;
let nextCommentId = 3;

// Validation schemas
const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 20),
  offset: z.string().optional().transform((val) => val ? parseInt(val, 10) : 0),
  filter: z.enum(["all", "following", "trending"]).optional().default("all"),
});

const postIdParamSchema = z.object({
  id: z.string().min(1, "Post ID is required"),
});

const createPostSchema = z.object({
  content: z.string().min(1, "Content is required").max(1000, "Content too long"),
  legislationRef: z.object({
    id: z.string(),
    title: z.string(),
    type: z.enum(["bill", "executive_order", "court_case"]),
  }).optional(),
});

const voteSchema = z.object({
  vote: z.enum(["support", "oppose"]),
});

const commentSchema = z.object({
  content: z.string().min(1, "Comment content is required").max(500, "Comment too long"),
});

/**
 * GET /api/timeline
 * Get feed posts
 */
timelineRouter.get(
  "/",
  zValidator("query", paginationQuerySchema),
  (c) => {
    const { limit, offset, filter } = c.req.valid("query");

    let posts = [...mockPosts];

    // Apply filters
    if (filter === "trending") {
      posts.sort((a, b) => (b.likes + b.supports) - (a.likes + a.supports));
    } else {
      // Default: sort by date
      posts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // Add user-specific data
    posts = posts.map((post) => ({
      ...post,
      isLiked: userLikes.has(post.id),
      userVote: userVotes.get(post.id) || null,
      comments: postComments.get(post.id) || [],
      commentsCount: (postComments.get(post.id) || []).length,
    }));

    const paginatedPosts = posts.slice(offset, offset + limit);

    return c.json({
      results: paginatedPosts,
      pagination: {
        total: posts.length,
        limit,
        offset,
        hasMore: offset + limit < posts.length,
      },
    });
  }
);

/**
 * POST /api/timeline/posts
 * Create a new post
 */
timelineRouter.post(
  "/posts",
  zValidator("json", createPostSchema),
  (c) => {
    const { content, legislationRef } = c.req.valid("json");
    const currentUserId = getCurrentUserId();

    const newPost: Post = {
      id: String(nextPostId++),
      authorId: currentUserId,
      author: {
        id: currentUserId,
        username: "current_user",
        displayName: "Current User",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=current_user",
      },
      content,
      legislationRef,
      likes: 0,
      supports: 0,
      opposes: 0,
      commentsCount: 0,
      comments: [],
      createdAt: new Date().toISOString(),
      isLiked: false,
      userVote: null,
    };

    mockPosts.unshift(newPost);

    return c.json(newPost, { status: 201 });
  }
);

/**
 * POST /api/timeline/posts/:id/like
 * Like or unlike a post
 */
timelineRouter.post(
  "/posts/:id/like",
  zValidator("param", postIdParamSchema),
  (c) => {
    const { id } = c.req.valid("param");

    const post = mockPosts.find((p) => p.id === id);
    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
    }

    const isCurrentlyLiked = userLikes.has(id);

    if (isCurrentlyLiked) {
      userLikes.delete(id);
      post.likes = Math.max(0, post.likes - 1);
    } else {
      userLikes.add(id);
      post.likes += 1;
    }

    return c.json({
      success: true,
      isLiked: !isCurrentlyLiked,
      likes: post.likes,
    });
  }
);

/**
 * POST /api/timeline/posts/:id/vote
 * Support or oppose a post/legislation
 */
timelineRouter.post(
  "/posts/:id/vote",
  zValidator("param", postIdParamSchema),
  zValidator("json", voteSchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { vote } = c.req.valid("json");

    const post = mockPosts.find((p) => p.id === id);
    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
    }

    const currentVote = userVotes.get(id);

    // Remove previous vote if exists
    if (currentVote) {
      if (currentVote === "support") {
        post.supports = Math.max(0, post.supports - 1);
      } else {
        post.opposes = Math.max(0, post.opposes - 1);
      }
    }

    // If clicking the same vote, remove it (toggle off)
    if (currentVote === vote) {
      userVotes.delete(id);
      return c.json({
        success: true,
        userVote: null,
        supports: post.supports,
        opposes: post.opposes,
      });
    }

    // Add new vote
    userVotes.set(id, vote);
    if (vote === "support") {
      post.supports += 1;
    } else {
      post.opposes += 1;
    }

    return c.json({
      success: true,
      userVote: vote,
      supports: post.supports,
      opposes: post.opposes,
    });
  }
);

/**
 * POST /api/timeline/posts/:id/comments
 * Add a comment to a post
 */
timelineRouter.post(
  "/posts/:id/comments",
  zValidator("param", postIdParamSchema),
  zValidator("json", commentSchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { content } = c.req.valid("json");
    const currentUserId = getCurrentUserId();

    const post = mockPosts.find((p) => p.id === id);
    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
    }

    const newComment: Comment = {
      id: `c${nextCommentId++}`,
      authorId: currentUserId,
      author: {
        id: currentUserId,
        username: "current_user",
        displayName: "Current User",
        avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=current_user",
      },
      content,
      createdAt: new Date().toISOString(),
    };

    let comments = postComments.get(id);
    if (!comments) {
      comments = [];
      postComments.set(id, comments);
    }
    comments.push(newComment);

    post.commentsCount = comments.length;

    return c.json(newComment, { status: 201 });
  }
);

/**
 * GET /api/timeline/posts/:id/comments
 * Get comments for a post
 */
timelineRouter.get(
  "/posts/:id/comments",
  zValidator("param", postIdParamSchema),
  zValidator("query", paginationQuerySchema),
  (c) => {
    const { id } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    const post = mockPosts.find((p) => p.id === id);
    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
    }

    const comments = postComments.get(id) || [];
    const paginatedComments = comments.slice(offset, offset + limit);

    return c.json({
      results: paginatedComments,
      pagination: {
        total: comments.length,
        limit,
        offset,
        hasMore: offset + limit < comments.length,
      },
    });
  }
);

export { timelineRouter };
export type { Post, Comment, Author };
