// Web port of mobile/src/lib/delegation-store.ts
// zustand persist uses localStorage instead of AsyncStorage.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { canRevokeDelegate } from './bill-of-rights';

// ============================================
// BILL OF RIGHTS ARTICLE I COMPLIANCE:
// "No user shall be permanently bound to any
// representative or leader. The power of the
// vote originates in the individual and is
// only lent, never given."
// ============================================

export type PolicyCategory =
  | 'healthcare'
  | 'education'
  | 'environment'
  | 'economy'
  | 'technology'
  | 'housing'
  | 'civil_rights'
  | 'immigration'
  | 'defense'
  | 'agriculture';

export interface Delegation {
  id: string;
  fromUserId: string;
  toUserId: string;
  category: PolicyCategory | 'all'; // 'all' means global delegation
  createdAt: string;
  isActive: boolean;
}

export interface DelegateProfile {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  expertise: PolicyCategory[];
  delegatorCount: number;
  votingRecord: {
    totalVotes: number;
    yeaVotes: number;
    nayVotes: number;
  };
  bio: string;
}

interface DelegationState {
  // User's outgoing delegations (who they delegate to)
  delegations: Delegation[];
  // Users who have delegated to this user
  incomingDelegations: Delegation[];
  // Featured delegates
  featuredDelegates: DelegateProfile[];

  // Actions
  createDelegation: (toUserId: string, category: PolicyCategory | 'all') => void;
  revokeDelegation: (delegationId: string) => void;
  revokeAllDelegations: () => void;
  getDelegateForCategory: (category: PolicyCategory) => string | null;
  isUserDelegate: (userId: string) => boolean;
  getDelegationChain: (category: PolicyCategory) => string[];
}

// Mock featured delegates for the app
const mockFeaturedDelegates: DelegateProfile[] = [
  {
    userId: 'delegate-1',
    username: 'healthpolicy_expert',
    displayName: 'Dr. Sarah Chen',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=sarah',
    expertise: ['healthcare'],
    delegatorCount: 1247,
    votingRecord: { totalVotes: 89, yeaVotes: 52, nayVotes: 37 },
    bio: 'Former NIH researcher. Focused on making healthcare policy accessible to everyone.',
  },
  {
    userId: 'delegate-2',
    username: 'greenlegislation',
    displayName: 'Marcus Rivera',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=marcus',
    expertise: ['environment', 'agriculture'],
    delegatorCount: 892,
    votingRecord: { totalVotes: 67, yeaVotes: 45, nayVotes: 22 },
    bio: 'Environmental attorney. Tracking climate legislation since 2015.',
  },
  {
    userId: 'delegate-3',
    username: 'edureform',
    displayName: 'Prof. Linda Okafor',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=linda',
    expertise: ['education'],
    delegatorCount: 634,
    votingRecord: { totalVotes: 54, yeaVotes: 31, nayVotes: 23 },
    bio: 'Education policy researcher at Georgetown. Parent of 3.',
  },
  {
    userId: 'delegate-4',
    username: 'techpolicy_watch',
    displayName: 'James Park',
    avatar: 'https://api.dicebear.com/7.x/avataaars/png?seed=james',
    expertise: ['technology', 'civil_rights'],
    delegatorCount: 1089,
    votingRecord: { totalVotes: 78, yeaVotes: 42, nayVotes: 36 },
    bio: 'Former tech exec turned privacy advocate. Fighting for digital rights.',
  },
];

export const useDelegationStore = create<DelegationState>()(
  persist(
    (set, get) => ({
      delegations: [],
      incomingDelegations: [],
      featuredDelegates: mockFeaturedDelegates,

      createDelegation: (toUserId: string, category: PolicyCategory | 'all') => {
        const state = get();

        // Check for circular delegation (basic check)
        const existingFromTarget = state.incomingDelegations.find(
          d => d.fromUserId === toUserId && d.isActive
        );
        if (existingFromTarget) {
          console.log('Cannot create circular delegation');
          return;
        }

        // Remove existing delegation for this category
        const filteredDelegations = state.delegations.filter(
          d => d.category !== category || !d.isActive
        );

        const newDelegation: Delegation = {
          id: `delegation-${Date.now()}`,
          fromUserId: 'current-user', // Would be actual user ID
          toUserId,
          category,
          createdAt: new Date().toISOString(),
          isActive: true,
        };

        set({ delegations: [...filteredDelegations, newDelegation] });
      },

      /**
       * ARTICLE I COMPLIANCE: Instant revocation
       * "Every citizen retains the absolute right to instantly
       * revoke or reassign their delegation at any time"
       */
      revokeDelegation: (delegationId: string) => {
        // Article I guarantees instant revocation - no delay or penalty
        if (!canRevokeDelegate()) {
          throw new Error('Bill of Rights Article I violation: revocation blocked');
        }
        set(state => ({
          delegations: state.delegations.map(d =>
            d.id === delegationId ? { ...d, isActive: false } : d
          ),
        }));
      },

      /**
       * ARTICLE I COMPLIANCE: Instant revocation of all delegations
       */
      revokeAllDelegations: () => {
        if (!canRevokeDelegate()) {
          throw new Error('Bill of Rights Article I violation: revocation blocked');
        }
        set(state => ({
          delegations: state.delegations.map(d => ({ ...d, isActive: false })),
        }));
      },

      getDelegateForCategory: (category: PolicyCategory) => {
        const state = get();
        // First check for specific category delegation
        const specificDelegation = state.delegations.find(
          d => d.category === category && d.isActive
        );
        if (specificDelegation) return specificDelegation.toUserId;

        // Fall back to global delegation
        const globalDelegation = state.delegations.find(
          d => d.category === 'all' && d.isActive
        );
        return globalDelegation?.toUserId ?? null;
      },

      isUserDelegate: (userId: string) => {
        return get().incomingDelegations.some(
          d => d.fromUserId === userId && d.isActive
        );
      },

      getDelegationChain: (category: PolicyCategory) => {
        const chain: string[] = [];
        const state = get();
        const currentDelegate = state.getDelegateForCategory(category);
        const visited = new Set<string>();

        while (currentDelegate && !visited.has(currentDelegate)) {
          chain.push(currentDelegate);
          visited.add(currentDelegate);
          // In a real app, this would look up the delegate's delegation
          // For now, we stop at first level
          break;
        }

        return chain;
      },
    }),
    {
      name: 'civic-delegation-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        delegations: state.delegations,
      }),
    }
  )
);

// Selectors - use primitive values or stable references
export const selectActiveDelegationsCount = (state: DelegationState) =>
  state.delegations.filter(d => d.isActive).length;

export const selectHasActiveDelegations = (state: DelegationState) =>
  state.delegations.some(d => d.isActive);

export const selectDelegateForCategory = (category: PolicyCategory) =>
  (state: DelegationState) => state.getDelegateForCategory(category);

// Selector factory to check if delegating to a specific user
export const selectIsDelegatingTo = (userId: string) =>
  (state: DelegationState) => state.delegations.some(d => d.isActive && d.toUserId === userId);

// Get delegations as a stable reference (use sparingly, prefer count/boolean selectors)
export const selectDelegations = (state: DelegationState) => state.delegations;
