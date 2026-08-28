import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { listenForTheQuestion } from "@/lib/mobile/vote-anonymity";

/**
 * The question, asked once, the first time somebody votes.
 *
 * Mounted once at the top of the app, because the thing that raises it is the
 * vote pipeline rather than any particular screen — see
 * lib/mobile/vote-anonymity.ts for why it lives there.
 *
 * TWO BUTTONS, NO DEFAULT. There is no "OK", nothing is pre-selected, and both
 * answers are one tap. A dialog with a highlighted primary button is telling
 * you what to pick, and this is not a decision the platform gets to lean on.
 *
 * Closing it without answering cancels the vote. That sounds unhelpful until
 * you consider the alternative: publishing somebody's name against a position
 * on immigration or abortion because they hit Escape.
 */
export function VoteAnonymityDialog() {
  const [pending, setPending] = useState<{
    resolve: (named: boolean) => void;
    dismiss: () => void;
  } | null>(null);

  useEffect(
    () =>
      listenForTheQuestion((resolve, dismiss) => {
        setPending({ resolve, dismiss });
      }),
    [],
  );

  function answer(named: boolean) {
    pending?.resolve(named);
    setPending(null);
  }

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (open) return;
        pending?.dismiss();
        setPending(null);
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="vote-anonymity-dialog">
        <DialogHeader>
          <DialogTitle>Does your name go on this?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 pt-1 text-left">
              <p>
                Positions on this platform are public by default. Anyone can see how you
                voted on a law, on your profile, forever.
              </p>
              <p>
                Your vote counts exactly the same either way — including through anyone who
                has lent you their voice. What changes is whether your name is on it.
              </p>
              <p className="text-xs">
                Asked once. You can change it any time in Settings.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            onClick={() => answer(true)}
            data-testid="vote-publicly"
            className="h-auto flex-col items-start gap-1 py-3 text-left"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <Eye className="h-4 w-4" /> Put my name on it
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Your positions are public
            </span>
          </Button>
          <Button
            variant="outline"
            onClick={() => answer(false)}
            data-testid="vote-anonymously"
            className="h-auto flex-col items-start gap-1 py-3 text-left"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <EyeOff className="h-4 w-4" /> Keep my name off it
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Only you can see them
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
