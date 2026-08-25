import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
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
import { resolveLibraryDocument } from "../services/library-resolve";
import { libraryResolveRequestSchema } from "../types";
import { JobPriority, JobType, enqueueBriefGeneration, jobQueue } from "../services/job-queue";
import { briefState, isAbandoned, isWorking, markSettled, markWorking } from "../services/brief-state";

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
    OR?: Array<{ title: { contains: string } } | { shortTitle: { contains: string } } | { masterReferenceId: { contains: string } }>;
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
    // Ids are stored hyphenated and lowercase but read as printed ("H.R. 4836"),
    // so match every plausible spelling of what was typed, not just the literal.
    where.OR = [
      { title: { contains: search } },
      { shortTitle: { contains: search } },
      ...referenceIdSearchVariants(search).map((variant) => ({
        masterReferenceId: { contains: variant },
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
    references: results.map((ref) => ({
      id: ref.id,
      masterReferenceId: ref.masterReferenceId,
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
    })),
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
    references: topReferences.map((ref) => ({
      id: ref.id,
      masterReferenceId: ref.masterReferenceId,
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
    })),
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

  const reference = await prisma.governmentReference.findUnique({
    where: { id },
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

  return c.json({
    reference: {
      id: reference.id,
      masterReferenceId: reference.masterReferenceId,
      displayId: formatReferenceDisplayId(reference.masterReferenceId, reference.referenceType),
      referenceType: reference.referenceType,
      title: reference.title,
      shortTitle: reference.shortTitle,
      sourceUrl: reference.sourceUrl,
      chamber: reference.chamber,
      congress: reference.congress,
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

  const reference = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, mergedIntoId: true },
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
          email: true,
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
        },
      },
    },
  });

  const hasMore = posts.length > limit;
  const results = hasMore ? posts.slice(0, -1) : posts;
  const nextCursor = hasMore && results.length > 0 ? results[results.length - 1]?.id : undefined;

  return c.json({
    posts: results.map((post) => ({
      id: post.id,
      content: post.content,
      author: {
        id: post.author.id,
        displayName: post.author.name,
        username: post.author.email.split("@")[0],
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

  if (!actor || !["admin", "moderator", "superadmin"].includes(actor.role)) {
    return c.json({ error: "Administrator access required" }, 403);
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
    await ensureReferenceContent(referenceId, {
      force,
      deadlineMs: BRIEF_REQUEST_DEADLINE_MS,
      generateBriefInline: true,
    });
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
    return c.json({
      state: "unavailable",
      reason:
        "We have the official text of this document, but the brief could not be written " +
        "just now. Nothing is guessed at in the meantime — try again shortly.",
      step: "brief" as const,
      textChars: chars,
      sourceUrl: after.fullTextUrl ?? after.sourceUrl,
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
      author: { select: { id: true, name: true, email: true, image: true } },
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
        username: post.author.email.split("@")[0],
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
