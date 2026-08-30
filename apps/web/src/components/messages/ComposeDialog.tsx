/**
 * Start a conversation.
 *
 * WHY THIS EXISTS. Messages was a list of conversations with no compose, no
 * recipient search and no send — so the only way to start one was to already
 * have one. The empty state read "Open someone's profile to start one", and
 * profiles had no message button either. A closed loop.
 *
 * NOTHING NEW ON THE SERVER. POST /api/messages/conversations has taken a
 * participantId and an optional first message since messaging was built, and it
 * appends to an existing thread rather than creating a duplicate. This is the
 * screen that was missing, not the capability.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search, Send } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { useStartConversation } from "@/lib/api/messages";
import { cn } from "@/lib/utils";

interface Person {
  id: string;
  displayName?: string;
  username?: string;
  name?: string;
}

export function ComposeDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Something to say, already written, carried into the conversation this
   * opens. Used by "Send to someone" on a law, which knows what you are
   * sending before it knows who you are sending it to.
   *
   * It is a DRAFT and not a sent message: it lands in the box with the cursor
   * after it, and nothing goes anywhere until the person presses send. Sending
   * on somebody's behalf, to a person they only just chose, is putting words in
   * their mouth.
   */
  draft?: string;
}) {
  const navigate = useNavigate();
  const start = useStartConversation();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Person | null>(null);
  const [body, setBody] = useState("");

  // A short debounce, unlike the Library's explicit submit: this is a picker
  // inside a dialog where typing IS the request, and making somebody press a
  // button to see names would be strange.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debounced.length < 2) {
      setPeople([]);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    api
      .get<{ users?: Person[]; results?: Person[] }>(
        `/api/users/search?q=${encodeURIComponent(debounced)}`,
      )
      .then((data) => {
        if (!cancelled) setPeople(data.users ?? data.results ?? []);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  const nameOf = (person: Person) =>
    person.displayName || person.name || person.username || "Someone";

  const canSend = useMemo(() => picked !== null && body.trim().length > 0, [picked, body]);

  function reset() {
    setQuery("");
    setDebounced("");
    setPeople([]);
    setPicked(null);
    setBody("");
  }

  async function send() {
    if (!picked || !body.trim()) return;
    try {
      const result = await start.mutateAsync({
        participantId: picked.id,
        message: body.trim(),
      });
      reset();
      onOpenChange(false);
      /*
       * /conversation/:id, NOT /messages/:id.
       *
       * This said `/messages/${id}`, which is not a route this app mounts — the
       * thread route is /conversation/:id, and the Messages list has always
       * linked to it correctly. So React Router fell through to the catch-all
       * and rendered Not Found.
       *
       * The message had already SENT by then. The POST succeeded, the
       * conversation existed, the words were delivered — and the sender was
       * shown a 404 and reasonably concluded that messaging was broken. A
       * wrong redirect after a successful write is worse than a failed write,
       * because the person retries something that already happened.
       */
      navigate(`/conversation/${result.conversation.id}`, draft ? { state: { draft } } : undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not send.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Search for someone by name or handle, then write to them.
          </DialogDescription>
        </DialogHeader>

        {picked ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="font-medium text-foreground">{nameOf(picked)}</span>
            <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people"
                aria-label="Search for someone to message"
                className="pl-9"
              />
            </div>

            {searching ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : null}

            {!searching && debounced.length >= 2 && people.length === 0 ? (
              /* An honest empty result rather than a spinner that never ends. */
              <p className="py-2 text-sm text-muted-foreground">
                Nobody here matches &ldquo;{debounced}&rdquo;.
              </p>
            ) : null}

            {people.length > 0 ? (
              <ul className="max-h-56 space-y-1 overflow-y-auto">
                {people.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(person)}
                      className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted"
                    >
                      <span className="font-medium text-foreground">{nameOf(person)}</span>
                      {person.username ? (
                        <span className="ml-2 text-sm text-muted-foreground">
                          @{person.username}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write your message"
          aria-label="Message"
          rows={4}
          disabled={!picked}
        />

        <Button
          onClick={() => void send()}
          disabled={!canSend || start.isPending}
          className={cn("w-full", !canSend && "opacity-60")}
        >
          {start.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Send
        </Button>
      </DialogContent>
    </Dialog>
  );
}
