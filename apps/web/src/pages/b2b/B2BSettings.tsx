/**
 * What a client can change about its own account, without asking us.
 *
 * There was no such screen. A business paying for the dashboard could not see
 * when its password last moved, could not change it, and could not issue a new
 * API key — every one of those was a support request, and the last time a B2B
 * credential changed without an explanation it took a week to work out why.
 * The record of every change is already kept (services/credentials.ts writes it
 * before it reports success); this is the page that shows it to the party it is
 * about.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  History,
  KeyRound,
  Loader2,
  Lock,
  ShieldAlert,
  User,
} from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore, type B2BAccountInfo } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface SecurityHistory {
  credentials: { lastRotatedAt: string | null; rotationCount: number };
  history: Array<{ action: string; at: string; changedBy: string; details: string }>;
}

function when(iso: string | null | undefined): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A secret shown exactly once, with the fact that it is the only time said out loud. */
function ShownOnce({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center">
        <ShieldAlert size={16} color="#FBBF24" />
        <span className="ml-2 text-sm font-semibold text-amber-200">
          {label} — copy it now
        </span>
      </div>
      <p className="mt-1 text-xs text-amber-200/80">
        It is stored as a hash. Nobody, including us, can show it to you again.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg bg-slate-950/70 px-3 py-2 font-mono text-sm text-amber-100">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          className="flex items-center rounded-lg bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/30"
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span className="ml-1.5">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5">
      <div className="mb-4 flex items-center">
        {icon}
        <h2 className="ml-2 text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function B2BSettings() {
  const session = useB2BStore((s) => s.session);
  const setSession = useB2BStore.setState;

  const [info, setInfo] = useState<B2BAccountInfo | null>(null);
  const [security, setSecurity] = useState<SecurityHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState<string | null>(null);

  const [keyPassword, setKeyPassword] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);

  const token = session?.token;

  const load = useCallback(async () => {
    if (!token) return;
    const headers = { Authorization: `Bearer ${token}` };
    const [accountRes, securityRes] = await Promise.all([
      fetch(`${BACKEND_URL}/api/b2b/account`, { headers }),
      fetch(`${BACKEND_URL}/api/b2b/account/security`, { headers }),
    ]);
    if (accountRes.ok) setInfo(await accountRes.json());
    if (securityRes.ok) setSecurity(await securityRes.json());
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordDone(null);

    if (newPassword !== confirmPassword) {
      setPasswordError("The two new passwords do not match.");
      return;
    }
    if (newPassword.length < 12) {
      setPasswordError("Use at least 12 characters.");
      return;
    }

    setPasswordBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/account/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setPasswordError(body.error ?? "That did not work.");
        return;
      }

      // The change ended every session this password opened, including the one
      // this page is using. The server hands back a replacement so the person
      // who just changed their own password is not thrown out of the app for it.
      if (body.token && session) {
        setSession({ session: { ...session, token: body.token, expiresAt: body.expiresAt } });
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordDone(
        body.otherSessionsEnded > 0
          ? `Password changed. ${body.otherSessionsEnded} other signed-in device${
              body.otherSessionsEnded === 1 ? " was" : "s were"
            } signed out.`
          : "Password changed.",
      );
      await load();
    } catch {
      setPasswordError("Network error. Nothing was changed.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const issueKey = async (event: React.FormEvent) => {
    event.preventDefault();
    setKeyError(null);
    setIssuedKey(null);
    setKeyBusy(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/b2b/account/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: keyPassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setKeyError(body.error ?? "That did not work.");
        return;
      }
      setIssuedKey(body.apiKey);
      setKeyPassword("");
      await load();
    } catch {
      setKeyError("Network error. Nothing was changed.");
    } finally {
      setKeyBusy(false);
    }
  };

  if (loading) {
    return (
      <B2BShell title="Settings">
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin" color="#818CF8" />
        </div>
      </B2BShell>
    );
  }

  const field =
    "w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none";
  const label = "mb-1 block text-sm font-medium text-slate-300";

  return (
    <B2BShell title="Settings">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Account" icon={<Building2 size={18} color="#818CF8" />}>
          {info ? (
            <dl className="space-y-2 text-sm">
              {[
                ["Company", info.account.name],
                ["Account login", info.account.username],
                ["Plan", info.account.tier],
                ["Type", info.account.type],
                ["Customer since", when(info.account.createdAt)],
                ["Last sign-in", when(info.account.lastAccessAt)],
                ["People who can sign in", String(info.account.activeSeats)],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-4">
                  <dt className="text-slate-400">{term}</dt>
                  <dd className="text-right font-medium text-white">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">Account details are unavailable right now.</p>
          )}
        </Card>

        <Card title="Signed in as" icon={<User size={18} color="#818CF8" />}>
          {info ? (
            <div className="text-sm">
              <p className="text-lg font-semibold text-white">
                {info.signedInAs.kind === "member" ? info.signedInAs.name : info.account.name}
              </p>
              <p className="text-slate-400">{info.signedInAs.username}</p>
              <span className="mt-3 inline-block rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-medium capitalize text-indigo-300">
                {info.role}
              </span>
              <p className="mt-3 text-xs text-slate-400">
                {info.signedInAs.kind === "member"
                  ? "This is your own seat. Your password is yours alone — changing it affects nobody else at your company."
                  : "This is the company account login. It cannot be removed, and it is the only login that holds the API key."}
              </p>
            </div>
          ) : null}
        </Card>

        <Card title="Change your password" icon={<Lock size={18} color="#818CF8" />}>
          <form onSubmit={changePassword} className="space-y-3">
            <div>
              <label className={label} htmlFor="b2b-current-password">
                Current password
              </label>
              <input
                id="b2b-current-password"
                type="password"
                autoComplete="current-password"
                className={field}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Asked for every time. A session left open on an unattended laptop should not be
                enough to lock you out of your own account.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="b2b-new-password">
                New password
              </label>
              <input
                id="b2b-new-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={12}
                required
              />
            </div>
            <div>
              <label className={label} htmlFor="b2b-confirm-password">
                New password again
              </label>
              <input
                id="b2b-confirm-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={12}
                required
              />
            </div>

            {passwordError ? (
              <p className="text-sm text-red-400">{passwordError}</p>
            ) : null}
            {passwordDone ? (
              <p className="text-sm text-emerald-400">{passwordDone}</p>
            ) : null}

            <button
              type="submit"
              disabled={passwordBusy}
              className={cn(
                "flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-500",
                passwordBusy && "opacity-60",
              )}
            >
              {passwordBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change password
            </button>
          </form>
        </Card>

        {info?.canRotateApiKey ? (
          <Card title="API key" icon={<KeyRound size={18} color="#818CF8" />}>
            <p className="mb-3 text-sm text-slate-400">
              Issuing a new key stops the old one working immediately. Anything using it — a script,
              a scheduled export — needs the new value.
            </p>
            <form onSubmit={issueKey} className="space-y-3">
              <div>
                <label className={label} htmlFor="b2b-key-password">
                  Confirm with your password
                </label>
                <input
                  id="b2b-key-password"
                  type="password"
                  autoComplete="current-password"
                  className={field}
                  value={keyPassword}
                  onChange={(e) => setKeyPassword(e.target.value)}
                  required
                />
              </div>
              {keyError ? <p className="text-sm text-red-400">{keyError}</p> : null}
              <button
                type="submit"
                disabled={keyBusy}
                className={cn(
                  "flex w-full items-center justify-center rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 font-medium text-white transition-colors hover:bg-slate-700",
                  keyBusy && "opacity-60",
                )}
              >
                {keyBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Issue a new API key
              </button>
            </form>
            {issuedKey ? <ShownOnce label="New API key" value={issuedKey} /> : null}
          </Card>
        ) : null}

        <Card title="Credential history" icon={<History size={18} color="#818CF8" />}>
          <p className="mb-3 text-sm text-slate-400">
            Every change ever made to this account's password or API key, and who made it. Nothing in
            our backend changes a credential on its own — if something moved, this says who moved it.
          </p>
          {security && security.history.length > 0 ? (
            <ul className="space-y-3">
              {security.history.map((event, index) => (
                <li key={`${event.at}-${index}`} className="border-l-2 border-slate-700 pl-3">
                  <p className="text-sm font-medium text-white">{event.details}</p>
                  <p className="text-xs text-slate-400">
                    {when(event.at)} — {event.changedBy}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            /* The honest empty state: not "no history available", which reads as
               a failure to load. Nothing has happened, and that is the good case. */
            <p className="text-sm text-slate-400">
              Nothing has been changed since this account was created.
            </p>
          )}
        </Card>
      </div>
    </B2BShell>
  );
}
