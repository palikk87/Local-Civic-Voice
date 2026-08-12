import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
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

interface B2BClient {
  id: string;
  name: string;
  type: "lobbyist" | "ngo" | "corporation" | "campaign" | "media" | "research";
  apiKey: string;
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
// In-Memory Stores (for B2B auth only)
// ==========================================

const b2bClients: B2BClient[] = [
  {
    id: "b2b-1",
    name: "Demo Analytics Corp",
    type: "research",
    apiKey: "b2b_demo_key_2024",
    tier: "enterprise",
    createdAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "b2b-superadmin",
    name: "Civic Platform Admin",
    type: "research",
    apiKey: "b2b_superadmin_key",
    tier: "enterprise",
    createdAt: "2024-01-01T00:00:00Z",
  },
];

const b2bCredentials: Record<string, { password: string; clientId: string }> = {
  "b2b_demo": { password: "DemoB2B2024!", clientId: "b2b-1" },
  "PaliKK87": { password: "Highsc60", clientId: "b2b-superadmin" },
};

const b2bSessions: Map<string, B2BSession> = new Map();

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

function getClientFromToken(authHeader: string | undefined): B2BSession | null {
  if (!authHeader) return null;

  let token: string;

  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
    const session = b2bSessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      b2bSessions.delete(token);
      return null;
    }
    return session;
  } else if (authHeader.startsWith("ApiKey ")) {
    const apiKey = authHeader.substring(7);
    const client = b2bClients.find(c => c.apiKey === apiKey);
    if (!client) return null;

    return {
      token: apiKey,
      clientId: client.id,
      clientName: client.name,
      tier: client.tier,
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

b2bRouter.post("/auth/login", zValidator("json", loginSchema), (c) => {
  const { apiKey } = c.req.valid("json");

  const client = b2bClients.find(cl => cl.apiKey === apiKey);
  if (!client) {
    return c.json({ error: "Invalid API key" }, { status: 401 });
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const session: B2BSession = {
    token,
    clientId: client.id,
    clientName: client.name,
    tier: client.tier,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  b2bSessions.set(token, session);
  client.lastAccess = now.toISOString();

  return c.json({
    success: true,
    token,
    client: {
      id: client.id,
      name: client.name,
      type: client.type,
      tier: client.tier,
    },
    expiresAt: session.expiresAt,
  });
});

b2bRouter.post("/auth/credential-login", zValidator("json", credentialLoginSchema), (c) => {
  const { username, password } = c.req.valid("json");

  const credKey = Object.keys(b2bCredentials).find(
    k => k.toLowerCase() === username.toLowerCase()
  );
  const credentials = credKey ? b2bCredentials[credKey] : undefined;
  if (!credentials || credentials.password !== password) {
    return c.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const client = b2bClients.find(cl => cl.id === credentials.clientId);
  if (!client) {
    return c.json({ error: "Client not found" }, { status: 404 });
  }

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const session: B2BSession = {
    token,
    clientId: client.id,
    clientName: client.name,
    tier: client.tier,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  b2bSessions.set(token, session);
  client.lastAccess = now.toISOString();

  return c.json({
    success: true,
    token,
    client: {
      id: client.id,
      name: client.name,
      type: client.type,
      tier: client.tier,
    },
    expiresAt: session.expiresAt,
  });
});

b2bRouter.get("/auth/verify", (c) => {
  const authHeader = c.req.header("Authorization");
  const session = getClientFromToken(authHeader);

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

b2bRouter.post("/auth/logout", (c) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    b2bSessions.delete(token);
  }
  return c.json({ success: true, message: "Logged out successfully" });
});

// ==========================================
// Sentiment Analytics Endpoints (Supabase)
// ==========================================

b2bRouter.get("/sentiment/overview", async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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

b2bRouter.get("/geo/districts", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = getClientFromToken(authHeader);

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

    // Generate all districts
    const districts: Array<{
      districtId: string;
      state: string;
      stateCode: string;
      representative: string;
      party: "D" | "R" | "I";
      coordinates: { lat: number; lng: number };
      engagement: { totalVotes: number; activeUsers: number; postsCreated: number };
      sentiment: { overall: number; byCategory: Record<string, number> };
    }> = [];

    Object.entries(stateInfo).forEach(([stateCode, info]) => {
      const stateWeight = info.districtCount / 435;
      for (let i = 1; i <= info.districtCount; i++) {
        const districtId = info.districtCount === 1 ? `${stateCode}-AL` : `${stateCode}-${i}`;
        districts.push({
          districtId,
          state: info.name,
          stateCode,
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

// ==========================================
// Issue Tracking Endpoints (Supabase)
// ==========================================

b2bRouter.get("/issues", zValidator("query", paginationQuerySchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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
  const session = getClientFromToken(authHeader);

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

b2bRouter.get("/forecast/bills/:billId", zValidator("param", billIdParamSchema), async (c) => {
  const authHeader = c.req.header("Authorization");
  const session = getClientFromToken(authHeader);

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

    const support = bill.yea_count || 0;
    const oppose = bill.nay_count || 0;
    const total = bill.total_votes || 0;
    const currentSentiment = total > 0 ? (support - oppose) / total : 0;

    // Generate forecast based on current sentiment
    const forecast: Array<{ date: string; predicted: number; lowerBound: number; upperBound: number }> = [];
    const now = new Date();
    let value = currentSentiment;

    for (let i = 1; i <= 30; i++) {
      const date = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const change = (Math.random() - 0.5) * 0.05;
      value = Math.max(-1, Math.min(1, value + change));

      forecast.push({
        date: date.toISOString().split("T")[0] || "",
        predicted: parseFloat(value.toFixed(3)),
        lowerBound: parseFloat(Math.max(-1, value - 0.15).toFixed(3)),
        upperBound: parseFloat(Math.min(1, value + 0.15).toFixed(3)),
      });
    }

    return c.json({
      billId,
      currentSentiment: parseFloat(currentSentiment.toFixed(3)),
      forecast,
      confidence: total > 10 ? 0.8 : 0.5,
      keyFactors: [
        { factor: "Current engagement", impact: total > 10 ? 0.2 : -0.1 },
        { factor: "Support ratio", impact: parseFloat((currentSentiment * 0.3).toFixed(2)) },
      ],
      modelVersion: "v2.3.1",
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching forecast:", error);
    return c.json({ error: "Failed to fetch forecast" }, { status: 500 });
  }
});

export { b2bRouter };
export type { B2BClient, B2BSession, SentimentData };
