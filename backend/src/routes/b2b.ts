import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { verifyPasswordOrDummy } from "../password-check";
import { generateB2BToken } from "../session-token";
import { trajectory } from "../services/forecast";
import {
  MIN_COHORT,
  aggregate,
  coverage,
  districtReports,
  listStates,
  pulseByState,
} from "../services/jurisdiction";
import {
  B2B_MEMBER_PUBLIC_FIELDS,
  createB2BMember,
  generateApiKey,
  generatePassword,
  hashApiKey,
  rotateB2BCredentials,
  setB2BMemberPassword,
  type B2BMemberPublicRow,
} from "../services/credentials";

/**
 * What a paying client is told about participation here.
 *
 * TWO THINGS THIS USED TO GET WRONG, both of which understate or overstate
 * real participation to somebody buying it.
 *
 * 1. IT COUNTED ROWS, NOT PEOPLE. `prisma.user.count()` is every row in the
 *    User table. This database has been shared with another project, so that
 *    includes accounts that never signed up here — which is why this endpoint
 *    reported 51 while the admin portal, which asks a narrower question,
 *    reported 1. A client paying for reach was being shown a number nobody
 *    could reproduce. PARTICIPANTS is the same definition the admin portal's
 *    `realAccounts` uses: an account somebody can sign in with, meaning it has
 *    a credential row. One definition, two dashboards, no disagreement.
 *
 * 2. IT READ THE WRONG VOTE TABLE. Every vote a citizen casts today lands in
 *    GovernmentReferenceVote; the legacy Vote table has taken no new rows since
 *    the clients stopped calling /api/bills/:id/vote, and both apps deleted
 *    those hooks. So the vote totals sold here were frozen at whatever they
 *    were on that day. Both are counted now: the old rows are real votes people
 *    really cast, and dropping them would lose history.
 *
 * There is no filter for synthetic accounts, deliberately. The synthetic
 * citizens used for load work live in their own database and never in this one,
 * which is the whole reason they are built that way: a filter is something one
 * query eventually forgets, and a row that is not there cannot be counted.
 */
async function getPlatformCounts() {
  const [
    legacyVotes,
    referenceVotes,
    totalUsers,
    totalPosts,
    totalComments,
    legacyYea,
    legacyNay,
    referenceYea,
    referenceNay,
  ] = await Promise.all([
    prisma.vote.count(),
    prisma.governmentReferenceVote.count(),
    prisma.user.count({ where: { accounts: { some: { providerId: "credential" } } } }),
    prisma.post.count(),
    prisma.comment.count(),
    prisma.vote.count({ where: { position: "support" } }),
    prisma.vote.count({ where: { position: "oppose" } }),
    prisma.governmentReferenceVote.count({ where: { position: "support" } }),
    prisma.governmentReferenceVote.count({ where: { position: "oppose" } }),
  ]);

  return {
    totalVotes: legacyVotes + referenceVotes,
    totalUsers,
    totalPosts,
    totalComments,
    yeaVotes: legacyYea + referenceYea,
    nayVotes: legacyNay + referenceNay,
  };
}

/**
 * Support and opposition, per branch of government, actually counted.
 *
 * WHAT THIS REPLACES. Both dashboards showed a legislative / executive /
 * judicial breakdown that did not exist: the client took the one national
 * total and multiplied it by 0.4, 0.35 and 0.25. Those three numbers were
 * written once by somebody who needed the chart to have three bars, and every
 * business that has looked at this dashboard has been reading them as
 * measurements. A number nobody measured, shown to somebody paying for
 * measurements, is the worst thing this product can do.
 *
 * It is a real question with a real answer, and a cheap one. Every vote lands
 * on a GovernmentReference, and every reference knows which branch it belongs
 * to, so this is one grouped count.
 *
 * The legacy Vote table has no branch — it predates GovernmentReference and its
 * rows are all bills — so its counts are added to the legislative side, where
 * they honestly belong, rather than being dropped or spread.
 */
type BranchKey = "legislative" | "executive" | "judicial";

const BRANCH_OF_REFERENCE: Record<string, BranchKey> = {
  bill: "legislative",
  executive_order: "executive",
  scotus_case: "judicial",
};

async function getBranchCounts(): Promise<Record<BranchKey, { support: number; oppose: number }>> {
  const empty = () => ({ support: 0, oppose: 0 });
  const branches: Record<BranchKey, { support: number; oppose: number }> = {
    legislative: empty(),
    executive: empty(),
    judicial: empty(),
  };

  const [rows, legacySupport, legacyOppose] = await Promise.all([
    prisma.$queryRaw<{ referenceType: string; position: string; count: bigint }[]>`
      SELECT r."referenceType", v."position", COUNT(*)::bigint AS count
      FROM "GovernmentReferenceVote" v
      JOIN "GovernmentReference" r ON r."id" = v."governmentReferenceId"
      GROUP BY r."referenceType", v."position"
    `,
    prisma.vote.count({ where: { position: "support" } }),
    prisma.vote.count({ where: { position: "oppose" } }),
  ]);

  for (const row of rows) {
    const branch = BRANCH_OF_REFERENCE[row.referenceType];
    // A reference type nobody has taught this about is skipped rather than
    // guessed at. An uncounted vote is a smaller lie than a miscounted one.
    if (!branch) continue;
    if (row.position === "support") branches[branch].support += Number(row.count);
    if (row.position === "oppose") branches[branch].oppose += Number(row.count);
  }

  branches.legislative.support += legacySupport;
  branches.legislative.oppose += legacyOppose;

  return branches;
}

/**
 * Votes cast in a window, across both tables.
 *
 * Same reason as above: asking only the legacy table produced a "weekly change"
 * of zero forever, because that table has not taken a row in months.
 */
async function votesBetween(from: Date, to?: Date): Promise<number> {
  const createdAt = to ? { gte: from, lt: to } : { gte: from };
  const [legacy, reference] = await Promise.all([
    prisma.vote.count({ where: { createdAt } }),
    prisma.governmentReferenceVote.count({ where: { createdAt } }),
  ]);
  return legacy + reference;
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

/** owner and admin can manage seats. analyst reads the dashboards only. */
type B2BRole = "owner" | "admin" | "analyst";

interface B2BSession {
  token: string;
  clientId: string;
  clientName: string;
  tier: "basic" | "professional" | "enterprise";
  /**
   * Null when the account's own username or an API key was used. That login is
   * the account itself, and it is always an owner — see `roleOf`.
   */
  memberId: string | null;
  memberName: string | null;
  role: B2BRole;
  createdAt: string;
  expiresAt: string;
}

/**
 * A stored session's role.
 *
 * Sessions that predate seats have memberRole NULL, and so does every API-key
 * and account-username login. All of those are the account acting as itself,
 * which is the owner — so NULL reads as "owner" rather than as "no permission".
 * Getting this backwards would sign every existing customer out of their own
 * settings page the moment this deployed.
 */
function roleOf(memberRole: string | null | undefined): B2BRole {
  if (memberRole === "admin") return "admin";
  if (memberRole === "analyst") return "analyst";
  return "owner";
}

/** Managing seats is an owner/admin action. Reading the dashboards is not. */
function canManageSeats(session: B2BSession): boolean {
  return session.role === "owner" || session.role === "admin";
}

/**
 * What a sentiment figure honestly consists of.
 *
 * THREE FIELDS WERE REMOVED FROM EVERY RESPONSE THAT BUILT ONE OF THESE, and
 * they are worth naming because each was shown to a paying customer as a
 * measurement:
 *
 *   confidence — was `total > 10 ? 0.85 : 0.5`. Two literals. The Issues screen
 *   rendered it as "85%", which reads as a statistical confidence level. It was
 *   not derived from a sample size, a variance, or anything else; it was a
 *   number that made the panel look finished. What a reader actually wants from
 *   it is "how many people is this based on", and that is `total`, which is
 *   real and is now what the screens show.
 *
 *   trend — was `score > 0.1 ? "rising" : score < -0.1 ? "falling" : "stable"`,
 *   which is not a trend. It is the current level wearing the word for a
 *   direction: a bill sitting steadily at 70% support was labelled "rising"
 *   forever, having risen nowhere. Movement needs two points in time and
 *   nothing here stored the earlier one.
 *
 *   changePercent — was the literal 0, drawn as "no change". Null now, and the
 *   clients render nothing for null, because "we did not measure this" and "we
 *   measured it and it did not move" are different statements and only one of
 *   them was true.
 *
 * The overview endpoint's weekly and monthly change ARE measured — two windows,
 * counted — and they are still there.
 */
interface SentimentData {
  support: number;
  oppose: number;
  neutral: number;
  total: number;
  score: number;
  confidence?: number;
  trend?: "rising" | "falling" | "stable";
  changePercent: number | null;
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
 * WHY THE API KEY IS A PLAIN SHA-256 DIGEST, given the password column next to
 * it uses a KDF.
 *
 * The function itself lives in services/credentials.ts, with everything else
 * that touches a secret — this file only reads. It used to be defined here AND
 * in the seed script, with a comment in each saying the two must match, which
 * is the kind of agreement that holds right up until it does not.
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
/**
 * THE HARDCODED MAP IS GONE.
 *
 * A 51-row table of state names, seat counts and centre coordinates used to
 * live here. It was the whole basis of the geography: engagement was the
 * national total times `districtCount / 435`, and "how many states are active"
 * was `Object.keys(stateInfo).length` — a number that read 51 on an empty
 * database because it counted rows in this file rather than people.
 *
 * States and districts now come from services/jurisdiction.ts, which reads the
 * congress.gov roster. There is one list of districts in this codebase and it
 * belongs to the government, per Constitution Article III §3.
 */

// Issue categories
/**
 * THE FIXED CATEGORY LIST IS GONE TOO.
 *
 * Fifteen policy areas, hardcoded, used to be stamped onto every state and
 * district with the SAME sentiment score in each — so "California on Healthcare"
 * and "Wyoming on Immigration" were the identical number, because they were the
 * identical number. Categories now come from realCategories(), which reads the
 * categories actually present on stored records, and a per-category Pulse is a
 * real grouped count.
 */

// ==========================================
// Helper Functions
// ==========================================

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
      memberId: row.memberId,
      memberName: row.memberName,
      role: roleOf(row.memberRole),
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
      // The API key belongs to the account, not to any one person at it, so it
      // authenticates as the account: owner, no seat.
      memberId: null,
      memberName: null,
      role: "owner",
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

// --- Settings and seats ----------------------------------------------------
//
// MINIMUM 12 CHARACTERS, everywhere a password is chosen. The admin console
// uses the same floor (routes/admin.ts), and it is checked on the server rather
// than only in the form, because the form is not the only thing that can call
// this.

const B2B_PASSWORD = z.string().min(12, "Password must be at least 12 characters");

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
  newPassword: B2B_PASSWORD,
});

const rotateOwnApiKeySchema = z.object({
  currentPassword: z.string().min(1, "Your current password is required"),
});

const B2B_ROLE = z.enum(["admin", "analyst"]);

const createMemberSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only"),
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Enter a valid email").optional(),
  role: B2B_ROLE.default("analyst"),
  /**
   * Optional. Supplied means an administrator typed it; omitted means generate
   * one. Both are returned exactly once, in the create response, and never
   * again — the column holds a scrypt hash and there is nothing to read back.
   */
  password: B2B_PASSWORD.optional(),
});

const updateMemberSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email("Enter a valid email").nullable().optional(),
  role: B2B_ROLE.optional(),
  disabled: z.boolean().optional(),
});

const setMemberPasswordSchema = z.object({
  /** Omit to have one generated. */
  password: B2B_PASSWORD.optional(),
});

const memberIdParamSchema = z.object({
  memberId: z.string().min(1, "Member ID is required"),
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
async function startSession(
  row: B2BClientRow,
  /**
   * The seat that signed in, when one did. Omitted for the account's own
   * username and for API keys, which are the account acting as itself.
   */
  member?: { id: string; name: string; role: string }
) {
  const token = generateB2BToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const updated = await prisma.b2BClient.update({
    where: { id: row.id },
    data: { lastAccessAt: now },
  });

  // A seat's own last-seen time. Written here for the same reason the account's
  // is: at login, not per request. It is what makes "who has not used this in
  // three months" answerable, which is the question that gets a seat removed.
  if (member) {
    await prisma.b2BMember.update({
      where: { id: member.id },
      data: { lastAccessAt: now },
    });
  }

  await prisma.b2BSession.create({
    data: {
      token,
      clientId: updated.id,
      clientName: updated.name,
      tier: updated.tier,
      memberId: member?.id ?? null,
      memberRole: member?.role ?? null,
      memberName: member?.name ?? null,
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
    member: member ? { id: member.id, name: member.name, role: member.role } : null,
    role: member?.role ?? "owner",
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
  const lookup = username.toLowerCase();

  // TWO KINDS OF LOGIN, ONE BOX. The account's own username signs in as the
  // owner; a seat's username signs in as that person. Both are stored
  // lowercased and both are looked up here, because whoever is typing does not
  // know or care which kind of row they are.
  //
  // Both lookups run regardless of whether the first hits: `await
  // Promise.all` means the response takes the same time either way. Doing them
  // in sequence with an early return would make an account username measurably
  // faster than a seat username, which is a small enumeration oracle for free.
  const [client, member] = await Promise.all([
    prisma.b2BClient.findUnique({ where: { username: lookup } }),
    prisma.b2BMember.findUnique({ where: { username: lookup } }),
  ]);

  // Same 401 whether the account is missing or the password is wrong, and the
  // password is verified either way — otherwise the response time says which of
  // the two happened, and that is an account-enumeration oracle. Shared with
  // the admin console; see src/password-check.ts.
  const hash = client?.passwordHash ?? member?.passwordHash;
  const passwordOk = await verifyPasswordOrDummy(hash, password, "B2B");

  if (!passwordOk) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (client) {
    return c.json(await startSession(client));
  }

  if (!member) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // A withdrawn seat is told the same thing a wrong password is told, and only
  // after the password has been checked. Saying "this account is disabled"
  // confirms the username exists to anyone who guesses it.
  if (member.disabled) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const owner = await prisma.b2BClient.findUnique({ where: { id: member.clientId } });
  if (!owner) {
    // The company the seat belongs to is gone. Nothing to sign in to.
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  return c.json(
    await startSession(owner, { id: member.id, name: member.name, role: member.role })
  );
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
    member: session.memberId
      ? { id: session.memberId, name: session.memberName, role: session.role }
      : null,
    role: session.role,
    canManageSeats: canManageSeats(session),
    expiresAt: session.expiresAt,
  });
});

/**
 * GET /api/b2b/account/security
 *
 * Every change ever made to this account's password or API key: when, and by
 * whom.
 *
 * WHY THE FACT, AND NOT THE LIST. A B2B password changed here once and nobody
 * could account for it. From the desk of the business paying for the dashboard,
 * a working login that stops working for no stated reason is indistinguishable
 * from a breach, and no explanation offered afterwards buys back the week they
 * spent wondering. So this still answers "has anything moved, and when" — that
 * was the question that went unanswered, and it is answered by
 * lastRotatedAt and rotationCount.
 *
 * IT NO LONGER RETURNS THE EVENT LIST. A per-event log of who touched which
 * credential is an audit trail, and an audit trail belongs where it can be
 * scoped to the people entitled to read it — not on a settings page every seat
 * holder can open. The company's own record lives at GET /api/b2b/admin/activity,
 * behind requireSeatAdmin. Taking it out of the response rather than merely
 * hiding the card is the point: a card hidden in the client is one devtools tab
 * from being visible again.
 *
 * services/credentials.ts is still the only thing in this codebase that can
 * change a credential, and it still records every change before it returns.
 * Nothing about what is RECORDED has changed here — only who is handed it.
 */
b2bRouter.get("/account/security", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const [client, events] = await Promise.all([
    prisma.b2BClient.findUnique({
      where: { id: session.clientId },
      select: { username: true, name: true, tier: true, createdAt: true, lastAccessAt: true },
    }),
    // Only the rotations, and only their timestamps: this answers "has anything
    // moved, and when" without carrying the actor or the detail line, neither
    // of which leaves this endpoint any more.
    prisma.adminActivityLog.findMany({
      where: {
        targetType: "system",
        targetId: session.clientId,
        action: "rotate_b2b_client",
      },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  if (!client) {
    return c.json({ error: "Account not found" }, { status: 404 });
  }

  const rotations = events;

  return c.json({
    account: {
      username: client.username,
      name: client.name,
      tier: client.tier,
      createdAt: client.createdAt.toISOString(),
      lastAccessAt: client.lastAccessAt?.toISOString() ?? null,
    },
    credentials: {
      // Null means nothing has ever been rotated — the credentials are the ones
      // issued when the account was created.
      lastRotatedAt: rotations[0]?.createdAt.toISOString() ?? null,
      rotationCount: rotations.length,
    },
    /**
     * NO `history` HERE ANY MORE. The per-event trail — who touched which
     * credential, and when — moved to GET /api/b2b/admin/activity, which is
     * gated by requireSeatAdmin. This endpoint is read by the settings page,
     * which any seat holder can open, and the answer it needs is whether
     * anything moved, not a log of everyone who has ever moved something.
     *
     * The rows are still written by services/credentials.ts, unchanged. What
     * changed is who is handed them.
     */
    auditTrailAt: "GET /api/b2b/admin/activity (owner or admin seats only)",
  });
});

// ==========================================
// Settings: what a client can change about itself
// ==========================================
//
// THE RULE THIS SECTION LIVES UNDER. Nothing in the backend rotates a
// credential on its own — no scheduled refresh, no rotate-on-startup, no
// environment flag that re-keys an account because a deploy happened. Every
// change below is somebody pressing a button and typing their current password
// first. That is the whole difference between a system a business can trust and
// one whose logins stop working for reasons nobody can name.
//
// The writing itself happens in services/credentials.ts, which is the only file
// in the repository allowed to hash a password, and which records who and why
// before it reports success.

/** The seat and account behind the current session, or a 401 response. */
function requireSeatAdmin(session: B2BSession) {
  return canManageSeats(session)
    ? null
    : { error: "Only an owner or admin on this account can manage seats." };
}

/** Never returns a hash. What the seat list shows. */
function toPublicMember(row: B2BMemberPublicRow) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    email: row.email,
    role: row.role,
    disabled: row.disabled,
    lastAccessAt: row.lastAccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * GET /api/b2b/account
 *
 * Everything the settings screen needs in one call: the company, who you are
 * signed in as, and what you are allowed to do.
 */
b2bRouter.get("/account", async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const [client, seatCount] = await Promise.all([
    prisma.b2BClient.findUnique({
      where: { id: session.clientId },
      select: { id: true, username: true, name: true, type: true, tier: true, createdAt: true, lastAccessAt: true },
    }),
    prisma.b2BMember.count({ where: { clientId: session.clientId, disabled: false } }),
  ]);

  if (!client) {
    return c.json({ error: "Account not found" }, { status: 404 });
  }

  const member = session.memberId
    ? await prisma.b2BMember.findUnique({
        where: { id: session.memberId },
        select: B2B_MEMBER_PUBLIC_FIELDS,
      })
    : null;

  return c.json({
    account: {
      id: client.id,
      username: client.username,
      name: client.name,
      type: client.type,
      tier: client.tier,
      createdAt: client.createdAt.toISOString(),
      lastAccessAt: client.lastAccessAt?.toISOString() ?? null,
      // Seats currently able to sign in, plus the account's own login, which is
      // always one and cannot be removed.
      activeSeats: seatCount + 1,
    },
    signedInAs: member
      ? { kind: "member" as const, ...toPublicMember(member) }
      : {
          kind: "account" as const,
          username: client.username,
          name: client.name,
          role: "owner" as const,
        },
    role: session.role,
    canManageSeats: canManageSeats(session),
    // Only the account itself holds an API key. A seat signs in with a password
    // and has nothing to rotate here.
    canRotateApiKey: session.memberId === null,
  });
});

/**
 * POST /api/b2b/account/password
 *
 * Change your own password. Requires the current one — this endpoint is
 * reachable with a live session, and a session left open on an unattended
 * laptop should not be enough to lock its owner out of their own account.
 */
b2bRouter.post("/account/password", zValidator("json", changeOwnPasswordSchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { currentPassword, newPassword } = c.req.valid("json");

  if (session.memberId) {
    const member = await prisma.b2BMember.findUnique({ where: { id: session.memberId } });
    const ok = await verifyPasswordOrDummy(member?.passwordHash, currentPassword, "B2B");
    if (!member || !ok) {
      return c.json({ error: "That is not your current password." }, { status: 401 });
    }

    const { revokedSessions } = await setB2BMemberPassword(member.id, newPassword, {
      actor: { kind: "self", userId: member.id, username: member.username },
      reason: "Seat holder changed their own password from B2B settings",
    });

    // Their other sessions are gone, including this one. Signing the person out
    // of the device they are standing at, on the change they just made, is
    // hostile — so a fresh session is issued to replace it.
    const owner = await prisma.b2BClient.findUnique({ where: { id: member.clientId } });
    if (!owner) {
      return c.json({ error: "Account not found" }, { status: 404 });
    }

    const next = await startSession(owner, {
      id: member.id,
      name: member.name,
      role: member.role,
    });

    return c.json({
      success: true,
      changed: "password",
      // Every device except this one. The one being replaced is not a loss.
      otherSessionsEnded: Math.max(0, revokedSessions - 1),
      token: next.token,
      expiresAt: next.expiresAt,
    });
  }

  const client = await prisma.b2BClient.findUnique({ where: { id: session.clientId } });
  const ok = await verifyPasswordOrDummy(client?.passwordHash, currentPassword, "B2B");
  if (!client || !ok) {
    return c.json({ error: "That is not your current password." }, { status: 401 });
  }

  const { revokedSessions } = await rotateB2BCredentials(
    client.id,
    { password: newPassword },
    {
      actor: { kind: "self", userId: client.id, username: client.username },
      reason: "Account owner changed the account password from B2B settings",
    }
  );

  const next = await startSession(client);

  return c.json({
    success: true,
    changed: "password",
    otherSessionsEnded: Math.max(0, revokedSessions - 1),
    token: next.token,
    expiresAt: next.expiresAt,
  });
});

/**
 * POST /api/b2b/account/api-key
 *
 * Issue a new API key for the account, and invalidate the old one.
 *
 * RETURNED EXACTLY ONCE. The column holds a SHA-256 digest; there is no way to
 * read the key back, by us or by anyone with the database. Owner only: the key
 * authenticates as the whole company, so handing an analyst the ability to mint
 * one would make the seat distinction decorative.
 */
b2bRouter.post("/account/api-key", zValidator("json", rotateOwnApiKeySchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  if (session.memberId !== null) {
    return c.json(
      { error: "The API key belongs to the account. Sign in with the account login to change it." },
      { status: 403 }
    );
  }

  const client = await prisma.b2BClient.findUnique({ where: { id: session.clientId } });
  const ok = await verifyPasswordOrDummy(
    client?.passwordHash,
    c.req.valid("json").currentPassword,
    "B2B"
  );
  if (!client || !ok) {
    return c.json({ error: "That is not your current password." }, { status: 401 });
  }

  const apiKey = generateApiKey();
  await rotateB2BCredentials(
    client.id,
    { apiKey },
    {
      actor: { kind: "self", userId: client.id, username: client.username },
      reason: "Account owner issued a new API key from B2B settings",
    }
  );

  return c.json({
    success: true,
    changed: "apiKey",
    apiKey,
    warning: "Copy this now. It is stored as a digest and cannot be shown again.",
  });
});

// ==========================================
// The account's own admin portal: seats
// ==========================================

/** GET /api/b2b/admin/members — who at this company can sign in. */
b2bRouter.get("/admin/members", async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }
  const denied = requireSeatAdmin(session);
  if (denied) return c.json(denied, { status: 403 });

  const [client, members] = await Promise.all([
    prisma.b2BClient.findUnique({
      where: { id: session.clientId },
      select: { username: true, name: true, lastAccessAt: true },
    }),
    prisma.b2BMember.findMany({
      where: { clientId: session.clientId },
      select: B2B_MEMBER_PUBLIC_FIELDS,
      orderBy: [{ disabled: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  return c.json({
    // Listed alongside the seats and marked, because from the seat list's point
    // of view it is one more login that exists — leaving it out is how somebody
    // concludes there are two ways in when there are three.
    accountLogin: client
      ? {
          username: client.username,
          name: client.name,
          role: "owner" as const,
          lastAccessAt: client.lastAccessAt?.toISOString() ?? null,
          removable: false,
        }
      : null,
    members: members.map(toPublicMember),
    total: members.length,
  });
});

/**
 * POST /api/b2b/admin/members — add a seat.
 *
 * The password is returned once, here, and never again. Supplying one means an
 * administrator typed it; omitting it generates one. Both paths exist because
 * "here is the password I chose for you" and "here is a random one" are both
 * things real administrators do, and forcing the second produces a password
 * that gets pasted into a chat window to be readable.
 */
b2bRouter.post("/admin/members", zValidator("json", createMemberSchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }
  const denied = requireSeatAdmin(session);
  if (denied) return c.json(denied, { status: 403 });

  const body = c.req.valid("json");
  const username = body.username.toLowerCase();

  // Checked against both tables: a seat username and an account username go in
  // the same login box, so a collision between them is a real collision even
  // though the unique index cannot see it.
  const [seatTaken, accountTaken] = await Promise.all([
    prisma.b2BMember.findUnique({ where: { username }, select: { id: true } }),
    prisma.b2BClient.findUnique({ where: { username }, select: { id: true } }),
  ]);
  if (seatTaken || accountTaken) {
    return c.json({ error: "That username is already in use." }, { status: 409 });
  }

  const password = body.password ?? generatePassword();

  const member = await createB2BMember(
    {
      clientId: session.clientId,
      username,
      name: body.name,
      email: body.email ?? null,
      role: body.role,
      password,
    },
    {
      actor: { kind: "admin", adminId: session.memberId ?? session.clientId, username: session.memberName ?? session.clientName },
      reason: `Seat added from the ${session.clientName} B2B admin portal`,
    }
  );

  return c.json({
    success: true,
    member: toPublicMember(member),
    credentials: { username: member.username, password },
    warning: "This password is shown once. It is stored hashed and cannot be recovered.",
  }, { status: 201 });
});

/** PATCH /api/b2b/admin/members/:memberId — name, email, role, access. */
b2bRouter.patch(
  "/admin/members/:memberId",
  zValidator("param", memberIdParamSchema),
  zValidator("json", updateMemberSchema),
  async (c) => {
    const session = await getClientFromToken(c.req.header("Authorization"));
    if (!session) {
      return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
    }
    const denied = requireSeatAdmin(session);
    if (denied) return c.json(denied, { status: 403 });

    const { memberId } = c.req.valid("param");
    const body = c.req.valid("json");

    // Scoped to this account. Without the clientId in the where clause, one
    // company's admin could edit another company's seat by guessing an id.
    const existing = await prisma.b2BMember.findFirst({
      where: { id: memberId, clientId: session.clientId },
    });
    if (!existing) {
      return c.json({ error: "Seat not found on this account" }, { status: 404 });
    }

    if (Object.keys(body).length === 0) {
      return c.json({ error: "Nothing to change" }, { status: 400 });
    }

    const member = await prisma.b2BMember.update({
      where: { id: memberId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.disabled !== undefined ? { disabled: body.disabled } : {}),
      },
      select: B2B_MEMBER_PUBLIC_FIELDS,
    });

    // A role that shrinks, or access withdrawn, has to take effect now rather
    // than whenever their current session happens to expire. Sessions carry a
    // copy of the role, so the only way to make that copy wrong is to delete it.
    const demoted = body.role !== undefined && body.role !== existing.role;
    const revoked =
      demoted || body.disabled === true
        ? (await prisma.b2BSession.deleteMany({ where: { memberId } })).count
        : 0;

    await prisma.adminActivityLog.create({
      data: {
        action: "update_b2b_member",
        adminId: session.memberId ?? session.clientId,
        adminUsername: session.memberName ?? session.clientName,
        targetType: "system",
        targetId: session.clientId,
        details:
          `Updated B2B seat ${member.username}: ` +
          Object.keys(body).join(", ") +
          (revoked ? ` — ${revoked} session(s) ended` : ""),
      },
    }).catch(() => {});

    return c.json({ success: true, member: toPublicMember(member), sessionsEnded: revoked });
  }
);

/**
 * POST /api/b2b/admin/members/:memberId/password
 *
 * An administrator sets a seat's password, typed or generated. Ends that seat's
 * sessions and nobody else's.
 */
b2bRouter.post(
  "/admin/members/:memberId/password",
  zValidator("param", memberIdParamSchema),
  zValidator("json", setMemberPasswordSchema),
  async (c) => {
    const session = await getClientFromToken(c.req.header("Authorization"));
    if (!session) {
      return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
    }
    const denied = requireSeatAdmin(session);
    if (denied) return c.json(denied, { status: 403 });

    const { memberId } = c.req.valid("param");

    const existing = await prisma.b2BMember.findFirst({
      where: { id: memberId, clientId: session.clientId },
      select: { id: true, username: true },
    });
    if (!existing) {
      return c.json({ error: "Seat not found on this account" }, { status: 404 });
    }

    const password = c.req.valid("json").password ?? generatePassword();

    const { member, revokedSessions } = await setB2BMemberPassword(existing.id, password, {
      actor: {
        kind: "admin",
        adminId: session.memberId ?? session.clientId,
        username: session.memberName ?? session.clientName,
      },
      reason: `Password set from the ${session.clientName} B2B admin portal`,
    });

    return c.json({
      success: true,
      member: toPublicMember(member),
      credentials: { username: member.username, password },
      sessionsEnded: revokedSessions,
      warning: "This password is shown once. It is stored hashed and cannot be recovered.",
    });
  }
);

/**
 * DELETE /api/b2b/admin/members/:memberId
 *
 * Removes the seat outright. Disabling is the gentler option and is what the
 * portal offers first — a disabled seat keeps its name, so last month's
 * activity log still resolves to a person. This exists for the case where the
 * row should not have been created at all.
 */
b2bRouter.delete("/admin/members/:memberId", zValidator("param", memberIdParamSchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }
  const denied = requireSeatAdmin(session);
  if (denied) return c.json(denied, { status: 403 });

  const { memberId } = c.req.valid("param");

  const existing = await prisma.b2BMember.findFirst({
    where: { id: memberId, clientId: session.clientId },
    select: { id: true, username: true },
  });
  if (!existing) {
    return c.json({ error: "Seat not found on this account" }, { status: 404 });
  }

  // You cannot remove the seat you are signed in with. Not a safety rail for
  // its own sake: the account login always remains, so an account can never be
  // orphaned — but removing your own seat mid-session produces a live token
  // pointing at a row that is gone, and every request after it 401s with no
  // explanation.
  if (session.memberId === memberId) {
    return c.json({ error: "You cannot remove the seat you are signed in with." }, { status: 400 });
  }

  await prisma.b2BSession.deleteMany({ where: { memberId } });
  await prisma.b2BMember.delete({ where: { id: memberId } });

  await prisma.adminActivityLog.create({
    data: {
      action: "delete_b2b_member",
      adminId: session.memberId ?? session.clientId,
      adminUsername: session.memberName ?? session.clientName,
      targetType: "system",
      targetId: session.clientId,
      details: `Removed B2B seat ${existing.username}`,
    },
  }).catch(() => {});

  return c.json({ success: true, removed: existing.username });
});

/**
 * GET /api/b2b/admin/activity
 *
 * What has happened to this account: seats added, roles changed, credentials
 * moved. Same rows /account/security reads, widened to the seat actions, so the
 * company can answer "who did that" without asking us.
 */
b2bRouter.get("/admin/activity", async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }
  const denied = requireSeatAdmin(session);
  if (denied) return c.json(denied, { status: 403 });

  const events = await prisma.adminActivityLog.findMany({
    where: { targetType: "system", targetId: session.clientId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return c.json({
    events: events.map((event) => ({
      action: event.action,
      at: event.createdAt.toISOString(),
      by: event.adminUsername,
      details: event.details,
    })),
    total: events.length,
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
    const [{ totalVotes, totalUsers, totalPosts, totalComments, yeaVotes, nayVotes }, branches] =
      await Promise.all([getPlatformCounts(), getBranchCounts()]);

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

    // Thirty days, measured, rather than the weekly figure multiplied by four.
    // A month is not four weeks and the votes of the last thirty days are
    // sitting right there — the multiplication was arithmetic standing in for
    // a query nobody had written.
    const oneMonthAgo = new Date();
    oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);

    const [thisWeekVotes, lastWeekVotes, thisMonthVotes, lastMonthVotes] = await Promise.all([
      votesBetween(oneWeekAgo),
      votesBetween(twoWeeksAgo, oneWeekAgo),
      votesBetween(oneMonthAgo),
      votesBetween(twoMonthsAgo, oneMonthAgo),
    ]);

    /**
     * Null, not zero, when there is nothing to compare against.
     *
     * A brand-new platform with no votes last week has an undefined change, not
     * a 0% change, and "0%" on a dashboard reads as "measured, and flat". The
     * clients render nothing for null.
     */
    const percentChange = (now: number, before: number): number | null =>
      before > 0 ? parseFloat((((now - before) / before) * 100).toFixed(1)) : null;

    const weeklyChange = percentChange(thisWeekVotes || 0, lastWeekVotes || 0);
    const monthlyChange = percentChange(thisMonthVotes || 0, lastMonthVotes || 0);

    return c.json({
      overview: {
        totalEngagements: total,
        sentimentScore: overallScore,
        supportPercentage: total > 0 ? parseFloat(((support / total) * 100).toFixed(1)) : 0,
        opposePercentage: total > 0 ? parseFloat(((oppose / total) * 100).toFixed(1)) : 0,
        neutralPercentage: total > 0 ? parseFloat(((neutral / total) * 100).toFixed(1)) : 0,
      },
      // Counted per branch, not apportioned from the national total. See
      // getBranchCounts.
      byBranch: branches,
      engagement: {
        totalVotes: total,
        totalPosts,
        totalComments,
        participants: totalUsers,
      },
      trends: {
        // Null means "not enough history to say", and the clients show nothing
        // rather than a zero that reads as a measurement.
        weeklyChange,
        monthlyChange,
      },
      topIssues,
      /**
       * REMOVED, not replaced: activeDistricts and activeStates.
       *
       * Both were `Object.keys(stateInfo).length` — the number of rows in a
       * hardcoded table of state names and coordinates in this file. It was 51
       * on an empty database and it would be 51 on a busy one, because it never
       * touched a vote. The web and mobile stores read it into "Active Users",
       * which is where the dashboard's 51 came from.
       *
       * There is no honest replacement today. Nothing on User records a state
       * or a district, so how many states are active is a question this
       * database cannot answer — see the note on /geo/states. When it can, it
       * gets counted here. Until then the clients show the participant count,
       * which is real.
       */
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
          // See sentimentFields() below for why confidence, trend and a zero
          // changePercent are gone from every one of these.
          changePercent: null,
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
        changePercent: null,
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

/**
 * THE GEOGRAPHY ENDPOINTS, REBUILT.
 *
 * WHAT THEY USED TO DO. There was no geographic data of any kind, so these took
 * the single national sentiment figure and multiplied it by each state's share
 * of the 435 House seats. Consequences, all of them shipped to paying clients:
 * every state reported the identical sentiment score; every one of fifteen
 * policy categories inside a state reported that same score again; the
 * representative's name was the literal string "Representative"; and the party
 * was `Math.random()`, re-rolled per request, so California's delegation changed
 * when you refreshed the page. Two different district generators existed and
 * disagreed with each other.
 *
 * Constitution Article III §3, enforcedInCode: "Every data point must link back
 * to an official Executive, Legislative, or Judicial source ID to prevent the
 * 'Digital Government' from drifting into fiction."
 *
 * WHAT THEY DO NOW. Districts and representatives come from the congress.gov
 * roster the rest of the app already uses. Counts come from votes cast by people
 * who have told us which district they are in. A place where fewer than
 * MIN_COHORT people have voted reports that fact instead of a number, because
 * "CA-12 is 100% opposed" over one voter is that person's ballot with their
 * address attached — which Bill of Rights Article IV forbids handing to a third
 * party.
 *
 * Every response carries `coverage`, so a client can see the map is drawn from
 * however many people have actually said where they are. A map that implies
 * national reach it does not have is the same lie told more quietly.
 */
b2bRouter.get("/geo/states", zValidator("query", paginationQuerySchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");
  const category = c.req.query("category");

  try {
    const [states, counts, reports, cover] = await Promise.all([
      listStates(),
      pulseByState(category),
      districtReports(category),
      coverage(),
    ]);

    const residentsByState = new Map<string, number>();
    const districtsByState = new Map<string, number>();
    for (const r of reports) {
      residentsByState.set(r.stateCode, (residentsByState.get(r.stateCode) ?? 0) + r.residents);
      districtsByState.set(r.stateCode, (districtsByState.get(r.stateCode) ?? 0) + 1);
    }

    // Only states somebody actually lives in. A row per state regardless would
    // be 51 zeros dressed as coverage.
    const rows = states
      .filter((s) => residentsByState.has(s.stateCode) || counts.has(s.stateCode))
      .map((s) => {
        const c2 = counts.get(s.stateCode) ?? { support: 0, oppose: 0 };
        return {
          stateCode: s.stateCode,
          stateName: s.stateName,
          residents: residentsByState.get(s.stateCode) ?? 0,
          districtsRepresented: districtsByState.get(s.stateCode) ?? 0,
          pulse: aggregate(c2.support, c2.oppose),
        };
      })
      .sort((a, b) => b.residents - a.residents);

    return c.json({
      results: rows.slice(offset, offset + limit),
      coverage: cover,
      category: category ?? null,
      pagination: { total: rows.length, limit, offset, hasMore: offset + limit < rows.length },
    });
  } catch (error) {
    console.error("Error fetching states:", error);
    return c.json({ error: "Failed to fetch states" }, { status: 500 });
  }
});

b2bRouter.get("/geo/states/:stateCode", zValidator("param", stateCodeParamSchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const stateCode = c.req.valid("param").stateCode.toUpperCase();
  const category = c.req.query("category");

  try {
    const [states, reports, counts, cover] = await Promise.all([
      listStates(),
      districtReports(category),
      pulseByState(category),
      coverage(),
    ]);

    const state = states.find((s) => s.stateCode === stateCode);
    if (!state) {
      return c.json({ error: "State not found" }, { status: 404 });
    }

    const districts = reports.filter((r) => r.stateCode === stateCode);
    const own = counts.get(stateCode) ?? { support: 0, oppose: 0 };

    return c.json({
      stateCode,
      stateName: state.stateName,
      pulse: aggregate(own.support, own.oppose),
      residents: districts.reduce((n, d) => n + d.residents, 0),
      districts,
      coverage: cover,
      category: category ?? null,
    });
  } catch (error) {
    console.error("Error fetching state:", error);
    return c.json({ error: "Failed to fetch state" }, { status: 500 });
  }
});

b2bRouter.get("/geo/districts", zValidator("query", paginationQuerySchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { limit, offset } = c.req.valid("query");
  const category = c.req.query("category");

  try {
    const [reports, cover] = await Promise.all([districtReports(category), coverage()]);
    return c.json({
      results: reports.slice(offset, offset + limit),
      coverage: cover,
      category: category ?? null,
      pagination: { total: reports.length, limit, offset, hasMore: offset + limit < reports.length },
    });
  } catch (error) {
    console.error("Error fetching districts:", error);
    return c.json({ error: "Failed to fetch districts" }, { status: 500 });
  }
});

/**
 * GET /api/b2b/geo/heatmap
 *
 * Only districts that clear the floor get a shade. A district with three voices
 * is returned in `suppressed` with its voice count and no sentiment, so the
 * client can show it as "too few to report" rather than as neutral — grey and
 * "we will not say" are different claims, and only one of them is true.
 */
b2bRouter.get("/geo/heatmap", zValidator("query", heatmapQuerySchema), async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { category, party, minEngagement } = c.req.valid("query");

  try {
    const [reports, cover] = await Promise.all([districtReports(category), coverage()]);

    const partyLetter = (name: string | undefined): string | null => {
      if (!name) return null;
      const first = name.trim().charAt(0).toUpperCase();
      return first === "D" || first === "R" || first === "I" ? first : null;
    };

    const matching = reports.filter((r) =>
      party ? partyLetter(r.representative?.party) === party : true,
    );

    const districts = matching
      .filter((r) => r.pulse.enough)
      .map((r) => ({
        districtId: r.districtId,
        stateCode: r.stateCode,
        representative: r.representative,
        party: partyLetter(r.representative?.party),
        value: r.pulse.enough ? r.pulse.voices : 0,
        sentiment: r.pulse.enough ? r.pulse.score : null,
      }))
      .filter((d) => (minEngagement !== undefined ? d.value >= minEngagement : true));

    const values = districts.map((d) => d.value);
    const range = {
      min: values.length > 0 ? Math.min(...values) : 0,
      max: values.length > 0 ? Math.max(...values) : 0,
    };

    return c.json({
      districts,
      suppressed: matching
        .filter((r) => !r.pulse.enough)
        .map((r) => ({ districtId: r.districtId, voices: r.pulse.voices, reason: "not_enough_voices" })),
      range,
      coverage: cover,
      floor: MIN_COHORT,
      filters: { category, party, minEngagement },
      // Says what it is, in the response, so a client integrating against the
      // API learns the limit at the same time as the data.
      derivation:
        "Counted from votes cast by members who told us their district. Districts with fewer than " +
        `${MIN_COHORT} voters are withheld rather than estimated. Nothing is apportioned.`,
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
          // See sentimentFields() below for why confidence, trend and a zero
          // changePercent are gone from every one of these.
          changePercent: null,
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
        changePercent: null,
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

/**
 * GET /api/b2b/reports/export.csv
 *
 * A file that actually arrives.
 *
 * WHAT THIS REPLACES. The Reports screen listed three "Recent Reports" with
 * invented names, dates and statuses, and every Generate button raised a toast
 * saying "your report is being generated, you'll receive an email when it's
 * ready." There was no job, no file, and no mail. A business that clicked it
 * waited for something that was never coming, and the only reason nobody
 * complained is presumably that nobody trusted it enough to wait.
 *
 * This returns the bytes, now, over the same request. No queue to fail
 * silently, no mailer to misconfigure, no status to invent. What a client
 * wanted from "export" was the data, and the data is what they get.
 *
 * IT CONTAINS ONLY WHAT IS MEASURED: one row per record, with the vote counts
 * this platform actually holds. There is no state column, because a vote's
 * geography lives on the voter and is aggregated under a privacy floor —
 * putting it here per-bill would leak exactly what that floor exists to
 * protect.
 */
b2bRouter.get("/reports/export.csv", async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const { rows } = await getBillRows(1000, 0);

  // Quote everything and double any embedded quote. Bill titles contain commas
  // and quotation marks as a matter of course, and a CSV that breaks on the
  // first apostrophe is worse than no export.
  const cell = (value: string | number | null | undefined): string =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const header = [
    "record_id", "title", "category", "support", "oppose", "total_votes", "score",
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    const total = row.total_votes || 0;
    const score = total > 0 ? ((row.yea_count || 0) - (row.nay_count || 0)) / total : 0;
    lines.push(
      [
        cell(row.id),
        cell(row.short_title || row.title),
        cell(row.category),
        cell(row.yea_count || 0),
        cell(row.nay_count || 0),
        cell(total),
        cell(total > 0 ? score.toFixed(3) : ""),
      ].join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ayeandnay-${stamp}.csv"`,
    },
  });
});

/**
 * GET /api/b2b/reports/coverage.csv
 *
 * The geographic export, under the same floor the dashboard uses. Districts
 * below it appear with their voice count and empty opinion columns rather than
 * being omitted — a client reconciling row counts should be able to see that
 * something was withheld, not silently receive a shorter file.
 */
b2bRouter.get("/reports/coverage.csv", async (c) => {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  const reports = await districtReports(c.req.query("category"));

  const cell = (value: string | number | null | undefined): string =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const lines = [
    ["district", "state", "representative", "party", "members", "voices", "support", "oppose", "score", "withheld"].join(","),
  ];

  for (const r of reports) {
    const enough = r.pulse.enough;
    lines.push(
      [
        cell(r.districtId),
        cell(r.stateName),
        cell(r.representative?.name),
        cell(r.representative?.party),
        cell(r.residents),
        cell(r.pulse.voices),
        cell(enough ? r.pulse.support : ""),
        cell(enough ? r.pulse.oppose : ""),
        cell(enough ? r.pulse.score : ""),
        cell(enough ? "no" : `below ${MIN_COHORT}`),
      ].join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ayeandnay-districts-${stamp}.csv"`,
    },
  });
});

b2bRouter.get("/reports/summary", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = await getClientFromToken(authHeader);

  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  try {
    const [{ totalVotes, totalUsers, totalPosts, totalComments, yeaVotes, nayVotes }, cover] =
      await Promise.all([getPlatformCounts(), coverage()]);

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
        // No `trend`. It was the current score wearing the word for a
        // direction — see the note on SentimentData.
      };
    });

    return c.json({
      reportDate: new Date().toISOString(),
      period: "Last 30 days",
      executiveSummary: {
        totalEngagements: total,
        averageSentiment: parseFloat(avgSentiment.toFixed(3)),
        /**
         * MEASURED, not the size of a hardcoded table.
         *
         * These two were `Object.keys(stateInfo).length` — 51, the number of
         * rows in a list of state names that lived in this file. They never
         * touched a vote, so they read 51 on an empty database. The same pair
         * was fixed in /sentiment/overview and missed here, which is what a
         * fabricated constant does: it survives in the copy nobody re-read.
         *
         * districtsRepresented is districts somebody has actually claimed;
         * districtsReportable is those clearing the privacy floor. The gap
         * between them is the honest measure of how much of the map can be
         * spoken about at all.
         */
        districtsRepresented: cover.districtsRepresented,
        districtsReportable: cover.districtsReportable,
        participantsPlaced: cover.placed,
        trendingIssues: (topBills || []).length,
        totalUsers: totalUsers || 0,
        totalPosts: totalPosts || 0,
        totalComments: totalComments || 0,
      },
      coverage: cover,
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
 * THE RANDOM WALK IS GONE.
 *
 * A seeded PRNG used to live here, stepping the current sentiment by
 * `(rand() - 0.5) * 0.05` a day for thirty days, with flat ±0.15 bounds, a
 * `confidence` of 0.8 or 0.5 depending only on whether more than ten people had
 * voted, and `modelVersion: "v2.3.1"` naming a model that did not exist.
 *
 * Seeding it from the bill id had been a real fix — it stopped the chart
 * reshuffling on every refresh — but it made the line stable rather than true,
 * and a stable fiction is the more convincing kind.
 *
 * services/forecast.ts replaces it with the thing that was underneath all
 * along: the Pulse day by day, reconstructed from PositionEvent, which is
 * observed. A projection is fitted to that observed movement and only where
 * there is enough of it. See that file for why the bounds widen with distance
 * and why there is no confidence figure.
 */

/** Shared by both endpoints: an "issue" here is a bill under another name. */
async function trajectoryResponse(c: Context, id: string, key: "billId" | "issueId") {
  const session = await getClientFromToken(c.req.header("Authorization"));
  if (!session) {
    return c.json({ error: "Unauthorized. Valid B2B credentials required." }, { status: 401 });
  }

  if (!checkTierAccess(session.tier, "enterprise")) {
    return c.json(
      { error: "Forecasting features require Enterprise tier", requiredTier: "enterprise" },
      { status: 403 },
    );
  }

  const row = await getBillRowById(id);
  if (!row) {
    return c.json({ error: key === "billId" ? "Bill not found" : "Issue not found" }, { status: 404 });
  }

  const result = await trajectory(row.id);
  const total = row.total_votes || 0;

  return c.json({
    [key]: id,
    currentSentiment:
      total > 0 ? parseFloat((((row.yea_count || 0) - (row.nay_count || 0)) / total).toFixed(3)) : 0,
    // Measured. Always present once anybody has voted.
    history: result.history,
    // What it rests on, so a reader can judge the line rather than trust it.
    basis: result.basis,
    // Null where the history is too short to fit to, with the reason.
    projection: result.projection,
    noProjection: result.noProjection,
    lastUpdated: new Date().toISOString(),
  });
}

b2bRouter.get("/forecast/bills/:billId", zValidator("param", billIdParamSchema), async (c) => {
  try {
    return await trajectoryResponse(c, c.req.valid("param").billId, "billId");
  } catch (error) {
    console.error("Error building trajectory:", error);
    return c.json({ error: "Failed to fetch forecast" }, { status: 500 });
  }
});

/**
 * GET /api/b2b/forecast/issues/:issueId
 *
 * An issue is a bill remapped by GET /issues and carries the same id, so this
 * resolves the same record and runs the same computation. Only the key differs.
 */
b2bRouter.get("/forecast/issues/:issueId", zValidator("param", issueIdParamSchema), async (c) => {
  try {
    return await trajectoryResponse(c, c.req.valid("param").issueId, "issueId");
  } catch (error) {
    console.error("Error building trajectory:", error);
    return c.json({ error: "Failed to fetch forecast" }, { status: 500 });
  }
});

export { b2bRouter };
export type { B2BClient, B2BSession, SentimentData };
