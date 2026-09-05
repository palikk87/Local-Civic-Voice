import { Hono, type Context, type Next } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import {
  issueReadLink,
  listReadLinks,
  revokeReadLink,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
} from "../services/bug-report-read-link";
import { verifyPasswordOrDummy } from "../password-check";
import { generateAdminToken } from "../session-token";
import { applyWeightedTally } from "../services/delegation-service";
import { checkStorage } from "../services/storage";
import { emailConfiguration, trySendingEmail } from "../services/email";
import { fullKeyReport, keyWarnings } from "../services/key-report";
import { acknowledgeIncident, listIncidents } from "../services/service-incidents";
import { modelAvailability } from "../services/ai-generate";
import { createNotification, NotificationType } from "../services/notification-service";
import {
  capabilitiesFor,
  consoleRoleSlugs,
  forgetCachedRoles,
  OWNER_ROLE,
  protectOwner,
  requireCapability,
} from "../services/admin-permissions";
import { CAPABILITIES, CAPABILITY_KEYS, isCapability } from "../services/admin-capabilities";
import {
  clearPlatformSecret,
  encryptionStatus,
  isStorableSecret,
  isAllowedSecretName,
  CUSTOM_SECRET_RULE,
  listPlatformSecrets,
  setPlatformSecret,
  STORABLE_SECRETS,
} from "../services/platform-secrets";
import { purgeMediaObjects } from "../services/media-objects";
import { closeAccount } from "../services/account-closure";
import { mergeReferences, unmergeReferences } from "../services/deduplication-service";
import { undoSystemReset } from "../services/system-reset";
import { LOOK_ALIKE } from "../services/reference-lineage";
import { formatReferenceDisplayId } from "../services/reference-id";
import { textFingerprint } from "../services/merge-adjudicator";
import { JobPriority, JobType, enqueueLineageSync, jobQueue } from "../services/job-queue";
import { officialSources } from "../services/reference-content";
import { purgeBlockedText } from "../services/blocked-text-purge";
import { syncExecutiveOrders } from "../services/government-sync";
import {
  B2B_PUBLIC_FIELDS,
  createB2BClient,
  generateApiKey,
  generatePassword,
  rotateB2BCredentials,
  setUserPassword,
} from "../services/credentials";

// ==========================================
// Type Definitions
// ==========================================

/**
 * A role is a slug the owner may create, not one of three names. The union
 * that used to sit here made every custom role a type error waiting to be
 * cast away — which is exactly what the cast at login was doing.
 */
type AdminRoleSlug = string;

interface AdminUser {
  id: string;
  username: string;
  role: AdminRoleSlug;
  createdAt: string;
  lastLogin?: string;
}

interface AdminSession {
  token: string;
  adminId: string;
  username: string;
  role: AdminRoleSlug;
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
      // ANY ROLE THAT EXISTS, not three names frozen into a query.
      //
      // This listed "admin", "moderator" and "superadmin" literally, so the
      // first custom role somebody created could be assigned, could be shown
      // in the console, and could not sign in — an account that looks like an
      // administrator everywhere except the one screen that matters. Found by
      // the permissions test on its first run, before any of this shipped.
      role: { in: await consoleRoleSlugs() },
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
  const role: AdminRoleSlug = dbUser.role;

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
      // WHAT THIS ROLE MAY DO, sent with the session that will be doing it.
      //
      // Without this the console can only gate its screens on the role's NAME,
      // which is how you get a custom role that holds "keys.manage", is refused
      // nothing by the server, and is shown no key panel to use it in — the
      // permission works and is invisible, which to the person holding it is
      // indistinguishable from not working.
      capabilities: [...(await capabilitiesFor(role))],
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
      // Re-read on every verify, not carried from login. A console left open
      // while the owner edits its role picks the change up on the next check
      // rather than at the next sign-in.
      capabilities: [...(await capabilitiesFor(session.role))],
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
  const denied = await requireCapability(session.role, "users.view");
  if (denied) return c.json(denied, { status: 403 });

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
  const denied = await requireCapability(session.role, "users.view");
  if (denied) return c.json(denied, { status: 403 });

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

const resetPasswordSchema = z.object({
  // Optional. Omit and one is generated, which is the path to prefer — a
  // password an administrator chose is a password an administrator knows.
  newPassword: z.string().min(8, "Password must be at least 8 characters").optional(),
  reason: z.string().min(1, "Say why — it goes in the activity log").max(500),
});

/**
 * POST /api/admin/users/:id/reset-password
 *
 * A super admin sets somebody's password, and ends their sessions.
 *
 * WHY THIS EXISTS. No backend process re-keys anybody any more: the seed
 * scripts create and never overwrite, and a credential can only move through
 * services/credentials.ts. That rule is only livable if the people who are
 * supposed to be able to do it still can. This is the super admin's half —
 * total control, exercised deliberately, with their name on it. The other half
 * is the person's own: Settings → Change password, and "Forgot password".
 *
 * The reason is required rather than optional. Somebody is about to be signed
 * out of every device and handed a new password, and "why" is the first thing
 * they will ask.
 */
adminRouter.post(
  "/users/:id/reset-password",
  zValidator("param", idParamSchema),
  zValidator("json", resetPasswordSchema),
  async (c) => {
    const authHeader = c.req.header("Authorization");
    const session = await getAdminFromToken(authHeader);
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }
    const denied = await requireCapability(session.role, "users.resetPassword");
    if (denied) return c.json(denied, { status: 403 });

    const { id } = c.req.valid("param");

    // The owner account is not administrable from here, by anybody.
    const owned = await protectOwner(id);
    if (owned) return c.json(owned, { status: 403 });
    const body = c.req.valid("json");

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true },
    });
    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    const password = body.newPassword ?? generatePassword();

    const { created, revokedSessions } = await setUserPassword(
      user.id,
      password,
      {
        actor: { kind: "admin", adminId: session.adminId, username: session.username },
        reason: body.reason,
      },
      // Always. An admin resetting somebody else's password is responding to
      // something, and a live session that survives the reset makes it useless.
      { revokeSessions: true }
    );

    return c.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email },
      // Shown once, and only to the super admin who asked. Nothing stores it.
      password,
      created,
      revokedSessions,
      warning:
        "Give this to them over a channel they already trust, and tell them to change it. " +
        "It cannot be shown again.",
    });
  }
);

adminRouter.delete("/users/:id", zValidator("param", idParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const denied = await requireCapability(session.role, "users.delete");
  if (denied) return c.json(denied, { status: 403 });
  const { id } = c.req.valid("param");

  // The owner account is not administrable from here, by anybody.
  const owned = await protectOwner(id);
  if (owned) return c.json(owned, { status: 403 });

  try {
    const user = await prisma.user.findUnique({ where: { id } });

    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    // ONE ROUTINE, SHARED WITH "DELETE MY ACCOUNT".
    //
    // This used to purge media and then call prisma.user.delete, which looked
    // complete and was not: eleven tables hold a person's id as a plain column
    // with no link back to the account, so nothing reached them. The worst was
    // GovernmentReferenceVote — the vote row outlived the account, the Pulse
    // went on counting it, and a deleted person kept voting forever.
    //
    // services/account-deletion.ts is now the only thing that removes an
    // account, and both doors go through it, so an administrator's delete and a
    // person's own cannot come to mean different things. It also handles the
    // proceedings rule: an open jury draws a replacement juror, an open
    // impeachment or reset loses the ballot, and a concluded one keeps its
    // recorded outcome.
    // AND AN ADMINISTRATOR IS HELD BY THE SAME RULE — harder, if anything.
    //
    // Article V §3: "No Proceeding under this Article may be halted, delayed or
    // reversed by any Officer, at any level of authority." Deleting the accused
    // out of a live impeachment is exactly that halt, and doing it from the
    // console is the case the clause names by hand. So this goes through
    // closeAccount too: a party to an open proceeding is suspended and kept
    // readable until it is decided, then erased by the sweep.
    const outcome = await closeAccount(id);
    if (!outcome.ok) {
      return c.json({ error: outcome.message ?? "The account could not be deleted." }, { status: 500 });
    }

    const who = user.name || user.username || user.email;

    createActivityLog(
      "delete_user",
      session.adminId,
      session.username,
      "user",
      id,
      outcome.deleted
        ? `Deleted user ${who}`
        : `Closed user ${who}; held until ${outcome.held.length} open proceeding(s) are decided`
    );

    return c.json({
      success: true,
      deleted: outcome.deleted,
      held: outcome.held,
      message: outcome.deleted
        ? `User ${who} has been deleted`
        : `User ${who} is closed. The profile stays visible until their open proceedings are decided, then it is erased.`,
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
    const denied = await requireCapability(session.role, "users.ban");
    if (denied) return c.json(denied, { status: 403 });

    const { id } = c.req.valid("param");

    // The owner account is not administrable from here, by anybody. Banning it
    // would lock the one person who can undo anything out of the platform.
    const owned = await protectOwner(id);
    if (owned) return c.json(owned, { status: 403 });
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
  const denied = await requireCapability(session.role, "users.ban");
  if (denied) return c.json(denied, { status: 403 });
  const { id } = c.req.valid("param");

  // The owner account is not administrable from here, by anybody.
  const owned = await protectOwner(id);
  if (owned) return c.json(owned, { status: 403 });

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
  const denied = await requireCapability(session.role, "posts.moderate");
  if (denied) return c.json(denied, { status: 403 });

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
  const denied = await requireCapability(session.role, "posts.moderate");
  if (denied) return c.json(denied, { status: 403 });

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
  userId?: string | null;
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
    /**
     * The citizen account this was converted from, or null when it was minted
     * from nothing. The console shows it so that "where did this account come
     * from" has an answer that is not a guess.
     */
    convertedFromUserId: row.userId ?? null,
  };
}

// One definition, in services/credentials.ts, so a field added to B2BClient
// cannot start leaking through one endpoint and not another.
const B2B_CLIENT_SELECT = B2B_PUBLIC_FIELDS;

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

  // Reading the list and changing it are different powers, and a role can hold
  // one without the other.
  const needed = c.req.method === "GET" ? "b2b.view" : "b2b.manage";
  const denied = await requireCapability(session.role, needed);
  if (denied) return c.json(denied, { status: 403 });

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

  /**
   * WHEN EACH PASSWORD LAST MOVED, AND WHO MOVED IT.
   *
   * The owner's own B2B login stopped working and nobody could say what had
   * changed it. The answer was in the database the whole time — every
   * credential change is recorded by services/credentials.ts with the actor and
   * the reason — but nothing displayed it, so answering the question meant
   * reading the log by hand.
   *
   * A password can never be shown: it is a one-way hash, unreadable by us or by
   * anybody holding the database. The fact of a change is the whole of what can
   * honestly be reported, and it is also all that was needed.
   *
   * Read here rather than joined per row so the list stays one query regardless
   * of how many clients there are.
   */
  const credentialEvents = await prisma.adminActivityLog.findMany({
    where: {
      targetType: "system",
      targetId: { in: clients.map((row) => row.id) },
      action: "rotate_b2b_client",
    },
    orderBy: { createdAt: "desc" },
    select: { targetId: true, adminUsername: true, details: true, createdAt: true },
  });

  const lastChange = new Map<string, { at: string; by: string | null }>();
  for (const event of credentialEvents) {
    // Sorted newest first, so the first sighting of a client is its latest
    // change. An API key rotation is not a password change and must not be
    // reported as one — rotateB2BCredentials names what moved in the details
    // line, which is the only thing that tells the two apart.
    if (!event.targetId || lastChange.has(event.targetId)) continue;
    if (!/password/i.test(event.details ?? "")) continue;
    lastChange.set(event.targetId, {
      at: event.createdAt.toISOString(),
      by: event.adminUsername,
    });
  }

  return c.json({
    clients: clients.map((row) => ({
      ...toAdminB2BClient(row),
      activeSessions: activeByClient.get(row.id) ?? 0,
      // Null means the password has not moved since the account was created.
      // Not a gap and not a guess — creation is already shown as createdAt, and
      // inventing a "changed" date from it would be exactly the kind of
      // plausible value the governing rule forbids.
      passwordLastChanged: lastChange.get(row.id) ?? null,
    })),
  });
});

// ==========================================
// Roles: what each kind of administrator may do
// ==========================================

const roleSlugParam = z.object({ slug: z.string().min(1).max(64) });

const roleBodySchema = z.object({
  name: z.string().min(1, "A role needs a name").max(80),
  description: z.string().max(400).optional(),
  capabilities: z.array(z.string()).max(200),
});

const createRoleSchema = roleBodySchema.extend({
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(64)
    .regex(/^[a-z0-9_-]+$/, "Lowercase letters, digits, dash and underscore only"),
});

const assignRoleSchema = z.object({
  /** "user" removes every administrative power. */
  role: z.string().min(1).max(64),
});

/**
 * GET /api/admin/roles
 *
 * Every role, what it may do, and the full catalogue to build one from.
 *
 * The catalogue ships with the code rather than the database because every key
 * in it names something a route checks by name. A permission somebody could
 * type in freehand would gate nothing while looking like it gated something,
 * which is worse than having no permission system at all.
 */
adminRouter.get("/roles", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const roles = await prisma.adminRole.findMany({ orderBy: { createdAt: "asc" } });
  const holders = await prisma.user.groupBy({ by: ["role"], _count: { role: true } });
  const countFor = (slug: string) =>
    holders.find((row) => row.role === slug)?._count.role ?? 0;

  return c.json({
    data: {
      /**
       * The owner first, and marked as not editable. It is not a row: it holds
       * every capability including ones added later, which is what guarantees
       * somebody can always undo a mistake — including the mistake of removing
       * their own access.
       */
      owner: {
        slug: OWNER_ROLE,
        name: "Owner",
        description:
          "Holds everything, including capabilities added in future. Cannot be edited or " +
          "deleted — somebody has to be able to undo a mistake.",
        capabilities: CAPABILITY_KEYS,
        builtIn: true,
        editable: false,
        holders: countFor(OWNER_ROLE),
      },
      roles: roles.map((role) => ({
        slug: role.slug,
        name: role.name,
        description: role.description,
        capabilities: JSON.parse(role.capabilities) as string[],
        builtIn: role.builtIn,
        editable: true,
        holders: countFor(role.slug),
      })),
      capabilities: CAPABILITIES,
      note:
        "Every capability here is checked by name somewhere in the API. There is no way to " +
        "invent one, because a permission that gates nothing is worse than none.",
    },
  });
});

/** POST /api/admin/roles — define a new kind of administrator. */
adminRouter.post("/roles", zValidator("json", createRoleSchema), async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "roles.manage");
  if (denied) return c.json(denied, { status: 403 });

  const body = c.req.valid("json");
  const slug = body.slug.toLowerCase();

  if (slug === OWNER_ROLE || slug === "user") {
    return c.json({ error: `"${slug}" is reserved.` }, { status: 400 });
  }
  if (await prisma.adminRole.findUnique({ where: { slug }, select: { slug: true } })) {
    return c.json({ error: "A role with that slug already exists" }, { status: 409 });
  }

  const unknown = body.capabilities.filter((key) => !isCapability(key));
  if (unknown.length > 0) {
    return c.json(
      { error: `Not capabilities this platform checks: ${unknown.join(", ")}` },
      { status: 400 },
    );
  }

  const created = await prisma.adminRole.create({
    data: {
      slug,
      name: body.name,
      description: body.description,
      capabilities: JSON.stringify(body.capabilities),
    },
  });
  forgetCachedRoles();

  createActivityLog(
    "create_role",
    session.adminId,
    session.username,
    "system",
    slug,
    `Created the role "${created.name}" with ${body.capabilities.length} capabilit(ies)`,
  );

  return c.json({ data: { slug: created.slug, name: created.name } }, { status: 201 });
});

/** PUT /api/admin/roles/:slug — change what a role may do. */
adminRouter.put(
  "/roles/:slug",
  zValidator("param", roleSlugParam),
  zValidator("json", roleBodySchema),
  async (c) => {
    const session = await getAdminFromToken(c.req.header("Authorization"));
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }
    const denied = await requireCapability(session.role, "roles.manage");
    if (denied) return c.json(denied, { status: 403 });

    const { slug } = c.req.valid("param");
    if (slug === OWNER_ROLE) {
      // THE ONE ROLE THAT CANNOT BE EDITED, and the reason every other one can
      // be. If the owner's powers were editable there would be a sequence of
      // perfectly legitimate edits that locks everybody out of the platform
      // permanently, with nobody left who can undo it.
      return c.json(
        { error: "The owner role cannot be edited. It is what makes every other role safe to." },
        { status: 400 },
      );
    }

    const existing = await prisma.adminRole.findUnique({ where: { slug } });
    if (!existing) return c.json({ error: "No such role" }, { status: 404 });

    const body = c.req.valid("json");
    const unknown = body.capabilities.filter((key) => !isCapability(key));
    if (unknown.length > 0) {
      return c.json(
        { error: `Not capabilities this platform checks: ${unknown.join(", ")}` },
        { status: 400 },
      );
    }

    await prisma.adminRole.update({
      where: { slug },
      data: {
        name: body.name,
        description: body.description,
        capabilities: JSON.stringify(body.capabilities),
      },
    });
    // Before returning, so nobody keeps a power that was just taken away.
    forgetCachedRoles();

    const before = new Set(JSON.parse(existing.capabilities) as string[]);
    const after = new Set(body.capabilities);
    const added = [...after].filter((key) => !before.has(key));
    const removed = [...before].filter((key) => !after.has(key));

    createActivityLog(
      "update_role",
      session.adminId,
      session.username,
      "system",
      slug,
      `Changed "${body.name}"` +
        (added.length ? `; added ${added.join(", ")}` : "") +
        (removed.length ? `; removed ${removed.join(", ")}` : ""),
    );

    return c.json({ data: { slug, added, removed } });
  },
);

/** DELETE /api/admin/roles/:slug — remove a role nobody holds. */
adminRouter.delete("/roles/:slug", zValidator("param", roleSlugParam), async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "roles.manage");
  if (denied) return c.json(denied, { status: 403 });

  const { slug } = c.req.valid("param");
  if (slug === OWNER_ROLE) {
    return c.json({ error: "The owner role cannot be deleted." }, { status: 400 });
  }

  const role = await prisma.adminRole.findUnique({ where: { slug } });
  if (!role) return c.json({ error: "No such role" }, { status: 404 });
  if (role.builtIn) {
    // A deployment must always have somewhere to put an administrator.
    return c.json(
      { error: "A built-in role cannot be deleted. Edit what it may do instead." },
      { status: 400 },
    );
  }

  const holders = await prisma.user.count({ where: { role: slug } });
  if (holders > 0) {
    // Deleting it would leave those accounts holding a slug that resolves to
    // no capabilities — administrators who can sign in and do nothing, with no
    // sign of why. Move them first, deliberately.
    return c.json(
      {
        error: `${holders} account(s) still hold this role. Move them to another role first.`,
      },
      { status: 409 },
    );
  }

  await prisma.adminRole.delete({ where: { slug } });
  forgetCachedRoles();

  createActivityLog(
    "delete_role",
    session.adminId,
    session.username,
    "system",
    slug,
    `Deleted the role "${role.name}"`,
  );

  return c.json({ data: { slug, deleted: true } });
});

/**
 * PUT /api/admin/users/:id/role
 *
 * Give somebody a role, or take every administrative power away with "user".
 *
 * THIS ENDPOINT DID NOT EXIST. The mobile console has had a "Grant Admin
 * Privileges" button since before this file was written, calling
 * POST /api/admin/users/:id/make-admin — a route the backend does not mount and
 * never has. It answered 404 every time it was pressed. Fourth mismatch of that
 * shape found on this project, and the reason apps/web/scripts/route-target-check.mjs
 * exists; it reads web navigation, not mobile fetch calls, so it could not see
 * this one.
 */
adminRouter.put(
  "/users/:id/role",
  zValidator("param", idParamSchema),
  zValidator("json", assignRoleSchema),
  async (c) => {
    const session = await getAdminFromToken(c.req.header("Authorization"));
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }
    const denied = await requireCapability(session.role, "users.assignRole");
    if (denied) return c.json(denied, { status: 403 });

    const { id } = c.req.valid("param");
    const role = c.req.valid("json").role.toLowerCase();

    // THE OWNER SEAT IS NOT ASSIGNABLE. There is one, it is not handed out,
    // and no path through this API creates a second.
    //
    // "Only an owner may do it" was the first version of this rule and it is
    // not enough: an owner who is phished, or who mis-clicks once, has then
    // created somebody with the same absolute powers and no way to remove
    // them. The seat is filled by scripts/seed-admin.ts, which needs a shell
    // and a database URL — the right bar for the one account nothing else can
    // touch.
    if (role === OWNER_ROLE) {
      return c.json(
        {
          error:
            "The owner role cannot be given to anybody. There is one owner and the seat is " +
            "not assignable from the console.",
        },
        { status: 403 },
      );
    }

    // AND NOTHING IS DONE TO THE OWNER EITHER.
    const owned = await protectOwner(id);
    if (owned) return c.json(owned, { status: 403 });

    if (role !== "user" && role !== OWNER_ROLE) {
      const exists = await prisma.adminRole.findUnique({
        where: { slug: role },
        select: { slug: true },
      });
      if (!exists) return c.json({ error: `No role called "${role}"` }, { status: 400 });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, username: true, email: true },
    });
    if (!target) return c.json({ error: "That account does not exist" }, { status: 404 });

    await prisma.user.update({ where: { id }, data: { role } });
    forgetCachedRoles();

    createActivityLog(
      "assign_role",
      session.adminId,
      session.username,
      "user",
      id,
      `${target.username ?? target.email}: ${target.role} → ${role}`,
    );

    return c.json({
      data: {
        id,
        role,
        previousRole: target.role,
        note:
          role === "user"
            ? "Every administrative power removed. Their citizen account is untouched."
            : "Takes effect on their next request; existing console sessions are re-checked.",
      },
    });
  },
);

const convertUserSchema = z.object({
  userId: z.string().min(1, "Which account is being converted"),
  /** Defaults to the person's own username, which is almost always right. */
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64, "Username too long")
    .regex(/^[A-Za-z0-9_.-]+$/, "Username may contain only letters, digits, and _ . -")
    .optional(),
  /** Defaults to their display name. A company name is usually wanted instead. */
  name: z.string().min(1).max(200).optional(),
  type: b2bTypeSchema,
  tier: b2bTierSchema,
  password: z.string().min(12, "Password must be at least 12 characters").optional(),
});

/**
 * POST /api/admin/b2b-clients/from-user
 *
 * Give an existing citizen a business account.
 *
 * WHAT "CONVERSION" MEANS HERE, AND WHAT IT DOES NOT. It does not transform the
 * person into a customer, move their data, or spend their account. Their votes,
 * their posts and their civic record stay exactly where they are and keep
 * belonging to them — the Public Pulse is a count of citizens, and quietly
 * reclassifying one would corrupt the only number this platform exists to
 * report. What is created is a second, separate thing: a B2BClient row, linked
 * back to the account it was created for so the console can say where it came
 * from.
 *
 * SEPARATE CREDENTIALS, ON PURPOSE. The business account gets its own username,
 * password and API key, generated and shown exactly once, like every other
 * client. It would be friendlier to let them sign in with the password they
 * already have, and it would be wrong: two auth systems sharing one secret
 * means a citizen changing their own password silently re-keys a business
 * account, which is precisely the class of surprise this codebase made
 * structurally impossible. Their citizen login is untouched and keeps working.
 *
 * NO ROLE IS GRANTED. Holding a business account says nothing about what
 * somebody may do as a citizen, and the two must not start leaking into each
 * other.
 *
 * Superadmin only, and one account cannot be converted twice — the link column
 * is unique, so a second attempt is a conflict rather than a second account
 * nobody knows about.
 */
adminRouter.post("/b2b-clients/from-user", zValidator("json", convertUserSchema), async (c) => {
  const session = c.get("adminSession");
  const denied = await requireCapability(session.role, "b2b.manage");
  if (denied) return c.json(denied, { status: 403 });

  const body = c.req.valid("json");

  const user = await prisma.user.findUnique({
    where: { id: body.userId },
    select: { id: true, name: true, username: true, email: true },
  });
  if (!user) {
    return c.json({ error: "That account does not exist" }, { status: 404 });
  }

  const alreadyLinked = await prisma.b2BClient.findFirst({
    where: { userId: user.id },
    select: { username: true },
  });
  if (alreadyLinked) {
    return c.json(
      {
        error: `${user.username ?? user.email} already has the business account "${alreadyLinked.username}".`,
      },
      { status: 409 },
    );
  }

  // Their own username is the obvious default and is almost always what is
  // wanted; anything not usable as a B2B username has to be given explicitly
  // rather than mangled into one.
  const proposed = (body.username ?? user.username ?? "").toLowerCase();
  if (!/^[a-z0-9_.-]{3,64}$/.test(proposed)) {
    return c.json(
      {
        error:
          "This account has no username that can be used for a business login. Supply one.",
      },
      { status: 400 },
    );
  }

  const taken = await prisma.b2BClient.findUnique({ where: { username: proposed } });
  if (taken) {
    return c.json({ error: "A B2B client with that username already exists" }, { status: 409 });
  }

  const password = body.password ?? generatePassword();
  const apiKey = generateApiKey();

  const created = await createB2BClient(
    {
      username: proposed,
      name: body.name ?? user.name,
      type: body.type,
      tier: body.tier,
      password,
      apiKey,
      userId: user.id,
    },
    {
      actor: { kind: "admin", adminId: session.adminId, username: session.username },
      reason: `Converted the account ${user.username ?? user.email} to a ${body.tier} tier business account`,
    },
  );

  createActivityLog(
    "convert_user_to_b2b",
    session.adminId,
    session.username,
    "user",
    user.id,
    `Gave ${user.username ?? user.email} the business account "${created.username}". Their citizen account is unchanged.`,
  );

  return c.json(
    {
      success: true,
      client: toAdminB2BClient(created),
      convertedFrom: { id: user.id, username: user.username, name: user.name },
      credentials: { username: created.username, password, apiKey },
      warning: "Copy these now. They cannot be shown again — only rotated.",
      note:
        "Their citizen account is untouched: same login, same votes, same posts, same role. " +
        "This is a second account alongside it, not a replacement for it.",
    },
    { status: 201 },
  );
});

adminRouter.post("/b2b-clients", zValidator("json", createB2BClientSchema), async (c) => {
  const session = c.get("adminSession");
  const body = c.req.valid("json");
  const username = body.username.toLowerCase();

  const existing = await prisma.b2BClient.findUnique({ where: { username } });
  if (existing) {
    return c.json({ error: "A B2B client with that username already exists" }, { status: 409 });
  }

  const password = body.password ?? generatePassword();
  const apiKey = generateApiKey();

  // Through services/credentials.ts, like every other credential write in this
  // codebase. It hashes both values and writes the audit row before returning,
  // so the record of this account existing cannot be lost to a crash between
  // the two.
  const created = await createB2BClient(
    { username, name: body.name, type: body.type, tier: body.tier, password, apiKey },
    {
      actor: { kind: "admin", adminId: session.adminId, username: session.username },
      reason: `Created from the admin console at the ${body.tier} tier`,
    }
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

    const credentials: { password?: string; apiKey?: string } = {};
    if (body.password) credentials.password = body.newPassword ?? generatePassword();
    if (body.apiKey) credentials.apiKey = generateApiKey();

    // services/credentials.ts hashes, writes, revokes the sessions the old
    // password opened, and records who asked and why — in that order, awaited.
    // Rotating here is the route to prefer over the seed script precisely
    // because this leaves a name behind.
    const { client, revokedSessions } = await rotateB2BCredentials(id, credentials, {
      actor: { kind: "admin", adminId: session.adminId, username: session.username },
      reason: "Requested from the admin console",
    });

    return c.json({
      success: true,
      client: toAdminB2BClient(client),
      credentials: { username: client.username, ...credentials },
      revokedSessions,
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
  const denied = await requireCapability(session.role, "content.repair");
  if (denied) return c.json(denied, { status: 403 });

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
      // An admin pressed a button, so the brief is wanted. The scheduled sweep
      // leaves this off and repairs the text only.
      { referenceId: record.id, writeBrief: true },
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
 * POST /api/admin/maintenance/purge-blocked-text
 *
 * Find records holding an anti-scraping page as their official text, and clear
 * them. Reports by default; writes only when asked twice, so the destructive
 * half is never the accidental half.
 *
 * WHY THIS IS A BUTTON. It was a script, and a script needs somebody with a
 * shell on the production service. The person who NOTICES a captcha where a
 * law should be is whoever is reading the app, usually on a phone, and making
 * them find a terminal is how a known problem stays live for a week. Same
 * implementation as the script — src/services/blocked-text-purge.ts — so the
 * two can never disagree about what counts as a block page.
 */
adminRouter.post("/maintenance/purge-blocked-text", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "content.repair");
  if (denied) return c.json(denied, { status: 403 });

  const apply = c.req.query("apply") === "true";
  const referenceType = c.req.query("referenceType") || undefined;

  const result = await purgeBlockedText({ referenceType, apply });

  // Logged only when something was actually written. A dry run is a question,
  // not an event, and an activity log full of questions hides the answers.
  if (result.applied && result.cleared > 0) {
    createActivityLog(
      "purge_blocked_text",
      session.adminId,
      session.username,
      "system",
      referenceType ?? "all",
      `Cleared a block page from ${result.cleared} record(s), and every brief written from one`,
    );
  }

  return c.json({
    data: {
      examined: result.examined,
      applied: result.applied,
      cleared: result.cleared,
      found: result.found,
      message: result.applied
        ? `Cleared ${result.cleared}. Those records show an honest empty state now, and the ` +
          `content pipeline will fetch the real text on its next pass.`
        : result.found.length === 0
          ? "Nothing to clear: no stored text looks like a block page."
          : `${result.found.length} record(s) hold a block page. Nothing was written — ` +
            `run again with apply to clear them.`,
    },
  });
});

/**
 * POST /api/admin/maintenance/backfill-executive-orders
 *
 * Catch the executive orders up. The nightly sync takes at most 50 new ones a
 * run, on purpose: doing the whole Federal Register in one night is 1,556
 * full-text downloads against a public server and 1,556 rows into a shared
 * database. This is the same job with the ceiling raised deliberately, by
 * somebody who is watching it.
 *
 * Runs inline rather than queued, so the answer comes back with the request and
 * the person who pressed it sees what happened.
 */
adminRouter.post("/maintenance/backfill-executive-orders", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "content.repair");
  if (denied) return c.json(denied, { status: 403 });

  const requested = Number(c.req.query("maxNew") ?? 100);
  // A ceiling on the ceiling. This runs inside a request, and a request that
  // walks the whole corpus will be cut off by a proxy long before it finishes,
  // leaving somebody unsure what was written.
  const maxNew = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), 300);

  const before = await prisma.governmentReference.count({
    where: { referenceType: "executive_order" },
  });
  const beforeText = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", fullText: { not: null } },
  });

  // THE SOURCE IS SOMEBODY ELSE'S SERVER, AND IT CAN REFUSE.
  //
  // This ran unguarded, so a network failure inside the sync escaped the
  // handler. Found when a test pressed the button in an environment with no
  // route to the Federal Register: the request never returned, and the process
  // went with it — every later request answered ECONNREFUSED. An administrator
  // pressing a button must not be able to take the server down with it, and a
  // source that is unreachable is a thing to be told, not a thing to crash on.
  let touched: Awaited<ReturnType<typeof syncExecutiveOrders>>;
  try {
    touched = await syncExecutiveOrders({ maxNew, stopAfterKnown: 200, pauseMs: 250 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[Backfill] executive order sync failed:", detail);
    return c.json(
      {
        error:
          "The Federal Register could not be read, so nothing was backfilled. " +
          "Nothing was written and nothing was lost — try again when the source answers.",
        detail,
      },
      { status: 502 },
    );
  }

  const after = await prisma.governmentReference.count({
    where: { referenceType: "executive_order" },
  });
  const afterText = await prisma.governmentReference.count({
    where: { referenceType: "executive_order", fullText: { not: null } },
  });

  createActivityLog(
    "backfill_executive_orders",
    session.adminId,
    session.username,
    "system",
    "executive_order",
    `Backfilled up to ${maxNew}: ${after - before} new record(s), ${afterText - beforeText} gained text`,
  );

  return c.json({
    data: {
      requestedMaxNew: maxNew,
      touched,
      added: after - before,
      gainedText: afterText - beforeText,
      total: after,
      totalWithText: afterText,
      message:
        afterText < after
          ? `${after - afterText} still have no official text. That is honest rather than ` +
            `broken: either the source has not given it to us yet, or it answered with a ` +
            `block page and we refused to store it.`
          : "Every executive order held now has its official text.",
    },
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

/**
 * GET /api/admin/email-health
 *
 * What this server knows about its mail setup, without sending anything.
 *
 * Every field here exists because it was, at some point, the actual answer to
 * "there is definitely a key in place and no email arrives". A key set on the
 * web host rather than the API. A key with a newline on the end. A key that was
 * not a Resend key. And most often of all, a perfectly good key sending From a
 * domain nobody verified — which the provider refuses in a way indistinguishable
 * from a bad key.
 */
/**
 * GET /api/admin/keys
 *
 * Every API key this deployment uses: is it set, does it look right, and what
 * stops working without it. Never returns a key — the fingerprint is four hex
 * characters of its digest, which is enough to compare against what you pasted
 * and worth nothing to anybody who reads it.
 *
 * This is the answer to "the key is definitely set and the feature still does
 * not work", which was true more than once here, with three different keys, and
 * could only be resolved by reading source code.
 */
/**
 * GET /api/admin/incidents
 *
 * WHAT IS BROKEN, WHAT IS CARRYING IT, AND HAS ANYBODY SEEN IT.
 *
 * WHY THIS EXISTS. The Citizen's Brief went down three times, each time because
 * the model it called stopped being served under that name. Each time the only
 * record was a log line on a host nobody reads, and what reached a person was a
 * screen saying "try again shortly" about a failure that would never resolve on
 * its own.
 *
 * The platform now falls back to another model and keeps working. That is the
 * right behaviour and it is also how a problem hides for a month — so falling
 * back opens a row here, and the row stays open until a person clears it.
 */
adminRouter.get("/incidents", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "incidents.manage");
  if (denied) return c.json(denied, { status: 403 });

  const incidents = await listIncidents();
  return c.json({
    data: {
      incidents,
      open: incidents.filter((incident) => !incident.acknowledgedAt).length,
      // What this process currently believes about each model, so "why is it
      // using the old one" has an answer on the same screen.
      models: modelAvailability(),
      note:
        "A fallback is not a fix. These stay here until somebody marks them seen, " +
        "and a marked one re-opens by itself if it happens again.",
    },
  });
});

/**
 * POST /api/admin/incidents/:id/acknowledge
 *
 * "I have seen this." Deliberately NOT "this is fixed" — the platform has no
 * way to know that, and an incident that recurs re-opens itself.
 */
adminRouter.post("/incidents/:id/acknowledge", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "incidents.manage");
  if (denied) return c.json(denied, { status: 403 });

  const ok = await acknowledgeIncident(c.req.param("id"), session.username);
  if (!ok) return c.json({ error: "No such incident." }, { status: 404 });
  return c.json({ data: { acknowledged: true } });
});

adminRouter.get("/keys", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  // THE DATABASE DECIDES WHAT IS SHOWN, not a hand-written list. Anything an
  // operator has stored appears here under the name they stored it as, so
  // adding a key never needs a developer and a key can never be present and
  // invisible at the same time.
  const stored = await listPlatformSecrets();
  const keys = fullKeyReport(
    stored.filter((secret) => secret.storedInDatabase).map((secret) => secret.name),
  );
  const encryption = encryptionStatus();
  return c.json({
    data: {
      keys,
      // Warnings still read the described rows: they are statements about what
      // this platform needs, and it needs nothing from a key it does not use.
      warnings: keyWarnings(),
      // Every key can now come from either of two places, so each one says
      // which. "I set it" and "this process is using it" are different
      // statements, and the gap between them was the whole problem three
      // separate times here.
      storage: {
        stored,
        storable: STORABLE_SECRETS,
        // The panel is an on-ramp: an operator can add a NEW provider's key,
        // not only replace one of the built-ins. This is the rule its name has
        // to follow so it can never be mistaken for a system variable.
        customNamingRule: CUSTOM_SECRET_RULE,
        encryptionAvailable: encryption.available,
        encryptionUnavailableReason: encryption.reason,
        encryptionSource: encryption.source,
        encryptionCaveat: encryption.caveat,
        note:
          "A key set here is encrypted and kept in the platform's own database, so it " +
          "survives moving the API to another host and can be rotated without a redeploy. " +
          "It takes precedence over a variable of the same name on the host. Clearing one " +
          "hands the name back to the host variable, if there still is one.",
        cannotBeStored: {
          names: ["DATABASE_URL", "BETTER_AUTH_SECRET", "SECRETS_ENCRYPTION_KEY"],
          why:
            "A process cannot read the database to learn how to reach the database, " +
            "sessions must verify before anyone can be an admin, and a key kept beside " +
            "what it encrypts is not encryption. These three stay on the host.",
        },
      },
      note:
        "Keys are read from this API process's own environment, which the stored ones are " +
        "loaded into at boot. A key set anywhere else — the web host, a build-time " +
        "variable, another service — is not visible here and is not used.",
      verifyEmailWith: "POST /api/admin/email-health/test { to }",
    },
  });
});

const storedKeySchema = z.object({
  value: z.string().min(1, "An empty value is not a key"),
});

/**
 * PUT /api/admin/keys/:name
 *
 * Put a provider key in the platform's own database, encrypted, instead of in
 * the host's environment panel.
 *
 * WHY THIS IS A BUTTON AND NOT A DASHBOARD FIELD. Keys in one host's variables
 * make that host load-bearing for a reason unrelated to running a container:
 * leaving meant re-typing every key, and rotating one meant a redeploy by
 * whoever held the dashboard. A rotation is now a text box and a save, and it
 * takes effect on the next request — env.ts reads every secret live rather than
 * snapshotting it at import, so nothing has to restart.
 *
 * Superadmin only, and the value is never returned, logged, or written to the
 * activity trail. What comes back is what a person needs to recognise the key
 * they just pasted — four hex characters of its digest and its length — and
 * nothing that helps anybody who did not already have it.
 */
adminRouter.put("/keys/:name", zValidator("json", storedKeySchema), async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "keys.manage");
  if (denied) return c.json(denied, { status: 403 });

  const name = c.req.param("name");
  // NOT "whatever was named": this writes into process.env, so an arbitrary
  // name is a remote code execution waiting for someone to type PATH or
  // NODE_OPTIONS. A built-in is always allowed; a NEW provider's key is allowed
  // only if its name structurally cannot be a runtime variable — see
  // isSafeCustomSecretName. Same check the loader uses, so the two cannot
  // disagree about what is safe.
  if (!isAllowedSecretName(name)) {
    return c.json(
      {
        error: `${name} cannot be stored under that name.`,
        rule: CUSTOM_SECRET_RULE,
        storable: STORABLE_SECRETS,
      },
      { status: 400 },
    );
  }

  try {
    const result = await setPlatformSecret(name, c.req.valid("json").value, {
      id: session.adminId,
      username: session.username,
    });

    createActivityLog(
      "set_platform_key",
      session.adminId,
      session.username,
      "system",
      name,
      `${result.replaced ? "Replaced" : "Stored"} ${name} in the database (fingerprint ${result.fingerprint})`,
    );

    return c.json({
      data: {
        ...result,
        message:
          `${name} is stored and in use now. It overrides any variable of the same name on ` +
          `the host, and it moves with the database if this API changes hosts.`,
      },
    });
  } catch (error) {
    // The encryption key being absent is a configuration answer, not a crash:
    // say what to do about it.
    return c.json({ error: (error as Error).message }, { status: 400 });
  }
});

/**
 * DELETE /api/admin/keys/:name
 *
 * Forget a stored key. If the host still has a variable of that name, it takes
 * over again on the spot; if it does not, the key is simply gone and the key
 * report says so rather than the feature failing silently later.
 */
adminRouter.delete("/keys/:name", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "keys.manage");
  if (denied) return c.json(denied, { status: 403 });

  const name = c.req.param("name");
  if (!isAllowedSecretName(name)) {
    return c.json({ error: `${name} is not a key this platform stores` }, { status: 400 });
  }

  const result = await clearPlatformSecret(name);

  createActivityLog(
    "clear_platform_key",
    session.adminId,
    session.username,
    "system",
    name,
    `Removed the stored ${name}`,
  );

  return c.json({
    data: {
      ...result,
      message: result.fellBackToEnvironment
        ? `${name} is no longer stored. The host's own variable is in use again.`
        : `${name} is no longer set anywhere. Whatever it powers stops working until one is set.`,
    },
  });
});

const bugReportQuerySchema = z.object({
  status: z.enum(["open", "acknowledged", "fixed", "declined", "all"]).optional().default("open"),
  limit: z.string().optional().transform((v) => (v ? Math.min(parseInt(v, 10), 100) : 50)),
  offset: z.string().optional().transform((v) => (v ? parseInt(v, 10) : 0)),
});

/**
 * GET /api/admin/bug-reports
 *
 * The inbox. Open first, newest first, because a report nobody has looked at
 * is the only kind that is costing anything.
 */
adminRouter.get("/bug-reports", zValidator("query", bugReportQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "bugReports.manage");
  if (denied) return c.json(denied, { status: 403 });

  const { status, limit, offset } = c.req.valid("query");
  const where = status === "all" ? {} : { status };

  const [reports, total, openCount] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.bugReport.count({ where }),
    prisma.bugReport.count({ where: { status: "open" } }),
  ]);

  return c.json({ reports, total, openCount, limit, offset });
});

// ---------------------------------------------------------------------------
// Read links for the bug queue
// ---------------------------------------------------------------------------

const readLinkSchema = z.object({
  /// So a link can be recognised in a list and revoked with confidence.
  label: z.string().min(1, "Give the link a label so you can recognise it later").max(120),
  ttlDays: z.number().int().min(1).max(MAX_TTL_DAYS).optional(),
});

/**
 * POST /api/admin/bug-reports/read-links
 *
 * Mint a link that reads the bug queue and nothing else.
 *
 * WHY THIS EXISTS RATHER THAN SHARING A PASSWORD. The owner writes bugs down
 * and somebody else fixes them, and that handoff was a person signing in and
 * copying the list out by hand. The shortcut everybody reaches for is to share
 * the admin login, which grants everything forever and cannot be withdrawn
 * without changing it for everybody. This grants one read, expires on its own,
 * and can be revoked by itself.
 *
 * THE TOKEN COMES BACK EXACTLY ONCE, here, in this response. It is stored as a
 * digest, so nobody — including this API — can produce it again.
 */
adminRouter.post("/bug-reports/read-links", zValidator("json", readLinkSchema), async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "bugReports.manage");
  if (denied) return c.json(denied, { status: 403 });

  const body = c.req.valid("json");
  const issued = await issueReadLink({
    label: body.label,
    ttlDays: body.ttlDays ?? DEFAULT_TTL_DAYS,
    createdById: session.adminId,
    createdBy: session.username,
  });

  // The label and the fingerprint, never the token. An activity log is read by
  // more people than the response is.
  createActivityLog(
    "issue_bug_read_link",
    session.adminId,
    session.username,
    "system",
    issued.id,
    `Issued a bug-queue read link "${issued.label}" (${issued.fingerprint}), expires ${issued.expiresAt.toISOString()}`,
  );

  return c.json({
    data: {
      id: issued.id,
      label: issued.label,
      fingerprint: issued.fingerprint,
      expiresAt: issued.expiresAt,
      token: issued.token,
      message:
        "Copy this now — it is not stored and cannot be shown again. It reads bug reports only, " +
        "expires on the date above, and can be revoked here at any time.",
    },
  });
});

/**
 * GET /api/admin/bug-reports/read-links
 *
 * Every link ever issued, newest first, with whether it is live and when it was
 * last used. Revoked and expired links stay listed: a link that vanishes takes
 * its usage history with it, and "was this ever used" is asked precisely when
 * something has gone wrong.
 */
adminRouter.get("/bug-reports/read-links", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "bugReports.manage");
  if (denied) return c.json(denied, { status: 403 });

  return c.json({ links: await listReadLinks() });
});

/**
 * DELETE /api/admin/bug-reports/read-links/:id
 *
 * Stop a link working, now. Idempotent, and it keeps the first revocation's
 * time rather than overwriting it — that is when it stopped working.
 */
adminRouter.delete("/bug-reports/read-links/:id", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "bugReports.manage");
  if (denied) return c.json(denied, { status: 403 });

  const id = c.req.param("id");
  const found = await revokeReadLink(id, session.username);
  if (!found) return c.json({ error: "No such link" }, { status: 404 });

  createActivityLog(
    "revoke_bug_read_link",
    session.adminId,
    session.username,
    "system",
    id,
    "Revoked a bug-queue read link",
  );

  return c.json({ data: { revoked: true } });
});

const triageSchema = z.object({
  status: z.enum(["open", "acknowledged", "fixed", "declined"]),
  adminNote: z.string().max(2000).optional(),
});

/**
 * PATCH /api/admin/bug-reports/:id
 *
 * Triage. Every transition records who made it — a queue where things change
 * state anonymously is a queue nobody trusts.
 */
adminRouter.patch(
  "/bug-reports/:id",
  zValidator("param", idParamSchema),
  zValidator("json", triageSchema),
  async (c) => {
    const authHeader = c.req.header("Authorization");
    const session = await getAdminFromToken(authHeader);
    if (!session) {
      return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
    }
    const denied = await requireCapability(session.role, "bugReports.manage");
    if (denied) return c.json(denied, { status: 403 });

    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const existing = await prisma.bugReport.findUnique({ where: { id } });
    if (!existing) return c.json({ error: "Report not found" }, { status: 404 });

    const settled = body.status === "fixed" || body.status === "declined";
    const report = await prisma.bugReport.update({
      where: { id },
      data: {
        status: body.status,
        adminNote: body.adminNote ?? existing.adminNote,
        resolvedBy: settled ? session.username : null,
        resolvedAt: settled ? new Date() : null,
      },
    });

    createActivityLog(
      "triage_bug_report",
      session.adminId,
      session.username,
      "system",
      id,
      `Bug report marked ${body.status}`
    );

    return c.json({ success: true, report });
  }
);

adminRouter.get("/email-health", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }

  const config = emailConfiguration();

  const warnings = [
    !config.configured &&
      "No RESEND_API_KEY on the API. Nobody who signs up can finish signing up — the " +
        "verification code has nowhere to go. Reading still works.",
    config.configured &&
      !config.keyLooksLikeResend &&
      "RESEND_API_KEY is set but does not start with \"re_\". Resend keys do. This is " +
        "usually a different service's key pasted into the right box.",
    config.configured &&
      !config.fromIsProviderTestSender &&
      `EMAIL_FROM sends from ${config.fromDomain ?? "an unreadable address"}. Resend ` +
        "refuses any message from a domain the account has not verified, and that " +
        "failure looks exactly like a bad key. Verify the domain, or use " +
        "onboarding@resend.dev while testing.",
    config.fromIsProviderTestSender &&
      "EMAIL_FROM is Resend's shared test sender. It needs no DNS, but it delivers " +
        "ONLY to the address the Resend account was opened with — everyone else gets " +
        "nothing, and the send still reports success.",
  ].filter(Boolean) as string[];

  return c.json({
    data: {
      ...config,
      // Send a test message to find out for certain. Named here so the answer
      // to "how do I check?" is in the same response as the question.
      verifyWith: "POST /api/admin/email-health/test { to }",
      warnings,
    },
  });
});

const emailTestSchema = z.object({
  to: z.email("Enter the address to send the test message to"),
});

/**
 * POST /api/admin/email-health/test
 *
 * Sends a real message and reports exactly what the provider said.
 *
 * Superadmin only: it spends the mail quota and it can be pointed at any
 * address. Everything above is inference; this is the answer.
 */
adminRouter.post("/email-health/test", zValidator("json", emailTestSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "email.test");
  if (denied) return c.json(denied, { status: 403 });

  const { to } = c.req.valid("json");
  const result = await trySendingEmail(to);

  createActivityLog(
    "email_health_test",
    session.adminId,
    session.username,
    "system",
    undefined,
    `Sent a mail check to ${to} — ${result.ok ? "accepted" : result.code}`
  );

  if (result.ok) {
    return c.json({
      sent: true,
      to,
      from: emailConfiguration().from,
      note: "The provider accepted it. If it does not arrive, check spam and the provider's own dashboard.",
    });
  }

  return c.json(
    {
      sent: false,
      to,
      code: result.code,
      // The provider's own words, verbatim. This is the sentence that names the
      // problem — an unverified sending domain says so here and nowhere else.
      detail: result.detail,
    },
    result.code === "email_not_configured" ? 503 : 502
  );
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
  const denied = await requireCapability(session.role, "analytics.view");
  if (denied) return c.json(denied, { status: 403 });

  try {
    // ONE DEFINITION OF "A USER", SHARED WITH THE B2B DASHBOARD.
    //
    // This used to be a bare prisma.user.count() — every row in the User
    // table. That database has been shared with another project, so the number
    // included accounts that never signed up here, and the same platform
    // reported 51 users on one dashboard and 1 on another. A user is an account
    // somebody can sign in with, which means it has a credential row; the raw
    // row count still appears, labelled as such, on the storage-health card,
    // because durability is the one question it actually answers.
    //
    // VOTES COME FROM BOTH TABLES. Everything cast today lands in
    // GovernmentReferenceVote; the legacy Vote table stopped taking rows when
    // both clients dropped /api/bills/:id/vote. Reading only the old one froze
    // this figure — and froze "active today" with it, so a busy day showed
    // nobody at all.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      userCount,
      postCount,
      commentCount,
      legacyVoteCount,
      referenceVoteCount,
      postsToday,
      legacyVotesToday,
      referenceVotesToday,
    ] = await Promise.all([
      prisma.user.count({ where: { accounts: { some: { providerId: "credential" } } } }),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.vote.count(),
      prisma.governmentReferenceVote.count(),
      prisma.post.findMany({
        where: { createdAt: { gte: today } },
        select: { authorId: true },
      }),
      prisma.vote.findMany({
        where: { createdAt: { gte: today } },
        select: { userId: true },
      }),
      prisma.governmentReferenceVote.findMany({
        where: { createdAt: { gte: today } },
        select: { userId: true },
      }),
    ]);

    const voteCount = legacyVoteCount + referenceVoteCount;

    const activeUserIds = new Set([
      ...postsToday.map((p) => p.authorId),
      ...legacyVotesToday.map((v) => v.userId),
      ...referenceVotesToday.map((v) => v.userId),
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
      prisma.user.count({ where: { role: { in: await consoleRoleSlugs() } } }),
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
  const denied = await requireCapability(session.role, "analytics.view");
  if (denied) return c.json(denied, { status: 403 });

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
  const denied = await requireCapability(session.role, "analytics.view");
  if (denied) return c.json(denied, { status: 403 });

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
  const denied = await requireCapability(session.role, "logs.view");
  if (denied) return c.json(denied, { status: 403 });

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

  const denied = await requireCapability(session.role, "announcements.write");
  if (denied) return c.json(denied, { status: 403 });

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
 * vote belongs to. Same bar as merging by hand, and now literally the same
 * check — "merges.decide". Reading the queue is open to anybody who can sign
 * into the console.
 */
adminRouter.use("/reference-merges", mergeQueueAuth);
adminRouter.use("/reference-merges/*", mergeQueueAuth);

async function mergeQueueAuth(c: Context<{ Variables: { adminSession: AdminSession } }>, next: Next) {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  // Reading the queue is part of looking after content; deciding a merge moves
  // real votes between records, so only that half needs the capability.
  if (c.req.method !== "GET") {
    const denied = await requireCapability(session.role, "merges.decide");
    if (denied) return c.json(denied, { status: 403 });
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
  // FOR A PAIR WITH NO GOVERNMENT LINEAGE.
  //
  // A bill pair carries congress.gov's own label and a named analyst. Two
  // executive orders claiming one number carry neither — the government
  // publishes no relationship between presidential documents — so a reviewer
  // needs the facts that are actually available: when each was signed, whether
  // one is still waiting on its number, and whether the two texts are the same
  // document once formatting is normalised.
  signedDate: true,
  numberStatus: true,
  fullText: true,
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
  signedDate: Date | null;
  numberStatus: string | null;
  fullText: string | null;
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
    signedDate: row.signedDate ? row.signedDate.toISOString().slice(0, 10) : null,
    /** "pending" while an executive order is still waiting on its number. */
    numberStatus: row.numberStatus,
    /*
     * The normalised fingerprint, so the two sides can be compared without
     * shipping two full texts to a browser. Computed rather than read from
     * fullTextHash, which hashes raw bytes: the same order fetched from
     * whitehouse.gov and from the Federal Register differs in whitespace and
     * would look like two documents.
     */
    textFingerprint: row.fullText ? textFingerprint(row.fullText) : null,
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
      // THE THING THAT COULD NOT BE SEEN. A report empanels a jury at the
      // moment it is filed, and on a young platform that jury can seat nobody.
      // Without this the queue showed a case waiting on seven jurors and a
      // case waiting on nobody as the same row.
      jury: {
        select: {
          id: true,
          status: true,
          seats: true,
          panelKind: true,
          verdict: true,
          seatRows: { select: { state: true } },
        },
      },
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
      // Counted from the seat rows rather than asserted, so "0 of 7 filled"
      // is a fact about the case and not a hopeful default.
      jury: r.jury
        ? {
            id: r.jury.id,
            status: r.jury.status,
            seats: r.jury.seats,
            panelKind: r.jury.panelKind,
            verdict: r.jury.verdict,
            filled: r.jury.seatRows.filter(
              (seat) => seat.state !== "lapsed" && seat.state !== "recused",
            ).length,
            voted: r.jury.seatRows.filter((seat) => seat.state === "voted").length,
          }
        : null,
    })),
  });
});

/**
 * POST /api/admin/reports/:id
 * Close a report as actioned or dismissed. Whatever the moderator did about the
 * content — delete it, ban the author, nothing — they did through the existing
 * tools; this records that the report itself is finished with.
 *
 * IT DOES NOT TOUCH THE JURY, and that is deliberate. Article IV §3 gives
 * conduct to a jury of citizens and Article V §3 says no Officer may halt a
 * proceeding. Closing the report here says an administrator has dealt with the
 * safety of it; the jury still reaches its own verdict, and that verdict still
 * stands on the record. Two different questions, answered by two different
 * bodies, neither cancelling the other.
 *
 * THE REPORTER IS TOLD. A jury verdict already notifies them; an administrator
 * closing it did not, so a report handled this way was the one that vanished
 * into silence. Reporting into silence is why people stop reporting.
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

  // Not awaited into the answer: the report is closed whether or not a
  // notification was delivered, and an admin should not see a failure for
  // something that already happened.
  void createNotification(
    report.reporterId,
    NotificationType.REPORT_DECIDED,
    body.status === "actioned" ? "Your report was acted on" : "Your report was closed",
    body.status === "actioned"
      ? "Somebody read the report you filed and took action on it. Thank you for flagging it."
      : "Somebody read the report you filed and found nothing to act on. Thank you for " +
        "flagging it anyway — it is better to be told.",
    { reportId: report.id },
  ).catch((error) => {
    console.error("[admin] could not tell the reporter their report was closed:", error);
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

/**
 * GET /api/admin/articles
 *
 * Every Article V filing — Articles of Impeachment, and Articles of System
 * Reset once that exists — newest first, with who brought it and where the
 * proceeding stands.
 *
 * READ ONLY, AND THAT IS THE WHOLE DESIGN. There is no companion route that
 * cancels, pauses, or overturns a proceeding, at any permission level,
 * including the owner's. Article V is the people's remedy against borrowed
 * power; a remedy the platform can switch off is not a remedy, and a queue with
 * a Dismiss button on it would quietly become one.
 *
 * What an admin CAN do about a filing brought in bad faith is act against the
 * person who brought it, through the ordinary suspend and ban powers — which
 * now genuinely bite on every request. That runs alongside the proceeding
 * rather than stopping it: the right to bring a charge does not belong to the
 * people being charged, and a filer being sanctioned does not make the
 * accusation untrue.
 */
adminRouter.get("/articles", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getAdminFromToken(authHeader);
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "articles.review");
  if (denied) return c.json(denied, { status: 403 });

  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

  const person = { id: true, name: true, username: true, email: true } as const;

  const [filings, total, openCount] = await Promise.all([
    prisma.impeachment.findMany({
      orderBy: { openedAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        status: true,
        grounds: true,
        evidence: true,
        openedAt: true,
        expiresAt: true,
        decidedAt: true,
        suspendedUntil: true,
        leader: { select: person },
        filedBy: { select: person },
        _count: { select: { electors: true } },
      },
    }),
    prisma.impeachment.count(),
    prisma.impeachment.count({ where: { status: "open" } }),
  ]);

  const voteCounts = new Map<string, number>();
  if (filings.length > 0) {
    const grouped = await prisma.impeachmentElector.groupBy({
      by: ["impeachmentId"],
      where: { impeachmentId: { in: filings.map((f) => f.id) }, votedAt: { not: null } },
      _count: { _all: true },
    });
    for (const group of grouped) voteCounts.set(group.impeachmentId, group._count._all);
  }

  // ARTICLES OF SYSTEM RESET, returned as their own list rather than merged
  // into the page above. Only one reset can stand at a time platform-wide, so
  // there are never many, and interleaving two tables into one paginated list
  // would mean a page boundary that silently drops one kind.
  const resets = await prisma.systemReset.findMany({
    orderBy: { openedAt: "desc" },
    take: 50,
  });

  const resetFilers = await prisma.user.findMany({
    where: {
      id: {
        in: resets
          .map((reset) => reset.filedById)
          .filter((id): id is string => !!id),
      },
    },
    select: person,
  });
  const filerById = new Map(resetFilers.map((filer) => [filer.id, filer]));

  return c.json({
    articles: filings.map((filing) => ({
      id: filing.id,
      kind: "impeachment" as const,
      status: filing.status,
      grounds: filing.grounds,
      evidence: filing.evidence,
      accused: filing.leader,
      filedBy: filing.filedBy,
      openedAt: filing.openedAt.toISOString(),
      expiresAt: filing.expiresAt.toISOString(),
      decidedAt: filing.decidedAt?.toISOString() ?? null,
      suspendedUntil: filing.suspendedUntil?.toISOString() ?? null,
      votes: voteCounts.get(filing.id) ?? 0,
      electorCount: filing._count.electors,
    })),
    resets: resets.map((reset) => ({
      id: reset.id,
      kind: "system_reset" as const,
      status: reset.status,
      grounds: reset.grounds,
      evidence: reset.evidence,
      // Null when the filer's account is gone. SystemReset has no foreign key
      // to User on purpose, so this is the honest "we no longer know".
      filedBy: (reset.filedById ? filerById.get(reset.filedById) : null) ?? null,
      openedAt: reset.openedAt.toISOString(),
      expiresAt: reset.expiresAt.toISOString(),
      decidedAt: reset.decidedAt?.toISOString() ?? null,
      executeAfter: reset.executeAfter?.toISOString() ?? null,
      executedAt: reset.executedAt?.toISOString() ?? null,
      revertedAt: reset.revertedAt?.toISOString() ?? null,
      revertedBy: reset.revertedBy,
      eligibleCount: reset.eligibleCount,
    })),
    total,
    openCount,
    limit,
    offset,
    // Said out loud in the payload so a console cannot render an action the
    // server would refuse anyway.
    canStopProceedings: false,
  });
});

/**
 * POST /api/admin/system-reset/:id/undo
 *
 * Put an EXECUTED reset back. Superadmin only, the same bar as undoing a merge.
 *
 * THIS IS NOT A VETO, and the distinction is the whole reason it is allowed to
 * exist. There is no route that stops a proceeding, refuses a result, or keeps
 * a reset from running — this one only ever acts on a reset that has already
 * happened, from a journal written inside the transaction that did it.
 *
 * The tension is real and better named than hidden: an owner who undoes a reset
 * the people voted for has overturned them. It is recorded with their name
 * against it, it is visible, and the people can vote again. The alternative is
 * a bulk delete of every vote on the platform with no way back, which this
 * codebase already decided against when it built the merge journal.
 */
adminRouter.post("/system-reset/:id/undo", async (c) => {
  const session = await getAdminFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid admin token required." }, { status: 401 });
  }
  const denied = await requireCapability(session.role, "systemReset.undo");
  if (denied) return c.json(denied, { status: 403 });

  try {
    const report = await undoSystemReset(c.req.param("id"), session.username);
    return c.json({ undone: report });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Could not undo that reset." },
      400
    );
  }
});
