/**
 * Seen Bills Store
 * Tracks which bills the user has seen during the current session
 * to prevent repetitive content in the feed
 */

import { create } from 'zustand';

interface SeenBillsState {
  // Set of bill IDs seen in current session
  seenBillIds: Set<string>;

  // Session start timestamp
  sessionStart: number;

  // Actions
  addSeenBills: (billIds: string[]) => void;
  hasSeenBill: (billId: string) => boolean;
  clearSeenBills: () => void;
  getSeenBillIds: () => Set<string>;
}

// Session timeout in milliseconds (6 hours)
const SESSION_TIMEOUT = 1000 * 60 * 60 * 6;

export const useSeenBillsStore = create<SeenBillsState>((set, get) => ({
  seenBillIds: new Set<string>(),
  sessionStart: Date.now(),

  addSeenBills: (billIds: string[]) => {
    set((state) => {
      // Check if session has expired
      const now = Date.now();
      if (now - state.sessionStart > SESSION_TIMEOUT) {
        // Start fresh session
        return {
          seenBillIds: new Set(billIds),
          sessionStart: now,
        };
      }

      // Add to existing seen bills
      const newSet = new Set(state.seenBillIds);
      billIds.forEach((id) => newSet.add(id));
      return { seenBillIds: newSet };
    });
  },

  hasSeenBill: (billId: string) => {
    const state = get();
    // Check session timeout
    if (Date.now() - state.sessionStart > SESSION_TIMEOUT) {
      return false;
    }
    return state.seenBillIds.has(billId);
  },

  clearSeenBills: () => {
    set({
      seenBillIds: new Set<string>(),
      sessionStart: Date.now(),
    });
  },

  getSeenBillIds: () => {
    const state = get();
    // Return empty set if session expired
    if (Date.now() - state.sessionStart > SESSION_TIMEOUT) {
      return new Set<string>();
    }
    return state.seenBillIds;
  },
}));

// Selectors for efficient re-renders
export const selectSeenBillIds = (state: SeenBillsState) => state.seenBillIds;
export const selectAddSeenBills = (state: SeenBillsState) => state.addSeenBills;
export const selectClearSeenBills = (state: SeenBillsState) => state.clearSeenBills;
