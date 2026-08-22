import { useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { useCurrentUser } from "@/hooks/use-civic-auth";

/**
 * "You can read everything. You can't take part yet."
 *
 * Somebody who closed the verification step is signed in and can browse the
 * whole platform, but every write to the public record answers 403. Without
 * this they would find that out by pressing a vote button and watching nothing
 * happen — a gate with no sign on it is indistinguishable from a broken app.
 *
 * Renders nothing for a verified account and nothing for a signed-out visitor.
 */
export function VerifyEmailBanner() {
  const { user } = useCurrentUser();
  const [sending, setSending] = useState(false);

  // Better Auth carries emailVerified on the session user. An older session
  // shape without the field must not paint a banner at everybody.
  const verified = (user as { emailVerified?: boolean } | null)?.emailVerified;
  if (!user || verified !== false) return null;

  const email = (user as { email?: string }).email ?? "";

  async function resend() {
    setSending(true);
    try {
      const { error } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (error) toast.error(error.message || "Could not send another code.");
      else toast.success("Code sent", { description: "It can take a minute to arrive." });
    } catch {
      toast.error("Could not send another code.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <MailWarning className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-foreground">
          Enter the code we emailed you to vote, delegate or post.{" "}
          <span className="text-muted-foreground">Reading stays open either way.</span>
        </p>
        <button
          type="button"
          disabled={sending}
          onClick={() => void resend()}
          className="shrink-0 text-sm font-medium text-amber-500 hover:underline disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send another"}
        </button>
      </div>
    </div>
  );
}
