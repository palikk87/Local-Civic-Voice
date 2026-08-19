import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, MessageCircle, Heart, UserPlus, Share2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  data?: string;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: Notification[];
  nextCursor?: string;
  hasMore: boolean;
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "like":
      return <Heart className="h-5 w-5 text-red-500" />;
    case "comment":
    case "reply":
      return <MessageCircle className="h-5 w-5 text-blue-500" />;
    case "follow":
    case "new_follower_post":
      return <UserPlus className="h-5 w-5 text-green-500" />;
    case "mention":
      return <Bell className="h-5 w-5 text-yellow-500" />;
    case "share":
    case "repost":
      return <Share2 className="h-5 w-5 text-purple-500" />;
    default:
      return <Bell className="h-5 w-5 text-muted-foreground" />;
  }
}

function NotificationItem({ notification }: { notification: Notification }) {
  const queryClient = useQueryClient();

  const markAsReadMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/notifications/${notification.id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
    },
  });

  return (
    <div
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors ${
        notification.isRead
          ? "border-border bg-card/50"
          : "border-accent/30 bg-accent/5"
      }`}
    >
      <div className="mt-1">{getNotificationIcon(notification.type)}</div>

      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">{notification.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), {
            addSuffix: true,
          })}
        </p>
      </div>

      {!notification.isRead ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => markAsReadMutation.mutate()}
          disabled={markAsReadMutation.isPending}
          className="mt-1"
        >
          <CheckCircle2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

export default function Notifications() {
  const queryClient = useQueryClient();

  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["notifications"],
      queryFn: ({ pageParam }) => {
        const query = new URLSearchParams({
          limit: "20",
          ...(pageParam ? { cursor: pageParam } : {}),
        });
        return api.get<NotificationsResponse>(
          `/api/notifications?${query}`
        );
      },
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? lastPage.nextCursor : undefined,
    });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => api.post("/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
      toast.success("All notifications marked as read");
    },
  });

  const notifications = data?.pages?.flatMap((p) => p.notifications ?? []) ?? [];

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              <Bell className="h-6 w-6 text-accent" />
              Notifications
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Stay updated on interactions with your posts and accounts you follow.
            </p>
          </div>

          {notifications.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={markAllAsReadMutation.isPending}
            >
              Mark all as read
            </Button>
          ) : null}
        </div>

        <div className="space-y-3">
          {isLoading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2 rounded-lg border p-4">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </>
          ) : notifications.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-16 text-center">
              <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                No notifications yet
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                When someone engages with your posts, you'll see it here.
              </p>
            </div>
          ) : (
            <>
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                />
              ))}

              {hasNextPage ? (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
