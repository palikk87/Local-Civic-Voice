import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { BACKEND_URL } from './config';

export interface B2BClient {
  id: string;
  name: string;
  type: 'lobbyist' | 'ngo' | 'corporation' | 'campaign' | 'media' | 'research';
  tier: 'basic' | 'professional' | 'enterprise';
  createdAt: string;
  lastAccess?: string;
}

/** owner and admin can manage seats; analyst reads the dashboards. */
export type B2BRole = 'owner' | 'admin' | 'analyst';

export interface B2BSession {
  token: string;
  clientId: string;
  clientName: string;
  tier: 'basic' | 'professional' | 'enterprise';
  expiresAt: string;
  /**
   * Who is signed in. Null when the account's own username was used — that
   * login is the company itself and is always an owner.
   *
   * Optional because a session persisted by an older build has neither field,
   * and `undefined` has to mean owner for the same reason the backend reads a
   * NULL memberRole as owner: otherwise this build signs existing customers out
   * of their own settings on the day it ships.
   */
  memberId?: string | null;
  memberName?: string | null;
  role?: B2BRole;
}

/** A stored session's role, with the same NULL-means-owner rule as the API. */
export function sessionRole(session: B2BSession | null): B2BRole {
  if (session?.role === 'admin') return 'admin';
  if (session?.role === 'analyst') return 'analyst';
  return 'owner';
}

export function canManageSeats(session: B2BSession | null): boolean {
  const role = sessionRole(session);
  return role === 'owner' || role === 'admin';
}

export interface B2BMemberRow {
  id: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  disabled: boolean;
  lastAccessAt: string | null;
  createdAt: string;
}

export interface B2BAccountInfo {
  account: {
    id: string;
    username: string;
    name: string;
    type: string;
    tier: string;
    createdAt: string;
    lastAccessAt: string | null;
    activeSeats: number;
  };
  signedInAs:
    | { kind: 'account'; username: string; name: string; role: 'owner' }
    | ({ kind: 'member' } & B2BMemberRow);
  role: B2BRole;
  canManageSeats: boolean;
  canRotateApiKey: boolean;
}

export interface SentimentData {
  support: number;
  oppose: number;
  neutral: number;
  total: number;
  score: number;
  /**
   * Optional, and absent wherever nothing measures it.
   *
   * It used to be a required number, which meant every construction site had to
   * supply one, which meant every site made one up. A field that cannot be left
   * out is a field that gets invented.
   */
  confidence?: number;
  trend?: 'rising' | 'falling' | 'stable';
  /** Null when there is no earlier period to compare against. */
  changePercent: number | null;
}



/**
 * A place's Pulse, or the reason there isn't one.
 *
 * The API withholds numbers for any district where fewer than `floor` people
 * have voted — Bill of Rights Article IV shields personal identity from third
 * parties, and a percentage over one voter is that person's ballot with their
 * address on it. A discriminated union rather than nullable fields, so a screen
 * cannot render `score` without having checked.
 */
export type PlaceResult =
  | { enough: true; voices: number; support: number; oppose: number; score: number }
  | { enough: false; voices: number; reason: 'not_enough_voices'; floor: number };

/** How much of the map the data is actually drawn from. Shown, never implied. */
export interface Coverage {
  participants: number;
  placed: number;
  districtsRepresented: number;
  districtsReportable: number;
}

export interface Representative {
  name: string;
  party: string;
  photoUrl: string | null;
}

export interface StateRow {
  stateCode: string;
  stateName: string;
  residents: number;
  districtsRepresented: number;
  pulse: PlaceResult;
}

export interface DistrictRow {
  districtId: string;
  stateCode: string;
  stateName: string;
  district: number | null;
  representative: Representative | null;
  residents: number;
  pulse: PlaceResult;
}

export interface HeatmapPoint {
  districtId: string;
  stateCode: string;
  representative: Representative | null;
  party: 'D' | 'R' | 'I' | null;
  /** Voices behind the shade. Never below the floor. */
  value: number;
  sentiment: number | null;
}

export interface HeatmapResult {
  districts: HeatmapPoint[];
  /** Districts deliberately withheld, with the count that is safe to publish. */
  suppressed: { districtId: string; voices: number; reason: string }[];
  range: { min: number; max: number };
  coverage: Coverage;
  floor: number;
  derivation: string;
}

export interface IssueData {
  id: string;
  name: string;
  category: string;
  sentiment: SentimentData;
  relatedBills: number;
  hotspots: string[];
}

export interface TrendingTopic {
  id: string;
  topic: string;
  category: string;
  mentions: number;
  sentiment: number;
  change24h: number;
  velocity: 'accelerating' | 'decelerating' | 'stable';
}

export interface SentimentOverview {
  overall: SentimentData;
  byBranch: {
    legislative: SentimentData;
    executive: SentimentData;
    judicial: SentimentData;
  };
  engagement: {
    totalVotes: number;
    totalPosts: number;
    totalComments: number;
    /**
     * Accounts somebody can sign in with. Was `activeUsers24h`, which was fed
     * the number of rows in a hardcoded table of US states — 51, on an empty
     * database and a busy one alike.
     */
    participants: number;
    /** Null when there is no earlier month to compare against. */
    growthRate: number | null;
  };
  topIssues: Array<{ id: string; name: string; sentiment: number; volume: number }>;
}


/**
 * A record's measured history, and a projection only where one is supported.
 *
 * The old shape carried `confidence` and `modelVersion: "v2.3.1"` over a seeded
 * random walk. Both are gone; `basis` replaces them, because what a reader
 * needs in order to judge a line is how many days and voices it rests on.
 */
export interface PulseDay {
  date: string;
  support: number;
  oppose: number;
  lawChanged: boolean;
}

export interface ProjectedPoint {
  date: string;
  predicted: number;
  lowerBound: number;
  upperBound: number;
}

export interface TrajectoryData {
  currentSentiment: number;
  /** Observed. Present whenever anybody has voted. */
  history: PulseDay[];
  basis: {
    days: number;
    voices: number;
    firstDay: string | null;
    lastDay: string | null;
    /** Days the law's own text changed — movement may be about that. */
    lawChangedOn: string[];
  };
  /** Null when the history is too short to fit a line to. */
  projection: {
    points: ProjectedPoint[];
    slopePerDay: number;
    residual: number;
    method: string;
  } | null;
  noProjection: { reason: string; daysObserved: number; daysNeeded: number } | null;
}


interface B2BState {
  session: B2BSession | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  _hasHydrated: boolean;

  // Data
  sentimentOverview: SentimentOverview | null;
  districts: DistrictRow[];
  states: StateRow[];
  coverage: Coverage | null;
  issues: IssueData[];
  trendingTopics: TrendingTopic[];
  heatmapData: HeatmapResult | null;

  // Actions
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  verifySession: () => Promise<boolean>;

  // Data fetching
  fetchSentimentOverview: () => Promise<void>;
  fetchDistricts: (params?: { category?: string }) => Promise<void>;
  fetchStates: () => Promise<void>;
  fetchStateDetails: (stateCode: string) => Promise<{ stateCode: string; stateName: string; pulse: PlaceResult; residents: number; districts: DistrictRow[]; coverage: Coverage } | null>;

  fetchIssues: () => Promise<void>;
  fetchIssueDetails: (issueId: string) => Promise<IssueData | null>;
  fetchTrendingTopics: () => Promise<void>;
  fetchHeatmapData: (filters?: { category?: string; party?: string; minEngagement?: number }) => Promise<void>;
  fetchForecast: (targetType: 'bill' | 'issue', targetId: string) => Promise<TrajectoryData | null>;
  fetchBillSentiment: (billId: string) => Promise<SentimentData | null>;
}

/**
 * Turn the server's per-branch counts into the shape the dashboard renders.
 *
 * `score` here is computed from this branch's own votes rather than copied from
 * the national figure, which is what made the old breakdown three identical
 * numbers in different colours.
 */
function branchTotals(
  byBranch:
    | Record<'legislative' | 'executive' | 'judicial', { support: number; oppose: number }>
    | undefined,
): SentimentOverview['byBranch'] {
  const one = (counts?: { support: number; oppose: number }): SentimentData => {
    const support = counts?.support ?? 0;
    const oppose = counts?.oppose ?? 0;
    const total = support + oppose;
    return {
      support,
      oppose,
      // Every recorded position is support or oppose. There is no third
      // option to cast, so this is 0 because it is 0.
      neutral: 0,
      total,
      score: total > 0 ? parseFloat(((support - oppose) / total).toFixed(3)) : 0,
      // No `confidence` and no `trend`: nothing measures either per branch, and
      // a plausible-looking default is the thing being removed here.
      changePercent: null,
    };
  };

  return {
    legislative: one(byBranch?.legislative),
    executive: one(byBranch?.executive),
    judicial: one(byBranch?.judicial),
  };
}

export const useB2BStore = create<B2BState>()(
  persist(
    (set, get) => ({
      session: null,
      isAuthenticated: false,
      isLoading: false,
      _hasHydrated: false,
      sentimentOverview: null,
      districts: [],
      states: [],
      coverage: null,
      issues: [],
      trendingTopics: [],
      heatmapData: null,

      login: async (username, password) => {
        set({ isLoading: true });

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/auth/credential-login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });

          const data = await response.json();

          if (!response.ok) {
            set({ isLoading: false });
            return { success: false, error: data.error || 'Authentication failed' };
          }

          // Build session from response
          const session: B2BSession = {
            token: data.token,
            clientId: data.client.id,
            clientName: data.client.name,
            tier: data.client.tier,
            expiresAt: data.expiresAt,
            memberId: data.member?.id ?? null,
            memberName: data.member?.name ?? null,
            role: (data.role as B2BRole) ?? 'owner',
          };

          set({
            session,
            isAuthenticated: true,
            isLoading: false,
          });

          return { success: true };
        } catch (error) {
          set({ isLoading: false });
          return { success: false, error: 'Network error. Please try again.' };
        }
      },

      logout: async () => {
        const { session } = get();

        if (session?.token) {
          try {
            await fetch(`${BACKEND_URL}/api/b2b/auth/logout`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${session.token}`,
              },
            });
          } catch {
            // Ignore logout errors
          }
        }

        set({
          session: null,
          isAuthenticated: false,
          sentimentOverview: null,
          districts: [],
          states: [],
          issues: [],
          trendingTopics: [],
          heatmapData: null,
        });
      },

      verifySession: async () => {
        const { session } = get();

        if (!session?.token) {
          set({ isAuthenticated: false });
          return false;
        }

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/auth/verify`, {
            headers: {
              'Authorization': `Bearer ${session.token}`,
            },
          });

          if (!response.ok) {
            set({ session: null, isAuthenticated: false });
            return false;
          }

          // Refresh the role from the server on every check. A demotion revokes
          // the seat's sessions, so this normally never sees a changed value —
          // but a stale role in storage showing a Team tab that 403s is a worse
          // failure than one extra field copied here.
          const data = await response.json();
          const current = get().session;
          if (current) {
            set({
              session: {
                ...current,
                memberId: data.member?.id ?? null,
                memberName: data.member?.name ?? null,
                role: (data.role as B2BRole) ?? 'owner',
              },
            });
          }

          return true;
        } catch {
          return false;
        }
      },

      fetchSentimentOverview: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/sentiment/overview`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            const data = await response.json();
            // Map backend response to expected SentimentOverview format
            const overview = data.overview || {};
            const topIssues = (data.topIssues || []).map((i: { id: string; name: string; sentimentScore: number }) => ({
              id: i.id,
              name: i.name,
              sentiment: i.sentimentScore || 0,
              volume: 0,
            }));

            // Calculate support/oppose from percentages
            const total = overview.totalEngagements || 0;
            const supportPercent = overview.supportPercentage || 50;
            const opposePercent = overview.opposePercentage || 50;
            const support = Math.round((supportPercent / 100) * total);
            const oppose = Math.round((opposePercent / 100) * total);
            const neutral = total - support - oppose;

            const weeklyChange: number | null | undefined = data.trends?.weeklyChange;

            const sentimentOverview: SentimentOverview = {
              overall: {
                support,
                oppose,
                neutral: Math.max(0, neutral),
                total,
                score: overview.sentimentScore || 0,
                /*
                 * `confidence: 0.8` used to sit here — a literal, nothing
                 * measured it, and nothing reads it now.
                 *
                 * weeklyChange is genuinely measured (two counted windows), but
                 * it is null when there is no earlier week to compare against.
                 * `|| 0` turned that into a confident "stable, 0%", which is a
                 * claim about a period nobody has data for.
                 */
                trend:
                  weeklyChange === null || weeklyChange === undefined
                    ? undefined
                    : weeklyChange > 0
                      ? 'rising'
                      : weeklyChange < 0
                        ? 'falling'
                        : 'stable',
                changePercent: weeklyChange ?? null,
              },
              /**
               * Counted, not apportioned.
               *
               * This used to be the national total multiplied by 0.4, 0.35 and
               * 0.25 — three numbers written once so the chart would have three
               * bars, read ever since by paying customers as measurements. The
               * server counts votes per branch now; see getBranchCounts in
               * backend/src/routes/b2b.ts.
               */
              byBranch: branchTotals(data.byBranch),
              engagement: {
                totalVotes: data.engagement?.totalVotes ?? total,
                // Real counts. These were total * 0.1 and total * 0.3.
                totalPosts: data.engagement?.totalPosts ?? 0,
                totalComments: data.engagement?.totalComments ?? 0,
                // Was data.activeDistricts, which was the length of a hardcoded
                // 51-entry table of US states — the source of the dashboard's
                // 51. Participants is the same definition the admin portal
                // uses: an account somebody can sign in with.
                participants: data.engagement?.participants ?? 0,
                growthRate: data.trends?.monthlyChange ?? null,
              },
              topIssues,
            };
            set({ sentimentOverview });
          }
        } catch {
          // Ignore errors
        }
      },

      fetchDistricts: async (params = {}) => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const query = new URLSearchParams({ limit: '500' });
          if (params.category) query.set('category', params.category);

          const response = await fetch(`${BACKEND_URL}/api/b2b/geo/districts?${query}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });
          if (!response.ok) return;

          const data = await response.json();
          set({
            districts: (data.results ?? []) as DistrictRow[],
            coverage: (data.coverage ?? null) as Coverage | null,
          });
        } catch {
          // Same.
        }
      },

      /**
       * States somebody actually lives in.
       *
       * Was: all 51, every one carrying the national sentiment figure
       * multiplied by its share of the 435 House seats. There is no
       * apportionment now — a state with no declared residents is not in the
       * list, which is the truth about it.
       */
      fetchStates: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/geo/states?limit=60`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });
          if (!response.ok) return;

          const data = await response.json();
          set({
            states: (data.results ?? []) as StateRow[],
            coverage: (data.coverage ?? null) as Coverage | null,
          });
        } catch {
          // Leave the previous value alone rather than blanking the screen.
        }
      },

      fetchStateDetails: async (stateCode) => {
        const { session } = get();
        if (!session?.token) return null;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/geo/states/${stateCode}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });
          return response.ok ? await response.json() : null;
        } catch {
          return null;
        }
      },


      fetchIssues: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/issues`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            const data = await response.json();
            // Backend returns { results: [...] }, map to expected IssueData format
            const issuesData = data.issues || data.results || [];
            const mappedIssues: IssueData[] = issuesData.map((i: {
              id: string;
              name: string;
              category: string;
              sentiment: SentimentData;
              relatedBills?: string[] | number;
              hotspots?: string[];
              engagementCount?: number;
            }) => ({
              id: i.id,
              name: i.name,
              category: i.category,
              sentiment: i.sentiment,
              relatedBills: Array.isArray(i.relatedBills) ? i.relatedBills.length : (i.relatedBills || 0),
              hotspots: i.hotspots || [],
            }));
            set({ issues: mappedIssues });
          }
        } catch {
          // Ignore errors
        }
      },

      fetchIssueDetails: async (issueId) => {
        const { session } = get();
        if (!session?.token) return null;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/issues/${issueId}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            return await response.json();
          }
          return null;
        } catch {
          return null;
        }
      },

      fetchTrendingTopics: async () => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/sentiment/trends`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            const data = await response.json();
            // Map API response to expected TrendingTopic format
            const mapped: TrendingTopic[] = (data.trending || []).map((item: {
              id: string;
              name: string;
              sentimentScore: number;
              changePercent: number;
              engagementCount: number;
            }) => ({
              id: item.id,
              topic: item.name,
              category: 'General',
              mentions: item.engagementCount || 0,
              sentiment: item.sentimentScore || 0,
              change24h: item.changePercent || 0,
              velocity: item.changePercent > 5 ? 'accelerating' : item.changePercent < -5 ? 'decelerating' : 'stable' as const,
            }));
            set({ trendingTopics: mapped });
          }
        } catch {
          // Ignore errors
        }
      },

      /**
       * Only districts that clear the privacy floor carry a shade. The ones
       * withheld come back in `suppressed` with their voice count, so the map
       * can mark them "too few to report" — grey and "we will not say" are
       * different claims.
       */
      fetchHeatmapData: async (filters = {}) => {
        const { session } = get();
        if (!session?.token) return;

        try {
          const query = new URLSearchParams();
          if (filters.category) query.set('category', filters.category);
          if (filters.party) query.set('party', filters.party);
          if (filters.minEngagement) query.set('minEngagement', String(filters.minEngagement));

          const response = await fetch(`${BACKEND_URL}/api/b2b/geo/heatmap?${query}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });
          if (!response.ok) return;

          const data = (await response.json()) as HeatmapResult;
          set({ heatmapData: data, coverage: data.coverage ?? null });
        } catch {
          // Same.
        }
      },

      fetchForecast: async (targetType, targetId) => {
        const { session } = get();
        if (!session?.token) return null;

        try {
          const endpoint = targetType === 'bill'
            ? `/api/b2b/forecast/bills/${targetId}`
            : `/api/b2b/forecast/issues/${targetId}`;

          const response = await fetch(`${BACKEND_URL}${endpoint}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            return await response.json();
          }
          return null;
        } catch {
          return null;
        }
      },

      fetchBillSentiment: async (billId) => {
        const { session } = get();
        if (!session?.token) return null;

        try {
          const response = await fetch(`${BACKEND_URL}/api/b2b/sentiment/bills/${billId}`, {
            headers: { 'Authorization': `Bearer ${session.token}` },
          });

          if (response.ok) {
            const data = await response.json();
            return data.sentiment;
          }
          return null;
        } catch {
          return null;
        }
      },
    }),
    {
      name: 'civic-b2b-storage-v2',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        session: state.session,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state, error) => {
        // Always set hydrated to true, even on error
        useB2BStore.setState({ _hasHydrated: true });
      },
    }
  )
);
