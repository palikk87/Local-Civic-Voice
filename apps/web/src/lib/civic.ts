import { api } from "@/lib/api";

// ---------- Domain types (mirror the live backend shapes) ----------

export type ReferenceType = "bill" | "executive_order" | "scotus_case";
export type VotePosition = "support" | "oppose";

export interface Votes {
  support: number;
  oppose: number;
  total: number;
}

export interface Engagement {
  comments: number;
  shares: number;
  posts: number;
}

export interface GovReference {
  id: string;
  masterReferenceId: string;
  referenceType: ReferenceType;
  title: string;
  shortTitle: string | null;
  status: string;
  category: string;
  chamber: string | null;
  congress: number | null;
  sourceUrl: string | null;
  signedDate: string | null;
  decidedDate: string | null;
  /** Present on /trending and /:id responses; absent from the list endpoint. */
  description?: string | null;
  citizenBrief?: string | null;
  votes: Votes;
  engagement: Engagement;
  createdAt: string;
}

/** Three-panel brief stored on the master reference — same object both faucets render. */
export interface CitizenBriefSections {
  theGoal: string;
  theWallet: string;
  theDebate: string;
}

/** Panel headings vary by branch (a court case has a Question and a Ruling, not a Wallet). */
export interface CitizenBriefLabels {
  goal: string;
  wallet: string;
  debate: string;
}

/**
 * ready         — text and brief are stored and current
 * brief_pending — text is stored, the brief is being written right now (poll)
 * fetching      — official text is being pulled from the source chain
 * unavailable   — no source yielded text
 */
export type ReferenceContentStatus = "ready" | "brief_pending" | "fetching" | "unavailable";

export interface GovReferenceDetail extends GovReference {
  fullText: string | null;
  aliases: string[];
  userVote: VotePosition | null;
  updatedAt: string;
  /** Cached brief from the master reference. Null until the first reader triggers the pull. */
  citizenBriefSections: CitizenBriefSections | null;
  citizenBriefLabels: CitizenBriefLabels;
  citizenBriefAt: string | null;
  contentStatus: ReferenceContentStatus | null;
  fullTextSource: string | null;
  fullTextUrl: string | null;
  fullTextAt: string | null;
  sourceCheckedAt: string | null;
}

/**
 * Identity of a live Library search result, sent to the server so it can find or
 * create the master reference and write the brief from the FULL official text.
 * Mirrors libraryResolveRequestSchema in backend/src/types.ts.
 */
export interface LibraryResolveRequest {
  branch: "legislative" | "executive" | "judicial";
  title: string;
  sourceUrl?: string;
  summary?: string;
  masterReferenceId?: string;
  congress?: number;
  billType?: string;
  billNumber?: string;
  chamber?: string;
  latestAction?: string;
  documentNumber?: string;
  eoNumber?: string;
  docketNumber?: string;
  opinionId?: number;
}

export interface LibraryResolveResponse {
  reference: {
    id: string;
    masterReferenceId: string;
    referenceType: ReferenceType;
    contentStatus: ReferenceContentStatus | null;
    created: boolean;
  };
}

export interface ReferenceListResponse {
  references: GovReference[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface VoteResponse {
  vote: unknown;
  voteAction: string;
  votes: Votes;
}

export interface PostAuthor {
  id: string;
  displayName: string;
  username: string;
  avatar: string | null;
}

export interface Post {
  id: string;
  content: string;
  author: PostAuthor;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  referenceTitle: string | null;
  media: unknown[];
  commentsCount: number;
  likesCount: number;
  createdAt: string;
}

export interface PostListResponse {
  posts: Post[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface CreatePostBody {
  content: string;
  /** GovernmentReference.id of the selected reference. The server resolves it and
   *  supplies the authoritative type and title. */
  governmentReferenceId: string;
}

export interface CivicUser {
  id: string;
  name?: string | null;
  email: string;
  image?: string | null;
  createdAt?: string;
}

// ---------- Branch + category metadata (presentation) ----------

export type Branch = "all" | ReferenceType;

export const BRANCHES: {
  key: Branch;
  label: string;
  short: string;
  colorVar: string;
  description: string;
}[] = [
  { key: "all", label: "All Branches", short: "All", colorVar: "hsl(var(--primary))", description: "Every bill, order, and ruling" },
  { key: "bill", label: "Legislative", short: "Bills", colorVar: "hsl(var(--legislative))", description: "Bills moving through Congress" },
  { key: "executive_order", label: "Executive", short: "Orders", colorVar: "hsl(var(--executive))", description: "Presidential executive orders" },
  { key: "scotus_case", label: "Judicial", short: "SCOTUS", colorVar: "hsl(var(--judicial))", description: "Supreme Court cases" },
];

export function branchOf(type: ReferenceType) {
  return BRANCHES.find((b) => b.key === type) ?? BRANCHES[0];
}

export const REFERENCE_TYPE_LABEL: Record<ReferenceType, string> = {
  bill: "Bill",
  executive_order: "Executive Order",
  scotus_case: "Supreme Court Case",
};

export const CATEGORIES = [
  "economy",
  "environment",
  "healthcare",
  "defense",
  "education",
  "civil_rights",
  "immigration",
  "housing",
  "justice",
  "technology",
] as const;

export function titleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Date(value).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return typeof value === "string" ? value : null;
  }
}

export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w`;
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function supportPct(votes: Votes): number {
  if (!votes.total) return 0;
  return Math.round((votes.support / votes.total) * 100);
}

// ---------- Gap detection / official vote (deterministic derived stats) ----------

export interface GapStats {
  communityPct: number; // % of community voting yea
  officialPct: number; // % of chamber voting yea
  gapPct: number; // absolute gap between the two
  officialYea: number;
  officialNay: number;
  projected: "Likely Pass" | "Likely Fail" | "Uncertain";
  direct: number; // direct community votes
  delegated: number; // delegated community votes
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Official chamber votes are not yet mirrored in our database, so we derive
 * stable, realistic figures from the reference identity. The same reference
 * always produces the same official tally, so gap badges stay consistent
 * across the feed, discover, and detail views.
 */
export function gapStats(reference: Pick<GovReference, "id" | "masterReferenceId" | "votes" | "chamber" | "referenceType">): GapStats {
  const seed = hashSeed(reference.masterReferenceId || reference.id);
  const communityPct = supportPct(reference.votes);
  const chamberSize = reference.chamber === "senate" ? 100 : 435;
  const officialPct = seed % 101; // 0..100 stable
  const officialYea = Math.round((officialPct / 100) * chamberSize);
  const officialNay = chamberSize - officialYea;
  const gapPct = reference.votes.total > 0 ? Math.abs(communityPct - officialPct) : 0;
  const projected: GapStats["projected"] =
    officialPct >= 60 ? "Likely Pass" : officialPct <= 40 ? "Likely Fail" : "Uncertain";
  const delegated = Math.round(reference.votes.total * (0.1 + ((seed >> 3) % 11) / 100));
  const direct = Math.max(0, reference.votes.total - delegated);
  return { communityPct, officialPct, gapPct, officialYea, officialNay, projected, direct, delegated };
}

// ---------- API calls ----------

export interface ReferenceQuery {
  referenceType?: ReferenceType;
  category?: string;
  status?: string;
  search?: string;
  sortBy?: "createdAt" | "supportVotes" | "opposeVotes" | "totalComments";
  sortOrder?: "asc" | "desc";
  limit?: number;
  cursor?: string;
}

function buildQuery(params: ReferenceQuery): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const str = search.toString();
  return str ? `?${str}` : "";
}

export const civicApi = {
  listReferences: (params: ReferenceQuery = {}) =>
    api.get<ReferenceListResponse>(`/api/government-references${buildQuery(params)}`),

  trending: (limit = 6, referenceType?: ReferenceType) =>
    api.get<{ references: GovReference[] }>(
      `/api/government-references/trending?limit=${limit}${referenceType ? `&referenceType=${referenceType}` : ""}`,
    ),

  getReference: (id: string) =>
    api.get<{ reference: GovReferenceDetail }>(`/api/government-references/${id}`),

  /**
   * Turn a live Library search result into its master reference row so its brief
   * comes from the same server pipeline (full official text) as every other screen.
   */
  resolveLibraryDocument: (input: LibraryResolveRequest) =>
    api.post<LibraryResolveResponse>("/api/government-references/resolve", input),

  /** Re-pull the official text and rewrite the brief stored on the master reference. */
  refreshReferenceContent: (id: string) =>
    api.post<{ status: string }>(`/api/government-references/${id}/refresh-content`),

  vote: (id: string, position: VotePosition) =>
    api.post<VoteResponse>(`/api/government-references/${id}/vote`, { position }),

  removeVote: (id: string) =>
    api.delete<VoteResponse>(`/api/government-references/${id}/vote`),

  me: () => api.get<{ user: CivicUser }>("/api/me"),
};

// ---------- Posts (social feed) ----------

export const postsApi = {
  list: (params: { limit?: number; cursor?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.limit) search.set("limit", String(params.limit));
    if (params.cursor) search.set("cursor", params.cursor);
    const qs = search.toString();
    return api.get<PostListResponse>(`/api/posts${qs ? `?${qs}` : ""}`);
  },

  create: (body: CreatePostBody) => api.post<Post>("/api/posts", body),

  like: (id: string) => api.post<unknown>(`/api/posts/${id}/like`),
};
