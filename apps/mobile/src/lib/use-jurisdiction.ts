/**
 * Where the signed-in person says they are — one source, for every screen.
 * Parity with apps/web/src/hooks/use-jurisdiction.ts.
 *
 * `districtId` of null is a complete answer, not a loading state: most people
 * will never set this, and every caller renders that case rather than guessing.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from './api/api';

export interface MyJurisdiction {
  stateCode: string | null;
  districtId: string | null;
  setAt: string | null;
  district: {
    districtId: string;
    stateCode: string;
    stateName: string;
    district: number | null;
    representative: { name: string; party: string; photoUrl: string | null } | null;
  } | null;
}

export function useJurisdiction(enabled = true) {
  return useQuery<MyJurisdiction>({
    queryKey: ['me', 'jurisdiction'],
    queryFn: () => api.get<MyJurisdiction>('/api/users/me/jurisdiction'),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
