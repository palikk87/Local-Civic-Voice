import { QueryClient } from '@tanstack/react-query';

/**
 * The app-wide React Query client, in its own module so non-component code
 * (the central vote pipeline) can invalidate queries after a vote lands.
 * Web twin: webapp/src/lib/query-client.ts
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 2,
    },
  },
});
