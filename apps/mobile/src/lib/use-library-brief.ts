/**
 * Citizen's Brief for a live Library search result.
 *
 * Two steps, and only the first one happens on its own:
 *
 *  1. resolve — the server finds or creates the document's master reference row.
 *     Identity only. It writes nothing and starts nothing.
 *  2. ask     — the reader presses "Get Citizen Brief" and the server writes it
 *     from the complete official text, once, for everyone.
 *
 * Step 2 used to happen automatically, and the screen polled a status until the
 * server said otherwise. When the work behind that status died with the process
 * doing it, the status never changed and the spinner never stopped. Reading a
 * law and paying to summarize it are different acts; only the second needs
 * someone to ask.
 *
 * There is no on-device brief writer. If no official source yields text, the
 * server reports `unavailable` and we show that — we never invent a brief.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveLibraryDocument } from "@/lib/api/references";
import { toResolveRequest } from "@/lib/library-resolve";
import type { GovernmentSearchResult } from "@/lib/government-api";
import { useCitizenBrief, type CitizenBrief } from "@/lib/use-citizen-brief";

export interface LibraryBrief extends CitizenBrief {
  /** GovernmentReference.id — what a shared post attaches to. */
  referenceId: string | null;
  /** Still working out which record this is. */
  isResolving: boolean;
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

  const referenceId = resolve.data?.reference?.id ?? null;
  /*
   * THE BUTTON IS ALWAYS THE WAY IN, even when the brief is already written.
   * Seeding this from the record made a law somebody had already asked about
   * open with its brief on screen, which reads as the page fetching it and
   * removes the moment a reader decides to ask. Pressing the button on a brief
   * we already hold returns it immediately and costs nothing.
   */
  const brief = useCitizenBrief(referenceId);

  return {
    ...brief,
    referenceId,
    isResolving: resolve.isPending && !!request,
    isUnidentifiable: resolve.isError,
  };
}
