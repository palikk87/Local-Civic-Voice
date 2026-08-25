/**
 * Where the signed-in person says they are — one source, for every screen.
 *
 * WHY A HOOK AND NOT A FIELD ON EACH SCREEN. Three places want this: the Local
 * feed, the Representation Gap, and the district picker itself. The last time
 * this codebase let three screens each answer the same question their own way,
 * the answers disagreed and two of them were invented. One reader, one shape,
 * one empty state.
 *
 * `districtId` of null is a complete answer, not a loading state — most people
 * will never set this, and every caller has to render that case properly rather
 * than guess.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
    queryKey: ["me", "jurisdiction"],
    queryFn: () => api.get<MyJurisdiction>("/api/users/me/jurisdiction"),
    enabled,
    // It changes when the person changes it and at no other time, so this need
    // not be re-fetched on every focus.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
