import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Loader2,
  Mail,
  User,
  AtSign,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  BookOpen,
  Scroll,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { HumanCheck, useHumanCheck } from "@/components/auth/HumanCheck";
import { VerifyEmailStep } from "./VerifyEmailStep";
import { api } from "@/lib/api";
import { isUnreachable } from "@/lib/request-failure";

type Mode = "signin" | "signup";

interface AuthFormProps {
  /** Initial mode. Users can toggle between sign in / sign up. */
  mode?: Mode;
  /** Called after a successful sign in / sign up. */
  onSuccess?: () => void;
  /** Whether to show the founding-documents footer (sign up screens). */
  showFoundingDocs?: boolean;
  className?: string;
}

/**
 * Shared AYE & NAY auth form. Email + password (matches the mobile app and
 * the backend's email/password provider). Sign up additionally collects a
 * display name and username; the username is persisted via
 * PATCH /api/users/me after the account is created.
 */
export function AuthForm({
  mode: initialMode = "signin",
  onSuccess,
  showFoundingDocs = true,
  className,
}: AuthFormProps) {
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>(initialMode);
  /**
   * CONSTITUTION ARTICLE I §3. Null until the visitor has passed the bot test,
   * or forever if no check is configured on this deployment — `challenge`
   * tells the button which of those it is, so a missing key never looks like
   * an unsolved puzzle.
   */
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const { data: challenge } = useHumanCheck();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
  }

  function validate(): string | null {
    const cleanEmail = email.trim();
    if (isSignup) {
      if (!displayName.trim()) return "Please enter your name.";
      if (!username.trim()) return "Please choose a username.";
      if (username.includes(" ")) return "Username cannot contain spaces.";
      if (!cleanEmail || !cleanEmail.includes("@"))
        return "Please enter a valid email address.";
    } else if (!cleanEmail) {
      return "Please enter your email or username.";
    }
    if (isSignup && password.length < 6)
      return "Password must be at least 6 characters.";
    if (!password) return "Please enter your password.";
    if (isSignup && password !== confirmPassword)
      return "Passwords do not match.";
    return null;
  }

  async function handleSignIn() {
    // Accepts either an email address or a username. The backend resolves the
    // identifier and establishes the Better Auth session cookie.
    await api.post("/api/login", {
      identifier: email.trim(),
      password,
    });

    // Full reload so Better Auth's session hook picks up the new cookie, while
    // keeping the user on their current page (e.g. mid-vote), now signed in.
    window.location.reload();
  }

  async function handleSignUp() {
    // THE TOKEN GOES IN A HEADER, not the body. Better Auth owns the sign-up
    // body and drops fields its schema does not know, so a token put there
    // arrives as nothing at all.
    const { error: err } = await authClient.signUp.email(
      {
        email: email.trim().toLowerCase(),
        password,
        name: displayName.trim(),
      },
      humanToken
        ? { headers: { "cf-turnstile-response": humanToken } }
        : undefined,
    );
    if (err) throw new Error(err.message || "Could not create your account.");

    // autoSignIn is enabled, so a session now exists. Persist the chosen
    // username. If it's taken (409), surface the message but don't block —
    // the account is already created and signed in.
    let usernameError: string | null = null;
    try {
      await api.patch("/api/users/me", {
        username: username.trim().toLowerCase(),
      });
    } catch (e) {
      usernameError =
        e instanceof Error ? e.message : "That username is taken.";
    }

    await queryClient.invalidateQueries();
    if (usernameError) setError(usernameError);

    // CONSTITUTION ARTICLE I, SECTION 3. The account exists and is signed in,
    // but it cannot vote, delegate or post until the emailed code is entered.
    // The server sent that code the moment the account was created, so this
    // step is a prompt rather than a trigger — closing it loses nothing except
    // the ability to take part until they come back to it.
    setVerifying(true);
  }

  async function handleSubmit() {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    try {
      if (isSignup) {
        await handleSignUp();
      } else {
        await handleSignIn();
      }
    } catch (e) {
      // "Failed to fetch" IS THE BROWSER TALKING, NOT US. With the API
      // unreachable this box rendered that string verbatim, which reads to
      // somebody trying to sign in as though their password were the problem.
      // Measured with the server switched off; see
      // docs/IF_THE_API_HOST_GOES_AWAY.md. A refused credential still shows
      // the server's own words, because that IS the answer.
      setError(
        isUnreachable(e)
          ? "We can't reach the server right now, so we can't check that. This is on our side — " +
              "try again in a moment."
          : e instanceof Error
            ? e.message
            : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  const iconClass =
    "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";

  // The account is made; the code is what is left. Shown in place of the form
  // rather than as a dialog over it, so there is one obvious next thing to do.
  if (verifying) {
    return (
      <div className={className}>
        <VerifyEmailStep
          email={email.trim().toLowerCase()}
          onVerified={() => {
            setVerifying(false);
            onSuccess?.();
          }}
          onSkip={() => {
            setVerifying(false);
            onSuccess?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className={className}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
        className="space-y-4"
      >
        {isSignup ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="civic-name" className="text-foreground/90">
                Full name
              </Label>
              <div className="relative">
                <User className={iconClass} />
                <Input
                  id="civic-name"
                  autoFocus
                  required
                  placeholder="Jane Citizen"
                  className="pl-9"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoCapitalize="words"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="civic-username" className="text-foreground/90">
                Username
              </Label>
              <div className="relative">
                <AtSign className={iconClass} />
                <Input
                  id="civic-username"
                  required
                  placeholder="janecitizen"
                  className="pl-9"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))
                  }
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </div>
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="civic-email" className="text-foreground/90">
            {isSignup ? "Email address" : "Email or username"}
          </Label>
          <div className="relative">
            <Mail className={iconClass} />
            <Input
              id="civic-email"
              type={isSignup ? "email" : "text"}
              autoFocus={!isSignup}
              required
              placeholder={isSignup ? "you@example.com" : "you@example.com or username"}
              className="pl-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="civic-password" className="text-foreground/90">
            Password
          </Label>
          <div className="relative">
            <Lock className={iconClass} />
            <Input
              id="civic-password"
              type={showPassword ? "text" : "password"}
              required
              placeholder={
                isSignup ? "At least 6 characters" : "Your password"
              }
              className="pl-9 pr-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {isSignup ? (
          <div className="space-y-2">
            <Label
              htmlFor="civic-confirm-password"
              className="text-foreground/90"
            >
              Confirm password
            </Label>
            <div className="relative">
              <Lock className={iconClass} />
              <Input
                id="civic-confirm-password"
                type={showPassword ? "text" : "password"}
                required
                placeholder="Re-enter password"
                className="pl-9"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
          </div>
        ) : null}

        {/* CONSTITUTION ARTICLE I §3. Renders nothing when no key is
            configured, so a deployment without one still works and simply does
            not claim to have checked. */}
        {isSignup ? <HumanCheck onToken={setHumanToken} /> : null}

        {error ? (
          <p className="text-sm font-medium text-destructive">{error}</p>
        ) : null}

        <Button
          type="submit"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          disabled={loading || (isSignup && challenge?.configured === true && !humanToken)}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              {isSignup ? "Create Account" : "Sign In"}
              <ArrowRight className="ml-1 h-4 w-4" />
            </>
          )}
        </Button>

        {/* Sign-in only. Mobile has offered this since the OTP flow shipped;
            web had no reset route at all until now. */}
        {!isSignup ? (
          <div className="flex justify-center text-sm">
            <Link
              to="/forgot-password"
              className="font-semibold text-accent underline-offset-2 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        ) : null}

        <div className="flex justify-center gap-1 text-sm">
          <span className="text-muted-foreground">
            {isSignup ? "Already have an account?" : "Don't have an account?"}
          </span>
          <button
            type="button"
            className="font-semibold text-accent underline-offset-2 hover:underline"
            onClick={() => switchMode(isSignup ? "signin" : "signup")}
          >
            {isSignup ? "Sign In" : "Sign Up"}
          </button>
        </div>

        {isSignup && showFoundingDocs ? (
          <div className="border-t border-border/60 pt-4">
            <p className="mb-3 text-center text-xs text-muted-foreground">
              By joining, you agree to operate under our
            </p>
            <div className="flex overflow-hidden rounded-lg border border-border">
              <Link
                to="/documents"
                className="flex flex-1 items-center justify-center gap-1.5 border-r border-border bg-secondary/60 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <BookOpen className="h-3.5 w-3.5" /> Constitution
              </Link>
              <Link
                to="/documents#bill-of-rights"
                className="flex flex-1 items-center justify-center gap-1.5 bg-accent/15 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
              >
                <Scroll className="h-3.5 w-3.5" /> Bill of Rights
              </Link>
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
