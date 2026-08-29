import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { FileText, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";

/**
 * A LINK IN A MESSAGE YOU CAN ACTUALLY FOLLOW.
 *
 * WHY THIS EXISTS. Sharing a post to somebody sends them a message with the
 * post's address in it. The thread rendered that address as plain text, so it
 * was not tappable: the whole point of sharing — "here, look at this" — ended
 * with the reader copying a string out of a chat bubble and pasting it into the
 * address bar. Asked for as "that post lands in their inbox where they can
 * click on it and be guided to the post".
 *
 * WHY IT READS THE TEXT RATHER THAN A NEW COLUMN. The tidy answer is a
 * sharedPostId on Message, and I said that field already existed. It does not.
 * Adding one means a migration on a database this project shares with another,
 * to store something the message already contains. Reading the link out of the
 * text needs no migration, and it covers a link somebody types by hand — which
 * a column never would.
 *
 * WHAT IT SHOWS. The real title, fetched from the same endpoints the pages use.
 * If the record cannot be loaded — deleted, or the reader is not allowed to see
 * it — this renders a plain link rather than inventing a title for it. A
 * preview card that makes up what it is pointing at is worse than no card.
 */

/** Post and law links this app owns. Anything else is left as ordinary text. */
const INTERNAL = /https?:\/\/[^\s]*\/(post|reference)\/([A-Za-z0-9_-]+)/;

export function findSharedLink(text: string): { kind: "post" | "reference"; id: string; href: string } | null {
  const match = INTERNAL.exec(text);
  if (!match) return null;
  const [href, kind, id] = match;
  if (kind !== "post" && kind !== "reference") return null;
  return { kind, id, href };
}

/** The message with its link removed, so the card does not repeat it. */
export function textWithoutLink(text: string): string {
  return text.replace(INTERNAL, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function SharedLinkCard({ kind, id }: { kind: "post" | "reference"; id: string }) {
  /**
   * One shape out of two endpoints, decided here rather than at every use.
   * A union that the caller has to narrow is how three lines below it end up
   * disagreeing about which half they are looking at.
   */
  const { data, isError } = useQuery<{ title: string | null; byline: string | null }>({
    queryKey: ["shared-link", kind, id],
    queryFn: async () => {
      if (kind === "post") {
        const body = await api.get<{
          post: { content: string; author: { name: string | null; username: string | null } };
        }>(`/api/posts/${id}`);
        const author = body.post.author;
        return {
          title: body.post.content.split("\n")[0]?.slice(0, 120) ?? null,
          byline: author.name ?? (author.username ? `@${author.username}` : null),
        };
      }
      const body = await api.get<{ reference: { title: string; displayId: string } }>(
        `/api/government-references/${id}`,
      );
      return { title: body.reference.title, byline: body.reference.displayId };
    },
    retry: false,
  });

  const to = kind === "post" ? `/post/${id}` : `/reference/${id}`;

  // Nothing invented while it loads, and nothing invented if it never does.
  const title = data?.title ?? null;
  const byline = data?.byline ?? null;

  if (isError) {
    // The record is gone or not ours to show. Still a link, still honest.
    return (
      <Link to={to} className="mt-2 block text-xs underline underline-offset-2 opacity-80">
        Open this {kind === "post" ? "post" : "law"}
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className="mt-2 flex items-start gap-2 rounded-xl border border-border bg-background/60 p-2.5 transition-colors hover:bg-background"
    >
      {kind === "post" ? (
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      ) : (
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-foreground">
          {title ?? (kind === "post" ? "A post" : "A law")}
        </span>
        {byline ? (
          <span className="block truncate text-[11px] text-muted-foreground">{byline}</span>
        ) : null}
      </span>
    </Link>
  );
}
