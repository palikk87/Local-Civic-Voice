import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AttachedLawCard } from "@/components/feed/AttachedLawCard";
import { useTimelineStore, type TimelinePost } from "@/lib/mobile/timeline-store";

/**
 * YOUR OWN WORDS, CHANGED.
 *
 * Reported plainly: "The edit post button doesn't go anywhere ... It should
 * allow you to edit your post and its content. Not the original law posted but
 * the content that the poster added to it."
 *
 * THE LAW IS SHOWN AND NOT EDITABLE, which is the whole distinction he drew.
 * A post is somebody's words ABOUT a record; the record is what everybody
 * replying, voting and passing it on is responding to. So the law card sits
 * here, plainly, above a box that only holds the words — you can see exactly
 * what you are keeping while you change what is yours.
 *
 * The server refuses an empty edit on a post that carries nothing else, the
 * same rule the composer applies, so this cannot leave a post that is nothing.
 */
export function EditPostDialog({
  post,
  open,
  onOpenChange,
}: {
  post: TimelinePost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const editPost = useTimelineStore((s) => s.editPost);
  const [words, setWords] = useState("");
  const [saving, setSaving] = useState(false);

  // Reopening on a different post must not show the last one's words.
  useEffect(() => {
    if (post) setWords(post.opinion ?? post.content ?? "");
  }, [post]);

  if (!post) return null;

  const lawId = post.sharedContent?.id;
  const carriesSomethingElse = Boolean(lawId) || (post.media?.length ?? 0) > 0;
  const canSave = !saving && (words.trim().length > 0 || carriesSomethingElse);

  const save = async () => {
    setSaving(true);
    try {
      await editPost(post.id, words);
      toast.success("Post updated");
      onOpenChange(false);
    } catch {
      toast.error("Could not save your changes. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit your post</DialogTitle>
          <DialogDescription>
            {lawId
              ? "The law stays as it is. These are your words about it."
              : "Change what you wrote."}
          </DialogDescription>
        </DialogHeader>

        {/* The law, shown and fixed. onRemove is deliberately absent: there is
            no way to detach it from here, because everybody who replied did so
            to a post about THIS record. */}
        {lawId ? (
          <AttachedLawCard
            referenceId={lawId}
            fallbackTitle={post.sharedContent?.title ?? "This law"}
            fallbackIdentifier={post.sharedContent?.displayId ?? null}
            onRemove={() => undefined}
          />
        ) : null}

        <Textarea
          value={words}
          onChange={(event) => setWords(event.target.value)}
          rows={6}
          maxLength={5000}
          placeholder={carriesSomethingElse ? "Say something about it (optional)" : "Your words"}
          aria-label="Your words"
        />

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
