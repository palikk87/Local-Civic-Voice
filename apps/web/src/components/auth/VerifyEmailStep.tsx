import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MailCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

/**
 * The last step of signing up: the code from the email.
 *
 * WHY THERE IS A STEP HERE AT ALL. Constitution Article I, Section 3 says only
 * verified human beings may contribute to the Pulse, and Bill of Rights
 * Article III asks for anti-bot verification so that "no bot-driven influence
 * shall obscure the true will of the people". Until now nothing checked: an
 * account could be created and vote in the same second, a thousand times over,
 * from a script.
 *
 * WHAT IT HONESTLY BUYS. A code to an inbox makes a thousand accounts cost
 * something instead of nothing. It is not proof that anybody is real —
 * disposable inboxes exist — and the copy below does not claim it is.
 *
 * READING STAYS OPEN THROUGHOUT. Somebody who closes this screen can still
 * browse every law, brief and tally; they simply cannot vote or post until
 * they finish. That is the honest split: the government's business is the
 * public good, and the Pulse is the thing that has to be protected.
 */
export function VerifyEmailStep({
  email,
  onVerified,
  onSkip,
}: {
  email: string;
  onVerified: () => void;
  onSkip?: () => void;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  async function verify() {
    const clean = code.trim();
    if (clean.length < 4) {
      setError("Enter the code from your email");
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.verifyEmail({
        email,
        otp: clean,
      });
      if (err) {
        setError(err.message || "That code did not work. Check it and try again.");
        return;
      }

      // The session carries emailVerified, and so does every gated route's
      // answer. Both have to be re-read or the app keeps refusing writes that
      // would now succeed.
      await queryClient.invalidateQueries();
      onVerified();
    } catch {
      setError("That code did not work. Check it and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    setResending(true);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      setNotice(err ? null : "Sent. It can take a minute to arrive.");
      if (err) setError(err.message || "Could not send another code.");
    } catch {
      setError("Could not send another code.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/20">
          <MailCheck className="h-6 w-6 text-accent" />
        </div>
        <h2 className="font-display text-xl font-semibold text-foreground">Check your email</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a code to <span className="font-medium text-foreground">{email}</span>.
        </p>
      </div>

      <div className="space-y-1.5">
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void verify();
          }}
          placeholder="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          className="text-center text-lg tracking-[0.4em]"
        />
        <p className="text-xs text-muted-foreground">
          {/* Said plainly, because a claim of anti-bot protection that
              overstates itself is worse than none. */}
          This is how the Pulse stays a count of citizens rather than of accounts.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}

      <Button className="w-full" disabled={loading} onClick={() => void verify()}>
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {loading ? "Checking…" : "Verify"}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          disabled={resending}
          onClick={() => void resend()}
          className="text-accent hover:underline disabled:opacity-50"
        >
          {resending ? "Sending…" : "Send another code"}
        </button>

        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground"
          >
            Look around first
          </button>
        ) : null}
      </div>
    </div>
  );
}
