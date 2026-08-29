import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SharedLinkCard, findSharedLink, textWithoutLink } from "@/components/messages/SharedLink";
import { ArrowLeft, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import {
  useConversation,
  useSendMessage,
  otherParticipant,
} from "@/lib/api/messages";

/**
 * One conversation thread.
 *
 * The backend returns messages newest-first for pagination; a thread reads
 * oldest-at-top, so the list is reversed for rendering. Doing it here rather
 * than changing the endpoint keeps `offset`/`limit` paging meaningful — and
 * mobile's screen does exactly the same thing.
 */
export default function Conversation() {
  const { id } = useParams<{ id: string }>();
  // RouteGuard capability="viewMessages" gates this route in App.tsx.
  const { user } = useCurrentUser();

  const { data, isLoading, isError, error, refetch } = useConversation(id);
  const sendMessage = useSendMessage(id);

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = data?.messages ? [...data.messages].reverse() : [];

  // Jump to the newest message when the thread loads or grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const other = data?.conversation ? otherParticipant(data.conversation, user?.id) : undefined;

  function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sendMessage.isPending) return;

    // Clear optimistically so typing feels immediate. On failure the text is
    // restored below rather than silently lost.
    setDraft("");
    sendMessage.mutate(content, {
      onError: () => setDraft(content),
    });
  }

  return (
    <AppShell>
      <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-2xl flex-col p-4">
        <header className="mb-4 flex items-center gap-3 border-b border-border pb-3">
          <Link
            to="/messages"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent"
            aria-label="Back to messages"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          {other && (
            <>
              <img src={other.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
              <div className="min-w-0">
                <p className="truncate font-medium leading-tight">{other.displayName}</p>
                <p className="truncate text-xs text-muted-foreground">@{other.username}</p>
              </div>
            </>
          )}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto">
          {isLoading && (
            <>
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-12 w-1/2" />
              <Skeleton className="h-12 w-3/5" />
            </>
          )}

          {isError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="text-sm text-destructive">
                {error instanceof Error ? error.message : "Could not load this conversation."}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          )}

          {!isLoading && !isError && messages.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No messages yet. Say something.
            </p>
          )}

          {messages.map((message) => {
            const isMine = message.senderId === user?.id;
            return (
              <div
                key={message.id}
                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                    isMine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {/*
                    A SHARED POST ARRIVES AS SOMETHING YOU CAN OPEN.

                    Sharing a post sends a message with the post's address in
                    it, and this rendered that address as plain text. So the
                    whole point of sharing — "here, look at this" — ended with
                    the reader copying a string out of a chat bubble. The link
                    becomes a card with the real title on it; the words around
                    it stay as they were written.
                  */}
                  {(() => {
                    const shared = findSharedLink(message.content);
                    const said = shared ? textWithoutLink(message.content) : message.content;
                    return (
                      <>
                        {said ? (
                          <p className="whitespace-pre-wrap break-words text-sm">{said}</p>
                        ) : null}
                        {shared ? <SharedLinkCard kind={shared.kind} id={shared.id} /> : null}
                      </>
                    );
                  })()}
                  <p
                    className={`mt-1 text-[10px] ${
                      isMine ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} className="mt-3 flex items-center gap-2 border-t border-border pt-3">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a message"
            aria-label="Message"
            disabled={sendMessage.isPending}
          />
          <Button type="submit" size="icon" disabled={!draft.trim() || sendMessage.isPending}>
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>

        {sendMessage.isError && (
          <p className="mt-2 text-xs text-destructive">
            Message not sent. Your text is still in the box — try again.
          </p>
        )}
      </div>
    </AppShell>
  );
}
