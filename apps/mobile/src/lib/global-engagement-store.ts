import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fallbackAvatarFor } from './signed-in-identity';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Global Engagement Store
 *
 * This store maintains a "Master-Reference" table that aggregates all engagement
 * (votes, comments) across the platform for each unique law/order/case.
 *
 * Every post about the same law shares the same engagement totals.
 */

// Reference types for different government branches
export type ReferenceType = 'bill' | 'executive_order' | 'scotus_case';

// Engagement record for a single reference (law/order/case)
export interface GlobalEngagementRecord {
  referenceId: string;           // Unique ID (e.g., "hr-82", "eo-14147", "22-451")
  referenceType: ReferenceType;
  title: string;

  // Aggregated engagement
  supportVotes: number;
  opposeVotes: number;
  totalComments: number;
  totalShares: number;

  // Trending metrics
  recentEngagement: number;      // Engagement in last 24 hours
  trendingScore: number;         // Calculated trending score
  lastUpdated: string;

  // Top contributors - users who drove the most engagement
  topContributors: TopContributor[];
}

// Track which users drove the most engagement for a reference
export interface TopContributor {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  engagementDriven: number;      // Total engagement their posts generated
  postCount: number;             // Number of posts about this reference
}

// Track user's vote on a specific reference
export interface UserReferenceVote {
  referenceId: string;
  vote: 'support' | 'oppose';
  votedAt: string;
  sourcePostId: string;          // The post they voted from
  sourceAuthorId: string;        // Credit to the post author
}

// Civil Leader leaderboard entry
export interface CivilLeader {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  totalEngagementDriven: number;
  postCount: number;
  followerCount: number;
  rank: number;
}

interface GlobalEngagementState {
  // Master reference table
  engagementRecords: Record<string, GlobalEngagementRecord>;

  // User's votes per reference (prevent double voting)
  userVotes: Record<string, UserReferenceVote>;

  // Civil Leader leaderboard (cached)
  civilLeaders: CivilLeader[];

  // Actions
  getOrCreateRecord: (referenceId: string, referenceType: ReferenceType, title: string) => GlobalEngagementRecord;
  voteOnReference: (referenceId: string, vote: 'support' | 'oppose', sourcePostId: string, sourceAuthorId: string) => void;
  addCommentToReference: (referenceId: string, authorId: string) => void;
  addShareToReference: (referenceId: string, authorId: string) => void;

  // Getters
  getGlobalEngagement: (referenceId: string) => GlobalEngagementRecord | undefined;
  getUserVote: (referenceId: string) => UserReferenceVote | undefined;
  getTrendingReferences: (limit?: number) => GlobalEngagementRecord[];
  getCivilLeaders: (limit?: number) => CivilLeader[];
  getTopContributorsForReference: (referenceId: string, limit?: number) => TopContributor[];

  // Utility
  recalculateTrendingScores: () => void;
  recalculateCivilLeaders: () => void;
}

// Calculate trending score based on recency and engagement
function calculateTrendingScore(record: GlobalEngagementRecord): number {
  const now = Date.now();
  const lastUpdated = new Date(record.lastUpdated).getTime();
  const hoursSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60);

  // Decay factor - engagement worth less the older it is
  const decayFactor = Math.exp(-hoursSinceUpdate / 24); // 24-hour half-life

  // Total engagement weighted by recency
  const totalEngagement = record.supportVotes + record.opposeVotes + record.totalComments * 2 + record.totalShares * 3;

  return totalEngagement * decayFactor * (1 + record.recentEngagement * 0.5);
}



export const useGlobalEngagementStore = create<GlobalEngagementState>()(
  persist(
    (set, get) => ({
      // Empty, not fabricated. These used to be seeded with invented
      // engagement numbers and a leaderboard of people who do not exist.
      engagementRecords: {},
      userVotes: {},
      civilLeaders: [],

      getOrCreateRecord: (referenceId, referenceType, title) => {
        const existing = get().engagementRecords[referenceId];
        if (existing) return existing;

        // Create new record
        const newRecord: GlobalEngagementRecord = {
          referenceId,
          referenceType,
          title,
          supportVotes: 0,
          opposeVotes: 0,
          totalComments: 0,
          totalShares: 0,
          recentEngagement: 0,
          trendingScore: 0,
          lastUpdated: new Date().toISOString(),
          topContributors: [],
        };

        set((state) => ({
          engagementRecords: {
            ...state.engagementRecords,
            [referenceId]: newRecord,
          },
        }));

        return newRecord;
      },

      voteOnReference: (referenceId, vote, sourcePostId, sourceAuthorId) => {
        const existingVote = get().userVotes[referenceId];

        // Update user vote tracking
        const newUserVote: UserReferenceVote = {
          referenceId,
          vote,
          votedAt: new Date().toISOString(),
          sourcePostId,
          sourceAuthorId,
        };

        set((state) => {
          const record = state.engagementRecords[referenceId];
          if (!record) return state;

          // Calculate vote changes
          let supportDelta = 0;
          let opposeDelta = 0;

          if (existingVote) {
            // Changing vote
            if (existingVote.vote === 'support' && vote === 'oppose') {
              supportDelta = -1;
              opposeDelta = 1;
            } else if (existingVote.vote === 'oppose' && vote === 'support') {
              supportDelta = 1;
              opposeDelta = -1;
            }
            // Same vote = no change (toggle off not implemented for global)
          } else {
            // New vote
            if (vote === 'support') supportDelta = 1;
            else opposeDelta = 1;
          }

          // Update contributor stats
          const updatedContributors = [...record.topContributors];
          const contributorIdx = updatedContributors.findIndex((c) => c.userId === sourceAuthorId);

          if (contributorIdx >= 0) {
            updatedContributors[contributorIdx] = {
              ...updatedContributors[contributorIdx],
              engagementDriven: updatedContributors[contributorIdx].engagementDriven + 1,
            };
          } else {
            // Find author info
            const author = {
              username: 'user',
              displayName: 'User',
              avatar: fallbackAvatarFor(sourceAuthorId),
            };

            updatedContributors.push({
              userId: sourceAuthorId,
              username: author.username,
              displayName: author.displayName,
              avatar: author.avatar,
              engagementDriven: 1,
              postCount: 1,
            });
          }

          // Sort contributors by engagement
          updatedContributors.sort((a, b) => b.engagementDriven - a.engagementDriven);

          const updatedRecord: GlobalEngagementRecord = {
            ...record,
            supportVotes: record.supportVotes + supportDelta,
            opposeVotes: record.opposeVotes + opposeDelta,
            recentEngagement: record.recentEngagement + 1,
            lastUpdated: new Date().toISOString(),
            topContributors: updatedContributors.slice(0, 10),
          };

          updatedRecord.trendingScore = calculateTrendingScore(updatedRecord);

          return {
            engagementRecords: {
              ...state.engagementRecords,
              [referenceId]: updatedRecord,
            },
            userVotes: {
              ...state.userVotes,
              [referenceId]: newUserVote,
            },
          };
        });

        // Recalculate civil leaders
        get().recalculateCivilLeaders();
      },

      addCommentToReference: (referenceId, authorId) => {
        set((state) => {
          const record = state.engagementRecords[referenceId];
          if (!record) return state;

          const updatedRecord: GlobalEngagementRecord = {
            ...record,
            totalComments: record.totalComments + 1,
            recentEngagement: record.recentEngagement + 2,
            lastUpdated: new Date().toISOString(),
          };
          updatedRecord.trendingScore = calculateTrendingScore(updatedRecord);

          return {
            engagementRecords: {
              ...state.engagementRecords,
              [referenceId]: updatedRecord,
            },
          };
        });
      },

      addShareToReference: (referenceId, authorId) => {
        set((state) => {
          const record = state.engagementRecords[referenceId];
          if (!record) return state;

          // Update contributor
          const updatedContributors = [...record.topContributors];
          const contributorIdx = updatedContributors.findIndex((c) => c.userId === authorId);

          if (contributorIdx >= 0) {
            updatedContributors[contributorIdx] = {
              ...updatedContributors[contributorIdx],
              postCount: updatedContributors[contributorIdx].postCount + 1,
            };
          } else {
            const author = {
              username: 'user',
              displayName: 'User',
              avatar: fallbackAvatarFor(authorId),
            };
            updatedContributors.push({
              userId: authorId,
              username: author.username,
              displayName: author.displayName,
              avatar: author.avatar,
              engagementDriven: 0,
              postCount: 1,
            });
          }

          const updatedRecord: GlobalEngagementRecord = {
            ...record,
            totalShares: record.totalShares + 1,
            recentEngagement: record.recentEngagement + 3,
            lastUpdated: new Date().toISOString(),
            topContributors: updatedContributors.slice(0, 10),
          };
          updatedRecord.trendingScore = calculateTrendingScore(updatedRecord);

          return {
            engagementRecords: {
              ...state.engagementRecords,
              [referenceId]: updatedRecord,
            },
          };
        });
      },

      getGlobalEngagement: (referenceId) => {
        return get().engagementRecords[referenceId];
      },

      getUserVote: (referenceId) => {
        return get().userVotes[referenceId];
      },

      getTrendingReferences: (limit = 5) => {
        const records = Object.values(get().engagementRecords);
        return records
          .sort((a, b) => b.trendingScore - a.trendingScore)
          .slice(0, limit);
      },

      getCivilLeaders: (limit = 10) => {
        return get().civilLeaders.slice(0, limit);
      },

      getTopContributorsForReference: (referenceId, limit = 3) => {
        const record = get().engagementRecords[referenceId];
        return record?.topContributors.slice(0, limit) ?? [];
      },

      recalculateTrendingScores: () => {
        set((state) => {
          const updated: Record<string, GlobalEngagementRecord> = {};

          Object.entries(state.engagementRecords).forEach(([id, record]) => {
            updated[id] = {
              ...record,
              trendingScore: calculateTrendingScore(record),
            };
          });

          return { engagementRecords: updated };
        });
      },

      recalculateCivilLeaders: () => {
        const records = Object.values(get().engagementRecords);

        // Aggregate engagement by user
        const userEngagement: Record<string, {
          userId: string;
          username: string;
          displayName: string;
          avatar: string;
          totalEngagement: number;
          postCount: number;
        }> = {};

        records.forEach((record) => {
          record.topContributors.forEach((contributor) => {
            if (!userEngagement[contributor.userId]) {
              userEngagement[contributor.userId] = {
                userId: contributor.userId,
                username: contributor.username,
                displayName: contributor.displayName,
                avatar: contributor.avatar,
                totalEngagement: 0,
                postCount: 0,
              };
            }
            userEngagement[contributor.userId].totalEngagement += contributor.engagementDriven;
            userEngagement[contributor.userId].postCount += contributor.postCount;
          });
        });

        // Convert to sorted leaderboard
        const leaders: CivilLeader[] = Object.values(userEngagement)
          .map((user, idx) => ({
            userId: user.userId,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            totalEngagementDriven: user.totalEngagement,
            postCount: user.postCount,
            followerCount: 0,
            rank: 0,
          }))
          .sort((a, b) => b.totalEngagementDriven - a.totalEngagementDriven)
          .map((leader, idx) => ({ ...leader, rank: idx + 1 }));

        set({ civilLeaders: leaders });
      },
    }),
    {
      name: 'global-engagement-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        engagementRecords: state.engagementRecords,
        userVotes: state.userVotes,
      }),
    }
  )
);

// Selectors
export const selectTrendingReferences = (limit: number) => (state: GlobalEngagementState) =>
  state.getTrendingReferences(limit);

export const selectCivilLeaders = (limit: number) => (state: GlobalEngagementState) =>
  state.getCivilLeaders(limit);
