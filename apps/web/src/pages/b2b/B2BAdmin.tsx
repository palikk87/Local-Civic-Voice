/**
 * The account's own admin portal: who at this company can sign in.
 *
 * A B2BClient row used to be the entire account — one username, one password,
 * shared by everybody at the firm. Withdrawing one person's access meant
 * changing the password on all of them, which is the exact event (a login that
 * stopped working with no explanation) that this codebase spent a week
 * explaining. A seat is one person, and what happens to it happens to them.
 *
 * Owner and admin see this page. An analyst does not, and the API refuses them
 * as well — a hidden nav item is not an access control.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserX,
  Users,
} from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type B2BMemberRow } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface AccountLogin {
  username: string;
  name: string;
  role: "owner";
  lastAccessAt: string | null;
  removable: false;
}

interface IssuedCredentials {
  username: string;
  password: string;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never";
}

function CredentialsBanner({
  credentials,
  onDismiss,
}: {
  credentials: IssuedCredentials;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const line = `${credentials.username} / ${credentials.password}`;

  return (
    <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center">
        <ShieldAlert size={16} color="#FBBF24" />
        <span className="ml-2 text-sm font-semibold text-amber-200">
          Give these to {credentials.username} now
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-200/80">
        The password is stored as a hash. This is the only time it can be shown — if it is lost,
        set a new one from this page.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-sm text-amber-100">
          {line}
        </code>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(line).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
          className="flex items-center rounded-lg bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/30"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg px-3 py-2 text-sm text-amber-200/80 hover:text-amber-100"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export default function B2BAdmin() {
  const session = useB2BStore((s) => s.session);
  const token = session?.token;

  const [members, setMembers] = useState<B2BMemberRow[]>([]);
  const [accountLogin, setAccountLogin] = useState<AccountLogin | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  /**
   * The banner is shown ONCE and cannot be recovered — the password is stored
   * as a hash and there is nothing to read back. Rendering it at the top of a
   * long page and trusting somebody to scroll up is how it gets lost.
   */
  const issuedRef = useRef<HTMLDivElement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<"admin" | "analyst">("analyst");
  const [addPassword, setAddPassword] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const [passwordFor, setPasswordFor] = useState<B2BMemberRow | null>(null);
  const [typedPassword, setTypedPassword] = useState("");
  /**
   * WHY THIS IS SEPARATE FROM `error`.
   *
   * Both the outcome banner and the error line render at the top of this page.
   * The set-password form sits inside a member's card, well down a scrolling
   * list — so every answer this form could give was painted somewhere the
   * person who submitted it was not looking. Success closed the form and put
   * the new credentials off-screen; failure left the form open and put the
   * reason off-screen. From the seat of whoever pressed the button, both read
   * as "the button does nothing", and that is exactly how it was reported.
   *
   * A form answers where it was submitted.
   */
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const headers = useCallback(
    (): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const load = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      const body = await res.json();
      setMembers(body.members ?? []);
      setAccountLogin(body.accountLogin ?? null);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const addSeat = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (addPassword && addPassword.length < 12) {
      setError("A password you type must be at least 12 characters. Leave it blank to generate one.");
      return;
    }

    setAddBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          username: addUsername.trim(),
          name: addName.trim(),
          role: addRole,
          ...(addEmail.trim() ? { email: addEmail.trim() } : {}),
          ...(addPassword ? { password: addPassword } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }
      setIssued(body.credentials);
      setShowAdd(false);
      setAddUsername("");
      setAddName("");
      setAddEmail("");
      setAddPassword("");
      setAddRole("analyst");
      await load();
    } catch {
      setError("Network error. Nothing was created.");
    } finally {
      setAddBusy(false);
    }
  };

  const patchSeat = async (member: B2BMemberRow, data: Record<string, unknown>) => {
    setBusyId(member.id);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${member.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(data),
      });
      if (!res.ok) setError((await res.json()).error ?? "That did not work.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    if (issued) issuedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [issued]);

  const setPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passwordFor) return;
    setPasswordError(null);
    if (typedPassword && typedPassword.length < 12) {
      setPasswordError(
        "A password you type must be at least 12 characters. Leave it blank to generate one.",
      );
      return;
    }

    setBusyId(passwordFor.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${passwordFor.id}/password`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(typedPassword ? { password: typedPassword } : {}),
      });
      const body = await res.json();
      if (!res.ok) {
        // Stays open, carrying its own reason. Closing on failure would throw
        // away what was typed AND hide why.
        setPasswordError(body.error ?? "That did not work.");
        return;
      }
      setIssued(body.credentials);
      setPasswordFor(null);
      setTypedPassword("");
      await load();
    } catch {
      setPasswordError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusyId(null);
    }
  };

  const removeSeat = async (member: B2BMemberRow) => {
    if (
      !window.confirm(
        `Remove ${member.name} (${member.username}) completely? Turning access off instead keeps their name on past activity.`,
      )
    ) {
      return;
    }
    setBusyId(member.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/admin/members/${member.id}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) setError((await res.json()).error ?? "That did not work.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <B2BShell title="Team">
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" color="#818CF8" />
        </div>
      </B2BShell>
    );
  }

  if (denied) {
    return (
      <B2BShell title="Team">
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-6">
          <p className="text-white">Only an owner or admin on this account can manage who signs in.</p>
          <p className="mt-2 text-sm text-slate-400">
            Ask whoever set up your company's account to change your role, or to make the change for
            you.
          </p>
        </div>
      </B2BShell>
    );
  }

  const field =
    "w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  const label = "mb-1 block text-sm font-medium text-slate-300";

  return (
    <B2BShell title="Team">
      <div ref={issuedRef}>
        {issued ? <CredentialsBanner credentials={issued} onDismiss={() => setIssued(null)} /> : null}
      </div>
      {error ? (
        <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center">
          <Users size={18} color="#818CF8" />
          <span className="ml-2 text-slate-300">
            {members.length + (accountLogin ? 1 : 0)} people can sign in
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((open) => !open)}
          className="flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus size={15} className="mr-1.5" />
          Add someone
        </button>
      </div>

      {showAdd ? (
        <form
          onSubmit={addSeat}
          className="mb-5 rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={label} htmlFor="seat-name">
                Their name
              </label>
              <input
                id="seat-name"
                className={field}
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={label} htmlFor="seat-username">
                Username they will type
              </label>
              <input
                id="seat-username"
                className={field}
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                pattern="[a-zA-Z0-9._\-]+"
                minLength={3}
                required
              />
            </div>
            <div>
              <label className={label} htmlFor="seat-email">
                Email (optional)
              </label>
              <input
                id="seat-email"
                type="email"
                className={field}
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="seat-role">
                What they can do
              </label>
              <select
                id="seat-role"
                className={field}
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as "admin" | "analyst")}
              >
                <option value="analyst">Analyst — read the dashboards</option>
                <option value="admin">Admin — dashboards, and manage this list</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className={label} htmlFor="seat-password">
                Password (optional)
              </label>
              <input
                id="seat-password"
                type="text"
                className={field}
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                placeholder="Leave blank and one will be generated"
                autoComplete="off"
              />
              {/* Both paths exist because both are things real administrators
                  do. Forcing a generated password is what gets it pasted into a
                  chat window so it can be read out. */}
              <p className="mt-1 text-xs text-slate-500">
                Type one if you are going to hand it over in person. Either way it is shown once and
                stored hashed.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={addBusy}
              className={cn(
                "flex items-center rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500",
                addBusy && "opacity-60",
              )}
            >
              {addBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create the seat
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-lg px-4 py-2 text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <div className="space-y-3">
        {accountLogin ? (
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{accountLogin.name}</p>
                <p className="text-sm text-slate-400">
                  {accountLogin.username} — last signed in {when(accountLogin.lastAccessAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-300">
                  Company account
                </span>
                {/* Listed rather than hidden: from the point of view of "who can
                    get in", it is one more login that exists. Leaving it out is
                    how somebody concludes there are two ways in when there are
                    three. */}
                <span className="text-xs text-slate-500">cannot be removed</span>
              </div>
            </div>
          </div>
        ) : null}

        {members.map((member) => (
          <div
            key={member.id}
            className={cn(
              "rounded-2xl border p-4",
              member.disabled
                ? "border-slate-800 bg-slate-900/40 opacity-70"
                : "border-slate-700/50 bg-slate-800/30",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">
                  {member.name}
                  {member.disabled ? (
                    <span className="ml-2 text-xs font-normal text-slate-500">access off</span>
                  ) : null}
                </p>
                <p className="text-sm text-slate-400">
                  {member.username}
                  {member.email ? ` — ${member.email}` : ""}
                </p>
                <p className="text-xs text-slate-500">Last signed in {when(member.lastAccessAt)}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={member.role}
                  onChange={(e) => patchSeat(member, { role: e.target.value })}
                  disabled={busyId === member.id}
                  aria-label={`Role for ${member.name}`}
                  className="rounded-lg border border-slate-700 bg-slate-900/60 px-2 py-1.5 text-sm text-white"
                >
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>

                <button
                  type="button"
                  onClick={() => {
                    setPasswordFor(member);
                    setTypedPassword("");
                    setPasswordError(null);
                  }}
                  disabled={busyId === member.id}
                  className="flex items-center rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
                >
                  <KeyRound size={14} className="mr-1.5" />
                  Set password
                </button>

                <button
                  type="button"
                  onClick={() => patchSeat(member, { disabled: !member.disabled })}
                  disabled={busyId === member.id}
                  className="flex items-center rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
                >
                  {member.disabled ? (
                    <>
                      <UserCheck size={14} className="mr-1.5" />
                      Turn access on
                    </>
                  ) : (
                    <>
                      <UserX size={14} className="mr-1.5" />
                      Turn access off
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => removeSeat(member)}
                  disabled={busyId === member.id}
                  aria-label={`Remove ${member.name}`}
                  className="rounded-lg border border-red-900/60 bg-red-950/40 p-2 text-red-400 hover:bg-red-950/70"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {passwordFor?.id === member.id ? (
              <form onSubmit={setPassword} className="mt-4 border-t border-slate-700/50 pt-4">
                <label className={label} htmlFor={`pw-${member.id}`}>
                  New password for {member.name}
                </label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={`pw-${member.id}`}
                    type="text"
                    autoComplete="off"
                    className={cn(field, "flex-1")}
                    value={typedPassword}
                    onChange={(e) => setTypedPassword(e.target.value)}
                    placeholder="Leave blank and one will be generated"
                  />
                  <button
                    type="submit"
                    disabled={busyId === member.id}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {busyId === member.id ? "Setting…" : "Set it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasswordFor(null);
                      setPasswordError(null);
                    }}
                    className="rounded-lg px-4 py-2 text-sm text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
                {passwordError ? (
                  <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {passwordError}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  This signs {member.name} out everywhere and nobody else at your company. The new
                  password appears at the top of this page, once.
                </p>
              </form>
            ) : null}
          </div>
        ))}

        {members.length === 0 ? (
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/20 p-6 text-center">
            <p className="text-white">Only the company account login exists so far.</p>
            <p className="mt-1 text-sm text-slate-400">
              Add a seat for each person who needs the dashboards. Then nobody has to share a
              password, and turning one person's access off leaves everyone else signed in.
            </p>
          </div>
        ) : null}
      </div>
    </B2BShell>
  );
}
