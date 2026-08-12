// Gamification System - Civic Score, Badges, Streaks, and Moral Rewards
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BillCategory } from './types';

// ==========================================
// CIVIC SCORE SYSTEM
// ==========================================

export interface CivicScore {
  total: number; // Overall civic score 0-1000
  level: CivicLevel;
  xp: number; // Experience points toward next level
  xpToNextLevel: number;

  // Breakdown by activity
  votingScore: number;
  engagementScore: number;
  consistencyScore: number;
  impactScore: number;
}

export type CivicLevel =
  | 'newcomer' // 0-99
  | 'citizen' // 100-249
  | 'advocate' // 250-499
  | 'activist' // 500-749
  | 'champion' // 750-899
  | 'leader'; // 900-1000

export const CIVIC_LEVELS: Record<CivicLevel, { min: number; max: number; title: string; color: string }> = {
  newcomer: { min: 0, max: 99, title: 'Civic Newcomer', color: '#94A3B8' },
  citizen: { min: 100, max: 249, title: 'Engaged Citizen', color: '#22C55E' },
  advocate: { min: 250, max: 499, title: 'Democracy Advocate', color: '#3B82F6' },
  activist: { min: 500, max: 749, title: 'Civic Activist', color: '#8B5CF6' },
  champion: { min: 750, max: 899, title: 'Accountability Champion', color: '#F59E0B' },
  leader: { min: 900, max: 1000, title: 'Democracy Leader', color: '#EF4444' },
};

// ==========================================
// BADGES SYSTEM
// ==========================================

export type BadgeId =
  // Voting badges
  | 'first_vote'
  | 'ten_votes'
  | 'fifty_votes'
  | 'hundred_votes'
  | 'category_expert'
  | 'bipartisan_voter'
  | 'early_voter'
  // Engagement badges
  | 'gap_hunter'
  | 'truth_seeker'
  | 'local_champion'
  | 'influencer'
  | 'community_builder'
  // Streak badges
  | 'weekly_warrior'
  | 'monthly_maven'
  | 'quarter_champion'
  // Impact badges
  | 'voice_heard'
  | 'congress_watcher'
  | 'accountability_hero'
  | 'change_maker';

export interface Badge {
  id: BadgeId;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  xpReward: number;
  unlockedAt?: string;
  progress?: number; // 0-100 for progress badges
  requirement: number;
}

export const BADGES: Record<BadgeId, Omit<Badge, 'unlockedAt' | 'progress'>> = {
  // Voting badges
  first_vote: {
    id: 'first_vote',
    name: 'First Voice',
    description: 'Cast your first vote on a bill',
    icon: '🗳️',
    rarity: 'common',
    xpReward: 10,
    requirement: 1,
  },
  ten_votes: {
    id: 'ten_votes',
    name: 'Active Voter',
    description: 'Vote on 10 different bills',
    icon: '✅',
    rarity: 'common',
    xpReward: 25,
    requirement: 10,
  },
  fifty_votes: {
    id: 'fifty_votes',
    name: 'Dedicated Democrat',
    description: 'Vote on 50 bills',
    icon: '🏛️',
    rarity: 'uncommon',
    xpReward: 75,
    requirement: 50,
  },
  hundred_votes: {
    id: 'hundred_votes',
    name: 'Century Voter',
    description: 'Cast 100 votes on legislation',
    icon: '💯',
    rarity: 'rare',
    xpReward: 150,
    requirement: 100,
  },
  category_expert: {
    id: 'category_expert',
    name: 'Policy Expert',
    description: 'Vote on 20+ bills in a single category',
    icon: '🎓',
    rarity: 'uncommon',
    xpReward: 50,
    requirement: 20,
  },
  bipartisan_voter: {
    id: 'bipartisan_voter',
    name: 'Bipartisan Bridge',
    description: 'Vote with both parties on different bills',
    icon: '🤝',
    rarity: 'rare',
    xpReward: 100,
    requirement: 10,
  },
  early_voter: {
    id: 'early_voter',
    name: 'Early Bird',
    description: 'Vote on a bill within 24 hours of it being posted',
    icon: '⏰',
    rarity: 'common',
    xpReward: 15,
    requirement: 1,
  },

  // Engagement badges
  gap_hunter: {
    id: 'gap_hunter',
    name: 'Gap Hunter',
    description: 'Identify 5 bills with >30% representation gap',
    icon: '🔍',
    rarity: 'uncommon',
    xpReward: 60,
    requirement: 5,
  },
  truth_seeker: {
    id: 'truth_seeker',
    name: 'Truth Seeker',
    description: 'Read the full text of 10 bills',
    icon: '📖',
    rarity: 'uncommon',
    xpReward: 40,
    requirement: 10,
  },
  local_champion: {
    id: 'local_champion',
    name: 'Local Champion',
    description: 'Vote on 10 bills affecting your state',
    icon: '📍',
    rarity: 'uncommon',
    xpReward: 50,
    requirement: 10,
  },
  influencer: {
    id: 'influencer',
    name: 'Civic Influencer',
    description: 'Get 100 likes on your votes/comments',
    icon: '⭐',
    rarity: 'rare',
    xpReward: 100,
    requirement: 100,
  },
  community_builder: {
    id: 'community_builder',
    name: 'Community Builder',
    description: 'Have 50 people follow your voting',
    icon: '👥',
    rarity: 'rare',
    xpReward: 120,
    requirement: 50,
  },

  // Streak badges
  weekly_warrior: {
    id: 'weekly_warrior',
    name: 'Weekly Warrior',
    description: 'Vote on at least one bill for 7 days straight',
    icon: '🔥',
    rarity: 'common',
    xpReward: 35,
    requirement: 7,
  },
  monthly_maven: {
    id: 'monthly_maven',
    name: 'Monthly Maven',
    description: 'Maintain a 30-day voting streak',
    icon: '📅',
    rarity: 'uncommon',
    xpReward: 100,
    requirement: 30,
  },
  quarter_champion: {
    id: 'quarter_champion',
    name: 'Quarter Champion',
    description: 'Stay active for 90 consecutive days',
    icon: '🏆',
    rarity: 'rare',
    xpReward: 200,
    requirement: 90,
  },

  // Impact badges (moral rewards!)
  voice_heard: {
    id: 'voice_heard',
    name: 'Voice Heard',
    description: 'Your vote aligned with the final congressional outcome',
    icon: '📢',
    rarity: 'uncommon',
    xpReward: 50,
    requirement: 1,
  },
  congress_watcher: {
    id: 'congress_watcher',
    name: 'Congress Watcher',
    description: 'Track 10 bills from introduction to final vote',
    icon: '👁️',
    rarity: 'rare',
    xpReward: 80,
    requirement: 10,
  },
  accountability_hero: {
    id: 'accountability_hero',
    name: 'Accountability Hero',
    description: 'Share 5 representation gaps to social media',
    icon: '🦸',
    rarity: 'epic',
    xpReward: 150,
    requirement: 5,
  },
  change_maker: {
    id: 'change_maker',
    name: 'Change Maker',
    description: 'Contact your representative about a gap bill',
    icon: '✊',
    rarity: 'legendary',
    xpReward: 250,
    requirement: 1,
  },
};

// ==========================================
// STREAKS SYSTEM
// ==========================================

export interface Streak {
  current: number;
  longest: number;
  lastActiveDate: string;
  weeklyGoal: number;
  weeklyProgress: number;
  multiplier: number; // Bonus XP multiplier for streaks
}

// ==========================================
// MORAL REWARDS (The Gap Exposure)
// ==========================================

export interface MoralReward {
  id: string;
  type: 'gap_discovered' | 'gap_shared' | 'rep_contacted' | 'aligned_with_outcome' | 'influenced_others';
  title: string;
  description: string;
  xpReward: number;
  timestamp: string;
  billId?: string;
  metadata?: Record<string, unknown>;
}

export const MORAL_REWARD_TYPES: Record<MoralReward['type'], { title: string; baseXP: number; icon: string }> = {
  gap_discovered: {
    title: 'Gap Exposed!',
    baseXP: 20,
    icon: '🔍',
  },
  gap_shared: {
    title: 'Truth Spread!',
    baseXP: 30,
    icon: '📤',
  },
  rep_contacted: {
    title: 'Voice Raised!',
    baseXP: 50,
    icon: '📞',
  },
  aligned_with_outcome: {
    title: 'Prediction Correct!',
    baseXP: 25,
    icon: '🎯',
  },
  influenced_others: {
    title: 'Influence Felt!',
    baseXP: 40,
    icon: '✨',
  },
};

// ==========================================
// GAMIFICATION STORE
// ==========================================

interface GamificationState {
  // Civic Score
  civicScore: CivicScore;

  // Badges
  unlockedBadges: Badge[];
  badgeProgress: Record<BadgeId, number>;

  // Streaks
  streak: Streak;

  // Moral Rewards
  moralRewards: MoralReward[];
  totalMoralXP: number;

  // Activity tracking
  votingHistory: Array<{
    billId: string;
    category: BillCategory;
    vote: 'yea' | 'nay';
    timestamp: string;
  }>;
  billsRead: string[];
  gapsViewed: string[];
  gapsShared: string[];
  repsContacted: string[];

  // Actions
  recordVote: (billId: string, category: BillCategory, vote: 'yea' | 'nay') => void;
  recordBillRead: (billId: string) => void;
  recordGapViewed: (billId: string) => void;
  recordGapShared: (billId: string) => void;
  recordRepContacted: (repId: string, billId: string) => void;
  updateStreak: () => void;
  addMoralReward: (type: MoralReward['type'], billId?: string, metadata?: Record<string, unknown>) => void;

  // Getters
  getLevel: () => CivicLevel;
  getXPToNextLevel: () => number;
  getBadgeProgress: (badgeId: BadgeId) => number;
  getStreakMultiplier: () => number;
}

export const useGamificationStore = create<GamificationState>()(
  persist(
    (set, get) => ({
      // Initial state
      civicScore: {
        total: 0,
        level: 'newcomer',
        xp: 0,
        xpToNextLevel: 100,
        votingScore: 0,
        engagementScore: 0,
        consistencyScore: 0,
        impactScore: 0,
      },

      unlockedBadges: [],
      badgeProgress: Object.keys(BADGES).reduce(
        (acc, key) => ({ ...acc, [key]: 0 }),
        {} as Record<BadgeId, number>
      ),

      streak: {
        current: 0,
        longest: 0,
        lastActiveDate: '',
        weeklyGoal: 5,
        weeklyProgress: 0,
        multiplier: 1,
      },

      moralRewards: [],
      totalMoralXP: 0,

      votingHistory: [],
      billsRead: [],
      gapsViewed: [],
      gapsShared: [],
      repsContacted: [],

      // Record a vote
      recordVote: (billId, category, vote) => {
        const state = get();

        // Update voting history
        const newHistory = [
          ...state.votingHistory,
          { billId, category, vote, timestamp: new Date().toISOString() },
        ];

        // Calculate XP
        let xpGain = 10; // Base XP for voting

        // Streak bonus
        xpGain *= state.streak.multiplier;

        // Check badge progress
        const voteCount = newHistory.length;
        const newBadgeProgress = { ...state.badgeProgress };
        const newBadges = [...state.unlockedBadges];

        // First vote badge
        if (voteCount === 1 && !newBadges.find(b => b.id === 'first_vote')) {
          const badge = { ...BADGES.first_vote, unlockedAt: new Date().toISOString() };
          newBadges.push(badge);
          xpGain += badge.xpReward;
        }

        // Progress badges
        newBadgeProgress.ten_votes = voteCount;
        newBadgeProgress.fifty_votes = voteCount;
        newBadgeProgress.hundred_votes = voteCount;

        if (voteCount >= 10 && !newBadges.find(b => b.id === 'ten_votes')) {
          newBadges.push({ ...BADGES.ten_votes, unlockedAt: new Date().toISOString() });
          xpGain += BADGES.ten_votes.xpReward;
        }
        if (voteCount >= 50 && !newBadges.find(b => b.id === 'fifty_votes')) {
          newBadges.push({ ...BADGES.fifty_votes, unlockedAt: new Date().toISOString() });
          xpGain += BADGES.fifty_votes.xpReward;
        }
        if (voteCount >= 100 && !newBadges.find(b => b.id === 'hundred_votes')) {
          newBadges.push({ ...BADGES.hundred_votes, unlockedAt: new Date().toISOString() });
          xpGain += BADGES.hundred_votes.xpReward;
        }

        // Category expert badge
        const categoryCount = newHistory.filter(v => v.category === category).length;
        newBadgeProgress.category_expert = Math.max(newBadgeProgress.category_expert, categoryCount);
        if (categoryCount >= 20 && !newBadges.find(b => b.id === 'category_expert')) {
          newBadges.push({ ...BADGES.category_expert, unlockedAt: new Date().toISOString() });
          xpGain += BADGES.category_expert.xpReward;
        }

        // Update civic score
        const newCivicScore = calculateCivicScore({
          votingHistory: newHistory,
          billsRead: state.billsRead,
          gapsViewed: state.gapsViewed,
          streak: state.streak,
          totalXP: state.civicScore.xp + xpGain,
        });

        set({
          votingHistory: newHistory,
          badgeProgress: newBadgeProgress,
          unlockedBadges: newBadges,
          civicScore: newCivicScore,
        });
      },

      // Record reading a bill
      recordBillRead: (billId) => {
        const state = get();
        if (state.billsRead.includes(billId)) return;

        const newBillsRead = [...state.billsRead, billId];
        const newBadgeProgress = { ...state.badgeProgress };
        const newBadges = [...state.unlockedBadges];

        newBadgeProgress.truth_seeker = newBillsRead.length;

        if (newBillsRead.length >= 10 && !newBadges.find(b => b.id === 'truth_seeker')) {
          newBadges.push({ ...BADGES.truth_seeker, unlockedAt: new Date().toISOString() });
        }

        set({
          billsRead: newBillsRead,
          badgeProgress: newBadgeProgress,
          unlockedBadges: newBadges,
        });
      },

      // Record viewing a gap
      recordGapViewed: (billId) => {
        const state = get();
        if (state.gapsViewed.includes(billId)) return;

        const newGapsViewed = [...state.gapsViewed, billId];
        const newBadgeProgress = { ...state.badgeProgress };
        const newBadges = [...state.unlockedBadges];

        newBadgeProgress.gap_hunter = newGapsViewed.length;

        if (newGapsViewed.length >= 5 && !newBadges.find(b => b.id === 'gap_hunter')) {
          newBadges.push({ ...BADGES.gap_hunter, unlockedAt: new Date().toISOString() });
        }

        // Add moral reward
        state.addMoralReward('gap_discovered', billId);

        set({
          gapsViewed: newGapsViewed,
          badgeProgress: newBadgeProgress,
          unlockedBadges: newBadges,
        });
      },

      // Record sharing a gap
      recordGapShared: (billId) => {
        const state = get();
        const newGapsShared = [...state.gapsShared, billId];
        const newBadgeProgress = { ...state.badgeProgress };
        const newBadges = [...state.unlockedBadges];

        newBadgeProgress.accountability_hero = newGapsShared.length;

        if (newGapsShared.length >= 5 && !newBadges.find(b => b.id === 'accountability_hero')) {
          newBadges.push({ ...BADGES.accountability_hero, unlockedAt: new Date().toISOString() });
        }

        // Add moral reward
        state.addMoralReward('gap_shared', billId);

        set({
          gapsShared: newGapsShared,
          badgeProgress: newBadgeProgress,
          unlockedBadges: newBadges,
        });
      },

      // Record contacting representative
      recordRepContacted: (repId, billId) => {
        const state = get();
        const key = `${repId}-${billId}`;
        if (state.repsContacted.includes(key)) return;

        const newRepsContacted = [...state.repsContacted, key];
        const newBadges = [...state.unlockedBadges];

        if (!newBadges.find(b => b.id === 'change_maker')) {
          newBadges.push({ ...BADGES.change_maker, unlockedAt: new Date().toISOString() });
        }

        // Add moral reward
        state.addMoralReward('rep_contacted', billId, { repId });

        set({
          repsContacted: newRepsContacted,
          unlockedBadges: newBadges,
        });
      },

      // Update streak
      updateStreak: () => {
        const state = get();
        const today = new Date().toISOString().split('T')[0];
        const lastActive = state.streak.lastActiveDate;

        let newStreak = { ...state.streak };

        if (!lastActive) {
          // First activity
          newStreak.current = 1;
          newStreak.lastActiveDate = today;
        } else {
          const lastDate = new Date(lastActive);
          const todayDate = new Date(today);
          const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

          if (diffDays === 0) {
            // Same day, no change
          } else if (diffDays === 1) {
            // Consecutive day
            newStreak.current += 1;
            newStreak.lastActiveDate = today;
          } else {
            // Streak broken
            newStreak.current = 1;
            newStreak.lastActiveDate = today;
          }
        }

        // Update longest streak
        if (newStreak.current > newStreak.longest) {
          newStreak.longest = newStreak.current;
        }

        // Update multiplier based on streak
        if (newStreak.current >= 30) {
          newStreak.multiplier = 2.0;
        } else if (newStreak.current >= 14) {
          newStreak.multiplier = 1.5;
        } else if (newStreak.current >= 7) {
          newStreak.multiplier = 1.25;
        } else {
          newStreak.multiplier = 1.0;
        }

        // Check streak badges
        const newBadges = [...state.unlockedBadges];
        const newBadgeProgress = { ...state.badgeProgress };

        newBadgeProgress.weekly_warrior = newStreak.current;
        newBadgeProgress.monthly_maven = newStreak.current;
        newBadgeProgress.quarter_champion = newStreak.current;

        if (newStreak.current >= 7 && !newBadges.find(b => b.id === 'weekly_warrior')) {
          newBadges.push({ ...BADGES.weekly_warrior, unlockedAt: new Date().toISOString() });
        }
        if (newStreak.current >= 30 && !newBadges.find(b => b.id === 'monthly_maven')) {
          newBadges.push({ ...BADGES.monthly_maven, unlockedAt: new Date().toISOString() });
        }
        if (newStreak.current >= 90 && !newBadges.find(b => b.id === 'quarter_champion')) {
          newBadges.push({ ...BADGES.quarter_champion, unlockedAt: new Date().toISOString() });
        }

        set({
          streak: newStreak,
          unlockedBadges: newBadges,
          badgeProgress: newBadgeProgress,
        });
      },

      // Add moral reward
      addMoralReward: (type, billId, metadata) => {
        const state = get();
        const rewardType = MORAL_REWARD_TYPES[type];

        const reward: MoralReward = {
          id: `${type}-${Date.now()}`,
          type,
          title: rewardType.title,
          description: getRewardDescription(type, metadata),
          xpReward: rewardType.baseXP * state.streak.multiplier,
          timestamp: new Date().toISOString(),
          billId,
          metadata,
        };

        const newRewards = [...state.moralRewards, reward];
        const newTotalMoralXP = state.totalMoralXP + reward.xpReward;

        // Update civic score
        const newCivicScore = {
          ...state.civicScore,
          xp: state.civicScore.xp + reward.xpReward,
          impactScore: state.civicScore.impactScore + reward.xpReward,
        };

        set({
          moralRewards: newRewards,
          totalMoralXP: newTotalMoralXP,
          civicScore: recalculateLevel(newCivicScore),
        });
      },

      // Getters
      getLevel: () => get().civicScore.level,

      getXPToNextLevel: () => {
        const score = get().civicScore;
        const currentLevel = CIVIC_LEVELS[score.level];
        return currentLevel.max - score.total;
      },

      getBadgeProgress: (badgeId) => {
        const progress = get().badgeProgress[badgeId];
        const requirement = BADGES[badgeId].requirement;
        return Math.min(100, (progress / requirement) * 100);
      },

      getStreakMultiplier: () => get().streak.multiplier,
    }),
    {
      name: 'civic-gamification-storage',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        civicScore: state.civicScore,
        unlockedBadges: state.unlockedBadges,
        badgeProgress: state.badgeProgress,
        streak: state.streak,
        moralRewards: state.moralRewards,
        totalMoralXP: state.totalMoralXP,
        votingHistory: state.votingHistory,
        billsRead: state.billsRead,
        gapsViewed: state.gapsViewed,
        gapsShared: state.gapsShared,
        repsContacted: state.repsContacted,
      }),
    }
  )
);

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function calculateCivicScore(data: {
  votingHistory: Array<{ billId: string; category: BillCategory; vote: 'yea' | 'nay'; timestamp: string }>;
  billsRead: string[];
  gapsViewed: string[];
  streak: Streak;
  totalXP: number;
}): CivicScore {
  const votingScore = Math.min(300, data.votingHistory.length * 3);
  const engagementScore = Math.min(250, (data.billsRead.length * 5) + (data.gapsViewed.length * 10));
  const consistencyScore = Math.min(250, data.streak.longest * 2.5);
  const impactScore = Math.min(200, data.totalXP * 0.1);

  const total = Math.min(1000, votingScore + engagementScore + consistencyScore + impactScore);
  const level = getLevelFromScore(total);
  const xpToNextLevel = CIVIC_LEVELS[level].max - total;

  return {
    total,
    level,
    xp: data.totalXP,
    xpToNextLevel,
    votingScore,
    engagementScore,
    consistencyScore,
    impactScore,
  };
}

function getLevelFromScore(score: number): CivicLevel {
  if (score >= 900) return 'leader';
  if (score >= 750) return 'champion';
  if (score >= 500) return 'activist';
  if (score >= 250) return 'advocate';
  if (score >= 100) return 'citizen';
  return 'newcomer';
}

function recalculateLevel(score: CivicScore): CivicScore {
  const level = getLevelFromScore(score.total);
  const xpToNextLevel = CIVIC_LEVELS[level].max - score.total;
  return { ...score, level, xpToNextLevel };
}

function getRewardDescription(type: MoralReward['type'], metadata?: Record<string, unknown>): string {
  switch (type) {
    case 'gap_discovered':
      return 'You found a representation gap between citizens and Congress!';
    case 'gap_shared':
      return 'You shared the truth with others. Accountability matters!';
    case 'rep_contacted':
      return 'You raised your voice directly to your representative!';
    case 'aligned_with_outcome':
      return 'Your vote matched the final congressional decision!';
    case 'influenced_others':
      return 'Your civic engagement influenced others to participate!';
    default:
      return 'You made a difference!';
  }
}

// Selectors for optimal re-renders
export const selectCivicScore = (state: GamificationState) => state.civicScore;
export const selectStreak = (state: GamificationState) => state.streak;
export const selectBadgeCount = (state: GamificationState) => state.unlockedBadges.length;
export const selectRecentReward = (state: GamificationState) =>
  state.moralRewards.length > 0 ? state.moralRewards[state.moralRewards.length - 1] : null;
