import { useState } from "react";
import { MailWarning } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { VerifyEmailStep } from "./VerifyEmailStep";

/**
 * "You can read everything. You can't take part yet." — and here is where you
 * finish.
 *
 * WHAT THIS USED TO GET WRONG. It said "enter the code we emailed you" and
 * offered exactly one button: *Send another*. There was nowhere to enter
 * anything. The code box lived inside the sign-up form and was gone the moment
 * that form closed — a reload, a closed tab, or pressing "Look around first"
 * and it could never be reached again. So the banner instructed people to do
 * something the app gave them no way to do, and sent them another code each
 * time they looked for it.
 *
 * Now the banner opens the code box. Same component the last step of sign-up
 * uses, so there is one place that knows how to finish verifying and both
 * routes in lead to it.
 *
 * Renders nothing for a verified account and nothing for a signed-out visitor.
 */
export function VerifyEmailBanner() {
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);

  // Better Auth carries emailVerified on the session user. An older session
  // shape without the field must not paint a banner at everybody.
  const verified = (user as { emailVerified?: boolean } | null)?.emailVerified;
  if (!user || verified !== false) return null;

  const email = (user as { email?: string }).email ?? "";

  return (
    <>
      <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <MailWarning className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-foreground">
            Enter the code we emailed you to vote, delegate or post.{" "}
            <span className="text-muted-foreground">Reading stays open either way.</span>
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-amber-950 hover:bg-amber-400"
          >
            Enter code
          </button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Verify your email</DialogTitle>
            <DialogDescription>
              Enter the code sent to {email} to finish setting up your account.
            </DialogDescription>
          </DialogHeader>

          {/* No "Look around first" here: they already are. The dialog's own
              close control is the way out, and closing it costs nothing. */}
          <VerifyEmailStep
            email={email}
            onVerified={() => {
              setOpen(false);
              // The banner is driven by the session's emailVerified, and
              // VerifyEmailStep has already invalidated every query — so this
              // whole component disappears on the next render.
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
