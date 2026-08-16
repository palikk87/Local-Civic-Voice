import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { prisma } from "../prisma";
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
import { applyWeightedTally } from "../services/delegation-service";
import { namesFor } from "../services/reference-names";
import { formatReferenceDisplayId, referenceIdSearchVariants } from "../services/reference-id";
import { ensureReferenceContent, parseBriefJson, briefSectionLabels } from "../services/reference-content";
import { resolveLibraryDocument } from "../services/library-resolve";
import { libraryResolveRequestSchema } from "../types";
import { JobPriority, JobType, jobQueue } from "../services/job-queue";

type AuthVariables = {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
};

const governmentReferencesRouter = new Hono<{ Variables: AuthVariables }>();

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
  const topReferences = withTrendingScore.slice(0, limit);

  // The caller's standing vote on each law, so every card can light it up.
  const userVotesByRef = await loadUserVotes(
    c.get("user")?.id,
    topReferences.map((r) => r.id)
  );

  return c.json({
    references: topReferences.map((ref) => ({
      id: ref.id,
      masterReferenceId: ref.masterReferenceId,
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
 * GET /api/government-references/:id
 * Get a single reference with full details and engagement stats
 */
governmentReferencesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const existing = await prisma.governmentReference.findUnique({
    where: { id },
    select: { id: true, mergedIntoId: true },
  });

  // The master reference is the cache and the first place we look. If this is the
  // first time anyone has opened this law, pull the official text from the source
  // chain now and store it here; the citizen brief is queued so the reader isn't
  // left waiting on the model. Already stored and still current? This is a no-op.
  if (existing && !existing.mergedIntoId) {
    await ensureReferenceContent(id).catch((error) => {
      console.error(`[RefContent] ensure failed for ${id}:`, error);
    });
  }

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

  return c.json({
    reference: {
      id: reference.id,
      masterReferenceId: reference.masterReferenceId,
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
      // faucets render. null while the brief job is still running (contentStatus
      // tells the client whether to poll or offer a manual generate).
      citizenBriefSections: parseBriefJson(reference.citizenBriefJson),
      citizenBriefLabels: briefSectionLabels(reference.referenceType, reference.status),
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
      select: { contentStatus: true, citizenBriefJson: true },
    });

    // Mark the row as working BEFORE responding. The client polls GET /:id, and a
    // null status there reads as "nothing is happening" — it would stop polling
    // before the brief ever lands.
    let contentStatus = row?.contentStatus ?? null;
    if (!contentStatus) {
      contentStatus = row?.citizenBriefJson ? "ready" : "fetching";
      await prisma.governmentReference.update({
        where: { id: resolved.id },
        data: { contentStatus },
      });
    }

    // Kick off the pull; don't hold the response for it. ensureReferenceContent
    // de-duplicates concurrent runs, so several readers opening the same law at
    // once still means one fetch.
    void ensureReferenceContent(resolved.id).catch((error) => {
      console.error(`[RefContent] ensure failed for ${resolved.masterReferenceId}:`, error);
    });

    return c.json({
      reference: {
        id: resolved.id,
        masterReferenceId: resolved.masterReferenceId,
        referenceType: resolved.referenceType,
        contentStatus,
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
  const { position } = c.req.valid("json");

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
        data: { position },
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
      },
    });
  }

  // Recalculate and persist WEIGHTED vote counts: each vote carries the
  // voter's own voice plus any active delegations covering this category.
  const tally = await applyWeightedTally(referenceId);

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
        url: `/uploads${m.url}`,
        thumbnailUrl: m.thumbnailUrl ? `/uploads${m.thumbnailUrl}` : null,
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

  await prisma.governmentReference.update({
    where: { id: referenceId },
    data: { contentStatus: "fetching" },
  });

  return c.json({
    contentStatus: "fetching",
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
