import { useState } from "react";
import { toast } from "sonner";
import { Flag, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { safetyApi, type ReportReason } from "@/lib/civic";

/**
 * Reporting somebody, with a reason and in their own words.
 *
 * WHAT THIS REPLACES. Three buttons — a profile, a post on the web, a post on
 * the phone — each of which fired instantly with `reason: "other"` and no
 * description at all, and then said "a moderator will look at this". Six
 * reasons and two thousand characters of detail have been in the API since it
 * was written; nothing ever sent either. So every report on the platform
 * arrived saying "other", about nothing in particular, and whoever read it had
 * no idea what they were being asked to look at.
 *
 * Reported plainly: "doesn't do anything just says a report has been sent…
 * bring up a form to complete about the reason and cause of reporting".
 *
 * ONE DIALOG FOR EVERY TARGET. A post, a comment or a person — the API takes
 * exactly one of the three and this passes through whichever it was given.
 * Three separate forms is three places for the reasons to drift apart.
 */

/** The six the API accepts, in the words a person would use. */
const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: "harassment", label: "Harassment", hint: "Targeting or following somebody around" },
  { value: "hate", label: "Hate", hint: "Attacks on people for who they are" },
  { value: "violence", label: "Violence or threats", hint: "Threatening or encouraging harm" },
  {
    value: "misinformation",
    label: "Misrepresenting a law",
    hint: "Saying a law does something it does not",
  },
  { value: "spam", label: "Spam", hint: "Repetitive, automated or commercial" },
  { value: "other", label: "Something else", hint: "Tell us below" },
];

export interface ReportTarget {
  /** Exactly one of these three. */
  postId?: string;
  commentId?: string;
  userId?: string;
  /** What the reader is looking at, for the heading. */
  what: string;
}

export function ReportDialog({
  target,
  open,
  onOpenChange,
}: {
  target: ReportTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);

  function close() {
    onOpenChange(false);
    // Cleared on the way out rather than the way in, so a reopened dialog is
    // never pre-filled with the last thing somebody typed about somebody else.
    setReason(null);
    setDetail("");
  }

  async function send() {
    if (!target || !reason) return;
    setSending(true);
    try {
      await safetyApi.report({
        ...(target.postId ? { postId: target.postId } : {}),
        ...(target.commentId ? { commentId: target.commentId } : {}),
        ...(target.userId ? { userId: target.userId } : {}),
        reason,
        // Empty is omitted rather than sent as "", so a blank field does not
        // read on the queue as somebody having written nothing on purpose.
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
      // WHAT ACTUALLY HAPPENS. This used to say "a moderator will look at
      // this", which was a claim about a person on a platform where reports
      // are heard by a jury of citizens — and where, at the time, no screen
      // existed for a moderator to look at anything.
      toast.success("Report filed", {
        description:
          "A jury of citizens is drawn to hear it, and you will be told what they decide.",
      });
      close();
    } catch {
      toast.error("Couldn't file the report", {
        description: "Nothing was sent. Try again in a moment.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg" data-testid="report-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="h-4 w-4" /> Report {target?.what ?? "this"}
          </DialogTitle>
          <DialogDescription>
            Reports are read by a jury of randomly drawn citizens. Nothing is hidden or
            removed because somebody complained — they decide, and they have to give reasons.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">What is wrong?</Label>
            <RadioGroup
              value={reason ?? ""}
              onValueChange={(value) => setReason(value as ReportReason)}
              className="mt-2 space-y-1.5"
            >
              {REASONS.map((entry) => (
                <label
                  key={entry.value}
                  htmlFor={`reason-${entry.value}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 transition-colors hover:border-accent/50"
                >
                  <RadioGroupItem
                    value={entry.value}
                    id={`reason-${entry.value}`}
                    className="mt-0.5"
                  />
                  <span className="text-sm leading-snug text-foreground">
                    {entry.label}
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {entry.hint}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="report-detail" className="text-sm font-medium">
              What happened?
              <span className="ml-1.5 font-normal text-muted-foreground">
                {reason === "other" ? "Required" : "Optional, and it helps"}
              </span>
            </Label>
            <Textarea
              id="report-detail"
              data-testid="report-detail"
              value={detail}
              onChange={(event) => setDetail(event.target.value.slice(0, 2000))}
              placeholder="Where it happened, and what you saw. The jury reads this."
              rows={4}
              className="mt-2"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {detail.length} / 2000
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={close} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={send}
            data-testid="report-send"
            // "Something else" with nothing written is a report nobody can act
            // on, so it is the one reason that requires the box.
            disabled={sending || !reason || (reason === "other" && !detail.trim())}
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            File report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
