import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, KeyRound, Loader2, Lock, Mail, Vote } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/**
 * Two-step password reset: email a one-time code, then set a new password.
 *
 * Ports the mobile screen (apps/mobile/src/app/forgot-password.tsx) to the DOM.
 * Web had no reset path at all — the backend implemented the flow and mobile
 * used it, but this client did not register emailOTPClient, so an account could
 * recover its password on a phone and not in a browser.
 *
 * Layout follows pages/Auth.tsx so the two read as one product.
 */
export default function ForgotPassword() {
  const navigate = useNavigate();

  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendCode = async () => {
    setError("");
    const clean = email.trim().toLowerCase();
    if (!clean.includes("@")) {
      setError("Please enter the email on your account");
      return;
    }

    setIsLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email: clean,
        type: "forget-password",
      });
      if (err) {
        setError(err.message || "Failed to send code. Please try again.");
      } else {
        setStep("reset");
      }
    } catch {
      setError("Failed to send code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setError("");
    if (!otp.trim()) {
      setError("Enter the code we emailed you");
      return;
    }
    if (password.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    setIsLoading(true);
    try {
      const { error: err } = await authClient.emailOtp.resetPassword({
        email: email.trim().toLowerCase(),
        otp: otp.trim(),
        password,
      });
      if (err) {
        setError(err.message || "Invalid code. Please try again.");
        return;
      }

      // Password changed — sign straight in so the user isn't asked twice.
      const { error: signInErr } = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
      });
      navigate(signInErr ? "/auth" : "/", { replace: true });
    } catch {
      setError("Could not reset your password. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1E3A5F] to-[#0F172A] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-accent/20">
            <Vote className="h-12 w-12 text-accent" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-white">
            Reset your password
          </h1>
          <p className="mt-2 text-slate-400">
            {step === "email"
              ? "We'll email you a one-time code."
              : `Enter the code sent to ${email}.`}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur-sm sm:p-8">
          {step === "email" ? (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">Email</span>
                <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900/60 px-3">
                  <Mail className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendCode()}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="w-full bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-600"
                  />
                </div>
              </label>

              <button
                type="button"
                onClick={handleSendCode}
                disabled={isLoading}
                className="flex w-full items-center justify-center rounded-xl bg-accent py-3 font-semibold text-slate-900 disabled:opacity-60"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send code"}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">Code</span>
                <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900/60 px-3">
                  <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="w-full bg-transparent px-3 py-3 tracking-widest text-white outline-none placeholder:text-slate-600"
                  />
                </div>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">New password</span>
                <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900/60 px-3">
                  <Lock className="h-4 w-4 shrink-0 text-slate-500" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleReset()}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                    className="w-full bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-600"
                  />
                </div>
              </label>

              <button
                type="button"
                onClick={handleReset}
                disabled={isLoading}
                className="flex w-full items-center justify-center rounded-xl bg-accent py-3 font-semibold text-slate-900 disabled:opacity-60"
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Set new password"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setPassword("");
                  setError("");
                }}
                className="w-full py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                Use a different email
              </button>
            </div>
          )}

          {error ? (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => navigate("/auth")}
          className="mt-6 flex w-full items-center justify-center py-2 text-slate-400 hover:text-slate-200"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to sign in
        </button>
      </div>
    </div>
  );
}
