import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { notifyFollow } from "../services/notification-service";
import { blockExistsBetween, hiddenFrom } from "../services/relationships";
import { commonGround } from "../services/common-ground";
import {
  positionHistory,
  positionSummary,
  positionsNeedingReview,
  standing,
} from "../services/position-history";
import type { auth } from "../auth";
import { verifyPasswordOrDummy } from "../password-check";
import { setUserPassword } from "../services/credentials";
import { MIN_COHORT, listDistricts } from "../services/jurisdiction";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const usersRouter = new Hono<{ Variables: AuthVariables }>();

// Validation schemas
const searchQuerySchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

// Helper function to format user for API response
function formatUser(user: {
  id: string;
  name: string;
  username?: string | null;
  email: string;
  image: string | null;
  bio: string | null;
  location: string | null;
  createdAt: Date;
  _count?: { followers: number; following: number; votes: number };
}, isFollowing: boolean = false) {
  return {
    id: user.id,
    username: user.username || user.email.split("@")[0],
    displayName: user.name,
    avatar: user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
    bio: user.bio || "",
    location: user.location || "",
    joinedDate: user.createdAt.toISOString(),
    followers: user._count?.followers ?? 0,
    following: user._count?.following ?? 0,
    votesCount: user._count?.votes ?? 0,
    isFollowing,
  };
}

/**
 * GET /api/users/search
 * Search users by name or email
 */
usersRouter.get("/search", zValidator("query", searchQuerySchema), async (c) => {
  const { q, limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");
  const query = `%${q}%`;

  const users = await prisma.$queryRaw<Array<{
    id: string;
    name: string;
    email: string;
    image: string | null;
    bio: string | null;
    location: string | null;
    createdAt: Date;
  }>>`
    SELECT id, name, email, image, bio, location, "createdAt"
    FROM "User"
    WHERE name ILIKE ${query} OR email ILIKE ${query}
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM "User"
    WHERE name ILIKE ${query} OR email ILIKE ${query}
  `;
  const total = Number(countResult[0]?.count || 0);

  // Get counts for each user
  const userIds = users.map(u => u.id);
  const usersWithCounts = await Promise.all(users.map(async (user) => {
    const [followersCount, followingCount, votesCount] = await Promise.all([
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.vote.count({ where: { userId: user.id } }),
    ]);
    return {
      ...user,
      _count: { followers: followersCount, following: followingCount, votes: votesCount }
    };
  }));

  // Check follow status for each user
  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: userIds },
      },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  // BLOCKED PEOPLE ARE NOT SEARCHABLE. Filtered after the query rather than
  // inside it: this one is raw SQL for the ILIKE, and threading a variable-length
  // exclusion list through a tagged template is the kind of clever that goes
  // wrong quietly. The cost is that `total` counts rows that are then removed,
  // which overstates a search page by however many people you have blocked.
  const hiddenInSearch = await hiddenFrom(currentUser?.id);
  const visible = hiddenInSearch.length > 0
    ? usersWithCounts.filter((user) => !hiddenInSearch.includes(user.id))
    : usersWithCounts;

  return c.json({
    results: visible.map((user) => formatUser(user, followStatuses[user.id] ?? false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * GET /api/users/discover
 * Get suggested users to follow
 */
usersRouter.get("/discover", zValidator("query", paginationQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  // Get users the current user is not following
  const excludeIds = currentUser ? [currentUser.id] : [];

  if (currentUser) {
    const following = await prisma.follow.findMany({
      where: { followerId: currentUser.id },
      select: { followingId: true },
    });
    excludeIds.push(...following.map((f) => f.followingId));
  }

  // Somebody you blocked, somebody who blocked you, and anybody you muted are
  // not people to suggest.
  excludeIds.push(...(await hiddenFrom(currentUser?.id)));

  const users = await prisma.user.findMany({
    where: {
      id: { notIn: excludeIds },
    },
    take: limit,
    skip: offset,
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          votes: true,
        },
      },
    },
  });

  const total = await prisma.user.count({
    where: {
      id: { notIn: excludeIds },
    },
  });

  return c.json({
    results: users.map((user) => formatUser(user, false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * GET /api/users/active
 * Get most active users (by votes)
 */
usersRouter.get("/active", zValidator("query", paginationQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  const hidden = await hiddenFrom(currentUser?.id);

  const users = await prisma.user.findMany({
    ...(hidden.length > 0 ? { where: { id: { notIn: hidden } } } : {}),
    take: limit,
    skip: offset,
    orderBy: {
      votes: {
        _count: "desc",
      },
    },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          votes: true,
        },
      },
    },
  });

  const total = await prisma.user.count();

  // Check follow status
  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: users.map((u) => u.id) },
      },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  return c.json({
    results: users.map((user) => formatUser(user, followStatuses[user.id] ?? false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * GET /api/users/new
 * Get newest users
 */
usersRouter.get("/new", zValidator("query", paginationQuerySchema), async (c) => {
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  const hidden = await hiddenFrom(currentUser?.id);

  const users = await prisma.user.findMany({
    ...(hidden.length > 0 ? { where: { id: { notIn: hidden } } } : {}),
    take: limit,
    skip: offset,
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: {
          followers: true,
          following: true,
          votes: true,
        },
      },
    },
  });

  const total = await prisma.user.count();

  // Check follow status
  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: users.map((u) => u.id) },
      },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  return c.json({
    results: users.map((user) => formatUser(user, followStatuses[user.id] ?? false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * GET /api/users/:id
 * Get user profile by ID
 */
usersRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  // `_count.votes` counts the LEGACY Vote table, which has taken no new rows
  // since both clients dropped /api/bills/:id/vote. Counting only that told a
  // citizen who had voted forty times that they had voted none. Both tables,
  // for the same reason the admin and B2B dashboards count both: the old rows
  // are votes real people really cast.
  const [user, referenceVotes] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            followers: true,
            following: true,
            votes: true,
          },
        },
      },
    }),
    prisma.governmentReferenceVote.count({ where: { userId: id } }),
  ]);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Check if current user follows this user
  let isFollowing = false;
  if (currentUser && currentUser.id !== id) {
    const follow = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: id,
        },
      },
    });
    isFollowing = !!follow;
  }

  if (currentUser && (await blockExistsBetween(currentUser.id, user.id))) {
    return c.json({ error: "User not found" }, 404);
  }

  // Friendship here is a mutual follow and nothing more — see the friends route
  // for why that is named rather than invented.
  const followsBack =
    currentUser && isFollowing
      ? (await prisma.follow.findFirst({
          where: { followerId: user.id, followingId: currentUser.id },
          select: { id: true },
        })) !== null
      : false;

  return c.json({
    ...formatUser(user, isFollowing),
    votesCount: (user._count?.votes ?? 0) + referenceVotes,
    isFriend: followsBack,
  });
});

/**
 * GET /api/users/:id/followers
 * Get users who follow this user
 */
usersRouter.get("/:id/followers", zValidator("query", paginationQuerySchema), async (c) => {
  const id = c.req.param("id");
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const followers = await prisma.follow.findMany({
    where: { followingId: id },
    take: limit,
    skip: offset,
    include: {
      follower: {
        include: {
          _count: {
            select: {
              followers: true,
              following: true,
              votes: true,
            },
          },
        },
      },
    },
  });

  const total = await prisma.follow.count({ where: { followingId: id } });

  // Check follow status
  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: followers.map((f) => f.follower.id) },
      },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  return c.json({
    results: followers.map((f) => formatUser(f.follower, followStatuses[f.follower.id] ?? false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * GET /api/users/:id/following
 * Get users that this user follows
 */
usersRouter.get("/:id/following", zValidator("query", paginationQuerySchema), async (c) => {
  const id = c.req.param("id");
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const following = await prisma.follow.findMany({
    where: { followerId: id },
    take: limit,
    skip: offset,
    include: {
      following: {
        include: {
          _count: {
            select: {
              followers: true,
              following: true,
              votes: true,
            },
          },
        },
      },
    },
  });

  const total = await prisma.follow.count({ where: { followerId: id } });

  // Check follow status
  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: {
        followerId: currentUser.id,
        followingId: { in: following.map((f) => f.following.id) },
      },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  return c.json({
    results: following.map((f) => formatUser(f.following, followStatuses[f.following.id] ?? false)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

/**
 * POST /api/users/:id/follow
 * Follow a user
 */
usersRouter.post("/:id/follow", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");

  if (id === currentUser.id) {
    return c.json({ error: "Cannot follow yourself" }, 400);
  }

  const userToFollow = await prisma.user.findUnique({ where: { id } });
  if (!userToFollow) {
    return c.json({ error: "User not found" }, 404);
  }

  // Neither direction of a block permits a follow, and neither is told which
  // way it runs — "not found" is what a person who no longer exists looks like.
  if (await blockExistsBetween(currentUser.id, id)) {
    return c.json({ error: "User not found" }, 404);
  }

  try {
    await prisma.follow.create({
      data: {
        followerId: currentUser.id,
        followingId: id,
      },
    });

    // TELL THEM. notifyFollow was written and called from nowhere, so being
    // followed was a silent event — the one social action whose entire point is
    // that the other person finds out.
    //
    // Not awaited: a follow that succeeded must not be reported as failed
    // because the notification did not write.
    void notifyFollow(id, currentUser.id, currentUser.name).catch((error) => {
      console.error("[Notify] follow:", error);
    });

    return c.json({
      success: true,
      message: `Now following ${userToFollow.name}`,
      isFollowing: true,
    });
  } catch {
    return c.json({ error: "Already following this user" }, 400);
  }
});

/**
 * DELETE /api/users/:id/follow
 * Unfollow a user
 */
usersRouter.delete("/:id/follow", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");

  const userToUnfollow = await prisma.user.findUnique({ where: { id } });
  if (!userToUnfollow) {
    return c.json({ error: "User not found" }, 404);
  }

  try {
    await prisma.follow.delete({
      where: {
        followerId_followingId: {
          followerId: currentUser.id,
          followingId: id,
        },
      },
    });

    return c.json({
      success: true,
      message: `Unfollowed ${userToUnfollow.name}`,
      isFollowing: false,
    });
  } catch {
    return c.json({ error: "Not following this user" }, 400);
  }
});

/**
 * GET /api/users/me/votes
 * Get current user's voting history (paginated)
 */
usersRouter.get("/me/votes", zValidator("query", z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
})), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { limit, cursor } = c.req.valid("query");

  try {
    // Fetch votes with pagination
    const votes = await prisma.governmentReferenceVote.findMany({
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      where: { userId: currentUser.id },
      orderBy: { createdAt: "desc" },
      include: {
        governmentReference: {
          select: {
            id: true,
            title: true,
            shortTitle: true,
            referenceType: true,
            category: true,
            status: true,
          },
        },
      },
    });

    const hasMore = votes.length > limit;
    const results = hasMore ? votes.slice(0, -1) : votes;
    const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

    // Overall counts across ALL of the user's votes (not just this page)
    const [yea, nay] = await Promise.all([
      prisma.governmentReferenceVote.count({
        where: { userId: currentUser.id, position: "support" },
      }),
      prisma.governmentReferenceVote.count({
        where: { userId: currentUser.id, position: "oppose" },
      }),
    ]);

    return c.json({
      votes: results.map((vote) => ({
        id: vote.id,
        referenceId: vote.governmentReference.id,
        referenceTitle: vote.governmentReference.title,
        referenceType: vote.governmentReference.referenceType,
        position: vote.position,
        createdAt: vote.createdAt.toISOString(),
        reference: {
          id: vote.governmentReference.id,
          title: vote.governmentReference.title,
          shortTitle: vote.governmentReference.shortTitle,
          referenceType: vote.governmentReference.referenceType,
          category: vote.governmentReference.category,
          status: vote.governmentReference.status,
        },
      })),
      counts: { yea, nay, total: yea + nay },
      nextCursor,
      hasMore,
    });
  } catch (err) {
    console.error("Error fetching user votes:", err);
    return c.json({ error: "Failed to fetch voting history" }, 500);
  }
});

/**
 * PATCH /api/users/me
 * Update current user's profile
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: z.string().min(8, "Use at least 8 characters"),
  /**
   * Ends every other session. Default true: somebody changing their password
   * is usually doing it because they think somebody else has it, and leaving
   * the other sessions alive would defeat the point. The device they are
   * typing on stays signed in either way.
   */
  signOutOtherDevices: z.boolean().optional().default(true),
});

/**
 * POST /api/users/me/password
 *
 * Change your own password.
 *
 * WHY THIS EXISTS. No backend process re-keys anybody: the seed scripts create
 * and never overwrite, and a credential only moves through
 * services/credentials.ts. That rule is only livable if the people who should
 * be able to change a password still can — and until now a signed-in person
 * could not. The only route to a new password was "forgot password", which
 * means logging out and waiting for an email to arrive, for something they
 * already had the right to do.
 *
 * The current password is required. Without it, anyone who reaches an unlocked
 * laptop takes the account permanently, and a session cookie is not consent to
 * change the credential behind it.
 */
usersRouter.post("/me/password", zValidator("json", changePasswordSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const { currentPassword, newPassword, signOutOtherDevices } = c.req.valid("json");

  const credential = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "credential" },
    select: { password: true },
  });

  // Same shape for "no credential row" and "wrong password", and the check runs
  // either way — see password-check.ts. This is the caller's own account, so
  // enumeration is not the risk; a timing difference that says whether a
  // password is even set is still not worth handing out.
  const ok = await verifyPasswordOrDummy(credential?.password, currentPassword, "user");
  if (!ok) {
    return c.json({ error: "That is not your current password." }, 403);
  }

  if (newPassword === currentPassword) {
    return c.json({ error: "That is the password you already have." }, 400);
  }

  const currentUsername = (user as { username?: string | null }).username ?? user.id;

  // This request's own session is spared, so the person stays signed in on the
  // device they are typing on. Re-authenticating them here instead would mean
  // handling a password inside this route a second time, for no gain.
  const session = c.get("session");

  const { revokedSessions } = await setUserPassword(
    user.id,
    newPassword,
    {
      actor: { kind: "self", userId: user.id, username: currentUsername },
      reason: "Changed by the account holder from Settings",
    },
    { revokeSessions: signOutOtherDevices, keepSessionId: session?.id }
  );

  return c.json({
    success: true,
    // Reported so the client can say "signed out on 3 other devices" rather
    // than leaving somebody to wonder whether it worked everywhere.
    signedOutOtherDevices: revokedSessions,
  });
});

usersRouter.patch("/me", zValidator("json", z.object({
  name: z.string().min(1).max(100).optional(),
  username: z.string().min(1).max(30).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers and underscores only").optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(100).optional(),
  // http(s) ONLY. z.url() accepts file:// and any other scheme, and a
  // `file:///var/mobile/.../IMG_0042.jpg` avatar stores cleanly and then
  // renders as a broken image on every device except the one that set it.
  image: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "must be an http(s) URL")
    .optional(),
})), async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const data = c.req.valid("json");

  try {
    const user = await prisma.user.update({
      where: { id: currentUser.id },
      data,
      include: {
        _count: {
          select: {
            followers: true,
            following: true,
            votes: true,
          },
        },
      },
    });

    return c.json(formatUser(user, false));
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return c.json({ error: "That username is taken" }, 409);
    }
    throw err;
  }
});

/**
 * GET /api/jurisdiction/districts
 *
 * Every district there actually is, with who holds it — so a person choosing
 * theirs sees their representative's name and can tell at a glance whether they
 * picked right.
 *
 * Public. It is the roster of Congress; it says nothing about anybody here.
 */
usersRouter.get("/jurisdiction/districts", async (c) => {
  const { districts, source, congress } = await listDistricts();
  return c.json({
    districts,
    congress,
    source,
    total: districts.length,
  });
});

/**
 * GET /api/users/me/business-account
 *
 * Whether this person has a business account, and enough about it to recognise
 * which one — nothing more.
 *
 * WHY THIS EXISTS. The two logins are deliberately separate secrets: a citizen
 * changing their own password must never silently re-key a business account.
 * But separate credentials became separate WORLDS, with no way to get from one
 * to the other. Somebody given a business account had to be told out of band
 * that they had one, and then find /b2b themselves. The profile card this feeds
 * is the missing thread between the two.
 *
 * SELF ONLY, and there is no variant that takes an id. A business account is
 * not a public fact about a citizen: the platform has no business announcing on
 * a public profile that this person runs a research firm, a campaign, or a news
 * desk. The only reason to show it is so its owner can reach it, which is a
 * question only they can ask.
 *
 * NOTHING ABOUT THE ACCOUNT LEAVES HERE — NOT EVEN THE USERNAME.
 *
 * This used to return the username, business name and tier, on the reasoning
 * that the username is the one thing somebody cannot guess about their own
 * second login. That was wrong twice over. It printed half of a credential
 * pair onto a page people leave open, screenshot and share — a B2B login is
 * username plus password, and handing out the first half for free narrows an
 * attack to one unknown. And the business name is a fact about a person that
 * this endpoint had no reason to state.
 *
 * The card asks one question — is there a door for me — so the answer is one
 * bit. Whoever needs the username was given it when the account was made.
 */
/**
 * GET /api/users/me/admin-access
 *
 * Whether this person's account carries an administrative role, so their
 * profile can offer them the console.
 *
 * SAME SHAPE AND SAME REASON as the business-account endpoint beside it. The
 * console card used to be gated on `isStaff`, which reads the SEPARATE admin
 * console session — so somebody who genuinely held a role but had not signed
 * into the console yet was shown no way to get there. A door you can only see
 * once you are already through it.
 *
 * SELF ONLY. Nothing here answers this about anybody else, and it says nothing
 * about what the role may do — that is the console's business, not a public
 * fact about a citizen.
 */
usersRouter.get("/me/admin-access", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) return c.json({ error: "Authentication required" }, 401);

  const me = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { role: true },
  });

  const role = me?.role ?? "user";
  if (role === "user") return c.json({ adminAccess: null });

  // The name as configured, so a renamed role reads correctly on the card.
  const named = await prisma.adminRole
    .findUnique({ where: { slug: role }, select: { name: true } })
    .catch(() => null);

  return c.json({
    adminAccess: {
      role,
      name: role === "superadmin" ? "Owner" : (named?.name ?? role),
    },
  });
});

usersRouter.get("/me/business-account", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) return c.json({ error: "Authentication required" }, 401);

  // `id` only, and it is never sent. Selecting the username would put it in
  // this process's memory and one careless spread away from the response.
  const client = await prisma.b2BClient.findFirst({
    where: { userId: currentUser.id },
    select: { id: true },
  });

  // False rather than 404: not having one is an ordinary state for almost
  // everybody, and a 404 would read to the client as a failed request.
  return c.json({ hasBusinessAccount: client !== null });
});

/**
 * GET /api/users/me/jurisdiction
 *
 * Where this person has said their voice belongs, and what that means.
 */
usersRouter.get("/me/jurisdiction", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) return c.json({ error: "Authentication required" }, 401);

  const me = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: { stateCode: true, districtId: true, jurisdictionSetAt: true },
  });
  if (!me) return c.json({ error: "Account not found" }, 404);

  const { districts } = await listDistricts();
  const mine = me.districtId
    ? (districts.find((d) => d.districtId === me.districtId) ?? null)
    : null;

  return c.json({
    /** Null means they have not said, which is a complete answer, not a gap. */
    stateCode: me.stateCode,
    districtId: me.districtId,
    setAt: me.jurisdictionSetAt?.toISOString() ?? null,
    district: mine,
    /**
     * Said plainly on the screen, because a person handing over their district
     * is owed the reason and the limit. Bill of Rights Article IV authorises
     * collecting jurisdiction and caps collection at exactly that.
     */
    explanation: {
      why: "It places your vote in your own district, so the Pulse can be compared with how your representative actually voted.",
      collected: "Your state and district. Nothing else — no address, no ZIP kept, no location from your device.",
      shared:
        "Business clients only ever see totals for a district, and only where at least " +
        `${MIN_COHORT} people have voted. Never who you are, never how you voted.`,
      optional: "You can vote without this, and you can remove it at any time.",
    },
  });
});

/**
 * PUT /api/users/me/jurisdiction
 *
 * Declare where you are. Self-declared and validated against the real roster —
 * nothing geolocates anybody, and a district nobody represents is refused.
 */
usersRouter.put(
  "/me/jurisdiction",
  zValidator("json", z.object({ districtId: z.string().min(3).max(8) })),
  async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) return c.json({ error: "Authentication required" }, 401);

    const districtId = c.req.valid("json").districtId.toUpperCase();
    const { districts } = await listDistricts();
    const match = districts.find((d) => d.districtId === districtId);

    // Refused rather than stored. "CA-99" is well-formed and does not exist,
    // and a row pointing at a district nobody represents is a row no aggregate
    // could ever honestly place.
    if (!match) {
      return c.json({ error: "That is not a district in the current Congress." }, 400);
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        stateCode: match.stateCode,
        districtId: match.districtId,
        jurisdictionSetAt: new Date(),
      },
    });

    return c.json({ success: true, district: match });
  },
);

/**
 * DELETE /api/users/me/jurisdiction
 *
 * Take it back.
 *
 * Article IV is a right, not a setting, so withdrawing has to be as easy as
 * giving — one call, no confirmation, no cooling-off. Their votes stay exactly
 * where they are and keep counting nationally; they simply stop being placed on
 * a map.
 */
usersRouter.delete("/me/jurisdiction", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) return c.json({ error: "Authentication required" }, 401);

  await prisma.user.update({
    where: { id: currentUser.id },
    data: { stateCode: null, districtId: null, jurisdictionSetAt: null },
  });

  return c.json({ success: true, districtId: null });
});

export { usersRouter };

/**
 * GET /api/users/:id/friends
 *
 * The people who follow each other.
 *
 * THIS PLATFORM HAS NO FRIEND REQUESTS, and this does not add any. There is one
 * relationship in the schema — a follow — and it is one-directional and needs
 * nobody's permission. Two people who both follow each other are friends in
 * every practical sense and nothing named it, so somebody looking for their
 * friends had two lists to cross-reference by hand.
 *
 * Naming an existing relationship is not the same as building mutual consent.
 * If a friendship should mean something a mutual follow does not — a request to
 * accept, a private tier, a thing only friends can see — that is a feature with
 * a decision in it, and it is written up rather than guessed at.
 */
usersRouter.get("/:id/friends", zValidator("query", paginationQuerySchema), async (c) => {
  const id = c.req.param("id");
  const { limit, offset } = c.req.valid("query");
  const currentUser = c.get("user");

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Everyone they follow who follows them back, minus anyone hidden from the
  // person asking.
  const hidden = await hiddenFrom(currentUser?.id);
  const theyFollow = await prisma.follow.findMany({
    where: { followerId: id },
    select: { followingId: true },
  });
  const candidateIds = theyFollow
    .map((f) => f.followingId)
    .filter((candidate) => !hidden.includes(candidate));

  if (candidateIds.length === 0) {
    return c.json({ results: [], pagination: { total: 0, limit, offset, hasMore: false } });
  }

  const mutual = await prisma.follow.findMany({
    where: { followerId: { in: candidateIds }, followingId: id },
    select: { followerId: true },
  });
  const friendIds = mutual.map((f) => f.followerId);

  const friends = await prisma.user.findMany({
    where: { id: { in: friendIds } },
    take: limit,
    skip: offset,
    orderBy: { name: "asc" },
    include: {
      _count: { select: { followers: true, following: true, votes: true } },
    },
  });

  let followStatuses: Record<string, boolean> = {};
  if (currentUser) {
    const follows = await prisma.follow.findMany({
      where: { followerId: currentUser.id, followingId: { in: friends.map((f) => f.id) } },
    });
    followStatuses = follows.reduce((acc, f) => ({ ...acc, [f.followingId]: true }), {});
  }

  return c.json({
    results: friends.map((f) => formatUser(f, followStatuses[f.id] ?? false)),
    pagination: {
      total: friendIds.length,
      limit,
      offset,
      hasMore: offset + limit < friendIds.length,
    },
  });
});

/**
 * GET /api/users/:id/positions
 *
 * A citizen's record: every position they have taken, newest first, with the
 * version of the law it was taken on.
 *
 * PUBLIC ON PURPOSE. This platform asks people to take public positions on
 * public business. A position you can take back invisibly is not a public
 * position, it is a poll answer — and a Pulse built from poll answers is not
 * the thing the Constitution here says it is. Article IV of the Bill of Rights
 * promises anonymity for personal data, not for what somebody chose to say in
 * public about a law.
 */
usersRouter.get("/:id/positions", async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  if (currentUser && (await blockExistsBetween(currentUser.id, id))) {
    return c.json({ error: "User not found" }, 404);
  }

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const cursor = c.req.query("cursor") || undefined;

  const [history, summary] = await Promise.all([
    // The viewer is passed so a citizen sees their own anonymous positions and
    // nobody else does — Article IV shields them from other people, not from
    // themselves.
    positionHistory(id, limit, cursor, currentUser?.id ?? null),
    positionSummary(id, currentUser?.id ?? null),
  ]);

  return c.json({ ...history, summary });
});

/**
 * GET /api/users/me/positions/review
 *
 * Positions this person took on a version of a law that has since changed.
 *
 * The reason this exists: a tally built from positions taken on text that no
 * longer exists is a number about nothing, and the only person who can fix any
 * given one of them is the person who took it. So they get asked — "you backed
 * this in March, it has been amended since, still with it?" — rather than being
 * left standing behind wording they never read.
 *
 * Nothing is withdrawn automatically. Silence is not a change of mind, and a
 * platform that decides on your behalf what your silence meant has taken the
 * position for you.
 */
usersRouter.get("/me/positions/review", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const results = await positionsNeedingReview(currentUser.id);
  return c.json({ results, count: results.length });
});

/**
 * GET /api/users/me/standing
 *
 * Where you stand relative to everyone else, including — especially — the
 * records where you are most alone.
 *
 * A mirror, not a score. The count of agreements is context; the positions
 * where somebody is in a minority of one are the ones worth knowing you hold.
 */
usersRouter.get("/me/standing", async (c) => {
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  return c.json(await standing(currentUser.id));
});


/**
 * GET /api/users/:id/common-ground
 *
 * What this person and the reader have both taken a position on, split into
 * the ones they agree about and the ones they do not.
 *
 * Both halves, always. A version that returned only the agreements would be a
 * matchmaker for the echo chamber — it would introduce somebody to the parts
 * of a stranger they already like and hide the rest.
 */
usersRouter.get("/:id/common-ground", async (c) => {
  const id = c.req.param("id");
  const currentUser = c.get("user");
  if (!currentUser) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }
  // A block is never revealed as a block, here or anywhere else.
  if (await blockExistsBetween(currentUser.id, id)) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json(await commonGround(currentUser.id, id));
});
