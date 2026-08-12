/**
 * Web port of webapp/mobile/src/lib/api/references.ts (hooks half).
 * Reads the daily-synced government reference store both faucets share.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  civicApi,
  type CitizenBriefSections,
  type GovReferenceDetail,
  type ReferenceType,
} from "@/lib/civic";

export const referenceKeys = {
  trending: (referenceType: ReferenceType, limit: number) =>
    ["government-references", "trending", referenceType, limit] as const,
  latest: (referenceType: ReferenceType, limit: number) =>
    ["government-references", "latest", referenceType, limit] as const,
  detail: (id: string) => ["government-references", "detail", id] as const,
};

/** Top N references for one branch, ranked by community engagement then recency. */
export function useTrendingReferences(referenceType: ReferenceType, limit = 10) {
  return useQuery({
    queryKey: referenceKeys.trending(referenceType, limit),
    queryFn: () => civicApi.trending(limit, referenceType),
    staleTime: 5 * 60 * 1000,
  });
}

/** Newest references for one branch — surfaces freshly synced items that have no votes yet. */
export function useLatestReferences(referenceType: ReferenceType, limit = 30) {
  return useQuery({
    queryKey: referenceKeys.latest(referenceType, limit),
    queryFn: () =>
      civicApi.listReferences({ referenceType, sortBy: "createdAt", sortOrder: "desc", limit }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Single reference by database id — used by detail pages for synced items.
 *
 * Opening a law is what triggers the server to pull its official text and write
 * the citizen brief onto the master reference (first reader pays, everyone after
 * is served from storage). While that work is in flight the server reports
 * contentStatus brief_pending/fetching, so we poll until it lands.
 */
export function useGovernmentReference(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: referenceKeys.detail(id ?? ""),
    queryFn: () => civicApi.getReference(id ?? ""),
    enabled: enabled && !!id,
    staleTime: 60 * 1000,
    retry: 1,
    refetchInterval: (query) => {
      const status = query.state.data?.reference?.contentStatus;
      return status === "brief_pending" || status === "fetching" ? 4000 : false;
    },
  });
}

/**
 * Ask the server to re-pull the official text and rewrite the brief on the master
 * reference. Used by the brief card's refresh control on both faucets.
 */
export function useRefreshReferenceContent(id: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => civicApi.refreshReferenceContent(id ?? ""),
    onSuccess: () => {
      if (id) queryClient.invalidateQueries({ queryKey: referenceKeys.detail(id) });
    },
  });
}

/** What the Citizen's Brief card needs when the brief lives on the master reference. */
export interface ReferenceBriefProps {
  initialBrief: CitizenBriefSections | null;
  labels?: { goal?: string; wallet?: string; debate?: string };
  serverPending: boolean;
  onRefresh?: () => Promise<void>;
}

/**
 * Brief card props sourced from the master reference. Everything is null/false for
 * documents that have no reference row (static library items), so those callers
 * keep their existing client-side generation path.
 */
export function useReferenceBriefProps(
  id: string | undefined,
  reference: GovReferenceDetail | undefined | null,
): ReferenceBriefProps {
  const refresh = useRefreshReferenceContent(id);
  const status = reference?.contentStatus ?? null;
  const stored = reference?.citizenBriefSections ?? null;

  return {
    initialBrief: stored,
    labels: reference?.citizenBriefLabels,
    serverPending:
      !stored && (refresh.isPending || status === "brief_pending" || status === "fetching"),
    onRefresh: reference
      ? async () => {
          await refresh.mutateAsync().catch(() => undefined);
        }
      : undefined,
  };
}
