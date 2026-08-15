import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FeedItem } from './types';

/**
 * Local mirror of "my vote" per government reference (master reference system).
 *
 * This store no longer talks to the network. Every real vote goes through
 * castReferenceVote in reference-votes.ts — the ONE vote pipeline — which
 * records the vote on the law's central record and then calls setLocalVote
 * here so any card showing that law lights up instantly. Values are yea/nay
 * for the UI; the server speaks support/oppose.
 * Web twin: webapp/src/lib/mobile/voting-store.ts
 */
interface VotingState {
  userVotes: Record<string, 'yea' | 'nay'>;
  likedItems: Record<string, boolean>;
  feedItems: FeedItem[];
  /** Set or clear (null) my vote for a reference. Local only — no network. */
  setLocalVote: (referenceId: string, vote: 'yea' | 'nay' | null) => void;
  toggleLike: (itemId: string) => void;
  getUserVote: (billId: string) => 'yea' | 'nay' | null;
}

export const useVotingStore = create<VotingState>()(
  persist(
    (set, get) => ({
      userVotes: {},
      // Both of these used to be seeded: three hardcoded post ids pre-marked as
      // liked, and the full array of invented feed posts. A brand new visitor
      // arrived with likes they had never given, on posts that did not exist.
      likedItems: {},
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

      toggleLike: (itemId: string) => {
        set((state) => ({
          likedItems: {
            ...state.likedItems,
            [itemId]: !state.likedItems[itemId],
          },
        }));
      },

      getUserVote: (billId: string) => {
        return get().userVotes[billId] ?? null;
      },
    }),
    {
      name: 'civic-voting-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        userVotes: state.userVotes,
        likedItems: state.likedItems,
      }),
    }
  )
);

// Selectors for optimal re-renders
export const selectUserVote = (billId: string) => (state: VotingState) =>
  state.userVotes[billId] ?? null;

export const selectIsLiked = (itemId: string) => (state: VotingState) =>
  state.likedItems[itemId] ?? false;
