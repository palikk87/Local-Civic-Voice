import { useState, useEffect } from "react";
import { Vote } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AuthForm } from "@/components/auth/AuthForm";
import { useAuthUI } from "@/hooks/use-civic-auth";

/**
 * App-wide auth dialog opened via `useAuthUI().openAuth`.
 * Wraps the shared <AuthForm /> in a AYE & NAY–styled modal.
 */
export function AuthDialog() {
  const { open, reason, closeAuth } = useAuthUI();
  // Force-remount the form each time the dialog opens so it resets cleanly.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (open) setFormKey((k) => k + 1);
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) closeAuth();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/*
        THE BUG THIS FIXES, reported twice and then named: "no its actually the
        sign up window I'm having issues with".

        This used to pass `overflow-hidden`. The dialog primitive sets
        `overflow-y-auto` so a tall dialog scrolls — but these classes go through
        tailwind-merge, where the LAST overflow wins, so this one quietly turned
        the scrolling off again. The result: a dialog correctly capped to the
        height of the window, with everything past that height CLIPPED and
        reachable by nothing.

        Sign-up is the tallest thing in the app — name, username, email,
        password, confirm, the bot check, and the founding-documents footer — so
        it was the one that overflowed first and worst.

        The header is pinned and the form scrolls under it, which keeps the
        rounded corners the `overflow-hidden` was there for.
      */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-md flex-col overflow-hidden p-0">
        <div className="shrink-0 bg-primary px-6 py-7 text-primary-foreground">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15">
            <Vote className="h-7 w-7 text-accent" />
          </div>
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="font-display text-2xl font-semibold text-primary-foreground">
              Claim your voice
            </DialogTitle>
            <DialogDescription className="text-primary-foreground/70">
              {reason ??
                "Join AYE & NAY to cast simulated votes and shape the Public Pulse."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <AuthForm
            key={formKey}
            mode="signin"
            onSuccess={() => handleOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
