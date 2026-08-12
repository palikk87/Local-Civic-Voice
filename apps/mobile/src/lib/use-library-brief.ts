/**
 * Citizen's Brief for a live Library search result.
 *
 * Two steps, one water source:
 *  1. resolve — the server finds or creates the document's master reference row.
 *  2. poll    — the same detail endpoint every other screen reads, until the server
 *               has pulled the full official text and written the brief.
 *
 * There is no on-device brief writer any more. If no official source yields text,
 * the server reports `unavailable` and we say so — we never invent a brief.
 */
import { useQuery } from "@tanstack/react-query";
import {
  resolveLibraryDocument,
  useGovernmentReference,
  type CitizenBriefLabels,
  type CitizenBriefSections,
} from "@/lib/api/references";
import { toResolveRequest } from "@/lib/library-resolve";
import type { GovernmentSearchResult } from "@/lib/government-api";

export interface LibraryBrief {
  /** GovernmentReference.id — what a shared post attaches to. */
  referenceId: string | null;
  brief: CitizenBriefSections | null;
  labels: CitizenBriefLabels | null;
  /** Resolving, pulling official text, or writing the brief. */
  isPending: boolean;
  /** No official source had the text, so there is no brief to show. */
  isUnavailable: boolean;
  /** The document could not be identified from the official source. */
  isUnidentifiable: boolean;
}

export function useLibraryBrief(
  result: GovernmentSearchResult | null,
  enabled = true
): LibraryBrief {
  const resolve = useQuery({
    queryKey: ["library-resolve", result?.id],
    queryFn: () => resolveLibraryDocument(toResolveRequest(result!)),
    enabled: enabled && !!result,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const referenceId = resolve.data?.reference.id ?? null;
  const detail = useGovernmentReference(referenceId ?? undefined, !!referenceId);
  const reference = detail.data?.reference;

  const brief = reference?.citizenBriefSections ?? null;
  const status = reference?.contentStatus ?? null;

  const isPending =
    !brief &&
    !resolve.isError &&
    (resolve.isPending || detail.isPending || status === "fetching" || status === "brief_pending");

  return {
    referenceId,
    brief,
    labels: reference?.citizenBriefLabels ?? null,
    isPending,
    // Settled with nothing to show: no source had the official text.
    isUnavailable: !brief && !isPending && !resolve.isError,
    isUnidentifiable: resolve.isError,
  };
}
