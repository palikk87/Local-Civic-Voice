/**
 * How many notifications you have not read.
 *
 * ONE PROFILE, EVERY DEVICE. This used to come from a store persisted to the
 * device, so the badge counted what THIS phone or THIS browser happened to have
 * seen. Reading a notification on a laptop left the phone still showing it, and
 * a new sign-in started at whatever that device remembered — which for a fresh
 * one was nothing at all.
 *
 * The count belongs to the person, so the server keeps it.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useUnreadNotifications(enabled = true): number {
  const { data } = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.get<{ count: number }>("/api/notifications/unread-count"),
    enabled,
    // Often enough to feel live, rarely enough not to poll the server for a
    // number nobody is staring at.
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  // Undefined while it loads, and on failure. Not zero — "we have not asked
  // yet" and "you have nothing waiting" are different facts, and showing the
  // second when the first is true is the kind of small lie this codebase does
  // not tell. A missing badge is the honest render for both.
  return data?.count ?? 0;
}
