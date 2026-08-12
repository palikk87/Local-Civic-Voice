// Web port of mobile/src/lib/bias-history-store.ts — tracks user media consumption patterns
// Web port: zustand persist uses localStorage instead of AsyncStorage
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { BiasLean } from './news-reels';
import { getOppositeBias } from './news-reels';

export interface BiasHistoryEntry {
  biasLean: BiasLean;
  viewCount: number;
  totalWatchTime: number; // in seconds
  lastViewed: string;
}

export interface AdMetricEntry {
  id: string;
  adId: string;
  adType: 'civic_partner' | 'sponsored_reel';
  clickedAt: string;
}

interface BiasHistoryState {
  // User consumption history by bias
  history: Record<BiasLean, BiasHistoryEntry>;

  // Ad click tracking
  adClicks: AdMetricEntry[];

  // Premium status (hides ads)
  isPremium: boolean;

  // Actions
  recordView: (biasLean: BiasLean, watchTime: number) => void;
  recordAdClick: (adId: string, adType: 'civic_partner' | 'sponsored_reel') => void;
  setPremium: (isPremium: boolean) => void;

  // Computed helpers
  getDominantBias: () => BiasLean | null;
  getBalancedFeedRatio: () => { preferred: number; challenge: number };
  getTotalViews: () => number;
  getBiasPercentages: () => Record<BiasLean, number>;
}

const initialHistory: Record<BiasLean, BiasHistoryEntry> = {
  Left: { biasLean: 'Left', viewCount: 0, totalWatchTime: 0, lastViewed: '' },
  Center: { biasLean: 'Center', viewCount: 0, totalWatchTime: 0, lastViewed: '' },
  Right: { biasLean: 'Right', viewCount: 0, totalWatchTime: 0, lastViewed: '' },
};

export const useBiasHistoryStore = create<BiasHistoryState>()(
  persist(
    (set, get) => ({
      history: initialHistory,
      adClicks: [],
      isPremium: false,

      recordView: (biasLean: BiasLean, watchTime: number) => {
        set((state) => ({
          history: {
            ...state.history,
            [biasLean]: {
              ...state.history[biasLean],
              viewCount: state.history[biasLean].viewCount + 1,
              totalWatchTime: state.history[biasLean].totalWatchTime + watchTime,
              lastViewed: new Date().toISOString(),
            },
          },
        }));
      },

      recordAdClick: (adId: string, adType: 'civic_partner' | 'sponsored_reel') => {
        const entry: AdMetricEntry = {
          id: `ad-${Date.now()}`,
          adId,
          adType,
          clickedAt: new Date().toISOString(),
        };
        set((state) => ({
          adClicks: [...state.adClicks, entry],
        }));
      },

      setPremium: (isPremium: boolean) => {
        set({ isPremium });
      },

      getDominantBias: () => {
        const { history } = get();
        const entries = Object.values(history);
        const totalViews = entries.reduce((sum, e) => sum + e.viewCount, 0);

        if (totalViews === 0) return null;

        // Find the bias with the most views
        const sorted = entries.sort((a, b) => b.viewCount - a.viewCount);
        return sorted[0].viewCount > 0 ? sorted[0].biasLean : null;
      },

      getBalancedFeedRatio: () => {
        // Default: 70% match user preference, 30% challenge with opposite bias
        return { preferred: 70, challenge: 30 };
      },

      getTotalViews: () => {
        const { history } = get();
        return Object.values(history).reduce((sum, e) => sum + e.viewCount, 0);
      },

      getBiasPercentages: () => {
        const { history } = get();
        const total = Object.values(history).reduce((sum, e) => sum + e.viewCount, 0);

        if (total === 0) {
          return { Left: 33, Center: 34, Right: 33 };
        }

        return {
          Left: Math.round((history.Left.viewCount / total) * 100),
          Center: Math.round((history.Center.viewCount / total) * 100),
          Right: Math.round((history.Right.viewCount / total) * 100),
        };
      },
    }),
    {
      name: 'bias-history-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

// Selectors for optimal re-renders
export const selectIsPremium = (state: BiasHistoryState) => state.isPremium;
export const selectDominantBias = (state: BiasHistoryState) => state.getDominantBias();
export const selectTotalViews = (state: BiasHistoryState) => state.getTotalViews();

// Balanced feed algorithm helper
export function getBalancedReels<T extends { biasLean: BiasLean }>(
  reels: T[],
  dominantBias: BiasLean | null,
  count: number = 10
): T[] {
  if (!dominantBias || reels.length === 0) {
    // No preference yet - return mixed
    return reels.slice(0, count);
  }

  const oppositeBias = getOppositeBias(dominantBias);

  // 70% preferred, 30% challenge
  const preferredCount = Math.ceil(count * 0.7);
  const challengeCount = count - preferredCount;

  const preferred = reels.filter((r) => r.biasLean === dominantBias);
  const challenge = reels.filter((r) => r.biasLean === oppositeBias);
  const center = reels.filter((r) => r.biasLean === 'Center');

  const result: T[] = [];

  // Add preferred reels
  result.push(...preferred.slice(0, preferredCount));

  // Add challenge reels
  result.push(...challenge.slice(0, challengeCount));

  // Fill remaining with center content
  const remaining = count - result.length;
  if (remaining > 0) {
    result.push(...center.slice(0, remaining));
  }

  // Shuffle to mix them up
  return result.sort(() => Math.random() - 0.5);
}
