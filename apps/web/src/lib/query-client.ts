import { QueryClient, keepPreviousData } from "@tanstack/react-query";

/**
 * The app-wide React Query client, in its own module so non-component code
 * (the central vote pipeline) can invalidate queries after a vote lands.
 *
 * NOTHING A PERSON DOES MAY MOVE THE PAGE UNDER THEM.
 * ---------------------------------------------------------------------------
 * Reported like this: "when changing my vote it refreshes the whole screen and
 * takes me to the top."
 *
 * WHY THAT HAPPENED. A vote invalidates every query that shows the law. That is
 * correct — all surfaces must agree on the tally. What was not correct is what
 * some of those screens did while the refetch was in flight: they swapped their
 * content for a skeleton. The document got shorter, the browser clamped the
 * scroll position to the new height, and when the content came back the reader
 * was at the top of a page they had been halfway down. Nothing navigated.
 * Nothing reloaded. The page collapsed and took their place with it.
 *
 * THE RULE, SET ONCE HERE RATHER THAN REMEMBERED ON EVERY SCREEN.
 * `placeholderData: keepPreviousData` means a query that already has an answer
 * keeps showing it while fetching the next one — across a refetch AND across a
 * key change, which is the case an individual `isLoading` check misses. The
 * layout holds its height, so there is nothing for the browser to clamp.
 *
 * A screen that genuinely wants a skeleton still gets one on the FIRST load,
 * because there is no previous data to keep. That is the only time a skeleton
 * is honest anyway: the rest of the time it is hiding an answer we already have.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60 * 1000, // Keep unused data for 5 minutes
      // Hold the last answer on screen while the next one is fetched.
      placeholderData: keepPreviousData,
    },
  },
});
