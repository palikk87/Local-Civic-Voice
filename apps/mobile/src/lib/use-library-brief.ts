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
import { useMemo } from "react";
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
  // Key on the resolve request, not just result.id.
  //
  // toResolveRequest reads branch, title, sourceUrl, rawText, status and the
  // metadata block — none of which were in the old key. Ids are only unique
  // within a branch, so two results sharing one resolved to whichever was
  // fetched first, and re-searching with corrected metadata kept serving the
  // stale brief for the full 30-minute staleTime. React Query hashes keys
  // deterministically, so the request object can be the key.
  const request = useMemo(() => (result ? toResolveRequest(result) : null), [result]);

  const resolve = useQuery({
    queryKey: ["library-resolve", request],
    queryFn: () => resolveLibraryDocument(request!),
    enabled: enabled && !!request,
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
