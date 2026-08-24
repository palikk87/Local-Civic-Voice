import { Hono, type Context, type Next } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { verifyPasswordOrDummy } from "../password-check";
import { hashPassword } from "better-auth/crypto";
import { createHash, randomBytes } from "node:crypto";
import { generateAdminToken } from "../session-token";
import { applyWeightedTally } from "../services/delegation-service";
import { checkStorage } from "../services/storage";
import { purgeMediaObjects } from "../services/media-objects";
import { mergeReferences, unmergeReferences } from "../services/deduplication-service";
import { LOOK_ALIKE } from "../services/reference-lineage";
import { formatReferenceDisplayId } from "../services/reference-id";
import { JobPriority, JobType, enqueueLineageSync, jobQueue } from "../services/job-queue";
import { officialSources } from "../services/reference-content";

// ==========================================
// Type Definitions
// ==========================================

interface AdminUser {
  id: string;
  username: string;
  role: "admin" | "moderator" | "superadmin";
  createdAt: string;
  lastLogin?: string;
}

interface AdminSession {
  token: string;
  adminId: string;
  username: string;
  role: "admin" | "moderator" | "superadmin";
  createdAt: string;
  expiresAt: string;
}

interface BannedUser {
  userId: string;
  username: string;
  reason: string;
  bannedAt: string;
  bannedBy: string;
  expiresAt?: string;
}

interface ActivityLog {
  id: string;
  action: string;
  adminId: string;
  adminUsername: string;
  targetType: "user" | "post" | "comment" | "system";
  targetId?: string;
  details: string;
  createdAt: string;
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  isActive: boolean;
}

// ==========================================
// State
// ==========================================
//
// There is none in this module. Everything an admin does is persisted:
// accounts in User (role = admin | moderator | superadmin), sessions in
// AdminSession, bans in User.banned / banReason / banExpiresAt, announcements
// in Announcement, and the audit trail in AdminActivityLog.
//
// All five used to be module-level Maps and arrays. That meant a restart —
// a deploy, a crash, a host moving the container — silently emptied the ban
// list and the audit log while the console went on displaying them as real.
// It also meant the API could never run more than one instance without bans
// appearing and disappearing depending on which copy answered.

/** How long an admin console session stays valid. */
const ADMIN_SESSION_MS = 24 * 60 * 60 * 1000;

// ==========================================
// Helper Functions
// ==========================================

/**
 * Record an admin action in the audit trail.
 *
 * Deliberately fire-and-forget: a failure to write the log must not turn a
 * successful ban into a 500. The error is surfaced in the server log instead,
 * where it is a monitoring problem rather than a user-facing one.
 */
function createActivityLog(
  action: string,
  adminId: string,
  adminUsername: string,
  targetType: "user" | "post" | "comment" | "system",
  targetId: string | undefined,
  details: string
): void {
  void prisma.adminActivityLog
    .create({
      data: { action, adminId, adminUsername, targetType, targetId, details },
    })
    .catch((error) => {
      console.error("[admin] failed to write activity log:", error);
    });
}

/** Announcement row → the JSON shape both admin clients already render. */
function toAnnouncement(row: {
  id: string;
  title: string;
  content: string;
  priority: string;
  createdAt: Date;
  createdBy: string;
  expiresAt: Date | null;
  isActive: boolean;
}): Announcement {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    priority: row.priority as Announcement["priority"],
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    expiresAt: row.expiresAt?.toISOString(),
    isActive: row.isActive,
  };
}

/**
 * Whether a user counts as banned right now.
 *
 * A ban with a past `banExpiresAt` has served its term. Rather than run a
 * sweeper job to clear them, expiry is evaluated on read — one less moving
 * part, and it cannot drift out of sync with the column.
 */
function isCurrentlyBanned(user: { banned: boolean; banExpiresAt: Date | null }): boolean {
  if (!user.banned) return false;
  if (user.banExpiresAt && user.banExpiresAt.getTime() <= Date.now()) return false;
  return true;
}

/** Ban details in the shape the admin clients already render. */
function banInfoFor(user: {
  id: string;
  username: string | null;
  email: string;
  banned: boolean;
  banReason: string | null;
  banExpiresAt: Date | null;
  bannedAt: Date | null;
  bannedBy: string | null;
}): BannedUser | null {
  if (!isCurrentlyBanned(user)) return null;
  return {
    userId: user.id,
    username: user.username || user.email.split("@")[0] || "unknown",
    reason: user.banReason || "",
    bannedAt: (user.bannedAt ?? new Date(0)).toISOString(),
    bannedBy: user.bannedBy || "",
    expiresAt: user.banExpiresAt?.toISOString(),
  };
}

/**
 * Resolve a bearer token to a live admin session.
 *
 * Reads the AdminSession table rather than a memory Map — a backend restart used to
 * wipe every admin session and silently sign the console out.
 */
async function getAdminFromToken(
  authHeader: string | undefined
): Promise<AdminSession | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7);

  const row = await prisma.adminSession.findUnique({ where: { token } });
  if (!row) {
    return null;
  }
  if (row.expiresAt < new Date()) {
    await prisma.adminSession.delete({ where: { token } }).catch(() => {});
    return null;
  }

  return {
    token: row.token,
    adminId: row.adminId,
    username: row.username,
    role: row.role as AdminSession["role"],
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// ==========================================
// Validation Schemas
// ==========================================

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

const userSearchQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
  search: z.string().optional(),
  status: z.enum(["active", "banned", "all"]).optional().default("all"),
  role: z.enum(["user", "admin", "moderator", "all"]).optional().default("all"),
  sortBy: z.enum(["joinedDate", "username", "followers"]).optional().default("joinedDate"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

const postSearchQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
  search: z.string().optional(),
  status: z.enum(["active", "flagged", "deleted", "all"]).optional().default("all"),
  reported: z.string().optional().transform((val) => val === "true"),
  sortBy: z.enum(["createdAt", "likes", "reportCount"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

const idParamSchema = z.object({
  id: z.string().min(1, "ID is required"),
});

const banUserSchema = z.object({
  reason: z.string().min(1, "Ban reason is required"),
  duration: z.number().optional(),
});

const announceSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  content: z.string().min(1, "Content is required").max(2000, "Content too long"),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  expiresAt: z.string().optional(),
});

// B2B client management. `type` and `tier` are validated against the same
// vocabularies routes/b2b.ts reads, so the console cannot write a tier the
// portal will not recognise.
const b2bTypeSchema = z.enum(["lobbyist", "ngo", "corporation", "campaign", "media", "research"]);
const b2bTierSchema = z.enum(["basic", "professional", "enterprise"]);

const createB2BClientSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64, "Username too long")
    // Stored lowercased and matched lowercased; anything that could be confused
    // for another account is rejected rather than silently transformed.
    .regex(/^[A-Za-z0-9_.-]+$/, "Username may contain only letters, digits, and _ . -"),
  name: z.string().min(1, "Display name is required").max(200, "Display name too long"),
  type: b2bTypeSchema,
  tier: b2bTierSchema,
  // Optional. Omit and one is generated, which is the recommended path.
  password: z.string().min(12, "Password must be at least 12 characters").optional(),
});

const updateB2BClientSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: b2bTypeSchema.optional(),
  tier: b2bTierSchema.optional(),
});

const rotateB2BClientSchema = z.object({
  password: z.boolean().optional().default(false),
  apiKey: z.boolean().optional().default(false),
  // Optional explicit password, same rule as create.
  newPassword: z.string().min(12, "Password must be at least 12 characters").optional(),
});

const logsQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 50)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
  action: z.string().optional(),
  adminId: z.string().optional(),
  targetType: z.enum(["user", "post", "comment", "system", "all"]).optional().default("all"),
});

// ==========================================
// Router
// ==========================================

/**
 * `adminSession` is set by the b2b-clients auth middleware below. The rest of
 * this file resolves the session inside each handler, which is fine there; the
 * B2B routes need it earlier, before zValidator runs. See that middleware.
 */
const adminRouter = new Hono<{ Variables: { adminSession: AdminSession } }>();

// ==========================================
// Admin Authentication Endpoints
// ==========================================

/**
 * Admin console login.
 *
 * The admin console is a separate login from the citizen session, but it authenticates
 * against the SAME accounts — the User table in Supabase — using the SAME password hash
 * Better Auth wrote at signup. There is no hardcoded password and no shadow admin list:
 * a person can reach the console if, and only if, their real account password checks out
 * AND their role is admin | moderator | superadmin.
 */
adminRouter.post("/login", zValidator("json", loginSchema), async (c) => {
  const { username, password } = c.req.valid("json");
  const usernameOrEmailLower = username.toLowerCase();

  // Accept username, email, or display name — case-insensitively.
  const dbUser = await prisma.user.findFirst({
    where: {
      OR: [
        { name: usernameOrEmailLower },
        { username: usernameOrEmailLower },
        { email: usernameOrEmailLower },
        { name: username },
        { username: username },
        { email: username },
      ],
      role: { in: ["admin", "moderator", "superadmin"] },
    },
    include: {
      accounts: { where: { providerId: "credential" }, select: { password: true } },
    },
  });

  // Verify against the stored Better Auth hash — same check the citizen sign-in
  // does. NOTE THE ORDER: the verification runs before any of the three reasons
  // to reject are acted on, and it runs even when there is nothing to verify
  // against.
  //
  // This used to return 401 immediately for an unknown username, and again for
  // an admin with no password on file. Both returned in microseconds while a
  // real account cost a full scrypt run, so response time answered "is this an
  // admin account?" for anyone who asked — which is a list of exactly the
  // accounts worth attacking. See src/password-check.ts.
  const hash = dbUser?.accounts.find((a) => a.password)?.password;
  const passwordOk = await verifyPasswordOrDummy(hash, password, "Admin");

  if (dbUser && !hash) {
    // Worth an operator log: a privileged account that cannot be signed into is
    // a misconfiguration, not an attack.
    console.error(`[Admin] ${dbUser.email} has role ${dbUser.role} but no password on file`);
  }

  if (!dbUser || !hash || !passwordOk) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = generateAdminToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MS);
  const displayName = dbUser.username || dbUser.name || dbUser.email;
  const role = dbUser.role as "admin" | "moderator" | "superadmin";

  await prisma.adminSession.create({
    data: { token, adminId: dbUser.id, username: displayName, role, createdAt: now, expiresAt },
  });

  // Opportunistic cleanup so expired rows don't pile up.
  await prisma.adminSession
    .deleteMany({ where: { expiresAt: { lt: now } } })
    .catch(() => {});

  createActivityLog("login", dbUser.id, displayName, "system", undefined, "Admin logged in");

  return c.json({
    success: true,
    token,
    admin: {
      id: dbUser.id,
      username: displayName,
      role,
    },
    expiresAt: expiresAt.toISOString(),
  });
});

adminRouter.get("/verify", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);

  if (!session) {
    return c.json({ valid: false, error: "Invalid or expired token" }, { status: 401 });
  }

  return c.json({
    valid: true,
    admin: {
      id: session.adminId,
      username: session.username,
      role: session.role,
    },
    expiresAt: session.expiresAt,
  });
});

adminRouter.post("/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (session) {
    createActivityLog("logout", session.adminId, session.username, "system", undefined, "Admin logged out");
    await prisma.adminSession.delete({ where: { token: session.token } }).catch(() => {});
  }
  return c.json({ success: true, message: "Logged out successfully" });
});

// ==========================================
// User Management Endpoints (Real Database)
// ==========================================

adminRouter.get("/users", zValidator("query", userSearchQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { limit, offset, search, status, sortBy, sortOrder } = c.req.valid("query");

  try {
    // The live user store is the Prisma User table (Better Auth) — the same
    // accounts both faucets sign in with.
    // Ban state is filtered in SQL, not after the fact.
    //
    // It used to be applied to the already-paginated page, which meant asking
    // for banned users returned whichever of *that page's* twenty rows happened
    // to be banned — an empty first page while banned accounts sat on page
    // three — and the reported total counted every user regardless of filter.
    const now = new Date();
    const activeBan = {
      banned: true,
      OR: [{ banExpiresAt: null }, { banExpiresAt: { gt: now } }],
    };
    const noActiveBan = {
      OR: [{ banned: false }, { banExpiresAt: { lte: now } }],
    };

    const conditions: object[] = [];
    if (search) {
      conditions.push({
        OR: [
          { username: { contains: search } },
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      });
    }
    if (status === "banned") conditions.push(activeBan);
    else if (status === "active") conditions.push(noActiveBan);

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const orderBy =
      sortBy === "username"
        ? { username: (sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc" }
        : { createdAt: (sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc" };

    const [users, count] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy,
        skip: offset,
        take: limit,
        include: {
          _count: { select: { posts: true, votes: true, followers: true, following: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Map to response format
    const mappedUsers = users.map((u) => ({
      id: u.id,
      username: u.username || u.email.split("@")[0] || "unknown",
      displayName: u.name || u.username || u.email.split("@")[0],
      email: u.email,
      avatar: u.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.id}`,
      bio: u.bio || "",
      location: u.location || "",
      joinedDate: u.createdAt.toISOString().split("T")[0],
      followers: u._count.followers,
      following: u._count.following,
      votesCount: u._count.votes,
      postsCount: u._count.posts,
      role: u.role || "user",
      status: isCurrentlyBanned(u) ? "banned" : "active",
      isBanned: isCurrentlyBanned(u),
      banInfo: banInfoFor(u),
    }));

    return c.json({
      results: mappedUsers,
      pagination: {
        total: count,
        limit,
        offset,
        hasMore: offset + limit < count,
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return c.json({ error: "Failed to fetch users" }, { status: 500 });
  }
});

adminRouter.get("/users/:id", zValidator("param", idParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { id } = c.req.valid("param");

  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        _count: {
          select: { posts: true, votes: true, followers: true, following: true, comments: true },
        },
      },
    });

    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    return c.json({
      id: user.id,
      username: user.username || user.email.split("@")[0] || "unknown",
      displayName: user.name || user.username || user.email.split("@")[0],
      email: user.email,
      avatar: user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`,
      bio: user.bio || "",
      location: user.location || "",
      joinedDate: user.createdAt.toISOString().split("T")[0],
      followers: user._count.followers,
      following: user._count.following,
      votesCount: user._count.votes,
      role: user.role || "user",
      status: isCurrentlyBanned(user) ? "banned" : "active",
      isBanned: isCurrentlyBanned(user),
      banInfo: banInfoFor(user),
      stats: {
        postsCount: user._count.posts,
        commentsCount: user._count.comments,
      },
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return c.json({ error: "Failed to fetch user" }, { status: 500 });
  }
});

adminRouter.delete("/users/:id", zValidator("param", idParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  if (session.role !== "superadmin") {
    return c.json({ error: "Only superadmin can delete users" }, { status: 403 });
  }

  const { id } = c.req.valid("param");

  try {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    // Everything this user ever uploaded, not just what they posted.
    //
    // Media.userId is a bare column with NO relation and NO cascade — the only
    // FK on Media is postId. So deleting a user cascades User -> Post -> Media
    // for attached media and leaves the objects behind, while media that was
    // uploaded and never posted is not reached at all: those rows survive the
    // user entirely, pointing at objects that also survive. Someone who deletes
    // their account was keeping every photo they ever uploaded, still publicly
    // fetchable.
    //
    // Querying by userId catches both, which is why this is a findMany rather
    // than a walk of the user's posts.
    const media = await prisma.media.findMany({
      where: { userId: id },
      select: { id: true, url: true, thumbnailUrl: true },
    });

    const purge = await purgeMediaObjects(media, `user ${id}`);
    if (!purge.ok) {
      return c.json({ error: purge.message }, { status: 500 });
    }

    // Ban state lives on the row, so deleting the user takes it with them.
    await prisma.user.delete({ where: { id } });

    // The cascade removed the media rows attached to posts. The unattached ones
    // have no relation to User, so nothing removed them — they would be left
    // pointing at objects this request just deleted.
    if (media.length > 0) {
      await prisma.media.deleteMany({ where: { userId: id } });
    }

    createActivityLog(
      "delete_user",
      session.adminId,
      session.username,
      "user",
      id,
      `Deleted user ${user.name || user.username || user.email}`
    );

    return c.json({
      success: true,
      message: `User ${user.name || user.username || user.email} has been deleted`,
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return c.json({ error: "Failed to delete user" }, { status: 500 });
  }
});

adminRouter.post(
  "/users/:id/ban",
  zValidator("param", idParamSchema),
  zValidator("json", banUserSchema),
  async (c) => {
    const authHeader = c.req.header("Authorization");
    const session = await getAdminFromToken(authHeader);
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }

    const { id } = c.req.valid("param");
    const { reason, duration } = c.req.valid("json");

    try {
      const user = await prisma.user.findUnique({ where: { id } });

      if (!user) {
        return c.json({ error: "User not found" }, { status: 404 });
      }

      if (isCurrentlyBanned(user)) {
        return c.json({ error: "User is already banned" }, { status: 400 });
      }

      const now = new Date();
      const expiresAt = duration
        ? new Date(now.getTime() + duration * 24 * 60 * 60 * 1000)
        : null;

      const banned = await prisma.user.update({
        where: { id },
        data: {
          banned: true,
          banReason: reason,
          banExpiresAt: expiresAt,
          bannedAt: now,
          bannedBy: session.username,
        },
      });

      const banInfo = banInfoFor(banned);

      createActivityLog(
        "ban_user",
        session.adminId,
        session.username,
        "user",
        id,
        `Banned user ${user.name || user.username || user.email}. Reason: ${reason}. Duration: ${duration ? `${duration} days` : "permanent"}`
      );

      return c.json({
        success: true,
        message: `User ${user.name || user.username || user.email} has been banned`,
        banInfo,
      });
    } catch (error) {
      console.error("Error banning user:", error);
      return c.json({ error: "Failed to ban user" }, { status: 500 });
    }
  }
);

adminRouter.delete("/users/:id/ban", zValidator("param", idParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { id } = c.req.valid("param");

  try {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    if (!isCurrentlyBanned(user)) {
      return c.json({ error: "User is not banned" }, { status: 400 });
    }

    // Clear the whole ban, not just the flag — leaving a stale reason and
    // banned-by behind makes a later ban look like it has history it does not.
    await prisma.user.update({
      where: { id },
      data: {
        banned: false,
        banReason: null,
        banExpiresAt: null,
        bannedAt: null,
        bannedBy: null,
      },
    });

    createActivityLog(
      "unban_user",
      session.adminId,
      session.username,
      "user",
      id,
      `Unbanned user ${user.name || user.username || user.email}`
    );

    return c.json({
      success: true,
      message: `User ${user.name || user.username || user.email} has been unbanned`,
    });
  } catch (error) {
    console.error("Error unbanning user:", error);
    return c.json({ error: "Failed to unban user" }, { status: 500 });
  }
});

// ==========================================
// Content Moderation Endpoints (Real Database)
// ==========================================

adminRouter.get("/posts", zValidator("query", postSearchQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { limit, offset, search, sortBy, sortOrder } = c.req.valid("query");

  try {
    const whereClause: Record<string, unknown> = {};
    if (search) {
      whereClause.OR = [
        { content: { contains: search } },
        { author: { name: { contains: search } } },
      ];
    }

    const posts = await prisma.post.findMany({
      where: whereClause,
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
          },
        },
        _count: {
          select: {
            likes: true,
            comments: true,
          },
        },
      },
      orderBy: sortBy === "createdAt"
        ? { createdAt: sortOrder }
        : sortBy === "likes"
        ? { likes: { _count: sortOrder } }
        : { createdAt: sortOrder },
      take: limit,
      skip: offset,
    });

    const total = await prisma.post.count({ where: whereClause });

    const mappedPosts = posts.map((p) => ({
      id: p.id,
      content: p.content,
      authorId: p.authorId,
      author: {
        id: p.author.id,
        displayName: p.author.name,
        username: p.author.email.split("@")[0] || p.author.name,
        avatar: p.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${p.author.id}`,
      },
      legislationRef: p.bill ? {
        id: p.bill.id,
        title: p.bill.title,
        type: "bill",
      } : undefined,
      createdAt: p.createdAt.toISOString(),
      likes: p._count.likes,
      commentsCount: p._count.comments,
      status: "active",
      reportCount: 0,
      flags: [],
    }));

    return c.json({
      results: mappedPosts,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return c.json({ error: "Failed to fetch posts" }, { status: 500 });
  }
});

adminRouter.delete("/posts/:id", zValidator("param", idParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { id } = c.req.valid("param");

  try {
    const post = await prisma.post.findUnique({
      where: { id },
      include: { author: true, media: true },
    });

    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
    }

    // Same policy the author's own delete uses. Two different behaviours for
    // one operation, depending on who pressed the button, is worse than either.
    const purge = await purgeMediaObjects(post.media, `post ${id}`);
    if (!purge.ok) {
      return c.json({ error: purge.message }, { status: 500 });
    }

    await prisma.post.delete({ where: { id } });

    createActivityLog(
      "delete_post",
      session.adminId,
      session.username,
      "post",
      id,
      `Deleted post by ${post.author.name}`
    );

    return c.json({
      success: true,
      message: "Post has been deleted",
    });
  } catch (error) {
    console.error("Error deleting post:", error);
    return c.json({ error: "Failed to delete post" }, { status: 500 });
  }
});

// ==========================================
// Analytics Endpoints (Real Database)
// ==========================================

/**
 * Storage health — whether accounts are safe.
 *
 * Accounts live in Supabase Postgres, external to this container, so durability is
 * a property of the connection rather than of a backup job. This reports the live
 * connection and account counts so the state is visible in the portal instead of
 * only in server logs. The off-container account vault it used to report on is gone,
 * along with the SQLite file it protected.
 */
// ==========================================
// B2B portal client management
// ==========================================
//
// These accounts read every citizen's aggregated sentiment, and the enterprise
// tier reads all of it. Creating one is therefore closer to granting an admin
// role than to adding a record, which is why every mutation here is superadmin
// only while listing is open to any admin — an admin who can see that a client
// exists cannot mint one.
//
// SECRETS ARE RETURNED EXACTLY ONCE. The password is stored as a scrypt hash
// and the API key as a SHA-256 digest, neither of which can be reversed, so
// there is no "show me the key again" and there deliberately never will be.
// Losing one means rotating it.

/** SHA-256 hex digest. Must match hashApiKey() in routes/b2b.ts and scripts/seed-b2b.ts. */
function hashB2BApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** 48 bytes of CSPRNG, base64url. The same strength `openssl rand -base64 48` gives. */
function generateB2BApiKey(): string {
  return randomBytes(48).toString("base64url");
}

/** A generated password, for when the admin does not supply one. */
function generateB2BPassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Public projection of a stored client. Never includes either hash. */
function toAdminB2BClient(row: {
  id: string;
  username: string;
  name: string;
  type: string;
  tier: string;
  lastAccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    type: row.type,
    tier: row.tier,
    lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const B2B_CLIENT_SELECT = {
  id: true,
  username: true,
  name: true,
  type: true,
  tier: true,
  lastAccessAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Authenticate before validating.
 *
 * These handlers used to call getAdminFromToken() themselves, like the rest of
 * this file. That works, but zValidator is registered as middleware and
 * therefore runs FIRST — so an unauthenticated request with a malformed body
 * got a 400 describing the schema instead of a 401. That lets anyone map the
 * shape of a privileged endpoint by trial and error, and it reports a
 * validation problem to a caller who was never entitled to reach the validator.
 *
 * Order matters more than consistency here: identity first, then input.
 */
adminRouter.use("/b2b-clients", b2bClientAuth);
adminRouter.use("/b2b-clients/*", b2bClientAuth);

async function b2bClientAuth(c: Context<{ Variables: { adminSession: AdminSession } }>, next: Next) {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  // Everything except listing is superadmin-only. A read-only admin can see
  // that a client exists; only a superadmin can mint, alter or revoke one.
  if (c.req.method !== "GET" && session.role !== "superadmin") {
    return c.json({ error: "Only superadmin can manage B2B clients" }, { status: 403 });
  }

  c.set("adminSession", session);
  await next();
}

adminRouter.get("/b2b-clients", async (c) => {
  const clients = await prisma.b2BClient.findMany({
    select: B2B_CLIENT_SELECT,
    orderBy: { createdAt: "asc" },
  });

  // Live session counts, so the console can show who is actually signed in
  // rather than only who has an account.
  const now = new Date();
  const sessions = await prisma.b2BSession.groupBy({
    by: ["clientId"],
    where: { expiresAt: { gt: now } },
    _count: { _all: true },
  });
  const activeByClient = new Map(sessions.map((s) => [s.clientId, s._count._all]));

  return c.json({
    clients: clients.map((row) => ({
      ...toAdminB2BClient(row),
      activeSessions: activeByClient.get(row.id) ?? 0,
    })),
  });
});

adminRouter.post("/b2b-clients", zValidator("json", createB2BClientSchema), async (c) => {
  const session = c.get("adminSession");
  const body = c.req.valid("json");
  const username = body.username.toLowerCase();

  const existing = await prisma.b2BClient.findUnique({ where: { username } });
  if (existing) {
    return c.json({ error: "A B2B client with that username already exists" }, { status: 409 });
  }

  const password = body.password ?? generateB2BPassword();
  const apiKey = generateB2BApiKey();

  const created = await prisma.b2BClient.create({
    data: {
      username,
      name: body.name,
      type: body.type,
      tier: body.tier,
      passwordHash: await hashPassword(password),
      apiKeyHash: hashB2BApiKey(apiKey),
    },
    select: B2B_CLIENT_SELECT,
  });

  createActivityLog(
    "create_b2b_client",
    session.adminId,
    session.username,
    "system",
    created.id,
    `Created B2B client ${created.username} (${created.tier})`
  );

  return c.json(
    {
      success: true,
      client: toAdminB2BClient(created),
      // Shown once. Neither value can be recovered from what is stored.
      credentials: { username: created.username, password, apiKey },
      warning: "Copy these now. They cannot be shown again — only rotated.",
    },
    { status: 201 }
  );
});

adminRouter.patch(
  "/b2b-clients/:id",
  zValidator("param", idParamSchema),
  zValidator("json", updateB2BClientSchema),
  async (c) => {
    const session = c.get("adminSession");

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (Object.keys(body).length === 0) {
      return c.json({ error: "Nothing to update" }, { status: 400 });
    }

    const existing = await prisma.b2BClient.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: "B2B client not found" }, { status: 404 });
    }

    const updated = await prisma.b2BClient.update({
      where: { id },
      data: body,
      select: B2B_CLIENT_SELECT,
    });

    // A tier change takes effect on the NEXT request for existing sessions,
    // because tier is copied onto the session row at login. Rewrite the live
    // sessions too, or a downgrade would not apply until the client signs out.
    if (body.tier && body.tier !== existing.tier) {
      await prisma.b2BSession.updateMany({ where: { clientId: id }, data: { tier: body.tier } });
    }
    if (body.name && body.name !== existing.name) {
      await prisma.b2BSession.updateMany({ where: { clientId: id }, data: { clientName: body.name } });
    }

    createActivityLog(
      "update_b2b_client",
      session.adminId,
      session.username,
      "system",
      id,
      `Updated B2B client ${updated.username}`
    );

    return c.json({ success: true, client: toAdminB2BClient(updated) });
  }
);

adminRouter.post(
  "/b2b-clients/:id/rotate",
  zValidator("param", idParamSchema),
  zValidator("json", rotateB2BClientSchema),
  async (c) => {
    const session = c.get("adminSession");

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (!body.password && !body.apiKey) {
      return c.json({ error: "Specify password, apiKey, or both" }, { status: 400 });
    }

    const existing = await prisma.b2BClient.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ error: "B2B client not found" }, { status: 404 });
    }

    const data: { passwordHash?: string; apiKeyHash?: string } = {};
    const credentials: { password?: string; apiKey?: string } = {};

    if (body.password) {
      const password = body.newPassword ?? generateB2BPassword();
      data.passwordHash = await hashPassword(password);
      credentials.password = password;
    }
    if (body.apiKey) {
      const apiKey = generateB2BApiKey();
      data.apiKeyHash = hashB2BApiKey(apiKey);
      credentials.apiKey = apiKey;
    }

    const updated = await prisma.b2BClient.update({
      where: { id },
      data,
      select: B2B_CLIENT_SELECT,
    });

    // Rotating a password revokes the sessions it opened. Leaving them alive
    // would mean a rotation prompted by a leak changed nothing for as long as
    // the stolen session lasted, which is the whole reason to rotate.
    let revoked = 0;
    if (body.password) {
      revoked = (await prisma.b2BSession.deleteMany({ where: { clientId: id } })).count;
    }

    createActivityLog(
      "rotate_b2b_client",
      session.adminId,
      session.username,
      "system",
      id,
      `Rotated ${[body.password && "password", body.apiKey && "API key"].filter(Boolean).join(" and ")} ` +
        `for B2B client ${updated.username}`
    );

    return c.json({
      success: true,
      client: toAdminB2BClient(updated),
      credentials: { username: updated.username, ...credentials },
      revokedSessions: revoked,
      warning: "Copy these now. They cannot be shown again — only rotated.",
    });
  }
);

adminRouter.delete("/b2b-clients/:id", zValidator("param", idParamSchema), async (c) => {
  const session = c.get("adminSession");
  const { id } = c.req.valid("param");

  const existing = await prisma.b2BClient.findUnique({ where: { id } });
  if (!existing) {
    return c.json({ error: "B2B client not found" }, { status: 404 });
  }

  // B2BSession.clientId is a bare column with no foreign key, so nothing
  // cascades. Delete the sessions explicitly or the account would be gone while
  // its live tokens kept working until they expired — a deleted client that can
  // still read every citizen's sentiment for another 24 hours.
  const revoked = (await prisma.b2BSession.deleteMany({ where: { clientId: id } })).count;
  await prisma.b2BClient.delete({ where: { id } });

  createActivityLog(
    "delete_b2b_client",
    session.adminId,
    session.username,
    "system",
    id,
    `Deleted B2B client ${existing.username} and revoked ${revoked} session(s)`
  );

  return c.json({ success: true, revokedSessions: revoked });
});

/**
 * POST /api/admin/reextract-content
 *
 * Re-pull official text for every live record, after a retrieval fix.
 *
 * WHY THIS IS NOT JUST `force`. When a retrieval bug is repaired, the text that
 * comes back differs from what is stored for every affected record — and by
 * every ordinary measure that reads as the law changing. It is not. The Federal
 * Register did not reissue an order because we stopped storing the page header
 * above it, and Congress did not re-pass a bill because we stopped serving the
 * introduced draft of it.
 *
 * A plain force would increment lawVersion on all of them, badge every post
 * that shared one as "updated since this was posted", and notify everyone who
 * shared it. That is a false statement about the government, delivered to every
 * user at once, caused by us fixing our own defect.
 *
 * So this replaces the text, leaves the version alone, and invalidates the
 * stored brief — which does have to be rewritten, because a brief written from
 * the old extraction described a page header rather than a law.
 *
 * Superadmin only, and it costs real requests to three government APIs. The
 * work is queued rather than done in the request: CourtListener allows five
 * calls a minute, so the judicial branch alone can take longer than any
 * reasonable HTTP timeout.
 */
adminRouter.post("/reextract-content", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  if (session.role !== "superadmin") {
    return c.json({ error: "Superadmin required." }, { status: 403 });
  }

  const referenceType = c.req.query("referenceType");

  const records = await prisma.governmentReference.findMany({
    where: {
      mergedIntoId: null,
      ...(referenceType ? { referenceType } : {}),
    },
    select: { id: true, masterReferenceId: true },
    orderBy: { createdAt: "asc" },
  });

  for (const record of records) {
    jobQueue.enqueue(
      JobType.REEXTRACT_REFERENCE_TEXT,
      { referenceId: record.id },
      JobPriority.LOW
    );
  }

  createActivityLog(
    "reextract_content",
    session.adminId,
    session.username,
    "system",
    referenceType ?? "all",
    `Queued re-extraction of official text for ${records.length} record(s)`
  );

  return c.json({
    queued: records.length,
    referenceType: referenceType ?? "all",
    message:
      "Official text will be re-pulled and briefs rewritten. No law is marked as changed, " +
      "so nobody is notified and no post is badged.",
  });
});

/**
 * GET /api/admin/content-health
 *
 * Is every branch of government actually pulling full text, and is a brief
 * getting written from it?
 *
 * THE QUESTION THIS ANSWERS, which took far too long to answer once. Briefs
 * stopped working across bills, executive orders and Supreme Court cases at the
 * same time, every source key was valid, and from the outside all three looked
 * identical: "the official text isn't published anywhere we can read yet." Four
 * different failures wear that one sentence — no key, a rejected key, a
 * throttled key, and a text the fetch stored as markup — and none of them is
 * about the law.
 *
 * So this reports what the real fetch actually did, from what it actually
 * stored. It runs no requests of its own and walks no parallel copy of the
 * source chains: a second implementation of three branch-specific fetchers
 * would drift from them within a week and then confidently report on code
 * nobody runs. Every number here is the pipeline's own output.
 *
 * Per branch: how many records exist, how many hold text, how much text, which
 * source it came from, and how many carry a brief written for the version of
 * the law they are on now.
 */
adminRouter.get("/content-health", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  try {
    // One pass, in the database. LENGTH() rather than the column: a branch with
    // a few hundred opinions in it is hundreds of megabytes of text, and none of
    // it needs to cross the wire to be counted.
    const rows = await prisma.$queryRaw<
      Array<{
        referenceType: string;
        records: bigint;
        withText: bigint;
        medianChars: number | null;
        briefsCurrent: bigint;
      }>
    >`
      SELECT
        "referenceType",
        COUNT(*)                                                        AS "records",
        COUNT(*) FILTER (WHERE COALESCE(LENGTH("fullText"), 0) > 200)   AS "withText",
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY COALESCE(LENGTH("fullText"), 0)
        ) FILTER (WHERE COALESCE(LENGTH("fullText"), 0) > 200)          AS "medianChars",
        COUNT(*) FILTER (
          WHERE "citizenBriefJson" IS NOT NULL
            AND "citizenBriefVersion" = "lawVersion"
        )                                                               AS "briefsCurrent"
      FROM "GovernmentReference"
      WHERE "mergedIntoId" IS NULL
      GROUP BY "referenceType"
      ORDER BY "referenceType"
    `;

    // Which source answered. A branch whose text all arrives from a fallback is
    // working in the sense that something came back, and not in any other sense.
    const sources = await prisma.$queryRaw<
      Array<{ referenceType: string; fullTextSource: string | null; count: bigint }>
    >`
      SELECT "referenceType", "fullTextSource", COUNT(*) AS "count"
      FROM "GovernmentReference"
      WHERE "mergedIntoId" IS NULL AND COALESCE(LENGTH("fullText"), 0) > 200
      GROUP BY "referenceType", "fullTextSource"
      ORDER BY "referenceType", COUNT(*) DESC
    `;

    const branches = rows.map((row) => {
      const records = Number(row.records);
      const withText = Number(row.withText);
      return {
        referenceType: row.referenceType,
        records,
        withText,
        withoutText: records - withText,
        medianTextChars: row.medianChars === null ? null : Math.round(row.medianChars),
        briefsCurrent: Number(row.briefsCurrent),
        sources: sources
          .filter((s) => s.referenceType === row.referenceType)
          .map((s) => ({ source: s.fullTextSource ?? "unrecorded", count: Number(s.count) })),
      };
    });

    return c.json({
      data: {
        branches,
        // What the server is configured to be able to do at all. A branch with
        // no text and no key is a settings problem; a branch with a key and no
        // text is a real one, and they are not told apart by staring at counts.
        configured: officialSources(),
      },
    });
  } catch (error) {
    console.error("Error building content health:", error);
    return c.json({ error: "Failed to build content health" }, { status: 500 });
  }
});

adminRouter.get("/storage-health", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  try {
    const databaseUrl = process.env.DATABASE_URL ?? "";
    const durable = databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

    // Report the host, don't name a vendor. Nothing in this codebase should
    // encode whose account it runs in — the same build has to be correct
    // whether this Postgres is Supabase, Neon, RDS, or a box in a closet.
    let databaseHost = "unknown";
    try {
      databaseHost = new URL(databaseUrl).hostname;
    } catch {
      // Unparseable URL: `durable` is already false, and the warning covers it.
    }

    // A real account is one someone can sign in with — it has a credential row.
    const [totalUsers, realAccounts, storage] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { accounts: { some: { providerId: "credential" } } } }),
      checkStorage(),
    ]);

    return c.json({
      data: {
        databaseDurable: durable,
        databaseKind: durable ? "postgres" : "not-postgres",
        databaseHost,
        totalUsers,
        realAccounts,
        accountsProtected: durable,
        // Media is the half of durability the database cannot cover: bytes
        // written to a container's filesystem are gone on the next deploy, and
        // nothing surfaces that until a user's photo 404s.
        mediaStorageDriver: storage.driver,
        mediaStorageOk: storage.ok,
        mediaStorageDetail: storage.detail,
        warning: durable
          ? null
          : "DATABASE_URL is not a Postgres connection. Accounts are on disposable container storage and can be lost on restart.",
      },
    });
  } catch (error) {
    console.error("Error fetching storage health:", error);
    return c.json({ error: "Failed to fetch storage health" }, { status: 500 });
  }
});

adminRouter.get("/stats", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  try {
    // Live counts from the shared Prisma database
    const [userCount, postCount, commentCount, voteCount] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.vote.count(),
    ]);

    // Get users active today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [postsToday, votesToday] = await Promise.all([
      prisma.post.findMany({
        where: { createdAt: { gte: today } },
        select: { authorId: true },
      }),
      prisma.vote.findMany({
        where: { createdAt: { gte: today } },
        select: { userId: true },
      }),
    ]);

    const activeUserIds = new Set([
      ...postsToday.map((p) => p.authorId),
      ...votesToday.map((v) => v.userId),
    ]);

    // Every count below comes from the database. None of it is held in memory,
    // so these numbers are the same on any instance and survive a restart.
    const [bannedUsersCount, adminAccountCount, activeAdminSessions] = await Promise.all([
      prisma.user.count({
        where: {
          banned: true,
          OR: [{ banExpiresAt: null }, { banExpiresAt: { gt: new Date() } }],
        },
      }),
      prisma.user.count({ where: { role: { in: ["admin", "moderator", "superadmin"] } } }),
      prisma.adminSession.count({ where: { expiresAt: { gt: new Date() } } }),
    ]);

    return c.json({
      overview: {
        totalUsers: userCount,
        totalPosts: postCount,
        totalComments: commentCount,
        totalVotes: voteCount,
        dailyActiveUsers: activeUserIds.size,
        engagementRate: userCount > 0 ? (((postCount + commentCount + voteCount) / userCount) * 100).toFixed(2) : "0",
      },
      moderation: {
        bannedUsers: bannedUsersCount,
        flaggedContent: 0,
        reportedPosts: 0,
        reportedComments: 0,
      },
      admins: {
        totalAdmins: adminAccountCount,
        activeSessions: activeAdminSessions,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    return c.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
});

adminRouter.get("/stats/engagement", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  try {
    const dataPoints: Array<{
      date: string;
      posts: number;
      comments: number;
      likes: number;
      votes: number;
    }> = [];

    const now = new Date();
    const days = 7;

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const [posts, comments, likes, votes] = await Promise.all([
        prisma.post.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
        prisma.comment.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
        prisma.postLike.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
        prisma.vote.count({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
        }),
      ]);

      dataPoints.push({
        date: date.toISOString().split("T")[0] || "",
        posts,
        comments,
        likes,
        votes,
      });
    }

    return c.json({
      period: "week",
      data: dataPoints,
      totals: {
        posts: dataPoints.reduce((sum, d) => sum + d.posts, 0),
        comments: dataPoints.reduce((sum, d) => sum + d.comments, 0),
        likes: dataPoints.reduce((sum, d) => sum + d.likes, 0),
        votes: dataPoints.reduce((sum, d) => sum + d.votes, 0),
      },
    });
  } catch (error) {
    console.error("Error fetching engagement stats:", error);
    return c.json({ error: "Failed to fetch engagement stats" }, { status: 500 });
  }
});

adminRouter.get("/stats/growth", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  try {
    const dataPoints: Array<{
      date: string;
      newUsers: number;
      totalUsers: number;
      activeUsers: number;
    }> = [];

    const now = new Date();
    const days = 7;

    // Get cumulative user count up to each day
    let cumulativeUsers = await prisma.user.count({
      where: {
        createdAt: { lt: new Date(now.getTime() - days * 24 * 60 * 60 * 1000) },
      },
    });

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const newUsers = await prisma.user.count({
        where: { createdAt: { gte: startOfDay, lte: endOfDay } },
      });

      cumulativeUsers += newUsers;

      // Active users = users with activity on that day
      const [usersWithPosts, usersWithVotes] = await Promise.all([
        prisma.post.findMany({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { authorId: true },
          distinct: ["authorId"],
        }),
        prisma.vote.findMany({
          where: { createdAt: { gte: startOfDay, lte: endOfDay } },
          select: { userId: true },
          distinct: ["userId"],
        }),
      ]);

      const activeUserIds = new Set([
        ...usersWithPosts.map((p) => p.authorId),
        ...usersWithVotes.map((v) => v.userId),
      ]);

      dataPoints.push({
        date: date.toISOString().split("T")[0] || "",
        newUsers,
        totalUsers: cumulativeUsers,
        activeUsers: activeUserIds.size,
      });
    }

    const firstDataPoint = dataPoints[0];
    const lastDataPoint = dataPoints[dataPoints.length - 1];
    let growthRate = "0";
    if (dataPoints.length > 1 && firstDataPoint && lastDataPoint && firstDataPoint.totalUsers > 0) {
      growthRate = (
        ((lastDataPoint.totalUsers - firstDataPoint.totalUsers) / firstDataPoint.totalUsers) * 100
      ).toFixed(2);
    }

    return c.json({
      period: "week",
      data: dataPoints,
      summary: {
        totalNewUsers: dataPoints.reduce((sum, d) => sum + d.newUsers, 0),
        averageActiveUsers: Math.floor(
          dataPoints.reduce((sum, d) => sum + d.activeUsers, 0) / dataPoints.length
        ),
        growthRate,
      },
    });
  } catch (error) {
    console.error("Error fetching growth stats:", error);
    return c.json({ error: "Failed to fetch growth stats" }, { status: 500 });
  }
});

// ==========================================
// System Endpoints
// ==========================================

adminRouter.get("/logs", zValidator("query", logsQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { limit, offset, action, adminId, targetType } = c.req.valid("query");

  const where = {
    ...(action ? { action } : {}),
    ...(adminId ? { adminId } : {}),
    ...(targetType !== "all" ? { targetType } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.adminActivityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.adminActivityLog.count({ where }),
  ]);

  // The clients render createdAt as a string, and did so when this was an
  // in-memory array of ISO strings. Prisma returns Date objects.
  const paginatedLogs: ActivityLog[] = rows.map((l) => ({
    id: l.id,
    action: l.action,
    adminId: l.adminId,
    adminUsername: l.adminUsername,
    targetType: l.targetType as ActivityLog["targetType"],
    targetId: l.targetId ?? undefined,
    details: l.details,
    createdAt: l.createdAt.toISOString(),
  }));

  return c.json({
    results: paginatedLogs,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

adminRouter.post("/announce", zValidator("json", announceSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  if (session.role === "moderator") {
    return c.json({ error: "Moderators cannot create announcements" }, { status: 403 });
  }

  const { title, content, priority, expiresAt } = c.req.valid("json");

  const row = await prisma.announcement.create({
    data: {
      title,
      content,
      priority,
      createdBy: session.username,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      isActive: true,
    },
  });

  const announcement = toAnnouncement(row);

  createActivityLog(
    "create_announcement",
    session.adminId,
    session.username,
    "system",
    announcement.id,
    `Created announcement: ${title}`
  );

  return c.json({
    success: true,
    message: "Announcement created successfully",
    announcement,
  }, { status: 201 });
});

adminRouter.get("/announcements", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");

  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.announcement.count(),
  ]);

  const paginatedAnnouncements = rows.map(toAnnouncement);

  return c.json({
    results: paginatedAnnouncements,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
});

// ==========================================
// Merge review queue
// ==========================================

/**
 * Two records that might be one law, waiting for somebody to say yes or no.
 *
 * Congress.gov publishes bill relationships and who assigned them. "Identical
 * bill" — a Library of Congress analyst confirming two texts match — is the only
 * label the system acts on by itself; the merge has already happened by the time
 * it appears here, marked approved with the analyst named. Everything else is a
 * question, and this is where it gets answered.
 *
 * Approving is destructive: it rewrites which record every affected post and
 * vote belongs to. Same bar as merging by hand — superadmin only. Reading the
 * queue is open to any admin.
 */
adminRouter.use("/reference-merges", mergeQueueAuth);
adminRouter.use("/reference-merges/*", mergeQueueAuth);

async function mergeQueueAuth(c: Context<{ Variables: { adminSession: AdminSession } }>, next: Next) {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  if (c.req.method !== "GET" && session.role !== "superadmin") {
    return c.json({ error: "Only superadmin can decide a merge" }, { status: 403 });
  }
  c.set("adminSession", session);
  await next();
}

const MERGE_SIDE_SELECT = {
  id: true,
  masterReferenceId: true,
  referenceType: true,
  title: true,
  status: true,
  congress: true,
  sourceUrl: true,
  supportVotes: true,
  opposeVotes: true,
  citizenBrief: true,
  createdAt: true,
  _count: { select: { posts: true, votes: true } },
} as const;

function toMergeSide(row: {
  id: string;
  masterReferenceId: string;
  referenceType: string;
  title: string;
  status: string;
  congress: number | null;
  sourceUrl: string | null;
  supportVotes: number;
  opposeVotes: number;
  citizenBrief: string | null;
  createdAt: Date;
  _count: { posts: number; votes: number };
}) {
  return {
    id: row.id,
    masterReferenceId: row.masterReferenceId,
    displayId: formatReferenceDisplayId(row.masterReferenceId, row.referenceType),
    referenceType: row.referenceType,
    title: row.title,
    status: row.status,
    congress: row.congress,
    sourceUrl: row.sourceUrl,
    // What a reviewer needs to judge the cost of getting this wrong.
    votes: { support: row.supportVotes, oppose: row.opposeVotes },
    posts: row._count.posts,
    realVotes: row._count.votes,
    hasBrief: Boolean(row.citizenBrief),
    createdAt: row.createdAt.toISOString(),
  };
}

const mergeDecisionSchema = z.object({
  /** Which record survives. Must be one of the two in the pair. */
  keepId: z.string().min(1).optional(),
  note: z.string().max(1000).optional(),
});

adminRouter.get("/reference-merges", async (c) => {
  const status = c.req.query("status") ?? "pending";

  const rows = await prisma.referenceMergeCandidate.findMany({
    where: status === "all" ? {} : { status },
    include: { left: { select: MERGE_SIDE_SELECT }, right: { select: MERGE_SIDE_SELECT } },
    // Government-assigned relationships before this platform's own guesses, and
    // within each, oldest first — a queue that reorders itself is a queue where
    // the same item is judged twice.
    orderBy: [{ relationship: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  return c.json({
    candidates: rows.map((row) => ({
      id: row.id,
      relationship: row.relationship,
      // Null for a look-alike, and that absence is the point: nobody official
      // stands behind it.
      identifiedBy: row.identifiedBy,
      evidenceUrl: row.evidenceUrl,
      similarity: row.similarity,
      isSuggestion: row.relationship === LOOK_ALIKE,
      status: row.status,
      note: row.note,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      left: toMergeSide(row.left),
      right: toMergeSide(row.right),
    })),
  });
});

/**
 * Yes — these two are one law.
 *
 * The reviewer picks which record survives, because they can see which one
 * carries the posts and the votes. Defaults to the record with more real
 * engagement so the merge moves as little as possible.
 */
adminRouter.post(
  "/reference-merges/:id/approve",
  zValidator("json", mergeDecisionSchema),
  async (c) => {
    const session = c.get("adminSession");
    const { keepId, note } = c.req.valid("json");

    const candidate = await prisma.referenceMergeCandidate.findUnique({
      where: { id: c.req.param("id") },
      include: {
        left: { select: { id: true, masterReferenceId: true, mergedIntoId: true, _count: { select: { posts: true, votes: true } } } },
        right: { select: { id: true, masterReferenceId: true, mergedIntoId: true, _count: { select: { posts: true, votes: true } } } },
      },
    });

    if (!candidate) {
      return c.json({ error: "Candidate not found" }, 404);
    }
    if (candidate.status !== "pending") {
      return c.json({ error: `This pair was already ${candidate.status}` }, 409);
    }
    if (candidate.left.mergedIntoId || candidate.right.mergedIntoId) {
      await prisma.referenceMergeCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "superseded",
          decidedAt: new Date(),
          note: "One of these records has since been merged elsewhere.",
        },
      });
      return c.json({ error: "One of these records has already been merged elsewhere" }, 409);
    }

    if (keepId && keepId !== candidate.left.id && keepId !== candidate.right.id) {
      return c.json({ error: "keepId must be one of the two records in this pair" }, 400);
    }

    // Default: whichever record carries more real engagement survives, so the
    // merge moves as little as possible and readers stay where they already are.
    const weight = (side: { _count: { posts: number; votes: number } }) =>
      side._count.votes * 10 + side._count.posts * 5;
    const survivorId =
      keepId ??
      (weight(candidate.left) >= weight(candidate.right) ? candidate.left.id : candidate.right.id);
    const sourceId = survivorId === candidate.left.id ? candidate.right.id : candidate.left.id;

    try {
      const merge = await mergeReferences(sourceId, survivorId);

      await prisma.referenceMergeCandidate.update({
        where: { id: candidate.id },
        data: {
          status: "approved",
          decidedById: session.adminId,
          decidedAt: new Date(),
          ...(note ? { note } : {}),
        },
      });

      createActivityLog(
        "approve_reference_merge",
        session.adminId,
        session.username,
        "system",
        candidate.id,
        `Merged ${merge.source.masterReferenceId} into ${merge.target.masterReferenceId} ` +
          `(${candidate.relationship}${candidate.identifiedBy ? `, identified by ${candidate.identifiedBy}` : ""}): ` +
          `${merge.postsMoved} post(s), ${merge.votesMoved} vote(s) moved, ${merge.votesSuperseded} superseded`
      );

      return c.json({ success: true, merge });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Merge failed";
      return c.json({ error: message }, 400);
    }
  }
);

/**
 * No — these are two different laws.
 *
 * Recorded rather than deleted, so the same pair is not put back in front of a
 * reviewer every night. A "no" is a decision, not a temporary state.
 */
adminRouter.post(
  "/reference-merges/:id/reject",
  zValidator("json", mergeDecisionSchema),
  async (c) => {
    const session = c.get("adminSession");
    const { note } = c.req.valid("json");

    const candidate = await prisma.referenceMergeCandidate.findUnique({
      where: { id: c.req.param("id") },
      include: { left: { select: { masterReferenceId: true } }, right: { select: { masterReferenceId: true } } },
    });

    if (!candidate) {
      return c.json({ error: "Candidate not found" }, 404);
    }
    if (candidate.status !== "pending") {
      return c.json({ error: `This pair was already ${candidate.status}` }, 409);
    }

    await prisma.referenceMergeCandidate.update({
      where: { id: candidate.id },
      data: {
        status: "rejected",
        decidedById: session.adminId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });

    createActivityLog(
      "reject_reference_merge",
      session.adminId,
      session.username,
      "system",
      candidate.id,
      `Declined to merge ${candidate.left.masterReferenceId} and ${candidate.right.masterReferenceId}` +
        (note ? `: ${note}` : "")
    );

    return c.json({ success: true });
  }
);

/**
 * Check congress.gov now rather than waiting for tonight.
 *
 * Queued, not run inline: the sweep is one request per record and a reviewer
 * should not be holding a browser tab open through it.
 */
adminRouter.post("/reference-merges/refresh", async (c) => {
  const session = c.get("adminSession");
  enqueueLineageSync("admin", undefined, JobPriority.HIGH);

  createActivityLog(
    "refresh_reference_lineage",
    session.adminId,
    session.username,
    "system",
    "all",
    "Queued a congress.gov lineage sweep"
  );

  return c.json({ success: true, message: "Checking congress.gov for published relationships" });
});

export { adminRouter };
export type { AdminUser, AdminSession, BannedUser, ActivityLog, Announcement };

/**
 * GET /api/admin/reports
 *
 * The moderation queue. Reports are evidence, never an action: nothing is
 * hidden or removed because somebody complained, because a platform that does
 * that has handed anybody with a grudge a delete button. A person reads these
 * and decides.
 *
 * `?status=open` by default — a queue that shows everything ever filed is one
 * nobody works through.
 */
adminRouter.get("/reports", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const status = c.req.query("status") ?? "open";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const reports = await prisma.report.findMany({
    where: status === "all" ? {} : { status },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      reporter: { select: { id: true, name: true, username: true } },
      reportedUser: { select: { id: true, name: true, username: true, banned: true } },
    },
  });

  // The reported content itself, so a moderator can judge without a second trip.
  const postIds = reports.map((r) => r.postId).filter((id): id is string => Boolean(id));
  const commentIds = reports.map((r) => r.commentId).filter((id): id is string => Boolean(id));

  const [posts, comments] = await Promise.all([
    postIds.length
      ? prisma.post.findMany({
          where: { id: { in: postIds } },
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { id: true, name: true, username: true, banned: true } },
          },
        })
      : [],
    commentIds.length
      ? prisma.comment.findMany({
          where: { id: { in: commentIds } },
          select: {
            id: true,
            content: true,
            postId: true,
            createdAt: true,
            author: { select: { id: true, name: true, username: true, banned: true } },
          },
        })
      : [],
  ]);

  const postById = new Map(posts.map((p) => [p.id, p]));
  const commentById = new Map(comments.map((c2) => [c2.id, c2]));

  return c.json({
    results: reports.map((r) => ({
      id: r.id,
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reporter: r.reporter,
      // Exactly one of these is set; the other two are null.
      post: r.postId ? postById.get(r.postId) ?? { id: r.postId, deleted: true } : null,
      comment: r.commentId
        ? commentById.get(r.commentId) ?? { id: r.commentId, deleted: true }
        : null,
      reportedUser: r.reportedUser,
    })),
  });
});

/**
 * POST /api/admin/reports/:id
 * Close a report as actioned or dismissed. Whatever the moderator did about the
 * content — delete it, ban the author, nothing — they did through the existing
 * tools; this records that the report itself is finished with.
 */
adminRouter.post("/reports/:id", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const body = (await c.req.json().catch(() => ({}))) as { status?: string };
  if (body.status !== "actioned" && body.status !== "dismissed") {
    return c.json({ error: "status must be actioned or dismissed" }, { status: 400 });
  }

  const report = await prisma.report.findUnique({ where: { id: c.req.param("id") } });
  if (!report) {
    return c.json({ error: "Report not found" }, { status: 404 });
  }

  const updated = await prisma.report.update({
    where: { id: report.id },
    data: {
      status: body.status,
      reviewedBy: session.username,
      reviewedAt: new Date(),
    },
  });

  return c.json({ id: updated.id, status: updated.status });
});


/**
 * GET /api/admin/reference-merges/journal
 *
 * Every merge the system made by itself, newest first, with what decided it
 * and why — and a button to undo any of them.
 *
 * THIS IS THE OVERSIGHT THAT REPLACED THE APPROVAL QUEUE. Asking a person to
 * approve every merge meant duplicates sat unmerged for as long as nobody
 * looked, and each one published two half-answers about the same law. Reading
 * a log of what was decided, and being able to reverse any of it, is a better
 * use of the same person's attention than a queue they will not work.
 */
adminRouter.get("/reference-merges/journal", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const decidedBy = c.req.query("decidedBy") || undefined;

  const entries = await prisma.mergeJournal.findMany({
    where: decidedBy ? { decidedBy } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      sourceId: true,
      targetId: true,
      decidedBy: true,
      reason: true,
      confidence: true,
      evidenceUrl: true,
      revertedAt: true,
      revertedBy: true,
      revertReason: true,
      createdAt: true,
    },
  });

  const referenceIds = [...new Set(entries.flatMap((e) => [e.sourceId, e.targetId]))];
  const records = new Map(
    (
      await prisma.governmentReference.findMany({
        where: { id: { in: referenceIds } },
        select: { id: true, masterReferenceId: true, title: true },
      })
    ).map((r) => [r.id, r]),
  );

  return c.json({
    entries: entries.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
      revertedAt: entry.revertedAt?.toISOString() ?? null,
      source: records.get(entry.sourceId) ?? null,
      target: records.get(entry.targetId) ?? null,
    })),
  });
});

/**
 * POST /api/admin/reference-merges/journal/:id/undo
 *
 * Put a merge back. Superadmin only, same bar as making one.
 */
adminRouter.post("/reference-merges/journal/:id/undo", async (c) => {
  const session = c.get("adminSession");
  const body = await c.req.json().catch(() => ({}) as { reason?: string });
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : "Undone by an administrator.";

  try {
    const report = await unmergeReferences(c.req.param("id"), session.username, reason);
    return c.json({ undone: report });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not undo" }, 400);
  }
});
