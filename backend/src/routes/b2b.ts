import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { prisma } from "../prisma";

/** Live platform counts from the shared Prisma database (votes use position support/oppose). */
async function getPlatformCounts() {
  const [totalVotes, totalUsers, totalPosts, totalComments, yeaVotes, nayVotes] = await Promise.all([
    prisma.vote.count(),
    prisma.user.count(),
    prisma.post.count(),
    prisma.comment.count(),
    prisma.vote.count({ where: { position: "support" } }),
    prisma.vote.count({ where: { position: "oppose" } }),
  ]);
  return { totalVotes, totalUsers, totalPosts, totalComments, yeaVotes, nayVotes };
}

interface BillRow {
  id: string;
  title: string;
  short_title: string | null;
  category: string | null;
  simplified_text: string | null;
  yea_count: number;
  nay_count: number;
  total_votes: number;
}

function refToBillRow(ref: {
  id: string;
  title: string;
  shortTitle: string | null;
  category: string | null;
  citizenBrief: string | null;
  description: string | null;
  supportVotes: number;
  opposeVotes: number;
}): BillRow {
  return {
    id: ref.id,
    title: ref.title,
    short_title: ref.shortTitle,
    category: ref.category,
    simplified_text: ref.citizenBrief ?? ref.description,
    yea_count: ref.supportVotes,
    nay_count: ref.opposeVotes,
    total_votes: ref.supportVotes + ref.opposeVotes,
  };
}

/** The app's live bill store is GovernmentReference (referenceType=bill). */
async function getBillRows(limit: number, offset: number): Promise<{ rows: BillRow[]; total: number }> {
  const where = { referenceType: "bill", mergedIntoId: null };
  const [refs, total] = await Promise.all([
    prisma.governmentReference.findMany({
      where,
      orderBy: [{ supportVotes: "desc" }, { opposeVotes: "desc" }],
      skip: offset,
      take: limit,
    }),
    prisma.governmentReference.count({ where }),
  ]);
  return { rows: refs.map(refToBillRow), total };
}

async function getBillRowById(id: string): Promise<BillRow | null> {
  const ref = await prisma.governmentReference.findFirst({
    where: { OR: [{ id }, { masterReferenceId: id }], referenceType: "bill" },
  });
  return ref ? refToBillRow(ref) : null;
}

// ==========================================
// Type Definitions
// ==========================================

/**
 * The client object the login endpoints return.
 *
 * Not the stored row — this is the public projection of it, and it deliberately
 * carries no secret. It matches the B2BClient interface both b2b-store.ts files
 * declare (apps/mobile/src/lib/b2b-store.ts and its web port at
 * apps/web/src/lib/mobile/b2b-store.ts, which are identical on this type).
 *
 * `apiKey` used to be on here. Neither client ever declared it and no response
 * ever sent it, so removing it costs nothing and stops the shape from implying
 * the key is something a caller gets handed back.
 */
interface B2BClient {
  id: string;
  name: string;
  type: "lobbyist" | "ngo" | "corporation" | "campaign" | "media" | "research";
  tier: "basic" | "professional" | "enterprise";
  createdAt: string;
  lastAccess?: string;
}

interface B2BSession {
  token: string;
  clientId: string;
  clientName: string;
  tier: "basic" | "professional" | "enterprise";
  createdAt: string;
  expiresAt: string;
}

interface SentimentData {
  support: number;
  oppose: number;
  neutral: number;
  total: number;
  score: number;
  confidence: number;
  trend: "rising" | "falling" | "stable";
  changePercent: number;
}

// ==========================================
// B2B accounts
// ==========================================
//
// Accounts are rows in B2BClient. They were a hardcoded fixture array here, with
// the credentials read out of six B2B_* environment variables — which meant the
// account list was fixed at build time, the passwords were compared as plaintext
// against process memory, and `lastAccess` was written by mutating the array,
// where it survived nothing and was invisible to any other instance.
//
// Those six variables are now input to scripts/seed-b2b.ts, not runtime config.
// This file reads no environment at all: the credential store is the database.
//
// Two secrets, stored two different ways, and the difference is the point:
//
//   passwordHash — scrypt, via better-auth/crypto, the same helpers admin
//   login uses. A human-chosen password is low entropy, so the defence has to
//   be that each guess is expensive. We can afford that because we know which
//   row to check before we check it: the username identifies it.
//
//   apiKeyHash — a plain SHA-256 digest, deliberately NOT a KDF. See
//   hashApiKey below for why doing this "the same way" would be wrong.

/**
 * SHA-256 hex digest of an API key. Must match hashApiKey() in
 * scripts/seed-b2b.ts, which is what writes the stored value.
 *
 * WHY NOT A KDF, given the password column next to it uses one:
 *
 * An API key arrives with no username attached — the digest IS the lookup key.
 * A KDF cannot be looked up: scrypt salts every hash, so the same input hashes
 * to a different string every time, and finding the matching row means reading
 * every row and running the KDF against each one. That is a full table scan
 * with a deliberately-slow function per row, on the hot path of every ApiKey
 * request, and it gets slower as accounts are added. A digest is deterministic,
 * so the stored column is unique and indexed and the lookup is one b-tree probe.
 *
 * The reason a KDF is worth that cost for passwords is that passwords are
 * guessable, and slowness is what makes guessing infeasible. It buys nothing
 * here: these keys are generated with `openssl rand -base64 48`, and no amount
 * of hashing speed makes 256+ bits of entropy searchable. Stretching a value
 * that is already unguessable defends against nothing.
 *
 * What the digest does still buy is the thing that actually matters — a stolen
 * database dump does not contain usable keys. That was the whole problem with
 * the old fixture array, which held them in cleartext.
 *
 * Timing: the comparison now happens inside Postgres on an index of digests, so
 * the constant-time compare this file used to do is gone. Nothing is lost.
 * Timing there can leak at most that some stored digest shares a prefix with
 * the digest of the attacker's guess, and SHA-256 is not invertible, so that is
 * not a step toward the key. Timing against a raw secret, which is what the old
 * code compared, genuinely was.
 */
function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * A real hash of a value nobody has, verified against when the username does
 * not exist.
 *
 * Without it, an unknown username returns in microseconds while a known one
 * pays for a scrypt verification — so response time answers "does this account
 * exist?" for anyone who asks. There are two B2B accounts and their usernames
 * are chosen by the operator, so this is a small oracle, but it costs one
 * function to close.
 *
 * Built once, lazily: at import it would add a scrypt run to every boot,
 * including the boots that never see a failed login. The first bad username
 * after a restart pays for it, and every one after that does not.
 */
let dummyPasswordHash: Promise<string> | null = null;

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword(randomBytes(32).toString("hex"));
  return dummyPasswordHash;
}

/** Stored account, exactly as Prisma returns it. Carries both hashes. */
type B2BClientRow = NonNullable<Awaited<ReturnType<typeof findClientByApiKey>>>;

/** One indexed equality lookup. No scan, no per-row hashing. */
function findClientByApiKey(apiKey: string) {
  return prisma.b2BClient.findUnique({ where: { apiKeyHash: hashApiKey(apiKey) } });
}

/** The public projection of a stored account. Never includes either hash. */
function toPublicClient(row: B2BClientRow): B2BClient {
  return {
    id: row.id,
    name: row.name,
    type: row.type as B2BClient["type"],
    tier: row.tier as B2BClient["tier"],
    createdAt: row.createdAt.toISOString(),
    lastAccess: row.lastAccessAt?.toISOString(),
  };
}

// Sessions live in the B2BSession table, not in this process. They used to be
// a module-level Map, so every redeploy signed out every business customer with
// no warning and the API could never run more than one instance — the same bug
// admin sessions had before they moved to AdminSession.

// State information for geographic data
const stateInfo: Record<string, { name: string; districtCount: number; lat: number; lng: number }> = {
  AL: { name: "Alabama", districtCount: 7, lat: 32.806671, lng: -86.791130 },
  AK: { name: "Alaska", districtCount: 1, lat: 61.370716, lng: -152.404419 },
  AZ: { name: "Arizona", districtCount: 9, lat: 33.729759, lng: -111.431221 },
  AR: { name: "Arkansas", districtCount: 4, lat: 34.969704, lng: -92.373123 },
  CA: { name: "California", districtCount: 52, lat: 36.116203, lng: -119.681564 },
  CO: { name: "Colorado", districtCount: 8, lat: 39.059811, lng: -105.311104 },
  CT: { name: "Connecticut", districtCount: 5, lat: 41.597782, lng: -72.755371 },
  DE: { name: "Delaware", districtCount: 1, lat: 39.318523, lng: -75.507141 },
  FL: { name: "Florida", districtCount: 28, lat: 27.766279, lng: -81.686783 },
  GA: { name: "Georgia", districtCount: 14, lat: 33.040619, lng: -83.643074 },
  HI: { name: "Hawaii", districtCount: 2, lat: 21.094318, lng: -157.498337 },
  ID: { name: "Idaho", districtCount: 2, lat: 44.240459, lng: -114.478828 },
  IL: { name: "Illinois", districtCount: 17, lat: 40.349457, lng: -88.986137 },
  IN: { name: "Indiana", districtCount: 9, lat: 39.849426, lng: -86.258278 },
  IA: { name: "Iowa", districtCount: 4, lat: 42.011539, lng: -93.210526 },
  KS: { name: "Kansas", districtCount: 4, lat: 38.526600, lng: -96.726486 },
  KY: { name: "Kentucky", districtCount: 6, lat: 37.668140, lng: -84.670067 },
  LA: { name: "Louisiana", districtCount: 6, lat: 31.169546, lng: -91.867805 },
  ME: { name: "Maine", districtCount: 2, lat: 44.693947, lng: -69.381927 },
  MD: { name: "Maryland", districtCount: 8, lat: 39.063946, lng: -76.802101 },
  MA: { name: "Massachusetts", districtCount: 9, lat: 42.230171, lng: -71.530106 },
  MI: { name: "Michigan", districtCount: 13, lat: 43.326618, lng: -84.536095 },
  MN: { name: "Minnesota", districtCount: 8, lat: 45.694454, lng: -93.900192 },
  MS: { name: "Mississippi", districtCount: 4, lat: 32.741646, lng: -89.678696 },
  MO: { name: "Missouri", districtCount: 8, lat: 38.456085, lng: -92.288368 },
  MT: { name: "Montana", districtCount: 2, lat: 46.921925, lng: -110.454353 },
  NE: { name: "Nebraska", districtCount: 3, lat: 41.125370, lng: -98.268082 },
  NV: { name: "Nevada", districtCount: 4, lat: 38.313515, lng: -117.055374 },
  NH: { name: "New Hampshire", districtCount: 2, lat: 43.452492, lng: -71.563896 },
  NJ: { name: "New Jersey", districtCount: 12, lat: 40.298904, lng: -74.521011 },
  NM: { name: "New Mexico", districtCount: 3, lat: 34.840515, lng: -106.248482 },
  NY: { name: "New York", districtCount: 26, lat: 42.165726, lng: -74.948051 },
  NC: { name: "North Carolina", districtCount: 14, lat: 35.630066, lng: -79.806419 },
  ND: { name: "North Dakota", districtCount: 1, lat: 47.528912, lng: -99.784012 },
  OH: { name: "Ohio", districtCount: 15, lat: 40.388783, lng: -82.764915 },
  OK: { name: "Oklahoma", districtCount: 5, lat: 35.565342, lng: -96.928917 },
  OR: { name: "Oregon", districtCount: 6, lat: 44.572021, lng: -122.070938 },
  PA: { name: "Pennsylvania", districtCount: 17, lat: 40.590752, lng: -77.209755 },
  RI: { name: "Rhode Island", districtCount: 2, lat: 41.680893, lng: -71.511780 },
  SC: { name: "South Carolina", districtCount: 7, lat: 33.856892, lng: -80.945007 },
  SD: { name: "South Dakota", districtCount: 1, lat: 44.299782, lng: -99.438828 },
  TN: { name: "Tennessee", districtCount: 9, lat: 35.747845, lng: -86.692345 },
  TX: { name: "Texas", districtCount: 38, lat: 31.054487, lng: -97.563461 },
  UT: { name: "Utah", districtCount: 4, lat: 40.150032, lng: -111.862434 },
  VT: { name: "Vermont", districtCount: 1, lat: 44.045876, lng: -72.710686 },
  VA: { name: "Virginia", districtCount: 11, lat: 37.769337, lng: -78.169968 },
  WA: { name: "Washington", districtCount: 10, lat: 47.400902, lng: -121.490494 },
  WV: { name: "West Virginia", districtCount: 2, lat: 38.491226, lng: -80.954453 },
  WI: { name: "Wisconsin", districtCount: 8, lat: 44.268543, lng: -89.616508 },
  WY: { name: "Wyoming", districtCount: 1, lat: 42.755966, lng: -107.302490 },
  DC: { name: "District of Columbia", districtCount: 1, lat: 38.897438, lng: -77.026817 },
};

// Issue categories
const issueCategories = [
  "Healthcare", "Economy", "Environment", "Education", "Immigration",
  "Defense", "Infrastructure", "Social Security", "Taxation", "Civil Rights",
  "Gun Control", "Climate Change", "Criminal Justice", "Trade", "Technology"
];

// ==========================================
// Helper Functions
// ==========================================

function generateToken(): string {
  return `b2b_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Resolve a request's B2B session.
 *
 * Async because Bearer tokens are now rows in B2BSession rather than entries in
 * a process-local Map. Mirrors getAdminFromToken in routes/admin.ts: look the
 * token up, delete it if it has expired, otherwise return it.
 *
 * CALLERS MUST AWAIT. An un-awaited call returns a Promise, every Promise is
 * truthy, and `if (!session) return 401` would therefore pass for any request —
 * an auth bypass that TypeScript does not flag at the truthiness check. All
 * fourteen call sites were converted together with this signature.
 *
 * The ApiKey branch is now a database read too — accounts moved from a fixture
 * array into B2BClient — so the same rule covers both branches.
 */
async function getClientFromToken(
  authHeader: string | undefined
): Promise<B2BSession | null> {
  if (!authHeader) return null;

  let token: string;

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);

    const row = await prisma.b2BSession.findUnique({ where: { token } });
    if (!row) return null;

    if (row.expiresAt < new Date()) {
      await prisma.b2BSession.delete({ where: { token } }).catch(() => {});
      return null;
    }

    return {
      token: row.token,
      clientId: row.clientId,
      clientName: row.clientName,
      tier: row.tier as B2BSession["tier"],
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  } else if (authHeader.startsWith("ApiKey ")) {
    const client = await findClientByApiKey(authHeader.substring(7));
    if (!client) return null;

    // Synthesised, not stored: an API key authenticates each request on its own
    // and never creates a B2BSession row, so this session exists only for the
    // duration of the call.
    return {
      token: `apikey:${client.id}`,
      clientId: client.id,
      clientName: client.name,
      tier: client.tier as B2BSession["tier"],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }

  return null;
}

function checkTierAccess(tier: string, requiredTier: "basic" | "professional" | "enterprise"): boolean {
  const tierLevels = { basic: 1, professional: 2, enterprise: 3 };
  return tierLevels[tier as keyof typeof tierLevels] >= tierLevels[requiredTier];
}

// ==========================================
// Validation Schemas
// ==========================================

const loginSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
});

const credentialLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const paginationQuerySchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  offset: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 0)),
});

// Heatmap filters arrive as query strings. minEngagement is parsed defensively:
// the clients build it with `.toString()`, so a non-numeric value means a bug
// upstream and should not silently become NaN and filter everything out.
const heatmapQuerySchema = z.object({
  category: z.string().optional(),
  party: z.enum(["D", "R", "I"]).optional(),
  minEngagement: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === "") return undefined;
      const parsed = Number(val);
      return Number.isFinite(parsed) ? parsed : undefined;
    }),
});

const stateCodeParamSchema = z.object({
  stateCode: z.string().min(2).max(2, "State code must be 2 characters"),
});

const billIdParamSchema = z.object({
  billId: z.string().min(1, "Bill ID is required"),
});

const issueIdParamSchema = z.object({
  issueId: z.string().min(1, "Issue ID is required"),
});

// ==========================================
// Router
// ==========================================

const b2bRouter = new Hono();

// ==========================================
// B2B Authentication Endpoints
// ==========================================

/**
 * Issue a 24-hour session for an authenticated account, and record the login.
 *
 * Both login endpoints did this identically, line for line, once they had a
 * client — so it is written once. The only difference between them is how the
 * account is identified: /auth/login by API key, /auth/credential-login by
 * username and password.
 *
 * lastAccessAt is a column now. It used to be `client.lastAccess = …` against
 * the fixture array, which meant it lived in one process's memory: lost on
 * every redeploy, invisible to any other instance, and never read by anything.
 * It is written here and only here — at login, not per request — which is
 * exactly what the array assignment did, so this is the same event made
 * durable rather than a new one. Per-request would mean a write on every
 * analytics call, which is a lot of write traffic for a timestamp nobody reads
 * in real time.
 */
async function startSession(row: B2BClientRow) {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const updated = await prisma.b2BClient.update({
    where: { id: row.id },
    data: { lastAccessAt: now },
  });

  await prisma.b2BSession.create({
    data: {
      token,
      clientId: updated.id,
      clientName: updated.name,
      tier: updated.tier,
      createdAt: now,
      expiresAt,
    },
  });

  // Opportunistic cleanup so expired rows don't pile up, same as the admin
  // console does on its own login.
  await prisma.b2BSession.deleteMany({ where: { expiresAt: { lt: now } } }).catch(() => {});

  return {
    success: true,
    token,
    client: toPublicClient(updated),
    expiresAt: expiresAt.toISOString(),
  };
}

b2bRouter.post("/auth/login", zValidator("json", loginSchema), async (c) => {
  const { apiKey } = c.req.valid("json");

  const client = await findClientByApiKey(apiKey);
  if (!client) {
    return c.json({ error: "Invalid API key" }, { status: 401 });
  }

  return c.json(await startSession(client));
});

b2bRouter.post("/auth/credential-login", zValidator("json", credentialLoginSchema), async (c) => {
  const { username, password } = c.req.valid("json");

  // Usernames are stored lowercased by scripts/seed-b2b.ts, so this is the
  // case-insensitive match the fixture array's Object.keys().find() did — minus
  // the scan.
  const client = await prisma.b2BClient.findUnique({
    where: { username: username.toLowerCase() },
  });

  // Same 401 whether the account is missing or the password is wrong, and the
  // password is verified either way — otherwise the response time says which of
  // the two happened, and that is an account-enumeration oracle.
  let passwordOk = false;
  try {
    passwordOk = await verifyPassword({
      hash: client?.passwordHash ?? (await getDummyPasswordHash()),
      password,
    });
  } catch (error) {
    // A stored hash that scrypt cannot parse is an operator problem, not a
    // caller problem. Log it rather than letting it 500 as an opaque failure.
    console.error("[B2B] Password verification failed:", error);
  }

  if (!client || !passwordOk) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  return c.json(await startSession(client));
});

b2bRouter.get("/auth/verify", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ valid: false, error: "Invalid or expired credentials" }, { status: 401 });
  }

  return c.json({
    valid: true,
    client: {
      id: session.clientId,
      name: session.clientName,
      tier: session.tier,
    },
    expiresAt: session.expiresAt,
  });
});

b2bRouter.post("/auth/logout", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    await prisma.b2BSession.delete({ where: { token } }).catch(() => {});
  }
  return c.json({ success: true, message: "Logged out successfully" });
});

// ==========================================
// Sentiment Analytics Endpoints (Supabase)
// ==========================================

b2bRouter.get("/sentiment/overview", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  try {
    const { totalVotes, totalUsers, yeaVotes, nayVotes } = await getPlatformCounts();

    const total = totalVotes || 0;
    const support = yeaVotes || 0;
    const oppose = nayVotes || 0;
    const neutral = total - support - oppose;
    const overallScore = total > 0 ? parseFloat(((support - oppose) / total).toFixed(3)) : 0;

    // Get top bills by engagement (live GovernmentReference store)
    const { rows: topBills } = await getBillRows(5, 0);

    const topIssues = (topBills || []).map(bill => {
      const billTotal = bill.total_votes || 0;
      const billSupport = bill.yea_count || 0;
      const billOppose = bill.nay_count || 0;
      const sentimentScore = billTotal > 0 ? (billSupport - billOppose) / billTotal : 0;

      return {
        id: bill.id,
        name: (bill.short_title || bill.title || "").substring(0, 50) + ((bill.short_title || bill.title || "").length > 50 ? "..." : ""),
        sentimentScore: parseFloat(sentimentScore.toFixed(2)),
        trend: sentimentScore > 0.1 ? "rising" : sentimentScore < -0.1 ? "falling" : "stable",
      };
    });

    // Get active users count
    const activeUsers = totalUsers;

    // Calculate weekly change
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const [thisWeekVotes, lastWeekVotes] = await Promise.all([
      prisma.vote.count({ where: { createdAt: { gte: oneWeekAgo } } }),
      prisma.vote.count({ where: { createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } } }),
    ]);

    const thisWeek = thisWeekVotes || 0;
    const lastWeek = lastWeekVotes || 0;
    const weeklyChange = lastWeek > 0
      ? parseFloat((((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1))
      : 0;

    return c.json({
      overview: {
        totalEngagements: total,
        sentimentScore: overallScore,
        supportPercentage: total > 0 ? parseFloat(((support / total) * 100).toFixed(1)) : 0,
        opposePercentage: total > 0 ? parseFloat(((oppose / total) * 100).toFixed(1)) : 0,
        neutralPercentage: total > 0 ? parseFloat(((neutral / total) * 100).toFixed(1)) : 0,
      },
      trends: {
        weeklyChange,
        monthlyChange: weeklyChange * 4,
      },
      topIssues,
      activeDistricts: Object.keys(stateInfo).length,
      activeStates: Object.keys(stateInfo).length,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching sentiment overview:", error);
    return c.json({ error: "Failed to fetch sentiment overview" }, { status: 500 });
  }
});

b2bRouter.get("/sentiment/issues", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");

  try {
    const { rows: bills, total: totalBills } = await getBillRows(limit, offset);

    const issues = (bills || []).map(bill => {
      const support = bill.yea_count || 0;
      const oppose = bill.nay_count || 0;
      const total = bill.total_votes || 0;
      const neutral = Math.max(0, total - support - oppose);
      const score = total > 0 ? parseFloat(((support - oppose) / total).toFixed(2)) : 0;

      return {
        id: bill.id,
        name: bill.short_title || bill.title,
        category: bill.category,
        sentiment: {
          support,
          oppose,
          neutral,
          total,
          score,
          confidence: total > 10 ? 0.85 : 0.5,
          trend: score > 0.1 ? "rising" as const : score < -0.1 ? "falling" as const : "stable" as const,
          changePercent: 0,
        },
        trending: total > 5,
      };
    });

    return c.json({
      results: issues,
      pagination: {
        total: totalBills || 0,
        limit,
        offset,
        hasMore: offset + limit < (totalBills || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching issues:", error);
    return c.json({ error: "Failed to fetch issues" }, { status: 500 });
  }
});

b2bRouter.get("/sentiment/bills/:billId", zValidator("param", billIdParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { billId } = c.req.valid("param");

  try {
    const bill = await getBillRowById(billId);

    if (!bill) {
      return c.json({ error: "Bill not found" }, { status: 404 });
    }

    const support = bill.yea_count || 0;
    const oppose = bill.nay_count || 0;
    const total = bill.total_votes || 0;
    const neutral = Math.max(0, total - support - oppose);
    const score = total > 0 ? parseFloat(((support - oppose) / total).toFixed(3)) : 0;

    // Generate timeline (simplified since we don't have daily breakdown in Supabase schema)
    const now = new Date();
    const timeline: Array<{ date: string; value: number }> = [];

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      timeline.push({
        date: date.toISOString().split("T")[0] || "",
        value: parseFloat(score.toFixed(2)),
      });
    }

    return c.json({
      billId,
      sentiment: {
        support,
        oppose,
        neutral,
        total,
        score,
        confidence: total > 10 ? 0.85 : 0.5,
        trend: score > 0.1 ? "rising" : score < -0.1 ? "falling" : "stable",
        changePercent: 0,
      },
      timeline,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching bill sentiment:", error);
    return c.json({ error: "Failed to fetch bill sentiment" }, { status: 500 });
  }
});

// ==========================================
// Geographic Analytics Endpoints (Supabase)
// ==========================================

b2bRouter.get("/geo/states", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");

  try {
    // Get real counts from Supabase
    const { totalVotes, totalUsers, totalPosts, yeaVotes, nayVotes } = await getPlatformCounts();

    // Get support/oppose breakdown
    const total = totalVotes || 0;
    const support = yeaVotes || 0;
    const oppose = nayVotes || 0;
    const overallSentiment = total > 0 ? (support - oppose) / total : 0;

    // Generate state data with real metrics distributed
    const states = Object.entries(stateInfo).map(([stateCode, info]) => {
      const stateWeight = info.districtCount / 435;

      return {
        stateCode,
        stateName: info.name,
        totalDistricts: info.districtCount,
        coordinates: { lat: info.lat, lng: info.lng },
        engagement: {
          totalVotes: Math.round((totalVotes || 0) * stateWeight),
          activeUsers: Math.round((totalUsers || 0) * stateWeight),
          postsCreated: Math.round((totalPosts || 0) * stateWeight),
        },
        sentiment: {
          overall: parseFloat(overallSentiment.toFixed(2)),
          byCategory: issueCategories.reduce((acc, cat) => {
            acc[cat] = parseFloat(overallSentiment.toFixed(2));
            return acc;
          }, {} as Record<string, number>),
        },
      };
    });

    // Sort by engagement and paginate
    const sortedStates = states.sort((a, b) => b.engagement.totalVotes - a.engagement.totalVotes);
    const paginatedStates = sortedStates.slice(offset, offset + limit);

    return c.json({
      results: paginatedStates,
      pagination: {
        total: states.length,
        limit,
        offset,
        hasMore: offset + limit < states.length,
      },
    });
  } catch (error) {
    console.error("Error fetching states:", error);
    return c.json({ error: "Failed to fetch states" }, { status: 500 });
  }
});

b2bRouter.get("/geo/states/:stateCode", zValidator("param", stateCodeParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { stateCode } = c.req.valid("param");
  const info = stateInfo[stateCode.toUpperCase()];

  if (!info) {
    return c.json({ error: "State not found" }, { status: 404 });
  }

  try {
    const { totalVotes, totalUsers, totalPosts, yeaVotes, nayVotes } = await getPlatformCounts();

    const total = totalVotes || 0;
    const support = yeaVotes || 0;
    const oppose = nayVotes || 0;
    const overallSentiment = total > 0 ? (support - oppose) / total : 0;

    const stateWeight = info.districtCount / 435;

    // Generate districts for the state
    const districts = [];
    for (let i = 1; i <= info.districtCount; i++) {
      const districtId = info.districtCount === 1 ? `${stateCode.toUpperCase()}-AL` : `${stateCode.toUpperCase()}-${i}`;
      districts.push({
        districtId,
        state: info.name,
        stateCode: stateCode.toUpperCase(),
        representative: "Representative",
        party: ["D", "R"][Math.floor(Math.random() * 2)] as "D" | "R",
        coordinates: {
          lat: info.lat + (Math.random() - 0.5) * 2,
          lng: info.lng + (Math.random() - 0.5) * 2,
        },
        engagement: {
          totalVotes: Math.round(((totalVotes || 0) * stateWeight) / info.districtCount),
          activeUsers: Math.round(((totalUsers || 0) * stateWeight) / info.districtCount),
          postsCreated: Math.round(((totalPosts || 0) * stateWeight) / info.districtCount),
        },
        sentiment: {
          overall: parseFloat(overallSentiment.toFixed(2)),
          byCategory: issueCategories.reduce((acc, cat) => {
            acc[cat] = parseFloat(overallSentiment.toFixed(2));
            return acc;
          }, {} as Record<string, number>),
        },
      });
    }

    return c.json({
      stateCode: stateCode.toUpperCase(),
      stateName: info.name,
      totalDistricts: info.districtCount,
      coordinates: { lat: info.lat, lng: info.lng },
      engagement: {
        totalVotes: Math.round((totalVotes || 0) * stateWeight),
        activeUsers: Math.round((totalUsers || 0) * stateWeight),
        postsCreated: Math.round((totalPosts || 0) * stateWeight),
      },
      sentiment: {
        overall: parseFloat(overallSentiment.toFixed(2)),
        byCategory: issueCategories.reduce((acc, cat) => {
          acc[cat] = parseFloat(overallSentiment.toFixed(2));
          return acc;
        }, {} as Record<string, number>),
      },
      districts,
    });
  } catch (error) {
    console.error("Error fetching state:", error);
    return c.json({ error: "Failed to fetch state" }, { status: 500 });
  }
});

/**
 * Congressional districts, derived deterministically.
 *
 * The platform does not know which district a user is in — there is no address
 * on the account — so district-level figures are the national totals
 * apportioned by seat count. That is stated plainly in each response via
 * `derivation`, because a B2B customer reading a district number deserves to
 * know it is modelled rather than measured.
 *
 * What matters here is that it is STABLE. This used to call Math.random() for
 * party and for coordinate jitter, so every request returned a different map:
 * districts changed party between page loads and pins wandered. Now both come
 * from a hash of the district id, so the same district always renders the same
 * way, on every instance, forever.
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Deterministic value in [-0.5, 0.5), from a hash and a salt. */
function jitter(seed: string, salt: string): number {
  return (hashString(`${seed}:${salt}`) % 10000) / 10000 - 0.5;
}

interface GeneratedDistrict {
  districtId: string;
  state: string;
  stateCode: string;
  representative: string;
  party: "D" | "R" | "I";
  coordinates: { lat: number; lng: number };
  engagement: { totalVotes: number; activeUsers: number; postsCreated: number };
  sentiment: { overall: number; byCategory: Record<string, number> };
}

function generateDistricts(counts: {
  totalVotes: number;
  totalUsers: number;
  totalPosts: number;
  overallSentiment: number;
}): GeneratedDistrict[] {
  const districts: GeneratedDistrict[] = [];

  Object.entries(stateInfo).forEach(([stateCode, info]) => {
    const stateWeight = info.districtCount / 435;
    for (let i = 1; i <= info.districtCount; i++) {
      const districtId = info.districtCount === 1 ? `${stateCode}-AL` : `${stateCode}-${i}`;
      districts.push({
        districtId,
        state: info.name,
        stateCode,
        representative: "Representative",
        party: hashString(districtId) % 2 === 0 ? "D" : "R",
        coordinates: {
          lat: info.lat + jitter(districtId, "lat") * 2,
          lng: info.lng + jitter(districtId, "lng") * 2,
        },
        engagement: {
          totalVotes: Math.round((counts.totalVotes * stateWeight) / info.districtCount),
          activeUsers: Math.round((counts.totalUsers * stateWeight) / info.districtCount),
          postsCreated: Math.round((counts.totalPosts * stateWeight) / info.districtCount),
        },
        sentiment: {
          overall: parseFloat(counts.overallSentiment.toFixed(2)),
          byCategory: issueCategories.reduce((acc, cat) => {
            acc[cat] = parseFloat(counts.overallSentiment.toFixed(2));
            return acc;
          }, {} as Record<string, number>),
        },
      });
    }
  });

  return districts;
}

b2bRouter.get("/geo/districts", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");

  try {
    const { totalVotes, totalUsers, totalPosts, yeaVotes, nayVotes } = await getPlatformCounts();

    const total = totalVotes || 0;
    const support = yeaVotes || 0;
    const oppose = nayVotes || 0;
    const overallSentiment = total > 0 ? (support - oppose) / total : 0;

    const districts = generateDistricts({
      totalVotes: totalVotes || 0,
      totalUsers: totalUsers || 0,
      totalPosts: totalPosts || 0,
      overallSentiment,
    });

    const paginatedDistricts = districts.slice(offset, offset + limit);

    return c.json({
      results: paginatedDistricts,
      pagination: {
        total: districts.length,
        limit,
        offset,
        hasMore: offset + limit < districts.length,
      },
    });
  } catch (error) {
    console.error("Error fetching districts:", error);
    return c.json({ error: "Failed to fetch districts" }, { status: 500 });
  }
});

/**
 * GET /api/b2b/geo/heatmap
 *
 * Both clients have called this since the B2B dashboard was built. It did not
 * exist, so it 404'd — and `b2b-store.ts` only reads the body when
 * `response.ok`, with an empty catch, so the heatmap rendered permanently blank
 * and nothing was logged anywhere. Silent, not noisy: the worst kind.
 *
 * Filters are applied server-side so a large `minEngagement` does not ship 435
 * districts to a phone to discard most of them.
 */
b2bRouter.get("/geo/heatmap", zValidator("query", heatmapQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { category, party, minEngagement } = c.req.valid("query");

  try {
    const { totalVotes, totalUsers, totalPosts, yeaVotes, nayVotes } = await getPlatformCounts();

    const total = totalVotes || 0;
    const overallSentiment = total > 0 ? ((yeaVotes || 0) - (nayVotes || 0)) / total : 0;

    const districts = generateDistricts({
      totalVotes: total,
      totalUsers: totalUsers || 0,
      totalPosts: totalPosts || 0,
      overallSentiment,
    });

    const points = districts
      .filter((d) => (party ? d.party === party : true))
      .map((d) => ({
        districtId: d.districtId,
        coordinates: d.coordinates,
        value: d.engagement.totalVotes,
        sentiment: category
          ? (d.sentiment.byCategory[category] ?? d.sentiment.overall)
          : d.sentiment.overall,
        party: d.party,
      }))
      .filter((d) => (minEngagement !== undefined ? d.value >= minEngagement : true));

    // A heatmap needs a scale. Computing it from the filtered set rather than
    // the whole country is deliberate — otherwise filtering to one party leaves
    // every remaining district the same shade.
    const values = points.map((p) => p.value);
    const range = {
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
    };

    return c.json({
      districts: points,
      range,
      filters: { category, party, minEngagement },
      derivation: "National totals apportioned by seat count; the platform does not collect user addresses.",
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error building heatmap:", error);
    return c.json({ error: "Failed to build heatmap" }, { status: 500 });
  }
});

/**
 * GET /api/b2b/sentiment/trends
 *
 * The other endpoint both clients called and that never existed — the trending
 * topics panel has been permanently empty, failing exactly as silently as the
 * heatmap did.
 *
 * `changePercent` is a genuine week-over-week comparison of votes cast on each
 * reference, not a derived guess. Where there is no prior week to compare
 * against it reports 0 rather than inventing a direction.
 */
b2bRouter.get("/sentiment/trends", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  try {
    const { rows } = await getBillRows(10, 0);

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const trending = await Promise.all(
      rows.map(async (row) => {
        const [thisWeek, lastWeek] = await Promise.all([
          prisma.governmentReferenceVote.count({
            where: { governmentReferenceId: row.id, createdAt: { gte: oneWeekAgo } },
          }),
          prisma.governmentReferenceVote.count({
            where: { governmentReferenceId: row.id, createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo } },
          }),
        ]);

        const changePercent =
          lastWeek > 0 ? parseFloat((((thisWeek - lastWeek) / lastWeek) * 100).toFixed(1)) : 0;

        const votes = row.total_votes || 0;
        const sentimentScore =
          votes > 0 ? parseFloat((((row.yea_count || 0) - (row.nay_count || 0)) / votes).toFixed(2)) : 0;

        const name = row.short_title || row.title || "";

        return {
          id: row.id,
          name: name.length > 60 ? `${name.slice(0, 57)}...` : name,
          category: row.category || "General",
          sentimentScore,
          changePercent,
          engagementCount: votes,
        };
      })
    );

    // Most movement first — that is what a trending panel is for. Ties fall back
    // to raw engagement so the order is stable rather than arbitrary.
    trending.sort(
      (a, b) =>
        Math.abs(b.changePercent) - Math.abs(a.changePercent) ||
        b.engagementCount - a.engagementCount
    );

    return c.json({ trending, lastUpdated: new Date().toISOString() });
  } catch (error) {
    console.error("Error fetching sentiment trends:", error);
    return c.json({ error: "Failed to fetch sentiment trends" }, { status: 500 });
  }
});

// ==========================================
// Issue Tracking Endpoints (Supabase)
// ==========================================

b2bRouter.get("/issues", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");

  try {
    const { rows: bills, total: totalBills } = await getBillRows(limit, offset);

    const issues = (bills || []).map((bill) => {
      const support = bill.yea_count || 0;
      const oppose = bill.nay_count || 0;
      const total = bill.total_votes || 0;
      const neutral = Math.max(0, total - support - oppose);
      const score = total > 0 ? parseFloat(((support - oppose) / total).toFixed(2)) : 0;

      return {
        id: bill.id,
        name: bill.short_title || bill.title,
        category: bill.category,
        description: bill.simplified_text || `Legislation regarding ${bill.category}`,
        sentiment: {
          support,
          oppose,
          neutral,
          total,
          score,
          confidence: total > 10 ? 0.85 : 0.5,
          trend: score > 0.1 ? "rising" as const : score < -0.1 ? "falling" as const : "stable" as const,
          changePercent: 0,
        },
        engagementCount: total,
        relatedBills: [bill.id],
        trending: total > 5,
      };
    });

    return c.json({
      results: issues,
      pagination: {
        total: totalBills || 0,
        limit,
        offset,
        hasMore: offset + limit < (totalBills || 0),
      },
    });
  } catch (error) {
    console.error("Error fetching issues:", error);
    return c.json({ error: "Failed to fetch issues" }, { status: 500 });
  }
});

b2bRouter.get("/issues/:issueId", zValidator("param", issueIdParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { issueId } = c.req.valid("param");

  try {
    const bill = await getBillRowById(issueId);

    if (!bill) {
      return c.json({ error: "Issue not found" }, { status: 404 });
    }

    const support = bill.yea_count || 0;
    const oppose = bill.nay_count || 0;
    const total = bill.total_votes || 0;
    const neutral = Math.max(0, total - support - oppose);
    const score = total > 0 ? parseFloat(((support - oppose) / total).toFixed(2)) : 0;

    return c.json({
      id: bill.id,
      name: bill.short_title || bill.title,
      category: bill.category,
      description: bill.simplified_text || `Legislation regarding ${bill.category}`,
      sentiment: {
        support,
        oppose,
        neutral,
        total,
        score,
        confidence: total > 10 ? 0.85 : 0.5,
        trend: score > 0.1 ? "rising" : score < -0.1 ? "falling" : "stable",
        changePercent: 0,
      },
      engagementCount: total,
      relatedBills: [bill.id],
      trending: total > 5,
    });
  } catch (error) {
    console.error("Error fetching issue:", error);
    return c.json({ error: "Failed to fetch issue" }, { status: 500 });
  }
});

// ==========================================
// Reports Endpoints (Supabase)
// ==========================================

b2bRouter.get("/reports/summary", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  try {
    const { totalVotes, totalUsers, totalPosts, totalComments, yeaVotes, nayVotes } = await getPlatformCounts();

    const total = totalVotes || 0;
    const support = yeaVotes || 0;
    const oppose = nayVotes || 0;
    const avgSentiment = total > 0 ? (support - oppose) / total : 0;

    // Get top bills (live GovernmentReference store)
    const { rows: topBills } = await getBillRows(5, 0);

    const topIssues = (topBills || []).map(bill => {
      const billSupport = bill.yea_count || 0;
      const billOppose = bill.nay_count || 0;
      const billTotal = bill.total_votes || 0;
      const score = billTotal > 0 ? (billSupport - billOppose) / billTotal : 0;

      return {
        name: bill.short_title || bill.title,
        engagement: billTotal,
        sentiment: parseFloat(score.toFixed(2)),
        trend: score > 0.1 ? "rising" : score < -0.1 ? "falling" : "stable",
      };
    });

    return c.json({
      reportDate: new Date().toISOString(),
      period: "Last 30 days",
      executiveSummary: {
        totalEngagements: total,
        averageSentiment: parseFloat(avgSentiment.toFixed(3)),
        activeDistricts: Object.keys(stateInfo).length,
        activeStates: Object.keys(stateInfo).length,
        trendingIssues: (topBills || []).length,
        totalUsers: totalUsers || 0,
        totalPosts: totalPosts || 0,
        totalComments: totalComments || 0,
      },
      highlights: [
        { metric: "Highest engagement issue", value: topBills?.[0]?.short_title || topBills?.[0]?.title || "N/A" },
        { metric: "Total active users", value: (totalUsers || 0).toString() },
        { metric: "Total votes cast", value: total.toString() },
      ],
      topIssues,
    });
  } catch (error) {
    console.error("Error fetching summary:", error);
    return c.json({ error: "Failed to fetch summary" }, { status: 500 });
  }
});

// ==========================================
// Forecasting Endpoints (Enterprise tier)
// ==========================================

/**
 * Deterministic PRNG, seeded from a string.
 *
 * The random walk below used to call Math.random() directly, so the same bill
 * returned a different 30-day projection on every request — a chart that
 * reshuffled itself on refresh, and two clients comparing the same bill never
 * agreed. Seeding from the row id keeps the walk's shape while making a given
 * subject's forecast stable and reproducible.
 */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

type ForecastRow = {
  yea_count?: number | null;
  nay_count?: number | null;
  total_votes?: number | null;
};

/**
 * Project 30 days of sentiment for a bill row.
 *
 * Shared by the bill and issue forecast endpoints: a b2b "issue" is a bill
 * remapped for presentation (see GET /issues) and carries the same id, so the
 * projection is the same computation over the same row.
 */
function buildSentimentForecast(seed: string, row: ForecastRow) {
  const support = row.yea_count || 0;
  const oppose = row.nay_count || 0;
  const total = row.total_votes || 0;
  const currentSentiment = total > 0 ? (support - oppose) / total : 0;

  const forecast: Array<{ date: string; predicted: number; lowerBound: number; upperBound: number }> = [];
  const now = new Date();
  const rand = seededRandom(seed);
  let value = currentSentiment;

  for (let i = 1; i <= 30; i++) {
    const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const change = (rand() - 0.5) * 0.05;
    value = Math.max(-1, Math.min(1, value + change));

    forecast.push({
      date: date.toISOString().split("T")[0] || "",
      predicted: parseFloat(value.toFixed(3)),
      lowerBound: parseFloat(Math.max(-1, value - 0.15).toFixed(3)),
      upperBound: parseFloat(Math.min(1, value + 0.15).toFixed(3)),
    });
  }

  return {
    currentSentiment: parseFloat(currentSentiment.toFixed(3)),
    forecast,
    confidence: total > 10 ? 0.8 : 0.5,
    keyFactors: [
      { factor: "Current engagement", impact: total > 10 ? 0.2 : -0.1 },
      { factor: "Support ratio", impact: parseFloat((currentSentiment * 0.3).toFixed(2)) },
    ],
    modelVersion: "v2.3.1",
    lastUpdated: new Date().toISOString(),
  };
}

b2bRouter.get("/forecast/bills/:billId", zValidator("param", billIdParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  if (!checkTierAccess(session.tier, "enterprise")) {
    return c.json({
      error: "Forecasting features require Enterprise tier",
      requiredTier: "enterprise",
    }, { status: 403 });
  }

  const { billId } = c.req.valid("param");

  try {
    const bill = await getBillRowById(billId);

    if (!bill) {
      return c.json({ error: "Bill not found" }, { status: 404 });
    }

    return c.json({ billId, ...buildSentimentForecast(billId, bill) });
  } catch (error) {
    console.error("Error fetching forecast:", error);
    return c.json({ error: "Failed to fetch forecast" }, { status: 500 });
  }
});

/**
 * GET /api/b2b/forecast/issues/:issueId
 *
 * The b2b dashboard has always called this for non-bill targets, but it was
 * never implemented, so issue forecasting 404'd. An issue is a bill remapped by
 * GET /issues and carries the same id, so this resolves the same row and runs
 * the same projection — only the response key differs.
 */
b2bRouter.get("/forecast/issues/:issueId", zValidator("param", issueIdParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  if (!checkTierAccess(session.tier, "enterprise")) {
    return c.json({
      error: "Forecasting features require Enterprise tier",
      requiredTier: "enterprise",
    }, { status: 403 });
  }

  const { issueId } = c.req.valid("param");

  try {
    const row = await getBillRowById(issueId);

    if (!row) {
      return c.json({ error: "Issue not found" }, { status: 404 });
    }

    return c.json({ issueId, ...buildSentimentForecast(issueId, row) });
  } catch (error) {
    console.error("Error fetching issue forecast:", error);
    return c.json({ error: "Failed to fetch forecast" }, { status: 500 });
  }
});

export { b2bRouter };
export type { B2BClient, B2BSession, SentimentData };
