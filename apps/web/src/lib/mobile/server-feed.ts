/**
 * Web port of mobile/src/lib/server-feed.ts
 *
 * Bridge between the backend post feed and the timeline's TimelinePost shape.
 *
 * The server is the source of truth for posts. Every post is attached to a
 * government reference, and the posts endpoints send that attachment as
 * `reference` — title, printed id, status, category, source link, citizen brief
 * and the live support/oppose tally including the caller's own vote. That is
 * what makes a post render as a law card, so it is mapped through faithfully.
 *
 * Fields the server still does not serve (full comment threads,
 * representation-gap polls) are left undefined and the card renders without them
 * rather than showing invented numbers.
 */

import { api } from "@/lib/api";
import type { User } from "./types";
import type { PostMedia, TimelinePost } from "./timeline-store";
import { useVotingStore } from "./voting-store";

/**
 * The government action a post is attached to, as sent by the posts endpoints.
 * Mirrors postReferenceSchema in backend/src/types.ts.
 */
export interface ServerPostReference {
  id: string;
  masterReferenceId: string;
  /** The id as printed, e.g. "H.R. 4836" / "EO 14147" / "No. 22-451". */
  displayId: string;
  referenceType: "bill" | "executive_order" | "scotus_case";
  title: string;
  shortTitle: string | null;
  status: string;
  category: string | null;
  sourceUrl: string | null;
  citizenBrief: string | null;
  votes: { support: number; oppose: number; total: number };
  userVote: "support" | "oppose" | null;  /** When the law itself last changed — not when the row was written. */
  lawChangedAt: string | null;
  /** Increments with lawChangedAt. One citizen brief per version. */
  lawVersion: number;
}

/** A post as returned by GET /api/posts and GET /api/government-references/:id/posts. */
export interface ServerPost {
  id: string;
  content: string;
  author: {
    id: string;
    displayName: string | null;
    username: string;
    avatar: string;
  };
  governmentReferenceId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceTitle?: string | null;
  reference?: ServerPostReference | null;
  /**
   * The law under this post changed after it was written.
   *
   * Decided on the server rather than by comparing dates here: web and mobile
   * each doing their own comparison is two chances to disagree about what
   * "since" means, on a badge whose whole job is to be trustworthy.
   */
  lawUpdatedSincePosting?: boolean;
  media?: {
    id: string;
    type: string;
    url: string;
    thumbnailUrl?: string | null;
  }[];
  commentsCount: number;
  likesCount: number;
  /** Whether the person asking has already liked this. */
  isLiked: boolean;
  createdAt: string;
}

export interface ServerFeedResponse {
  posts: ServerPost[];
  nextCursor?: string | null;
  hasMore: boolean;
}

/** Reference types the timeline understands as shareable content. */
const CONTENT_TYPES = ["bill", "executive_order", "scotus_case"] as const;
type ReferenceContentType = (typeof CONTENT_TYPES)[number];

function toReferenceType(value: string | null | undefined): ReferenceContentType | undefined {
  return CONTENT_TYPES.find((t) => t === value);
}

function toAuthor(author: ServerPost["author"]): User {
  return {
    id: author.id,
    username: author.username,
    displayName: author.displayName ?? author.username,
    avatar: author.avatar,
    joinedDate: "",
    // The feed endpoint does not include social counts; the profile screen fetches
    // those separately. Zero is the honest placeholder, not a guess.
    followers: 0,
    following: 0,
    votesCount: 0,
  };
}

function toMedia(media: ServerPost["media"]): PostMedia[] | undefined {
  if (!media || media.length === 0) return undefined;

  return media.map((m) => ({
    type: m.type === "video" ? "iframe" : "image",
    url: m.url,
    thumbnailUrl: m.thumbnailUrl ?? undefined,
  }));
}

/** Convert one server post into the shape the timeline renders. */
export function mapServerPost(post: ServerPost): TimelinePost {
  const reference = post.reference ?? null;
  // Prefer the joined reference; fall back to the legacy flat fields so posts
  // read from an endpoint that has not been enriched still show their type.
  const referenceType = toReferenceType(reference?.referenceType ?? post.referenceType);
  const referenceId = reference?.id ?? post.governmentReferenceId ?? post.referenceId ?? undefined;

  return {
    id: post.id,
    author: toAuthor(post.author),
    type: referenceType ? "share" : "original",
    content: post.content,
    contentType: referenceType ?? "text",
    // A post attached to a real government action renders as a law card. Posts
    // with no attachment are plain user posts.
    source: reference ? "library" : "user",
    // On a reference post the body is the author's own take on the action, and
    // the card renders that as the opinion above the law card. Without this the
    // text is dropped entirely, because the card only prints `content` for posts
    // that carry no attachment.
    opinion: reference ? post.content : undefined,
    voteCounts: reference
      ? {
          support: reference.votes.support,
          oppose: reference.votes.oppose,
          ...(reference.userVote ? { userVote: reference.userVote } : {}),
        }
      : undefined,
    sharedContent:
      referenceType && referenceId
        ? {
            type: referenceType,
            id: referenceId,
            title: reference?.shortTitle ?? reference?.title ?? post.referenceTitle ?? undefined,
            displayId: reference?.displayId,
            status: reference?.status,
            category: reference?.category ?? undefined,
            sourceUrl: reference?.sourceUrl ?? undefined,
            lawUpdatedSincePosting: post.lawUpdatedSincePosting,
          }
        : undefined,
    media: toMedia(post.media),
    likes: post.likesCount,
    // The feed sends a comment count, not the thread, so there is nothing to preview
    // inline. The comment sheet is where a thread would be loaded per post.
    comments: [],
    shares: 0,
    // The server knows this now. It used to be hardcoded false here, so every
    // heart in the feed rendered empty however many you had pressed, and the
    // next tap took away a like you had already made.
    isLiked: post.isLiked ?? false,
    createdAt: post.createdAt,
    updatedAt: post.createdAt,
  };
}

/** Fetch the newest page of the real feed. */
export async function fetchServerFeed(
  limit = 30,
  authorId?: string,
): Promise<TimelinePost[]> {
  const authorParam = authorId ? `&authorId=${encodeURIComponent(authorId)}` : "";
  const response = await api.get<ServerFeedResponse>(`/api/posts?limit=${limit}${authorParam}`);
  // Mirror my standing vote on each attached law into the local vote store so
  // every card on every surface (feed, discover, detail pages) shows it.
  const { setLocalVote, userVotes } = useVotingStore.getState();
  for (const post of response.posts) {
    if (post.reference) {
      const next = post.reference.userVote
        ? post.reference.userVote === "support"
          ? ("yea" as const)
          : ("nay" as const)
        : null;
      if ((userVotes[post.reference.id] ?? null) !== next) {
        setLocalVote(post.reference.id, next);
      }
    }
  }
  return response.posts.map(mapServerPost);
}
