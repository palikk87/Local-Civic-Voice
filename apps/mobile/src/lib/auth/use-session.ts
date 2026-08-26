import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export const SESSION_QUERY_KEY = ["auth-session"] as const;

export const useSession = () => {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async () => {
      const result = await authClient.getSession();

      // A FAILED ASK IS NOT AN ANSWER. Better Auth reports a transport failure
      // by returning { data: null, error }, and reading only `data` turned
      // "the server could not be reached" into "this person is signed out" —
      // which is how a signed-in reader gets pushed towards a sign-in that
      // needs the same unreachable server. Throwing puts it where React Query
      // can see it, so useCurrentUser can say which of the two happened.
      if (result.error) {
        throw new Error(result.error.message ?? "Could not reach the server");
      }
      return result.data?.user ?? null;
    },
    staleTime: 1000 * 60 * 5, // 5 min cache
    retry: false,
  });
};

/**
 * Call this after any auth action (sign-in, sign-up, sign-out)
 * to refresh the session state and trigger navigation guards.
 */
export const useInvalidateSession = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
};
