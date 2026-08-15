import { Link } from "react-router-dom";
import { MessageCircle, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { useConversations, otherParticipant } from "@/lib/api/messages";

/**
 * Conversation list.
 *
 * The web app had no messaging screen at all, while the backend has been
 * Prisma-backed and working and pages/Timeline.tsx already linked here — that
 * link resolved to the 404 page.
 *
 * Deliberately plainer than mobile's version: no swipe actions, no long-press
 * menu. This is the browser, and the mobile screen's gestures have no meaning
 * here. Everything you can *do* is the same.
 */
export default function Messages() {
  // Signed-out visitors never reach here — App.tsx wraps this route in
  // RouteGuard capability="viewMessages", same as every other private page.
  const { user } = useCurrentUser();
  const { data, isLoading, isError, error, refetch } = useConversations();

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl p-4">
        <h1 className="mb-4 text-xl font-semibold">Messages</h1>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Could not load your conversations."}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}

        {!isLoading && !isError && (data?.results.length ?? 0) === 0 && (
          <div className="rounded-lg border border-border p-8 text-center">
            <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No conversations yet. Open someone&apos;s profile to start one.
            </p>
          </div>
        )}

        <ul className="divide-y divide-border">
          {data?.results.map((conversation) => {
            const other = otherParticipant(conversation, user?.id);
            const preview = conversation.lastMessage;

            return (
              <li key={conversation.id}>
                <Link
                  to={`/conversation/${conversation.id}`}
                  className="flex items-center gap-3 py-3 transition-colors hover:bg-accent/50"
                >
                  <img
                    src={other?.avatar}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">
                        {other?.displayName ?? "Unknown"}
                      </span>
                      {preview && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(preview.createdAt), { addSuffix: true })}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {preview?.content ?? "No messages yet"}
                    </p>
                  </div>

                  {conversation.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                      {conversation.unreadCount}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </AppShell>
  );
}
