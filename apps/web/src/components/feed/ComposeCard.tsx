import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, FileText, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReferenceSearchModal, {
  type GovernmentReference,
} from "@/components/mobile/ReferenceSearchModal";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { postsApi } from "@/lib/civic";

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name || email || "?").trim();
  return base
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function ComposeCard() {
  const { user, isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const queryClient = useQueryClient();

  const [content, setContent] = useState<string>("");
  const [selected, setSelected] = useState<GovernmentReference | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchParams, setSearchParams] = useSearchParams();

  /**
   * A law shared from somewhere else on the platform.
   *
   * ShareToTimeline resolves whatever a card knows into the canonical record
   * and sends the reader here with ?share=<id>. The composer attaches it and
   * leaves the writing to them — the post is theirs, so the words are too.
   *
   * The parameter is cleared once it has been used, so a refresh or a back
   * button does not silently re-attach a law somebody already removed.
   */
  const shareId = searchParams.get("share");
  useEffect(() => {
    if (!shareId) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/government-references/${encodeURIComponent(shareId)}`,
          { credentials: "include" },
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          reference?: { id: string; title: string; referenceType: string; status?: string; displayId?: string };
        };
        const reference = body.reference;
        if (cancelled || !reference) return;

        setSelected({
          id: reference.id,
          type: reference.referenceType as GovernmentReference["type"],
          title: reference.title,
          status: reference.status ?? "",
          ...(reference.displayId ? { identifier: reference.displayId } : {}),
        });
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchParams);
          next.delete("share");
          setSearchParams(next, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only the id matters: re-running when the setter identity changes would
    // re-fetch a law the reader may have just taken off the post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId]);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Pick a reference");
      return postsApi.create({
        content: content.trim(),
        governmentReferenceId: selected.id,
      });
    },
    onSuccess: () => {
      setContent("");
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["algorithmic-feed"] });
      toast.success("Posted");
    },
    onError: () => toast.error("Couldn't post. Try again."),
  });

  if (!isAuthenticated) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="font-display text-lg font-semibold text-foreground">
          Join the conversation
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to post and vote on the bills, orders, and rulings shaping the country.
        </p>
        <Button className="mt-4" onClick={() => openAuth("Sign in to post")}>
          Sign in
        </Button>
      </div>
    );
  }

  const initials = initialsOf(user?.name, user?.email);
  const canPost = content.trim().length > 0 && !!selected && !createMutation.isPending;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex gap-3">
        <Avatar className="h-10 w-10 border border-border">
          {user?.image ? <AvatarImage src={user.image} alt={user.name ?? ""} /> : null}
          <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share your take on a bill, order, or ruling…"
            className="min-h-[80px] resize-none border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
          />

          {/* Attached reference chip */}
          {selected ? (
            <div className="flex items-center rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
              <FileText size={15} className="mr-2 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {selected.identifier ? `${selected.identifier} · ` : ""}
                {selected.title}
              </span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="ml-2 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
                aria-label="Remove attached reference"
              >
                <X size={14} />
              </button>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {/* Mini search bar — same search the Library uses */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-h-[40px] flex-1 items-center rounded-lg border border-input bg-background px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <Search size={15} className="mr-2 shrink-0" />
              {selected ? "Search for a different document…" : "Search bills, orders, cases to attach (required)"}
            </button>
            <Button
              className="shrink-0"
              disabled={!canPost}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      </div>

      {/* Expands in place rather than opening over your draft. Attaching a law
          is required to post, so the picker was a full-screen dialog every
          single time somebody wrote anything. */}
      <ReferenceSearchModal
        inline
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(reference) => {
          setSelected(reference);
          setSearchOpen(false);
        }}
      />
    </div>
  );
}
