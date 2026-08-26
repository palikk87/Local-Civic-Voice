/**
 * The live public feed — GET /api/feed, the backend's personalization
 * algorithm over every user's timeline posts. Each post carries its attached
 * government reference (bill / executive order / SCOTUS case), which we map
 * into the FeedItem shape the feed UI ranks and renders.
 *
 * Mobile twin: webapp/mobile/src/lib/algorithmic-feed.ts
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Bill, FeedItem, User } from "@/lib/mobile/types";
import type { ServerPostReference } from "./server-feed";
import { syncServerVote } from "./reference-votes";

export interface AlgorithmicFeedPost {
  id: string;
  content: string;
  author: {
    id: string;
    displayName: string;
    username: string;
    avatar: string;
    followerCount: number;
    isFollowed: boolean;
  };
  bill: { id: string; title: string; category: string } | null;
  governmentReferenceId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  referenceTitle: string | null;
  /** The attached law's central record: live tally, status, my vote. */
  reference: ServerPostReference | null;
  metrics: { likes: number; comments: number; shares: number; saves: number; views: number };
  feedReason: string;
  isLiked: boolean;
  isSaved: boolean;
  createdAt: string;
}

export interface AlgorithmicFeedResponse {
  posts: AlgorithmicFeedPost[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Personalized, cycling feed from the backend algorithm. */
export function useAlgorithmicFeed(limit = 30) {
  return useQuery({
    queryKey: ["algorithmic-feed", limit],
    queryFn: async () => {
      const data = await api.get<AlgorithmicFeedResponse>(`/api/feed?limit=${limit}`);
      // The server knows my standing vote on each law; mirror it locally so
      // every card on every surface lights up with it.
      for (const post of data.posts) {
        if (post.reference) {
          syncServerVote(post.reference.id, post.reference.userVote);
        }
      }
      return data;
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

function authorToUser(post: AlgorithmicFeedPost): User {
  return {
    id: post.author.id,
    username: post.author.username,
    displayName: post.author.displayName,
    avatar: post.author.avatar,
    joinedDate: post.createdAt,
    followers: post.author.followerCount,
    following: 0,
    votesCount: 0,
  };
}

/** Bill card for the attached reference; detail pages resolve the id. */
function referenceToFeedBill(post: AlgorithmicFeedPost): Bill {
  const reference = post.reference;
  const title = reference?.title ?? post.referenceTitle ?? post.bill?.title ?? "Government action";
  const branch =
    post.referenceType === "executive_order"
      ? ("executive" as const)
      : post.referenceType === "scotus_case"
        ? ("judicial" as const)
        : ("legislative" as const);
  return {
    id: post.referenceId ?? post.governmentReferenceId ?? post.bill?.id ?? post.id,
    title,
    shortTitle: title.length > 60 ? `${title.slice(0, 57)}...` : title,
    status: "introduced",
    chamber: "house",
    sponsor: {
      id: "unknown",
      name: "U.S. Government",
      party: "I",
      state: "US",
      chamber: "house",
      imageUrl: "",
    },
    introducedDate: post.createdAt,
    lastActionDate: post.createdAt,
    category: ((reference?.category ?? post.bill?.category) as Bill["category"]) ?? "economy",
    fullText: post.content,
    simplifiedText: reference?.citizenBrief ?? post.content,
    realWorldImpact: "",
    relatedLaws: [],
    // The law's central tally — the same numbers every other surface shows.
    communityVotes: reference
      ? {
          yea: reference.votes.support,
          nay: reference.votes.oppose,
          totalVoters: reference.votes.total,
        }
      : { yea: 0, nay: 0, totalVoters: 0 },
    branch,
  };
}

/** Map an algorithmic feed post into the FeedItem shape the feed UI ranks. */
export function algorithmicPostToFeedItem(post: AlgorithmicFeedPost): FeedItem {
  return {
    id: post.id,
    type: "share",
    user: authorToUser(post),
    bill: referenceToFeedBill(post),
    comment: post.content,
    timestamp: post.createdAt,
    likes: post.metrics.likes,
    isLiked: post.isLiked,
    // Carried through so the badge can say why this is here. The server sets
    // it from two public votes on the same record; dropping it here is how it
    // used to reach the UI as nothing at all.
    isOtherSide: post.feedReason === 'They voted the other way on this',
  };
}
