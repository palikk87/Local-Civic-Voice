import { Bell } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/hooks/use-civic-auth";

interface UnreadCount {
  unreadCount: number;
}

export function NotificationBell() {
  const { isAuthenticated } = useCurrentUser();

  const { data } = useQuery({
    queryKey: ["unread-notifications"],
    queryFn: () =>
      api.get<UnreadCount>("/api/notifications/unread-count"),
    enabled: isAuthenticated,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (!isAuthenticated) return null;

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <Link to="/notifications">
      <Button variant="ghost" size="icon" className="relative">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </Button>
    </Link>
  );
}
