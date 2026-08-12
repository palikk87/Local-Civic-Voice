import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currentUser, sampleUsers } from './mock-data';

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

// Generate mock initial data for trending references
function generateMockEngagementRecords(): Record<string, GlobalEngagementRecord> {
  const records: Record<string, GlobalEngagementRecord> = {};

  // High-engagement controversial bills
  const mockData: Array<{
    referenceId: string;
    referenceType: ReferenceType;
    title: string;
    support: number;
    oppose: number;
    comments: number;
    shares: number;
  }> = [
    {
      referenceId: 'hr-1049',
      referenceType: 'bill',
      title: 'Epstein Client List Transparency and Accountability Act',
      support: 45230,
      oppose: 4120,
      comments: 8934,
      shares: 12456,
    },
    {
      referenceId: 'hr-2847',
      referenceType: 'bill',
      title: 'Ban Congressional Stock Trading',
      support: 56780,
      oppose: 1890,
      comments: 7234,
      shares: 15678,
    },
    {
      referenceId: 'hr-3391',
      referenceType: 'bill',
      title: 'End Pharma Price Gouging',
      support: 38920,
      oppose: 5670,
      comments: 5432,
      shares: 9876,
    },
    {
      referenceId: 'hr-5892',
      referenceType: 'bill',
      title: 'Term Limits for Congress',
      support: 41230,
      oppose: 8760,
      comments: 6543,
      shares: 11234,
    },
    {
      referenceId: 'eo-14147',
      referenceType: 'executive_order',
      title: 'Border Emergency Declaration',
      support: 28450,
      oppose: 31200,
      comments: 12345,
      shares: 8765,
    },
    {
      referenceId: '22-451',
      referenceType: 'scotus_case',
      title: 'Trump v. United States (Presidential Immunity)',
      support: 18760,
      oppose: 42340,
      comments: 9876,
      shares: 7654,
    },
  ];

  mockData.forEach((item) => {
    const record: GlobalEngagementRecord = {
      referenceId: item.referenceId,
      referenceType: item.referenceType,
      title: item.title,
      supportVotes: item.support,
      opposeVotes: item.oppose,
      totalComments: item.comments,
      totalShares: item.shares,
      recentEngagement: Math.floor(Math.random() * 1000) + 500,
      trendingScore: 0,
      lastUpdated: new Date(Date.now() - Math.random() * 86400000).toISOString(),
      topContributors: sampleUsers.slice(0, 3).map((user, idx) => ({
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        engagementDriven: Math.floor(Math.random() * 5000) + 1000 - idx * 500,
        postCount: Math.floor(Math.random() * 10) + 1,
      })),
    };
    record.trendingScore = calculateTrendingScore(record);
    records[item.referenceId] = record;
  });

  return records;
}

// Generate mock civil leaders
function generateMockCivilLeaders(): CivilLeader[] {
  return sampleUsers.map((user, idx) => ({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    totalEngagementDriven: Math.floor(Math.random() * 50000) + 10000 - idx * 5000,
    postCount: Math.floor(Math.random() * 50) + 10,
    followerCount: user.followers,
    rank: idx + 1,
  })).sort((a, b) => b.totalEngagementDriven - a.totalEngagementDriven);
}

export const useGlobalEngagementStore = create<GlobalEngagementState>()(
  persist(
    (set, get) => ({
      engagementRecords: generateMockEngagementRecords(),
      userVotes: {},
      civilLeaders: generateMockCivilLeaders(),

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
            const author = sampleUsers.find((u) => u.id === sourceAuthorId) ?? {
              id: sourceAuthorId,
              username: 'user',
              displayName: 'User',
              avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100',
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
            const author = sampleUsers.find((u) => u.id === authorId) ?? currentUser;
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
            followerCount: sampleUsers.find((u) => u.id === user.userId)?.followers ?? 0,
            rank: 0,
          }))
          .sort((a, b) => b.totalEngagementDriven - a.totalEngagementDriven)
          .map((leader, idx) => ({ ...leader, rank: idx + 1 }));

        set({ civilLeaders: leaders.length > 0 ? leaders : get().civilLeaders });
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
