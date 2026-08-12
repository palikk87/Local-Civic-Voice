import { z } from "zod";

/**
 * Shared API contracts (single source of truth).
 * Both backend routes and the webapp import from this file.
 */

// ---------- Congress search ----------

export const congressSearchResultSchema = z.object({
  congress: z.number(),
  number: z.string(),
  title: z.string(),
  type: z.string(),
  originChamber: z.string(),
  latestAction: z
    .object({
      actionDate: z.string(),
      text: z.string(),
    })
    .optional(),
  url: z.string(),
  /** Canonical reference id, e.g. "hr-22-119" — links search results to GovernmentReference rows. */
  masterReferenceId: z.string(),
  /** Present when this bill already exists as a reference in the app. */
  reference: z
    .object({
      id: z.string(),
      supportVotes: z.number(),
      opposeVotes: z.number(),
      totalComments: z.number(),
      postsCount: z.number(),
    })
    .nullable(),
});

export const congressSearchResponseSchema = z.object({
  results: z.array(congressSearchResultSchema),
  pagination: z.object({
    count: z.number(),
    next: z.string().optional(),
  }),
});

export type CongressSearchResult = z.infer<typeof congressSearchResultSchema>;
export type CongressSearchResponse = z.infer<typeof congressSearchResponseSchema>;

// ---------- Post-attached government reference ----------
// Every post is attached to a bill, executive order or SCOTUS case. Feed and
// timeline cards render that attachment as a law card with live vote tallies,
// so the posts endpoints ship this object alongside each post.

export const postReferenceSchema = z.object({
  id: z.string(),
  masterReferenceId: z.string(),
  /** Human-readable id as displayed, e.g. "H.R. 4836" / "EO 14147". */
  displayId: z.string(),
  referenceType: z.enum(["bill", "executive_order", "scotus_case"]),
  title: z.string(),
  shortTitle: z.string().nullable(),
  status: z.string(),
  category: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  citizenBrief: z.string().nullable(),
  votes: z.object({
    support: z.number(),
    oppose: z.number(),
    total: z.number(),
  }),
  /** The caller's own position, null when they haven't voted or aren't signed in. */
  userVote: z.enum(["support", "oppose"]).nullable(),
});

export type PostReference = z.infer<typeof postReferenceSchema>;

// ---------- Citizen brief stored on the master reference ----------
// Built once, on the first read or share of a law, and stored on the
// GovernmentReference row so every later reader on either faucet gets the same
// brief without another model call. See services/reference-content.ts.

export const citizenBriefSectionsSchema = z.object({
  theGoal: z.string(),
  theWallet: z.string(),
  theDebate: z.string(),
});

/** Headings vary by branch: a court case has a Question and a Ruling, not a Wallet. */
export const citizenBriefLabelsSchema = z.object({
  goal: z.string(),
  wallet: z.string(),
  debate: z.string(),
});

/**
 * ready         — text and brief are stored and current
 * brief_pending — text is stored, the brief is being generated right now (clients poll)
 * fetching      — official text is being pulled from the source chain
 * unavailable   — no source yielded text; the brief falls back to the official summary
 */
export const referenceContentStatusSchema = z.enum([
  "ready",
  "brief_pending",
  "fetching",
  "unavailable",
]);

export const referenceContentSchema = z.object({
  citizenBrief: z.string().nullable(),
  citizenBriefSections: citizenBriefSectionsSchema.nullable(),
  citizenBriefLabels: citizenBriefLabelsSchema,
  citizenBriefAt: z.string().nullable(),
  contentStatus: referenceContentStatusSchema.nullable(),
  fullText: z.string().nullable(),
  fullTextSource: z.string().nullable(),
  fullTextUrl: z.string().nullable(),
  fullTextAt: z.string().nullable(),
  sourceCheckedAt: z.string().nullable(),
});

export type CitizenBriefSections = z.infer<typeof citizenBriefSectionsSchema>;
export type CitizenBriefLabels = z.infer<typeof citizenBriefLabelsSchema>;
export type ReferenceContentStatus = z.infer<typeof referenceContentStatusSchema>;
export type ReferenceContent = z.infer<typeof referenceContentSchema>;

// ---------- AI generation proxy ----------
// Keeps the OpenAI API key server-side; frontend (mobile + web) send prompts here
// instead of calling OpenAI directly with a client-exposed key.

export const aiGenerateRequestSchema = z.object({
  system: z.string().optional(),
  prompt: z.string().min(1),
  model: z.string().optional(),
  maxCompletionTokens: z.number().optional(),
  temperature: z.number().optional(),
  jsonMode: z.boolean().optional(),
});

export const aiGenerateResponseSchema = z.object({
  content: z.string(),
});

export type AIGenerateRequest = z.infer<typeof aiGenerateRequestSchema>;
export type AIGenerateResponse = z.infer<typeof aiGenerateResponseSchema>;

// ---------- Government (Congress + Executive + Judicial) ----------
// Serves the Government screen on BOTH faucets (mobile + web).

export const partySchema = z.enum(["R", "D", "I"]);
export const chamberSchema = z.enum(["house", "senate"]);
export const branchSchema = z.enum(["executive", "legislative", "judicial"]);

/** A sitting member of Congress. */
export const memberSchema = z.object({
  id: z.string(), // bioguide ID
  name: z.string(),
  party: partySchema,
  partyName: z.string(),
  chamber: chamberSchema,
  state: z.string(), // 2-letter
  stateName: z.string(),
  district: z.number().nullable(),
  title: z.string(),
  /** e.g. "Speaker of the House" — present only for leadership. */
  leadershipRole: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  twitter: z.string().nullable(),
  photoUrl: z.string().nullable(),
  office: z.string().nullable(),
  servingSince: z.number().nullable(),
});

export const memberListResponseSchema = z.object({
  representatives: z.array(memberSchema),
  counts: z.object({
    house: z.number(),
    senate: z.number(),
    total: z.number(),
  }),
  congress: z.number(),
  source: z.enum(["congress.gov", "fallback"]),
  lastUpdated: z.string(),
});

/** A non-congressional official: President, VP, Cabinet, Justices. */
export const officialSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  shortTitle: z.string(),
  branch: branchSchema,
  /** "president" | "vice-president" | "cabinet" | "cabinet-rank" | "white-house" | "judicial" */
  group: z.string(),
  acting: z.boolean(),
  party: partySchema.nullable(),
  department: z.string().nullable(),
  since: z.string().nullable(),
  appointedBy: z.string().nullable(),
  photoUrl: z.string().nullable(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  bio: z.string().nullable(),
  /** Line-of-succession rank, 1 = Vice President. Null if not in the line. */
  successionOrder: z.number().nullable(),
});

export const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  abbreviation: z.string(),
  branch: branchSchema,
  established: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  headOfficialId: z.string().nullable(),
});

export const officialsResponseSchema = z.object({
  executive: z.array(officialSchema),
  judicial: z.array(officialSchema),
  departments: z.array(departmentSchema),
  succession: z.array(officialSchema),
  lastUpdated: z.string(),
  sources: z.array(z.string()),
});

export type Party = z.infer<typeof partySchema>;
export type Chamber = z.infer<typeof chamberSchema>;
export type Branch = z.infer<typeof branchSchema>;
export type Member = z.infer<typeof memberSchema>;
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;
export type Official = z.infer<typeof officialSchema>;
export type Department = z.infer<typeof departmentSchema>;
export type OfficialsResponse = z.infer<typeof officialsResponseSchema>;

// ---------- Library document → master reference ----------
// The Library screen searches the live official APIs, so its results are not yet
// rows in our database. Resolving one to its master reference is what lets the
// citizen brief be written from the full official text server-side, exactly like
// the bill / executive order / SCOTUS detail screens. Both faucets post this.

export const libraryResolveRequestSchema = z.object({
  branch: z.enum(["legislative", "executive", "judicial"]),
  title: z.string().min(1),
  sourceUrl: z.string().optional(),
  /** Search-result blurb. Stored as the row's description — never as the brief. */
  summary: z.string().optional(),
  /** Canonical id when the search endpoint already computed one. */
  masterReferenceId: z.string().optional(),
  // Legislative identity
  congress: z.number().int().positive().optional(),
  billType: z.string().optional(),
  billNumber: z.string().optional(),
  chamber: z.string().optional(),
  latestAction: z.string().optional(),
  // Executive identity
  documentNumber: z.string().optional(),
  eoNumber: z.string().optional(),
  // Judicial identity
  docketNumber: z.string().optional(),
  opinionId: z.number().int().positive().optional(),
});

export const libraryResolveResponseSchema = z.object({
  reference: z.object({
    id: z.string(),
    masterReferenceId: z.string(),
    referenceType: z.enum(["bill", "executive_order", "scotus_case"]),
    /** Where the content pipeline is: poll GET /:id until this reads "ready". */
    contentStatus: z.enum(["ready", "brief_pending", "fetching", "unavailable"]).nullable(),
    created: z.boolean(),
  }),
});

export type LibraryResolveRequest = z.infer<typeof libraryResolveRequestSchema>;
export type LibraryResolveResponse = z.infer<typeof libraryResolveResponseSchema>;
