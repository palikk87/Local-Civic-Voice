import { create } from 'zustand';
import type { FeedItem } from './types';

/**
 * An in-session mirror of "my vote" per government reference.
 *
 * NOT PERSISTED, ON PURPOSE. It used to be written to the device, which made it
 * the only thing that remembered your votes there — so a second device showed
 * none of them, and worse, whoever signed in next on a shared computer saw the
 * previous person's votes lit up until server data arrived and overwrote them.
 * A cache that outlives the session stops being a cache and becomes a record,
 * and an individual record does not belong on a device.
 *
 * The server is the truth. syncServerVote() in reference-votes.ts fills this in
 * from what the server returns; this exists only so every card showing the same
 * law lights up together without each one asking again. Empty on load is right.
 *
 * Likes are gone from here. /api/posts returns isLiked per post and both feeds
 * read it now — a like made on a phone shows on a computer, which it did not.
 */
interface VotingState {
  userVotes: Record<string, 'yea' | 'nay'>;
  feedItems: FeedItem[];
  /** Set or clear (null) my vote for a reference. Local only — no network. */
  setLocalVote: (referenceId: string, vote: 'yea' | 'nay' | null) => void;
  getUserVote: (billId: string) => 'yea' | 'nay' | null;
}

export const useVotingStore = create<VotingState>()((set, get) => ({
  userVotes: {},
  // feedItems used to be seeded with the full array of invented feed posts, so
  // a brand new visitor arrived with content nobody had written.
  feedItems: [],

  setLocalVote: (referenceId, vote) => {
    set((state) => {
      const newVotes = { ...state.userVotes };
      if (vote === null) {
        delete newVotes[referenceId];
      } else {
        newVotes[referenceId] = vote;
      }
      return { userVotes: newVotes };
    });
  },

  getUserVote: (billId: string) => {
    return get().userVotes[billId] ?? null;
  },
}));

// Selectors for optimal re-renders
export const selectUserVote = (billId: string) => (state: VotingState) =>
  state.userVotes[billId] ?? null;

