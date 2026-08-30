/**
 * Closing your account, and being told the truth about it first.
 *
 * WHY IT EXISTS. There was no way to leave. An account could only be removed by
 * an administrator, so getting out meant asking permission from the people you
 * were trying to leave. The owner's instruction: holding somebody's data to
 * keep our own system tidy violates their sovereignty, and the decision should
 * have real consequences for them and for others.
 *
 * WHY THE WARNING IS THIS LONG. Every line in it is a real consequence of what
 * services/account-deletion.ts does, and several land on OTHER people — the
 * conversation they are in, the vote count on a law they are reading, the
 * delegate whose borrowed voice goes back. Somebody is entitled to know that
 * before they press it, and none of it is invented for effect. There is no
 * scare copy here: if a line could not be traced to code, it is not on screen.
 *
 * WHY TWO STEPS. The password, because a session left open on an unattended
 * laptop must not be enough to erase a person's civic record. And the typed
 * name, because a checkbox is one absent-minded click and this cannot be undone
 * by us, by support, or by anybody.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/use-civic-auth";

export function CloseAccount() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmUsername, setConfirmUsername] = useState("");
  const [working, setWorking] = useState(false);

  /**
   * What they have to type. Their username if they have one, otherwise their
   * email — not every account carries a username, and one that does not must
   * still be closable by the person it belongs to.
   */
  const identifier = user?.username || user?.email || "";

  const close = async () => {
    setWorking(true);
    try {
      await api.delete("/api/users/me", {
        body: JSON.stringify({ password, confirmUsername }),
        headers: { "Content-Type": "application/json" },
      });
      // Nothing to go back to. Straight out, and the session is already dead on
      // the server.
      toast.success("Your account is closed.");
      window.location.href = "/";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The account could not be closed.");
      setWorking(false);
    }
  };

  if (!open) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-card p-6">
        <h2 className="font-semibold text-foreground">Close your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Erase your account and everything on it, permanently.
        </p>
        <Button
          variant="outline"
          className="mt-4 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setOpen(true)}
        >
          Close my account
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground">This erases everything, permanently.</h2>

          {/* Each line is something the deletion routine actually does. */}
          <ul className="mt-3 space-y-1.5 text-sm text-foreground/90">
            <li>Your posts and replies disappear from every conversation they are in.</li>
            <li>
              Your votes are removed from every law's count. The published tally on those
              laws will change.
            </li>
            <li>Your messages vanish from the other person's inbox.</li>
            <li>
              Delegations end. Anyone who lent you their voice gets it back, and any voice
              you borrowed returns to them.
            </li>
            <li>Your trust score, your badges and your record are gone.</li>
            <li>
              If you are sitting on a jury right now, your seat is given up and a new juror
              is drawn at random.
            </li>
            <li>
              If you have voted in an impeachment or a system reset that is still open, that
              vote is withdrawn.
            </li>
          </ul>

          <p className="mt-3 text-sm text-foreground/90">
            Proceedings that have already finished are not undone. A jury that has returned
            its verdict, an impeachment that concluded, a reset that took effect — those
            outcomes stand, with your name off them.
          </p>

          <p className="mt-3 text-sm font-semibold text-foreground">
            We keep no copy. There is no undo, and no support request can bring it back. If
            you sign up again later it will be a new account, starting at zero.
          </p>

          <div className="mt-5 space-y-3">
            <div>
              <label
                className="mb-1 block text-sm text-muted-foreground"
                htmlFor="close-account-password"
              >
                Your password
              </label>
              <Input
                id="close-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <div>
              <label
                className="mb-1 block text-sm text-muted-foreground"
                htmlFor="close-account-confirm"
              >
                Type <span className="font-mono text-foreground">{identifier}</span> to confirm
              </label>
              <Input
                id="close-account-confirm"
                autoComplete="off"
                value={confirmUsername}
                onChange={(event) => setConfirmUsername(event.target.value)}
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirmUsername("");
              }}
              disabled={working}
            >
              Keep my account
            </Button>
            <Button
              variant="destructive"
              onClick={close}
              disabled={
                working ||
                password.length === 0 ||
                confirmUsername.trim().toLowerCase() !== identifier.toLowerCase()
              }
            >
              {working ? "Closing…" : "Erase my account permanently"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
