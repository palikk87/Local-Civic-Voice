/**
 * Government references API — the live, daily-synced store of bills, executive
 * orders, and SCOTUS cases (GET /api/government-references/*). The Discover tabs
 * read the 10 most popular per branch from /trending, and the detail screens
 * resolve reference ids the static libraries don't know about.
 *
 * Mappers convert the server shape into the legacy Bill / ExecutiveOrder /
 * SupremeCourtCase shapes the existing cards and detail screens render.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Bill, ExecutiveOrder, SupremeCourtCase, BillCategory } from "@/lib/types";
import { memberPhotoUrl } from "@/lib/member-photo";

export type ReferenceType = "bill" | "executive_order" | "scotus_case";

export interface GovReference {
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
  category: string | null;
  chamber: string | null;
  congress: number | null;
  sourceUrl: string | null;
  description?: string | null;
  citizenBrief?: string | null;
  signedDate: string | null;
  /**
   * Real provenance from congress.gov, filled by the background pass in
   * backend/src/services/bill-provenance.ts. Null until asked, which the cards
   * render as nothing — these used to be the row's own createdAt, so a 2007
   * statute displayed as introduced today.
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
  decidedDate: string | null;
  votes: { support: number; oppose: number; total: number };
  engagement: { comments: number; shares: number; posts: number };
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

/**
 * Write the Citizen's Brief for this reference — what the button does.
 *
 * One request, one honest answer. Nothing here starts by itself: a brief is
 * written only because somebody asked, and reused by everyone after.
 */
export function requestCitizenBrief(id: string, force = false) {
  return api.post<BriefResponse>(
    `/api/government-references/${id}/brief${force ? "?force=true" : ""}`,
  );
}

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
  userVote: "support" | "oppose" | null;
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

/**
 * Turn a live Library search result into its master reference row so its brief
 * comes from the same server pipeline (full official text) as every other screen.
 */
export function resolveLibraryDocument(input: LibraryResolveRequest) {
  return api.post<LibraryResolveResponse>("/api/government-references/resolve", input);
}

export const referenceKeys = {
  trending: (referenceType: ReferenceType | 'all', limit: number) =>
    ["government-references", "trending", referenceType, limit] as const,
  latest: (referenceType: ReferenceType | 'all', limit: number) =>
    ["government-references", "latest", referenceType, limit] as const,
  detail: (id: string) => ["government-references", "detail", id] as const,
};

/** Top N references for one branch, ranked by community engagement then recency. */
/**
 * Top N references, ranked by community engagement then recency.
 *
 * Omit `referenceType` for all three branches. Both routes treat the filter as
 * optional server-side, and a caller that wants everything should not have to
 * fire three requests and stitch them — the digest did exactly that by asking
 * only for bills, which is why executive orders and court cases never appeared
 * in it. Web twin: apps/web/src/hooks/use-government-references.ts.
 */
export function useTrendingReferences(referenceType?: ReferenceType, limit = 10) {
  return useQuery({
    queryKey: referenceKeys.trending(referenceType ?? 'all', limit),
    queryFn: () =>
      api.get<{ references: GovReference[] }>(
        `/api/government-references/trending?${referenceType ? `referenceType=${referenceType}&` : ''}limit=${limit}`
      ),
    staleTime: 5 * 60 * 1000,
  });
}

/** Newest references for one branch — surfaces freshly synced items that have no votes yet. */
export function useLatestReferences(referenceType?: ReferenceType, limit = 30) {
  return useQuery({
    queryKey: referenceKeys.latest(referenceType ?? 'all', limit),
    queryFn: () =>
      api.get<{ references: GovReference[] }>(
        `/api/government-references?${referenceType ? `referenceType=${referenceType}&` : ''}sortBy=createdAt&sortOrder=desc&limit=${limit}`
      ),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Single reference by database id — used by detail screens for synced items.
 *
 * DOES NOT POLL. It used to refetch every four seconds while the server
 * reported the brief as being written, which was fine until the work behind
 * that status died with the process doing it: the row went on claiming to be
 * busy, and this went on asking, forever. A reader who opened a law and did
 * nothing else got a spinner no reload could clear.
 *
 * Writing a brief is now something a person asks for, and `useCitizenBrief`
 * owns that request and its bounded wait. This is a plain read again.
 */
export function useGovernmentReference(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: referenceKeys.detail(id ?? ""),
    queryFn: () => api.get<{ reference: GovReferenceDetail }>(`/api/government-references/${id}`),
    enabled: enabled && !!id,
    staleTime: 60 * 1000,
    retry: 1,
  });
}

/**
 * Ask the server to re-pull the official text and rewrite the brief on the master
 * reference. Used by the brief card's refresh control on both faucets.
 */
export function useRefreshReferenceContent(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(`/api/government-references/${id}/refresh-content`),
    onSuccess: () => {
      if (id) queryClient.invalidateQueries({ queryKey: referenceKeys.detail(id) });
    },
  });
}

// useReferenceBriefProps lived here. It existed to feed a card that polled a
// server status, and both that card and that status are gone: the brief is
// asked for through useCitizenBrief, which owns the request and its end.

// ---------- Mappers to the legacy display shapes ----------

const VALID_CATEGORIES: BillCategory[] = [
  "healthcare", "education", "environment", "economy", "civil_rights",
  "defense", "immigration", "technology", "housing", "infrastructure",
];

function toCategory(category: string | null | undefined): BillCategory {
  if (category && (VALID_CATEGORIES as string[]).includes(category)) {
    return category as BillCategory;
  }
  if (category === "justice") return "civil_rights";
  return "economy";
}

function toVoteTally(votes: GovReference["votes"]) {
  return { yea: votes.support, nay: votes.oppose, totalVoters: votes.total };
}

/** Who held the presidency on a given date — used when the source omits it. */
export function presidentAtDate(dateStr: string | null): string {
  const time = dateStr ? new Date(dateStr).getTime() : Date.now();
  if (time >= new Date("2025-01-20").getTime()) return "Donald Trump";
  if (time >= new Date("2021-01-20").getTime()) return "Joe Biden";
  if (time >= new Date("2017-01-20").getTime()) return "Donald Trump";
  if (time >= new Date("2009-01-20").getTime()) return "Barack Obama";
  return "the President";
}

export function referenceToBill(ref: GovReference | GovReferenceDetail): Bill {
  const chamber: "house" | "senate" = ref.chamber === "senate" ? "senate" : "house";
  const statusMap: Record<string, Bill["status"]> = {
    proposed: "introduced",
    introduced: "introduced",
    committee: "in_committee",
    passed: chamber === "senate" ? "passed_senate" : "passed_house",
    enacted: "enacted",
    signed: "signed_into_law",
    vetoed: "vetoed",
  };
  const summary =
    ref.citizenBrief ?? ref.description ?? ("fullText" in ref ? ref.fullText : null) ?? ref.title;
  // The printed id, straight from the server. The old line here reformatted the
  // canonical id by hand and got resolutions wrong — "sres-829-119" came out as
  // "SRES.829" rather than "S.Res. 829" — because each client had its own idea
  // of how Congress prints a bill number.
  const congressNumber =
    ref.displayId ?? ref.masterReferenceId.toUpperCase();

  return {
    id: ref.id,
    title: ref.title,
    shortTitle: ref.shortTitle ?? (ref.title.length > 60 ? `${ref.title.slice(0, 57)}...` : ref.title),
    status: statusMap[ref.status] ?? "introduced",
    chamber,
    /**
     * THE SPONSOR IS A PERSON OR IT IS NOTHING.
     *
     * This named the chamber — "U.S. House of Representatives", party
     * "Independent", state "US", blank avatar — for every bill, because there
     * was nowhere to store a real one. congress.gov names the member, and
     * GovernmentReference now has the columns. Until the provenance pass
     * reaches a record the fields are null and the card shows no sponsor rather
     * than a fictional one.
     */
    sponsor:
      "sponsor" in ref && ref.sponsor
        ? {
            id: ref.sponsor.bioguideId ?? ref.sponsor.name,
            name: ref.sponsor.name,
            party: (ref.sponsor.party ?? "I") as "D" | "R" | "I",
            state: ref.sponsor.state ?? "",
            chamber,
            imageUrl: memberPhotoUrl(ref.sponsor.bioguideId) ?? "",
          }
        : undefined,
    /**
     * BOTH WERE `ref.createdAt` — when OUR row was written — so a 2007 statute
     * displayed as introduced today. They come from congress.gov now, and are
     * undefined until it has been asked.
     */
    introducedDate:
      "introducedDate" in ref && ref.introducedDate ? ref.introducedDate : undefined,
    lastActionDate:
      "lastActionDate" in ref && ref.lastActionDate ? ref.lastActionDate : undefined,
    category: toCategory(ref.category),
    congressNumber,
    congressUrl: ref.sourceUrl ?? undefined,
    fullText: ("fullText" in ref ? ref.fullText : null) ?? summary,
    simplifiedText: summary,
    realWorldImpact: ref.description ?? "",
    relatedLaws: [],
    communityVotes: toVoteTally(ref.votes),
    // HOW THE CHAMBER ACTUALLY VOTED. The Representation Gap has keyed on this
    // field since the beginning and nothing had ever set it, so PulseGap and
    // the "Official Vote" block had never rendered for a real record. It now
    // comes from senate.gov or clerk.house.gov, and stays undefined when the
    // chamber has not voted — which keeps those panels hidden rather than
    // filling them with a fabricated tally.
    //
    // Bills only. Executive orders and Supreme Court cases are not voted on by
    // Congress, and a gap against a vote that never happened is fiction.
    officialVotes:
      "officialVotes" in ref && ref.officialVotes
        ? {
            yea: ref.officialVotes.yea,
            nay: ref.officialVotes.nay,
            abstain: ref.officialVotes.present,
            notVoting: ref.officialVotes.notVoting,
          }
        : undefined,
    branch: "legislative",
  };
}

export function referenceToExecutiveOrder(ref: GovReference | GovReferenceDetail): ExecutiveOrder {
  const statusMap: Record<string, ExecutiveOrder["status"]> = {
    active: "active",
    signed: "active",
    revoked: "revoked",
    superseded: "superseded",
    expired: "expired",
  };
  const summary =
    ref.citizenBrief ?? ref.description ?? `Executive order signed by President ${presidentAtDate(ref.signedDate)}.`;

  return {
    id: ref.id,
    // Server-formatted, same as bills. An unnumbered order carries a Federal
    // Register document number instead, and the server knows which is which.
    eoNumber: ref.displayId ?? `EO ${ref.masterReferenceId.replace(/^eo-/i, "").toUpperCase()}`,
    title: ref.title,
    shortTitle: ref.shortTitle ?? (ref.title.length > 60 ? `${ref.title.slice(0, 57)}...` : ref.title),
    // THE PRESIDENT WHO SIGNED IT — the Federal Register's own answer when the
    // server has it, and only then the date-range guess below as a fallback.
    // The guess bottoms out at "the President" for anything before 2009, which
    // is the whole executive archive before Obama.
    president: ref.attribution?.name ?? presidentAtDate(ref.signedDate),
    // Their portrait, when one has been resolved. Absent renders as no face,
    // never as a placeholder standing in for a human being.
    presidentPhotoUrl: ref.attribution?.photoUrl ?? undefined,
    signedDate: ref.signedDate ?? ref.createdAt,
    publishedDate: ref.signedDate ?? ref.createdAt,
    status: statusMap[ref.status] ?? "active",
    category: toCategory(ref.category),
    federalRegisterUrl: ref.sourceUrl ?? undefined,
    fullText: ("fullText" in ref ? ref.fullText : null) ?? summary,
    simplifiedText: summary,
    realWorldImpact: ref.description ?? "",
    communityVotes: toVoteTally(ref.votes),
    branch: "executive",
  };
}

export function referenceToScotusCase(ref: GovReference | GovReferenceDetail): SupremeCourtCase {
  const statusMap: Record<string, SupremeCourtCase["status"]> = {
    decided: "decided",
    argued: "argued",
    pending: "pending",
    dismissed: "dismissed",
    remanded: "remanded",
  };
  // SCOTUS terms start in October: a June 2026 decision belongs to the 2025 term.
  const decided = ref.decidedDate ? new Date(ref.decidedDate) : null;
  const term = decided
    ? String(decided.getMonth() + 1 >= 10 ? decided.getFullYear() : decided.getFullYear() - 1)
    : String(new Date(ref.createdAt).getFullYear());
  const [petitioner = "Petitioner", respondent = "Respondent"] = ref.title.split(/\s+v\.?\s+/i);
  const question = ref.citizenBrief ?? ref.description ?? ref.title;

  return {
    id: ref.id,
    docketNumber:
      ref.displayId ?? ref.masterReferenceId.replace(/^scotus-/i, "").toUpperCase(),
    caseName: ref.title,
    shortName: ref.shortTitle ?? ref.title,
    term,
    decidedDate: ref.decidedDate ?? undefined,
    status: statusMap[ref.status] ?? (ref.decidedDate ? "decided" : "pending"),
    category: toCategory(ref.category),
    lowerCourt: "Federal courts",
    petitioner: petitioner.trim(),
    respondent: respondent.trim(),
    questionPresented: question,
    simplifiedQuestion: question,
    realWorldImpact: ref.description ?? "",
    communityVotes: toVoteTally(ref.votes),
    // WHO WROTE THE MAJORITY. CourtListener names them and nothing read it
    // until now. Absent for a per curiam decision — the Court speaking as one
    // body — and the screen shows no author rather than guessing one.
    // Absent for a per curiam: that ruling has no author, and the bench below
    // is who answers for it instead.
    majorityAuthor: ref.attribution?.perCuriam ? undefined : ref.attribution?.name,
    majorityAuthorPhotoUrl: ref.attribution?.photoUrl ?? undefined,
    bench: ref.attribution?.panel,
    benchLabel: ref.attribution?.panelLabel,
    courtListenerUrl: ref.sourceUrl ?? undefined,
    branch: "judicial",
  };
}
