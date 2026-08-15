import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { verifyPassword } from "better-auth/crypto";
import { prisma } from "../prisma";
import { generateAdminToken } from "../session-token";
import { applyWeightedTally } from "../services/delegation-service";
import { checkStorage } from "../services/storage";

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

const adminRouter = new Hono();

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

  if (!dbUser) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Verify against the stored Better Auth hash — same check the citizen sign-in does.
  const hash = dbUser.accounts.find((a) => a.password)?.password;
  if (!hash) {
    console.error(`[Admin] ${dbUser.email} has role ${dbUser.role} but no password on file`);
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  let passwordOk = false;
  try {
    passwordOk = await verifyPassword({ hash, password });
  } catch (error) {
    console.error("[Admin] Password verification failed:", error);
  }

  if (!passwordOk) {
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

    // Ban state lives on the row, so deleting the user takes it with them.
    await prisma.user.delete({ where: { id } });

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
      include: { author: true },
    });

    if (!post) {
      return c.json({ error: "Post not found" }, { status: 404 });
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
// Seed Votes (placeholder tally layer)
// ==========================================

/**
 * POST /api/admin/references/clear-seed-votes
 * Strip the placeholder seed numbers out of the public vote tallies.
 * Body: { referenceId?: string } — omit to clear every reference.
 * Real citizen votes are untouched; tallies are recomputed from them.
 */
adminRouter.post(
  "/references/clear-seed-votes",
  zValidator("json", z.object({ referenceId: z.string().optional() })),
  async (c) => {
    const authHeader = c.req.header("Authorization");
    const session = await getAdminFromToken(authHeader);
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }
    if (session.role === "moderator") {
      return c.json({ error: "Moderators cannot modify vote tallies" }, { status: 403 });
    }

    const { referenceId } = c.req.valid("json");

    const targets = await prisma.governmentReference.findMany({
      where: {
        ...(referenceId ? { id: referenceId } : {}),
        OR: [{ seedSupport: { gt: 0 } }, { seedOppose: { gt: 0 } }],
      },
      select: { id: true },
    });

    for (const ref of targets) {
      await prisma.governmentReference.update({
        where: { id: ref.id },
        data: { seedSupport: 0, seedOppose: 0 },
      });
      await applyWeightedTally(ref.id);
    }

    createActivityLog(
      "clear_seed_votes",
      session.adminId,
      session.username,
      "system",
      referenceId ?? "all",
      `Cleared seed votes on ${targets.length} reference(s)`
    );

    return c.json({ success: true, cleared: targets.length });
  }
);

export { adminRouter };
export type { AdminUser, AdminSession, BannedUser, ActivityLog, Announcement };
