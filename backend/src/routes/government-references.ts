import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
import { attributionFor } from "../services/reference-attribution";
import { benchOn, isDissenter } from "../services/court-composition";
import { recordCompleteness } from "../services/record-completeness";
import { ensureScotusFacts } from "../services/scotus-facts";
import { ensurePortraitFor } from "../services/reference-attribution";
import { isVerified, VERIFICATION_REQUIRED } from "../services/verification";
import { gapStatus, officialVoteRoll } from "../services/representation-gap";
import { publicUrlFor } from "../services/storage";
import type { auth } from "../auth";
import {
  ReferenceType,
  type ReferenceTypeValue,
  normalizeReferenceId,
  findDuplicates,
  findOrCreateReference,
  mergeReferences,
  addAlias,
  recalculateReferenceStats,
} from "../services/deduplication-service";
import { applyWeightedTally, voteBreakdown } from "../services/delegation-service";
import { pulseOverTime, recordPosition, turningPoints } from "../services/position-history";
import { notifyVoiceUsed } from "../services/notification-service";
import { hiddenFrom } from "../services/relationships";
import { namesFor } from "../services/reference-names";
import { formatReferenceDisplayId, referenceIdSearchVariants } from "../services/reference-id";
import { ensureReferenceContent } from "../services/reference-content";
import { parseBrief } from "../services/citizen-brief";
import { listIncidents } from "../services/service-incidents";
import { resolveLibraryDocument } from "../services/library-resolve";
import { libraryResolveRequestSchema } from "../types";
import { requireCapability } from "../services/admin-permissions";
import { JobPriority, JobType, enqueueBriefGeneration, jobQueue } from "../services/job-queue";
import { briefState, isAbandoned, isWorking, markSettled, markWorking } from "../services/brief-state";
import { publicHandle } from "../services/public-identity";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const governmentReferencesRouter = new Hono<{ Variables: AuthVariables }>();

/**
 * How long the brief request holds the connection before answering "working".
 *
 * Long enough for the ordinary case — pull the official text, one or two model
 * passes, a fact-check — to finish while the reader is still looking at the
 * button they pressed. Past it the work carries on server-side and the client
 * asks again; nothing is lost, and no request hangs indefinitely.
 */
/**
 * How long a brief request may hold the page.
 *
 * FORTY-FIVE SECONDS, and the number is not arbitrary. The browser talks to
 * ayeandnay.com and Vercel proxies /api/* through to Railway; that proxy kills
 * a request at about 120 seconds with a 502 at the edge. Measured live: a
 * forced regeneration ran 120,191ms and died there. Anything that approaches
 * that ceiling is the hang users see, and the edge's error is not ours to
 * shape — so the wall has to be far below it, not near it.
 *
 * It also has to leave the server free. Requests were observed serialising, so
 * a handler that sits for a minute is a handler blocking everybody behind it.
 *
 * IT WAS TWENTY, AND THAT WAS TUNED TO A BROKEN STATE. Every model was
 * answering "no credit" in milliseconds at the time, so twenty seconds looked
 * generous. Once the accounts were funded and the models actually started
 * writing, a real draft plus its fact-check needs more than that, and the wall
 * cut off work that was going to succeed. Numbers tuned while everything is
 * failing describe the failure, not the job.
 *
 * A brief is two model calls, sometimes three. Fifteen seconds each, thirty in
 * total, inside forty-five here — with room left over, and still a long way
 * under the edge's two minutes.
 */
const BRIEF_REQUEST_DEADLINE_MS = 45_000;

/**
 * The caller's standing vote per reference, in one query — every list of law
 * cards sends it so any surface can show "you voted" and block double votes.
 */
async function loadUserVotes(
  userId: string | undefined,
  referenceIds: string[]
): Promise<Map<string, string>> {
  if (!userId || referenceIds.length === 0) return new Map();
  const votes = await prisma.governmentReferenceVote.findMany({
    where: { userId, governmentReferenceId: { in: referenceIds } },
    select: { governmentReferenceId: true, position: true },
  });
  return new Map(votes.map((v) => [v.governmentReferenceId, v.position]));
}

// Validation schemas
const referenceTypeEnum = z.enum(["bill", "executive_order", "scotus_case"]);

const paginationSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
});

const searchSchema = z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  cursor: z.string().optional(),
  referenceType: referenceTypeEnum.optional(),
  status: z.string().optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(["createdAt", "supportVotes", "opposeVotes", "totalComments"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const createReferenceSchema = z.object({
  masterReferenceId: z.string().min(1),
  referenceType: referenceTypeEnum,
  title: z.string().min(1).max(500),
  shortTitle: z.string().max(200).optional(),
  sourceUrl: z.string().url().optional(),
  chamber: z.string().optional(),
  congress: z.number().int().positive().optional(),
  status: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  citizenBrief: z.string().optional(),
  fullText: z.string().optional(),
  signedDate: z.string().datetime().optional(),
  decidedDate: z.string().datetime().optional(),
  aliases: z.array(z.string()).optional(),
});

const updateReferenceSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  shortTitle: z.string().max(200).optional().nullable(),
  sourceUrl: z.string().url().optional().nullable(),
  chamber: z.string().optional().nullable(),
  congress: z.number().int().positive().optional().nullable(),
  status: z.string().optional(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  citizenBrief: z.string().optional().nullable(),
  fullText: z.string().optional().nullable(),
  signedDate: z.string().datetime().optional().nullable(),
  decidedDate: z.string().datetime().optional().nullable(),
});

const voteSchema = z.object({
  position: z.enum(["support", "oppose"]),
  /**
   * Why, when somebody chooses to say — usually when they are changing their
   * mind. Never required: a reason people are forced to give is a reason people
   * invent, and an invented reason is worse than none.
   */
  reason: z.string().max(500).optional(),
  /**
   * Bill of Rights Article IV: the anonymous voting option.
   *
   * The vote counts either way — an anonymous position is carried into the
   * Pulse exactly like any other, including through delegation. What is
   * withheld is the citizen's NAME, on every surface that would otherwise
   * attach it to this position for somebody else to read.
   */
  anonymous: z.boolean().optional(),
});

const mergeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
});

const addAliasSchema = z.object({
  alias: z.string().min(1),
});

/**
 * GET /api/government-references
 * Search and list government references with filters
 */
governmentReferencesRouter.get("/", zValidator("query", searchSchema), async (c) => {
  const { limit, cursor, referenceType, status, category, search, sortBy = "createdAt", sortOrder = "desc" } = c.req.valid("query");

  // Build where clause
  const where: {
    referenceType?: string;
    status?: string;
    category?: string;
    mergedIntoId?: null;
    OR?: Array<
      | { title: { contains: string; mode: "insensitive" } }
      | { shortTitle: { contains: string; mode: "insensitive" } }
      | { masterReferenceId: { contains: string; mode: "insensitive" } }
    >;
  } = {
    mergedIntoId: null, // Don't include merged references
  };

  if (referenceType) {
    where.referenceType = referenceType;
  }
  if (status) {
    where.status = status;
  }
  if (category) {
    where.category = category;
  }
  if (search) {
    // CASE-INSENSITIVE, AND IT WAS NOT.
    //
    // Prisma's `contains` is case-SENSITIVE on PostgreSQL unless told
    // otherwise, so searching this catalogue only worked if you happened to
    // capitalise a law the way its title does. Reported against the composer's
    // "attach a law" box, with a screenshot that says it perfectly: "End Gas
    // Station Heroin Act" sitting in the list above, and typing "end gas
    // station" answering "No bills found".
    //
    // It was never only that box. This is the one list endpoint behind the
    // composer AND the Library, so law search has been case-sensitive
    // everywhere in the product. It went unnoticed because the obvious way to
    // test a search is to type a title you are looking at, in the case you are
    // looking at.
    //
    // Post search next door has had `mode: "insensitive"` on all four of its
    // clauses since it was written, which is what makes this a slip rather than
    // a decision.
    //
    // Ids are stored hyphenated and lowercase but read as printed ("H.R. 4836"),
    // so match every plausible spelling of what was typed, not just the literal.
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { shortTitle: { contains: search, mode: "insensitive" } },
      ...referenceIdSearchVariants(search).map((variant) => ({
        masterReferenceId: { contains: variant, mode: "insensitive" as const },
      })),
    ];
  }

  const orderBy: Record<string, "asc" | "desc"> = { [sortBy]: sortOrder };

  const references = await prisma.governmentReference.findMany({
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    where,
    orderBy,
    select: {
      id: true,
      masterReferenceId: true,
      slug: true,
      referenceType: true,
      title: true,
      shortTitle: true,
      status: true,
      category: true,
      chamber: true,
      congress: true,
      sourceUrl: true,
      signedDate: true,
      decidedDate: true,
      // Real provenance. These columns exist so "we do not know" has somewhere
      // to live — before them the client filled both dates with its own
      // createdAt and named a chamber as the sponsor.
      introducedDate: true,
      lastActionDate: true,
      lastActionText: true,
      sponsorBioguideId: true,
      sponsorName: true,
      // The face of whoever decided it. Missing here meant a list card showed
      // an executive order's President by name with no portrait while the
      // record's own page showed both — the same law, two different answers.
      sponsorPhotoUrl: true,
      // What the completeness badge is worked out from. Same reason: a card
      // and the record it links to must not disagree about our own work.
      fullText: true,
      fullTextSource: true,
      sourceCheckedAt: true,
      citizenBriefJson: true,
      citizenBriefVersion: true,
      lawVersion: true,
      rollCalls: { select: { id: true }, take: 1 },
      sponsorParty: true,
      sponsorState: true,
      supportVotes: true,
      opposeVotes: true,
      totalComments: true,
      totalShares: true,
      createdAt: true,
      _count: {
        select: {
          posts: true,
        },
      },
    },
  });

  const hasMore = references.length > limit;
  const results = hasMore ? references.slice(0, -1) : references;
  const nextCursor = hasMore && results.length > 0 ? results[results.length - 1]?.id : undefined;

  // The caller's standing vote on each law, so every card can light it up.
  const userVotesByRef = await loadUserVotes(
    c.get("user")?.id,
    results.map((r) => r.id)
  );

  return c.json({
    references: results.map((ref) => {
      /*
       * A LAW CARD IS LOADING, so find the face of whoever is behind it — for
       * whoever sees this card next.
       *
       * Part of the card's own load rather than a sweep over the archive: most
       * of the 1,532 executive orders held will never be looked at, so paying
       * for all of them to serve the few that are read is backwards.
       *
       * Costs this request nothing: not awaited, one ask per person per
       * process, queued behind a single worker, and one answer fills every
       * record that person is behind.
       */
      ensurePortraitFor(ref);

      return {
        id: ref.id,
        masterReferenceId: ref.masterReferenceId,
        slug: ref.slug,
        // The id as printed ("H.R. 4836"), so every picker shows the same spelling
        // that referenceIdSearchVariants() can match back.
        displayId: formatReferenceDisplayId(ref.masterReferenceId, ref.referenceType),
        referenceType: ref.referenceType,
        title: ref.title,
        shortTitle: ref.shortTitle,
        status: ref.status,
        category: ref.category,
        chamber: ref.chamber,
        congress: ref.congress,
        introducedDate: ref.introducedDate?.toISOString() ?? null,
        lastActionDate: ref.lastActionDate?.toISOString() ?? null,
        lastActionText: ref.lastActionText ?? null,
        sponsor: ref.sponsorName
          ? {
              bioguideId: ref.sponsorBioguideId,
              name: ref.sponsorName,
              party: ref.sponsorParty,
              state: ref.sponsorState,
            }
          : null,
        /**
         * THE PERSON BEHIND THIS RECORD. `sponsor` above stays exactly as it
         * was, because other screens read it; this is the thing a card draws —
         * a name, what they did, and a face. The rules for all three branches
         * live in one place, in services/reference-attribution.
         */
        attribution: attributionFor(ref),
        /**
         * HOW COMPLETE OUR RECORD OF THIS LAW IS. The platform rating its own
         * work, checklist and all — see services/record-completeness.ts.
         *
         */
        completeness: recordCompleteness({
          ...ref,
          hasRollCall: ref.rollCalls.length > 0,
        }),
        sourceUrl: ref.sourceUrl,
        signedDate: ref.signedDate?.toISOString() ?? null,
        decidedDate: ref.decidedDate?.toISOString() ?? null,
        votes: {
          support: ref.supportVotes,
          oppose: ref.opposeVotes,
          total: ref.supportVotes + ref.opposeVotes,
        },
        userVote: userVotesByRef.get(ref.id) ?? null,
        engagement: {
          comments: ref.totalComments,
          shares: ref.totalShares,
          posts: ref._count.posts,
        },
        createdAt: ref.createdAt.toISOString(),
      };
    }),
    nextCursor,
    hasMore,
  });
});

/**
 * The least engagement a record needs before this platform will call it
 * trending. Five interactions is not a movement, but it is enough that the
 * ordering means something rather than being recency in a costume.
 */
const TRENDING_FLOOR = 5;

/**
 * GET /api/government-references/trending
 * Get trending references based on recent engagement
 */
/**
 * GET /api/government-references/freshness
 *
 * How current is the government you are looking at?
 *
 * WHY THIS EXISTS. A visitor had no way to tell whether the Government section
 * showed today's Congress or a snapshot from whenever the last sync happened to
 * run — and after a deploy pause, or a spent API key, those two look identical.
 * A platform whose whole claim is that its records are the real ones owes a
 * reader the date on them.
 *
 * Everything here is measured. `syncedAt` is the newest sourceCheckedAt across
 * stored records, `newest` is the most recent thing we hold, and the cadence
 * numbers are the intervals the schedulers actually run at rather than a
 * sentence in a README that can drift from the code.
 *
 * Registered BEFORE "/:id" — Hono matches in registration order, and a static
 * suffix placed after a bare parameter route is never reached.
 */
governmentReferencesRouter.get("/freshness", async (c) => {
  const [checked, newestBill, counts, provenance] = await Promise.all([
    prisma.governmentReference.findFirst({
      where: { sourceCheckedAt: { not: null }, mergedIntoId: null },
      orderBy: { sourceCheckedAt: "desc" },
      select: { sourceCheckedAt: true },
    }),
    prisma.governmentReference.findFirst({
      where: { referenceType: "bill", mergedIntoId: null, lastActionDate: { not: null } },
      orderBy: { lastActionDate: "desc" },
      select: { lastActionDate: true, masterReferenceId: true, title: true },
    }),
    prisma.governmentReference.groupBy({
      by: ["referenceType"],
      where: { mergedIntoId: null },
      _count: { _all: true },
    }),
    // How much of the store still has no date or sponsor. The honest measure
    // of how far the background fill has got.
    prisma.governmentReference.count({
      where: { referenceType: "bill", mergedIntoId: null, introducedDate: null },
    }),
  ]);

  return c.json({
    /** Newest source check across all stored records. Null before any sync. */
    syncedAt: checked?.sourceCheckedAt?.toISOString() ?? null,
    /** The most recent legislative action we hold, and what it was on. */
    newestAction: newestBill
      ? {
          date: newestBill.lastActionDate?.toISOString() ?? null,
          referenceId: newestBill.masterReferenceId,
          title: newestBill.title,
        }
      : null,
    counts: Object.fromEntries(counts.map((row) => [row.referenceType, row._count._all])),
    /**
     * The schedule as the code actually runs it, in hours. A cadence stated in
     * prose drifts from the intervals; these are the intervals.
     */
    cadence: {
      recordsHours: 24,
      rollCallsHours: 12,
      provenanceHours: 4,
    },
    /** Bills still waiting on a congress.gov detail call for date and sponsor. */
    awaitingProvenance: provenance,
  });
});

/**
 * GET /api/government-references/pulse
 *
 * WHAT THE COUNTRY IS ARGUING ABOUT RIGHT NOW.
 *
 * Distinct from /trending, which ranks by ALL-TIME totals and therefore answers
 * a different question: the biggest records of the year sit at the top of it
 * forever, whatever happened this week. A pulse that never changes is not a
 * pulse.
 *
 * This counts activity inside a window — votes cast, and posts written about
 * the record — and ranks by the two together. A record nobody has touched in
 * the window is absent rather than listed with a zero, because the panel is
 * about what is moving.
 *
 * IT RANKS RECORDS, NOT PEOPLE. The panel this feeds used to carry a second
 * list of "top engagement drivers" — a leaderboard of citizens. It was dropped
 * on the owner\'s instruction, and it would have contradicted the platform\'s
 * own rule that it never ranks anybody: a public table of who is most active is
 * that with a different label.
 */
governmentReferencesRouter.get(
  "/pulse",
  zValidator(
    "query",
    z.object({
      days: z.coerce.number().int().min(1).max(90).optional().default(7),
      limit: z.coerce.number().int().min(1).max(20).optional().default(5),
    }),
  ),
  async (c) => {
    const { days, limit } = c.req.valid("query");
    const since = new Date(Date.now() - days * 86_400_000);

    // Grouped in the database, not pulled into memory: votes and posts are the
    // two tables that grow without limit.
    const [votes, posts] = await Promise.all([
      prisma.governmentReferenceVote.groupBy({
        by: ["governmentReferenceId"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.post.groupBy({
        by: ["governmentReferenceId"],
        where: { createdAt: { gte: since }, governmentReferenceId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const activity = new Map<string, { votes: number; posts: number }>();
    for (const row of votes) {
      if (!row.governmentReferenceId) continue;
      const at = activity.get(row.governmentReferenceId) ?? { votes: 0, posts: 0 };
      at.votes += row._count._all;
      activity.set(row.governmentReferenceId, at);
    }
    for (const row of posts) {
      if (!row.governmentReferenceId) continue;
      const at = activity.get(row.governmentReferenceId) ?? { votes: 0, posts: 0 };
      at.posts += row._count._all;
      activity.set(row.governmentReferenceId, at);
    }

    const ranked = [...activity.entries()]
      .map(([id, at]) => ({ id, ...at, total: at.votes + at.posts }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    if (ranked.length === 0) {
      // Nothing moved in the window. An empty list, rather than filling it with
      // the biggest records of all time dressed up as current.
      return c.json({ days, records: [] });
    }

    const records = await prisma.governmentReference.findMany({
      where: { id: { in: ranked.map((row) => row.id) }, mergedIntoId: null },
      select: {
        id: true,
        title: true,
        shortTitle: true,
        referenceType: true,
        category: true,
        supportVotes: true,
        opposeVotes: true,
      },
    });

    const byId = new Map(records.map((record) => [record.id, record]));

    return c.json({
      days,
      // A record merged away between the two queries is skipped rather than
      // returned as a row the client has to defend against.
      records: ranked.flatMap((row) => {
        const record = byId.get(row.id);
        if (!record) return [];
        return [{
          id: record.id,
          title: record.shortTitle ?? record.title,
          referenceType: record.referenceType,
          category: record.category,
          recentVotes: row.votes,
          recentPosts: row.posts,
          activity: row.total,
          supportVotes: record.supportVotes,
          opposeVotes: record.opposeVotes,
        }];
      }),
    });
  },
);


governmentReferencesRouter.get("/trending", zValidator("query", z.object({
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 10)),
  referenceType: referenceTypeEnum.optional(),
})), async (c) => {
  const { limit, referenceType } = c.req.valid("query");

  const where: { referenceType?: string; mergedIntoId: null } = {
    mergedIntoId: null,
  };

  if (referenceType) {
    where.referenceType = referenceType;
  }

  // Get references sorted by total engagement (support + oppose + comments + shares).
  // Over-fetch so the recency tie-break below can pick the newest zero-vote items,
  // then trim to the requested limit after the in-memory sort.
  const references = await prisma.governmentReference.findMany({
    take: Math.min(limit * 3, 100),
    where,
    orderBy: [
      { supportVotes: "desc" },
      { opposeVotes: "desc" },
      { totalComments: "desc" },
      { createdAt: "desc" },
    ],
    select: {
      id: true,
      masterReferenceId: true,
      slug: true,
      referenceType: true,
      title: true,
      shortTitle: true,
      status: true,
      category: true,
      chamber: true,
      congress: true,
      sourceUrl: true,
      description: true,
      citizenBrief: true,
      signedDate: true,
      decidedDate: true,
      // Real provenance. These columns exist so "we do not know" has somewhere
      // to live — before them the client filled both dates with its own
      // createdAt and named a chamber as the sponsor.
      introducedDate: true,
      lastActionDate: true,
      lastActionText: true,
      sponsorBioguideId: true,
      sponsorName: true,
      // The face of whoever decided it. Missing here meant a list card showed
      // an executive order's President by name with no portrait while the
      // record's own page showed both — the same law, two different answers.
      sponsorPhotoUrl: true,
      // What the completeness badge is worked out from. Same reason: a card
      // and the record it links to must not disagree about our own work.
      fullText: true,
      fullTextSource: true,
      sourceCheckedAt: true,
      citizenBriefJson: true,
      citizenBriefVersion: true,
      lawVersion: true,
      rollCalls: { select: { id: true }, take: 1 },
      sponsorParty: true,
      sponsorState: true,
      supportVotes: true,
      opposeVotes: true,
      totalComments: true,
      totalShares: true,
      createdAt: true,
      _count: {
        select: {
          posts: true,
        },
      },
    },
  });

  // Calculate trending score and sort; ties (e.g. freshly synced items with no
  // votes yet) break toward the most recent real-world activity.
  const withTrendingScore = references.map((ref) => ({
    ...ref,
    trendingScore: ref.supportVotes + ref.opposeVotes + ref.totalComments * 2 + ref.totalShares * 3,
  }));

  const recency = (ref: (typeof withTrendingScore)[number]): number =>
    ref.signedDate?.getTime() ?? ref.decidedDate?.getTime() ?? ref.createdAt.getTime();
  withTrendingScore.sort(
    (a, b) => b.trendingScore - a.trendingScore || recency(b) - recency(a),
  );

  // NOTHING IS TRENDING UNTIL SOMETHING IS.
  //
  // The score is honest arithmetic, but on a platform with almost no activity
  // every record scores zero or close to it, ties fall through to recency, and
  // the top three still get stamped "#1 Trending". That is a claim about
  // popularity made out of an empty database — the same failure as an invented
  // number, arrived at from the other direction: real arithmetic wearing a
  // label the data cannot support.
  //
  // Below the floor this returns nothing and the section renders its empty
  // state, which is the truthful answer to "what is trending here" when the
  // answer is "nothing yet".
  const trending = withTrendingScore.filter((ref) => ref.trendingScore >= TRENDING_FLOOR);
  const topReferences = trending.slice(0, limit);

  // The caller's standing vote on each law, so every card can light it up.
  const userVotesByRef = await loadUserVotes(
    c.get("user")?.id,
    topReferences.map((r) => r.id)
  );

  return c.json({
    references: topReferences.map((ref) => {
      /*
       * A LAW CARD IS LOADING, so find the face of whoever is behind it — for
       * whoever sees this card next.
       *
       * Part of the card's own load rather than a sweep over the archive: most
       * of the 1,532 executive orders held will never be looked at, so paying
       * for all of them to serve the few that are read is backwards.
       *
       * Costs this request nothing: not awaited, one ask per person per
       * process, queued behind a single worker, and one answer fills every
       * record that person is behind.
       */
      ensurePortraitFor(ref);

      return {
        id: ref.id,
        masterReferenceId: ref.masterReferenceId,
        slug: ref.slug,
        // The id as printed ("H.R. 4836", "S.Res. 829"). Sent from here so both
        // clients render one spelling instead of each deriving its own from the
        // raw id — which is how "sres-829-119" reached a card as "SRES.829".
        displayId: formatReferenceDisplayId(ref.masterReferenceId, ref.referenceType),
        referenceType: ref.referenceType,
        title: ref.title,
        shortTitle: ref.shortTitle,
        status: ref.status,
        category: ref.category,
        chamber: ref.chamber,
        congress: ref.congress,
        introducedDate: ref.introducedDate?.toISOString() ?? null,
        lastActionDate: ref.lastActionDate?.toISOString() ?? null,
        lastActionText: ref.lastActionText ?? null,
        sponsor: ref.sponsorName
          ? {
              bioguideId: ref.sponsorBioguideId,
              name: ref.sponsorName,
              party: ref.sponsorParty,
              state: ref.sponsorState,
            }
          : null,
        /**
         * THE PERSON BEHIND THIS RECORD. `sponsor` above stays exactly as it
         * was, because other screens read it; this is the thing a card draws —
         * a name, what they did, and a face. The rules for all three branches
         * live in one place, in services/reference-attribution.
         */
        attribution: attributionFor(ref),
        /**
         * HOW COMPLETE OUR RECORD OF THIS LAW IS. The platform rating its own
         * work, checklist and all — see services/record-completeness.ts.
         *
         */
        completeness: recordCompleteness({
          ...ref,
          hasRollCall: ref.rollCalls.length > 0,
        }),
        sourceUrl: ref.sourceUrl,
        description: ref.description,
        citizenBrief: ref.citizenBrief,
        signedDate: ref.signedDate?.toISOString() ?? null,
        decidedDate: ref.decidedDate?.toISOString() ?? null,
        votes: {
          support: ref.supportVotes,
          oppose: ref.opposeVotes,
          total: ref.supportVotes + ref.opposeVotes,
        },
        userVote: userVotesByRef.get(ref.id) ?? null,
        engagement: {
          comments: ref.totalComments,
          shares: ref.totalShares,
          posts: ref._count.posts,
        },
        trendingScore: ref.trendingScore,
        createdAt: ref.createdAt.toISOString(),
      };
    }),
  });
});

/**
 * GET /api/government-references/:id/vote-details
 *
 * The Pulse, shown as its parts. Bill of Rights III promises every user the
 * right "to know exactly how many direct votes and delegated weights formed
 * the Pulse" — before this, the platform published one merged number and there
 * was no way for anyone, including its operators, to see what it was made of.
 *
 * Public, because the same article calls it "a public record within the
 * platform", and a record you must sign in to read is not one.
 *
 * Counts only, never names: Article IV promises anonymity, and a roster of who
 * voted which way is precisely what that forbids.
 */
governmentReferencesRouter.get("/:id/vote-details", async (c) => {
  const id = c.req.param("id");

  const reference = await prisma.governmentReference.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  const breakdown = await voteBreakdown(id);
  return c.json(breakdown);
});

/**
 * GET /api/government-references/:id
 * Get a single reference with full details and engagement stats
 */
governmentReferencesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  // READS. DOES NOT WRITE.
  //
  // This used to pull the official text and queue a brief on every open, which
  // is where the load loop began: opening a law put the row into a working
  // state, the client polled while the server said it was working, and if the
  // job behind it died — a restart, a deploy — the row went on saying it was
  // working and the spinner went on spinning. A reader who asked for nothing
  // could not get out of it, and reloading did not help, because the stuck
  // state was in the database.
  //
  // Pulling the text and writing the brief now happen when somebody presses
  // "Get Citizen Brief" (POST /:id/brief), which is the act that costs money
  // and the act a person should choose.

  /*
   * BY CUID OR BY READABLE ADDRESS.
   *
   * /executive-order/eo-14421 is what a person types and what Google indexes;
   * /reference/<cuid> is what every link shared before today used. Both have
   * to land on the same record, forever — a link that dies is a promise broken
   * by a refactor.
   */
  const reference = await prisma.governmentReference.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    include: {
      _count: {
        select: {
          posts: true,
          votes: true,
        },
      },
      votes: user ? {
        where: { userId: user.id },
        select: { position: true },
      } : false,
      mergedInto: {
        select: {
          id: true,
          masterReferenceId: true,
          title: true,
        },
      },
    },
  });

  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  // If this reference was merged, redirect to the target
  if (reference.mergedIntoId && reference.mergedInto) {
    return c.json({
      redirectTo: reference.mergedInto.id,
      message: "This reference has been merged into another reference",
      mergedInto: {
        id: reference.mergedInto.id,
        masterReferenceId: reference.mergedInto.masterReferenceId,
        title: reference.mergedInto.title,
      },
    }, 301);
  }

  // Every name this record used to answer to, read from the registry rather
  // than the `aliases` mirror on the row. The mirror is kept in step by the
  // same writer, but it exists for a search that has not been rebuilt yet —
  // reading it here would put a derived copy on the screen when the authority
  // is one indexed query away.
  const { former: aliases } = await namesFor(reference.id);

  // The chamber's latest recorded vote on this measure, if it has taken one.
  // A bill is voted on many times — procedural motions, amendments, final
  // passage — and the honest one to show is where the chamber last stood.
  const latestRollCall = await prisma.rollCall.findFirst({
    where: { governmentReferenceId: reference.id },
    orderBy: { votedAt: "desc" },
  });

  /**
   * WHO IS ANSWERABLE FOR THIS RULING.
   *
   * A per curiam opinion has no author — the Supreme Court issues it as one
   * body — so for decades of them this platform showed a docket number and
   * nobody. "The app is about accountability so not posting the photo is not
   * very fair": the bench that sat is who answers for it.
   *
   * NARROWED TO THE MAJORITY WHERE THE RECORD SAYS SO. A justice who wrote "I
   * dissent" must not appear under a heading that reads as agreement, so
   * anyone named on a dissent comes out of the row of faces.
   *
   * AN EMPTY DISSENT LIST IS NOT UNANIMITY. It means none was recorded, which
   * could equally mean none was filed or none was digitised. Those are
   * indistinguishable from here, so the card widens back to the whole bench
   * under a label that only claims who SAT — never that they agreed.
   *
   * DISSENTERS ARE NOT SHOWN. They come out of the row and nothing replaces
   * them: the panel answers "who is behind this ruling", and somebody who
   * dissented from it is not. Listing them put two rosters on one page.
   *
   * Detail only. A list card does not need a bench, and asking for one there
   * would be a query per row.
   */
  /**
   * HOW COMPLETE OUR RECORD OF THIS LAW IS — the same answer the feed card
   * gives, from the same function, so the two can never disagree about our own
   * work. `latestRollCall` is already loaded above, so this costs no query.
   */
  const completeness = recordCompleteness({
    ...reference,
    hasRollCall: latestRollCall !== null,
  });

  /*
   * SOMEBODY IS OPENING THIS LAW, so find the face of whoever is behind it —
   * for the reader after this one.
   *
   * Deliberately NOT awaited. The lookup is a Wikipedia round trip and a
   * portrait is not worth a second of anybody's page load; this reader sees the
   * name, and the next sees the name and the face. One answer fills every
   * record that person is behind, so opening one order Obama signed gives a
   * face to all of them.
   */
  ensurePortraitFor(reference);
  // A ruling with no decision date has no bench to show, and the bench is the
  // only thing a ruling nobody signed can be attributed to. The date is on the
  // CourtListener cluster this record already links to, so it is fetched once
  // and kept — see services/scotus-facts.
  ensureScotusFacts(reference);

  const attribution = attributionFor(reference);
  if (attribution?.perCuriam && reference.decidedDate) {
    const bench = await benchOn(reference.decidedDate);
    const dissenting = bench.filter((j) => isDissenter(j.name, reference.dissentedBy ?? []));
    // Only narrow when a recorded dissent actually matched somebody on the
    // bench. A name we cannot place is not grounds to shrink the panel.
    const narrowed = dissenting.length > 0;
    const majority = narrowed ? bench.filter((j) => !dissenting.includes(j)) : bench;
    const sat = reference.decidedDate.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });

    if (majority.length > 0) {
      attribution.panel = majority;
      attribution.panelLabel = narrowed
        ? `In the majority on ${sat}`
        : `The Court as it sat on ${sat}`;
    }
  }

  return c.json({
    reference: {
      id: reference.id,
      masterReferenceId: reference.masterReferenceId,
      /** The readable address. Null until the slug backfill has reached it. */
      slug: reference.slug,
      displayId: formatReferenceDisplayId(reference.masterReferenceId, reference.referenceType),
      referenceType: reference.referenceType,
      title: reference.title,
      shortTitle: reference.shortTitle,
      sourceUrl: reference.sourceUrl,
      chamber: reference.chamber,
      congress: reference.congress,
      // Real provenance. Both dates used to be filled by the CLIENT with our
      // own createdAt, and the sponsor was the chamber's name.
      introducedDate: reference.introducedDate?.toISOString() ?? null,
      lastActionDate: reference.lastActionDate?.toISOString() ?? null,
      lastActionText: reference.lastActionText ?? null,
      sponsor: reference.sponsorName
        ? {
            bioguideId: reference.sponsorBioguideId,
            name: reference.sponsorName,
            party: reference.sponsorParty,
            state: reference.sponsorState,
          }
        : null,
      /**
       * THE PERSON BEHIND THIS RECORD. `sponsor` above stays exactly as it
       * was, because other screens read it; this is the thing the page draws —
       * a name, what they did, and a face. The rules for all three branches
       * live in one place, in services/reference-attribution.
       *
       * A per curiam ruling arrives here with a bench instead of one face:
       * the Court issued it as one body, and every justice sitting that day is
       * answerable for it. See detailAttribution above.
       */
      attribution,
      completeness,
      status: reference.status,
      category: reference.category,
      description: reference.description,
      citizenBrief: reference.citizenBrief,
      // Structured brief straight off the master reference — the three panels both
      // faucets render. Returned even when it describes an earlier version of
      // the law, because the reader deserves to see what exists and that it is
      // behind; citizenBriefVersion and lawVersion below say which.
      citizenBriefSections: parseBrief(reference.citizenBriefJson),
      citizenBriefAt: reference.citizenBriefAt?.toISOString() ?? null,
      // Which version of the law the stored brief was written for, and which
      // version the law is on. Equal means the brief describes the law in front
      // of you; different means it describes an earlier text and a rewrite is
      // due. Exposed because a reader deserves to know which they are looking
      // at, and because it is the only way to check "one brief per version"
      // from outside.
      citizenBriefVersion: reference.citizenBriefVersion,
      lawVersion: reference.lawVersion,
      lawChangedAt: reference.lawChangedAt?.toISOString() ?? null,
      contentStatus: reference.contentStatus ?? (reference.citizenBriefJson ? "ready" : null),
      // WHAT THE READER SHOULD BE SHOWN, in one word.
      //
      // contentStatus above is the raw column and stays for anything reading
      // it; this is the collapsed answer, and it is the one the clients use.
      // The difference that matters: work claiming to be in flight past its
      // timeout reports `idle` here, so the reader is offered the button again
      // instead of a spinner that can never resolve — which is exactly what a
      // job lost to a restart used to produce, permanently.
      briefState: briefState(reference),
      fullText: reference.fullText,
      fullTextSource: reference.fullTextSource,
      fullTextUrl: reference.fullTextUrl,
      fullTextAt: reference.fullTextAt?.toISOString() ?? null,
      sourceCheckedAt: reference.sourceCheckedAt?.toISOString() ?? null,
      signedDate: reference.signedDate?.toISOString() ?? null,
      decidedDate: reference.decidedDate?.toISOString() ?? null,
      aliases,
      votes: {
        support: reference.supportVotes,
        oppose: reference.opposeVotes,
        total: reference.supportVotes + reference.opposeVotes,
      },
      // HOW THE CHAMBER ACTUALLY VOTED, from senate.gov or clerk.house.gov.
      //
      // This is the field the Representation Gap has always keyed on, on both
      // clients, and nothing had ever set it — so PulseGap and the "Official
      // Vote" block had never rendered for a real record. Null when the
      // chamber has not voted, which keeps those panels hidden rather than
      // showing a fabricated tally.
      officialVotes: latestRollCall
        ? {
            yea: latestRollCall.yea,
            nay: latestRollCall.nay,
            present: latestRollCall.present,
            notVoting: latestRollCall.notVoting,
            chamber: latestRollCall.chamber,
            question: latestRollCall.question,
            result: latestRollCall.result,
            votedAt: latestRollCall.votedAt.toISOString(),
            // Every number here is traceable to the page it came from.
            sourceUrl: latestRollCall.sourceUrl,
          }
        : null,
      engagement: {
        comments: reference.totalComments,
        shares: reference.totalShares,
        posts: reference._count.posts,
      },
      userVote: user && reference.votes && Array.isArray(reference.votes) && reference.votes.length > 0
        ? reference.votes[0]?.position ?? null
        : null,
      createdAt: reference.createdAt.toISOString(),
      updatedAt: reference.updatedAt.toISOString(),
    },
  });
});

/**
 * POST /api/government-references/resolve
 *
 * Turn a Library search result into its master reference and start the content
 * pipeline on it. This is what makes a library brief trustworthy: the brief is
 * written from the ENTIRE official text pulled here on the server, not from the
 * search blurb the client happens to be holding.
 *
 * Returns immediately — the text pull and brief run in the background, and the
 * client polls GET /:id (which both faucets already use) until the brief lands.
 * No auth: reading a law is public, and the row is built from official metadata.
 */
governmentReferencesRouter.post(
  "/resolve",
  zValidator("json", libraryResolveRequestSchema),
  async (c) => {
    const input = c.req.valid("json");

    const resolved = await resolveLibraryDocument(input);
    if (!resolved.ok) {
      // Two different refusals, because they mean different things to a reader.
      // One is "we could not work out what this is"; the other is "this is a
      // real document and it is not ours to carry".
      if (resolved.reason === "not_the_supreme_court") {
        return c.json(
          { error: "AYE & NAY carries rulings of the Supreme Court of the United States only" },
          400
        );
      }
      return c.json(
        { error: "Could not identify this document from the official source" },
        400
      );
    }

    const row = await prisma.governmentReference.findUnique({
      where: { id: resolved.id },
      select: {
        contentStatus: true,
        contentStartedAt: true,
        citizenBriefJson: true,
        citizenBriefVersion: true,
        lawVersion: true,
      },
    });

    // DELIBERATELY DOES NO WORK. Resolving a document means "which record is
    // this" and nothing more.
    //
    // It used to mark the row as working and start a brief in the background,
    // so merely opening a law began paying a model, and the client polled a
    // status the server could get permanently stuck on — a reader who asked for
    // nothing could end up watching a spinner that no reload could clear.
    //
    // Writing a brief is now something a person asks for, at
    // POST /:id/brief. This just reports where the record stands.
    return c.json({
      reference: {
        id: resolved.id,
        masterReferenceId: resolved.masterReferenceId,
        referenceType: resolved.referenceType,
        contentStatus: row?.contentStatus ?? null,
        briefState: row
          ? briefState(row)
          : // No row yet means nothing has been written for it, which is
            // exactly the state that offers the button.
            ("idle" as const),
        created: resolved.created,
      },
    });
  }
);

/**
 * POST /api/government-references
 * Create a new reference or return existing one if duplicate found
 */
governmentReferencesRouter.post("/", zValidator("json", createReferenceSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const data = c.req.valid("json");

  try {
    const result = await findOrCreateReference({
      masterReferenceId: data.masterReferenceId,
      referenceType: data.referenceType as ReferenceTypeValue,
      title: data.title,
      shortTitle: data.shortTitle,
      sourceUrl: data.sourceUrl,
      chamber: data.chamber,
      congress: data.congress,
      status: data.status,
      category: data.category,
      description: data.description,
      fullText: data.fullText,
      signedDate: data.signedDate ? new Date(data.signedDate) : undefined,
      decidedDate: data.decidedDate ? new Date(data.decidedDate) : undefined,
      aliases: data.aliases,
    });

    if (result.created) {
      return c.json({
        reference: result.reference,
        created: true,
        message: "Reference created successfully",
      }, 201);
    } else {
      return c.json({
        reference: result.reference,
        created: false,
        message: "Existing reference found with matching ID or similar title",
      }, 200);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create reference";
    return c.json({ error: message }, 400);
  }
});

/**
 * PUT /api/government-references/:id
 * Update a reference
 */
governmentReferencesRouter.put("/:id", zValidator("json", updateReferenceSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const id = c.req.param("id");
  const data = c.req.valid("json");

  const existing = await prisma.governmentReference.findUnique({
    where: { id },
  });

  if (!existing) {
    return c.json({ error: "Reference not found" }, 404);
  }

  if (existing.mergedIntoId) {
    return c.json({ error: "Cannot update a merged reference" }, 400);
  }

  const updated = await prisma.governmentReference.update({
    where: { id },
    data: {
      title: data.title,
      shortTitle: data.shortTitle,
      sourceUrl: data.sourceUrl,
      chamber: data.chamber,
      congress: data.congress,
      status: data.status,
      category: data.category,
      description: data.description,
      fullText: data.fullText,
      signedDate: data.signedDate ? new Date(data.signedDate) : data.signedDate === null ? null : undefined,
      decidedDate: data.decidedDate ? new Date(data.decidedDate) : data.decidedDate === null ? null : undefined,
    },
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
      status: true,
      updatedAt: true,
    },
  });

  return c.json({
    reference: {
      ...updated,
      updatedAt: updated.updatedAt.toISOString(),
    },
    message: "Reference updated successfully",
  });
});

/**
 * POST /api/government-references/:id/vote
 * Vote support/oppose on a reference
 */
governmentReferencesRouter.post("/:id/vote", zValidator("json", voteSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  let referenceId = c.req.param("id");
  // CONSTITUTION ARTICLE I, SECTION 3. Only verified human beings contribute
  // to the Pulse. Checked before anything is written, so an unverified account
  // cannot move a published tally even by a single voice.
  if (!(await isVerified(user))) {
    return c.json(VERIFICATION_REQUIRED, 403);
  }

  const { position, reason: reasonGiven, anonymous } = c.req.valid("json");

  // ARTICLE IV. The request decides when it says so, in either direction;
  // otherwise the citizen's standing preference does. Applied here rather than
  // in each client so the right works from every surface that can cast a vote,
  // instead of only the ones that grew a toggle.
  const standing = await prisma.notificationPreference.findUnique({
    where: { userId: user.id },
    select: { voteAnonymously: true },
  });
  const isAnonymous = anonymous ?? standing?.voteAnonymously ?? false;

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
  });

  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  // A vote on a card that was merged away belongs to the law it merged into —
  // one master record per law, one vote per citizen.
  if (reference.mergedIntoId) {
    referenceId = reference.mergedIntoId;
  }

  // Check for existing vote
  const existingVote = await prisma.governmentReferenceVote.findUnique({
    where: {
      governmentReferenceId_userId: {
        governmentReferenceId: referenceId,
        userId: user.id,
      },
    },
  });

  let newPosition = position;
  let voteAction: "created" | "updated" | "removed" = "created";

  if (existingVote) {
    if (existingVote.position === position) {
      // Same vote - remove it (toggle off)
      await prisma.governmentReferenceVote.delete({
        where: { id: existingVote.id },
      });
      voteAction = "removed";
      newPosition = position; // Keep for stats calculation
    } else {
      // Different vote - update it
      await prisma.governmentReferenceVote.update({
        where: { id: existingVote.id },
        data: { position, isAnonymous },
      });
      voteAction = "updated";
    }
  } else {
    // Create new vote
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: referenceId,
        userId: user.id,
        position,
        isAnonymous,
      },
    });
  }

  // KEEP THE RECORD. The vote row holds where they stand now; this remembers
  // that they took the position at all, on which version of the text, and why
  // if they said. Not awaited — a vote must not fail because its history did.
  void recordPosition({
    userId: user.id,
    referenceId,
    position: voteAction === "removed" ? "withdrawn" : newPosition,
    reason: reasonGiven,
    isAnonymous,
  });

  // Recalculate and persist WEIGHTED vote counts: each vote carries the
  // voter's own voice plus any active delegations covering this category.
  const tally = await applyWeightedTally(referenceId);

  // TELL THE PEOPLE WHOSE VOICE THIS JUST CARRIED, at the moment it happens
  // and while they can still override it. Not on a withdrawal: that releases
  // their voice back down the chain rather than spending it, and "your
  // delegate stopped voting" is not a thing anybody needs pushed at them.
  // Not awaited — a vote must not fail because a notification did.
  if (voteAction !== "removed") {
    void notifyVoiceUsed(
      user.id,
      user.name,
      referenceId,
      reference.title,
      newPosition,
    ).catch((error) => console.error("[Voice] could not notify delegators", error));
  }

  return c.json({
    vote: voteAction === "removed" ? null : { position: newPosition },
    voteAction,
    votes: {
      support: tally.support,
      oppose: tally.oppose,
      total: tally.support + tally.oppose,
    },
  });
});

/**
 * DELETE /api/government-references/:id/vote
 * Remove vote from a reference
 */
governmentReferencesRouter.delete("/:id/vote", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const referenceId = c.req.param("id");

  try {
    await prisma.governmentReferenceVote.delete({
      where: {
        governmentReferenceId_userId: {
          governmentReferenceId: referenceId,
          userId: user.id,
        },
      },
    });
  } catch {
    // Vote doesn't exist, that's okay
  }

  void recordPosition({ userId: user.id, referenceId, position: "withdrawn" });

  // Recalculate and persist WEIGHTED vote counts (delegations included)
  const tally = await applyWeightedTally(referenceId);

  return c.json({
    votes: {
      support: tally.support,
      oppose: tally.oppose,
      total: tally.support + tally.oppose,
    },
  });
});

/**
 * GET /api/government-references/:id/posts
 * Get all posts about this reference
 */
governmentReferencesRouter.get("/:id/posts", zValidator("query", paginationSchema), async (c) => {
  const referenceId = c.req.param("id");
  const { limit, cursor } = c.req.valid("query");
  const viewerId = c.get("user")?.id;

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, mergedIntoId: true, referenceType: true, title: true },
  });

  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  // If merged, redirect to target
  if (reference.mergedIntoId) {
    return c.json({
      error: "This reference has been merged",
      redirectTo: reference.mergedIntoId,
    }, 301);
  }

  const posts = await prisma.post.findMany({
    where: { governmentReferenceId: referenceId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      media: {
        select: {
          id: true,
          type: true,
          url: true,
          thumbnailUrl: true,
          mimeType: true,
        },
      },
      _count: {
        select: {
          comments: true,
          likes: true,
          shares: true,
          reposts: true,
        },
      },
      // WHO HAS ALREADY LIKED IT — for this reader only, one row at most.
      // Without it a like button cannot render its own state, so the card
      // either lies about whether you have liked something or does not offer
      // the button at all. This endpoint offered neither, and that is why the
      // record page had no conversation on it: the payload could not satisfy
      // the app's own Post type, so the section was imported and never built.
      ...(viewerId
        ? {
            likes: { where: { userId: viewerId }, select: { id: true }, take: 1 },
            reposts: { where: { authorId: viewerId }, select: { id: true }, take: 1 },
          }
        : {}),
    },
  });

  const hasMore = posts.length > limit;
  const results = hasMore ? posts.slice(0, -1) : posts;
  const nextCursor = hasMore && results.length > 0 ? results[results.length - 1]?.id : undefined;

  return c.json({
    posts: results.map((post) => ({
      id: post.id,
      content: post.content,
      // THE LAW THIS POST IS ABOUT. Every post here is about this record by
      // definition, and the client's Post type requires it — a card with no
      // reference cannot show what is being discussed, or link back to it.
      referenceType: reference.referenceType,
      referenceId: referenceId,
      referenceTitle: reference.title,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: publicHandle(post.author),
        avatar: post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      media: post.media.map((m) => ({
        id: m.id,
        type: m.type,
        url: publicUrlFor(m.url),
        thumbnailUrl: m.thumbnailUrl ? publicUrlFor(m.thumbnailUrl) : null,
        mimeType: m.mimeType,
      })),
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      sharesCount: post._count.shares,
      repostsCount: post._count.reposts,
      isLiked: Array.isArray((post as { likes?: unknown[] }).likes)
        ? ((post as { likes: unknown[] }).likes.length > 0)
        : false,
      isRepostedByMe: Array.isArray((post as { reposts?: unknown[] }).reposts)
        ? ((post as { reposts: unknown[] }).reposts.length > 0)
        : false,
      createdAt: post.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
});

/**
 * POST /api/government-references/:id/alias
 * Add an alias to a reference
 */
governmentReferencesRouter.post("/:id/alias", zValidator("json", addAliasSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const referenceId = c.req.param("id");
  const { alias } = c.req.valid("json");

  try {
    const result = await addAlias(referenceId, alias);
    return c.json({
      success: true,
      aliases: result.aliases,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add alias";
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/government-references/merge
 * Merge duplicate references (admin only)
 */
governmentReferencesRouter.post("/merge", zValidator("json", mergeSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  // Merging rewrites which reference every affected post and vote belongs to,
  // so it is restricted to staff.
  const actor = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });

  // This named "admin", "moderator" and "superadmin" literally, which meant a
  // role the owner created — however many capabilities they gave it — could
  // never merge anything. Roles are configurable now, so the question this asks
  // is the capability, not the name.
  if (!actor) {
    return c.json({ error: "Administrator access required" }, 403);
  }
  const denial = await requireCapability(actor.role, "merges.decide");
  if (denial) {
    return c.json(denial, 403);
  }

  const { sourceId, targetId } = c.req.valid("json");

  try {
    // The full report goes back, not a success flag. Whoever approved this
    // merge has to be able to see what it actually did to the count, and an
    // audit trail assembled from "success: true" is not an audit trail.
    const result = await mergeReferences(sourceId, targetId);
    console.log(
      `[merge] ${result.source.masterReferenceId} -> ${result.target.masterReferenceId} by ${user.id}: ` +
        `${result.postsMoved} posts, ${result.votesMoved} votes moved, ` +
        `${result.votesSuperseded} superseded, tally now ${result.tally.support}-${result.tally.oppose}`,
    );
    return c.json({ success: true, merge: result, message: "References merged successfully" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to merge references";
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/government-references/:id/recalculate-stats
 * Recalculate engagement stats for a reference
 */
governmentReferencesRouter.post("/:id/recalculate-stats", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const referenceId = c.req.param("id");

  try {
    const stats = await recalculateReferenceStats(referenceId);
    return c.json({
      success: true,
      stats,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to recalculate stats";
    return c.json({ error: message }, 400);
  }
});

/**
 * POST /api/government-references/:id/brief
 *
 * The one thing the "Get Citizen Brief" button does.
 *
 * WHY IT IS A BUTTON. Opening a law used to start this work by itself, and the
 * client polled a status the server could get permanently stuck on, so a reader
 * who did nothing at all could end up watching a spinner forever. Reading a law
 * and paying a model to summarize it are different acts, and only the second one
 * should need a person to ask for it.
 *
 * Answers with one of four states, and never with a promise it cannot keep:
 *
 *   ready        the brief, written from the complete official text
 *   working      genuinely being written right now; ask again shortly
 *   unavailable  no official source publishes the text, so there is nothing to
 *                write from and we will not guess
 *
 * `force` rewrites a brief that is already current. Everything else reuses:
 * a brief is written once per version of the law, however many people ask.
 *
 * No auth. Reading a law is public, and so is asking for its summary — the
 * work is bounded per reference by the in-flight guard in ensureReferenceContent,
 * not by who is signed in.
 */
const BRIEF_SELECT = {
  id: true,
  masterReferenceId: true,
  mergedIntoId: true,
  contentStatus: true,
  contentStartedAt: true,
  citizenBriefJson: true,
  citizenBriefVersion: true,
  lawVersion: true,
  referenceType: true,
  status: true,
} as const;

/**
 * The record that actually holds this law's brief.
 *
 * Two filings of one bill get merged into a single master reference, and the
 * loser keeps a tombstone pointing at the survivor. Anything holding the older
 * id — a shared link, a post attached before the merge, a cached query — must
 * still get the survivor's brief, because "one law, one brief" is the whole
 * point of merging them. Answering "this reference has been merged" would send
 * the reader to write a second brief for a law that already has one.
 *
 * Merges flatten their chains as they happen, so one hop is the normal case.
 * The loop is a guard against a chain that somehow survived, and it is bounded:
 * a cycle must end the walk rather than hang the request.
 */
async function briefOwner(startId: string) {
  let row = await prisma.governmentReference.findUnique({
    where: { id: startId },
    select: BRIEF_SELECT,
  });

  const seen = new Set<string>();
  while (row?.mergedIntoId) {
    if (seen.has(row.id)) {
      console.error(`[Brief] merge cycle reached from ${startId}; stopping at ${row.id}`);
      return row;
    }
    seen.add(row.id);
    const next = await prisma.governmentReference.findUnique({
      where: { id: row.mergedIntoId },
      select: BRIEF_SELECT,
    });
    // A tombstone pointing at nothing is worse than a tombstone: serve what we
    // have rather than 404 a law the reader can see.
    if (!next) return row;
    row = next;
  }

  return row;
}

governmentReferencesRouter.post("/:id/brief", async (c) => {
  const requestedId = c.req.param("id");

  const row = await briefOwner(requestedId);
  if (!row) return c.json({ error: "Reference not found" }, 404);

  /*
   * WHO ASKED FOR THIS BRIEF.
   *
   * This is the only route in the platform that can spend money on a model, and
   * "it started by itself" is a claim nobody could check: a page that REPORTS a
   * brief being written looks exactly like a page that STARTED one. Reported as
   * "its auto fetching the citizen brief", and reading the code could only
   * establish that nothing in it does that — which is not the same as proof.
   *
   * So every arrival here says so, in the log, with enough to settle it: which
   * record, whether a signed-in person or an anonymous reader, where the click
   * came from, and whether this call could actually cause a write. No names,
   * no addresses — a user id that the admin log already carries, and nothing
   * more. It costs nothing and it turns an argument into a fact.
   */
  console.log(
    `[Brief] asked for ${row.id}` +
      ` by ${c.get("user")?.id ?? "an anonymous reader"}` +
      ` from ${c.req.header("referer") ?? "an unnamed page"}` +
      ` (force=${c.req.query("force") === "true"})`,
  );

  // Everything below writes to and reads from the surviving record, so two
  // filings of one law share one brief and one model call.
  const referenceId = row.id;

  const force = c.req.query("force") === "true";
  const state = briefState(row);

  // Already written for this version of the law: hand it over without paying
  // for it again. This is the common case once one person has asked.
  if (state === "ready" && !force) {
    return c.json({
      state: "ready",
      brief: parseBrief(row.citizenBriefJson),
      lawVersion: row.lawVersion,
      briefVersion: row.citizenBriefVersion,
      // Which record answered. Differs from the id asked for when that one has
      // been merged away, so a client holding an old link can follow along.
      referenceId,
      masterReferenceId: row.masterReferenceId,
    });
  }

  // Someone else asked moments ago and it is genuinely running. Say so rather
  // than starting a second write of the same brief.
  if (state === "working" && !force) {
    return c.json({ state: "working", startedAt: row.contentStartedAt?.toISOString() ?? null });
  }

  const startedAt = Date.now();

  // Claim the work before doing any of it, so a second reader arriving during
  // the model call is told "working" instead of starting their own run.
  if (!isWorking(row.contentStatus) || isAbandoned(row) || force) {
    await markWorking(referenceId, "fetching");
  }

  try {
    // Inline: this request IS the wait. The reader pressed a button and is
    // watching, so handing the work to a background queue and asking them to
    // poll adds a failure mode without adding speed.
    // A REAL WALL, not a number passed downstream and hoped about.
    //
    // THE BUG THIS FIXES. BRIEF_REQUEST_DEADLINE_MS was handed to the content
    // fetcher, which honoured it for DOWNLOADS — and the model calls that
    // follow ran outside it entirely. Nothing ever stopped the work, so the
    // deadline was only consulted after the work came back, which is no
    // deadline at all. A slow generation held the request open until the
    // browser gave up: "now it just loads indefinitely."
    //
    // Racing it against a timer is the difference between a budget and a wish.
    // When the timer wins, the work is handed to the background queue — which
    // has no request attached and can take as long as it needs — and the reader
    // is told it is being written, which is true.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ranLong = Symbol("ran-long");
    const outcome = await Promise.race([
      ensureReferenceContent(referenceId, {
        force,
        deadlineMs: BRIEF_REQUEST_DEADLINE_MS,
        generateBriefInline: true,
      }).then(() => "done" as const),
      new Promise<typeof ranLong>((resolve) => {
        timer = setTimeout(() => resolve(ranLong), BRIEF_REQUEST_DEADLINE_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    if (outcome === ranLong) {
      // The generation keeps running; it is not cancelled, because the work is
      // worth finishing and the next reader gets it for nothing.
      enqueueBriefGeneration(referenceId);
      await markWorking(referenceId, "brief_pending").catch(() => undefined);
      console.warn(
        `[Brief] ${referenceId} passed ${BRIEF_REQUEST_DEADLINE_MS}ms — handed to the queue`,
      );
      return c.json({
        state: "working",
        startedAt: new Date(startedAt).toISOString(),
        note: "This one is taking longer than a page should wait. It is still being written — come back in a moment.",
      });
    }
  } catch (error) {
    // A thrown job must not leave the row claiming to be busy — that is the
    // exact shape of the bug this endpoint replaces.
    await markSettled(referenceId, "unavailable").catch(() => undefined);

    // LOGGED WITH ENOUGH TO TELL WHICH KIND OF FAILURE THIS IS.
    //
    // The old line printed the error and nothing else, so "the brief could not
    // be written" was the only thing anybody outside the process ever learned —
    // and the reports that reached us were "certain laws will not brief", with
    // no way to see what those laws had in common. Length and elapsed time are
    // what separate "this document is enormous" from "the model refused" from
    // "the source timed out", and all three wear the same message on screen.
    const elapsedMs = Date.now() - startedAt;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      `[Brief] generation failed for ${referenceId} ` +
        `(${row.masterReferenceId ?? "no mrid"}, ${row.referenceType}, after ${elapsedMs}ms): ${detail}`
    );

    // A law long enough to exhaust the request budget will exhaust it again on
    // every retry, so "Try again" was an instruction that could never work.
    // Hand it to the background queue, which has no request attached to it, and
    // say what is actually happening.
    const ranOutOfTime = elapsedMs >= BRIEF_REQUEST_DEADLINE_MS || /timeout|abort|deadline/i.test(detail);
    if (ranOutOfTime) {
      enqueueBriefGeneration(referenceId);
      await markWorking(referenceId, "brief_pending").catch(() => undefined);
      return c.json(
        {
          state: "working",
          code: "too_long_for_one_request",
          reason:
            "This document is long enough that it cannot be read inside a single request. " +
            "It is being written in the background now — come back in a few minutes.",
        },
        200
      );
    }

    return c.json(
      {
        state: "unavailable",
        code: "generation_failed",
        reason: "The brief could not be written just now. Try again.",
      },
      200
    );
  }

  const after = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: {
      contentStatus: true,
      contentStartedAt: true,
      citizenBriefJson: true,
      citizenBriefVersion: true,
      lawVersion: true,
      referenceType: true,
      status: true,
      fullTextUrl: true,
      sourceUrl: true,
    },
  });

  if (!after) return c.json({ error: "Reference not found" }, 404);

  const settled = briefState(after);

  if (settled === "ready") {
    return c.json({
      state: "ready",
      brief: parseBrief(after.citizenBriefJson),
      lawVersion: after.lawVersion,
      briefVersion: after.citizenBriefVersion,
      referenceId,
      masterReferenceId: row.masterReferenceId,
    });
  }

  if (settled === "working") {
    // Still going past our deadline — a long bill in several passes. The work
    // continues; the client asks again.
    return c.json({ state: "working", startedAt: after.contentStartedAt?.toISOString() ?? null });
  }

  // Say which step failed, because these are different problems with different
  // fixes and only one of them is about the law.
  //
  // This endpoint used to answer "the official text isn't published anywhere we
  // can read yet" for every unavailable outcome, including the case where the
  // full text was sitting in the row and the writer had failed. Read across a
  // few records that message says the platform cannot reach the government —
  // which is how a broken brief writer got reported as a broken source, for all
  // three branches at once, while every source key was valid and working.
  //
  // Asked as a length so a multi-megabyte column never crosses the wire to
  // answer a yes/no question.
  const rows = await prisma.$queryRaw<Array<{ chars: number }>>`
    SELECT COALESCE(LENGTH("fullText"), 0)::int AS chars
    FROM "GovernmentReference" WHERE "id" = ${referenceId}
  `;
  const chars = rows[0]?.chars ?? 0;

  if (chars > 0) {
    // A GENERATION THAT FAILED GETS ANOTHER GO, WITHOUT A PERSON ASKING.
    //
    // The request is on a short clock because a browser is waiting behind a
    // proxy that hangs up at two minutes. The queue is not: nothing is watching
    // it, so it gets five minutes and can finish a law this request could not.
    // Without this, a brief that merely ran out of time was recorded as
    // "unavailable" and stayed that way until somebody pressed the button
    // again — which is the reader doing the retrying by hand.
    enqueueBriefGeneration(referenceId);

    // WHY IT FAILED, ON THE ANSWER ITSELF.
    //
    // This feature has now gone down three times, and every round began with
    // guessing because the cause lived in a log on a host nobody could read.
    // A model name that is no longer served, or a key with no access to it, is
    // not a secret — it is a fact about this deployment's configuration, and
    // hiding it has cost far more than saying it. Never a key, never a prompt.
    const [incident] = await listIncidents(1);

    return c.json({
      state: "unavailable",
      reason:
        "We have the official text of this document, but the brief could not be written " +
        "just now. Nothing is guessed at in the meantime — try again shortly.",
      step: "brief" as const,
      textChars: chars,
      sourceUrl: after.fullTextUrl ?? after.sourceUrl,
      diagnostic: incident
        ? { subject: incident.subject, detail: incident.detail, since: incident.firstSeenAt }
        : null,
    });
  }

  return c.json({
    state: "unavailable",
    reason:
      "The official text for this document isn't published anywhere we can read yet. " +
      "Rather than guess at what it says, we're not writing a brief.",
    step: "text" as const,
    textChars: 0,
    sourceUrl: after.fullTextUrl ?? after.sourceUrl,
  });
});

/**
 * POST /api/government-references/:id/refresh-content
 * Force the master reference to re-pull official text and rebuild the citizen brief,
 * bypassing the daily staleness check. Used when a reader reports the stored copy
 * looks wrong or out of date.
 */
governmentReferencesRouter.post("/:id/refresh-content", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const referenceId = c.req.param("id");
  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, mergedIntoId: true },
  });

  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }
  if (reference.mergedIntoId) {
    return c.json({ error: "Cannot refresh a merged reference" }, 400);
  }

  jobQueue.enqueue(
    JobType.GENERATE_REFERENCE_BRIEF,
    { referenceId, force: true },
    JobPriority.HIGH
  );

  await markWorking(referenceId, "fetching");

  return c.json({
    contentStatus: "fetching",
    briefState: "working" as const,
    message: "Re-pulling official text and rebuilding the citizen brief",
  });
});

/**
 * GET /api/government-references/search/duplicates
 * Search for potential duplicates of a reference
 */
governmentReferencesRouter.get("/search/duplicates", zValidator("query", z.object({
  referenceType: referenceTypeEnum,
  masterReferenceId: z.string().optional(),
  title: z.string().optional(),
  fuzzyThreshold: z.string().optional().transform((val) => val ? parseFloat(val) : 0.85),
})), async (c) => {
  const { referenceType, masterReferenceId, title, fuzzyThreshold } = c.req.valid("query");

  if (!masterReferenceId && !title) {
    return c.json({ error: "Either masterReferenceId or title is required" }, 400);
  }

  const duplicates = await findDuplicates(referenceType as ReferenceTypeValue, {
    masterReferenceId,
    title,
    fuzzyThreshold,
  });

  return c.json({
    duplicates: duplicates.map((d) => ({
      id: d.id,
      masterReferenceId: d.masterReferenceId,
      title: d.title,
      referenceType: d.referenceType,
      matchType: d.matchType,
      similarity: d.similarity,
    })),
  });
});

export { governmentReferencesRouter };

/**
 * GET /api/government-references/:id/other-side
 *
 * What people who landed on the opposite side of this actually wrote.
 *
 * NOT AN ALGORITHM, AND NOT A FEED. Every other platform's answer to "show me
 * the other side" is either an engagement model that learns outrage travels
 * furthest, or a curated panel somebody chose. Both end up selecting for the
 * worst version of the other argument, because that is what performs and what
 * is easy to argue against.
 *
 * This can do something none of them can: every post here is attached to a
 * government record, and every citizen's position on that record is known. So
 * "the other side" is not inferred from what somebody clicks or guessed from
 * their words — it is the set of people who voted the opposite way on this
 * exact bill and then wrote about it. No model, no guess, no ranking by heat.
 *
 * Ordered by the comment count on the post: the ones people actually engaged
 * with, rather than the ones that provoked the most likes. A post nobody
 * replied to is not the strongest case for anything.
 */
governmentReferencesRouter.get("/:id/other-side", async (c) => {
  const referenceId = c.req.param("id");
  const user = c.get("user");
  const limit = Math.min(Number(c.req.query("limit") ?? 5), 20);

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  // Which way the reader went. Without a position of their own there is no
  // "other" side to show them — so they are told that rather than shown a
  // side picked for them.
  const mine = user
    ? await prisma.governmentReferenceVote.findUnique({
        where: { governmentReferenceId_userId: { governmentReferenceId: referenceId, userId: user.id } },
        select: { position: true },
      })
    : null;

  if (!user || !mine) {
    return c.json({
      yourPosition: null,
      otherPosition: null,
      results: [],
      reason: "take-a-position-first",
    });
  }

  const otherPosition = mine.position === "support" ? "oppose" : "support";

  // ARTICLE IV. "The other side" names people by the way they voted, so it can
  // only be built from positions somebody put their name to. An anonymous
  // voter who also wrote a post is reachable through the post like anybody
  // else; what this must not do is announce how they voted.
  const theirVotes = await prisma.governmentReferenceVote.findMany({
    where: {
      governmentReferenceId: referenceId,
      position: otherPosition,
      isAnonymous: false,
    },
    select: { userId: true },
  });
  if (theirVotes.length === 0) {
    return c.json({ yourPosition: mine.position, otherPosition, results: [], reason: "nobody-yet" });
  }

  const hidden = await hiddenFrom(user.id);
  const authorIds = theirVotes.map((v) => v.userId).filter((id) => !hidden.includes(id));

  const posts = await prisma.post.findMany({
    where: {
      governmentReferenceId: referenceId,
      authorId: { in: authorIds },
      // A repost carries somebody else's words; the other side should be in
      // their own.
      repostOfId: null,
      content: { not: "" },
    },
    orderBy: [{ comments: { _count: "desc" } }, { createdAt: "desc" }],
    take: limit,
    include: {
      author: { select: { id: true, name: true, username: true, displayUsername: true, image: true } },
      _count: { select: { comments: true, likes: true } },
    },
  });

  return c.json({
    yourPosition: mine.position,
    otherPosition,
    results: posts.map((post) => ({
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: publicHandle(post.author),
        avatar:
          post.author.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.author.id}`,
      },
      commentsCount: post._count.comments,
      likesCount: post._count.likes,
      createdAt: post.createdAt.toISOString(),
    })),
    reason: posts.length === 0 ? "nobody-wrote" : null,
  });
});

/**
 * GET /api/government-references/:id/pulse-history
 *
 * When opinion on this moved, and whether the text moved with it.
 *
 * The vote table can only ever say what the Pulse is now. This says what it
 * was, which is the question people actually ask about a contested bill — and
 * it marks the day the law changed, because on this platform that is usually
 * the answer.
 */
governmentReferencesRouter.get("/:id/pulse-history", async (c) => {
  const referenceId = c.req.param("id");

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  const points = await pulseOverTime(referenceId);
  return c.json({ points, count: points.length });
});

/**
 * GET /api/government-references/:id/turning-points
 *
 * Who changed their mind on this, which way, and why.
 *
 * Registered after the export above for the same reason the rest of this file
 * is: these are static suffixes on `/:id`, and Hono matches in registration
 * order, so they must never move below a bare `/:id` handler.
 */
governmentReferencesRouter.get("/:id/turning-points", async (c) => {
  const referenceId = c.req.param("id");
  const user = c.get("user");
  const limit = Math.min(Number(c.req.query("limit") ?? 10), 50);

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  return c.json(await turningPoints(referenceId, user?.id ?? null, limit));
});


/**
 * GET /api/government-references/:id/representation-gap
 *
 * What the citizens here said, against what the chamber actually did.
 *
 * Returns 200 with `gap: null` rather than a 404 when there is nothing to
 * compare — no roll call yet, or too few voices here to call it a public. The
 * clients hide the panel on null, which is how an absent feature stays absent
 * instead of becoming an invented number.
 */
governmentReferencesRouter.get("/:id/representation-gap", async (c) => {
  const referenceId = c.req.param("id");

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  // The status, not just the number. A page that is told only "null" can do
  // nothing but hide the section, which is what made this look missing.
  return c.json(await gapStatus(referenceId));
});

/**
 * GET /api/government-references/:id/official-vote
 *
 * How every member voted on the chamber's latest roll call for this record —
 * the half that lets somebody find their own delegation and see what was done
 * with their representation.
 */
governmentReferencesRouter.get("/:id/official-vote", async (c) => {
  const referenceId = c.req.param("id");

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true },
  });
  if (!reference) {
    return c.json({ error: "Reference not found" }, 404);
  }

  return c.json({ roll: await officialVoteRoll(referenceId) });
});
