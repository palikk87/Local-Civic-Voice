import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Web port: zustand persist uses localStorage instead of AsyncStorage
import type { CivicEngagementStats } from './types';

// Initialize default civic stats
const defaultCivicStats: CivicEngagementStats = {
  libraryPostsCount: 0,
  totalSupportVotes: 0,
  totalOpposeVotes: 0,
  totalRepGapVotes: 0,
  totalComments: 0,
  engagementScore: 0,
};

// Calculate Civil Leader score based on engagement
function calculateEngagementScore(stats: CivicEngagementStats): number {
  // Weight different engagement types
  const libraryPostWeight = 10;
  const supportVoteWeight = 2;
  const opposeVoteWeight = 2;
  const repGapVoteWeight = 3;
  const commentWeight = 1;

  return (
    stats.libraryPostsCount * libraryPostWeight +
    stats.totalSupportVotes * supportVoteWeight +
    stats.totalOpposeVotes * opposeVoteWeight +
    stats.totalRepGapVotes * repGapVoteWeight +
    stats.totalComments * commentWeight
  );
}

interface UserProfilesState {
  // Map of userId to their civic engagement stats
  userStats: Record<string, CivicEngagementStats>;

  // Actions to update stats
  incrementLibraryPosts: (userId: string) => void;
  incrementSupportVote: (authorId: string) => void;
  decrementSupportVote: (authorId: string) => void;
  incrementOpposeVote: (authorId: string) => void;
  decrementOpposeVote: (authorId: string) => void;
  incrementRepGapVote: (authorId: string) => void;
  incrementComment: (authorId: string) => void;

  // Getters
  getUserStats: (userId: string) => CivicEngagementStats;
  getEngagementRank: (userId: string) => string;
}

export const useUserProfilesStore = create<UserProfilesState>()(
  persist(
    (set, get) => ({
      // Empty. Every account's civic stats used to be seeded here — the
      // fictional `currentUser` with defaults, and each of `sampleUsers` with
      // Math.random() vote and comment counts. A real person opening a real
      // profile saw invented numbers, and the civil-leader ranking those feed
      // was a ranking of nobody.
      userStats: {},

      incrementLibraryPosts: (userId) => {
        set((state) => {
          const current = state.userStats[userId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            libraryPostsCount: current.libraryPostsCount + 1,
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [userId]: updated,
            },
          };
        });
      },

      incrementSupportVote: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalSupportVotes: current.totalSupportVotes + 1,
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      decrementSupportVote: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalSupportVotes: Math.max(0, current.totalSupportVotes - 1),
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      incrementOpposeVote: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalOpposeVotes: current.totalOpposeVotes + 1,
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      decrementOpposeVote: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalOpposeVotes: Math.max(0, current.totalOpposeVotes - 1),
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      incrementRepGapVote: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalRepGapVotes: current.totalRepGapVotes + 1,
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      incrementComment: (authorId) => {
        set((state) => {
          const current = state.userStats[authorId] ?? { ...defaultCivicStats };
          const updated = {
            ...current,
            totalComments: current.totalComments + 1,
          };
          updated.engagementScore = calculateEngagementScore(updated);
          return {
            userStats: {
              ...state.userStats,
              [authorId]: updated,
            },
          };
        });
      },

      getUserStats: (userId) => {
        const stats = get().userStats[userId] ?? { ...defaultCivicStats };
        return {
          ...stats,
          engagementScore: calculateEngagementScore(stats),
        };
      },

      getEngagementRank: (userId) => {
        const stats = get().userStats[userId] ?? { ...defaultCivicStats };
        const score = calculateEngagementScore(stats);

        // Rank tiers based on Civil Leader score
        if (score >= 500) return 'Civic Champion';
        if (score >= 250) return 'Policy Leader';
        if (score >= 100) return 'Active Citizen';
        if (score >= 50) return 'Engaged Voter';
        if (score >= 10) return 'New Voice';
        return 'Observer';
      },
    }),
    {
      name: 'user-profiles-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        userStats: state.userStats,
      }),
    }
  )
);

// Selectors
export const selectUserStats = (userId: string) => (state: UserProfilesState) =>
  state.userStats[userId] ?? defaultCivicStats;

export const selectEngagementRank = (userId: string) => (state: UserProfilesState) =>
  state.getEngagementRank(userId);
