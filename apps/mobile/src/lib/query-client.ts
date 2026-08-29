import { QueryClient, keepPreviousData } from '@tanstack/react-query';

/**
 * The app-wide React Query client, in its own module so non-component code
 * (the central vote pipeline) can invalidate queries after a vote lands.
 * Web twin: apps/web/src/lib/query-client.ts
 *
 * NOTHING A PERSON DOES MAY MOVE THE SCREEN UNDER THEM.
 * ---------------------------------------------------------------------------
 * A vote invalidates every query showing the law, which is right — all surfaces
 * must agree on the tally. What was wrong is that a screen refetching could
 * swap its content for a spinner, collapse its own height, and throw the reader
 * back to the top of a list they were halfway down.
 *
 * keepPreviousData holds the last answer on screen while the next one is
 * fetched — across a refetch and across a key change. The list keeps its
 * height, so scroll position has nothing to snap to. A first load still gets a
 * spinner, because then there is genuinely nothing to show.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
      // Hold the last answer on screen while the next one is fetched.
      placeholderData: keepPreviousData,
    },
  },
});
