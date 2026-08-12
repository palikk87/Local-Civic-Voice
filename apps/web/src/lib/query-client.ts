import { QueryClient } from "@tanstack/react-query";

/**
 * The app-wide React Query client, in its own module so non-component code
 * (the central vote pipeline) can invalidate queries after a vote lands.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60 * 1000, // Keep unused data for 5 minutes
    },
  },
});
