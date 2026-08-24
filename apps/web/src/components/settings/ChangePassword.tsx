import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";

/**
 * Change your own password, while signed in.
 *
 * WHY THIS EXISTS. No backend process re-keys anybody on this platform — the
 * seed scripts create and never overwrite, and a credential only moves through
 * one audited service. That rule is only livable if the people who should be
 * able to change a password still can, and until now a signed-in person could
 * not. The only route to a new one was "forgot password": sign out, wait for an
 * email, type a code — for something they already had every right to do.
 *
 * The current password is required. A session cookie is not consent to change
 * the credential behind it, and without that check anybody who reaches an
 * unlocked laptop takes the account for good.
 */
export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    if (!current) return "Enter your current password.";
    if (next.length < 8) return "Use at least 8 characters for the new one.";
    if (next !== confirm) return "The two new passwords do not match.";
    if (next === current) return "That is the password you already have.";
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const result = await api.post<{ signedOutOtherDevices: number }>(
        "/api/users/me/password",
        { currentPassword: current, newPassword: next, signOutOtherDevices: signOutOthers },
      );

      setCurrent("");
      setNext("");
      setConfirm("");

      toast.success("Password changed", {
        description:
          signOutOthers && result.signedOutOtherDevices > 0
            ? `Signed out on ${result.signedOutOtherDevices} other ${
                result.signedOutOtherDevices === 1 ? "device" : "devices"
              }. You are still signed in here.`
            : "You are still signed in here.",
      });
    } catch (e) {
      // The server's own words: "That is not your current password", or a
      // validation message. Nothing here guesses.
      setError(e instanceof Error ? e.message : "Could not change your password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="font-semibold text-foreground">Password</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Yours to change, whenever you want. Nothing on this platform changes it for you.
      </p>

      <Separator className="my-4" />

      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="current-password">
            Current password
          </label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="new-password">
            New password
          </label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="confirm-password">
            New password again
          </label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </div>

        <label className="flex items-start gap-2 pt-1 text-sm text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={signOutOthers}
            onChange={(event) => setSignOutOthers(event.target.checked)}
          />
          {/* Default on: somebody changing a password usually thinks somebody
              else has it. The device they are typing on is never signed out. */}
          <span>
            Sign out everywhere else. This device stays signed in.
          </span>
        </label>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button className="w-full sm:w-auto" disabled={saving} onClick={() => void submit()}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {saving ? "Changing…" : "Change password"}
        </Button>
      </div>
    </div>
  );
}
