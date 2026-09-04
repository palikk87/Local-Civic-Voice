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
  /** The readable address the server assigned. Null until it has one. */
  slug?: string | null;
  id: string;
  masterReferenceId: string;
  /**
   * The id as printed — "H.R. 4836", "S.Res. 829", "EO 14147", "No. 22-451".
   *
   * Computed on the server from the canonical id. Deriving it here instead is
   * how a resolution reached a card as "SRES.829": every client that formats a
   * raw id invents its own idea of how Congress prints one.
   */
  displayId?: string;
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
  /**
   * WHETHER A RULING IS BINDING LAW, in the Court's own vocabulary:
   * "Published", "Unpublished", "Errata", "Separate", "In-chambers",
   * "Relating-to", "Unknown".
   *
   * Null on anything that is not a court case, and on a ruling whose status we
   * have not established — the page shows nothing for either, because an empty
   * line is honest and a guessed one is not.
   */
  precedentialStatus?: string | null;
  /**
   * Real provenance from congress.gov, filled by the background pass in
   * backend/src/services/bill-provenance.ts. Null until it has been asked,
   * which the cards render as nothing — these two used to be the row's own
   * createdAt, so a 2007 statute displayed as introduced today.
   */
  introducedDate?: string | null;
  lastActionDate?: string | null;
  lastActionText?: string | null;
  /** A member, or null. It used to be the chamber's name, for every bill. */
  sponsor?: {
    bioguideId: string | null;
    name: string;
    party: string | null;
    state: string | null;
  } | null;
  /**
   * WHO IS BEHIND THIS RECORD, in one shape for all three branches.
   *
   * `sponsor` above is the legislative-only field several screens already read
   * and it stays exactly as it was. This is the one a card draws from: a name,
   * what that person did, and a face.
   *
   *   bill             "Sponsored by"        portrait built from bioguideId
   *   executive order  "Signed by"           portrait resolved server-side
   *   scotus case      "Majority opinion by" portrait resolved server-side
   *
   * Null is a real answer. A per curiam opinion has no author — that is the
   * Court speaking as one body, not an omission — and a bill whose provenance
   * pass has not run has no sponsor yet.
   */
  attribution?: {
    name: string;
    role: string;
    photoUrl: string | null;
    bioguideId?: string | null;
    party?: string | null;
    state?: string | null;
    perCuriam?: boolean;
    /** The bench, when the Court issued a ruling with no author on it. */
    panel?: Array<{ name: string; photoUrl: string | null }>;
    panelLabel?: string;
  } | null;
  /**
   * HOW COMPLETE OUR RECORD OF THIS LAW IS — the checklist behind the card's
   * badge, misses included.
   *
   * This is the platform rating its own work, not the law. Optional only
   * because an older server may not send it; the badge simply does not render.
   */
  completeness?: {
    level: "verified" | "confirmed" | "unconfirmed" | "unverified";
    label: string;
    met: number;
    applicable: number;
    checks: Array<{ id: string; label: string; met: boolean; detail: string | null }>;
  } | null;
  /** Present on /trending and /:id responses; absent from the list endpoint. */
  description?: string | null;
  citizenBrief?: string | null;
  votes: Votes;
  engagement: Engagement;
  createdAt: string;
}

/**
 * The Citizen's Brief: one neutral paragraph, then both sides.
 *
 * Written on the server from the full official text of the law and nothing
 * else — no title, no status, no summary by anybody else — because every other
 * input is a route to a confident claim the law does not make.
 */
export interface CitizenBriefSections {
  /** One paragraph, plain English, neutral: what the law does. */
  summary: string;
  /** Two to three sentences: the case for it, from the text. */
  argumentFor: string;
  /** Two to three sentences: the case against it, from the text. */
  argumentAgainst: string;
}

/**
 * ready         — text and brief are stored and current
 * brief_pending — text is stored, the brief is being written right now (poll)
 * fetching      — official text is being pulled from the source chain
 * unavailable   — no source yielded text
 */
export type ReferenceContentStatus = "ready" | "brief_pending" | "fetching" | "unavailable";

/**
 * What to show the reader, in one word — the server's collapsed answer.
 *
 * Prefer this over contentStatus. That is the raw column and it can say
 * "fetching" about work that died with the process doing it; this reports such
 * a row as `idle`, so the reader is offered the button again rather than a
 * spinner nothing will ever resolve.
 *
 *   ready        a brief written for the version of the law in front of you
 *   working      genuinely being written right now
 *   unavailable  no official source publishes the text to write from
 *   idle         nobody has asked yet — show the button
 */
export type BriefState = "ready" | "working" | "unavailable" | "idle";

/** What POST /:id/brief answers with. Exactly one of these three shapes. */
export type BriefResponse =
  | {
      state: "ready";
      brief: CitizenBriefSections;
      lawVersion: number;
      briefVersion: number | null;
      /** Which record answered — differs from the id asked for after a merge. */
      referenceId?: string;
      masterReferenceId?: string;
    }
  | { state: "working"; startedAt: string | null }
  | { state: "unavailable"; reason: string; sourceUrl?: string | null };

export interface GovReferenceDetail extends GovReference {
  /**
   * How the chamber actually voted, when it has.
   *
   * From senate.gov or clerk.house.gov. Null when Congress has taken no
   * recorded vote on this measure — which is most of them, most of the time,
   * and is why every panel keyed on this stays hidden rather than inventing a
   * tally.
   */
  officialVotes?: {
    yea: number;
    nay: number;
    present: number;
    notVoting: number;
    chamber: string;
    question: string;
    result: string;
    votedAt: string;
    sourceUrl: string;
  } | null;

  fullText: string | null;
  aliases: string[];
  userVote: VotePosition | null;
  updatedAt: string;
  /** Cached brief from the master reference. Null until the first reader triggers the pull. */
  citizenBriefSections: CitizenBriefSections | null;
  citizenBriefAt: string | null;
  contentStatus: ReferenceContentStatus | null;
  /** The collapsed state — what the brief card should render. */
  briefState: BriefState;
  /** Which version of the law the stored brief describes, against lawVersion. */
  citizenBriefVersion: number | null;
  lawVersion: number;
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
  /** CourtListener's court id. The server refuses anything but "scotus". */
  courtId?: string;
}

export interface LibraryResolveResponse {
  reference: {
    id: string;
    masterReferenceId: string;
    referenceType: ReferenceType;
    contentStatus: ReferenceContentStatus | null;
    briefState: BriefState;
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

/**
 * The law under a post, as it stands NOW.
 *
 * Sent by GET /api/posts on every list — the profile, a timeline, the feed —
 * batch-loaded server-side so a page of cards costs one query rather than one
 * per card. See backend/src/services/post-reference-view.ts.
 *
 * It was going unused by every card on the web. The server did the work,
 * computed the live tally and the caller's own position, and three separate
 * card implementations threw it away and drew a title chip instead.
 *
 * Live rather than frozen at posting time on purpose: the record is shared, and
 * the post only frames it. A tally copied into the post when it was written
 * would be wrong by the next vote.
 */
export interface PostReference {
  id: string;
  masterReferenceId: string;
  /** As printed — "H.R. 4836", "EO 14147". */
  displayId: string;
  referenceType: ReferenceType;
  title: string;
  shortTitle: string | null;
  status: string;
  category: string | null;
  sourceUrl: string | null;
  votes: Votes;
  /** The reader's own standing position on this law, or null. */
  userVote: VotePosition | null;
  /** When the LAW last moved, not when the row was written. */
  lawChangedAt: string | null;
  lawVersion: number;
}

export interface Post {
  id: string;
  content: string;
  author: PostAuthor;
  referenceType: ReferenceType | null;
  referenceId: string | null;
  referenceTitle: string | null;
  /** The law itself, live. Null when the post is not about one. */
  reference?: PostReference | null;
  /** The law under this post has moved since it was written. */
  lawUpdatedSincePosting?: boolean;
  media: unknown[];
  commentsCount: number;
  likesCount: number;
  /** Whether the person asking has already liked this. */
  isLiked?: boolean;
  repostsCount?: number;
  /** Whether the person asking has already passed this on. */
  isRepostedByMe?: boolean;
  /** The post this one passes on, when it is a repost. */
  repostOf?: {
    id: string;
    content: string;
    author: PostAuthor;
    createdAt: string;
  } | null;
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
  { key: "scotus_case", label: "SCOTUS", short: "SCOTUS", colorVar: "hsl(var(--judicial))", description: "Supreme Court cases" },
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

/**
 * "119th", "121st", "122nd", "123rd" — and nothing at all when the number is
 * missing.
 *
 * Three places printed `{congress}th` with the suffix hardcoded. Two of them
 * are the Government screens, where the congress number comes from an API
 * response and is not guarded, so before it arrived the page read "members of
 * the th Congress". The suffix is also simply wrong from the 121st Congress
 * on, which is four years away.
 */
export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  const abs = Math.abs(Math.trunc(n));
  // 11th, 12th, 13th are the exceptions to the last-digit rule.
  const teen = abs % 100 >= 11 && abs % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[abs % 10] ?? "th";
  return `${n}${suffix}`;
}

export function supportPct(votes: Votes): number {
  if (!votes.total) return 0;
  return Math.round((votes.support / votes.total) * 100);
}

// ---------- Gap detection ----------
//
// GONE, AND NOT REPLACED: gapStats() and hashSeed().
//
// gapStats() derived the official congressional vote from a hash of the
// record's own id — `officialPct = seed % 101`, scaled by chamber size — and
// from the same seed produced the projected outcome and the direct-versus-
// delegated split. Its comment called these "stable, realistic figures". They
// were stable, which is the part that makes it dangerous: a fabrication that
// never contradicts itself is one nobody catches. The Gap is this platform's
// entire premise, and this measured it against an invented roll call.
//
// It had no callers, which is the only reason it was not shipping a lie. That
// is not a reason to keep it — the next person to need a gap number would have
// found it sitting here looking authoritative.
//
// The real thing lives at GET /api/government-references/:id/representation-gap,
// which compares the published tally here against a roll call parsed from
// senate.gov or clerk.house.gov, and returns a reason rather than a number when
// there is nothing honest to say. See components/civic/RepresentationGapPanel.

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

  /**
   * Write the Citizen's Brief for this reference — what the button does.
   *
   * One request, one honest answer: the brief, "still working", or "no official
   * text to write from". Nothing here starts by itself; a brief is written only
   * because somebody asked for it, and then reused by everyone after.
   */
  getCitizenBrief: (id: string, force = false) =>
    api.post<BriefResponse>(
      `/api/government-references/${id}/brief${force ? "?force=true" : ""}`,
    ),

  /** Re-pull the official text and rewrite the brief stored on the master reference. */
  refreshReferenceContent: (id: string) =>
    api.post<{ status: string }>(`/api/government-references/${id}/refresh-content`),

  /**
   * Bill of Rights Article IV: the anonymous option.
   *
   * The vote counts either way — an anonymous position is carried into the
   * Pulse exactly like any other. What is withheld is the citizen's name, on
   * every surface that would otherwise attach it to this position.
   */
  vote: (id: string, position: VotePosition, anonymous = false) =>
    api.post<VoteResponse>(`/api/government-references/${id}/vote`, {
      position,
      ...(anonymous ? { anonymous: true } : {}),
    }),

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

  /** Keep a post. Sending it again takes it back out. */
  save: (id: string) => api.post<{ saved: boolean }>(`/api/feed/posts/${id}/save`),

  /** Record that a post was passed on. The count is the author's, not ours. */
  share: (id: string) => api.post<{ success: boolean }>(`/api/feed/posts/${id}/share`, {}),

  /**
   * Pass a post on. With `content` it is a quote — your words above theirs.
   * Without, pressing it again takes it back.
   */
  repost: (id: string, content?: string) =>
    api.post<{ reposted: boolean; repostId?: string; repostsCount: number }>(
      `/api/posts/${id}/repost`,
      content ? { content } : {},
    ),

  /** Find what people have said, not just who they are. */
  search: (q: string) =>
    api.get<{ results: PostSearchResult[] }>(`/api/posts/search?q=${encodeURIComponent(q)}`),

  /** The posts under one tag. */
  hashtag: (tag: string) =>
    api.get<{ tag: string; count: number; results: PostSearchResult[] }>(
      `/api/posts/hashtag/${encodeURIComponent(tag.replace(/^#/, ""))}`,
    ),
};

export interface PostSearchResult {
  id: string;
  content: string;
  author: PostAuthor;
  referenceTitle: string | null;
  governmentReferenceId: string | null;
  commentsCount: number;
  likesCount: number;
  createdAt: string;
}

/**
 * Blocking, muting and reporting.
 *
 * These had a menu in the UI long before they had endpoints, and the handlers
 * behind it popped an alert saying the thing had happened. Somebody being
 * harassed pressed Block and was told "you will no longer see posts from this
 * user" while nothing at all had been recorded.
 */
export const safetyApi = {
  block: (userId: string) =>
    api.post<{ success: boolean; isBlocked: boolean }>(`/api/safety/blocks/${userId}`),
  unblock: (userId: string) =>
    api.delete<{ success: boolean; isBlocked: boolean }>(`/api/safety/blocks/${userId}`),
  blocks: () => api.get<{ results: SafetyListEntry[] }>("/api/safety/blocks"),

  mute: (userId: string) =>
    api.post<{ success: boolean; isMuted: boolean }>(`/api/safety/mutes/${userId}`),
  unmute: (userId: string) =>
    api.delete<{ success: boolean; isMuted: boolean }>(`/api/safety/mutes/${userId}`),
  mutes: () => api.get<{ results: SafetyListEntry[] }>("/api/safety/mutes"),

  report: (body: {
    postId?: string;
    commentId?: string;
    userId?: string;
    reason: ReportReason;
    detail?: string;
  }) => api.post<{ success: boolean; reportId: string }>("/api/safety/reports", body),

  relationship: (userId: string) =>
    api.get<{ isBlocked: boolean; isMuted: boolean; contactClosed: boolean }>(
      `/api/safety/relationship/${userId}`,
    ),
};

export type ReportReason =
  | "spam"
  | "harassment"
  | "hate"
  | "violence"
  | "misinformation"
  | "other";

export interface SafetyListEntry {
  id: string;
  user: { id: string; name: string; username: string | null; image: string | null };
  createdAt: string;
}

/**
 * A citizen's record, and the receipts for a lent voice.
 *
 * Both answer questions this platform asks people to care about and could not
 * answer about itself: what did I say, and what was said in my name.
 */
export interface PositionRecord {
  id: string;
  position: string;
  reason: string | null;
  isChange: boolean;
  lawVersion: number;
  /** Only ever true on your own record — see Bill of Rights Article IV. */
  isAnonymous: boolean;
  lawMovedSince: boolean;
  createdAt: string;
  reference: {
    id: string;
    masterReferenceId: string;
    title: string;
    referenceType: string;
    lawVersion: number;
  };
}

export interface PositionSummary {
  total: number;
  support: number;
  oppose: number;
  withdrawn: number;
  changesOfMind: number;
  standingOnOldText: number;
}

export interface PositionNeedingReview {
  position: string;
  takenAt: string;
  takenOnVersion: number;
  nowAtVersion: number;
  lawChangedAt: string | null;
  reference: { id: string; masterReferenceId: string; title: string; referenceType: string };
}

export interface VoiceReceipt {
  referenceId: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  position: string;
  castBy: { id: string; name: string; username: string | null };
  lentTo: { id: string; name: string; username: string | null } | null;
  through: Array<{ id: string; name: string; username: string | null }>;
  castAt: string;
}

export const recordApi = {
  positions: (userId: string, cursor?: string) =>
    api.get<{ results: PositionRecord[]; nextCursor: string | null; summary: PositionSummary }>(
      `/api/users/${userId}/positions${cursor ? `?cursor=${cursor}` : ""}`,
    ),

  /** Positions taken on a version of a law that has since moved on. */
  needingReview: () =>
    api.get<{ results: PositionNeedingReview[]; count: number }>(
      "/api/users/me/positions/review",
    ),

  /** Every time somebody else spoke in your name. */
  receipts: () =>
    api.get<{ results: VoiceReceipt[]; carriedOnward: number }>("/api/delegations/receipts"),

  /** Where you stand relative to everyone else, including where you are alone. */
  standing: () => api.get<Standing>("/api/users/me/standing"),
};

export interface StandingEntry {
  reference: { id: string; masterReferenceId: string; title: string; referenceType: string };
  yourPosition: string;
  support: number;
  oppose: number;
  agreementPct: number;
  withMajority: boolean;
}

export interface Standing {
  measured: number;
  withMajority: number;
  inMinority: number;
  mostAlone: StandingEntry[];
}
