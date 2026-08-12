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
 * Wraps the shared <AuthForm /> in a Civic Voice–styled modal.
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
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="bg-primary px-6 py-7 text-primary-foreground">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-accent/15">
            <Vote className="h-7 w-7 text-accent" />
          </div>
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="font-display text-2xl font-semibold text-primary-foreground">
              Claim your voice
            </DialogTitle>
            <DialogDescription className="text-primary-foreground/70">
              {reason ??
                "Join Civic Voice to cast simulated votes and shape the Public Pulse."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-6">
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
