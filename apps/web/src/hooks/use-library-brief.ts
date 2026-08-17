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
 * There is no browser-side brief writer. If no official source yields text, the
 * server says `unavailable` and we show that — we never invent a brief.
 */
import { useQuery } from "@tanstack/react-query";
import { civicApi } from "@/lib/civic";
import { toResolveRequest } from "@/lib/library-resolve";
import type { GovernmentSearchResult } from "@/lib/mobile/government-api";
import { useCitizenBrief, type CitizenBrief } from "@/hooks/use-citizen-brief";

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
  enabled = true,
): LibraryBrief {
  const resolve = useQuery({
    queryKey: ["library-resolve", result?.id],
    queryFn: () => civicApi.resolveLibraryDocument(toResolveRequest(result!)),
    enabled: enabled && !!result,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const referenceId = resolve.data?.reference.id ?? null;
  const brief = useCitizenBrief(referenceId, {
    initialState: resolve.data?.reference.briefState ?? "idle",
  });

  return {
    ...brief,
    referenceId,
    isResolving: resolve.isPending && !!result,
    isUnidentifiable: resolve.isError,
  };
}
